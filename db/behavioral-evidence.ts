import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";

import { getDb } from "./index";
import {
  behavioralClaims,
  behavioralClaimStatusEvents,
  behavioralEvidenceItems,
  behavioralEvidenceQuestionLinks,
  practiceTranscriptTurns,
  type BehavioralClaimRow,
  type BehavioralEvidenceItemRow,
} from "./schema";
import {
  BEHAVIORAL_CLAIM_LIMIT,
  BEHAVIORAL_EVIDENCE_LIMIT,
  BEHAVIORAL_GAP_LIMIT,
  BehavioralEvidenceError,
  type BehavioralClaimInput,
  type BehavioralClaimWritePayload,
  type BehavioralEvidenceInput,
  type BehavioralEvidenceWritePayload,
  validateBehavioralClaimWrite,
  validateBehavioralEvidenceWrite,
} from "./behavioral-evidence-policy";

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function evidenceIdentityMatches(row: BehavioralEvidenceItemRow, input: BehavioralEvidenceInput) {
  return row.projectKey === input.projectKey
    && row.origin === input.origin
    && row.statement === input.statement
    && (row.sourceRevision ?? undefined) === input.sourceRevision
    && row.evidenceGrade === input.evidenceGrade
    && row.attributionGrade === input.attributionGrade
    && row.claimStrength === input.claimStrength
    && row.candidateState === input.candidateState
    && row.visibility === "owner_private"
    && jsonEqual(row.safeProvenance, input.safeProvenance)
    && jsonEqual(row.supports, input.supports)
    && jsonEqual(row.limitations, input.limitations)
    && jsonEqual(row.tags, input.tags)
    && jsonEqual(row.ownerAttestation, input.ownerAttestation);
}

function claimIdentityMatches(row: BehavioralClaimRow, input: BehavioralClaimInput) {
  return row.questionId === input.questionId
    && row.text === input.text
    && row.scope === input.scope
    && row.claimStrength === input.claimStrength;
}

function claimCheckpointMatches(row: BehavioralClaimRow, input: BehavioralClaimInput) {
  return claimIdentityMatches(row, input)
    && row.status === input.status
    && jsonEqual(row.evidenceIds, input.evidenceIds)
    && jsonEqual(row.contraryEvidenceIds, input.contraryEvidenceIds)
    && jsonEqual(row.gaps, input.gaps)
    && (row.saferWording ?? undefined) === input.saferWording
    && jsonEqual(row.tags, input.tags);
}

export async function upsertBehavioralEvidenceItem(
  ownerId: string,
  payload: BehavioralEvidenceWritePayload,
  nowMs = Date.now(),
) {
  validateBehavioralEvidenceWrite(payload);
  const db = getDb();
  const { evidence, questionLink } = payload;
  const existingRows = await db.select().from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    eq(behavioralEvidenceItems.evidenceId, evidence.evidenceId),
  ));
  const existing = existingRows[0] ?? null;
  if (existing && !evidenceIdentityMatches(existing, evidence)) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_identity_conflict",
      "That evidence ID already belongs to different immutable content; supersession belongs to the later candidate-review slice.",
    );
  }
  if (evidence.ownerAttestation) {
    const attestedTurns = await db.select({
      body: practiceTranscriptTurns.body,
      occurredAt: practiceTranscriptTurns.occurredAt,
    })
      .from(practiceTranscriptTurns)
      .where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, evidence.ownerAttestation.activityId),
        eq(practiceTranscriptTurns.turnId, evidence.ownerAttestation.userTurnId),
        eq(practiceTranscriptTurns.specialty, "behavioral"),
        eq(practiceTranscriptTurns.speaker, "user"),
      ));
    const attestedTurn = attestedTurns[0];
    if (attestedTurn?.occurredAt !== evidence.ownerAttestation.confirmedAt
        || attestedTurn.body.normalize("NFKC").trim() !== evidence.statement.normalize("NFKC").trim()) {
      throw new BehavioralEvidenceError(
        "behavioral_evidence_owner_attestation_not_found",
        "A3 evidence must exactly match an existing same-owner behavioral user turn and timestamp.",
      );
    }
  }
  const existingLinks = await db.select().from(behavioralEvidenceQuestionLinks).where(and(
    eq(behavioralEvidenceQuestionLinks.ownerId, ownerId),
    eq(behavioralEvidenceQuestionLinks.questionId, questionLink.questionId),
    eq(behavioralEvidenceQuestionLinks.evidenceId, evidence.evidenceId),
  ));
  const existingLink = existingLinks[0] ?? null;
  if (existingLink && existingLink.relevance !== questionLink.relevance) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_link_conflict",
      "That evidence and question identity already has a different immutable relevance.",
    );
  }

  const writes = [];
  if (!existing) {
    writes.push(db.insert(behavioralEvidenceItems).values({
      ownerId,
      evidenceId: evidence.evidenceId,
      projectKey: evidence.projectKey,
      origin: evidence.origin,
      statement: evidence.statement,
      sourceRevision: evidence.sourceRevision ?? null,
      evidenceGrade: evidence.evidenceGrade,
      attributionGrade: evidence.attributionGrade,
      claimStrength: evidence.claimStrength,
      candidateState: evidence.candidateState,
      visibility: "owner_private",
      safeProvenance: evidence.safeProvenance,
      supports: evidence.supports,
      limitations: evidence.limitations,
      tags: evidence.tags,
      ownerAttestation: evidence.ownerAttestation ?? null,
      createdAt: nowMs,
      updatedAt: nowMs,
    }));
  }
  if (!existingLink) {
    writes.push(db.insert(behavioralEvidenceQuestionLinks).values({
      ownerId,
      questionId: questionLink.questionId,
      evidenceId: evidence.evidenceId,
      relevance: questionLink.relevance,
      createdAt: nowMs,
      updatedAt: nowMs,
    }));
  }
  if (writes.length > 0) {
    await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
  }
  return {
    evidenceId: evidence.evidenceId,
    questionId: questionLink.questionId,
    relevance: questionLink.relevance,
    status: !existing ? "inserted" : !existingLink ? "linked" : "unchanged",
  };
}

async function readClaimEvidence(ownerId: string, claim: BehavioralClaimInput) {
  const evidenceIds = [...new Set([...claim.evidenceIds, ...claim.contraryEvidenceIds])];
  if (evidenceIds.length === 0) return [];
  const db = getDb();
  const rows = await db.select().from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    inArray(behavioralEvidenceItems.evidenceId, evidenceIds),
  ));
  if (rows.length !== evidenceIds.length) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_evidence_missing",
      "Every claim evidence ID must already exist for the same owner.",
    );
  }
  const links = await db.select().from(behavioralEvidenceQuestionLinks).where(and(
    eq(behavioralEvidenceQuestionLinks.ownerId, ownerId),
    eq(behavioralEvidenceQuestionLinks.questionId, claim.questionId),
    inArray(behavioralEvidenceQuestionLinks.evidenceId, evidenceIds),
  ));
  const relevanceByEvidence = new Map(links.map((link) => [link.evidenceId, link.relevance]));
  if (claim.evidenceIds.some((id) => relevanceByEvidence.get(id) !== "supporting")
      || claim.contraryEvidenceIds.some((id) => relevanceByEvidence.get(id) !== "contrary")) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_evidence_link_missing",
      "Every claim evidence ID must already have the matching question relevance link.",
    );
  }
  return rows;
}

function enforceVerifiedClaimEvidence(claim: BehavioralClaimInput, evidence: BehavioralEvidenceItemRow[]) {
  const supporting = new Set(claim.evidenceIds);
  const accepted = evidence.filter((item) => supporting.has(item.evidenceId) && item.candidateState === "accepted");
  const contrary = new Set(claim.contraryEvidenceIds);
  const acceptedContrary = evidence.filter((item) => contrary.has(item.evidenceId) && item.candidateState === "accepted");
  if (claim.status === "contradicted") {
    if (claim.claimStrength !== "contradicted") {
      throw new BehavioralEvidenceError(
        "behavioral_claim_status_strength_conflict",
        "A contradicted checkpoint must retain contradicted claim strength.",
      );
    }
    if (!acceptedContrary.some((item) => item.evidenceGrade !== "E0"
        && !["generated_secondary", "derived_inference"].includes(item.origin))) {
      throw new BehavioralEvidenceError(
        "behavioral_claim_contrary_evidence_required",
        "A contradicted claim requires accepted probative contrary evidence.",
      );
    }
    return;
  }
  if (claim.claimStrength === "contradicted") {
    throw new BehavioralEvidenceError(
      "behavioral_claim_status_strength_conflict",
      "Contradicted claim strength cannot be smoothed into another status.",
    );
  }
  if (claim.status !== "verified") return;
  if (!["project_fact", "personal_contribution_candidate"].includes(claim.claimStrength)) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_status_strength_conflict",
      "Only a project fact or owner-confirmed personal contribution can be verified.",
    );
  }
  const personalScopes = ["personal_contribution", "ownership", "decision", "leadership"];
  if ((personalScopes.includes(claim.scope) && claim.claimStrength !== "personal_contribution_candidate")
      || (!personalScopes.includes(claim.scope) && claim.claimStrength !== "project_fact")) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_scope_strength_conflict",
      "Verified claim scope and claim strength must describe the same project or personal authority boundary.",
    );
  }
  if (acceptedContrary.length > 0) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_unresolved_contrary_evidence",
      "A claim with accepted contrary evidence cannot be verified.",
    );
  }
  if (accepted.length === 0) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_accepted_evidence_required",
      "A verified claim requires accepted supporting evidence.",
    );
  }
  const probative = accepted.filter((item) => item.evidenceGrade !== "E0"
    && !["generated_secondary", "derived_inference"].includes(item.origin));
  if (probative.length === 0) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_primary_evidence_required",
      "Generated or inferred material cannot independently verify a behavioral claim.",
    );
  }
  if (claim.claimStrength === "project_fact" && !probative.some((item) => item.evidenceGrade === "E3")) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_e3_required",
      "A verified project fact requires accepted E3 evidence.",
    );
  }
  if ((personalScopes.includes(claim.scope)
        || claim.claimStrength === "personal_contribution_candidate")
      && !probative.some((item) => item.attributionGrade === "A3" && item.ownerAttestation)) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_a3_required",
      "A verified personal contribution requires accepted A3 owner-attested evidence.",
    );
  }
  if (["production", "scale", "metric", "result"].includes(claim.scope)
      && !probative.some((item) => item.origin === "production_evidence"
        || (item.origin === "user_statement" && item.attributionGrade === "A3" && item.ownerAttestation))) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_outcome_evidence_required",
      "Production, scale, metric, and result claims require production evidence or an exact A3 owner attestation.",
    );
  }
}

export async function setBehavioralClaimStatus(
  ownerId: string,
  operationId: string,
  payload: BehavioralClaimWritePayload,
  nowMs = Date.now(),
) {
  validateBehavioralClaimWrite(payload);
  const db = getDb();
  const { claim } = payload;
  const priorEvents = await db.select().from(behavioralClaimStatusEvents).where(and(
    eq(behavioralClaimStatusEvents.ownerId, ownerId),
    eq(behavioralClaimStatusEvents.operationId, operationId),
  ));
  const priorEvent = priorEvents[0] ?? null;
  if (priorEvent) {
    const snapshot = priorEvent.snapshot as {
      request?: BehavioralClaimWritePayload;
      result?: "inserted" | "revised" | "unchanged";
      revision?: number;
    };
    if (!snapshot.request || !jsonEqual(snapshot.request, payload) || snapshot.revision !== priorEvent.revision) {
      throw new BehavioralEvidenceError(
        "behavioral_claim_operation_conflict",
        "That claim operation ID already belongs to a different checkpoint.",
      );
    }
    return {
      claimId: claim.claimId,
      revision: priorEvent.revision,
      status: priorEvent.status,
      result: snapshot.result ?? "unchanged",
    };
  }
  const evidence = await readClaimEvidence(ownerId, claim);
  enforceVerifiedClaimEvidence(claim, evidence);
  const existingRows = await db.select().from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    eq(behavioralClaims.claimId, claim.claimId),
  ));
  const existing = existingRows[0] ?? null;
  if (existing && !claimIdentityMatches(existing, claim)) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_identity_conflict",
      "That claim ID already belongs to different immutable text, scope, question, or strength.",
    );
  }
  const currentRevision = existing?.revision ?? 0;
  if (currentRevision !== payload.expectedRevision) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_revision_conflict",
      `The claim checkpoint changed; read preflight and retry with expectedRevision ${currentRevision}.`,
    );
  }

  const revision = currentRevision + 1;
  const result = existing ? (claimCheckpointMatches(existing, claim) ? "unchanged" : "revised") : "inserted";
  const snapshot = { request: payload, visibility: "owner_private", revision, result };
  const claimWrite = existing
    ? db.update(behavioralClaims).set({
      status: claim.status,
      evidenceIds: claim.evidenceIds,
      contraryEvidenceIds: claim.contraryEvidenceIds,
      gaps: claim.gaps,
      saferWording: claim.saferWording ?? null,
      tags: claim.tags,
      revision,
      updatedAt: nowMs,
    }).where(and(
      eq(behavioralClaims.ownerId, ownerId),
      eq(behavioralClaims.claimId, claim.claimId),
      eq(behavioralClaims.revision, payload.expectedRevision),
    ))
    : db.insert(behavioralClaims).values({
      ownerId,
      claimId: claim.claimId,
      questionId: claim.questionId,
      text: claim.text,
      scope: claim.scope,
      status: claim.status,
      claimStrength: claim.claimStrength,
      evidenceIds: claim.evidenceIds,
      contraryEvidenceIds: claim.contraryEvidenceIds,
      gaps: claim.gaps,
      saferWording: claim.saferWording ?? null,
      tags: claim.tags,
      visibility: "owner_private",
      revision,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
  try {
    await db.batch([
      claimWrite,
      db.insert(behavioralClaimStatusEvents).values({
        ownerId,
        claimId: claim.claimId,
        revision,
        operationId,
        status: claim.status,
        snapshot,
        createdAt: nowMs,
      }),
    ]);
  } catch (error) {
    const replayRows = await db.select().from(behavioralClaimStatusEvents).where(and(
      eq(behavioralClaimStatusEvents.ownerId, ownerId),
      eq(behavioralClaimStatusEvents.operationId, operationId),
    ));
    const replay = replayRows[0] ?? null;
    const replaySnapshot = replay?.snapshot as typeof snapshot | undefined;
    if (replay && replaySnapshot?.request && jsonEqual(replaySnapshot.request, payload)) {
      return {
        claimId: claim.claimId,
        revision: replay.revision,
        status: replay.status,
        result: replaySnapshot.result,
      };
    }
    const latest = await db.select({ revision: behavioralClaims.revision })
      .from(behavioralClaims)
      .where(and(
        eq(behavioralClaims.ownerId, ownerId),
        eq(behavioralClaims.claimId, claim.claimId),
      ));
    if ((latest[0]?.revision ?? 0) !== payload.expectedRevision) {
      throw new BehavioralEvidenceError(
        "behavioral_claim_revision_conflict",
        `The claim checkpoint changed; read preflight and retry with expectedRevision ${latest[0]?.revision ?? 0}.`,
      );
    }
    throw error;
  }
  return { claimId: claim.claimId, revision, status: claim.status, result };
}

function evidenceReadModel(row: BehavioralEvidenceItemRow) {
  return {
    evidenceId: row.evidenceId,
    projectKey: row.projectKey,
    origin: row.origin,
    statement: row.statement,
    sourceRevision: row.sourceRevision,
    evidenceGrade: row.evidenceGrade,
    attributionGrade: row.attributionGrade,
    claimStrength: row.claimStrength,
    candidateState: row.candidateState,
    visibility: row.visibility,
    safeProvenance: row.safeProvenance,
    supports: row.supports,
    limitations: row.limitations,
    tags: row.tags,
    ownerAttestation: row.ownerAttestation,
  };
}

export async function queryBehavioralEvidence(ownerId: string, questionId: string) {
  const db = getDb();
  const acceptedEvidenceQuery = (relevance: "supporting" | "contrary") => db
    .select(getTableColumns(behavioralEvidenceItems))
    .from(behavioralEvidenceQuestionLinks)
    .innerJoin(behavioralEvidenceItems, and(
      eq(behavioralEvidenceItems.ownerId, behavioralEvidenceQuestionLinks.ownerId),
      eq(behavioralEvidenceItems.evidenceId, behavioralEvidenceQuestionLinks.evidenceId),
    ))
    .where(and(
      eq(behavioralEvidenceQuestionLinks.ownerId, ownerId),
      eq(behavioralEvidenceQuestionLinks.questionId, questionId),
      eq(behavioralEvidenceQuestionLinks.relevance, relevance),
      eq(behavioralEvidenceItems.candidateState, "accepted"),
    ))
    .orderBy(asc(behavioralEvidenceItems.evidenceId))
    .limit(BEHAVIORAL_EVIDENCE_LIMIT + 1);
  const [supportingRows, contraryRows, claimRows] = await Promise.all([
    acceptedEvidenceQuery("supporting"),
    acceptedEvidenceQuery("contrary"),
    db.select().from(behavioralClaims).where(and(
      eq(behavioralClaims.ownerId, ownerId),
      eq(behavioralClaims.questionId, questionId),
    )).orderBy(asc(behavioralClaims.claimId)).limit(BEHAVIORAL_CLAIM_LIMIT + 1),
  ]);
  const supportingEvidence = supportingRows.slice(0, BEHAVIORAL_EVIDENCE_LIMIT).map(evidenceReadModel);
  const contraryEvidence = contraryRows.slice(0, BEHAVIORAL_EVIDENCE_LIMIT).map(evidenceReadModel);
  const visibleClaims = claimRows.slice(0, BEHAVIORAL_CLAIM_LIMIT);
  const allGaps = visibleClaims.flatMap((claim) => (claim.gaps as string[]).map((text) => ({
    claimId: claim.claimId,
    text,
  })));
  return {
    questionId,
    supportingEvidence,
    contraryEvidence,
    claims: visibleClaims.map((claim) => ({
      claimId: claim.claimId,
      text: claim.text,
      scope: claim.scope,
      status: claim.status,
      claimStrength: claim.claimStrength,
      evidenceIds: claim.evidenceIds,
      contraryEvidenceIds: claim.contraryEvidenceIds,
      saferWording: claim.saferWording,
      tags: claim.tags,
      revision: claim.revision,
      visibility: claim.visibility,
    })),
    gaps: allGaps.slice(0, BEHAVIORAL_GAP_LIMIT),
    storyCandidates: [],
    limits: {
      supportingEvidence: BEHAVIORAL_EVIDENCE_LIMIT,
      contraryEvidence: BEHAVIORAL_EVIDENCE_LIMIT,
      claims: BEHAVIORAL_CLAIM_LIMIT,
      gaps: BEHAVIORAL_GAP_LIMIT,
      storyCandidates: 3,
    },
    truncated: {
      supportingEvidence: supportingRows.length > BEHAVIORAL_EVIDENCE_LIMIT,
      contraryEvidence: contraryRows.length > BEHAVIORAL_EVIDENCE_LIMIT,
      claims: claimRows.length > BEHAVIORAL_CLAIM_LIMIT,
      gaps: claimRows.length > BEHAVIORAL_CLAIM_LIMIT || allGaps.length > BEHAVIORAL_GAP_LIMIT,
      storyCandidates: false,
    },
  };
}

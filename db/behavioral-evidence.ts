import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

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
import {
  getBehavioralStoryFoundationSummary,
  queryBehavioralStories,
} from "./behavioral-story";

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

async function readEvidenceItem(ownerId: string, evidenceId: string) {
  const rows = await getDb().select().from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    eq(behavioralEvidenceItems.evidenceId, evidenceId),
  ));
  return rows[0] ?? null;
}

async function readEvidenceLink(ownerId: string, questionId: string, evidenceId: string) {
  const rows = await getDb().select().from(behavioralEvidenceQuestionLinks).where(and(
    eq(behavioralEvidenceQuestionLinks.ownerId, ownerId),
    eq(behavioralEvidenceQuestionLinks.questionId, questionId),
    eq(behavioralEvidenceQuestionLinks.evidenceId, evidenceId),
  ));
  return rows[0] ?? null;
}

export async function upsertBehavioralEvidenceItem(
  ownerId: string,
  payload: BehavioralEvidenceWritePayload,
  nowMs = Date.now(),
) {
  validateBehavioralEvidenceWrite(payload);
  const db = getDb();
  const { evidence, questionLink } = payload;
  const existing = await readEvidenceItem(ownerId, evidence.evidenceId);
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
  const existingLink = await readEvidenceLink(ownerId, questionLink.questionId, evidence.evidenceId);
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
    try {
      await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
    } catch (error) {
      const authoritativeEvidence = await readEvidenceItem(ownerId, evidence.evidenceId);
      if (!authoritativeEvidence) throw error;
      if (!evidenceIdentityMatches(authoritativeEvidence, evidence)) {
        throw new BehavioralEvidenceError(
          "behavioral_evidence_identity_conflict",
          "That evidence ID already belongs to different immutable content; supersession belongs to the later candidate-review slice.",
        );
      }
      let authoritativeLink = await readEvidenceLink(ownerId, questionLink.questionId, evidence.evidenceId);
      if (!authoritativeLink) {
        await db.insert(behavioralEvidenceQuestionLinks).values({
          ownerId,
          questionId: questionLink.questionId,
          evidenceId: evidence.evidenceId,
          relevance: questionLink.relevance,
          createdAt: nowMs,
          updatedAt: nowMs,
        }).onConflictDoNothing();
        authoritativeLink = await readEvidenceLink(ownerId, questionLink.questionId, evidence.evidenceId);
      }
      if (!authoritativeLink) throw error;
      if (authoritativeLink.relevance !== questionLink.relevance) {
        throw new BehavioralEvidenceError(
          "behavioral_evidence_link_conflict",
          "That evidence and question identity already has a different immutable relevance.",
        );
      }
      return {
        evidenceId: evidence.evidenceId,
        questionId: questionLink.questionId,
        relevance: questionLink.relevance,
        status: existing ? "linked" : "unchanged",
      };
    }
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
  if (new Set(rows.map((item) => item.projectKey)).size > 1) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_project_mismatch",
      "Every evidence item linked to one behavioral claim must describe the same project.",
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

const personalClaimScopes = ["personal_contribution", "ownership", "decision", "leadership"];
const isProbativeEvidence = (item: BehavioralEvidenceItemRow) => item.evidenceGrade !== "E0"
  && !["generated_secondary", "derived_inference"].includes(item.origin);

function enforceClaimStatusAndScope(claim: BehavioralClaimInput) {
  if (claim.status === "contradicted") {
    if (claim.claimStrength !== "contradicted") {
      throw new BehavioralEvidenceError(
        "behavioral_claim_status_strength_conflict",
        "A contradicted checkpoint must retain contradicted claim strength.",
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
  if ((personalClaimScopes.includes(claim.scope) && claim.claimStrength !== "personal_contribution_candidate")
      || (!personalClaimScopes.includes(claim.scope) && claim.claimStrength !== "project_fact")) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_scope_strength_conflict",
      "Verified claim scope and claim strength must describe the same project or personal authority boundary.",
    );
  }
}

function enforceClaimEvidenceQuality(
  claim: BehavioralClaimInput,
  accepted: BehavioralEvidenceItemRow[],
  acceptedContrary: BehavioralEvidenceItemRow[],
) {
  if (claim.status === "contradicted") {
    if (!acceptedContrary.some(isProbativeEvidence)) {
      throw new BehavioralEvidenceError(
        "behavioral_claim_contrary_evidence_required",
        "A contradicted claim requires accepted probative contrary evidence.",
      );
    }
    return;
  }
  if (claim.status !== "verified") return;
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
  const probative = accepted.filter(isProbativeEvidence);
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
  if ((personalClaimScopes.includes(claim.scope)
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

function enforceVerifiedClaimEvidence(claim: BehavioralClaimInput, evidence: BehavioralEvidenceItemRow[]) {
  const supporting = new Set(claim.evidenceIds);
  const contrary = new Set(claim.contraryEvidenceIds);
  const accepted = evidence.filter((item) => supporting.has(item.evidenceId) && item.candidateState === "accepted");
  const acceptedContrary = evidence.filter((item) => contrary.has(item.evidenceId) && item.candidateState === "accepted");
  enforceClaimStatusAndScope(claim);
  enforceClaimEvidenceQuality(claim, accepted, acceptedContrary);
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
  const [supportingRows, contraryRows, claimRows, storyResult] = await Promise.all([
    acceptedEvidenceQuery("supporting"),
    acceptedEvidenceQuery("contrary"),
    db.select().from(behavioralClaims).where(and(
      eq(behavioralClaims.ownerId, ownerId),
      eq(behavioralClaims.questionId, questionId),
    )).orderBy(asc(behavioralClaims.claimId)).limit(BEHAVIORAL_CLAIM_LIMIT + 1),
    queryBehavioralStories(ownerId, { questionId, limit: 3 }),
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
    storyCandidates: storyResult.stories,
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
      storyCandidates: storyResult.truncated,
    },
  };
}

const BEHAVIORAL_FOUNDATION_CLAIM_DETAIL_LIMIT = 50;

export async function getBehavioralFoundationStatus(ownerId: string) {
  const db = getDb();
  const [evidenceSummaryRows, claimSummaryRows, questionCoverageRows, claimDetailRows, storySummary] = await Promise.all([
    db.select({
      total: sql<number>`count(*)`,
      accepted: sql<number>`sum(case when ${behavioralEvidenceItems.candidateState} = 'accepted' then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${behavioralEvidenceItems.candidateState} = 'pending' then 1 else 0 end)`,
      rejected: sql<number>`sum(case when ${behavioralEvidenceItems.candidateState} = 'rejected' then 1 else 0 end)`,
      superseded: sql<number>`sum(case when ${behavioralEvidenceItems.candidateState} = 'superseded' then 1 else 0 end)`,
      projects: sql<number>`count(distinct ${behavioralEvidenceItems.projectKey})`,
      sourceRevisions: sql<number>`count(distinct ${behavioralEvidenceItems.sourceRevision})`,
      latestUpdatedAt: sql<number | null>`max(${behavioralEvidenceItems.updatedAt})`,
    }).from(behavioralEvidenceItems).where(eq(behavioralEvidenceItems.ownerId, ownerId)),
    db.select({
      total: sql<number>`count(*)`,
      unverified: sql<number>`sum(case when ${behavioralClaims.status} = 'unverified' then 1 else 0 end)`,
      partial: sql<number>`sum(case when ${behavioralClaims.status} = 'partial' then 1 else 0 end)`,
      verified: sql<number>`sum(case when ${behavioralClaims.status} = 'verified' then 1 else 0 end)`,
      contradicted: sql<number>`sum(case when ${behavioralClaims.status} = 'contradicted' then 1 else 0 end)`,
      questions: sql<number>`count(distinct ${behavioralClaims.questionId})`,
      latestUpdatedAt: sql<number | null>`max(${behavioralClaims.updatedAt})`,
    }).from(behavioralClaims).where(eq(behavioralClaims.ownerId, ownerId)),
    db.select({
      questionId: behavioralClaims.questionId,
      claims: sql<number>`count(*)`,
      verified: sql<number>`sum(case when ${behavioralClaims.status} = 'verified' then 1 else 0 end)`,
      contradicted: sql<number>`sum(case when ${behavioralClaims.status} = 'contradicted' then 1 else 0 end)`,
      gaps: sql<number>`sum(json_array_length(${behavioralClaims.gaps}))`,
    }).from(behavioralClaims)
      .where(eq(behavioralClaims.ownerId, ownerId))
      .groupBy(behavioralClaims.questionId)
      .orderBy(asc(behavioralClaims.questionId)),
    db.select({
      claimId: behavioralClaims.claimId,
      questionId: behavioralClaims.questionId,
      status: behavioralClaims.status,
      gaps: behavioralClaims.gaps,
      updatedAt: behavioralClaims.updatedAt,
    }).from(behavioralClaims)
      .where(eq(behavioralClaims.ownerId, ownerId))
      .orderBy(desc(behavioralClaims.updatedAt), asc(behavioralClaims.claimId))
      .limit(BEHAVIORAL_FOUNDATION_CLAIM_DETAIL_LIMIT + 1),
    getBehavioralStoryFoundationSummary(ownerId),
  ]);

  const evidenceSummary = evidenceSummaryRows[0] ?? {
    total: 0,
    accepted: 0,
    pending: 0,
    rejected: 0,
    superseded: 0,
    projects: 0,
    sourceRevisions: 0,
    latestUpdatedAt: null,
  };
  const claimSummary = claimSummaryRows[0] ?? {
    total: 0,
    unverified: 0,
    partial: 0,
    verified: 0,
    contradicted: 0,
    questions: 0,
    latestUpdatedAt: null,
  };
  const visibleClaimRows = claimDetailRows.slice(0, BEHAVIORAL_FOUNDATION_CLAIM_DETAIL_LIMIT);
  const allGaps: Array<{ claimId: string; questionId: string; text: string }> = [];
  for (const claim of visibleClaimRows) {
    const claimGaps = claim.gaps as string[];
    const gapSlots = Math.max(0, BEHAVIORAL_GAP_LIMIT + 1 - allGaps.length);
    allGaps.push(...claimGaps.slice(0, gapSlots).map((text) => ({
      claimId: claim.claimId,
      questionId: claim.questionId,
      text,
    })));
  }

  return {
    schemaVersion: 1 as const,
    evidence: {
      total: Number(evidenceSummary.total),
      accepted: Number(evidenceSummary.accepted ?? 0),
      pending: Number(evidenceSummary.pending ?? 0),
      rejected: Number(evidenceSummary.rejected ?? 0),
      superseded: Number(evidenceSummary.superseded ?? 0),
      projects: Number(evidenceSummary.projects),
      sourceRevisions: Number(evidenceSummary.sourceRevisions),
    },
    claims: {
      total: Number(claimSummary.total),
      unverified: Number(claimSummary.unverified ?? 0),
      partial: Number(claimSummary.partial ?? 0),
      verified: Number(claimSummary.verified ?? 0),
      contradicted: Number(claimSummary.contradicted ?? 0),
      questions: Number(claimSummary.questions),
    },
    questionCoverage: questionCoverageRows.map((row) => ({
      questionId: row.questionId,
      claims: Number(row.claims),
      verified: Number(row.verified ?? 0),
      contradicted: Number(row.contradicted ?? 0),
      gaps: Number(row.gaps ?? 0),
    })),
    gaps: allGaps.slice(0, BEHAVIORAL_GAP_LIMIT),
    stories: storySummary,
    capabilities: {
      evidenceRead: "available" as const,
      sourceRegistry: "not_available" as const,
      storyBank: "available" as const,
      resumeLibrary: "available" as const,
    },
    lastUpdatedAt: Math.max(
      Number(evidenceSummary.latestUpdatedAt ?? 0),
      Number(claimSummary.latestUpdatedAt ?? 0),
      Number(storySummary.lastUpdatedAt ?? 0),
    ) || null,
    limits: {
      claimDetails: BEHAVIORAL_FOUNDATION_CLAIM_DETAIL_LIMIT,
      gaps: BEHAVIORAL_GAP_LIMIT,
      stories: storySummary.limit,
    },
    truncated: {
      claimDetails: claimDetailRows.length > BEHAVIORAL_FOUNDATION_CLAIM_DETAIL_LIMIT,
      gaps: claimDetailRows.length > BEHAVIORAL_FOUNDATION_CLAIM_DETAIL_LIMIT || allGaps.length > BEHAVIORAL_GAP_LIMIT,
      stories: storySummary.truncated,
    },
  };
}

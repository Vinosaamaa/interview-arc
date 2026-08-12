import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import {
  assertCandidateReviewTransition,
  behavioralEvidenceCandidateQuerySchema,
  behavioralEvidenceCandidateReviewSchema,
  behavioralEvidenceSourceQuerySchema,
  behavioralEvidenceSourceSnapshotSchema,
  behavioralEvidenceSourceWriteSchema,
  BehavioralEvidenceReviewError,
  candidateReviewTargetState,
  type BehavioralEvidenceCandidateQuery,
  type BehavioralEvidenceSourceQuery,
  validateBehavioralEvidenceCandidateReview,
  validateBehavioralEvidenceSourceWrite,
} from "./behavioral-evidence-review-policy";
import { getDb } from "./index";
import {
  behavioralEvidenceItems,
  behavioralEvidenceQuestionLinks,
  behavioralEvidenceReviewEvents,
  behavioralEvidenceReviewOperations,
  behavioralEvidenceSourceOperations,
  behavioralEvidenceSourceRevisions,
  behavioralEvidenceSources,
} from "./schema";

export {
  behavioralEvidenceCandidateQuerySchema,
  behavioralEvidenceCandidateReviewSchema,
  behavioralEvidenceSourceQuerySchema,
  behavioralEvidenceSourceWriteSchema,
  BehavioralEvidenceReviewError,
};

const DEFAULT_SOURCE_LIMIT = 20;
const DEFAULT_CANDIDATE_LIMIT = 20;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function operationReceipt(row: { receipt: unknown }, duplicate: boolean) {
  return { ...(row.receipt as object), duplicate };
}

function parsedSourceRevision(row: { sourceId: string; revision: number; snapshot: unknown; createdAt: number }) {
  return {
    ...behavioralEvidenceSourceSnapshotSchema.parse(row.snapshot),
    sourceId: row.sourceId,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

export async function upsertBehavioralEvidenceSource(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = validateBehavioralEvidenceSourceWrite(inputValue);
  const db = getDb();
  const requestFingerprint = await sha256(JSON.stringify(input));
  const operationRows = await db.select().from(behavioralEvidenceSourceOperations).where(and(
    eq(behavioralEvidenceSourceOperations.ownerId, ownerId),
    eq(behavioralEvidenceSourceOperations.operationId, input.operationId),
  )).limit(1);
  if (operationRows[0]) {
    if (operationRows[0].requestFingerprint !== requestFingerprint) {
      throw new BehavioralEvidenceReviewError(
        "behavioral_evidence_source_operation_conflict",
        "This source operation ID already belongs to a different request.",
      );
    }
    return operationReceipt(operationRows[0], true);
  }

  const currentRows = await db.select().from(behavioralEvidenceSources).where(and(
    eq(behavioralEvidenceSources.ownerId, ownerId),
    eq(behavioralEvidenceSources.sourceId, input.source.sourceId),
  )).limit(1);
  const current = currentRows[0];
  const currentRevision = current?.currentRevision ?? 0;
  if (input.expectedRevision !== currentRevision) {
    throw new BehavioralEvidenceReviewError(
      "behavioral_evidence_source_revision_conflict",
      "The source snapshot changed; reread the registry before retrying.",
    );
  }
  const currentSnapshotRows = current
    ? await db.select({ snapshot: behavioralEvidenceSourceRevisions.snapshot })
      .from(behavioralEvidenceSourceRevisions).where(and(
        eq(behavioralEvidenceSourceRevisions.ownerId, ownerId),
        eq(behavioralEvidenceSourceRevisions.sourceId, input.source.sourceId),
        eq(behavioralEvidenceSourceRevisions.revision, currentRevision),
      )).limit(1)
    : [];
  const unchanged = currentSnapshotRows[0]
    ? JSON.stringify(behavioralEvidenceSourceSnapshotSchema.parse(currentSnapshotRows[0].snapshot)) === JSON.stringify(input.source)
    : false;
  const status = unchanged ? "unchanged" as const : current ? "revised" as const : "created" as const;
  const revision = unchanged ? currentRevision : currentRevision + 1;
  const receipt = { status, sourceId: input.source.sourceId, revision };
  const revisionCondition = current
    ? sql`EXISTS (
        SELECT 1 FROM ${behavioralEvidenceSources}
        WHERE ${behavioralEvidenceSources.ownerId} = ${ownerId}
          AND ${behavioralEvidenceSources.sourceId} = ${input.source.sourceId}
          AND ${behavioralEvidenceSources.currentRevision} = ${currentRevision}
      )`
    : sql`NOT EXISTS (
        SELECT 1 FROM ${behavioralEvidenceSources}
        WHERE ${behavioralEvidenceSources.ownerId} = ${ownerId}
          AND ${behavioralEvidenceSources.sourceId} = ${input.source.sourceId}
      )`;
  const statements = [d1TransactionalInvariantGuard(db, revisionCondition)];
  if (!unchanged) {
    statements.push(db.insert(behavioralEvidenceSourceRevisions).values({
      ownerId,
      sourceId: input.source.sourceId,
      revision,
      operationId: input.operationId,
      requestFingerprint,
      snapshot: input.source,
      createdAt: nowMs,
    }));
    statements.push(current
      ? db.update(behavioralEvidenceSources).set({
          currentRevision: revision,
          state: input.source.state,
          projectKey: input.source.projectKey,
          kind: input.source.kind,
          label: input.source.label,
          safeHint: input.source.safeHint,
          availability: input.source.availability,
          updatedAt: nowMs,
        }).where(and(
          eq(behavioralEvidenceSources.ownerId, ownerId),
          eq(behavioralEvidenceSources.sourceId, input.source.sourceId),
          eq(behavioralEvidenceSources.currentRevision, currentRevision),
        ))
      : db.insert(behavioralEvidenceSources).values({
          ownerId,
          sourceId: input.source.sourceId,
          currentRevision: revision,
          state: input.source.state,
          projectKey: input.source.projectKey,
          kind: input.source.kind,
          label: input.source.label,
          safeHint: input.source.safeHint,
          availability: input.source.availability,
          createdAt: nowMs,
          updatedAt: nowMs,
        }));
  }
  statements.push(db.insert(behavioralEvidenceSourceOperations).values({
    ownerId,
    operationId: input.operationId,
    sourceId: input.source.sourceId,
    requestFingerprint,
    sourceRevision: revision,
    status,
    receipt,
    createdAt: nowMs,
  }));
  try {
    await db.batch(statements as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const raced = await db.select().from(behavioralEvidenceSourceOperations).where(and(
      eq(behavioralEvidenceSourceOperations.ownerId, ownerId),
      eq(behavioralEvidenceSourceOperations.operationId, input.operationId),
    )).limit(1);
    if (raced[0]) {
      if (raced[0].requestFingerprint !== requestFingerprint) {
        throw new BehavioralEvidenceReviewError(
          "behavioral_evidence_source_operation_conflict",
          "This source operation ID already belongs to a different request.",
        );
      }
      return operationReceipt(raced[0], true);
    }
    const latest = await db.select({ currentRevision: behavioralEvidenceSources.currentRevision })
      .from(behavioralEvidenceSources).where(and(
        eq(behavioralEvidenceSources.ownerId, ownerId),
        eq(behavioralEvidenceSources.sourceId, input.source.sourceId),
      )).limit(1);
    if ((latest[0]?.currentRevision ?? 0) !== currentRevision) {
      throw new BehavioralEvidenceReviewError(
        "behavioral_evidence_source_revision_conflict",
        "The source snapshot changed; reread the registry before retrying.",
      );
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function queryBehavioralEvidenceSources(
  ownerId: string,
  inputValue: BehavioralEvidenceSourceQuery = {},
) {
  const input = behavioralEvidenceSourceQuerySchema.parse(inputValue);
  const db = getDb();
  const limit = input.limit ?? DEFAULT_SOURCE_LIMIT;
  if (input.sourceId) {
    const currentRows = await db.select().from(behavioralEvidenceSources).where(and(
      eq(behavioralEvidenceSources.ownerId, ownerId),
      eq(behavioralEvidenceSources.sourceId, input.sourceId),
    )).limit(1);
    const current = currentRows[0];
    if (!current || (!input.includeArchived && current.state === "archived")) {
      return { sources: [], truncated: false, limit };
    }
    const revisions = await db.select().from(behavioralEvidenceSourceRevisions).where(and(
      eq(behavioralEvidenceSourceRevisions.ownerId, ownerId),
      eq(behavioralEvidenceSourceRevisions.sourceId, input.sourceId),
      eq(behavioralEvidenceSourceRevisions.revision, input.revision ?? current.currentRevision),
    )).limit(1);
    return { sources: revisions[0] ? [parsedSourceRevision(revisions[0])] : [], truncated: false, limit };
  }
  const rows = await db.select({
    sourceId: behavioralEvidenceSourceRevisions.sourceId,
    revision: behavioralEvidenceSourceRevisions.revision,
    snapshot: behavioralEvidenceSourceRevisions.snapshot,
    createdAt: behavioralEvidenceSourceRevisions.createdAt,
  }).from(behavioralEvidenceSources).innerJoin(behavioralEvidenceSourceRevisions, and(
    eq(behavioralEvidenceSourceRevisions.ownerId, behavioralEvidenceSources.ownerId),
    eq(behavioralEvidenceSourceRevisions.sourceId, behavioralEvidenceSources.sourceId),
    eq(behavioralEvidenceSourceRevisions.revision, behavioralEvidenceSources.currentRevision),
  )).where(and(
    eq(behavioralEvidenceSources.ownerId, ownerId),
    input.includeArchived ? undefined : eq(behavioralEvidenceSources.state, "active"),
  )).orderBy(desc(behavioralEvidenceSources.updatedAt), desc(behavioralEvidenceSources.sourceId)).limit(limit + 1);
  return { sources: rows.slice(0, limit).map(parsedSourceRevision), truncated: rows.length > limit, limit };
}

export async function queryBehavioralEvidenceCandidates(
  ownerId: string,
  inputValue: BehavioralEvidenceCandidateQuery = {},
) {
  const input = behavioralEvidenceCandidateQuerySchema.parse(inputValue);
  const db = getDb();
  const limit = input.limit ?? DEFAULT_CANDIDATE_LIMIT;
  const state = input.state ?? "pending";
  const rows = await db.select().from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    eq(behavioralEvidenceItems.candidateState, state),
    input.projectKey ? eq(behavioralEvidenceItems.projectKey, input.projectKey) : undefined,
  )).orderBy(desc(behavioralEvidenceItems.updatedAt), desc(behavioralEvidenceItems.evidenceId)).limit(limit + 1);
  const visible = rows.slice(0, limit);
  const ids = visible.map((row) => row.evidenceId);
  const links = ids.length
    ? await db.select().from(behavioralEvidenceQuestionLinks).where(and(
        eq(behavioralEvidenceQuestionLinks.ownerId, ownerId),
        inArray(behavioralEvidenceQuestionLinks.evidenceId, ids),
      ))
    : [];
  const linksByEvidence = new Map<string, Array<{ questionId: string; relevance: "supporting" | "contrary" }>>();
  for (const link of links) {
    const current = linksByEvidence.get(link.evidenceId) ?? [];
    current.push({ questionId: link.questionId, relevance: link.relevance });
    linksByEvidence.set(link.evidenceId, current);
  }
  return {
    candidates: visible.map((row) => ({
      evidenceId: row.evidenceId,
      reviewRevision: row.reviewRevision,
      projectKey: row.projectKey,
      origin: row.origin,
      statement: row.statement,
      sourceRevision: row.sourceRevision,
      evidenceGrade: row.evidenceGrade,
      attributionGrade: row.attributionGrade,
      claimStrength: row.claimStrength,
      candidateState: row.candidateState,
      safeProvenance: row.safeProvenance,
      supports: row.supports,
      limitations: row.limitations,
      tags: row.tags,
      questionLinks: linksByEvidence.get(row.evidenceId) ?? [],
      updatedAt: row.updatedAt,
    })),
    truncated: rows.length > limit,
    limit,
  };
}

export async function reviewBehavioralEvidenceCandidates(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = validateBehavioralEvidenceCandidateReview(inputValue);
  const db = getDb();
  const requestFingerprint = await sha256(JSON.stringify(input));
  const operationRows = await db.select().from(behavioralEvidenceReviewOperations).where(and(
    eq(behavioralEvidenceReviewOperations.ownerId, ownerId),
    eq(behavioralEvidenceReviewOperations.operationId, input.operationId),
  )).limit(1);
  if (operationRows[0]) {
    if (operationRows[0].requestFingerprint !== requestFingerprint) {
      throw new BehavioralEvidenceReviewError(
        "behavioral_evidence_review_operation_conflict",
        "This review operation ID already belongs to a different decision batch.",
      );
    }
    return operationReceipt(operationRows[0], true);
  }

  const evidenceIds = input.decisions.map((decision) => decision.evidenceId);
  const replacementIds = input.decisions.flatMap((decision) => decision.replacementEvidenceId ?? []);
  const rows = await db.select().from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    inArray(behavioralEvidenceItems.evidenceId, [...new Set([...evidenceIds, ...replacementIds])]),
  ));
  const byId = new Map(rows.map((row) => [row.evidenceId, row]));
  const receipts = input.decisions.map((decision) => {
    const row = byId.get(decision.evidenceId);
    if (!row) {
      throw new BehavioralEvidenceReviewError(
        "behavioral_evidence_review_candidate_not_found",
        "A reviewed evidence candidate is unavailable for this owner.",
      );
    }
    if (row.reviewRevision !== decision.expectedRevision) {
      throw new BehavioralEvidenceReviewError(
        "behavioral_evidence_review_revision_conflict",
        "An evidence candidate changed; reread the candidate queue before retrying.",
      );
    }
    const candidateState = row.candidateState as "pending" | "accepted" | "rejected" | "superseded";
    const targetState = assertCandidateReviewTransition(candidateState, decision.decision);
    if (decision.replacementEvidenceId) {
      const replacement = byId.get(decision.replacementEvidenceId);
      if (!replacement
          || replacement.projectKey !== row.projectKey
          || !["pending", "accepted"].includes(replacement.candidateState)) {
        throw new BehavioralEvidenceReviewError(
          "behavioral_evidence_review_replacement_unavailable",
          "Supersession requires a same-owner replacement in the same project that is pending or accepted.",
        );
      }
    }
    return {
      evidenceId: decision.evidenceId,
      revision: decision.expectedRevision + 1,
      fromState: candidateState,
      state: targetState,
      replacementEvidenceId: decision.replacementEvidenceId ?? null,
    };
  });
  const receipt = { status: "reviewed" as const, decisions: receipts };
  const statements = [];
  for (const [index, decision] of input.decisions.entries()) {
    const result = receipts[index];
    statements.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${behavioralEvidenceItems}
      WHERE ${behavioralEvidenceItems.ownerId} = ${ownerId}
        AND ${behavioralEvidenceItems.evidenceId} = ${decision.evidenceId}
        AND ${behavioralEvidenceItems.reviewRevision} = ${decision.expectedRevision}
        AND ${behavioralEvidenceItems.candidateState} = ${result.fromState}
    )`));
    if (decision.replacementEvidenceId) {
      const projectKey = byId.get(decision.evidenceId)!.projectKey;
      statements.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${behavioralEvidenceItems}
        WHERE ${behavioralEvidenceItems.ownerId} = ${ownerId}
          AND ${behavioralEvidenceItems.evidenceId} = ${decision.replacementEvidenceId}
          AND ${behavioralEvidenceItems.projectKey} = ${projectKey}
          AND ${behavioralEvidenceItems.candidateState} IN ('pending', 'accepted')
      )`));
    }
    statements.push(db.update(behavioralEvidenceItems).set({
      candidateState: candidateReviewTargetState(decision.decision),
      reviewRevision: result.revision,
      updatedAt: nowMs,
    }).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      eq(behavioralEvidenceItems.evidenceId, decision.evidenceId),
      eq(behavioralEvidenceItems.reviewRevision, decision.expectedRevision),
      eq(behavioralEvidenceItems.candidateState, result.fromState),
    )));
    statements.push(db.insert(behavioralEvidenceReviewEvents).values({
      ownerId,
      evidenceId: decision.evidenceId,
      revision: result.revision,
      operationId: input.operationId,
      fromState: result.fromState,
      toState: result.state,
      reason: decision.reason,
      replacementEvidenceId: decision.replacementEvidenceId ?? null,
      createdAt: nowMs,
    }));
  }
  statements.push(db.insert(behavioralEvidenceReviewOperations).values({
    ownerId,
    operationId: input.operationId,
    requestFingerprint,
    receipt,
    createdAt: nowMs,
  }));
  try {
    await db.batch(statements as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const raced = await db.select().from(behavioralEvidenceReviewOperations).where(and(
      eq(behavioralEvidenceReviewOperations.ownerId, ownerId),
      eq(behavioralEvidenceReviewOperations.operationId, input.operationId),
    )).limit(1);
    if (raced[0]) {
      if (raced[0].requestFingerprint !== requestFingerprint) {
        throw new BehavioralEvidenceReviewError(
          "behavioral_evidence_review_operation_conflict",
          "This review operation ID already belongs to a different decision batch.",
        );
      }
      return operationReceipt(raced[0], true);
    }
    const latest = await db.select({
      evidenceId: behavioralEvidenceItems.evidenceId,
      reviewRevision: behavioralEvidenceItems.reviewRevision,
    }).from(behavioralEvidenceItems).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      inArray(behavioralEvidenceItems.evidenceId, evidenceIds),
    ));
    const latestById = new Map(latest.map((row) => [row.evidenceId, row.reviewRevision]));
    if (input.decisions.some((decision) => latestById.get(decision.evidenceId) !== decision.expectedRevision)) {
      throw new BehavioralEvidenceReviewError(
        "behavioral_evidence_review_revision_conflict",
        "An evidence candidate changed; reread the candidate queue before retrying.",
      );
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

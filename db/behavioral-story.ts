import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  behavioralClaims,
  behavioralEvidenceItems,
  behavioralStories,
  behavioralStoryOperations,
  behavioralStoryQuestionLinks,
  behavioralStoryRevisions,
} from "./schema";
import {
  behavioralStoryInputSchema,
  behavioralStoryQuerySchema,
  behavioralStoryWriteSchema,
  BehavioralStoryError,
  type BehavioralStoryInput,
  type BehavioralStoryQuery,
  validateBehavioralStoryWrite,
} from "./behavioral-story-policy";

export {
  behavioralStoryQuerySchema,
  behavioralStoryWriteSchema,
  BehavioralStoryError,
};

const DEFAULT_QUERY_LIMIT = 10;
const FOUNDATION_STORY_LIMIT = 6;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storyReceipt(row: { receipt: unknown }, duplicate: boolean) {
  return { ...(row.receipt as object), duplicate };
}

function parsedRevision(row: {
  storyId: string;
  revision: number;
  snapshot: unknown;
  createdAt: number;
}) {
  return {
    ...behavioralStoryInputSchema.parse(row.snapshot),
    storyId: row.storyId,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

async function assertStoryTruthLinks(ownerId: string, story: BehavioralStoryInput) {
  const db = getDb();
  const [evidenceRows, claimRows] = await Promise.all([
    db.select({
      evidenceId: behavioralEvidenceItems.evidenceId,
      projectKey: behavioralEvidenceItems.projectKey,
      candidateState: behavioralEvidenceItems.candidateState,
    }).from(behavioralEvidenceItems).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      inArray(behavioralEvidenceItems.evidenceId, story.evidenceIds),
    )),
    db.select({
      claimId: behavioralClaims.claimId,
      questionId: behavioralClaims.questionId,
      status: behavioralClaims.status,
      claimStrength: behavioralClaims.claimStrength,
      evidenceIds: behavioralClaims.evidenceIds,
      revision: behavioralClaims.revision,
    }).from(behavioralClaims).where(and(
      eq(behavioralClaims.ownerId, ownerId),
      inArray(behavioralClaims.claimId, story.claimIds),
    )),
  ]);
  if (evidenceRows.length !== story.evidenceIds.length
      || evidenceRows.some((row) => row.candidateState !== "accepted" || row.projectKey !== story.projectKey)) {
    throw new BehavioralStoryError(
      "behavioral_story_evidence_unavailable",
      "Every Story Bank evidence reference must resolve to accepted owner-private evidence in the same project.",
    );
  }
  if (claimRows.length !== story.claimIds.length
      || claimRows.some((row) => row.status === "contradicted"
        || ["unsupported", "contradicted"].includes(row.claimStrength)
        || !story.questionIds.includes(row.questionId))) {
    throw new BehavioralStoryError(
      "behavioral_story_claim_unavailable",
      "Every Story Bank claim must resolve to a non-contradicted owner-private claim linked to one of the story questions.",
    );
  }
  const linkedEvidence = new Set(claimRows.flatMap((row) => row.evidenceIds as string[]));
  if (story.evidenceIds.some((evidenceId) => !linkedEvidence.has(evidenceId))) {
    throw new BehavioralStoryError(
      "behavioral_story_evidence_claim_mismatch",
      "Every Story Bank evidence reference must support at least one selected claim.",
    );
  }
  return { claimRows };
}

function truthCondition(ownerId: string, story: BehavioralStoryInput, claimRows: Array<{
  claimId: string;
  revision: number;
}>) {
  const claimChecks = sql.join(claimRows.map((row) => sql`EXISTS (
    SELECT 1 FROM ${behavioralClaims}
    WHERE ${behavioralClaims.ownerId} = ${ownerId}
      AND ${behavioralClaims.claimId} = ${row.claimId}
      AND ${behavioralClaims.revision} = ${row.revision}
      AND ${behavioralClaims.status} <> 'contradicted'
  )`), sql` AND `);
  return sql`(
    SELECT count(*) FROM ${behavioralEvidenceItems}
    WHERE ${behavioralEvidenceItems.ownerId} = ${ownerId}
      AND ${behavioralEvidenceItems.evidenceId} IN ${story.evidenceIds}
      AND ${behavioralEvidenceItems.candidateState} = 'accepted'
      AND ${behavioralEvidenceItems.projectKey} = ${story.projectKey}
  ) = ${story.evidenceIds.length} AND ${claimChecks}`;
}

export async function upsertBehavioralStory(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = validateBehavioralStoryWrite(inputValue);
  const db = getDb();
  const fingerprint = await sha256(JSON.stringify(input));
  const operationRows = await db.select().from(behavioralStoryOperations).where(and(
    eq(behavioralStoryOperations.ownerId, ownerId),
    eq(behavioralStoryOperations.operationId, input.operationId),
  )).limit(1);
  if (operationRows[0]) {
    if (operationRows[0].requestFingerprint !== fingerprint) {
      throw new BehavioralStoryError(
        "behavioral_story_operation_conflict",
        "This Story Bank operation ID already belongs to a different request.",
      );
    }
    return storyReceipt(operationRows[0], true);
  }

  const truth = await assertStoryTruthLinks(ownerId, input.story);
  const currentRows = await db.select().from(behavioralStories).where(and(
    eq(behavioralStories.ownerId, ownerId),
    eq(behavioralStories.storyId, input.story.storyId),
  )).limit(1);
  const current = currentRows[0];
  const currentRevision = current?.currentRevision ?? 0;
  if (input.expectedRevision !== currentRevision) {
    throw new BehavioralStoryError(
      "behavioral_story_revision_conflict",
      "The Story Bank revision changed; reread it before retrying.",
    );
  }
  const currentRevisionRows = current
    ? await db.select({ snapshot: behavioralStoryRevisions.snapshot }).from(behavioralStoryRevisions).where(and(
      eq(behavioralStoryRevisions.ownerId, ownerId),
      eq(behavioralStoryRevisions.storyId, input.story.storyId),
      eq(behavioralStoryRevisions.revision, currentRevision),
    )).limit(1)
    : [];
  const unchanged = currentRevisionRows[0]
    ? JSON.stringify(behavioralStoryInputSchema.parse(currentRevisionRows[0].snapshot)) === JSON.stringify(input.story)
    : false;
  const revisionCondition = current
    ? sql`EXISTS (
        SELECT 1 FROM ${behavioralStories}
        WHERE ${behavioralStories.ownerId} = ${ownerId}
          AND ${behavioralStories.storyId} = ${input.story.storyId}
          AND ${behavioralStories.currentRevision} = ${currentRevision}
      )`
    : sql`NOT EXISTS (
        SELECT 1 FROM ${behavioralStories}
        WHERE ${behavioralStories.ownerId} = ${ownerId}
          AND ${behavioralStories.storyId} = ${input.story.storyId}
      )`;
  const status = unchanged ? "unchanged" as const : current ? "revised" as const : "created" as const;
  const revision = unchanged ? currentRevision : currentRevision + 1;
  const receipt = { status, storyId: input.story.storyId, revision };

  const statements = [
    d1TransactionalInvariantGuard(db, revisionCondition),
    d1TransactionalInvariantGuard(db, truthCondition(ownerId, input.story, truth.claimRows)),
  ];
  if (!unchanged) {
    statements.push(db.insert(behavioralStoryRevisions).values({
      ownerId,
      storyId: input.story.storyId,
      revision,
      operationId: input.operationId,
      requestFingerprint: fingerprint,
      snapshot: input.story,
      createdAt: nowMs,
    }));
    statements.push(current
      ? db.update(behavioralStories).set({
          currentRevision: revision,
          state: input.story.state,
          title: input.story.title,
          projectKey: input.story.projectKey,
          updatedAt: nowMs,
        }).where(and(
          eq(behavioralStories.ownerId, ownerId),
          eq(behavioralStories.storyId, input.story.storyId),
          eq(behavioralStories.currentRevision, currentRevision),
        ))
      : db.insert(behavioralStories).values({
          ownerId,
          storyId: input.story.storyId,
          currentRevision: revision,
          state: input.story.state,
          title: input.story.title,
          projectKey: input.story.projectKey,
          createdAt: nowMs,
          updatedAt: nowMs,
        }));
    statements.push(db.delete(behavioralStoryQuestionLinks).where(and(
      eq(behavioralStoryQuestionLinks.ownerId, ownerId),
      eq(behavioralStoryQuestionLinks.storyId, input.story.storyId),
    )));
    for (const questionId of input.story.questionIds) {
      statements.push(db.insert(behavioralStoryQuestionLinks).values({
        ownerId,
        storyId: input.story.storyId,
        questionId,
        storyRevision: revision,
        createdAt: nowMs,
      }));
    }
  }
  statements.push(db.insert(behavioralStoryOperations).values({
    ownerId,
    operationId: input.operationId,
    storyId: input.story.storyId,
    requestFingerprint: fingerprint,
    storyRevision: revision,
    status,
    receipt,
    createdAt: nowMs,
  }));
  try {
    await db.batch(statements as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const racedOperationRows = await db.select().from(behavioralStoryOperations).where(and(
      eq(behavioralStoryOperations.ownerId, ownerId),
      eq(behavioralStoryOperations.operationId, input.operationId),
    )).limit(1);
    if (racedOperationRows[0]) {
      if (racedOperationRows[0].requestFingerprint !== fingerprint) {
        throw new BehavioralStoryError(
          "behavioral_story_operation_conflict",
          "This Story Bank operation ID already belongs to a different request.",
        );
      }
      return storyReceipt(racedOperationRows[0], true);
    }
    const racedCurrentRows = await db.select({ currentRevision: behavioralStories.currentRevision })
      .from(behavioralStories).where(and(
        eq(behavioralStories.ownerId, ownerId),
        eq(behavioralStories.storyId, input.story.storyId),
      )).limit(1);
    if ((racedCurrentRows[0]?.currentRevision ?? 0) !== currentRevision) {
      throw new BehavioralStoryError(
        "behavioral_story_revision_conflict",
        "The Story Bank revision changed; reread it before retrying.",
      );
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function queryBehavioralStories(ownerId: string, inputValue: BehavioralStoryQuery = {}) {
  const input = behavioralStoryQuerySchema.parse(inputValue);
  const db = getDb();
  const limit = input.limit ?? DEFAULT_QUERY_LIMIT;
  if (input.storyId) {
    const currentRows = await db.select().from(behavioralStories).where(and(
      eq(behavioralStories.ownerId, ownerId),
      eq(behavioralStories.storyId, input.storyId),
    )).limit(1);
    const current = currentRows[0];
    if (!current || (!input.includeArchived && current.state === "archived")) {
      return { stories: [], truncated: false, limit };
    }
    const revisionRows = await db.select().from(behavioralStoryRevisions).where(and(
      eq(behavioralStoryRevisions.ownerId, ownerId),
      eq(behavioralStoryRevisions.storyId, input.storyId),
      eq(behavioralStoryRevisions.revision, input.revision ?? current.currentRevision),
    )).limit(1);
    return { stories: revisionRows[0] ? [parsedRevision(revisionRows[0])] : [], truncated: false, limit };
  }

  const query = input.questionId
    ? db.select({
        storyId: behavioralStoryRevisions.storyId,
        revision: behavioralStoryRevisions.revision,
        snapshot: behavioralStoryRevisions.snapshot,
        createdAt: behavioralStoryRevisions.createdAt,
      }).from(behavioralStoryQuestionLinks).innerJoin(behavioralStories, and(
        eq(behavioralStories.ownerId, behavioralStoryQuestionLinks.ownerId),
        eq(behavioralStories.storyId, behavioralStoryQuestionLinks.storyId),
        eq(behavioralStories.currentRevision, behavioralStoryQuestionLinks.storyRevision),
      )).innerJoin(behavioralStoryRevisions, and(
        eq(behavioralStoryRevisions.ownerId, behavioralStories.ownerId),
        eq(behavioralStoryRevisions.storyId, behavioralStories.storyId),
        eq(behavioralStoryRevisions.revision, behavioralStories.currentRevision),
      )).where(and(
        eq(behavioralStoryQuestionLinks.ownerId, ownerId),
        eq(behavioralStoryQuestionLinks.questionId, input.questionId),
        input.includeArchived ? undefined : eq(behavioralStories.state, "active"),
      )).orderBy(desc(behavioralStories.updatedAt), desc(behavioralStories.storyId)).limit(limit + 1)
    : db.select({
        storyId: behavioralStoryRevisions.storyId,
        revision: behavioralStoryRevisions.revision,
        snapshot: behavioralStoryRevisions.snapshot,
        createdAt: behavioralStoryRevisions.createdAt,
      }).from(behavioralStories).innerJoin(behavioralStoryRevisions, and(
        eq(behavioralStoryRevisions.ownerId, behavioralStories.ownerId),
        eq(behavioralStoryRevisions.storyId, behavioralStories.storyId),
        eq(behavioralStoryRevisions.revision, behavioralStories.currentRevision),
      )).where(and(
        eq(behavioralStories.ownerId, ownerId),
        input.includeArchived ? undefined : eq(behavioralStories.state, "active"),
      )).orderBy(desc(behavioralStories.updatedAt), desc(behavioralStories.storyId)).limit(limit + 1);
  const rows = await query;
  return { stories: rows.slice(0, limit).map(parsedRevision), truncated: rows.length > limit, limit };
}

export async function getBehavioralStoryFoundationSummary(ownerId: string) {
  const db = getDb();
  const [summaryRows, recent] = await Promise.all([
    db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when ${behavioralStories.state} = 'active' then 1 else 0 end)`,
      archived: sql<number>`sum(case when ${behavioralStories.state} = 'archived' then 1 else 0 end)`,
      projects: sql<number>`count(distinct ${behavioralStories.projectKey})`,
      latestUpdatedAt: sql<number | null>`max(${behavioralStories.updatedAt})`,
    }).from(behavioralStories).where(eq(behavioralStories.ownerId, ownerId)),
    queryBehavioralStories(ownerId, { limit: FOUNDATION_STORY_LIMIT }),
  ]);
  const summary = summaryRows[0];
  return {
    total: Number(summary?.total ?? 0),
    active: Number(summary?.active ?? 0),
    archived: Number(summary?.archived ?? 0),
    projects: Number(summary?.projects ?? 0),
    recent: recent.stories.map((story) => ({
      storyId: story.storyId,
      revision: story.revision,
      title: story.title,
      projectKey: story.projectKey,
      competencies: story.competencies,
      questionCount: story.questionIds.length,
      gapCount: story.gaps.length,
      updatedAt: story.createdAt,
    })),
    lastUpdatedAt: Number(summary?.latestUpdatedAt ?? 0) || null,
    limit: FOUNDATION_STORY_LIMIT,
    truncated: recent.truncated,
  };
}

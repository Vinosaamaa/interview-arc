import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { practiceDateAt } from "../app/practice-time";
import { getDb } from "./index";
import { sha256Hex } from "./integrations";
import { d1TransactionalInvariantGuard, isD1TransactionalInvariantFailure } from "./d1-transactional-guard";
import { readD1RowsInBatches } from "./d1-read-batching";
import {
  activityFinalizations,
  activitySolutionLinks,
  behavioralFinalAnswerSnapshots,
  extraActivities,
  leetcodeCodeAttempts,
  outcomes,
  practiceInteractionModeClassifications,
  practiceAssets,
  practiceAssetRevisions,
  practiceAssetSetOperations,
  practiceNotes,
  practiceRecordRevisions,
  practiceRecords,
  practiceTranscriptTurns,
  timers,
} from "./schema";
import type { PreparedPracticeAsset } from "./practice-assets";

const MAX_PRACTICE_RECORD_SEMANTIC_BYTES = 512 * 1_024;

export type PracticeResponseStage = {
  key: string;
  state: "answered" | "partially_answered" | "no_answer_provided" | "needs_correction";
  ownerResponse: string | null;
  mentorGuidance: string | null;
  finalUnderstanding: string | null;
  turnIds: string[];
};

export type PracticeRecordSemanticInput = {
  prompt: { body: string; canonicalUrl?: string | null };
  responseStages: PracticeResponseStage[];
  nextDrill?: string | null;
  assetSet?: { operationId: string; manifestSha256: string };
};

export type PracticeRecordPayload = {
  schemaVersion: 1;
  activityId: string;
  revision: number;
  questionId: string;
  specialty: "leetcode" | "system_design" | "behavioral";
  completedAt: string;
  practiceDate: string;
  practiceTimezone: "America/Los_Angeles";
  timing: {
    source: "website" | "manual" | "unknown";
    startedAt: string | null;
    endedAt: string | null;
    elapsedSeconds: number | null;
    sessionId: string | null;
  };
  outcome: "solved" | "solved_after_reviewing_approach" | "failed" | null;
  interactionMode: "interviewer" | "mentor" | "grill" | "mixed" | "unknown";
  prompt: { title: string; body: string; canonicalUrl: string | null };
  summary: string;
  transcript: {
    revision: number;
    turnCount: number;
    firstTurnId: string | null;
    lastTurnId: string | null;
  };
  notesRevision: number | null;
  specialtyOutput: {
    kind: "code_attempts" | "final_tailored_answer" | "your_design";
    responseStages: PracticeResponseStage[];
    codeAttemptIds: string[];
    finalAnswerRevision: number | null;
    designAssetIds: string[];
  };
  review: { didWell: string[]; improve: string[]; nextDrill: string | null };
  references: Array<{ title: string; url: string; accessedAt: string }>;
  solutionLink: { questionId: string; profileRevision: number };
  assetLinks: Array<{ assetId: string; revision: number; role: string }>;
  finalizationOperationId: string;
  createdAt: string;
};

export type PracticeRecordWriteReceipt = {
  revision: number;
  fingerprint: string;
  operationId: string;
  requestFingerprint: string;
  payload: PracticeRecordPayload;
  createdAt: number;
};

type FinalizationRecordInput = {
  title: string;
  summary?: string;
  review: { didWell: string[]; improve: string[] };
  references: Array<{ title: string; url: string; accessedAt: string }>;
  practiceRecord?: PracticeRecordSemanticInput;
};

function timingSource(value: unknown): "website" | "manual" | "unknown" {
  return value === "website" || value === "manual" ? value : "unknown";
}

function interactionMode(value: unknown): PracticeRecordPayload["interactionMode"] {
  if (value === "interviewer" || value === "mentor" || value === "grill" || value === "mixed") return value;
  return "unknown";
}

function specialtyOutputKind(specialty: PracticeRecordPayload["specialty"]): PracticeRecordPayload["specialtyOutput"]["kind"] {
  if (specialty === "leetcode") return "code_attempts";
  if (specialty === "behavioral") return "final_tailored_answer";
  return "your_design";
}

function exactIso(timestamp: number | null) {
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function assertResponseStageSemantics(stages: PracticeResponseStage[]) {
  const keys = new Set<string>();
  for (const stage of stages) {
    if (keys.has(stage.key)) throw new Error("Practice Record response-stage keys must be unique.");
    keys.add(stage.key);
    if (new Set(stage.turnIds).size !== stage.turnIds.length) {
      throw new Error("Practice Record response-stage turn IDs must be unique.");
    }
    const ownerResponse = stage.ownerResponse?.trim() || null;
    if (stage.state === "no_answer_provided" && ownerResponse !== null) {
      throw new Error("A no-answer Practice Record stage cannot claim an owner response.");
    }
    if (stage.state !== "no_answer_provided" && ownerResponse === null) {
      throw new Error("An answered Practice Record stage needs the owner's exact response.");
    }
    if ((ownerResponse || stage.mentorGuidance?.trim() || stage.finalUnderstanding?.trim()) && stage.turnIds.length === 0) {
      throw new Error("A material Practice Record response stage needs exact transcript turn IDs.");
    }
  }
}

function pointerMatchesPayload(
  pointer: typeof practiceRecords.$inferSelect,
  payload: PracticeRecordPayload,
) {
  return pointer.currentRevision === payload.revision
    && pointer.specialty === payload.specialty
    && pointer.questionId === payload.questionId
    && pointer.title === payload.prompt.title
    && pointer.completedAt === Date.parse(payload.completedAt)
    && pointer.practiceDate === payload.practiceDate
    && pointer.outcome === payload.outcome
    && pointer.solutionRevision === payload.solutionLink.profileRevision
    && pointer.finalizationOperationId === payload.finalizationOperationId;
}

async function resolveNamed<T extends Record<string, PromiseLike<unknown>>>(queries: T) {
  const entries = await Promise.all(Object.entries(queries).map(
    async ([key, query]) => [key, await query] as const,
  ));
  return Object.fromEntries(entries) as { [K in keyof T]: Awaited<T[K]> };
}

function loadPracticeRecordComponents(ownerId: string, activityId: string) {
  const db = getDb();
  return resolveNamed({
    activities: db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.id, activityId),
    )).limit(1),
    timers: db.select().from(timers).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, activityId),
      eq(timers.kind, "activity"),
    )).limit(1),
    outcomes: db.select().from(outcomes).where(and(
      eq(outcomes.ownerId, ownerId),
      eq(outcomes.activityId, activityId),
    )).limit(1),
    turns: db.select({ turnId: practiceTranscriptTurns.turnId }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
    )).orderBy(asc(practiceTranscriptTurns.sequence), asc(practiceTranscriptTurns.occurredAt)),
    noteCounts: db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(practiceNotes).where(and(
      eq(practiceNotes.ownerId, ownerId),
      eq(practiceNotes.activityId, activityId),
    )),
    classifications: db.select().from(practiceInteractionModeClassifications).where(and(
      eq(practiceInteractionModeClassifications.ownerId, ownerId),
      eq(practiceInteractionModeClassifications.activityId, activityId),
    )).orderBy(desc(practiceInteractionModeClassifications.snapshotRevision)).limit(1),
    codeAttempts: db.select({ id: leetcodeCodeAttempts.id }).from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, activityId),
    )).orderBy(asc(leetcodeCodeAttempts.sequence), asc(leetcodeCodeAttempts.occurredAt)),
    finalAnswers: db.select({ snapshotRevision: behavioralFinalAnswerSnapshots.snapshotRevision }).from(behavioralFinalAnswerSnapshots).where(and(
      eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
      eq(behavioralFinalAnswerSnapshots.activityId, activityId),
    )).orderBy(desc(behavioralFinalAnswerSnapshots.snapshotRevision)).limit(1),
    solutionLinks: db.select().from(activitySolutionLinks).where(and(
      eq(activitySolutionLinks.ownerId, ownerId),
      eq(activitySolutionLinks.activityId, activityId),
    )).limit(1),
    finalizations: db.select().from(activityFinalizations).where(and(
      eq(activityFinalizations.ownerId, ownerId),
      eq(activityFinalizations.activityId, activityId),
    )).limit(1),
    currentRecords: db.select().from(practiceRecords).where(and(
      eq(practiceRecords.ownerId, ownerId),
      eq(practiceRecords.activityId, activityId),
    )).limit(1),
  });
}

export async function assertPracticeRecordFinalizationPreconditions(input: {
  ownerId: string;
  activityId: string;
  finalization: FinalizationRecordInput;
}) {
  if (!input.finalization.practiceRecord) {
    throw new Error("A complete finalization needs the exact Practice Record prompt, response stages, and review sidecar.");
  }
  if (!input.finalization.summary?.trim()) {
    throw new Error("A complete Practice Record needs an attempt summary.");
  }
  const semanticBytes = new TextEncoder().encode(JSON.stringify({
    summary: input.finalization.summary,
    review: input.finalization.review,
    references: input.finalization.references,
    practiceRecord: input.finalization.practiceRecord,
  })).byteLength;
  if (semanticBytes > MAX_PRACTICE_RECORD_SEMANTIC_BYTES) {
    throw new Error("The Practice Record semantic packet exceeds its bounded byte limit.");
  }
  assertResponseStageSemantics(input.finalization.practiceRecord.responseStages);
  const db = getDb();
  const [activities, timerRows, outcomeRows, transcriptRows] = await Promise.all([
    db.select({ id: extraActivities.id }).from(extraActivities).where(and(
      eq(extraActivities.ownerId, input.ownerId),
      eq(extraActivities.id, input.activityId),
    )).limit(1),
    db.select({ completed: timers.completed, completedAt: timers.completedAt }).from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.subjectId, input.activityId),
      eq(timers.kind, "activity"),
    )).limit(1),
    db.select({ outcome: outcomes.outcome }).from(outcomes).where(and(
      eq(outcomes.ownerId, input.ownerId),
      eq(outcomes.activityId, input.activityId),
    )).limit(1),
    db.select({ turnId: practiceTranscriptTurns.turnId }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, input.ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
    )),
  ]);
  if (!activities[0]) throw new Error("A complete Practice Record needs authoritative owner-scoped activity metadata.");
  if (!timerRows[0]?.completed || timerRows[0].completedAt === null) {
    throw new Error("A complete Practice Record needs a finished activity timer.");
  }
  if (!outcomeRows[0]) throw new Error("A complete Practice Record needs an explicit activity outcome.");
  const transcriptTurnIds = new Set(transcriptRows.map((turn) => turn.turnId));
  const referencedTurnIds = input.finalization.practiceRecord.responseStages.flatMap((stage) => stage.turnIds);
  if (referencedTurnIds.some((turnId) => !transcriptTurnIds.has(turnId))) {
    throw new Error("Practice Record response stages may cite only turn IDs from that exact activity transcript.");
  }
}

async function readRevisionByOperation(ownerId: string, operationId: string) {
  const rows = await getDb().select().from(practiceRecordRevisions).where(and(
    eq(practiceRecordRevisions.ownerId, ownerId),
    eq(practiceRecordRevisions.operationId, operationId),
  )).limit(1);
  return rows[0] ?? null;
}

async function exactReceipt(
  ownerId: string,
  activityId: string,
  operationId: string,
  requestFingerprint: string,
  allowPending = false,
): Promise<PracticeRecordWriteReceipt | null> {
  const db = getDb();
  const revision = await readRevisionByOperation(ownerId, operationId);
  if (!revision) return null;
  if (revision.activityId !== activityId || revision.requestFingerprint !== requestFingerprint) {
    throw new Error("That finalization operation is already bound to different immutable Practice Record bytes.");
  }
  const [pointers, finalizations] = await Promise.all([
    db.select().from(practiceRecords).where(and(
      eq(practiceRecords.ownerId, ownerId),
      eq(practiceRecords.activityId, activityId),
    )).limit(1),
    db.select().from(activityFinalizations).where(and(
      eq(activityFinalizations.ownerId, ownerId),
      eq(activityFinalizations.activityId, activityId),
    )).limit(1),
  ]);
  const pointer = pointers[0];
  const finalization = finalizations[0];
  const payload = revision.payload as PracticeRecordPayload;
  const fingerprint = await sha256Hex(JSON.stringify(payload));
  const exactPendingFinalization = finalization?.status === "draft"
    && finalization.practiceRecordRevision === revision.revision
    && finalization.practiceRecordFingerprint === revision.recordFingerprint
    && finalization.finalizationOperationId === operationId
    && finalization.finalizationRequestFingerprint === requestFingerprint;
  if (!allowPending && exactPendingFinalization) return null;
  if (!pointer
      || !pointerMatchesPayload(pointer, payload)
      || pointer.recordFingerprint !== revision.recordFingerprint
      || pointer.finalizationOperationId !== operationId
      || payload.activityId !== activityId
      || payload.finalizationOperationId !== operationId
      || payload.revision !== revision.revision
      || fingerprint !== revision.recordFingerprint
      || (!allowPending && finalization?.status !== "ready")
      || (allowPending && !["draft", "ready"].includes(finalization?.status ?? ""))
      || finalization?.practiceRecordRevision !== revision.revision
      || finalization.practiceRecordFingerprint !== revision.recordFingerprint
      || finalization.finalizationOperationId !== operationId
      || finalization.finalizationRequestFingerprint !== requestFingerprint) {
    throw new Error("The immutable Practice Record pointer or finalization receipt failed exact readback.");
  }
  return {
    revision: revision.revision,
    fingerprint: revision.recordFingerprint,
    operationId,
    requestFingerprint,
    payload,
    createdAt: revision.createdAt,
  };
}

async function promotePendingPracticeRecord(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  requestFingerprint: string;
  revision: number;
  fingerprint: string;
  nowMs: number;
}) {
  const db = getDb();
  await db.batch([
    d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${activityFinalizations}
      WHERE ${activityFinalizations.ownerId} = ${input.ownerId}
        AND ${activityFinalizations.activityId} = ${input.activityId}
        AND ${activityFinalizations.status} = 'draft'
        AND ${activityFinalizations.finalizationOperationId} = ${input.operationId}
        AND ${activityFinalizations.finalizationRequestFingerprint} = ${input.requestFingerprint}
        AND ${activityFinalizations.practiceRecordRevision} = ${input.revision}
        AND ${activityFinalizations.practiceRecordFingerprint} = ${input.fingerprint}
    )`),
    db.update(activityFinalizations).set({
      status: "ready",
      updatedAt: input.nowMs,
    }).where(and(
      eq(activityFinalizations.ownerId, input.ownerId),
      eq(activityFinalizations.activityId, input.activityId),
    )),
  ] as unknown as Parameters<typeof db.batch>[0]);
}

export async function persistFinalizedPracticeRecord(input: {
  ownerId: string;
  activityId: string;
  specialty: PracticeRecordPayload["specialty"];
  questionId: string;
  finalization: FinalizationRecordInput;
  operationId: string;
  requestFingerprint: string;
  nowMs: number;
  preparedAssets?: PreparedPracticeAsset[];
  assetSetOperationId?: string;
  assetSetManifestSha256?: string;
  verifyPreparedAssets?: () => Promise<void>;
}): Promise<PracticeRecordWriteReceipt> {
  const prior = await exactReceipt(
    input.ownerId,
    input.activityId,
    input.operationId,
    input.requestFingerprint,
  );
  if (prior) return prior;
  const pending = await exactReceipt(
    input.ownerId,
    input.activityId,
    input.operationId,
    input.requestFingerprint,
    true,
  );
  if (pending) {
    if (!input.verifyPreparedAssets) {
      throw new Error("The pending Practice Record needs exact private-asset verification before promotion.");
    }
    await input.verifyPreparedAssets();
    await promotePendingPracticeRecord({
      ownerId: input.ownerId,
      activityId: input.activityId,
      operationId: input.operationId,
      requestFingerprint: input.requestFingerprint,
      revision: pending.revision,
      fingerprint: pending.fingerprint,
      nowMs: input.nowMs,
    });
    const promoted = await exactReceipt(input.ownerId, input.activityId, input.operationId, input.requestFingerprint);
    if (!promoted) throw new Error("The immutable Practice Record was not ready after private-asset promotion.");
    return promoted;
  }
  await assertPracticeRecordFinalizationPreconditions(input);

  const db = getDb();
  const components = await loadPracticeRecordComponents(input.ownerId, input.activityId);
  const activity = components.activities[0];
  const timer = components.timers[0];
  const outcome = components.outcomes[0];
  const solutionLink = components.solutionLinks[0];
  const finalization = components.finalizations[0];
  const current = components.currentRecords[0];
  if (!activity) throw new Error("A complete Practice Record needs authoritative owner-scoped activity metadata.");
  if (!timer?.completed || timer.completedAt === null) throw new Error("A complete Practice Record needs a finished activity timer.");
  if (!outcome) throw new Error("A complete Practice Record needs an explicit activity outcome.");
  if (!solutionLink || solutionLink.questionId !== input.questionId || solutionLink.specialty !== input.specialty) {
    throw new Error("A complete Practice Record needs the exact completion-time Solution Profile link.");
  }
  if (!finalization || finalization.status !== "draft") {
    throw new Error("The semantic finalization must remain pending until its immutable Practice Record is inserted.");
  }
  const activityPayload = activity.payload as Record<string, unknown>;
  const authoritativeTitle = typeof activityPayload.title === "string"
    ? activityPayload.title.trim()
    : "";
  if (!authoritativeTitle) {
    throw new Error("A complete Practice Record needs an authoritative activity title.");
  }
  const revision = (current?.currentRevision ?? 0) + 1;
  const preparedAssets = input.preparedAssets ?? [];
  const semanticRecord = input.finalization.practiceRecord!;
  const summary = input.finalization.summary!;
  if (preparedAssets.length > 0) {
    if (input.specialty !== "system_design"
        || !input.assetSetOperationId
        || !input.assetSetManifestSha256
        || !input.verifyPreparedAssets) {
      throw new Error("Prepared drawing assets require an exact System Design asset-set identity and verifier.");
    }
    if (new Set(preparedAssets.map((asset) => asset.assetId)).size !== preparedAssets.length
        || new Set(preparedAssets.map((asset) => asset.role)).size !== preparedAssets.length) {
      throw new Error("Prepared drawing assets must have unique stable IDs and roles.");
    }
  }
  const completedAt = timer.completedAt;
  const payload: PracticeRecordPayload = {
    schemaVersion: 1,
    activityId: input.activityId,
    revision,
    questionId: input.questionId,
    specialty: input.specialty,
    completedAt: new Date(completedAt).toISOString(),
    practiceDate: practiceDateAt(completedAt),
    practiceTimezone: "America/Los_Angeles",
    timing: {
      source: timingSource(activityPayload.timingSource),
      startedAt: exactIso(timer.startedAt),
      endedAt: exactIso(completedAt),
      elapsedSeconds: timer.accumulatedSeconds,
      sessionId: typeof activityPayload.sessionId === "string" ? activityPayload.sessionId : null,
    },
    outcome: outcome.outcome,
    interactionMode: interactionMode((components.classifications[0]?.classification as { primaryPracticeModeId?: unknown } | undefined)?.primaryPracticeModeId),
    prompt: {
      title: authoritativeTitle,
      body: semanticRecord.prompt.body,
      canonicalUrl: semanticRecord.prompt.canonicalUrl ?? null,
    },
    summary: summary.trim(),
    transcript: {
      revision: finalization.revision,
      turnCount: components.turns.length,
      firstTurnId: components.turns[0]?.turnId ?? null,
      lastTurnId: components.turns.at(-1)?.turnId ?? null,
    },
    notesRevision: components.noteCounts[0]?.count || null,
    specialtyOutput: {
      kind: specialtyOutputKind(input.specialty),
      responseStages: semanticRecord.responseStages,
      codeAttemptIds: components.codeAttempts.map((attempt) => attempt.id),
      finalAnswerRevision: components.finalAnswers[0]?.snapshotRevision ?? null,
      designAssetIds: preparedAssets.map((asset) => asset.assetId),
    },
    review: {
      didWell: input.finalization.review.didWell,
      improve: input.finalization.review.improve,
      nextDrill: semanticRecord.nextDrill ?? null,
    },
    references: input.finalization.references,
    solutionLink: {
      questionId: solutionLink.questionId,
      profileRevision: solutionLink.solutionRevision,
    },
    assetLinks: preparedAssets.map((asset) => ({
      assetId: asset.assetId,
      revision: asset.revision,
      role: asset.role,
    })),
    finalizationOperationId: input.operationId,
    createdAt: new Date(input.nowMs).toISOString(),
  };
  const fingerprint = await sha256Hex(JSON.stringify(payload));
  const currentCondition = current
    ? sql`EXISTS (
        SELECT 1 FROM ${practiceRecords}
        WHERE ${practiceRecords.ownerId} = ${input.ownerId}
          AND ${practiceRecords.activityId} = ${input.activityId}
          AND ${practiceRecords.currentRevision} = ${current.currentRevision}
          AND ${practiceRecords.recordFingerprint} = ${current.recordFingerprint}
      )`
    : sql`NOT EXISTS (
        SELECT 1 FROM ${practiceRecords}
        WHERE ${practiceRecords.ownerId} = ${input.ownerId}
          AND ${practiceRecords.activityId} = ${input.activityId}
      )`;
  const finalizationCondition = sql`EXISTS (
    SELECT 1 FROM ${activityFinalizations}
    WHERE ${activityFinalizations.ownerId} = ${input.ownerId}
      AND ${activityFinalizations.activityId} = ${input.activityId}
      AND ${activityFinalizations.status} = 'draft'
      AND ${activityFinalizations.revision} = ${finalization.revision}
      AND ${activityFinalizations.updatedAt} = ${finalization.updatedAt}
  )`;
  const assetSetCondition = preparedAssets.length > 0
    ? sql`EXISTS (
        SELECT 1 FROM ${practiceAssetSetOperations}
        WHERE ${practiceAssetSetOperations.ownerId} = ${input.ownerId}
          AND ${practiceAssetSetOperations.operationId} = ${input.assetSetOperationId!}
          AND ${practiceAssetSetOperations.activityId} = ${input.activityId}
          AND ${practiceAssetSetOperations.manifestSha256} = ${input.assetSetManifestSha256!}
          AND ${practiceAssetSetOperations.status} = 'staged'
      )`
    : sql`1 = 1`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, currentCondition),
      d1TransactionalInvariantGuard(db, finalizationCondition),
      d1TransactionalInvariantGuard(db, assetSetCondition),
      db.insert(practiceRecordRevisions).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        revision,
        operationId: input.operationId,
        requestFingerprint: input.requestFingerprint,
        recordFingerprint: fingerprint,
        payload,
        createdAt: input.nowMs,
      }),
      db.insert(practiceRecords).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        currentRevision: revision,
        specialty: input.specialty,
        questionId: input.questionId,
        title: authoritativeTitle,
        completedAt,
        practiceDate: payload.practiceDate,
        outcome: outcome.outcome,
        solutionRevision: solutionLink.solutionRevision,
        recordFingerprint: fingerprint,
        finalizationOperationId: input.operationId,
        updatedAt: input.nowMs,
      }).onConflictDoUpdate({
        target: [practiceRecords.ownerId, practiceRecords.activityId],
        set: {
          currentRevision: revision,
          specialty: input.specialty,
          questionId: input.questionId,
          title: authoritativeTitle,
          completedAt,
          practiceDate: payload.practiceDate,
          outcome: outcome.outcome,
          solutionRevision: solutionLink.solutionRevision,
          recordFingerprint: fingerprint,
          finalizationOperationId: input.operationId,
          updatedAt: input.nowMs,
        },
      }),
      ...preparedAssets.flatMap((asset) => [
        db.insert(practiceAssetRevisions).values({
          ownerId: input.ownerId,
          assetId: asset.assetId,
          revision: asset.revision,
          activityId: input.activityId,
          questionId: input.questionId,
          practiceRecordRevision: revision,
          role: asset.role,
          mimeType: asset.mimeType,
          sha256: asset.sha256,
          byteSize: asset.byteSize,
          privateLocator: asset.privateLocator,
          altText: asset.altText,
          authorship: asset.authorship,
          createdAt: input.nowMs,
        }),
        db.insert(practiceAssets).values({
          ownerId: input.ownerId,
          assetId: asset.assetId,
          activityId: input.activityId,
          currentRevision: asset.revision,
          role: asset.role,
          updatedAt: input.nowMs,
        }).onConflictDoUpdate({
          target: [practiceAssets.ownerId, practiceAssets.assetId],
          set: {
            activityId: input.activityId,
            currentRevision: asset.revision,
            role: asset.role,
            updatedAt: input.nowMs,
          },
        }),
      ]),
      ...(preparedAssets.length > 0 ? [db.update(practiceAssetSetOperations).set({
        status: "bound",
        practiceRecordRevision: revision,
        updatedAt: input.nowMs,
      }).where(and(
        eq(practiceAssetSetOperations.ownerId, input.ownerId),
        eq(practiceAssetSetOperations.operationId, input.assetSetOperationId!),
      ))] : []),
      db.update(activityFinalizations).set({
        status: preparedAssets.length > 0 ? "draft" : "ready",
        finalizationOperationId: input.operationId,
        finalizationRequestFingerprint: input.requestFingerprint,
        practiceRecordRevision: revision,
        practiceRecordFingerprint: fingerprint,
        updatedAt: input.nowMs,
      }).where(and(
        eq(activityFinalizations.ownerId, input.ownerId),
        eq(activityFinalizations.activityId, input.activityId),
      )),
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const settled = await exactReceipt(
      input.ownerId,
      input.activityId,
      input.operationId,
      input.requestFingerprint,
    );
    if (settled) return settled;
    if (isD1TransactionalInvariantFailure(error)) {
      throw new Error("The Practice Record or finalization pointer changed during immutable insertion; reread before retrying.");
    }
    throw error;
  }
  const inserted = await exactReceipt(
    input.ownerId,
    input.activityId,
    input.operationId,
    input.requestFingerprint,
    preparedAssets.length > 0,
  );
  if (!inserted) throw new Error("The immutable Practice Record was not readable after insertion.");
  if (preparedAssets.length > 0) {
    await input.verifyPreparedAssets!();
    await promotePendingPracticeRecord({
      ownerId: input.ownerId,
      activityId: input.activityId,
      operationId: input.operationId,
      requestFingerprint: input.requestFingerprint,
      revision: inserted.revision,
      fingerprint: inserted.fingerprint,
      nowMs: input.nowMs,
    });
  }
  const receipt = await exactReceipt(input.ownerId, input.activityId, input.operationId, input.requestFingerprint);
  if (!receipt) throw new Error("The immutable Practice Record was not ready after exact readback.");
  return receipt;
}

export async function readCurrentPracticeRecord(ownerId: string, activityId: string) {
  const db = getDb();
  const pointers = await db.select().from(practiceRecords).where(and(
    eq(practiceRecords.ownerId, ownerId),
    eq(practiceRecords.activityId, activityId),
  )).limit(1);
  const pointer = pointers[0];
  if (!pointer) return null;
  const revisions = await db.select().from(practiceRecordRevisions).where(and(
    eq(practiceRecordRevisions.ownerId, ownerId),
    eq(practiceRecordRevisions.activityId, activityId),
    eq(practiceRecordRevisions.revision, pointer.currentRevision),
  )).limit(1);
  const revision = revisions[0];
  if (!revision) {
    throw new Error("The current Practice Record pointer does not resolve to its exact immutable revision.");
  }
  const payload = revision.payload as PracticeRecordPayload;
  const fingerprint = await sha256Hex(JSON.stringify(payload));
  if (revision.recordFingerprint !== pointer.recordFingerprint
      || fingerprint !== revision.recordFingerprint
      || payload.activityId !== activityId
      || !pointerMatchesPayload(pointer, payload)) {
    throw new Error("The current Practice Record pointer does not resolve to its exact immutable revision.");
  }
  return {
    revision: revision.revision,
    fingerprint: revision.recordFingerprint,
    operationId: revision.operationId,
    requestFingerprint: revision.requestFingerprint,
    payload,
    createdAt: revision.createdAt,
  };
}

export async function readCurrentPracticeRecordActivityIds(ownerId: string, activityIds: readonly string[]) {
  const db = getDb();
  const rows = await readD1RowsInBatches(activityIds, (batch) => db
    .select({ activityId: practiceRecords.activityId })
    .from(practiceRecords)
    .innerJoin(practiceRecordRevisions, and(
      eq(practiceRecordRevisions.ownerId, practiceRecords.ownerId),
      eq(practiceRecordRevisions.activityId, practiceRecords.activityId),
      eq(practiceRecordRevisions.revision, practiceRecords.currentRevision),
      eq(practiceRecordRevisions.recordFingerprint, practiceRecords.recordFingerprint),
    ))
    .where(and(
      eq(practiceRecords.ownerId, ownerId),
      inArray(practiceRecords.activityId, batch),
    )));
  return new Set(rows.map((row) => row.activityId));
}

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  activityAudioClips,
  activityDeliveryAnalyses,
  activityFinalizations,
  activityNotes,
  extraActivities,
  focusBlocks,
  leetcodeCodeAttempts,
  liveMutationReceipts,
  liveSessions,
  outcomes,
  practiceFocus,
  practiceNotes,
  practiceTranscriptTurns,
  practiceWorkbenches,
  publicationStatuses,
  reviewSchedules,
  timerIntervals,
  timers,
  todayPlanningMutations,
  voiceCaptureIntents,
} from "./schema";
import { ensureOpenWorkbench } from "./live-state";
import {
  d1TransactionalInvariantGuard,
  isD1TransactionalInvariantFailure,
} from "./d1-transactional-guard";
import {
  buildPlanningBatch,
  plannedActivityRemovalIdentity,
  planningRequestFingerprint,
  type PlanningSelection,
} from "./today-planning-policy";

export class TodayPlanningConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TodayPlanningConflictError";
    this.code = code;
  }
}

export type AddPlanningSelectionInput = {
  date: string;
  workbenchId: string;
  expectedWorkbenchRevision?: number;
  mutationId: string;
  destination: "standalone" | "session";
  sessionNumber: number;
  selections: PlanningSelection[];
  specialistRequestHash?: string;
};

export type RemovePlannedActivitiesInput = {
  date: string;
  expectedWorkbenchId: string;
  expectedWorkbenchRevision: number;
  mutationId: string;
  activityIds: string[];
  legacyRouteRevisionless?: boolean;
};

export type PlannedActivityRemovalRejection = {
  activityId: string;
  code:
    | "not_in_current_workbench"
    | "timer_started"
    | "result_exists"
    | "transcript_or_capture_exists"
    | "code_attempt_exists"
    | "note_exists"
    | "review_exists"
    | "publication_exists";
  reason: string;
};

function nextWorkbenchRevision(current: number, now: number) {
  return Math.max(current + 1, now);
}

export async function readPlanningMutation(
  ownerId: string,
  mutationId: string,
) {
  const rows = await getDb()
    .select()
    .from(todayPlanningMutations)
    .where(and(
      eq(todayPlanningMutations.ownerId, ownerId),
      eq(todayPlanningMutations.mutationId, mutationId),
    ));
  return rows[0] ?? null;
}

export async function rememberPlanningMutation(
  ownerId: string,
  input: {
    mutationId: string;
    workbenchId: string;
    requestHash: string;
    response: unknown;
    createdAt: number;
  },
) {
  await getDb().insert(todayPlanningMutations).values({
    ownerId,
    mutationId: input.mutationId,
    workbenchId: input.workbenchId,
    requestHash: input.requestHash,
    response: input.response,
    createdAt: input.createdAt,
  }).onConflictDoNothing();
}

export async function applyPlanningSelection(
  ownerId: string,
  input: AddPlanningSelectionInput,
  now = Date.now(),
  preflightReceipt?: Awaited<ReturnType<typeof readPlanningMutation>>,
) {
  const requestHash = await planningRequestFingerprint(input);
  const existingReceipt = preflightReceipt === undefined
    ? await readPlanningMutation(ownerId, input.mutationId)
    : preflightReceipt;
  if (existingReceipt) {
    if (existingReceipt.requestHash !== requestHash) {
      throw new TodayPlanningConflictError(
        "planning_mutation_identity_conflict",
        "That planning mutation identifier was already used for different content.",
      );
    }
    return { duplicate: true, result: existingReceipt.response };
  }

  const workbench = await ensureOpenWorkbench(ownerId, input.date, now);
  if (workbench.id !== input.workbenchId) {
    throw new TodayPlanningConflictError(
      "stale_workbench",
      "Today changed in another surface. Refresh the planner and review the selection.",
    );
  }
  if (
    input.expectedWorkbenchRevision != null
    && workbench.revision !== input.expectedWorkbenchRevision
  ) {
    throw new TodayPlanningConflictError(
      "stale_workbench_revision",
      `Today changed in another surface. Refresh from authoritative revision ${workbench.revision}.`,
    );
  }

  const db = getDb();
  const [currentActivities, currentFocusBlocks] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, workbench.id),
    )),
    db.select().from(focusBlocks).where(and(
      eq(focusBlocks.ownerId, ownerId),
      eq(focusBlocks.workbenchId, workbench.id),
    )),
  ]);
  const questionIds = new Set(currentActivities.flatMap((row) => {
    const questionId = (row.payload as { questionId?: unknown }).questionId;
    return typeof questionId === "string" ? [questionId] : [];
  }));
  const normalizedTitles = new Set([
    ...currentActivities.map((row) => (
      String((row.payload as { title?: unknown }).title ?? "").trim().toLowerCase()
    )),
    ...currentFocusBlocks.map((row) => row.title.trim().toLowerCase()),
  ]);
  for (const selection of input.selections) {
    if (
      selection.kind === "practice"
      && selection.questionId
      && questionIds.has(selection.questionId)
    ) {
      throw new TodayPlanningConflictError(
        "already_planned",
        `${selection.title} is already on Today.`,
      );
    }
    if (normalizedTitles.has(selection.title.trim().toLowerCase())) {
      throw new TodayPlanningConflictError(
        "already_planned",
        `${selection.title} is already on Today.`,
      );
    }
  }

  const built = buildPlanningBatch(input);
  const resultingWorkbenchRevision = nextWorkbenchRevision(workbench.revision, now);
  const response = {
    mutationId: input.mutationId,
    workbenchId: workbench.id,
    activityIds: built.activities.map((activity) => activity.id),
    focusBlockIds: built.focusBlocks.map((block) => block.id),
    sessionId: built.session?.id ?? null,
    resultingWorkbenchRevision,
    ...(input.specialistRequestHash
      ? { specialistRequestHash: input.specialistRequestHash }
      : {}),
  };
  const statements = [
    d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${practiceWorkbenches}
      WHERE ${practiceWorkbenches.ownerId} = ${ownerId}
        AND ${practiceWorkbenches.id} = ${workbench.id}
        AND ${practiceWorkbenches.status} = 'open'
        AND ${practiceWorkbenches.updatedAt} = ${workbench.revision}
    )`),
    ...built.activities.map((activity) => db.insert(extraActivities).values({
      ownerId,
      id: activity.id,
      date: input.date,
      workbenchId: workbench.id,
      payload: { ...activity, workbenchId: workbench.id },
      revision: 1,
      updatedAt: now,
    }).onConflictDoNothing()),
    ...built.focusBlocks.map((block) => db.insert(focusBlocks).values({
      ownerId,
      id: block.id,
      workbenchId: workbench.id,
      date: block.date,
      category: block.focusCategory,
      title: block.title,
      plannedSeconds: block.plannedSeconds,
      note: block.note ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()),
    ...(built.session ? [db.insert(liveSessions).values({
      ownerId,
      id: built.session.id,
      date: input.date,
      workbenchId: workbench.id,
      payload: built.session,
      revision: 1,
      updatedAt: now,
    }).onConflictDoNothing()] : []),
    db.update(practiceWorkbenches).set({
      updatedAt: resultingWorkbenchRevision,
    }).where(and(
      eq(practiceWorkbenches.ownerId, ownerId),
      eq(practiceWorkbenches.id, workbench.id),
      eq(practiceWorkbenches.updatedAt, workbench.revision),
    )),
    db.insert(todayPlanningMutations).values({
      ownerId,
      mutationId: input.mutationId,
      workbenchId: workbench.id,
      requestHash,
      response,
      createdAt: now,
    }).onConflictDoNothing(),
  ];
  try {
    await db.batch(statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ]);
  } catch (error) {
    const receipt = await readPlanningMutation(ownerId, input.mutationId);
    if (receipt) {
      if (receipt.requestHash === requestHash) {
        return { duplicate: true, result: receipt.response };
      }
      throw new TodayPlanningConflictError(
        "planning_mutation_identity_conflict",
        "That planning mutation identifier was already used for different content.",
      );
    }
    if (isD1TransactionalInvariantFailure(error)) {
      throw new TodayPlanningConflictError(
        "stale_workbench_revision",
        "Today changed while the selection was being added. Refresh before retrying.",
      );
    }
    throw error;
  }
  return { duplicate: false, result: response };
}

export async function removePlannedActivities(
  ownerId: string,
  input: RemovePlannedActivitiesInput,
  now = Date.now(),
) {
  const activityIds = [...new Set(input.activityIds)];
  if (activityIds.length !== input.activityIds.length) {
    throw new TodayPlanningConflictError(
      "duplicate_activity_id",
      "Each planned activity ID may appear only once.",
    );
  }
  const requestHash = await planningRequestFingerprint(plannedActivityRemovalIdentity({
    ...input,
    activityIds,
  }));
  const existingReceipt = await readPlanningMutation(ownerId, input.mutationId);
  if (existingReceipt) {
    if (existingReceipt.requestHash !== requestHash) {
      throw new TodayPlanningConflictError(
        "planning_mutation_identity_conflict",
        "That removal mutation identifier was already used for different content.",
      );
    }
    return { duplicate: true, result: existingReceipt.response };
  }

  const workbench = await ensureOpenWorkbench(ownerId, input.date, now);
  if (workbench.id !== input.expectedWorkbenchId) {
    throw new TodayPlanningConflictError(
      "stale_workbench",
      "Today changed in another surface. Refresh before removing planned activities.",
    );
  }
  if (workbench.revision !== input.expectedWorkbenchRevision) {
    throw new TodayPlanningConflictError(
      "stale_workbench_revision",
      `Today changed in another surface. Refresh from authoritative revision ${workbench.revision}.`,
    );
  }

  const db = getDb();
  const currentRows = await db.select().from(extraActivities).where(and(
    eq(extraActivities.ownerId, ownerId),
    eq(extraActivities.workbenchId, workbench.id),
    inArray(extraActivities.id, activityIds),
  ));
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const currentIds = [...currentById.keys()];
  const [
    timerRows,
    outcomeRows,
    publicationRows,
    transcriptRows,
    finalizationRows,
    audioRows,
    activityNoteRows,
    practiceNoteRows,
    deliveryRows,
    reviewRows,
    intervalRows,
    attemptRows,
    captureRows,
    liveReceiptRows,
    sessionRows,
  ] = currentIds.length ? await Promise.all([
    db.select({ activityId: timers.subjectId }).from(timers).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.kind, "activity"),
      inArray(timers.subjectId, currentIds),
      isNotNull(timers.startedAt),
    )),
    db.select({ activityId: outcomes.activityId }).from(outcomes).where(and(eq(outcomes.ownerId, ownerId), inArray(outcomes.activityId, currentIds))),
    db.select({ activityId: publicationStatuses.activityId }).from(publicationStatuses).where(and(eq(publicationStatuses.ownerId, ownerId), inArray(publicationStatuses.activityId, currentIds))),
    db.select({ activityId: practiceTranscriptTurns.activityId }).from(practiceTranscriptTurns).where(and(eq(practiceTranscriptTurns.ownerId, ownerId), inArray(practiceTranscriptTurns.activityId, currentIds))),
    db.select({ activityId: activityFinalizations.activityId }).from(activityFinalizations).where(and(eq(activityFinalizations.ownerId, ownerId), inArray(activityFinalizations.activityId, currentIds))),
    db.select({ activityId: activityAudioClips.activityId }).from(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), inArray(activityAudioClips.activityId, currentIds))),
    db.select({ activityId: activityNotes.activityId }).from(activityNotes).where(and(eq(activityNotes.ownerId, ownerId), inArray(activityNotes.activityId, currentIds))),
    db.select({ activityId: practiceNotes.activityId }).from(practiceNotes).where(and(eq(practiceNotes.ownerId, ownerId), inArray(practiceNotes.activityId, currentIds))),
    db.select({ activityId: activityDeliveryAnalyses.activityId }).from(activityDeliveryAnalyses).where(and(eq(activityDeliveryAnalyses.ownerId, ownerId), inArray(activityDeliveryAnalyses.activityId, currentIds))),
    db.select({ activityId: reviewSchedules.activityId }).from(reviewSchedules).where(and(eq(reviewSchedules.ownerId, ownerId), inArray(reviewSchedules.activityId, currentIds))),
    db.select({ activityId: timerIntervals.subjectId }).from(timerIntervals).where(and(eq(timerIntervals.ownerId, ownerId), eq(timerIntervals.kind, "activity"), inArray(timerIntervals.subjectId, currentIds))),
    db.select({ activityId: leetcodeCodeAttempts.activityId }).from(leetcodeCodeAttempts).where(and(eq(leetcodeCodeAttempts.ownerId, ownerId), inArray(leetcodeCodeAttempts.activityId, currentIds))),
    db.select({ activityId: voiceCaptureIntents.activityId }).from(voiceCaptureIntents).where(and(eq(voiceCaptureIntents.ownerId, ownerId), inArray(voiceCaptureIntents.activityId, currentIds))),
    db.select({ activityId: liveMutationReceipts.activityId }).from(liveMutationReceipts).where(and(eq(liveMutationReceipts.ownerId, ownerId), inArray(liveMutationReceipts.activityId, currentIds))),
    db.select().from(liveSessions).where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.workbenchId, workbench.id))),
  ]) : [[], [], [], [], [], [], [], [], [], [], [], [], [], [], []];

  const ids = (rows: Array<{ activityId: string }>) => new Set(rows.map((row) => row.activityId));
  const blockers = {
    timer: ids(timerRows),
    result: ids(outcomeRows),
    publication: new Set([
      ...ids(publicationRows),
      ...ids(finalizationRows),
    ]),
    transcript: new Set([
      ...ids(transcriptRows),
      ...ids(audioRows),
      ...ids(deliveryRows),
      ...ids(captureRows),
      ...ids(intervalRows),
      ...ids(liveReceiptRows),
    ]),
    attempt: ids(attemptRows),
    note: new Set([
      ...ids(activityNoteRows),
      ...ids(practiceNoteRows),
    ]),
    review: ids(reviewRows),
  };
  const rejected: PlannedActivityRemovalRejection[] = [];
  const deletedIds: string[] = [];
  for (const activityId of activityIds) {
    let code: PlannedActivityRemovalRejection["code"] | null = null;
    let reason = "";
    if (!currentById.has(activityId)) {
      code = "not_in_current_workbench";
      reason = "The activity is not an owner-scoped row in the current workbench.";
    } else if (blockers.timer.has(activityId)) {
      code = "timer_started";
      reason = "Started time stays in practice history.";
    } else if (blockers.result.has(activityId)) {
      code = "result_exists";
      reason = "An activity with a saved result cannot be removed as an untouched plan row.";
    } else if (blockers.transcript.has(activityId)) {
      code = "transcript_or_capture_exists";
      reason = "Transcript, capture, audio, delivery, or recorded interval evidence exists.";
    } else if (blockers.attempt.has(activityId)) {
      code = "code_attempt_exists";
      reason = "A saved Code Attempt must remain in practice history.";
    } else if (blockers.note.has(activityId)) {
      code = "note_exists";
      reason = "A saved note must remain in practice history.";
    } else if (blockers.review.has(activityId)) {
      code = "review_exists";
      reason = "A scheduled review must remain linked to its activity.";
    } else if (blockers.publication.has(activityId)) {
      code = "publication_exists";
      reason = "Publication or finalization state must remain in practice history.";
    }
    if (code) rejected.push({ activityId, code, reason });
    else deletedIds.push(activityId);
  }

  const resultingWorkbenchRevision = deletedIds.length
    ? nextWorkbenchRevision(workbench.revision, now)
    : workbench.revision;
  const response = {
    operationId: input.mutationId,
    workbenchId: workbench.id,
    expectedWorkbenchRevision: input.expectedWorkbenchRevision,
    resultingWorkbenchRevision,
    deletedIds,
    rejected,
  };
  if (!deletedIds.length) {
    await rememberPlanningMutation(ownerId, {
      mutationId: input.mutationId,
      workbenchId: workbench.id,
      requestHash,
      response,
      createdAt: now,
    });
    return { duplicate: false, result: response };
  }

  const deleting = inArray(extraActivities.id, deletedIds);
  const deletedIdSet = new Set(deletedIds);
  const affectedSessions = sessionRows.flatMap((row) => {
    const payload = row.payload as { activityIds?: unknown; allocatedSeconds?: unknown } & Record<string, unknown>;
    if (!Array.isArray(payload.activityIds) || !payload.activityIds.some((id) => deletedIdSet.has(String(id)))) return [];
    const removedSeconds = payload.activityIds.reduce((total, id) => {
      if (!deletedIdSet.has(String(id))) return total;
      const activity = currentById.get(String(id))?.payload as { allocatedSeconds?: unknown } | undefined;
      return total + (typeof activity?.allocatedSeconds === "number" ? activity.allocatedSeconds : 0);
    }, 0);
    return [{
      row,
      payload: {
        ...payload,
        activityIds: payload.activityIds.filter((id) => !deletedIdSet.has(String(id))),
        ...(typeof payload.allocatedSeconds === "number"
          ? { allocatedSeconds: Math.max(0, payload.allocatedSeconds - removedSeconds) }
          : {}),
      },
    }];
  });
  const guards = [
    d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${practiceWorkbenches}
      WHERE ${practiceWorkbenches.ownerId} = ${ownerId}
        AND ${practiceWorkbenches.id} = ${workbench.id}
        AND ${practiceWorkbenches.status} = 'open'
        AND ${practiceWorkbenches.updatedAt} = ${workbench.revision}
    )`),
    d1TransactionalInvariantGuard(db, sql`(
      SELECT COUNT(*) FROM ${extraActivities}
      WHERE ${extraActivities.ownerId} = ${ownerId}
        AND ${extraActivities.workbenchId} = ${workbench.id}
        AND ${deleting}
    ) = ${deletedIds.length}`),
    d1TransactionalInvariantGuard(db, sql`
      NOT EXISTS (
        SELECT 1 FROM ${timers}
        WHERE ${timers.ownerId} = ${ownerId}
          AND ${timers.kind} = 'activity'
          AND ${inArray(timers.subjectId, deletedIds)}
          AND ${timers.startedAt} IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${outcomes}
        WHERE ${outcomes.ownerId} = ${ownerId}
          AND ${inArray(outcomes.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${publicationStatuses}
        WHERE ${publicationStatuses.ownerId} = ${ownerId}
          AND ${inArray(publicationStatuses.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${practiceTranscriptTurns}
        WHERE ${practiceTranscriptTurns.ownerId} = ${ownerId}
          AND ${inArray(practiceTranscriptTurns.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${activityFinalizations}
        WHERE ${activityFinalizations.ownerId} = ${ownerId}
          AND ${inArray(activityFinalizations.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${activityAudioClips}
        WHERE ${activityAudioClips.ownerId} = ${ownerId}
          AND ${inArray(activityAudioClips.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${activityNotes}
        WHERE ${activityNotes.ownerId} = ${ownerId}
          AND ${inArray(activityNotes.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${practiceNotes}
        WHERE ${practiceNotes.ownerId} = ${ownerId}
          AND ${inArray(practiceNotes.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${activityDeliveryAnalyses}
        WHERE ${activityDeliveryAnalyses.ownerId} = ${ownerId}
          AND ${inArray(activityDeliveryAnalyses.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${reviewSchedules}
        WHERE ${reviewSchedules.ownerId} = ${ownerId}
          AND ${inArray(reviewSchedules.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${timerIntervals}
        WHERE ${timerIntervals.ownerId} = ${ownerId}
          AND ${timerIntervals.kind} = 'activity'
          AND ${inArray(timerIntervals.subjectId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${leetcodeCodeAttempts}
        WHERE ${leetcodeCodeAttempts.ownerId} = ${ownerId}
          AND ${inArray(leetcodeCodeAttempts.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${voiceCaptureIntents}
        WHERE ${voiceCaptureIntents.ownerId} = ${ownerId}
          AND ${inArray(voiceCaptureIntents.activityId, deletedIds)}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${liveMutationReceipts}
        WHERE ${liveMutationReceipts.ownerId} = ${ownerId}
          AND ${inArray(liveMutationReceipts.activityId, deletedIds)}
      )
    `),
    ...affectedSessions.map(({ row }) => d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${liveSessions}
      WHERE ${liveSessions.ownerId} = ${ownerId}
        AND ${liveSessions.id} = ${row.id}
        AND ${liveSessions.revision} = ${row.revision}
    )`)),
  ];
  const statements = [
    ...guards,
    ...affectedSessions.map(({ row, payload }) => db.update(liveSessions).set({
      payload,
      revision: row.revision + 1,
      updatedAt: now,
    }).where(and(
      eq(liveSessions.ownerId, ownerId),
      eq(liveSessions.id, row.id),
      eq(liveSessions.revision, row.revision),
    ))),
    db.delete(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, workbench.id),
      deleting,
    )),
    db.update(practiceFocus).set({
      activityId: null,
      updatedAt: now,
    }).where(and(
      eq(practiceFocus.ownerId, ownerId),
      inArray(practiceFocus.activityId, deletedIds),
    )),
    db.update(practiceWorkbenches).set({
      updatedAt: resultingWorkbenchRevision,
    }).where(and(
      eq(practiceWorkbenches.ownerId, ownerId),
      eq(practiceWorkbenches.id, workbench.id),
      eq(practiceWorkbenches.updatedAt, workbench.revision),
    )),
    db.insert(todayPlanningMutations).values({
      ownerId,
      mutationId: input.mutationId,
      workbenchId: workbench.id,
      requestHash,
      response,
      createdAt: now,
    }),
  ];
  try {
    await db.batch(statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ]);
  } catch (error) {
    const receipt = await readPlanningMutation(ownerId, input.mutationId);
    if (receipt?.requestHash === requestHash) {
      return { duplicate: true, result: receipt.response };
    }
    if (isD1TransactionalInvariantFailure(error)) {
      throw new TodayPlanningConflictError(
        "stale_workbench_revision",
        "Today or one selected activity changed during removal. Refresh before retrying.",
      );
    }
    throw error;
  }
  return { duplicate: false, result: response };
}

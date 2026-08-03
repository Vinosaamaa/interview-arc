import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  outcomes,
  extraActivities,
  focusBlocks,
  liveSessions,
  practiceFocus,
  practiceWorkbenches,
  reviewSchedules,
  timerIntervals,
  timers,
  todayPlanningMutations,
} from "./schema";
import {
  prepareVoiceCapturesForFinish,
  voiceFinishGuardMessage,
} from "./durable-practice";
import { reviewIntervalDays, type ReviewReason } from "./review-cadence";
import { SpecialistControlError } from "./specialist-controls-policy";
import { foldElapsed, nextTimerState } from "./timer-state";

type StoredTimer = typeof timers.$inferSelect;

function openWorkbenchGuard(ownerId: string, workbenchId: string) {
  return getDb().update(practiceWorkbenches).set({
    updatedAt: sql`CASE
      WHEN ${practiceWorkbenches.status} = 'open' THEN ${practiceWorkbenches.updatedAt}
      ELSE json('workbench_conflict')
    END`,
  }).where(and(
    eq(practiceWorkbenches.ownerId, ownerId),
    eq(practiceWorkbenches.id, workbenchId),
  ));
}

function outcomePresenceGuard(ownerId: string, workbenchId: string, activityId: string) {
  return getDb().update(practiceWorkbenches).set({
    updatedAt: sql`CASE WHEN EXISTS (
      SELECT 1 FROM ${outcomes}
      WHERE ${outcomes.ownerId} = ${ownerId}
        AND ${outcomes.activityId} = ${activityId}
    ) THEN ${practiceWorkbenches.updatedAt} ELSE json('result_required') END`,
  }).where(and(
    eq(practiceWorkbenches.ownerId, ownerId),
    eq(practiceWorkbenches.id, workbenchId),
  ));
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function outcomeRevisionGuard(
  ownerId: string,
  workbenchId: string,
  activityId: string,
  expectedRevision: number,
) {
  return getDb().update(practiceWorkbenches).set({
    updatedAt: sql`${practiceWorkbenches.updatedAt}`,
  }).where(and(
    eq(practiceWorkbenches.ownerId, ownerId),
    eq(practiceWorkbenches.id, workbenchId),
    sql`CASE WHEN COALESCE((
      SELECT ${outcomes.revision}
      FROM ${outcomes}
      WHERE ${outcomes.ownerId} = ${ownerId}
        AND ${outcomes.activityId} = ${activityId}
    ), 0) = ${expectedRevision} THEN 1 ELSE json('revision_conflict') END`,
  ));
}

function revisionGuard(
  ownerId: string,
  workbenchId: string,
  subjectId: string,
  kind: "activity" | "session",
  expectedRevision: number,
) {
  return getDb().update(practiceWorkbenches).set({
    updatedAt: sql`${practiceWorkbenches.updatedAt}`,
  }).where(and(
    eq(practiceWorkbenches.ownerId, ownerId),
    eq(practiceWorkbenches.id, workbenchId),
    sql`CASE WHEN COALESCE((
      SELECT ${timers.revision}
      FROM ${timers}
      WHERE ${timers.ownerId} = ${ownerId}
        AND ${timers.subjectId} = ${subjectId}
        AND ${timers.kind} = ${kind}
    ), 0) = ${expectedRevision} THEN 1 ELSE json('revision_conflict') END`,
  ));
}

function pauseStatements(ownerId: string, workbenchId: string, timer: StoredTimer, now: number) {
  return [
    revisionGuard(ownerId, workbenchId, timer.subjectId, timer.kind, timer.revision),
    getDb().update(timerIntervals).set({ endedAt: now }).where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.subjectId, timer.subjectId),
      eq(timerIntervals.kind, timer.kind),
      isNotNull(timerIntervals.startedAt),
      sql`${timerIntervals.endedAt} IS NULL`,
    )),
    getDb().update(timers).set({
      accumulatedSeconds: foldElapsed(timer.accumulatedSeconds, timer.runningSince, now),
      runningSince: null,
      revision: timer.revision + 1,
      updatedAt: now,
    }).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, timer.subjectId),
      eq(timers.kind, timer.kind),
      eq(timers.revision, timer.revision),
    )),
  ];
}

function finishStatements(ownerId: string, workbenchId: string, timer: StoredTimer, now: number) {
  const finished = nextTimerState(timer, "finish", now);
  return [
    revisionGuard(ownerId, workbenchId, timer.subjectId, timer.kind, timer.revision),
    getDb().update(timerIntervals).set({ endedAt: now }).where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.subjectId, timer.subjectId),
      eq(timerIntervals.kind, timer.kind),
      sql`${timerIntervals.endedAt} IS NULL`,
    )),
    getDb().update(timers).set({
      accumulatedSeconds: finished.accumulatedSeconds,
      runningSince: null,
      completed: true,
      completedAt: now,
      revision: finished.revision,
      updatedAt: now,
    }).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, timer.subjectId),
      eq(timers.kind, timer.kind),
      eq(timers.revision, timer.revision),
    )),
  ];
}

export async function startFreshPracticeWorkbench(input: {
  ownerId: string;
  workbenchId: string;
  newWorkbenchId: string;
  openedPacificDate: string;
  mutationId: string;
  requestHash: string;
  receipt: Record<string, unknown>;
  now: number;
}) {
  const db = getDb();
  const [activityRows, focusRows, sessionRows, timerRows, outcomeRows] = await Promise.all([
    db.select({ id: extraActivities.id }).from(extraActivities).where(and(
      eq(extraActivities.ownerId, input.ownerId),
      eq(extraActivities.workbenchId, input.workbenchId),
    )),
    db.select({ id: focusBlocks.id }).from(focusBlocks).where(and(
      eq(focusBlocks.ownerId, input.ownerId),
      eq(focusBlocks.workbenchId, input.workbenchId),
    )),
    db.select({ id: liveSessions.id }).from(liveSessions).where(and(
      eq(liveSessions.ownerId, input.ownerId),
      eq(liveSessions.workbenchId, input.workbenchId),
    )),
    db.select().from(timers).where(eq(timers.ownerId, input.ownerId)),
    db.select({ activityId: outcomes.activityId }).from(outcomes).where(eq(outcomes.ownerId, input.ownerId)),
  ]);
  const practiceIds = new Set(activityRows.map((row) => row.id));
  const focusIds = new Set(focusRows.map((row) => row.id));
  const sessionIds = new Set(sessionRows.map((row) => row.id));
  const resultIds = new Set(outcomeRows.map((row) => row.activityId));
  const practiceTimers = timerRows.filter((timer) => timer.kind === "activity" && practiceIds.has(timer.subjectId));
  const missingResults = practiceTimers.filter((timer) => timer.startedAt && !resultIds.has(timer.subjectId));
  if (missingResults.length) {
    throw new SpecialistControlError(
      "result_required",
      `Choose a result for ${missingResults.length === 1 ? "the started activity" : "every started activity"} before starting fresh.`,
    );
  }
  for (const timer of practiceTimers) {
    if (!timer.startedAt || timer.completed) continue;
    const voiceGuard = await prepareVoiceCapturesForFinish(input.ownerId, timer.subjectId, input.now);
    const voiceConflict = voiceFinishGuardMessage(voiceGuard);
    if (voiceConflict) throw new SpecialistControlError("timer_state_conflict", voiceConflict);
  }

  const scopedTimers = timerRows.filter((timer) => (
    (timer.kind === "activity" && (practiceIds.has(timer.subjectId) || focusIds.has(timer.subjectId)))
    || (timer.kind === "session" && sessionIds.has(timer.subjectId))
  ));
  const statements: Parameters<typeof db.batch>[0][number][] = [
    openWorkbenchGuard(input.ownerId, input.workbenchId),
    ...practiceTimers.filter((timer) => timer.startedAt).map((timer) => (
      outcomePresenceGuard(input.ownerId, input.workbenchId, timer.subjectId)
    )),
    ...scopedTimers.filter((timer) => timer.startedAt && !timer.completed).flatMap((timer) => (
      finishStatements(input.ownerId, input.workbenchId, timer, input.now)
    )),
    db.insert(practiceFocus).values({
      ownerId: input.ownerId,
      activityId: null,
      sessionId: null,
      focusedAt: null,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: practiceFocus.ownerId,
      set: { activityId: null, sessionId: null, focusedAt: null, updatedAt: input.now },
    }),
    db.update(practiceWorkbenches).set({
      status: "archived",
      closedAt: input.now,
      updatedAt: input.now,
    }).where(and(
      eq(practiceWorkbenches.ownerId, input.ownerId),
      eq(practiceWorkbenches.id, input.workbenchId),
      eq(practiceWorkbenches.status, "open"),
    )),
    db.insert(practiceWorkbenches).values({
      ownerId: input.ownerId,
      id: input.newWorkbenchId,
      status: "open",
      openedPacificDate: input.openedPacificDate,
      openedAt: input.now,
      closedAt: null,
      updatedAt: input.now,
    }),
    db.insert(todayPlanningMutations).values({
      ownerId: input.ownerId,
      mutationId: input.mutationId,
      workbenchId: input.workbenchId,
      requestHash: input.requestHash,
      response: input.receipt,
      createdAt: input.now,
    }),
  ];
  try {
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  } catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes("result_required")) {
      throw new SpecialistControlError(
        "result_required",
        "A result changed while the workbench was closing. Read Today and choose a result before retrying.",
      );
    }
    if (message.includes("workbench_conflict") || message.includes("malformed json")) {
      throw new SpecialistControlError(
        "stale_workbench",
        "Today or one of its timers changed while the workbench was closing. Read Today again before retrying.",
      );
    }
    throw error;
  }
}

export async function controlSessionPracticeTimer(input: {
  ownerId: string;
  sessionId: string;
  action: "start" | "pause" | "resume" | "finish";
  expectedRevision: number;
  activityIds: string[];
  mutationId: string;
  workbenchId: string;
  requestHash: string;
  receipt: Record<string, unknown>;
  now: number;
}) {
  const db = getDb();
  const [timerRows, focusRows, focusBlockRows, outcomeRows] = await Promise.all([
    db.select().from(timers).where(eq(timers.ownerId, input.ownerId)),
    db.select().from(practiceFocus).where(eq(practiceFocus.ownerId, input.ownerId)),
    input.activityIds.length
      ? db.select({ id: focusBlocks.id }).from(focusBlocks).where(and(
        eq(focusBlocks.ownerId, input.ownerId),
        inArray(focusBlocks.id, input.activityIds),
      ))
      : Promise.resolve([] as { id: string }[]),
    input.activityIds.length
      ? db.select({ activityId: outcomes.activityId }).from(outcomes).where(and(
        eq(outcomes.ownerId, input.ownerId),
        inArray(outcomes.activityId, input.activityIds),
      ))
      : Promise.resolve([] as { activityId: string }[]),
  ]);
  const sessionTimer = timerRows.find((timer) => (
    timer.kind === "session" && timer.subjectId === input.sessionId
  ));
  if ((sessionTimer?.revision ?? 0) !== input.expectedRevision) {
    throw new SpecialistControlError(
      "stale_timer_revision",
      "The session timer changed. Read Today again before retrying.",
    );
  }
  if (sessionTimer?.completed) {
    throw new SpecialistControlError("timer_completed", "The session timer is already finished and cannot be changed.");
  }
  if (input.action === "pause" && !sessionTimer?.runningSince) {
    throw new SpecialistControlError("timer_not_running", "The session timer must be running before it can be paused.");
  }
  if (input.action === "resume" && (!sessionTimer?.startedAt || sessionTimer.runningSince)) {
    throw new SpecialistControlError("timer_not_paused", "The session timer must be started and paused before it can be resumed.");
  }
  if (input.action === "finish" && !sessionTimer?.startedAt) {
    throw new SpecialistControlError("timer_not_finishable", "The session timer must be started before it can be finished.");
  }

  const activityIds = new Set(input.activityIds);
  const childTimers = timerRows.filter((timer) => timer.kind === "activity" && activityIds.has(timer.subjectId));
  const focusBlockIds = new Set(focusBlockRows.map((row) => row.id));
  if (input.action === "finish") {
    const activitiesWithResults = new Set(outcomeRows.map((row) => row.activityId));
    const missingResults: string[] = [];
    for (const child of childTimers) {
      if (!child.startedAt || child.completed || focusBlockIds.has(child.subjectId)) continue;
      const voiceGuard = await prepareVoiceCapturesForFinish(input.ownerId, child.subjectId, input.now);
      const voiceConflict = voiceFinishGuardMessage(voiceGuard);
      if (voiceConflict) throw new SpecialistControlError("timer_state_conflict", voiceConflict);
      if (!activitiesWithResults.has(child.subjectId)) missingResults.push(child.subjectId);
    }
    if (missingResults.length) {
      throw new SpecialistControlError(
        "result_required",
        `Choose a result for ${missingResults.length === 1 ? "the started activity" : "every started activity"} before finishing this session.`,
      );
    }
  }

  const statements: Parameters<typeof db.batch>[0][number][] = [];
  if (input.action === "start" || input.action === "resume") {
    const otherRunningSessions = timerRows.filter((timer) => (
      timer.kind === "session" && timer.subjectId !== input.sessionId && timer.runningSince != null
    ));
    const runningActivitiesOutside = timerRows.filter((timer) => (
      timer.kind === "activity" && !activityIds.has(timer.subjectId) && timer.runningSince != null
    ));
    statements.push(
      ...otherRunningSessions.flatMap((timer) => pauseStatements(input.ownerId, input.workbenchId, timer, input.now)),
      ...runningActivitiesOutside.flatMap((timer) => pauseStatements(input.ownerId, input.workbenchId, timer, input.now)),
    );
    statements.push(revisionGuard(
      input.ownerId,
      input.workbenchId,
      input.sessionId,
      "session",
      input.expectedRevision,
    ));
    if (!sessionTimer?.runningSince) {
      const started = nextTimerState(sessionTimer, "start", input.now);
      statements.push(db.insert(timers).values({
        ownerId: input.ownerId,
        subjectId: input.sessionId,
        kind: "session",
        accumulatedSeconds: started.accumulatedSeconds,
        startedAt: sessionTimer?.startedAt ?? input.now,
        runningSince: input.now,
        completed: false,
        revision: started.revision,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: [timers.ownerId, timers.subjectId, timers.kind],
        set: {
          accumulatedSeconds: started.accumulatedSeconds,
          startedAt: sessionTimer?.startedAt ?? input.now,
          runningSince: input.now,
          completed: false,
          revision: started.revision,
          updatedAt: input.now,
        },
        setWhere: eq(timers.revision, input.expectedRevision),
      }));
      statements.push(db.insert(timerIntervals).values({
        ownerId: input.ownerId,
        subjectId: input.sessionId,
        kind: "session",
        startedAt: input.now,
      }).onConflictDoNothing());
    }
    const currentActivityId = focusRows[0]?.activityId;
    statements.push(db.insert(practiceFocus).values({
      ownerId: input.ownerId,
      activityId: currentActivityId && activityIds.has(currentActivityId) ? currentActivityId : null,
      sessionId: input.sessionId,
      focusedAt: input.now,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: practiceFocus.ownerId,
      set: {
        activityId: currentActivityId && activityIds.has(currentActivityId) ? currentActivityId : null,
        sessionId: input.sessionId,
        focusedAt: input.now,
        updatedAt: input.now,
      },
    }));
  } else if (input.action === "pause") {
    statements.push(
      ...childTimers.filter((timer) => timer.runningSince != null).flatMap((timer) => (
        pauseStatements(input.ownerId, input.workbenchId, timer, input.now)
      )),
      ...pauseStatements(input.ownerId, input.workbenchId, sessionTimer!, input.now),
    );
  } else {
    statements.push(
      ...childTimers.filter((timer) => timer.startedAt && !timer.completed).flatMap((timer) => (
        finishStatements(input.ownerId, input.workbenchId, timer, input.now)
      )),
      ...finishStatements(input.ownerId, input.workbenchId, sessionTimer!, input.now),
    );
  }

  statements.push(db.insert(todayPlanningMutations).values({
    ownerId: input.ownerId,
    mutationId: input.mutationId,
    workbenchId: input.workbenchId,
    requestHash: input.requestHash,
    response: input.receipt,
    createdAt: input.now,
  }));
  try {
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  } catch (error) {
    if (String(error).toLowerCase().includes("malformed json")) {
      throw new SpecialistControlError(
        "stale_timer_revision",
        "A session or child timer changed while the command was committing. Read Today again before retrying.",
      );
    }
    throw error;
  }
}

export async function finishAndAdvancePracticeActivity(input: {
  ownerId: string;
  currentActivityId: string;
  expectedCurrentRevision: number;
  nextActivityId: string;
  nextSessionId?: string;
  expectedNextRevision: number;
  mutationId: string;
  workbenchId: string;
  requestHash: string;
  receipt: Record<string, unknown>;
  now: number;
}) {
  const db = getDb();
  const [currentRows, nextRows, runningActivities, runningSessions, nextSessionRows] = await Promise.all([
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.subjectId, input.currentActivityId),
      eq(timers.kind, "activity"),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.subjectId, input.nextActivityId),
      eq(timers.kind, "activity"),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.kind, "activity"),
      isNotNull(timers.runningSince),
      ne(timers.subjectId, input.currentActivityId),
      ne(timers.subjectId, input.nextActivityId),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.kind, "session"),
      isNotNull(timers.runningSince),
      ...(input.nextSessionId ? [ne(timers.subjectId, input.nextSessionId)] : []),
    )),
    input.nextSessionId
      ? db.select().from(timers).where(and(
        eq(timers.ownerId, input.ownerId),
        eq(timers.subjectId, input.nextSessionId),
        eq(timers.kind, "session"),
      ))
      : Promise.resolve([] as StoredTimer[]),
  ]);
  const current = currentRows[0];
  const next = nextRows[0];
  if (!current?.startedAt || current.completed) {
    throw new SpecialistControlError(
      "timer_not_finishable",
      "The current activity must be started and unfinished before advancing.",
    );
  }
  if (current.revision !== input.expectedCurrentRevision) {
    throw new SpecialistControlError(
      "stale_timer_revision",
      "The current activity timer changed. Read Today again before retrying.",
    );
  }
  if ((next?.revision ?? 0) !== input.expectedNextRevision || next?.completed) {
    throw new SpecialistControlError(
      "stale_timer_revision",
      "The next activity timer changed or is already finished. Read Today again before retrying.",
    );
  }

  const finished = nextTimerState(current, "finish", input.now);
  const started = nextTimerState(next, "start", input.now);
  const statements: Parameters<typeof db.batch>[0][number][] = [
    revisionGuard(input.ownerId, input.workbenchId, input.currentActivityId, "activity", input.expectedCurrentRevision),
    revisionGuard(input.ownerId, input.workbenchId, input.nextActivityId, "activity", input.expectedNextRevision),
    db.update(timerIntervals).set({ endedAt: input.now }).where(and(
      eq(timerIntervals.ownerId, input.ownerId),
      eq(timerIntervals.subjectId, input.currentActivityId),
      eq(timerIntervals.kind, "activity"),
      sql`${timerIntervals.endedAt} IS NULL`,
    )),
    db.update(timers).set({
      accumulatedSeconds: finished.accumulatedSeconds,
      runningSince: null,
      completed: true,
      completedAt: input.now,
      revision: finished.revision,
      updatedAt: input.now,
    }).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.subjectId, input.currentActivityId),
      eq(timers.kind, "activity"),
      eq(timers.revision, input.expectedCurrentRevision),
    )),
    ...runningActivities.flatMap((timer) => pauseStatements(input.ownerId, input.workbenchId, timer, input.now)),
    ...runningSessions.flatMap((timer) => pauseStatements(input.ownerId, input.workbenchId, timer, input.now)),
  ];

  const nextSession = nextSessionRows[0];
  if (input.nextSessionId && !nextSession?.runningSince) {
    const sessionStarted = nextTimerState(nextSession, "start", input.now);
    statements.push(revisionGuard(
      input.ownerId,
      input.workbenchId,
      input.nextSessionId,
      "session",
      nextSession?.revision ?? 0,
    ));
    statements.push(db.insert(timers).values({
      ownerId: input.ownerId,
      subjectId: input.nextSessionId,
      kind: "session",
      accumulatedSeconds: sessionStarted.accumulatedSeconds,
      startedAt: nextSession?.startedAt ?? input.now,
      runningSince: input.now,
      completed: false,
      revision: sessionStarted.revision,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [timers.ownerId, timers.subjectId, timers.kind],
      set: {
        runningSince: input.now,
        completed: false,
        revision: sessionStarted.revision,
        updatedAt: input.now,
      },
      setWhere: eq(timers.revision, nextSession?.revision ?? 0),
    }));
    statements.push(db.insert(timerIntervals).values({
      ownerId: input.ownerId,
      subjectId: input.nextSessionId,
      kind: "session",
      startedAt: input.now,
    }).onConflictDoNothing());
  }

  statements.push(db.insert(timers).values({
    ownerId: input.ownerId,
    subjectId: input.nextActivityId,
    kind: "activity",
    accumulatedSeconds: started.accumulatedSeconds,
    startedAt: next?.startedAt ?? input.now,
    runningSince: input.now,
    completed: false,
    revision: started.revision,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: [timers.ownerId, timers.subjectId, timers.kind],
    set: {
      runningSince: input.now,
      completed: false,
      revision: started.revision,
      updatedAt: input.now,
    },
    setWhere: eq(timers.revision, input.expectedNextRevision),
  }));
  statements.push(db.insert(timerIntervals).values({
    ownerId: input.ownerId,
    subjectId: input.nextActivityId,
    kind: "activity",
    startedAt: input.now,
  }).onConflictDoNothing());
  statements.push(db.insert(practiceFocus).values({
    ownerId: input.ownerId,
    activityId: input.nextActivityId,
    sessionId: input.nextSessionId ?? null,
    focusedAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: practiceFocus.ownerId,
    set: {
      activityId: input.nextActivityId,
      sessionId: input.nextSessionId ?? null,
      focusedAt: input.now,
      updatedAt: input.now,
    },
  }));
  statements.push(db.insert(todayPlanningMutations).values({
    ownerId: input.ownerId,
    mutationId: input.mutationId,
    workbenchId: input.workbenchId,
    requestHash: input.requestHash,
    response: input.receipt,
    createdAt: input.now,
  }));

  try {
    await db.batch(statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("malformed json")) {
      throw new SpecialistControlError(
        "stale_timer_revision",
        "A timer changed while the command was committing. Read Today again before retrying.",
      );
    }
    throw error;
  }
}

export async function startSessionPracticeActivity(input: {
  ownerId: string;
  activityId: string;
  expectedActivityRevision: number;
  sessionId: string;
  sessionActivityIds: string[];
  mutationId: string;
  workbenchId: string;
  requestHash: string;
  receipt: Record<string, unknown>;
  now: number;
}) {
  const db = getDb();
  const [activityRows, sessionRows, runningActivities, runningSessions] = await Promise.all([
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.subjectId, input.activityId),
      eq(timers.kind, "activity"),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.subjectId, input.sessionId),
      eq(timers.kind, "session"),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.kind, "activity"),
      isNotNull(timers.runningSince),
      ne(timers.subjectId, input.activityId),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, input.ownerId),
      eq(timers.kind, "session"),
      isNotNull(timers.runningSince),
      ne(timers.subjectId, input.sessionId),
    )),
  ]);
  const activity = activityRows[0];
  const session = sessionRows[0];
  if ((activity?.revision ?? 0) !== input.expectedActivityRevision || activity?.completed) {
    throw new SpecialistControlError(
      "stale_timer_revision",
      "The activity timer changed or is already finished. Read Today again before retrying.",
    );
  }
  if (session?.completed) {
    throw new SpecialistControlError("timer_not_startable", "The parent session is already finished.");
  }

  const statements: Parameters<typeof db.batch>[0][number][] = [
    revisionGuard(input.ownerId, input.workbenchId, input.activityId, "activity", input.expectedActivityRevision),
    revisionGuard(input.ownerId, input.workbenchId, input.sessionId, "session", session?.revision ?? 0),
    ...runningActivities.flatMap((timer) => pauseStatements(input.ownerId, input.workbenchId, timer, input.now)),
    ...runningSessions.flatMap((timer) => pauseStatements(input.ownerId, input.workbenchId, timer, input.now)),
  ];

  if (!session?.runningSince) {
    const startedSession = nextTimerState(session, "start", input.now);
    statements.push(db.insert(timers).values({
      ownerId: input.ownerId,
      subjectId: input.sessionId,
      kind: "session",
      accumulatedSeconds: startedSession.accumulatedSeconds,
      startedAt: session?.startedAt ?? input.now,
      runningSince: input.now,
      completed: false,
      revision: startedSession.revision,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [timers.ownerId, timers.subjectId, timers.kind],
      set: {
        runningSince: input.now,
        completed: false,
        revision: startedSession.revision,
        updatedAt: input.now,
      },
      setWhere: eq(timers.revision, session?.revision ?? 0),
    }));
    statements.push(db.insert(timerIntervals).values({
      ownerId: input.ownerId,
      subjectId: input.sessionId,
      kind: "session",
      startedAt: input.now,
    }).onConflictDoNothing());
  }

  if (!activity?.runningSince) {
    const startedActivity = nextTimerState(activity, "start", input.now);
    statements.push(db.insert(timers).values({
      ownerId: input.ownerId,
      subjectId: input.activityId,
      kind: "activity",
      accumulatedSeconds: startedActivity.accumulatedSeconds,
      startedAt: activity?.startedAt ?? input.now,
      runningSince: input.now,
      completed: false,
      revision: startedActivity.revision,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [timers.ownerId, timers.subjectId, timers.kind],
      set: {
        runningSince: input.now,
        completed: false,
        revision: startedActivity.revision,
        updatedAt: input.now,
      },
      setWhere: eq(timers.revision, input.expectedActivityRevision),
    }));
    statements.push(db.insert(timerIntervals).values({
      ownerId: input.ownerId,
      subjectId: input.activityId,
      kind: "activity",
      startedAt: input.now,
    }).onConflictDoNothing());
  }

  statements.push(db.insert(practiceFocus).values({
    ownerId: input.ownerId,
    activityId: input.activityId,
    sessionId: input.sessionId,
    focusedAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: practiceFocus.ownerId,
    set: {
      activityId: input.activityId,
      sessionId: input.sessionId,
      focusedAt: input.now,
      updatedAt: input.now,
    },
  }));
  statements.push(db.insert(todayPlanningMutations).values({
    ownerId: input.ownerId,
    mutationId: input.mutationId,
    workbenchId: input.workbenchId,
    requestHash: input.requestHash,
    response: input.receipt,
    createdAt: input.now,
  }));

  try {
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  } catch (error) {
    if (String(error).toLowerCase().includes("malformed json")) {
      throw new SpecialistControlError(
        "stale_timer_revision",
        "A timer changed while the command was committing. Read Today again before retrying.",
      );
    }
    throw error;
  }
}

export async function setPracticeResultAtomic(input: {
  ownerId: string;
  activityId: string;
  result: "solved" | "solved_after_reviewing_approach" | "failed" | null;
  expectedRevision: number;
  activity: {
    specialty: "leetcode" | "system_design" | "behavioral";
    questionId?: string;
    reviewOfActivityId?: string;
    completed: boolean;
  };
  completedDate: string;
  mutationId: string;
  workbenchId: string;
  requestHash: string;
  receipt: Record<string, unknown>;
  now: number;
}) {
  const db = getDb();
  const existingRows = await db.select().from(outcomes).where(and(
    eq(outcomes.ownerId, input.ownerId),
    eq(outcomes.activityId, input.activityId),
  ));
  const existing = existingRows[0];
  if ((existing?.revision ?? 0) !== input.expectedRevision) {
    throw new SpecialistControlError(
      "stale_result_revision",
      "The activity result changed. Read Today again before retrying.",
    );
  }
  const reviewKey = `${input.activity.specialty}:${input.activity.questionId ?? input.activityId}`;
  const priorReviews = await db.select().from(reviewSchedules).where(and(
    eq(reviewSchedules.ownerId, input.ownerId),
    eq(reviewSchedules.reviewKey, reviewKey),
  ));
  const prior = priorReviews[0];
  const statements: Parameters<typeof db.batch>[0][number][] = [
    outcomeRevisionGuard(input.ownerId, input.workbenchId, input.activityId, input.expectedRevision),
  ];
  if (input.result) {
    statements.push(db.insert(outcomes).values({
      ownerId: input.ownerId,
      activityId: input.activityId,
      outcome: input.result,
      revision: input.expectedRevision + 1,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [outcomes.ownerId, outcomes.activityId],
      set: {
        outcome: input.result,
        revision: input.expectedRevision + 1,
        updatedAt: input.now,
      },
      setWhere: eq(outcomes.revision, input.expectedRevision),
    }));
  } else if (existing) {
    statements.push(db.delete(outcomes).where(and(
      eq(outcomes.ownerId, input.ownerId),
      eq(outcomes.activityId, input.activityId),
      eq(outcomes.revision, input.expectedRevision),
    )));
  }

  let reason: ReviewReason | null = null;
  if (input.activity.completed && input.result === "failed") reason = "failed";
  if (input.activity.completed && input.result === "solved_after_reviewing_approach") reason = "approach_review";
  if (input.activity.completed && input.result === "solved" && input.activity.reviewOfActivityId) reason = "successful_recall";
  if (reason) {
    const intervalDays = reviewIntervalDays(reason, prior?.intervalDays);
    statements.push(db.insert(reviewSchedules).values({
      ownerId: input.ownerId,
      reviewKey,
      activityId: input.activityId,
      questionId: input.activity.questionId ?? null,
      specialty: input.activity.specialty,
      status: "scheduled",
      reason,
      dueDate: addDays(input.completedDate, intervalDays),
      intervalDays,
      stage: reason === "successful_recall" ? (prior?.stage ?? 0) + 1 : 0,
      reviewCount: reason === "successful_recall" ? (prior?.reviewCount ?? 0) + 1 : (prior?.reviewCount ?? 0),
      createdAt: prior?.createdAt ?? input.now,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [reviewSchedules.ownerId, reviewSchedules.reviewKey],
      set: {
        activityId: input.activityId,
        questionId: input.activity.questionId ?? null,
        specialty: input.activity.specialty,
        status: "scheduled",
        reason,
        dueDate: addDays(input.completedDate, intervalDays),
        intervalDays,
        stage: reason === "successful_recall" ? (prior?.stage ?? 0) + 1 : 0,
        reviewCount: reason === "successful_recall" ? (prior?.reviewCount ?? 0) + 1 : (prior?.reviewCount ?? 0),
        updatedAt: input.now,
      },
    }));
  } else {
    statements.push(db.delete(reviewSchedules).where(and(
      eq(reviewSchedules.ownerId, input.ownerId),
      eq(reviewSchedules.activityId, input.activityId),
    )));
  }
  statements.push(db.insert(todayPlanningMutations).values({
    ownerId: input.ownerId,
    mutationId: input.mutationId,
    workbenchId: input.workbenchId,
    requestHash: input.requestHash,
    response: input.receipt,
    createdAt: input.now,
  }));
  try {
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  } catch (error) {
    if (String(error).toLowerCase().includes("malformed json")) {
      throw new SpecialistControlError(
        "stale_result_revision",
        "The activity result changed while the command was committing. Read Today again before retrying.",
      );
    }
    throw error;
  }
}

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  practiceFocus,
  timerIntervals,
  timers,
  todayPlanningMutations,
} from "./schema";
import { SpecialistControlError } from "./specialist-controls-policy";
import { foldElapsed, nextTimerState } from "./timer-state";

type StoredTimer = typeof timers.$inferSelect;

function revisionGuard(
  ownerId: string,
  subjectId: string,
  kind: "activity" | "session",
  expectedRevision: number,
) {
  return getDb().select({
    ok: sql<number>`CASE WHEN COALESCE((
      SELECT ${timers.revision}
      FROM ${timers}
      WHERE ${timers.ownerId} = ${ownerId}
        AND ${timers.subjectId} = ${subjectId}
        AND ${timers.kind} = ${kind}
    ), 0) = ${expectedRevision} THEN 1 ELSE json('revision_conflict') END`,
  });
}

function pauseStatements(ownerId: string, timer: StoredTimer, now: number) {
  return [
    revisionGuard(ownerId, timer.subjectId, timer.kind, timer.revision),
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
  const statements = [
    revisionGuard(input.ownerId, input.currentActivityId, "activity", input.expectedCurrentRevision),
    revisionGuard(input.ownerId, input.nextActivityId, "activity", input.expectedNextRevision),
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
    ...runningActivities.flatMap((timer) => pauseStatements(input.ownerId, timer, input.now)),
    ...runningSessions.flatMap((timer) => pauseStatements(input.ownerId, timer, input.now)),
  ];

  const nextSession = nextSessionRows[0];
  if (input.nextSessionId && !nextSession?.runningSince) {
    const sessionStarted = nextTimerState(nextSession, "start", input.now);
    statements.push(revisionGuard(
      input.ownerId,
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

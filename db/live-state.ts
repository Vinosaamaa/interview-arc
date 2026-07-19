import { and, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "./index";
import {
  extraActivities,
  liveSessions,
  outcomes,
  timers,
  type ExtraActivityRow,
  type LiveSessionRow,
} from "./schema";

export type TimerKind = "activity" | "session";
export type TimerAction = "start" | "pause" | "finish";
export type OutcomeValue = "solved" | "solved_after_reviewing_approach" | "failed";

// Serialized clock as the client consumes it. `runningSince` is server epoch ms;
// the client corrects for clock skew using `serverNow` from the state response.
export type TimerState = {
  accumulatedSeconds: number;
  runningSince: number | null;
  completed: boolean;
  revision: number;
};

export type LiveState = {
  serverNow: number;
  timers: Record<string, TimerState>;
  sessionTimers: Record<string, TimerState>;
  outcomes: Record<string, OutcomeValue>;
  extraActivities: unknown[];
  sessions: unknown[];
};

type Db = ReturnType<typeof getDb>;

function toTimerState(row: {
  accumulatedSeconds: number;
  runningSince: number | null;
  completed: boolean;
  revision: number;
}): TimerState {
  return {
    accumulatedSeconds: row.accumulatedSeconds,
    runningSince: row.runningSince,
    completed: row.completed,
    revision: row.revision,
  };
}

function foldElapsed(accumulatedSeconds: number, runningSince: number | null, nowMs: number) {
  if (!runningSince) return accumulatedSeconds;
  return accumulatedSeconds + Math.max(0, Math.floor((nowMs - runningSince) / 1000));
}

export async function readLiveState(ownerId: string, date: string): Promise<LiveState> {
  const db = getDb();
  const [timerRows, outcomeRows, extraRows, sessionRows] = await Promise.all([
    db.select().from(timers).where(eq(timers.ownerId, ownerId)),
    db.select().from(outcomes).where(eq(outcomes.ownerId, ownerId)),
    db
      .select()
      .from(extraActivities)
      .where(and(eq(extraActivities.ownerId, ownerId), eq(extraActivities.date, date))),
    db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.date, date))),
  ]);

  const activityTimers: Record<string, TimerState> = {};
  const sessionTimers: Record<string, TimerState> = {};
  for (const row of timerRows) {
    (row.kind === "session" ? sessionTimers : activityTimers)[row.subjectId] = toTimerState(row);
  }

  const outcomeMap: Record<string, OutcomeValue> = {};
  for (const row of outcomeRows) outcomeMap[row.activityId] = row.outcome as OutcomeValue;

  return {
    serverNow: Date.now(),
    timers: activityTimers,
    sessionTimers,
    outcomes: outcomeMap,
    extraActivities: extraRows.map((row: ExtraActivityRow) => row.payload),
    sessions: sessionRows.map((row: LiveSessionRow) => row.payload),
  };
}

async function loadTimer(db: Db, ownerId: string, subjectId: string, kind: TimerKind) {
  const rows = await db
    .select()
    .from(timers)
    .where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, subjectId), eq(timers.kind, kind)));
  return rows[0];
}

export async function applyTimerAction(
  ownerId: string,
  subjectId: string,
  kind: TimerKind,
  action: TimerAction,
  nowMs: number,
): Promise<TimerState> {
  const db = getDb();
  const existing = await loadTimer(db, ownerId, subjectId, kind);

  // Finished timers are locked permanently and never resume.
  if (existing?.completed) return toTimerState(existing);

  const baseAccumulated = existing?.accumulatedSeconds ?? 0;
  const revision = (existing?.revision ?? 0) + 1;

  if (action === "start") {
    // Enforce the single-active-stopwatch rule server-side so the main tab and
    // the pop-out window can never both drive two activity clocks at once.
    if (kind === "activity") {
      await pauseOtherActivityTimers(ownerId, subjectId, nowMs);
    }
    await db
      .insert(timers)
      .values({
        ownerId,
        subjectId,
        kind,
        accumulatedSeconds: baseAccumulated,
        runningSince: nowMs,
        completed: false,
        revision,
        updatedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [timers.ownerId, timers.subjectId, timers.kind],
        set: { runningSince: nowMs, completed: false, revision, updatedAt: nowMs },
      });
  } else {
    const folded = foldElapsed(baseAccumulated, existing?.runningSince ?? null, nowMs);
    const completed = action === "finish";
    await db
      .insert(timers)
      .values({
        ownerId,
        subjectId,
        kind,
        accumulatedSeconds: folded,
        runningSince: null,
        completed,
        completedAt: completed ? nowMs : null,
        revision,
        updatedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [timers.ownerId, timers.subjectId, timers.kind],
        set: {
          accumulatedSeconds: folded,
          runningSince: null,
          completed,
          completedAt: completed ? nowMs : null,
          revision,
          updatedAt: nowMs,
        },
      });
  }

  const updated = await loadTimer(db, ownerId, subjectId, kind);
  return toTimerState(updated!);
}

export async function pauseOtherActivityTimers(ownerId: string, exceptSubjectId: string, nowMs: number) {
  const db = getDb();
  const running = await db
    .select()
    .from(timers)
    .where(
      and(
        eq(timers.ownerId, ownerId),
        eq(timers.kind, "activity"),
        isNotNull(timers.runningSince),
        ne(timers.subjectId, exceptSubjectId),
      ),
    );
  for (const row of running) {
    const folded = foldElapsed(row.accumulatedSeconds, row.runningSince, nowMs);
    await db
      .update(timers)
      .set({ accumulatedSeconds: folded, runningSince: null, revision: row.revision + 1, updatedAt: nowMs })
      .where(
        and(eq(timers.ownerId, ownerId), eq(timers.subjectId, row.subjectId), eq(timers.kind, "activity")),
      );
  }
}

export async function setOutcome(ownerId: string, activityId: string, outcome: OutcomeValue | null, nowMs: number) {
  const db = getDb();
  if (!outcome) {
    await db.delete(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, activityId)));
    return;
  }
  await db
    .insert(outcomes)
    .values({ ownerId, activityId, outcome, revision: 1, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: [outcomes.ownerId, outcomes.activityId],
      set: { outcome, updatedAt: nowMs },
    });
}

export async function upsertExtraActivity(
  ownerId: string,
  activity: { id: string; date: string } & Record<string, unknown>,
  nowMs: number,
) {
  const db = getDb();
  await db
    .insert(extraActivities)
    .values({ ownerId, id: activity.id, date: activity.date, payload: activity, revision: 1, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: [extraActivities.ownerId, extraActivities.id],
      set: { date: activity.date, payload: activity, updatedAt: nowMs },
    });
}

export async function removeExtraActivity(ownerId: string, id: string) {
  const db = getDb();
  await db.delete(extraActivities).where(and(eq(extraActivities.ownerId, ownerId), eq(extraActivities.id, id)));
  await db.delete(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, id)));
  await db.delete(timers).where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, id), eq(timers.kind, "activity")));
}

export async function upsertLiveSession(
  ownerId: string,
  session: { id: string; date: string } & Record<string, unknown>,
  nowMs: number,
) {
  const db = getDb();
  await db
    .insert(liveSessions)
    .values({ ownerId, id: session.id, date: session.date, payload: session, revision: 1, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: [liveSessions.ownerId, liveSessions.id],
      set: { date: session.date, payload: session, updatedAt: nowMs },
    });
}

export async function removeLiveSession(ownerId: string, id: string, activityIds: string[]) {
  const db = getDb();
  await db.delete(liveSessions).where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.id, id)));
  await db.delete(timers).where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, id), eq(timers.kind, "session")));
  for (const activityId of activityIds) {
    await removeExtraActivity(ownerId, activityId);
  }
}

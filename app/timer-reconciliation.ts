import type { TimerDraft } from "./live-types";

export type ReconcileServerTimer = {
  accumulatedSeconds: number;
  startedAt: number | null;
  runningSince: number | null;
  completed: boolean;
  completedAt: number | null;
  revision: number;
};

export type TimerSyncState = {
  serverNow: number;
  timers: Record<string, ReconcileServerTimer>;
  sessionTimers: Record<string, ReconcileServerTimer>;
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

type TimerSyncDraft = {
  timers: Record<string, TimerDraft>;
  sessionTimers: Record<string, TimerDraft>;
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

function timerToDraft(timer: ReconcileServerTimer, offset: number): TimerDraft {
  return {
    elapsedSeconds: timer.accumulatedSeconds,
    runningSince: timer.runningSince === null ? null : timer.runningSince - offset,
    completed: timer.completed,
    startedAt: timer.startedAt,
    completedAt: timer.completedAt,
    revision: timer.revision,
  };
}

function timerRevisionsMatch(current: Record<string, TimerDraft>, incoming: Record<string, ReconcileServerTimer>) {
  const currentIds = Object.keys(current);
  const incomingIds = Object.keys(incoming);
  if (currentIds.length !== incomingIds.length) return false;
  return incomingIds.every((id) => current[id]?.revision === incoming[id].revision);
}

export function timerSyncChanged(current: TimerSyncDraft, incoming: TimerSyncState) {
  return !timerRevisionsMatch(current.timers, incoming.timers)
    || !timerRevisionsMatch(current.sessionTimers, incoming.sessionTimers)
    || current.focusedActivityId !== incoming.focusedActivityId
    || current.focusedSessionId !== incoming.focusedSessionId
    || current.focusedAt !== incoming.focusedAt;
}

export function applyTimerSync<T extends TimerSyncDraft>(
  current: T,
  incoming: TimerSyncState,
  offset: number,
): T {
  if (!timerSyncChanged(current, incoming)) return current;
  return {
    ...current,
    timers: Object.fromEntries(
      Object.entries(incoming.timers).map(([id, timer]) => [id, timerToDraft(timer, offset)]),
    ),
    sessionTimers: Object.fromEntries(
      Object.entries(incoming.sessionTimers).map(([id, timer]) => [id, timerToDraft(timer, offset)]),
    ),
    focusedActivityId: incoming.focusedActivityId,
    focusedSessionId: incoming.focusedSessionId,
    focusedAt: incoming.focusedAt,
  };
}

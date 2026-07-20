export type StoredTimer = {
  accumulatedSeconds: number;
  runningSince: number | null;
  completed: boolean;
  revision: number;
};

export function foldElapsed(accumulatedSeconds: number, runningSince: number | null, nowMs: number): number {
  if (runningSince === null) return accumulatedSeconds;
  return accumulatedSeconds + Math.max(0, Math.floor((nowMs - runningSince) / 1000));
}

export function nextTimerState(
  existing: StoredTimer | undefined,
  action: "start" | "pause" | "finish",
  nowMs: number,
): StoredTimer {
  if (existing?.completed) return existing;

  const accumulatedSeconds = existing?.accumulatedSeconds ?? 0;
  const revision = (existing?.revision ?? 0) + 1;
  if (action === "start") {
    return { accumulatedSeconds, runningSince: nowMs, completed: false, revision };
  }

  return {
    accumulatedSeconds: foldElapsed(accumulatedSeconds, existing?.runningSince ?? null, nowMs),
    runningSince: null,
    completed: action === "finish",
    revision,
  };
}

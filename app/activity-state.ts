type ActivityTimerState = {
  startedAt?: number | null;
  runningSince?: number | null;
  completed?: boolean;
};

export type ActivityLifecycleState = {
  key: "planned" | "running" | "paused" | "complete";
  label: "Planned" | "Running" | "Paused" | "Complete";
};

export function activityLifecycleState(
  timer: ActivityTimerState | null | undefined,
): ActivityLifecycleState {
  if (timer?.completed) return { key: "complete", label: "Complete" };
  if (timer?.runningSince) return { key: "running", label: "Running" };
  if (timer?.startedAt) return { key: "paused", label: "Paused" };
  return { key: "planned", label: "Planned" };
}

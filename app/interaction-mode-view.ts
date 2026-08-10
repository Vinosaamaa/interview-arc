import type {
  InteractionModePhase,
  InteractionModeRegistry,
  PracticeSpecialty,
} from "../db/interaction-mode-policy";
import type { InteractionModeSummary } from "../db/interaction-mode-store";

export function selectableInteractionModes(
  registry: InteractionModeRegistry,
  specialty: PracticeSpecialty,
  phase: InteractionModePhase,
) {
  return registry.modes.filter((mode) => (
    !mode.deprecated
    && mode.supportedSpecialties.includes(specialty)
    && mode.selectableWhen.includes(phase)
  ));
}

export function mergePendingInteractionModes(
  server: Record<string, InteractionModeSummary>,
  local: Record<string, InteractionModeSummary>,
  queued: ReadonlyArray<{ type: string; activityId?: unknown; mutationId?: unknown }>,
) {
  const pending = new Map<string, string>();
  for (const mutation of queued) {
    if (
      mutation.type === "interaction-mode-set"
      && typeof mutation.activityId === "string"
      && typeof mutation.mutationId === "string"
    ) {
      pending.set(mutation.activityId, mutation.mutationId);
    }
  }
  const merged = { ...server };
  for (const [activityId, mutationId] of pending) {
    const optimistic = local[activityId];
    if (optimistic?.current?.lastMutationId === `pending:${mutationId}`) {
      merged[activityId] = optimistic;
    }
  }
  return merged;
}

import type {
  InteractionModePhase,
  InteractionModeRegistry,
  PracticeSpecialty,
} from "../db/interaction-mode-policy";
import type { InteractionModeSummary } from "../db/interaction-mode-store";
import type { InteractionModeClassification } from "../db/interaction-mode-classification";

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

const classificationLabels: Record<string, string> = {
  interviewer: "Interview-led",
  mentor: "Mentor-led",
  grill: "Grill-led",
  mixed: "Mixed practice",
  unrecorded: "Mode not recorded",
};

export function interactionModeClassificationLabel(classification: Pick<InteractionModeClassification, "primaryPracticeModeId">) {
  return classificationLabels[classification.primaryPracticeModeId]
    ?? `${classification.primaryPracticeModeId.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}-led`;
}

export function matchesInteractionModeFilter(
  classification: Pick<InteractionModeClassification, "primaryPracticeModeId" | "hadMentorAssistance"> | null | undefined,
  filter: string,
) {
  if (filter === "mentor_assistance") return Boolean(classification?.hadMentorAssistance);
  return (classification?.primaryPracticeModeId ?? "unrecorded") === filter;
}

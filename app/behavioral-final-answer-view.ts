export function orderPastReaderSections<T>(input: {
  conversation?: T | null;
  finalAnswer?: T | null;
  resumeContext?: T | null;
  practiceScenarios?: T | null;
  behavioralAnalysis?: T | null;
  codeAttempts?: T | null;
  reviewSections?: readonly T[];
}) {
  return [
    input.conversation,
    input.finalAnswer,
    input.resumeContext,
    input.practiceScenarios,
    input.behavioralAnalysis,
    input.codeAttempts,
    ...(input.reviewSections ?? []),
  ].filter((section): section is T => section !== null && section !== undefined);
}

export function findExactPastSnapshot<T extends { id: string }>(entries: readonly T[], activityId: string) {
  return entries.find((entry) => entry.id === activityId) ?? null;
}

const LOADED_PAST_SNAPSHOT_FIELDS = [
  "transcriptTurns",
  "audioClips",
  "deliveryAnalyses",
  "codeAttempts",
  "finalAnswer",
  "practiceScenarios",
  "behavioralAnalysis",
  "resumeContext",
  "interactionModeClassification",
  "interactionModeTransitions",
  "personalNote",
  "pinnedNotes",
  "finalization",
  "artifact",
] as const;

export function retainLoadedPastSnapshot<T extends { id: string }>(current: T | null, next: T) {
  if (!current || current.id !== next.id) return next;
  const merged: Record<string, unknown> = { ...current, ...next };
  const loaded = current as Record<string, unknown>;
  for (const field of LOADED_PAST_SNAPSHOT_FIELDS) {
    if (loaded[field] !== undefined) merged[field] = loaded[field];
  }
  return merged as T;
}

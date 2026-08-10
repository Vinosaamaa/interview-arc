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

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

type LoadedPastSnapshotFields = {
  transcriptTurns?: unknown;
  audioClips?: unknown;
  deliveryAnalyses?: unknown;
  codeAttempts?: unknown;
  finalAnswer?: unknown;
  practiceScenarios?: unknown;
  behavioralAnalysis?: unknown;
  resumeContext?: unknown;
  interactionModeClassification?: unknown;
  interactionModeTransitions?: unknown;
  personalNote?: unknown;
  pinnedNotes?: unknown;
  finalization?: unknown;
  artifact?: unknown;
};

function loadedPastSnapshotFields(snapshot: LoadedPastSnapshotFields): LoadedPastSnapshotFields {
  return {
    ...(snapshot.transcriptTurns === undefined ? {} : { transcriptTurns: snapshot.transcriptTurns }),
    ...(snapshot.audioClips === undefined ? {} : { audioClips: snapshot.audioClips }),
    ...(snapshot.deliveryAnalyses === undefined ? {} : { deliveryAnalyses: snapshot.deliveryAnalyses }),
    ...(snapshot.codeAttempts === undefined ? {} : { codeAttempts: snapshot.codeAttempts }),
    ...(snapshot.finalAnswer === undefined ? {} : { finalAnswer: snapshot.finalAnswer }),
    ...(snapshot.practiceScenarios === undefined ? {} : { practiceScenarios: snapshot.practiceScenarios }),
    ...(snapshot.behavioralAnalysis === undefined ? {} : { behavioralAnalysis: snapshot.behavioralAnalysis }),
    ...(snapshot.resumeContext === undefined ? {} : { resumeContext: snapshot.resumeContext }),
    ...(snapshot.interactionModeClassification === undefined ? {} : { interactionModeClassification: snapshot.interactionModeClassification }),
    ...(snapshot.interactionModeTransitions === undefined ? {} : { interactionModeTransitions: snapshot.interactionModeTransitions }),
    ...(snapshot.personalNote === undefined ? {} : { personalNote: snapshot.personalNote }),
    ...(snapshot.pinnedNotes === undefined ? {} : { pinnedNotes: snapshot.pinnedNotes }),
    ...(snapshot.finalization === undefined ? {} : { finalization: snapshot.finalization }),
    ...(snapshot.artifact === undefined ? {} : { artifact: snapshot.artifact }),
  };
}

export function retainLoadedPastSnapshot<T extends { id: string } & LoadedPastSnapshotFields>(current: T | null, next: T) {
  if (!current || current.id !== next.id) return next;
  return { ...current, ...next, ...loadedPastSnapshotFields(current) };
}

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
  practiceRecord?: unknown;
  practiceAssets?: unknown;
  drawingAddition?: unknown;
  editorialAddition?: unknown;
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
    ...(snapshot.practiceRecord === undefined ? {} : { practiceRecord: snapshot.practiceRecord }),
    ...(snapshot.practiceAssets === undefined ? {} : { practiceAssets: snapshot.practiceAssets }),
    ...(snapshot.drawingAddition === undefined ? {} : { drawingAddition: snapshot.drawingAddition }),
    ...(snapshot.editorialAddition === undefined ? {} : { editorialAddition: snapshot.editorialAddition }),
  };
}

export function retainLoadedPastSnapshot<T extends { id: string } & LoadedPastSnapshotFields>(current: T | null, next: T) {
  if (!current || current.id !== next.id) return next;
  const retained = { ...current, ...next, ...loadedPastSnapshotFields(current) };
  // List projections omit unloaded detail. An actual newer addition must still
  // replace a previously loaded absence without regressing a newer revision.
  for (const key of ["drawingAddition", "editorialAddition"] as const) {
    const incoming = next[key] as { revision?: number } | null | undefined;
    const loaded = current[key] as { revision?: number } | null | undefined;
    if (incoming && (!loaded || (incoming.revision ?? 0) >= (loaded.revision ?? 0))) retained[key] = next[key];
  }
  return retained;
}

export type LoopSpecialty = "leetcode" | "system_design" | "behavioral";

export type LoopPreparationBinding = {
  activityId: string;
  stageId: string | null;
  roleBriefRevision: number;
  specialty: LoopSpecialty;
  questionId: string;
  title: string;
  completed: boolean;
};

export type LoopPreparationHistory = {
  activityId: string;
  stageId: string | null;
  roleBriefRevision: number;
  specialty: LoopSpecialty;
  questionId: string;
  result: "solved" | "solved_after_reviewing_approach" | "failed";
  completedAt: number;
};

type PreparationSource = {
  activityBindings: LoopPreparationBinding[];
  activityHistory: LoopPreparationHistory[];
};

export type LoopPreparationAttempt = LoopPreparationBinding & {
  history?: LoopPreparationHistory;
};

export type LoopPreparationQuestion = {
  specialty: LoopSpecialty;
  questionId: string;
  title: string;
  completed: boolean;
  attempts: LoopPreparationAttempt[];
};

export type LoopPreparationGroup = {
  specialty: LoopSpecialty;
  questions: LoopPreparationQuestion[];
};

export function groupLoopPreparation(loop: PreparationSource): LoopPreparationGroup[] {
  const history = new Map(loop.activityHistory.map((attempt) => [attempt.activityId, attempt]));
  const questions = new Map<string, LoopPreparationQuestion>();
  loop.activityBindings.forEach((binding) => {
    const key = `${binding.specialty}:${binding.questionId}`;
    const current = questions.get(key) ?? {
      specialty: binding.specialty,
      questionId: binding.questionId,
      title: binding.title,
      completed: false,
      attempts: [],
    };
    const receipt = history.get(binding.activityId);
    current.completed ||= Boolean(receipt || binding.completed);
    current.attempts.push({ ...binding, ...(receipt ? { history: receipt } : {}) });
    questions.set(key, current);
  });
  questions.forEach((question) => question.attempts.sort((left, right) => (
    (right.history?.completedAt ?? 0) - (left.history?.completedAt ?? 0)
      || left.activityId.localeCompare(right.activityId)
  )));

  return (["leetcode", "system_design", "behavioral"] as LoopSpecialty[]).map((specialty) => ({
    specialty,
    questions: [...questions.values()]
      .filter((question) => question.specialty === specialty)
      .sort((left, right) => Number(right.completed) - Number(left.completed)
        || left.title.localeCompare(right.title)
        || left.questionId.localeCompare(right.questionId)),
  }));
}

export function loopStageRecords<T extends { stageId: string; order: number }>(stages: T[]) {
  return [...stages].sort((left, right) => left.order - right.order || left.stageId.localeCompare(right.stageId));
}

type MaterialSource<T> = { interviewMaterials: Array<T & { stageId?: string }> };

export function stageMaterials<T>(loop: MaterialSource<T>, stageId: string, includeLoopWide = false) {
  return loop.interviewMaterials.filter((material) => (
    material.stageId === stageId || (includeLoopWide && !material.stageId)
  ))
    .sort((left, right) => Number(Boolean(right.stageId)) - Number(Boolean(left.stageId)));
}

export class SpecialistControlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpecialistControlError";
    this.code = code;
  }
}

export function selectNextPracticeActivity(input: {
  currentActivityId: string;
  explicitNextActivityId?: string;
  sessionActivityIds: string[];
  practiceActivityIds: Set<string>;
  completedActivityIds: Set<string>;
}) {
  if (input.explicitNextActivityId) {
    if (
      !input.practiceActivityIds.has(input.explicitNextActivityId)
      || input.completedActivityIds.has(input.explicitNextActivityId)
    ) {
      throw new SpecialistControlError(
        "next_activity_unavailable",
        "The explicitly requested next practice activity is unavailable or already finished.",
      );
    }
    return input.explicitNextActivityId;
  }

  const currentIndex = input.sessionActivityIds.indexOf(input.currentActivityId);
  if (currentIndex < 0) {
    throw new SpecialistControlError(
      "current_activity_not_in_session",
      "Automatic advance requires the current activity to belong to a session.",
    );
  }
  const next = input.sessionActivityIds
    .slice(currentIndex + 1)
    .find((activityId) => (
      input.practiceActivityIds.has(activityId)
      && !input.completedActivityIds.has(activityId)
    ));
  if (!next) {
    throw new SpecialistControlError(
      "no_next_activity",
      "No unfinished practice activity remains after the current activity in this session.",
    );
  }
  return next;
}

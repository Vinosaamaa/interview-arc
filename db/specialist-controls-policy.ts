export class SpecialistControlError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SpecialistControlError";
    this.code = code;
    this.details = details;
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
      input.explicitNextActivityId === input.currentActivityId
      ||
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
  for (let index = currentIndex + 1; index < input.sessionActivityIds.length; index += 1) {
    const activityId = input.sessionActivityIds[index];
    if (
      input.practiceActivityIds.has(activityId)
      && !input.completedActivityIds.has(activityId)
    ) {
      return activityId;
    }
  }
  throw new SpecialistControlError(
    "no_next_activity",
    "No unfinished practice activity remains after the current activity in this session.",
  );
}

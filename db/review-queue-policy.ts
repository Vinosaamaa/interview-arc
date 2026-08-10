export type ReviewQueueSpecialty = "leetcode" | "system_design" | "behavioral";
export type ReviewQueueOutcome = "solved" | "solved_after_reviewing_approach" | "failed";
export type ReviewQueueReason = "failed" | "full_walkthrough" | "approach_review" | "manual" | "successful_recall";
export type ReviewQueueHorizon = "now" | "soon" | "later";

export type ReviewQueueAttempt = {
  id: string;
  questionId?: string;
  date: string;
  type: ReviewQueueSpecialty;
  title: string;
  status: "planned" | "running" | "completed" | "published";
  outcome?: ReviewQueueOutcome;
  allocatedSeconds: number;
  url?: string;
  prompt?: string;
  reviewOfActivityId?: string;
};

export type ReviewQueueSchedule = {
  reviewKey: string;
  activityId: string;
  questionId: string | null;
  specialty: ReviewQueueSpecialty;
  status: "scheduled" | "due" | "completed" | "dismissed";
  reason: ReviewQueueReason;
  dueDate: string;
  intervalDays: number;
  stage: number;
  reviewCount: number;
};

export type ReviewQueueItem = {
  reviewKey: string;
  activityId: string;
  questionId: string | null;
  specialty: ReviewQueueSpecialty;
  title: string;
  previousResult?: ReviewQueueOutcome;
  lastAttemptDate: string;
  reason: ReviewQueueReason;
  reasonLabel: string;
  dueDate: string;
  daysUntilDue: number;
  intervalDays: number;
  reviewCount: number;
  estimatedMinutes: number;
  horizon: ReviewQueueHorizon;
  url?: string;
};

export type ReviewQueueFilters = {
  search?: string;
  specialties?: Set<ReviewQueueSpecialty>;
  due?: "all" | "now" | "week" | "month";
  sort?: "priority" | "due" | "review_time" | "last_attempt";
};

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dateDaysBetween(left: string, right: string) {
  return Math.round(
    (Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000,
  );
}

export function reviewDeferralTarget(today: string) {
  const value = new Date(`${today}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

export function reviewEstimateMinutes(specialty: ReviewQueueSpecialty, allocatedSeconds: number) {
  const fallback = specialty === "leetcode" ? 20 : 30;
  if (!Number.isFinite(allocatedSeconds) || allocatedSeconds <= 0) return fallback;
  const halfAttemptMinutes = Math.round((allocatedSeconds / 120) / 5) * 5;
  return Math.max(10, Math.min(30, halfAttemptMinutes));
}

export function reviewHorizon(today: string, dueDate: string): ReviewQueueHorizon {
  const daysUntilDue = dateDaysBetween(today, dueDate);
  if (daysUntilDue <= 0) return "now";
  if (daysUntilDue <= 7) return "soon";
  return "later";
}

export function reviewReasonLabel(
  reason: ReviewQueueReason,
  intervalDays: number,
  outcome?: ReviewQueueOutcome,
) {
  if (reason === "failed") return "Failed attempt · the unresolved gap is due for another pass";
  if (reason === "full_walkthrough") return "Full walkthrough · rebuild the solution from memory";
  if (reason === "approach_review") return "Solved with help · recall the approach without the prompt";
  if (reason === "successful_recall") return `${intervalDays}-day reinforcement after a successful recall`;
  if (outcome === "failed") return "Manually scheduled after a failed attempt";
  return "Manually scheduled from the completed attempt";
}

export function buildReviewQueue(
  attempts: ReviewQueueAttempt[],
  schedules: ReviewQueueSchedule[],
  today: string,
): ReviewQueueItem[] {
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  return schedules.flatMap((schedule) => {
    if (schedule.status === "completed" || schedule.status === "dismissed") return [];
    const attempt = attemptsById.get(schedule.activityId);
    if (!attempt || (attempt.status !== "completed" && attempt.status !== "published")) return [];
    if (attempt.type !== schedule.specialty) return [];
    const daysUntilDue = dateDaysBetween(today, schedule.dueDate);
    return [{
      reviewKey: schedule.reviewKey,
      activityId: schedule.activityId,
      questionId: schedule.questionId ?? attempt.questionId ?? null,
      specialty: schedule.specialty,
      title: attempt.title,
      previousResult: attempt.outcome,
      lastAttemptDate: attempt.date,
      reason: schedule.reason,
      reasonLabel: reviewReasonLabel(schedule.reason, schedule.intervalDays, attempt.outcome),
      dueDate: schedule.dueDate,
      daysUntilDue,
      intervalDays: schedule.intervalDays,
      reviewCount: schedule.reviewCount,
      estimatedMinutes: reviewEstimateMinutes(schedule.specialty, attempt.allocatedSeconds),
      horizon: reviewHorizon(today, schedule.dueDate),
      ...(attempt.url ? { url: attempt.url } : {}),
    }];
  }).sort((left, right) => {
    const rank = { now: 0, soon: 1, later: 2 };
    return rank[left.horizon] - rank[right.horizon]
      || left.dueDate.localeCompare(right.dueDate)
      || right.lastAttemptDate.localeCompare(left.lastAttemptDate)
      || left.title.localeCompare(right.title);
  });
}

export function filterReviewQueue(items: ReviewQueueItem[], filters: ReviewQueueFilters) {
  const query = normalized(filters.search ?? "");
  const specialties = filters.specialties ?? new Set<ReviewQueueSpecialty>();
  const due = filters.due ?? "all";
  const sort = filters.sort ?? "priority";
  const rank = { now: 0, soon: 1, later: 2 };
  return items
    .filter((item) => !query || normalized([
      item.title,
      item.reasonLabel,
      item.specialty,
      item.previousResult ?? "",
    ].join(" ")).includes(query))
    .filter((item) => specialties.size === 0 || specialties.has(item.specialty))
    .filter((item) => {
      if (due === "now") return item.daysUntilDue <= 0;
      if (due === "week") return item.daysUntilDue <= 7;
      if (due === "month") return item.daysUntilDue <= 30;
      return true;
    })
    .sort((left, right) => {
      if (sort === "due") return left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title);
      if (sort === "review_time") return left.estimatedMinutes - right.estimatedMinutes || left.dueDate.localeCompare(right.dueDate);
      if (sort === "last_attempt") return right.lastAttemptDate.localeCompare(left.lastAttemptDate) || left.title.localeCompare(right.title);
      return rank[left.horizon] - rank[right.horizon]
        || left.dueDate.localeCompare(right.dueDate)
        || left.title.localeCompare(right.title);
    });
}

export function reviewStreakDays(attempts: ReviewQueueAttempt[], today: string) {
  const reviewDates = new Set(attempts.flatMap((attempt) => (
    attempt.reviewOfActivityId && (attempt.status === "completed" || attempt.status === "published")
      ? [attempt.date]
      : []
  )));
  const shift = (date: string, days: number) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  let cursor = reviewDates.has(today) ? today : shift(today, -1);
  let streak = 0;
  while (reviewDates.has(cursor)) {
    streak += 1;
    cursor = shift(cursor, -1);
  }
  return streak;
}

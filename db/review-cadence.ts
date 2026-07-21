export type ReviewReason = "failed" | "full_walkthrough" | "approach_review" | "manual" | "successful_recall";

export function reviewIntervalDays(reason: ReviewReason, priorIntervalDays?: number | null) {
  if (reason === "failed" || reason === "full_walkthrough") return 4;
  if (reason === "approach_review") return 7;
  if (reason === "successful_recall") return priorIntervalDays === 21 ? 60 : 21;
  return 7;
}

import type { ReviewQueueSpecialty } from "../db/review-queue-policy";

export type ReviewQueueDueFilter = "all" | "now" | "week" | "month";
export type ReviewQueueSort = "priority" | "due" | "review_time" | "last_attempt";

export type ReviewQueueUiState = {
  search: string;
  specialties: ReviewQueueSpecialty[];
  due: ReviewQueueDueFilter;
  sort: ReviewQueueSort;
  selectedKeys: string[];
};

export const REVIEW_QUEUE_UI_STORAGE_KEY = "interview-arc-review-queue-ui-v1";

export const EMPTY_REVIEW_QUEUE_UI_STATE: ReviewQueueUiState = {
  search: "",
  specialties: [],
  due: "all",
  sort: "priority",
  selectedKeys: [],
};

const SPECIALTIES = new Set<ReviewQueueSpecialty>([
  "leetcode",
  "system_design",
  "behavioral",
]);
const DUE_FILTERS = new Set<ReviewQueueDueFilter>(["all", "now", "week", "month"]);
const SORTS = new Set<ReviewQueueSort>(["priority", "due", "review_time", "last_attempt"]);

export function parseReviewQueueUiState(value: string | null): ReviewQueueUiState {
  if (!value) return EMPTY_REVIEW_QUEUE_UI_STATE;
  try {
    const parsed = JSON.parse(value) as Partial<Record<keyof ReviewQueueUiState, unknown>>;
    const specialties = Array.isArray(parsed.specialties)
      ? [...new Set(parsed.specialties.filter((item): item is ReviewQueueSpecialty => (
        typeof item === "string" && SPECIALTIES.has(item as ReviewQueueSpecialty)
      )))]
      : [];
    const selectedKeys = Array.isArray(parsed.selectedKeys)
      ? [...new Set(parsed.selectedKeys.filter((item): item is string => (
        typeof item === "string" && item.length > 0 && item.length <= 300
      )))].slice(0, 500)
      : [];
    return {
      search: typeof parsed.search === "string" ? parsed.search.slice(0, 500) : "",
      specialties,
      due: typeof parsed.due === "string" && DUE_FILTERS.has(parsed.due as ReviewQueueDueFilter)
        ? parsed.due as ReviewQueueDueFilter
        : "all",
      sort: typeof parsed.sort === "string" && SORTS.has(parsed.sort as ReviewQueueSort)
        ? parsed.sort as ReviewQueueSort
        : "priority",
      selectedKeys,
    };
  } catch {
    return EMPTY_REVIEW_QUEUE_UI_STATE;
  }
}

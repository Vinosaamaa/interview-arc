import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildReviewQueue,
  filterReviewQueue,
  reviewEstimateMinutes,
  reviewDeferralTarget,
  reviewHorizon,
  reviewStreakDays,
} from "../db/review-queue-policy.ts";
import {
  parseReviewQueueUiState,
  REVIEW_QUEUE_UI_STORAGE_KEY,
} from "../app/review-queue-state.ts";
import { buildPlanningBatch } from "../db/today-planning-policy.ts";

const attempts = [
  {
    id: "attempt-failed",
    questionId: "minimum-window",
    date: "2026-08-01",
    type: "leetcode",
    title: "Minimum Window Substring",
    status: "completed",
    outcome: "failed",
    allocatedSeconds: 2_400,
  },
  {
    id: "attempt-system",
    questionId: "rate-limiter",
    date: "2026-08-03",
    type: "system_design",
    title: "Design a Rate Limiter",
    status: "published",
    outcome: "solved_after_reviewing_approach",
    allocatedSeconds: 3_600,
  },
  {
    id: "attempt-running",
    questionId: "running",
    date: "2026-08-09",
    type: "behavioral",
    title: "Still running",
    status: "running",
    allocatedSeconds: 3_600,
  },
];

const schedules = [
  {
    reviewKey: "leetcode:minimum-window",
    activityId: "attempt-failed",
    questionId: "minimum-window",
    specialty: "leetcode",
    status: "due",
    reason: "failed",
    dueDate: "2026-08-08",
    intervalDays: 4,
    stage: 0,
    reviewCount: 0,
  },
  {
    reviewKey: "system_design:rate-limiter",
    activityId: "attempt-system",
    questionId: "rate-limiter",
    specialty: "system_design",
    status: "scheduled",
    reason: "approach_review",
    dueDate: "2026-08-15",
    intervalDays: 7,
    stage: 0,
    reviewCount: 1,
  },
  {
    reviewKey: "behavioral:running",
    activityId: "attempt-running",
    questionId: "running",
    specialty: "behavioral",
    status: "scheduled",
    reason: "manual",
    dueDate: "2026-08-09",
    intervalDays: 7,
    stage: 0,
    reviewCount: 0,
  },
];

test("the Review Queue joins active schedules only to completed authoritative attempts", () => {
  const queue = buildReviewQueue(attempts, schedules, "2026-08-09");
  assert.deepEqual(queue.map((item) => item.reviewKey), [
    "leetcode:minimum-window",
    "system_design:rate-limiter",
  ]);
  assert.equal(queue[0].horizon, "now");
  assert.match(queue[0].reasonLabel, /Failed attempt/);
  assert.equal(queue[0].estimatedMinutes, 20);
  assert.equal(queue[1].horizon, "soon");
  assert.match(queue[1].reasonLabel, /Solved with help/);
  assert.equal(queue[1].estimatedMinutes, 30);
});

test("review horizons, filters, and sorting use deterministic Pacific dates", () => {
  assert.equal(reviewDeferralTarget("2026-12-28"), "2027-01-04");
  assert.equal(reviewHorizon("2026-08-09", "2026-08-09"), "now");
  assert.equal(reviewHorizon("2026-08-09", "2026-08-16"), "soon");
  assert.equal(reviewHorizon("2026-08-09", "2026-08-17"), "later");
  const queue = buildReviewQueue(attempts, schedules, "2026-08-09");
  assert.deepEqual(
    filterReviewQueue(queue, { search: "rate limiter", specialties: new Set(["system_design"]) })
      .map((item) => item.activityId),
    ["attempt-system"],
  );
  assert.deepEqual(filterReviewQueue(queue, { due: "now" }).map((item) => item.activityId), ["attempt-failed"]);
  assert.deepEqual(filterReviewQueue(queue, { sort: "review_time" }).map((item) => item.estimatedMinutes), [20, 30]);
});

test("review estimates and streaks are derived only from persisted attempt evidence", () => {
  assert.equal(reviewEstimateMinutes("leetcode", 0), 20);
  assert.equal(reviewEstimateMinutes("behavioral", 3_600), 30);
  assert.equal(reviewStreakDays([
    { ...attempts[0], id: "review-a", date: "2026-08-09", reviewOfActivityId: "origin-a" },
    { ...attempts[0], id: "review-b", date: "2026-08-08", reviewOfActivityId: "origin-b" },
    { ...attempts[0], id: "ordinary", date: "2026-08-07", reviewOfActivityId: undefined },
  ], "2026-08-09"), 2);
});

test("review planning preserves the source attempt and reason in the Today activity", () => {
  const batch = buildPlanningBatch({
    date: "2026-08-09",
    workbenchId: "workbench-1",
    mutationId: "review-queue-operation-1",
    destination: "standalone",
    sessionNumber: 1,
    selections: [{
      kind: "practice",
      specialty: "leetcode",
      questionId: "minimum-window",
      title: "Minimum Window Substring",
      minutes: 20,
      reviewOfActivityId: "attempt-failed",
      reviewReason: "failed",
    }],
  });
  assert.equal(batch.activities[0].reviewOfActivityId, "attempt-failed");
  assert.equal(batch.activities[0].reviewReason, "failed");
  assert.equal(batch.activities[0].allocatedSeconds, 1_200);
});

test("Review Queue UI state restores only supported filters, sort order, and selections", () => {
  assert.deepEqual(parseReviewQueueUiState(JSON.stringify({
    search: "window",
    specialties: ["leetcode", "unsupported", "leetcode"],
    due: "week",
    sort: "review_time",
    selectedKeys: ["review-a", "review-a", "", 42],
  })), {
    search: "window",
    specialties: ["leetcode"],
    due: "week",
    sort: "review_time",
    selectedKeys: ["review-a"],
  });
  assert.deepEqual(parseReviewQueueUiState("not-json"), {
    search: "",
    specialties: [],
    due: "all",
    sort: "priority",
    selectedKeys: [],
  });
});

test("Review Queue persists its scoped UI state in session storage", async () => {
  const view = await readFile(new URL("../app/review-queue-view.tsx", import.meta.url), "utf8");
  assert.match(view, /window\.sessionStorage\.getItem\(REVIEW_QUEUE_UI_STORAGE_KEY\)/);
  assert.match(view, /window\.sessionStorage\.setItem\(REVIEW_QUEUE_UI_STORAGE_KEY, JSON\.stringify\(uiState\)\)/);
  assert.equal(REVIEW_QUEUE_UI_STORAGE_KEY, "interview-arc-review-queue-ui-v1");
});

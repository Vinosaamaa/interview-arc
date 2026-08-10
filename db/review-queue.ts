import { and, eq, or } from "drizzle-orm";
import { getDb } from "./index";
import { reviewSchedules } from "./schema";
import { readLiveState } from "./live-state";
import { applyPlanningSelection, readPlanningMutation } from "./today-planning";
import {
  planningRequestFingerprint,
} from "./today-planning-policy";
import {
  reviewDeferralTarget,
  reviewEstimateMinutes,
  type ReviewQueueReason,
} from "./review-queue-policy";

export class ReviewQueueConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReviewQueueConflictError";
    this.code = code;
  }
}

export async function deferReviewToNextWeek(
  ownerId: string,
  input: { reviewKey: string; expectedDueDate: string; today: string },
  now = Date.now(),
) {
  const db = getDb();
  const targetDueDate = reviewDeferralTarget(input.today);
  const rows = await db.select().from(reviewSchedules).where(and(
    eq(reviewSchedules.ownerId, ownerId),
    eq(reviewSchedules.reviewKey, input.reviewKey),
  ));
  const current = rows[0];
  if (!current || current.status === "completed" || current.status === "dismissed") {
    throw new ReviewQueueConflictError(
      "review_not_available",
      "That review is no longer available. Refresh the queue before changing it.",
    );
  }
  if (current.dueDate === targetDueDate && current.status === "scheduled") {
    return { duplicate: true, review: current };
  }
  if (current.dueDate !== input.expectedDueDate) {
    throw new ReviewQueueConflictError(
      "stale_review_schedule",
      "That review schedule changed in another surface. Refresh the queue before deferring it.",
    );
  }

  const updated = await db.update(reviewSchedules).set({
    status: "scheduled",
    dueDate: targetDueDate,
    updatedAt: now,
  }).where(and(
    eq(reviewSchedules.ownerId, ownerId),
    eq(reviewSchedules.reviewKey, input.reviewKey),
    eq(reviewSchedules.dueDate, input.expectedDueDate),
    or(eq(reviewSchedules.status, "scheduled"), eq(reviewSchedules.status, "due")),
  )).returning();
  if (updated[0]) return { duplicate: false, review: updated[0] };

  const concurrent = await db.select().from(reviewSchedules).where(and(
    eq(reviewSchedules.ownerId, ownerId),
    eq(reviewSchedules.reviewKey, input.reviewKey),
  ));
  if (concurrent[0]?.dueDate === targetDueDate && concurrent[0].status === "scheduled") {
    return { duplicate: true, review: concurrent[0] };
  }
  throw new ReviewQueueConflictError(
    "stale_review_schedule",
    "That review schedule changed during deferral. Refresh the queue before retrying.",
  );
}

export async function addReviewQueueItemsToToday(
  ownerId: string,
  input: {
    date: string;
    expectedWorkbenchId: string;
    mutationId: string;
    reviewKeys: string[];
  },
  now = Date.now(),
) {
  const uniqueKeys = [...new Set(input.reviewKeys)];
  if (uniqueKeys.length !== input.reviewKeys.length) {
    throw new ReviewQueueConflictError("duplicate_review_selection", "Select each review only once.");
  }
  const requestIdentity = await planningRequestFingerprint({
    operation: "review_queue_add",
    date: input.date,
    expectedWorkbenchId: input.expectedWorkbenchId,
    reviewKeys: input.reviewKeys,
  });
  const priorReceipt = await readPlanningMutation(ownerId, input.mutationId);
  if (priorReceipt) {
    const prior = priorReceipt.response;
    if (!prior || typeof prior !== "object"
      || (prior as { specialistRequestHash?: unknown }).specialistRequestHash !== requestIdentity) {
      throw new ReviewQueueConflictError(
        "planning_mutation_identity_conflict",
        "That Review Queue mutation identifier was already used for different content.",
      );
    }
    return { duplicate: true, result: priorReceipt.response };
  }

  const state = await readLiveState(ownerId, input.date, { includeAll: true });
  const schedules = Object.values(state.reviews) as Array<{
    reviewKey: string;
    activityId: string;
    questionId: string | null;
    specialty: "leetcode" | "system_design" | "behavioral";
    status: "scheduled" | "due" | "completed" | "dismissed";
    reason: ReviewQueueReason;
  }>;
  const historyActivities = state.historyActivities as Array<{
    id: string;
    questionId?: string;
    type: "leetcode" | "system_design" | "behavioral";
    title: string;
    url?: string;
    prompt?: string;
    allocatedSeconds: number;
  }>;
  const selections = uniqueKeys.map((reviewKey) => {
    const schedule = schedules.find((candidate) => candidate.reviewKey === reviewKey);
    if (!schedule || schedule.status === "completed" || schedule.status === "dismissed") {
      throw new ReviewQueueConflictError(
        "review_not_available",
        "One selected review is no longer available. Refresh the queue before adding it.",
      );
    }
    const activity = historyActivities.find((candidate) => candidate.id === schedule.activityId);
    const timer = state.timers[schedule.activityId];
    if (!activity || !timer?.completed || activity.type !== schedule.specialty || typeof activity.title !== "string") {
      throw new ReviewQueueConflictError(
        "review_source_not_completed",
        "A review can be added only from an authoritative completed practice attempt.",
      );
    }
    return {
      kind: "practice" as const,
      specialty: schedule.specialty,
      questionId: schedule.questionId ?? activity.questionId,
      title: activity.title,
      ...(activity.url ? { url: activity.url } : {}),
      ...(activity.prompt ? { prompt: activity.prompt } : {}),
      minutes: reviewEstimateMinutes(schedule.specialty, activity.allocatedSeconds),
      reviewOfActivityId: schedule.activityId,
      reviewReason: schedule.reason,
    };
  });
  return applyPlanningSelection(ownerId, {
    date: input.date,
    workbenchId: input.expectedWorkbenchId,
    mutationId: input.mutationId,
    destination: "standalone",
    sessionNumber: 1,
    selections,
    specialistRequestHash: requestIdentity,
  }, now);
}

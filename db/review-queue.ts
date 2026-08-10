import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./index";
import { extraActivities, reviewSchedules, timers } from "./schema";
import { applyPlanningSelection, readPlanningMutation } from "./today-planning";
import {
  planningRequestFingerprint,
} from "./today-planning-policy";
import {
  reviewDeferralTarget,
  reviewEstimateMinutes,
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
    expectedWorkbenchRevision: number;
    mutationId: string;
    reviewKeys: string[];
  },
  now = Date.now(),
) {
  const uniqueKeys = [...new Set(input.reviewKeys)];
  if (uniqueKeys.length === 0) {
    throw new ReviewQueueConflictError("empty_review_selection", "Select at least one review.");
  }
  if (uniqueKeys.length !== input.reviewKeys.length) {
    throw new ReviewQueueConflictError("duplicate_review_selection", "Select each review only once.");
  }
  const requestIdentity = await planningRequestFingerprint({
    operation: "review_queue_add",
    date: input.date,
    expectedWorkbenchId: input.expectedWorkbenchId,
    expectedWorkbenchRevision: input.expectedWorkbenchRevision,
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

  const db = getDb();
  const schedules = await db.select().from(reviewSchedules).where(and(
    eq(reviewSchedules.ownerId, ownerId),
    inArray(reviewSchedules.reviewKey, uniqueKeys),
  ));
  const schedulesByKey = new Map(schedules.map((schedule) => [schedule.reviewKey, schedule]));
  const sourceActivityIds = [...new Set(schedules.map((schedule) => schedule.activityId))];
  const [activityRows, timerRows] = sourceActivityIds.length > 0
    ? await Promise.all([
      db.select().from(extraActivities).where(and(
        eq(extraActivities.ownerId, ownerId),
        inArray(extraActivities.id, sourceActivityIds),
      )),
      db.select().from(timers).where(and(
        eq(timers.ownerId, ownerId),
        eq(timers.kind, "activity"),
        inArray(timers.subjectId, sourceActivityIds),
      )),
    ])
    : [[], []];
  type SourceActivity = {
    id: string;
    questionId?: string;
    type: "leetcode" | "system_design" | "behavioral";
    title: string;
    url?: string;
    prompt?: string;
    allocatedSeconds: number;
  };
  const activitiesById = new Map(activityRows.map((row) => [
    row.id,
    row.payload as SourceActivity,
  ]));
  const timersByActivityId = new Map(timerRows.map((timer) => [timer.subjectId, timer]));
  const selections = uniqueKeys.map((reviewKey) => {
    const schedule = schedulesByKey.get(reviewKey);
    if (!schedule || schedule.status === "completed" || schedule.status === "dismissed") {
      throw new ReviewQueueConflictError(
        "review_not_available",
        "One selected review is no longer available. Refresh the queue before adding it.",
      );
    }
    const activity = activitiesById.get(schedule.activityId);
    const timer = timersByActivityId.get(schedule.activityId);
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
    expectedWorkbenchRevision: input.expectedWorkbenchRevision,
    mutationId: input.mutationId,
    destination: "standalone",
    sessionNumber: 1,
    selections,
    specialistRequestHash: requestIdentity,
  }, now);
}

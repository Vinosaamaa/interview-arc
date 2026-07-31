import { and, eq } from "drizzle-orm";
import { getDb } from "./index";
import {
  extraActivities,
  focusBlocks,
  liveSessions,
  todayPlanningMutations,
} from "./schema";
import { ensureOpenWorkbench } from "./live-state";
import {
  buildPlanningBatch,
  planningRequestFingerprint,
  type PlanningSelection,
} from "./today-planning-policy";

export class TodayPlanningConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TodayPlanningConflictError";
    this.code = code;
  }
}

export type AddPlanningSelectionInput = {
  date: string;
  workbenchId: string;
  mutationId: string;
  destination: "standalone" | "session";
  sessionNumber: number;
  selections: PlanningSelection[];
};

export async function readPlanningMutation(
  ownerId: string,
  mutationId: string,
) {
  const rows = await getDb()
    .select()
    .from(todayPlanningMutations)
    .where(and(
      eq(todayPlanningMutations.ownerId, ownerId),
      eq(todayPlanningMutations.mutationId, mutationId),
    ));
  return rows[0] ?? null;
}

export async function rememberPlanningMutation(
  ownerId: string,
  input: {
    mutationId: string;
    workbenchId: string;
    requestHash: string;
    response: unknown;
    createdAt: number;
  },
) {
  await getDb().insert(todayPlanningMutations).values({
    ownerId,
    mutationId: input.mutationId,
    workbenchId: input.workbenchId,
    requestHash: input.requestHash,
    response: input.response,
    createdAt: input.createdAt,
  }).onConflictDoNothing();
}

export async function applyPlanningSelection(
  ownerId: string,
  input: AddPlanningSelectionInput,
  now = Date.now(),
) {
  const requestHash = await planningRequestFingerprint(input);
  const existingReceipt = await readPlanningMutation(ownerId, input.mutationId);
  if (existingReceipt) {
    if (existingReceipt.requestHash !== requestHash) {
      throw new TodayPlanningConflictError(
        "planning_mutation_identity_conflict",
        "That planning mutation identifier was already used for different content.",
      );
    }
    return { duplicate: true, result: existingReceipt.response };
  }

  const workbench = await ensureOpenWorkbench(ownerId, input.date, now);
  if (workbench.id !== input.workbenchId) {
    throw new TodayPlanningConflictError(
      "stale_workbench",
      "Today changed in another surface. Refresh the planner and review the selection.",
    );
  }

  const db = getDb();
  const [currentActivities, currentFocusBlocks] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, workbench.id),
    )),
    db.select().from(focusBlocks).where(and(
      eq(focusBlocks.ownerId, ownerId),
      eq(focusBlocks.workbenchId, workbench.id),
    )),
  ]);
  const questionIds = new Set(currentActivities.flatMap((row) => {
    const questionId = (row.payload as { questionId?: unknown }).questionId;
    return typeof questionId === "string" ? [questionId] : [];
  }));
  const normalizedTitles = new Set([
    ...currentActivities.map((row) => (
      String((row.payload as { title?: unknown }).title ?? "").trim().toLowerCase()
    )),
    ...currentFocusBlocks.map((row) => row.title.trim().toLowerCase()),
  ]);
  for (const selection of input.selections) {
    if (
      selection.kind === "practice"
      && selection.questionId
      && questionIds.has(selection.questionId)
    ) {
      throw new TodayPlanningConflictError(
        "already_planned",
        `${selection.title} is already on Today.`,
      );
    }
    if (normalizedTitles.has(selection.title.trim().toLowerCase())) {
      throw new TodayPlanningConflictError(
        "already_planned",
        `${selection.title} is already on Today.`,
      );
    }
  }

  const built = buildPlanningBatch(input);
  const response = {
    mutationId: input.mutationId,
    workbenchId: workbench.id,
    activityIds: built.activities.map((activity) => activity.id),
    focusBlockIds: built.focusBlocks.map((block) => block.id),
    sessionId: built.session?.id ?? null,
  };
  const statements = [
    ...built.activities.map((activity) => db.insert(extraActivities).values({
      ownerId,
      id: activity.id,
      date: input.date,
      workbenchId: workbench.id,
      payload: { ...activity, workbenchId: workbench.id },
      revision: 1,
      updatedAt: now,
    }).onConflictDoNothing()),
    ...built.focusBlocks.map((block) => db.insert(focusBlocks).values({
      ownerId,
      id: block.id,
      workbenchId: workbench.id,
      date: block.date,
      category: block.focusCategory,
      title: block.title,
      plannedSeconds: block.plannedSeconds,
      note: block.note ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()),
    ...(built.session ? [db.insert(liveSessions).values({
      ownerId,
      id: built.session.id,
      date: input.date,
      workbenchId: workbench.id,
      payload: built.session,
      revision: 1,
      updatedAt: now,
    }).onConflictDoNothing()] : []),
    db.insert(todayPlanningMutations).values({
      ownerId,
      mutationId: input.mutationId,
      workbenchId: workbench.id,
      requestHash,
      response,
      createdAt: now,
    }).onConflictDoNothing(),
  ];
  await db.batch(statements as [
    (typeof statements)[number],
    ...(typeof statements)[number][],
  ]);
  return { duplicate: false, result: response };
}

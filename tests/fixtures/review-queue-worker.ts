import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  addReviewQueueItemsToToday,
  ReviewQueueConflictError,
} from "../../db/review-queue";
import {
  executePracticeStateCommand,
  PracticeStateCommandInputError,
  type PracticeStateCommand,
} from "../../db/practice-state-commands";
import {
  extraActivities,
  focusBlocks,
  liveSessions,
  outcomes,
  reviewSchedules,
  timers,
  todayPlanningMutations,
} from "../../db/schema";
import { TodayPlanningConflictError } from "../../db/today-planning";

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/inspect") {
      const ownerId = url.searchParams.get("ownerId");
      const workbenchId = url.searchParams.get("workbenchId");
      if (!ownerId || !workbenchId) return Response.json({ error: "Missing inspection scope." }, { status: 400 });
      const db = getDb();
      const [activities, focus, sessions, resultRows, reviewRows, timerRows, receipts] = await Promise.all([
        db.select().from(extraActivities).where(and(
          eq(extraActivities.ownerId, ownerId),
          eq(extraActivities.workbenchId, workbenchId),
        )),
        db.select().from(focusBlocks).where(and(
          eq(focusBlocks.ownerId, ownerId),
          eq(focusBlocks.workbenchId, workbenchId),
        )),
        db.select().from(liveSessions).where(and(
          eq(liveSessions.ownerId, ownerId),
          eq(liveSessions.workbenchId, workbenchId),
        )),
        db.select().from(outcomes).where(eq(outcomes.ownerId, ownerId)),
        db.select().from(reviewSchedules).where(eq(reviewSchedules.ownerId, ownerId)),
        db.select().from(timers).where(eq(timers.ownerId, ownerId)),
        db.select().from(todayPlanningMutations).where(eq(todayPlanningMutations.ownerId, ownerId)),
      ]);
      return Response.json({
        activities,
        focusBlocks: focus,
        outcomes: resultRows,
        reviewSchedules: reviewRows,
        sessions,
        timers: timerRows,
        receipts,
      });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 404 });
    }
    try {
      if (url.pathname === "/practice-command") {
        const body = await request.json() as {
          ownerId?: string;
          date?: string;
          now?: number;
          command?: PracticeStateCommand;
        };
        if (!body.ownerId || !body.date || !body.command) {
          return Response.json({ error: "Missing test command." }, { status: 400 });
        }
        return Response.json(await executePracticeStateCommand(
          body.ownerId,
          body.date,
          body.command,
          body.now ?? Date.now(),
        ));
      }
      if (url.pathname !== "/review-add") return new Response(null, { status: 404 });
      const body = await request.json() as {
        ownerId?: string;
        now?: number;
        input?: Parameters<typeof addReviewQueueItemsToToday>[1];
      };
      if (!body.ownerId || !body.input) {
        return Response.json({ error: "Missing test input." }, { status: 400 });
      }
      return Response.json(await addReviewQueueItemsToToday(
        body.ownerId,
        body.input,
        body.now ?? Date.now(),
      ));
    } catch (error) {
      if (error instanceof PracticeStateCommandInputError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof ReviewQueueConflictError || error instanceof TodayPlanningConflictError) {
        return Response.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
    }
  },
};

export default worker;

import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  addReviewQueueItemsToToday,
  ReviewQueueConflictError,
} from "../../db/review-queue";
import { extraActivities, todayPlanningMutations } from "../../db/schema";
import { TodayPlanningConflictError } from "../../db/today-planning";

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/inspect") {
      const ownerId = url.searchParams.get("ownerId");
      const workbenchId = url.searchParams.get("workbenchId");
      if (!ownerId || !workbenchId) return Response.json({ error: "Missing inspection scope." }, { status: 400 });
      const db = getDb();
      const [activities, receipts] = await Promise.all([
        db.select().from(extraActivities).where(and(
          eq(extraActivities.ownerId, ownerId),
          eq(extraActivities.workbenchId, workbenchId),
        )),
        db.select().from(todayPlanningMutations).where(eq(todayPlanningMutations.ownerId, ownerId)),
      ]);
      return Response.json({ activities, receipts });
    }
    if (request.method !== "POST" || url.pathname !== "/review-add") {
      return new Response(null, { status: 404 });
    }
    try {
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
      if (error instanceof ReviewQueueConflictError || error instanceof TodayPlanningConflictError) {
        return Response.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
    }
  },
};

export default worker;

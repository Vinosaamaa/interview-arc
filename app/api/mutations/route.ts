import { env } from "cloudflare:workers";

import { readLiveState, TimerStateConflictError } from "../../../db/live-state";
import { resolveOwnerId } from "../../../db/owner";
import {
  executePracticeStateCommand,
  PracticeStateCommandInputError,
  type PracticeStateCommand,
} from "../../../db/practice-state-commands";
import { ReviewQueueConflictError } from "../../../db/review-queue";
import { TodayPlanningConflictError } from "../../../db/today-planning";
import { publishOwnerLiveUpdate } from "../../../worker/live-update-hub";
import { toRouteErrorMessage } from "../route-helpers";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { date?: string; mutation?: PracticeStateCommand };
    const date = body.date;
    const mutation = body.mutation;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "A valid `date` (YYYY-MM-DD) is required." }, { status: 400 });
    }
    if (!mutation || typeof mutation !== "object") {
      return Response.json({ error: "A `mutation` object is required." }, { status: 400 });
    }

    const ownerId = await resolveOwnerId(request);
    const result = await executePracticeStateCommand(ownerId, date, mutation, Date.now());
    const state = await readLiveState(ownerId, date);
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, result.updateScope);
    return Response.json({
      ...state,
      ...(result.mutationReceipt ? { mutationReceipt: result.mutationReceipt } : {}),
    });
  } catch (error) {
    if (error instanceof PracticeStateCommandInputError) {
      return Response.json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
      }, { status: error.status });
    }
    if (error instanceof ReviewQueueConflictError || error instanceof TodayPlanningConflictError) {
      return Response.json({ error: error.message, code: error.code, retryable: false }, { status: 409 });
    }
    if (error instanceof TimerStateConflictError) {
      return Response.json({ error: error.message, retryable: false }, { status: 409 });
    }
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

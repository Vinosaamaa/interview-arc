import { env } from "cloudflare:workers";
import { z } from "zod";

import {
  BehavioralTargetProfileError,
  changeBehavioralTargetProfileState,
  queryBehavioralTargetProfiles,
  upsertBehavioralTargetProfile,
} from "../../../db/behavioral-target-profile";
import {
  behavioralTargetProfileStateWriteSchema,
  behavioralTargetProfileWriteSchema,
} from "../../../db/behavioral-target-profile-policy";
import { resolveOwnerId } from "../../../db/owner";
import { publishOwnerLiveUpdate } from "../../../worker/live-update-hub";
import { toRouteErrorMessage } from "../route-helpers";

function targetError(error: unknown) {
  if (error instanceof BehavioralTargetProfileError) {
    const conflict = error.code.includes("conflict") || error.code.includes("not_found");
    return Response.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: conflict ? 409 : 400 });
  }
  if (error instanceof z.ZodError) return Response.json({ error: "The Target Profile request is invalid.", retryable: false }, { status: 400 });
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const targetId = url.searchParams.get("targetId") || undefined;
    const revisionValue = url.searchParams.get("revision");
    const revision = revisionValue ? Number(revisionValue) : undefined;
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const ownerId = await resolveOwnerId(request);
    const result = await queryBehavioralTargetProfiles(ownerId, { targetId, revision, includeArchived });
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return targetError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; input?: unknown };
    const action = z.enum(["upsert", "set_state"]).parse(body.action);
    const ownerId = await resolveOwnerId(request);
    const result = action === "set_state"
      ? await changeBehavioralTargetProfileState(ownerId, behavioralTargetProfileStateWriteSchema.parse(body.input))
      : await upsertBehavioralTargetProfile(ownerId, behavioralTargetProfileWriteSchema.parse(body.input));
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "behavioral_target");
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return targetError(error);
  }
}

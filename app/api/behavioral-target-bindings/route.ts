import { env } from "cloudflare:workers";
import { z } from "zod";

import {
  BehavioralTargetProfileError,
  readBehavioralTargetBinding,
  resolveBehavioralTarget,
  setBehavioralTargetBinding,
} from "../../../db/behavioral-target-profile";
import { behavioralTargetBindingWriteSchema } from "../../../db/behavioral-target-profile-policy";
import { resolveOwnerId } from "../../../db/owner";
import { publishOwnerLiveUpdate } from "../../../worker/live-update-hub";
import { toRouteErrorMessage } from "../route-helpers";

const scopeQuerySchema = z.object({
  scopeType: z.enum(["session", "activity"]),
  scopeId: z.string().min(1).max(200),
}).strict();

function safeBinding(binding: Awaited<ReturnType<typeof readBehavioralTargetBinding>>) {
  if (!binding) return null;
  return {
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
    targetId: binding.targetId,
    targetRevision: binding.targetRevision,
    revision: binding.revision,
    updatedAt: binding.updatedAt,
  };
}

function safeResolution(resolution: Awaited<ReturnType<typeof resolveBehavioralTarget>>) {
  return {
    ...resolution,
    binding: resolution.binding ? safeBinding(resolution.binding) : null,
  };
}

function targetError(error: unknown) {
  if (error instanceof BehavioralTargetProfileError) {
    const status = error.code.includes("conflict") || error.code.includes("not_found") ? 409 : 400;
    return Response.json({ error: error.message, code: error.code, retryable: error.retryable }, { status });
  }
  if (error instanceof z.ZodError) return Response.json({ error: "The target-binding request is invalid.", retryable: false }, { status: 400 });
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = scopeQuerySchema.parse({
      scopeType: url.searchParams.get("scopeType"),
      scopeId: url.searchParams.get("scopeId"),
    });
    const ownerId = await resolveOwnerId(request);
    const [directBinding, resolution] = await Promise.all([
      readBehavioralTargetBinding(ownerId, query.scopeType, query.scopeId),
      resolveBehavioralTarget(ownerId, query.scopeType === "activity"
        ? { activityId: query.scopeId }
        : { sessionId: query.scopeId }),
    ]);
    return Response.json({
      directBinding: safeBinding(directBinding),
      resolution: safeResolution(resolution),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return targetError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const result = await setBehavioralTargetBinding(ownerId, behavioralTargetBindingWriteSchema.parse(await request.json()));
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "behavioral_target");
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return targetError(error);
  }
}

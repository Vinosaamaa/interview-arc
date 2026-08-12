import { z } from "zod";

import {
  BehavioralTargetProfileError,
  readBehavioralTargetBinding,
  rejectLegacyTargetProfileWrite,
  resolveBehavioralTarget,
} from "../../../db/behavioral-target-profile";
import { behavioralTargetStableIdSchema } from "../../../db/behavioral-target-profile-policy";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

const scopeQuerySchema = z.object({
  scopeType: z.enum(["session", "activity"]),
  scopeId: behavioralTargetStableIdSchema,
}).strict();
const encodedScopeSchema = z.string().regex(/^(session|activity):[a-z0-9][a-z0-9._-]{0,199}$/);

async function readScope(ownerId: string, query: z.infer<typeof scopeQuerySchema>) {
  const [directBinding, resolution] = await Promise.all([
    readBehavioralTargetBinding(ownerId, query.scopeType, query.scopeId),
    resolveBehavioralTarget(ownerId, query.scopeType === "activity"
      ? { activityId: query.scopeId }
      : { sessionId: query.scopeId }),
  ]);
  return {
    scope: { type: query.scopeType, id: query.scopeId },
    directBinding: safeBinding(directBinding),
    resolution: safeResolution(resolution),
  };
}

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
    const status = error.code.includes("conflict")
      || error.code.includes("not_found")
      || error.code === "behavioral_target_migration_only"
      ? 409
      : 400;
    return Response.json({ error: error.message, code: error.code, retryable: error.retryable }, { status });
  }
  if (error instanceof z.ZodError) return Response.json({ error: "The target-binding request is invalid.", retryable: false }, { status: 400 });
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedScopes = url.searchParams.getAll("scope");
    const queries = requestedScopes.length
      ? z.array(encodedScopeSchema).min(1).max(50).parse(requestedScopes).map((value) => {
          const [scopeType, scopeId] = value.split(":");
          return scopeQuerySchema.parse({ scopeType, scopeId });
        })
      : [scopeQuerySchema.parse({
          scopeType: url.searchParams.get("scopeType"),
          scopeId: url.searchParams.get("scopeId"),
        })];
    const ownerId = await resolveOwnerId(request);
    const bindings = await Promise.all(queries.map((query) => readScope(ownerId, query)));
    return Response.json(requestedScopes.length ? { bindings } : bindings[0], {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return targetError(error);
  }
}

export async function POST(request: Request) {
  try {
    await resolveOwnerId(request);
    rejectLegacyTargetProfileWrite();
  } catch (error) {
    return targetError(error);
  }
}

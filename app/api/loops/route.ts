import { ZodError } from "zod";

import { LoopError, queryLoops, queryRoleBriefMigrationInbox } from "../../../db/loops";
import { createLoopFromWebsite } from "../../../db/loop-website";
import { resolveOwnerId } from "../../../db/owner";
import { readBoundedJson, RouteBodyTooLargeError, toRouteErrorMessage } from "../route-helpers";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

function traceLoopCreate(phase: string, resultCode: string, startedAt: number, counts: { stageCount?: number; unknownCount?: number } = {}) {
  console.info("interview_arc_loop_command", JSON.stringify({
    operation: "create_loop",
    phase,
    result_code: resultCode,
    stage_count: counts.stageCount ?? 0,
    unknown_count: counts.unknownCount ?? 0,
    duration_ms: Math.max(0, Date.now() - startedAt),
  }));
}

function isSameOriginMutation(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const [loops, migrationInbox] = await Promise.all([
      queryLoops(ownerId, { includeArchived }),
      queryRoleBriefMigrationInbox(ownerId, {}),
    ]);
    return Response.json(
      { ...loops, migrationInbox: migrationInbox.items },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let counts: { stageCount?: number; unknownCount?: number } = {};
  try {
    if (!isSameOriginMutation(request)) {
      traceLoopCreate("authorize", "cross_origin_rejected", startedAt);
      return Response.json({ error: "Cross-origin Loop creation is not allowed.", code: "cross_origin_rejected" }, {
        status: 403,
        headers: PRIVATE_HEADERS,
      });
    }
    const ownerId = await resolveOwnerId(request);
    const body = await readBoundedJson(request, 160_000);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const draft = body as { operationId?: unknown; stages?: unknown; unknowns?: unknown };
      counts = {
        stageCount: Array.isArray(draft.stages) ? draft.stages.length : 0,
        unknownCount: Array.isArray(draft.unknowns) ? draft.unknowns.length : 0,
      };
      if (!idempotencyKey || idempotencyKey !== draft.operationId) {
        traceLoopCreate("validate", "idempotency_key_invalid", startedAt, counts);
        return Response.json({ error: "The idempotency key is missing or does not match this Loop draft.", code: "idempotency_key_invalid" }, {
          status: 400,
          headers: PRIVATE_HEADERS,
        });
      }
    }
    traceLoopCreate("apply", "started", startedAt, counts);
    const result = await createLoopFromWebsite(ownerId, body);
    traceLoopCreate("apply", result.duplicate ? "duplicate" : "created", startedAt, counts);
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    const status = error instanceof RouteBodyTooLargeError
      ? 413
      : error instanceof ZodError
        ? 400
        : error instanceof LoopError
          ? 409
          : 500;
    const code = error instanceof RouteBodyTooLargeError
      ? "request_too_large"
      : error instanceof ZodError
        ? "invalid_loop"
        : error instanceof LoopError
          ? error.code
          : "loop_create_failed";
    traceLoopCreate("apply", code, startedAt, counts);
    return Response.json({
      error: error instanceof ZodError ? error.issues[0]?.message ?? "The Loop form is invalid." : toRouteErrorMessage(error),
      code,
      retryable: error instanceof LoopError ? error.retryable : status >= 500,
    }, { status, headers: PRIVATE_HEADERS });
  }
}

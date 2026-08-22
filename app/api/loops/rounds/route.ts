import { ZodError } from "zod";

import { LoopError } from "../../../../db/loops";
import { addLoopRoundFromWebsite } from "../../../../db/loop-website";
import { resolveOwnerId } from "../../../../db/owner";
import { readBoundedJson, RouteBodyTooLargeError, toRouteErrorMessage } from "../../route-helpers";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

function traceRound(phase: string, resultCode: string, startedAt: number) {
  console.info("interview_arc_loop_command", JSON.stringify({
    operation: "add_loop_round",
    phase,
    result_code: resultCode,
    duration_ms: Math.max(0, Date.now() - startedAt),
  }));
}

function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    if (!sameOrigin(request)) {
      traceRound("authorize", "cross_origin_rejected", startedAt);
      return Response.json({ error: "Cross-origin Round creation is not allowed.", code: "cross_origin_rejected" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    const ownerId = await resolveOwnerId(request);
    const body = await readBoundedJson(request, 16_000);
    const operationId = body && typeof body === "object" && !Array.isArray(body) ? String((body as { operationId?: unknown }).operationId ?? "") : "";
    if (!operationId || request.headers.get("idempotency-key")?.trim() !== operationId) {
      traceRound("validate", "idempotency_key_invalid", startedAt);
      return Response.json({ error: "The idempotency key is missing or does not match this Round draft.", code: "idempotency_key_invalid" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    traceRound("apply", "started", startedAt);
    const result = await addLoopRoundFromWebsite(ownerId, body);
    traceRound("apply", result.duplicate ? "duplicate" : "created", startedAt);
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    const status = error instanceof RouteBodyTooLargeError ? 413 : error instanceof ZodError ? 400 : error instanceof LoopError ? 409 : 500;
    const code = error instanceof RouteBodyTooLargeError ? "request_too_large" : error instanceof ZodError ? "invalid_round" : error instanceof LoopError ? error.code : "round_create_failed";
    traceRound("apply", code, startedAt);
    return Response.json({
      error: error instanceof ZodError ? error.issues[0]?.message ?? "The Round form is invalid." : toRouteErrorMessage(error),
      code,
      retryable: error instanceof LoopError ? error.retryable : status >= 500,
    }, { status, headers: PRIVATE_HEADERS });
  }
}

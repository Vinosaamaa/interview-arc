import { env } from "cloudflare:workers";
import { ZodError } from "zod";

import {
  addInterviewPackageEntry,
  assignInterviewPackage,
  confirmInterviewPackageMaterialProposal,
  createInterviewPackage,
  finalizeInterviewPackage,
  InterviewPackageError,
  linkInterviewPackageMaterial,
  prepareInterviewPackageMaterialProposal,
  queryInterviewPackages,
  reviseInterviewPackageEntry,
} from "../../../db/interview-packages";
import {
  cancelInterviewPackageUpload,
  completeInterviewPackageUpload,
  declareInterviewPackageSource,
  deleteInterviewPackage,
} from "../../../db/interview-package-storage";
import { resolveOwnerId } from "../../../db/owner";
import { readBoundedJson, RouteBodyTooLargeError, toRouteErrorMessage } from "../route-helpers";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function tracePackage(action: string, phase: string, resultCode: string, startedAt: number, counts: { sourceCount?: number; byteCount?: number } = {}) {
  console.info("interview_arc_package_command", JSON.stringify({
    operation: action,
    phase,
    result_code: resultCode,
    source_count: counts.sourceCount ?? 0,
    byte_count: counts.byteCount ?? 0,
    duration_ms: Math.max(0, Date.now() - startedAt),
  }));
}

function failure(error: unknown, action: string, startedAt: number, counts: { sourceCount?: number; byteCount?: number }) {
  const status = error instanceof RouteBodyTooLargeError
    ? 413
    : error instanceof ZodError
      ? 400
      : error instanceof InterviewPackageError
        ? error.retryable
          ? 503
          : error.code.endsWith("not_found")
            ? 404
            : error.code.includes("limit") || error.code.includes("too_large")
              ? 413
              : 409
        : 500;
  const code = error instanceof RouteBodyTooLargeError
    ? "request_too_large"
    : error instanceof ZodError
      ? "invalid_interview_package_request"
      : error instanceof InterviewPackageError
        ? error.code
        : "interview_package_command_failed";
  tracePackage(action, "apply", code, startedAt, counts);
  return Response.json({
    error: error instanceof ZodError ? error.issues[0]?.message ?? "The Interview Package request is invalid." : toRouteErrorMessage(error),
    code,
    retryable: error instanceof InterviewPackageError ? error.retryable : status >= 500,
  }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const packageId = url.searchParams.get("packageId")?.trim() || undefined;
    const loopId = url.searchParams.get("loopId")?.trim() || undefined;
    const stageId = url.searchParams.get("stageId")?.trim() || undefined;
    if (stageId && !loopId) return Response.json({ error: "Round filtering requires one Loop." }, { status: 400, headers: PRIVATE_HEADERS });
    const result = await queryInterviewPackages(ownerId, { packageId, loopId, stageId });
    if (url.searchParams.get("format") === "export") {
      if (!packageId || result.packages.length !== 1) {
        return Response.json({ error: "Choose one available Interview Package to export." }, { status: 404, headers: PRIVATE_HEADERS });
      }
      return new Response(JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), package: result.packages[0] }, null, 2), {
        headers: {
          ...PRIVATE_HEADERS,
          "content-type": "application/json; charset=utf-8",
          "content-disposition": "attachment; filename=interview-package.json",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return Response.json(result, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let action = "unknown";
  let counts: { sourceCount?: number; byteCount?: number } = {};
  try {
    if (!sameOrigin(request)) {
      tracePackage(action, "authorize", "cross_origin_rejected", startedAt);
      return Response.json({ error: "Cross-origin Interview Package mutations are not allowed.", code: "cross_origin_rejected" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    const ownerId = await resolveOwnerId(request);
    const body = await readBoundedJson(request, 160_000);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InterviewPackageError("interview_package_invalid_request", "A typed Interview Package command is required.");
    const command = body as Record<string, unknown>;
    action = typeof command.action === "string" ? command.action : "unknown";
    const operationId = typeof command.operationId === "string" ? command.operationId : "";
    if (!operationId || request.headers.get("idempotency-key")?.trim() !== operationId) {
      throw new InterviewPackageError("idempotency_key_invalid", "The idempotency key is missing or does not match this command.");
    }
    counts = {
      sourceCount: Array.isArray(command.includedSourceIds)
        ? command.includedSourceIds.length
        : Array.isArray(command.selectedSourceIds) ? command.selectedSourceIds.length : command.kind ? 1 : 0,
      byteCount: typeof command.sizeBytes === "number" ? command.sizeBytes : 0,
    };
    const payload = { ...command };
    delete payload.action;
    tracePackage(action, "apply", "started", startedAt, counts);
    const result = await (async () => {
      switch (action) {
        case "create": return createInterviewPackage(ownerId, payload);
        case "assign": return assignInterviewPackage(ownerId, payload);
        case "add_entry": return addInterviewPackageEntry(ownerId, payload);
        case "revise_entry": return reviseInterviewPackageEntry(ownerId, payload);
        case "declare_source": return declareInterviewPackageSource(ownerId, payload, env.AUDIO);
        case "complete_source": return completeInterviewPackageUpload(ownerId, payload, env.AUDIO);
        case "cancel_upload": return cancelInterviewPackageUpload(ownerId, payload, env.AUDIO);
        case "finalize": return finalizeInterviewPackage(ownerId, payload);
        case "link_material": return linkInterviewPackageMaterial(ownerId, payload);
        case "prepare_material_proposal": return prepareInterviewPackageMaterialProposal(ownerId, payload);
        case "confirm_material_proposal": return confirmInterviewPackageMaterialProposal(ownerId, payload);
        case "delete": return deleteInterviewPackage(ownerId, payload, env.AUDIO);
        default: throw new InterviewPackageError("interview_package_action_invalid", "Choose a supported Interview Package action.");
      }
    })();
    tracePackage(action, "apply", result.duplicate ? "duplicate" : "ok", startedAt, counts);
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error, action, startedAt, counts);
  }
}

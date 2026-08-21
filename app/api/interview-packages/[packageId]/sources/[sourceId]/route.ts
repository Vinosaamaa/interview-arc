import { env } from "cloudflare:workers";

import { InterviewPackageError } from "../../../../../../db/interview-packages";
import { uploadInterviewPackagePart } from "../../../../../../db/interview-package-storage";
import { resolveOwnerId } from "../../../../../../db/owner";
import { toRouteErrorMessage } from "../../../../route-helpers";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };
const MAX_PART_BYTES = 5 * 1024 * 1024;

function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function boundedPart(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PART_BYTES) throw new InterviewPackageError("interview_package_part_too_large", "An upload part cannot exceed 5 MB.");
  if (!request.body) throw new InterviewPackageError("interview_package_part_invalid", "A non-empty upload part is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new InterviewPackageError("interview_package_part_too_large", "An upload part cannot exceed 5 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function PUT(request: Request, context: { params: Promise<{ packageId: string; sourceId: string }> }) {
  const startedAt = Date.now();
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cross-origin source upload is not allowed.", code: "cross_origin_rejected" }, { status: 403, headers: PRIVATE_HEADERS });
    const ownerId = await resolveOwnerId(request);
    const { packageId, sourceId } = await context.params;
    const operationId = request.headers.get("idempotency-key")?.trim() ?? "";
    const partNumber = Number(request.headers.get("x-part-number") ?? 0);
    if (!operationId) throw new InterviewPackageError("idempotency_key_invalid", "Each upload part requires one stable idempotency key.");
    const bytes = await boundedPart(request);
    console.info("interview_arc_package_command", JSON.stringify({ operation: "upload_part", phase: "apply", result_code: "started", source_count: 1, byte_count: bytes.byteLength, duration_ms: Math.max(0, Date.now() - startedAt) }));
    const result = await uploadInterviewPackagePart(ownerId, { packageId, sourceId, operationId, partNumber }, bytes, env.AUDIO);
    console.info("interview_arc_package_command", JSON.stringify({ operation: "upload_part", phase: "apply", result_code: result.duplicate ? "duplicate" : "ok", source_count: 1, byte_count: bytes.byteLength, duration_ms: Math.max(0, Date.now() - startedAt) }));
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    const status = error instanceof InterviewPackageError ? error.retryable ? 503 : error.code.includes("large") ? 413 : 409 : 500;
    const code = error instanceof InterviewPackageError ? error.code : "interview_package_part_failed";
    console.info("interview_arc_package_command", JSON.stringify({ operation: "upload_part", phase: "apply", result_code: code, source_count: 1, byte_count: 0, duration_ms: Math.max(0, Date.now() - startedAt) }));
    return Response.json({ error: toRouteErrorMessage(error), code, retryable: error instanceof InterviewPackageError ? error.retryable : true }, { status, headers: PRIVATE_HEADERS });
  }
}

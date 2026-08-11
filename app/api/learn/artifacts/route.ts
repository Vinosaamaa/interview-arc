import { env } from "cloudflare:workers";
import { ZodError } from "zod";

import { LearningError, readPrivateLearningArtifact } from "../../../../db/learn";
import {
  MAX_LEARNING_ARTIFACT_BYTES,
  persistLearningArtifact,
} from "../../../../db/learning-artifact-storage";
import { servePrivateLearningArtifact } from "../../../../db/learning-artifact-object";
import { resolveOwnerId } from "../../../../db/owner";
import { toRouteErrorMessage } from "../../route-helpers";

const MAX_MULTIPART_BYTES = MAX_LEARNING_ARTIFACT_BYTES + 128_000;

async function boundedMultipartRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    throw new LearningError("learning_artifact_invalid_request", "A multipart Learning artifact upload is required.");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_MULTIPART_BYTES)) {
    throw new LearningError("learning_artifact_request_too_large", "The Learning artifact upload exceeds the 25 MB limit.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new LearningError("learning_artifact_request_too_large", "The Learning artifact upload exceeds the 25 MB limit.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body });
}

function requiredFormText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function failure(error: unknown) {
  const status = error instanceof ZodError
    ? 400
    : error instanceof LearningError
      ? error.retryable
        ? 503
        : error.code === "learning_artifact_request_too_large"
          ? 413
          : error.code === "learning_artifact_invalid_request" || error.code === "learning_artifact_invalid_file"
            ? 400
          : 409
      : 500;
  return Response.json({
    error: toRouteErrorMessage(error),
    ...(error instanceof LearningError ? { code: error.code, retryable: error.retryable } : {}),
  }, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    let form: FormData;
    try {
      form = await (await boundedMultipartRequest(request)).formData();
    } catch (error) {
      if (error instanceof LearningError) throw error;
      throw new LearningError("learning_artifact_invalid_request", "A valid multipart Learning artifact upload is required.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new LearningError("learning_artifact_invalid_file", "A non-empty Learning artifact file is required.");
    }
    const result = await persistLearningArtifact(ownerId, {
      operationId: requiredFormText(form, "operationId"),
      artifactId: requiredFormText(form, "artifactId"),
      lessonId: requiredFormText(form, "lessonId"),
      sessionId: requiredFormText(form, "sessionId") || undefined,
      homeworkId: requiredFormText(form, "homeworkId") || undefined,
      kind: requiredFormText(form, "kind"),
      label: requiredFormText(form, "label"),
      mediaType: file.type,
      authorization: "explicit_user_instruction",
    }, await file.arrayBuffer(), env.AUDIO);
    return Response.json(result, {
      status: result.duplicate ? 200 : 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const artifactId = new URL(request.url).searchParams.get("artifactId")?.trim() ?? "";
    const artifact = await readPrivateLearningArtifact(ownerId, artifactId);
    if (!artifact) {
      return Response.json({ error: "Learning artifact not found." }, {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      });
    }
    return servePrivateLearningArtifact(artifact, env.AUDIO);
  } catch (error) {
    return failure(error);
  }
}

import type { LearningArtifactRow } from "./schema";

export type LearningArtifactBucket = Pick<R2Bucket, "put" | "head" | "get">;

export class LearningArtifactStorageError extends Error {
  readonly code = "learning_artifact_storage_unavailable";
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "LearningArtifactStorageError";
  }
}

export async function learningArtifactSha256(value: ArrayBuffer | Uint8Array | string) {
  const bytes: Uint8Array<ArrayBuffer> = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? Uint8Array.from(value)
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function learningArtifactObjectKey(ownerId: string, artifactId: string, contentHash: string) {
  const root = await learningArtifactSha256(`${ownerId}\u0000${artifactId}`);
  return `learning-artifacts/${root}/${contentHash}`;
}

function safeFilename(label: string, mediaType: string) {
  const extension = new Map([
    ["text/plain", ".txt"],
    ["text/markdown", ".md"],
    ["text/csv", ".csv"],
    ["application/json", ".json"],
    ["application/pdf", ".pdf"],
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
    ["image/svg+xml", ".svg"],
  ]).get(mediaType) ?? ".bin";
  const stem = label
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "learning-artifact";
  return stem.toLowerCase().endsWith(extension) ? stem : `${stem}${extension}`;
}

export async function stagePrivateLearningArtifactObject(
  bucket: LearningArtifactBucket,
  key: string,
  bytes: ArrayBuffer,
  input: { kind: string; label: string; mediaType: string; contentHash: string },
) {
  const filename = safeFilename(input.label, input.mediaType);
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: input.mediaType,
      contentDisposition: `attachment; filename="${filename}"`,
    },
    customMetadata: {
      namespace: "learning-artifact",
      kind: input.kind,
      sha256: input.contentHash,
    },
  });
  const stored = await bucket.head(key);
  if (!stored
      || stored.size !== bytes.byteLength
      || stored.customMetadata?.namespace !== "learning-artifact"
      || stored.customMetadata?.kind !== input.kind
      || stored.customMetadata?.sha256 !== input.contentHash) {
    throw new LearningArtifactStorageError(
      "The private Learning artifact was not durably verified. Retry the exact operation.",
    );
  }
}

function privateJson(error: string, status: number) {
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function servePrivateLearningArtifact(
  artifact: LearningArtifactRow,
  bucket: LearningArtifactBucket,
) {
  try {
    const expectedKey = await learningArtifactObjectKey(artifact.ownerId, artifact.artifactId, artifact.contentHash);
    if (artifact.privateLocator !== expectedKey) {
      return privateJson("The private Learning artifact is not durably available.", 503);
    }
    const head = await bucket.head(expectedKey);
    if (!head
        || head.size !== artifact.sizeBytes
        || head.customMetadata?.namespace !== "learning-artifact"
        || head.customMetadata?.kind !== artifact.kind
        || head.customMetadata?.sha256 !== artifact.contentHash) {
      return privateJson("The private Learning artifact is not durably available.", 503);
    }
    const object = await bucket.get(expectedKey);
    if (!object?.body) return privateJson("The private Learning artifact is not durably available.", 503);
    return new Response(object.body, {
      headers: {
        "content-type": artifact.mediaType,
        "content-disposition": `attachment; filename="${safeFilename(artifact.label, artifact.mediaType)}"`,
        "content-length": String(artifact.sizeBytes),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return privateJson("The private Learning artifact is temporarily unavailable.", 503);
  }
}

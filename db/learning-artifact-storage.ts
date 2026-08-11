import {
  LearningError,
  attachLearningArtifact,
  learningArtifactUploadMetadataSchema,
  prepareLearningArtifactAttachment,
  saveLearningArtifactTextSchema,
} from "./learn";
import {
  LearningArtifactStorageError,
  learningArtifactObjectKey,
  learningArtifactSha256,
  stagePrivateLearningArtifactObject,
  type LearningArtifactBucket,
} from "./learning-artifact-object";

export const MAX_LEARNING_ARTIFACT_BYTES = 25 * 1024 * 1024;

export async function persistLearningArtifact(
  ownerId: string,
  inputValue: unknown,
  bytesValue: ArrayBuffer | Uint8Array,
  bucket: LearningArtifactBucket,
  nowMs = Date.now(),
) {
  const input = learningArtifactUploadMetadataSchema.parse(inputValue);
  const bytes: ArrayBuffer = bytesValue instanceof Uint8Array
    ? Uint8Array.from(bytesValue).buffer
    : bytesValue;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LEARNING_ARTIFACT_BYTES) {
    throw new LearningError(
      "learning_artifact_invalid_file",
      "A non-empty Learning artifact no larger than 25 MB is required.",
    );
  }
  const contentHash = await learningArtifactSha256(bytes);
  const privateLocator = await learningArtifactObjectKey(ownerId, input.artifactId, contentHash);
  const internalInput = {
    ...input,
    sizeBytes: bytes.byteLength,
    contentHash,
    privateLocator,
  };
  const prepared = await prepareLearningArtifactAttachment(ownerId, internalInput);
  try {
    // The object key and bytes are deterministic, so an exact retry safely
    // repairs a missing/corrupt object before replaying its immutable receipt.
    await stagePrivateLearningArtifactObject(bucket, privateLocator, bytes, internalInput);
  } catch (error) {
    if (error instanceof LearningArtifactStorageError) {
      throw new LearningError(error.code, error.message, error.retryable);
    }
    throw new LearningError(
      "learning_artifact_storage_unavailable",
      "The private Learning artifact could not be stored. Retry the exact operation.",
      true,
    );
  }
  if (prepared.duplicate) return prepared.receipt;
  return attachLearningArtifact(ownerId, internalInput, nowMs);
}

export async function persistLearningArtifactText(
  ownerId: string,
  inputValue: unknown,
  bucket: LearningArtifactBucket,
  nowMs = Date.now(),
) {
  const input = saveLearningArtifactTextSchema.parse(inputValue);
  const { content, ...metadata } = input;
  return persistLearningArtifact(ownerId, metadata, new TextEncoder().encode(content), bucket, nowMs);
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  learningArtifactObjectKey,
  servePrivateLearningArtifact,
  stagePrivateLearningArtifactObject,
} from "../db/learning-artifact-object.ts";

const bytes = new TextEncoder().encode("public-safe learning evidence").buffer;
const contentHash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const metadata = {
  kind: "trace",
  label: "Session boundary trace",
  mediaType: "text/markdown",
  contentHash,
};

test("private Learning artifacts are written and verified without owner identifiers in R2 metadata", async () => {
  let stored;
  const bucket = {
    async put(key, value, options) {
      stored = { key, value, options };
    },
    async head(key) {
      assert.equal(key, stored.key);
      return {
        size: stored.value.byteLength,
        customMetadata: stored.options.customMetadata,
      };
    },
  };
  const key = await learningArtifactObjectKey("owner-private", "artifact-private", contentHash);

  await stagePrivateLearningArtifactObject(bucket, key, bytes, metadata);

  assert.match(key, /^learning-artifacts\/[0-9a-f]{64}\/[0-9a-f]{64}$/);
  assert.doesNotMatch(key, /owner-private|artifact-private/);
  assert.deepEqual(stored.options.customMetadata, {
    namespace: "learning-artifact",
    kind: "trace",
    sha256: contentHash,
  });
  assert.doesNotMatch(JSON.stringify(stored.options), /owner-private|artifact-private/);
});

test("private Learning artifact staging fails closed when R2 verification disagrees", async () => {
  const bucket = {
    async put() {},
    async head() {
      return { size: bytes.byteLength + 1, customMetadata: {} };
    },
  };

  await assert.rejects(
    () => stagePrivateLearningArtifactObject(bucket, "learning-artifacts/test/hash", bytes, metadata),
    (error) => error.code === "learning_artifact_storage_unavailable" && error.retryable === true,
  );
});

test("authenticated artifact download re-verifies integrity and never returns the private locator", async () => {
  const ownerId = "owner-private";
  const artifactId = "artifact-private";
  const key = await learningArtifactObjectKey(ownerId, artifactId, contentHash);
  const artifact = {
    ownerId,
    artifactId,
    lessonId: "lesson-private",
    sessionId: null,
    homeworkId: null,
    kind: "trace",
    label: "Session boundary trace",
    mediaType: "text/markdown",
    sizeBytes: bytes.byteLength,
    contentHash,
    privateLocator: key,
    createdAt: 1,
  };
  const bucket = {
    async head() {
      return {
        size: bytes.byteLength,
        customMetadata: { namespace: "learning-artifact", kind: "trace", sha256: contentHash },
      };
    },
    async get() {
      return { body: new Blob([bytes]).stream() };
    },
  };

  const response = await servePrivateLearningArtifact(artifact, bucket);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "public-safe learning evidence");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.doesNotMatch(JSON.stringify([...response.headers]), /learning-artifacts|owner-private/);
});

test("artifact download fails closed when the stored locator is not the derived immutable key", async () => {
  const response = await servePrivateLearningArtifact({
    ownerId: "owner-private",
    artifactId: "artifact-private",
    lessonId: "lesson-private",
    sessionId: null,
    homeworkId: null,
    kind: "trace",
    label: "Session boundary trace",
    mediaType: "text/markdown",
    sizeBytes: bytes.byteLength,
    contentHash,
    privateLocator: "caller-supplied-private-locator",
    createdAt: 1,
  }, {
    async head() { throw new Error("must not read an untrusted locator"); },
    async get() { throw new Error("must not read an untrusted locator"); },
  });

  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /caller-supplied|learning-artifacts/);
});

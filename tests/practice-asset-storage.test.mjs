import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  practiceAssetObjectKey,
  practiceActivityAssetId,
  servePrivatePracticeAsset,
  stagePrivatePracticeAsset,
  verifyPrivatePracticeAsset,
} from "../mcp-worker/practice-asset-storage.ts";

const bytes = new TextEncoder().encode('{"type":"excalidraw","elements":[]}').buffer;
const sha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const metadata = {
  role: "attempt_original_excalidraw",
  mimeType: "application/vnd.excalidraw+json",
  sha256,
  byteSize: bytes.byteLength,
};

test("practice asset keys and R2 metadata are opaque and owner-isolated", async () => {
  const firstKey = await practiceAssetObjectKey("owner-a", "asset-1", 1, sha256);
  const secondKey = await practiceAssetObjectKey("owner-b", "asset-1", 1, sha256);
  assert.notEqual(firstKey, secondKey);
  assert.match(firstKey, /^practice-assets\/[0-9a-f]{64}\/[0-9a-f]{64}$/);
  assert.doesNotMatch(firstKey, /owner-a|asset-1/);

  let stored;
  const bucket = {
    async put(key, value, options) { stored = { key, value, options }; },
    async head(key) {
      assert.equal(key, stored.key);
      return { size: stored.value.byteLength, customMetadata: stored.options.customMetadata };
    },
  };
  await stagePrivatePracticeAsset(bucket, firstKey, bytes, metadata);
  assert.deepEqual(stored.options.customMetadata, {
    namespace: "practice-asset",
    role: metadata.role,
    sha256,
  });
  assert.doesNotMatch(JSON.stringify(stored.options), /owner-a|asset-1/);
});

test("maximum-length activity identities still derive bounded stable asset IDs", async () => {
  const activityId = `a${"b".repeat(239)}`;
  const first = await practiceActivityAssetId(activityId, "attempt_original_excalidraw");
  const second = await practiceActivityAssetId(activityId, "attempt_original_svg");
  assert.match(first, /^asset-[a-f0-9]{64}$/);
  assert.ok(first.length <= 240);
  assert.notEqual(first, second);
});

test("post-stage verification hashes the exact stored R2 bytes", async () => {
  const bucket = {
    async head() {
      return {
        size: bytes.byteLength,
        customMetadata: { namespace: "practice-asset", role: metadata.role, sha256 },
      };
    },
    async get() { return { arrayBuffer: async () => new TextEncoder().encode("tampered").buffer }; },
  };
  await assert.rejects(
    () => verifyPrivatePracticeAsset(bucket, "practice-assets/opaque/hash", metadata),
    /failed exact byte verification/,
  );
});

test("practice asset staging fails closed when exact R2 verification disagrees", async () => {
  await assert.rejects(
    () => stagePrivatePracticeAsset({
      async put() {},
      async head() { return { size: bytes.byteLength + 1, customMetadata: {} }; },
    }, "practice-assets/opaque/hash", bytes, metadata),
    (error) => error.code === "practice_asset_storage_unavailable" && error.retryable === true,
  );
});

test("authenticated practice asset readback re-verifies integrity without exposing R2 identity", async () => {
  const ownerId = "owner-a";
  const assetId = "asset-1";
  const revision = 1;
  const privateLocator = await practiceAssetObjectKey(ownerId, assetId, revision, sha256);
  const response = await servePrivatePracticeAsset({
    ownerId,
    assetId,
    revision,
    privateLocator,
    ...metadata,
  }, {
    async head() {
      return {
        size: bytes.byteLength,
        customMetadata: { namespace: "practice-asset", role: metadata.role, sha256 },
      };
    },
    async get() { return { arrayBuffer: async () => bytes }; },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), new TextDecoder().decode(bytes));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.doesNotMatch(JSON.stringify([...response.headers]), /practice-assets|owner-a|asset-1/);
});

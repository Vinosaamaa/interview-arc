import assert from "node:assert/strict";
import test from "node:test";

import { privateCoverLetterObjectKey } from "../db/private-cover-letter-object.ts";
import { stagePrivateCoverLetterPair } from "../mcp-worker/cover-letter-artifact-storage.ts";

const generation = "storage-generation-1";
const docx = {
  key: "private/letter.docx",
  storageGeneration: generation,
  bytes: new Uint8Array([0x50, 0x4b]).buffer,
  integrity: {
    format: "docx",
    sha256: "a".repeat(64),
    byteSize: 2,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename: "Example-Cover-Letter.docx",
  },
};
const pdf = {
  key: "private/letter.pdf",
  storageGeneration: generation,
  bytes: new Uint8Array([0x25, 0x50]).buffer,
  integrity: {
    format: "pdf",
    sha256: "b".repeat(64),
    byteSize: 2,
    mimeType: "application/pdf",
    filename: "Example-Cover-Letter.pdf",
  },
};

test("cover-letter R2 keys are opaque and owner-isolated", async () => {
  const first = await privateCoverLetterObjectKey({
    ownerId: "owner-a",
    artifactId: "cover-letter-1",
    storageGeneration: generation,
    format: "pdf",
  });
  const second = await privateCoverLetterObjectKey({
    ownerId: "owner-b",
    artifactId: "cover-letter-1",
    storageGeneration: generation,
    format: "pdf",
  });
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /owner-a|cover-letter-1/);
});

test("a partial private cover-letter pair is cleaned up and never reported durable", async () => {
  const stored = new Map();
  const bucket = {
    async put(key, bytes, options) {
      if (key === pdf.key) throw new Error("synthetic storage outage");
      stored.set(key, { bytes, options });
    },
    async head(key) {
      const value = stored.get(key);
      return value ? { size: value.bytes.byteLength, customMetadata: value.options.customMetadata } : null;
    },
    async delete(key) { stored.delete(key); },
  };
  const result = await stagePrivateCoverLetterPair(bucket, [docx, pdf]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.failedFormats, ["pdf"]);
  assert.equal(stored.size, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import { stagePrivateResumePair } from "../mcp-worker/private-resume-storage.ts";

const docx = {
  key: "private/docx",
  stagingGeneration: "generation-1",
  bytes: new Uint8Array([0x50, 0x4b]).buffer,
  integrity: {
    format: "docx",
    sha256: "a".repeat(64),
    byteSize: 2,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};
const pdf = {
  key: "private/pdf",
  stagingGeneration: "generation-1",
  bytes: new Uint8Array([0x25, 0x50]).buffer,
  integrity: {
    format: "pdf",
    sha256: "b".repeat(64),
    byteSize: 2,
    mimeType: "application/pdf",
  },
};

test("a partial private R2 pair is reported incomplete and never reported durable", async () => {
  const stored = new Map();
  const bucket = {
    async put(key, bytes, options) {
      if (key === pdf.key) throw new Error("synthetic storage outage");
      stored.set(key, { bytes, options });
    },
    async head(key) {
      const value = stored.get(key);
      if (!value) return null;
      return {
        size: value.bytes.byteLength,
        customMetadata: value.options.customMetadata,
      };
    },
    async delete(key) {
      stored.delete(key);
    },
  };

  const result = await stagePrivateResumePair(bucket, [docx, pdf]);

  assert.equal(result.complete, false);
  assert.deepEqual(result.failedFormats, ["pdf"]);
  assert.equal(stored.has(docx.key), false);
  assert.equal(stored.has(pdf.key), false);
});

test("partial cleanup cannot delete a newer lease generation", async () => {
  const newerKeys = ["private/generation-2/source.docx", "private/generation-2/source.pdf"];
  const stored = new Map(newerKeys.map((key) => [key, { bytes: new ArrayBuffer(1) }]));
  const olderFiles = [
    { ...docx, key: "private/generation-1/source.docx" },
    { ...pdf, key: "private/generation-1/source.pdf" },
  ];
  const bucket = {
    async put(key, bytes, options) {
      if (key.endsWith("source.pdf")) throw new Error("synthetic storage outage");
      stored.set(key, { bytes, options });
    },
    async head(key) {
      const value = stored.get(key);
      return value?.options ? {
        size: value.bytes.byteLength,
        customMetadata: value.options.customMetadata,
      } : null;
    },
    async delete(key) {
      stored.delete(key);
    },
  };

  const result = await stagePrivateResumePair(bucket, olderFiles);

  assert.equal(result.complete, false);
  assert.deepEqual(newerKeys.map((key) => stored.has(key)), [true, true]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { deleteAndVerifyPrivateResumePair } from "../mcp-worker/private-resume-deletion-storage.ts";

test("private resume pair deletion fails closed on a partial R2 failure and exact retry settles", async () => {
  const objects = new Set(["private/docx", "private/pdf"]);
  let failPdf = true;
  const bucket = {
    async delete(key) {
      if (key === "private/pdf" && failPdf) throw new Error("synthetic R2 failure");
      objects.delete(key);
    },
    async head(key) {
      return objects.has(key) ? { size: 1 } : null;
    },
  };

  assert.equal(await deleteAndVerifyPrivateResumePair(bucket, ["private/docx", "private/pdf"]), false);
  assert.deepEqual([...objects], ["private/pdf"]);

  failPdf = false;
  assert.equal(await deleteAndVerifyPrivateResumePair(bucket, ["private/docx", "private/pdf"]), true);
  assert.deepEqual([...objects], []);
});

test("private resume pair deletion requires both absence checks to succeed", async () => {
  const bucket = {
    async delete() {},
    async head(key) {
      if (key === "private/pdf") throw new Error("synthetic HEAD failure");
      return null;
    },
  };
  assert.equal(await deleteAndVerifyPrivateResumePair(bucket, ["private/docx", "private/pdf"]), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { isAbortError, parseLoopPayloadResponse } from "../app/loop-payload.ts";

test("Loop payload parse accepts JSON success bodies", () => {
  const payload = parseLoopPayloadResponse(200, "application/json; charset=utf-8", '{"loops":[],"truncated":false}');
  assert.deepEqual(payload, { loops: [], truncated: false });
});

test("Loop payload parse reports owner-facing errors for HTML 503 bodies", () => {
  assert.throws(
    () => parseLoopPayloadResponse(503, "text/html", "<!DOCTYPE html><!--[if lt IE 7]>"),
    { message: "Loops could not be loaded (503)." },
  );
});

test("Loop payload parse reports JSON API errors without hanging on the loader", () => {
  assert.throws(
    () => parseLoopPayloadResponse(500, "application/json", '{"error":"Loop state is unavailable."}'),
    { message: "Loop state is unavailable." },
  );
});

test("Loop payload parse treats malformed JSON as a retryable load failure", () => {
  assert.throws(
    () => parseLoopPayloadResponse(200, "application/json", "<!DOCTYPE html>"),
    { message: "Loops could not be loaded (200)." },
  );
});

test("Loop payload abort detection covers DOM and generic abort errors", () => {
  assert.equal(isAbortError(new DOMException("Aborted", "AbortError")), true);
  assert.equal(isAbortError(Object.assign(new Error("Aborted"), { name: "AbortError" })), true);
  assert.equal(isAbortError(new Error("Loop state is unavailable.")), false);
});

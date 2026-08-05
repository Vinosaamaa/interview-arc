import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySpecialistWriteFailure,
  executeSpecialistWriteAttempt,
  specialistWritePayloadDigest,
  specialistWriteRetryDelayMs,
} from "../mcp-worker/specialist-write-policy.ts";

test("specialist writes retry transport and resource failures but reject validation conflicts", () => {
  const retryable = [
    Object.assign(new Error("Service unavailable"), { status: 503 }),
    Object.assign(new Error("Worker exceeded CPU time limit"), { code: 1102 }),
    new DOMException("The operation timed out", "TimeoutError"),
    new Error("Transport connection reset by peer"),
  ];
  for (const failure of retryable) {
    assert.equal(classifySpecialistWriteFailure(failure).retryable, true);
  }

  const rejected = classifySpecialistWriteFailure(
    Object.assign(new Error("Immutable code attempt identity changed."), {
      code: "specialist_write_identity_conflict",
      status: 409,
    }),
  );
  assert.equal(rejected.retryable, false);
  assert.equal(rejected.code, "specialist_write_identity_conflict");
});

test("a retryable write reuses the exact payload and later reports a durable success", async () => {
  const payload = { attemptId: "attempt-1", code: "class Solution {}" };
  const observed = [];
  const first = await executeSpecialistWriteAttempt({
    attemptCount: 0,
    payload,
  }, async (candidate) => {
    observed.push(candidate);
    throw Object.assign(new Error("Worker exceeded CPU time limit"), { code: 1102 });
  }, 10_000, () => 0.5);

  assert.equal(first.status, "retry_wait");
  assert.equal(first.attemptCount, 1);
  assert.equal(first.nextAttemptAt, 11_000);
  assert.equal(first.failure?.retryable, true);

  const second = await executeSpecialistWriteAttempt({
    attemptCount: first.attemptCount,
    payload,
  }, async (candidate) => {
    observed.push(candidate);
    return { status: "inserted" };
  }, first.nextAttemptAt, () => 0.5);

  assert.equal(second.status, "saved");
  assert.equal(second.attemptCount, 2);
  assert.deepEqual(second.result, { status: "inserted" });
  assert.deepEqual(observed, [payload, payload]);
});

test("specialist write retries preserve canonical payload identity within a bounded budget", async () => {
  assert.equal(
    await specialistWritePayloadDigest({ questionId: "two-sum", tags: ["array"], active: true }),
    await specialistWritePayloadDigest({ active: true, tags: ["array"], questionId: "two-sum" }),
  );
  assert.equal(specialistWriteRetryDelayMs(1, () => 0.5), 1_000);
  assert.equal(specialistWriteRetryDelayMs(2, () => 0.5), 5_000);
  assert.equal(specialistWriteRetryDelayMs(5, () => 0.5), 300_000);
  assert.equal(specialistWriteRetryDelayMs(6, () => 0.5), null);
});

test("nonretryable validation failures stop immediately and retryable failures exhaust", async () => {
  const payload = { operationId: "write-stop", code: "immutable" };
  const rejected = await executeSpecialistWriteAttempt(
    { attemptCount: 0, payload },
    async () => {
      throw Object.assign(new Error("A stable identity conflicts with existing content."), {
        code: "specialist_write_identity_conflict",
      });
    },
    1_000,
    () => 0.5,
  );
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.attemptCount, 1);
  assert.equal(rejected.failure.retryable, false);
  assert.equal(rejected.nextAttemptAt, null);

  const exhausted = await executeSpecialistWriteAttempt(
    { attemptCount: 5, payload },
    async () => {
      throw Object.assign(new Error("HTTP 503: Worker exceeded CPU time"), { status: 503 });
    },
    2_000,
    () => 0.5,
  );
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.attemptCount, 6);
  assert.equal(exhausted.failure.retryable, true);
  assert.equal(exhausted.nextAttemptAt, null);
});

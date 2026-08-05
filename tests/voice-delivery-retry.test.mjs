import assert from "node:assert/strict";
import test from "node:test";

import { requestVoiceDeliveryRetry } from "../mcp-worker/voice-delivery-retry.ts";

const blocker = {
  captureId: "capture-current",
  turnId: "turn-current",
  status: "accepted",
  transcriptDeliveryState: "received",
  audioState: "not_registered",
  retryable: true,
  allowedActions: ["retry_delivery", "delete_exact_group"],
};

test("a successful wake signal is not reported as a successful upload", async () => {
  let signalCalls = 0;
  let blockerReads = 0;
  const readBlockers = async () => {
    blockerReads += 1;
    return { activityId: "activity-current", blockers: [blocker] };
  };
  const result = await requestVoiceDeliveryRetry(
    "activity-current",
    readBlockers,
    async () => {
      signalCalls += 1;
      return true;
    },
  );

  assert.equal(result.status, "retry_requested");
  assert.equal(result.signalPublished, true);
  assert.equal(result.retryRequested, true);
  assert.deepEqual(result.retryableCaptureIds, ["capture-current"]);
  assert.match(result.message, /Re-read get_voice_delivery_blockers/);
  assert.equal(signalCalls, 1);
  assert.equal(blockerReads, 1);

  // The original blocker remains until the native client actually uploads. The
  // caller's second read is the authoritative success check.
  const after = await readBlockers();
  assert.equal(after.blockers[0].audioState, "not_registered");
  assert.equal(blockerReads, 2);
});

test("a missing live companion is an actionable failure, not a false success", async () => {
  const result = await requestVoiceDeliveryRetry(
    "activity-current",
    async () => ({ activityId: "activity-current", blockers: [blocker] }),
    async () => false,
  );

  assert.equal(result.status, "retry_signal_unavailable");
  assert.equal(result.retryRequested, true);
  assert.equal(result.signalPublished, false);
  assert.match(result.message, /Open the companion and press Retry now/);
});

test("non-retryable blockers do not emit a wake signal", async () => {
  let signalCalls = 0;
  const result = await requestVoiceDeliveryRetry(
    "activity-current",
    async () => ({
      activityId: "activity-current",
      blockers: [{ ...blocker, retryable: false, allowedActions: ["delete_exact_group"] }],
    }),
    async () => {
      signalCalls += 1;
      return true;
    },
  );

  assert.equal(result.status, "not_needed");
  assert.equal(result.retryRequested, false);
  assert.equal(signalCalls, 0);
});

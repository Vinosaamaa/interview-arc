import assert from "node:assert/strict";
import test from "node:test";

import { activityLifecycleState } from "../app/activity-state.ts";

test("activity lifecycle is derived only from authoritative timer state", () => {
  assert.deepEqual(activityLifecycleState(undefined), { key: "planned", label: "Planned" });
  assert.deepEqual(activityLifecycleState({ startedAt: 100, runningSince: 100, completed: false }), {
    key: "running",
    label: "Running",
  });
  assert.deepEqual(activityLifecycleState({ startedAt: 100, runningSince: null, completed: false }), {
    key: "paused",
    label: "Paused",
  });
  assert.deepEqual(activityLifecycleState({ startedAt: 100, runningSince: null, completed: true }), {
    key: "complete",
    label: "Complete",
  });
});

test("completed state wins over stale running timestamps", () => {
  assert.equal(activityLifecycleState({
    startedAt: 100,
    runningSince: 200,
    completed: true,
  }).key, "complete");
});

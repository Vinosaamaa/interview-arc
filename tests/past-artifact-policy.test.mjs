import assert from "node:assert/strict";
import test from "node:test";

import { isPastAttemptArtifact } from "../app/past-artifact-policy.ts";

test("Past includes only artifacts linked to a real practice activity", () => {
  assert.equal(isPastAttemptArtifact({ activityId: "activity-123" }), true);
  assert.equal(isPastAttemptArtifact({ activityId: "" }), false);
  assert.equal(isPastAttemptArtifact({ activityId: "   " }), false);
});

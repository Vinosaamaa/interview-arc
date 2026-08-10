import assert from "node:assert/strict";
import test from "node:test";

import {
  behavioralTargetReviewSchema,
  targetVariantStaleReasons,
} from "../db/behavioral-practice-preflight-policy.ts";

const review = {
  schemaVersion: 1,
  universalQuality: {
    strengths: ["The answer names the decision."],
    improvements: ["Quantify the result."],
  },
  targetAlignment: {
    strengths: ["Demonstrates reliability ownership."],
    gaps: ["Staff-level influence is not yet established."],
    competencySignals: ["reliability"],
  },
  assistance: {
    level: "probing",
    details: ["Prompted for the production outcome."],
  },
  evidenceGaps: ["Production impact is not independently measured."],
};

test("target review keeps universal quality, target alignment, assistance, and evidence gaps separate", () => {
  assert.deepEqual(behavioralTargetReviewSchema.parse(review), review);
  assert.throws(() => behavioralTargetReviewSchema.parse({
    ...review,
    targetAlignment: { ...review.targetAlignment, privateJobDescription: "secret" },
  }));
});

test("accepted target variants become stale when either exact source revision changes", () => {
  const identity = {
    targetId: "target-example",
    targetRevision: 2,
    solutionProfileRevision: 4,
  };
  assert.deepEqual(targetVariantStaleReasons(identity, {
    resolvedTargetId: "target-example",
    resolvedTargetRevision: 2,
    currentTargetRevision: 2,
    currentSolutionProfileRevision: 4,
  }), []);
  assert.deepEqual(targetVariantStaleReasons(identity, {
    resolvedTargetId: "target-example",
    resolvedTargetRevision: 2,
    currentTargetRevision: 3,
    currentSolutionProfileRevision: 5,
  }), ["target_revision_changed", "solution_profile_revision_changed"]);
  assert.deepEqual(targetVariantStaleReasons(identity, {
    resolvedTargetId: null,
    resolvedTargetRevision: null,
    currentTargetRevision: 2,
    currentSolutionProfileRevision: 4,
  }), ["target_not_resolved"]);
});

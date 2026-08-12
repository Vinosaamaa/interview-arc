import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateReviewTransition,
  behavioralEvidenceCandidateReviewSchema,
  behavioralEvidenceSourceSnapshotSchema,
  validateBehavioralEvidenceCandidateReview,
  validateBehavioralEvidenceSourceWrite,
} from "../db/behavioral-evidence-review-policy.ts";

function sourceWrite(overrides = {}) {
  return {
    operationId: "source-operation-1",
    expectedRevision: 0,
    authorization: "behavioral_evidence_specialist",
    source: {
      schemaVersion: 1,
      sourceId: "source-example-repository",
      state: "active",
      projectKey: "example-project",
      kind: "repository",
      label: "Example repository",
      safeHint: "Primary implementation evidence",
      authorization: "user_owned",
      sensitivity: "private",
      availability: "available",
      refreshStatus: "current",
      contentRevision: "revision-1",
      lastInspectedAt: 1_786_291_200_000,
      visibility: "owner_private",
      ...overrides,
    },
  };
}

function reviewWrite(overrides = {}) {
  return {
    operationId: "review-operation-1",
    authorization: "explicit_owner_review",
    decisions: [{
      evidenceId: "evidence-candidate-1",
      expectedRevision: 1,
      decision: "accept",
      reason: "The sanitized statement is accurate and useful.",
      ...overrides,
    }],
  };
}

test("display-safe source snapshots require inspection identity for available sources", () => {
  assert.doesNotThrow(() => validateBehavioralEvidenceSourceWrite(sourceWrite()));
  assert.throws(
    () => behavioralEvidenceSourceSnapshotSchema.parse(sourceWrite({
      contentRevision: undefined,
      lastInspectedAt: undefined,
    }).source),
    /sanitized content revision or fingerprint/,
  );
  assert.throws(
    () => behavioralEvidenceSourceSnapshotSchema.parse(sourceWrite({
      authorization: "authorization_required",
    }).source),
    /before authorization/,
  );
});

test("source and review payloads reject private locators without echoing them", () => {
  const privateLocator = "/Users/example/private/repository";
  assert.throws(
    () => validateBehavioralEvidenceSourceWrite(sourceWrite({ safeHint: privateLocator })),
    (error) => error.code === "behavioral_evidence_source_unsafe_payload"
      && !error.message.includes(privateLocator),
  );
  assert.throws(
    () => validateBehavioralEvidenceCandidateReview(reviewWrite({ reason: privateLocator })),
    (error) => error.code === "behavioral_evidence_review_unsafe_payload"
      && !error.message.includes(privateLocator),
  );
});

test("candidate decisions enforce explicit authority and supersession identity", () => {
  assert.doesNotThrow(() => validateBehavioralEvidenceCandidateReview(reviewWrite()));
  assert.throws(
    () => behavioralEvidenceCandidateReviewSchema.parse({
      ...reviewWrite(),
      authorization: "behavioral_evidence_specialist",
    }),
  );
  assert.throws(
    () => behavioralEvidenceCandidateReviewSchema.parse(reviewWrite({ decision: "supersede" })),
    /replacement evidence ID/,
  );
  assert.throws(
    () => behavioralEvidenceCandidateReviewSchema.parse(reviewWrite({
      decision: "supersede",
      replacementEvidenceId: "evidence-candidate-1",
    })),
    /cannot supersede itself/,
  );
  assert.throws(
    () => behavioralEvidenceCandidateReviewSchema.parse({
      operationId: "review-operation-batch-replacement",
      authorization: "explicit_owner_review",
      decisions: [
        {
          evidenceId: "evidence-candidate-1",
          expectedRevision: 1,
          decision: "supersede",
          reason: "A more precise candidate replaces this observation.",
          replacementEvidenceId: "evidence-candidate-2",
        },
        {
          evidenceId: "evidence-candidate-2",
          expectedRevision: 1,
          decision: "reject",
          reason: "The replacement cannot change state in the same batch.",
        },
      ],
    }),
    /cannot also change state in the same review batch/,
  );
});

test("candidate transitions are monotonic and terminal decisions fail closed", () => {
  assert.equal(assertCandidateReviewTransition("pending", "accept"), "accepted");
  assert.equal(assertCandidateReviewTransition("pending", "reject"), "rejected");
  assert.equal(assertCandidateReviewTransition("pending", "supersede"), "superseded");
  assert.equal(assertCandidateReviewTransition("accepted", "supersede"), "superseded");
  for (const [state, decision] of [
    ["accepted", "reject"],
    ["rejected", "accept"],
    ["superseded", "accept"],
  ]) {
    assert.throws(
      () => assertCandidateReviewTransition(state, decision),
      (error) => error.code === "behavioral_evidence_review_transition_conflict",
    );
  }
});

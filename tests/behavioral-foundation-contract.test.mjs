import assert from "node:assert/strict";
import test from "node:test";

import { behavioralFoundationStatusSchema } from "../app/behavioral-foundation-contract.ts";

const validStatus = {
  schemaVersion: 1,
  evidence: { total: 1, accepted: 1, pending: 0, rejected: 0, superseded: 0, projects: 1, sourceRevisions: 0 },
  claims: { total: 1, unverified: 0, partial: 0, verified: 1, contradicted: 0, questions: 1 },
  questionCoverage: [{ questionId: "question-1", claims: 1, verified: 1, contradicted: 0, gaps: 1 }],
  gaps: [{ claimId: "claim-1", questionId: "question-1", text: "Confirm the rollout." }],
  capabilities: {
    evidenceRead: "available",
    sourceRegistry: "not_available",
    storyBank: "not_available",
    resumeLibrary: "not_available",
  },
  lastUpdatedAt: 1,
  limits: { claimDetails: 50, gaps: 20 },
  truncated: { claimDetails: false, gaps: false },
};

test("the Behavioral Foundation API contract accepts the complete bounded read model", () => {
  assert.deepEqual(behavioralFoundationStatusSchema.parse(validStatus), validStatus);
});

test("the Behavioral Foundation API contract rejects incomplete or invalid state", () => {
  assert.throws(() => behavioralFoundationStatusSchema.parse({
    ...validStatus,
    evidence: { ...validStatus.evidence, accepted: -1 },
  }));
  assert.throws(() => behavioralFoundationStatusSchema.parse({
    ...validStatus,
    capabilities: { ...validStatus.capabilities, storyBank: "available" },
  }));
});

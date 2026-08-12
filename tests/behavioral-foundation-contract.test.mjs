import assert from "node:assert/strict";
import test from "node:test";

import { behavioralFoundationStatusSchema } from "../app/behavioral-foundation-contract.ts";

const validStatus = {
  schemaVersion: 2,
  evidence: { total: 1, accepted: 1, pending: 0, rejected: 0, superseded: 0, projects: 1, sourceRevisions: 0 },
  claims: { total: 1, unverified: 0, partial: 0, verified: 1, contradicted: 0, questions: 1 },
  questionCoverage: [{ questionId: "question-1", claims: 1, verified: 1, contradicted: 0, gaps: 1 }],
  gaps: [{ claimId: "claim-1", questionId: "question-1", text: "Confirm the rollout." }],
  stories: {
    total: 1,
    active: 1,
    archived: 0,
    projects: 1,
    recent: [{
      storyId: "story-1",
      revision: 1,
      title: "Recovered a stalled launch",
      projectKey: "example-project",
      competencies: ["ownership"],
      questionCount: 1,
      gapCount: 0,
      updatedAt: 1,
    }],
    lastUpdatedAt: 1,
    limit: 6,
    truncated: false,
  },
  sources: {
    total: 1,
    active: 1,
    available: 1,
    changed: 0,
    blocked: 0,
    revisions: 1,
    recent: [{
      sourceId: "source-1",
      revision: 1,
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
      lastInspectedAt: 1,
      visibility: "owner_private",
      createdAt: 1,
    }],
    lastUpdatedAt: 1,
    limit: 6,
    truncated: false,
  },
  candidates: {
    pending: 1,
    items: [{
      evidenceId: "evidence-pending-1",
      reviewRevision: 1,
      projectKey: "example-project",
      origin: "code_observation",
      statement: "A bounded, sanitized candidate.",
      sourceRevision: "revision-1",
      evidenceGrade: "E2",
      attributionGrade: "A0",
      claimStrength: "project_fact",
      candidateState: "pending",
      supports: ["The implementation includes the scoped behavior."],
      limitations: ["Personal ownership is not established."],
      tags: ["reliability"],
      questionLinks: [{ questionId: "question-1", relevance: "supporting" }],
      updatedAt: 1,
    }],
    lastUpdatedAt: 1,
    limit: 10,
    truncated: false,
  },
  capabilities: {
    evidenceRead: "available",
    sourceRegistry: "available",
    candidateReview: "available",
    storyBank: "available",
    resumeLibrary: "available",
  },
  lastUpdatedAt: 1,
  limits: { claimDetails: 50, gaps: 20, stories: 6, sources: 6, candidates: 10 },
  truncated: { claimDetails: false, gaps: false, stories: false, sources: false, candidates: false },
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
    capabilities: { ...validStatus.capabilities, storyBank: "not_available" },
  }));
});

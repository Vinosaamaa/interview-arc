import assert from "node:assert/strict";
import test from "node:test";

import {
  orderedPracticeRecordSections,
  practiceRecordTechnicalAudit,
} from "../app/practice-record-reader.ts";

const payload = {
  schemaVersion: 1,
  activityId: "activity-1",
  revision: 2,
  questionId: "question-1",
  specialty: "leetcode",
  transcript: { revision: 4, turnCount: 8, firstTurnId: "turn-1", lastTurnId: "turn-8" },
  notesRevision: 3,
  specialtyOutput: {
    kind: "code_attempts",
    responseStages: [],
    codeAttemptIds: ["code-1"],
    finalAnswerRevision: null,
    designAssetIds: [],
  },
  review: { didWell: ["Good invariant"], improve: ["Test boundaries"], nextDrill: "Retry cold" },
  references: [{ title: "Canonical problem", url: "https://example.test/problem", accessedAt: "2026-08-13T20:00:00.000Z" }],
  solutionLink: { questionId: "question-1", profileRevision: 1 },
  assetLinks: [],
  finalizationOperationId: "finalize-1",
};

test("Past uses one nonduplicative Practice Record order independent of Git artifacts", () => {
  assert.deepEqual(orderedPracticeRecordSections(payload, {
    hasConversation: true,
    hasCodeAttempts: true,
    hasFinalAnswer: false,
    hasDesign: false,
  }), ["problem", "attempt_summary", "conversation", "code_attempts", "activity_review", "technical_audit"]);
});

test("Mentor-only stages remain an honest specialty output instead of inventing an owner answer", () => {
  assert.deepEqual(orderedPracticeRecordSections({
    ...payload,
    specialty: "system_design",
    specialtyOutput: {
      kind: "your_design",
      responseStages: [{
        key: "requirements",
        state: "no_answer_provided",
        ownerResponse: null,
        mentorGuidance: "Start with functional and non-functional requirements.",
        finalUnderstanding: "Separate product behavior from quality constraints.",
        turnIds: ["turn-1", "turn-2"],
      }],
      codeAttemptIds: [],
      finalAnswerRevision: null,
      designAssetIds: [],
    },
  }, {
    hasConversation: true,
    hasCodeAttempts: false,
    hasFinalAnswer: false,
    hasDesign: true,
  }), ["problem", "attempt_summary", "conversation", "your_design", "activity_review", "technical_audit"]);
});

test("a referenced specialty output stays visible when its backing projection is missing", () => {
  assert.deepEqual(orderedPracticeRecordSections(payload, {
    hasConversation: false,
    hasCodeAttempts: false,
    hasFinalAnswer: false,
    hasDesign: false,
  }), ["problem", "attempt_summary", "conversation", "code_attempts", "activity_review", "technical_audit"]);
});

test("Technical Audit preserves the completion-time solution revision without making it the primary study target", () => {
  const audit = practiceRecordTechnicalAudit({
    revision: 2,
    fingerprint: "a".repeat(64),
    operationId: "finalize-1",
    requestFingerprint: "b".repeat(64),
    payload,
    createdAt: 1,
  });
  assert.equal(audit.solutionRevisionAtCompletion, 1);
  assert.equal(audit.practiceRecordRevision, 2);
  assert.equal(audit.transcriptTurnCount, 8);
  assert.equal(audit.codeAttemptCount, 1);
  assert.equal(audit.fingerprint, "a".repeat(64));
});

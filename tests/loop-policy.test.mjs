import assert from "node:assert/strict";
import test from "node:test";

import { loopSnapshotSchema } from "../db/loop-policy.ts";

function loopWith(stage) {
  return {
    loopId: "loop-example-backend",
    state: "active",
    company: "Example",
    roleTitle: "Backend Engineer",
    status: "active",
    openedAt: 1_786_118_400_000,
    outcome: null,
    stages: [stage],
  };
}

test("Loop revisions accept owner-authored question reviews and explicit round context", () => {
  const parsed = loopSnapshotSchema.parse(loopWith({
    stageId: "technical-screen",
    label: "Technical screen",
    order: 0,
    status: "completed",
    format: "Video call",
    interviewers: ["Hiring manager"],
    completedAt: 1_787_936_400_000,
    debrief: {
      capturedAt: 1_787_936_700_000,
      questions: [{
        memoryId: "question-reliability",
        specialty: "system_design",
        promptMemory: "How would you make the service resilient?",
        promptConfidence: "exact",
        ownerReview: {
          assessment: "mixed",
          summary: "The failure-mode framing was clear; quantify the recovery target next time.",
        },
      }],
      selfAssessment: "Strong systems framing; make the operational target more concrete.",
      interviewerFeedback: "The interviewer asked for a more precise recovery target.",
    },
  }));

  const stage = parsed.stages[0];
  assert.equal(stage.format, "Video call");
  assert.deepEqual(stage.interviewers, ["Hiring manager"]);
  assert.deepEqual(stage.debrief?.questions[0].ownerReview, {
    assessment: "mixed",
    summary: "The failure-mode framing was clear; quantify the recovery target next time.",
  });
  assert.equal(stage.debrief?.interviewerFeedback, "The interviewer asked for a more precise recovery target.");
});

test("owner review cannot persist an empty object", () => {
  const result = loopSnapshotSchema.safeParse(loopWith({
    stageId: "screen",
    label: "Screen",
    order: 0,
    status: "completed",
    debrief: {
      capturedAt: 1_787_936_700_000,
      questions: [{
        memoryId: "question-empty-review",
        specialty: "behavioral",
        promptMemory: "Tell me about a difficult decision.",
        promptConfidence: "reconstructed",
        ownerReview: {},
      }],
    },
  }));

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /owner review requires an explicit assessment or summary/i);
});

test("legacy answer memory remains readable without new review fields", () => {
  const parsed = loopSnapshotSchema.parse(loopWith({
    stageId: "legacy-screen",
    label: "Legacy screen",
    order: 0,
    status: "completed",
    debrief: {
      capturedAt: 1_787_936_700_000,
      questions: [{
        memoryId: "legacy-answer",
        specialty: "leetcode",
        canonicalQuestionId: "two-sum",
        promptConfidence: "exact",
        answerMemory: "Used a hash map.",
        answerConfidence: "reconstructed",
      }],
      selfAssessment: "The solution was correct, but the explanation was rushed.",
    },
  }));

  assert.equal(parsed.stages[0].debrief?.questions[0].answerMemory, "Used a hash map.");
  assert.equal(parsed.stages[0].debrief?.questions[0].ownerReview, undefined);
});

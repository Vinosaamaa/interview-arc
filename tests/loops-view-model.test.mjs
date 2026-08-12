import assert from "node:assert/strict";
import test from "node:test";

import {
  groupLoopPreparation,
  indexStageMaterials,
  loopStageRecords,
  stageMaterials,
} from "../app/loops-view-model.ts";

const loop = {
  loop: {
    stages: [
      { stageId: "recruiter", label: "Recruiter", order: 0, status: "completed", completedAt: 300 },
      { stageId: "technical", label: "Technical", order: 1, status: "planned" },
    ],
  },
  activityBindings: [
    { activityId: "attempt-2", stageId: "technical", roleBriefRevision: 1, specialty: "leetcode", questionId: "two-sum", title: "Two Sum", completed: true },
    { activityId: "attempt-1", stageId: "technical", roleBriefRevision: 1, specialty: "leetcode", questionId: "two-sum", title: "Two Sum", completed: true },
    { activityId: "planned-system", stageId: "technical", roleBriefRevision: 1, specialty: "system_design", questionId: "rate-limiter", title: "Design a rate limiter", completed: false },
    { activityId: "behavioral-finished", stageId: "recruiter", roleBriefRevision: 1, specialty: "behavioral", questionId: "difficult-decision", title: "Tell me about a difficult decision", completed: true },
  ],
  activityHistory: [
    { activityId: "attempt-1", stageId: "technical", roleBriefRevision: 1, specialty: "leetcode", questionId: "two-sum", result: "failed", completedAt: 100 },
    { activityId: "attempt-2", stageId: "technical", roleBriefRevision: 1, specialty: "leetcode", questionId: "two-sum", result: "solved", completedAt: 200 },
    { activityId: "behavioral-finished", stageId: "recruiter", roleBriefRevision: 1, specialty: "behavioral", questionId: "difficult-decision", result: "solved_after_reviewing_approach", completedAt: 150 },
  ],
  interviewMaterials: [],
};

test("linked preparation groups authoritative activities by specialty and canonical question", () => {
  const groups = groupLoopPreparation(loop);
  assert.deepEqual(groups.map((group) => group.specialty), ["leetcode", "system_design", "behavioral"]);

  const coding = groups[0].questions[0];
  assert.equal(coding.title, "Two Sum");
  assert.equal(coding.completed, true);
  assert.equal(coding.attempts.length, 2);
  assert.deepEqual(coding.attempts.map((attempt) => attempt.activityId), ["attempt-2", "attempt-1"]);
  assert.equal(groups[1].questions[0].completed, false);
});

test("completed preparation sorts before unfinished rows without mixing interview-memory questions", () => {
  const input = {
    ...loop,
    activityBindings: [
      { activityId: "planned-code", stageId: null, roleBriefRevision: 1, specialty: "leetcode", questionId: "course-schedule", title: "Course Schedule", completed: false },
      ...loop.activityBindings,
    ],
  };
  const coding = groupLoopPreparation(input)[0].questions;
  assert.deepEqual(coding.map((question) => question.questionId), ["two-sum", "course-schedule"]);
});

test("stage chronology is stable and legacy Loop-wide material is rendered once", () => {
  const input = {
    ...loop,
    loop: { ...loop.loop, stages: [loop.loop.stages[1], loop.loop.stages[0]] },
    interviewMaterials: [
      { materialId: "legacy-wide", kind: "interview_prep", state: "active", label: "Legacy prep", sections: [], provenance: { roleBriefRevision: 1, activityIds: [], sourceLabel: "Owner", preparedAt: 1 }, revision: 1, createdAt: 1, revisionCreatedAt: 1, updatedAt: 1 },
      { materialId: "technical-prep", stageId: "technical", kind: "interview_prep", state: "active", label: "Technical prep", sections: [], provenance: { roleBriefRevision: 1, activityIds: [], sourceLabel: "Owner", preparedAt: 1 }, revision: 1, createdAt: 1, revisionCreatedAt: 1, updatedAt: 1 },
    ],
  };

  assert.deepEqual(loopStageRecords(input.loop.stages).map((stage) => stage.stageId), ["recruiter", "technical"]);
  const materialIndex = indexStageMaterials(input.interviewMaterials);
  assert.deepEqual(stageMaterials(materialIndex, "technical", true).map((material) => material.materialId), ["technical-prep", "legacy-wide"]);
  assert.deepEqual(stageMaterials(materialIndex, "recruiter").map((material) => material.materialId), []);
});

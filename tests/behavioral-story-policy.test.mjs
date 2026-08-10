import assert from "node:assert/strict";
import test from "node:test";

import {
  behavioralStoryWriteSchema,
  BehavioralStoryError,
  validateBehavioralStoryWrite,
} from "../db/behavioral-story-policy.ts";

function storyWrite() {
  return {
    operationId: "story-operation-1",
    expectedRevision: 0,
    story: {
      schemaVersion: 1,
      storyId: "story-launch-1",
      state: "active",
      title: "Restored a stalled launch",
      projectKey: "example-project",
      situation: "A customer launch had stalled after a reliability regression.",
      task: "Restore the launch while keeping the rollback boundary explicit.",
      actions: ["Scoped the failure.", "Added a guarded rollout."],
      result: "The launch resumed without another regression.",
      learning: "Make the rollback path part of the initial design.",
      claimIds: ["claim-launch-1"],
      evidenceIds: ["evidence-launch-1"],
      gaps: ["Confirm the exact adoption metric."],
      competencies: ["execution", "ownership"],
      questionIds: ["question-launch-1"],
      visibility: "owner_private",
    },
  };
}

test("a bounded owner-private STARL story passes the versioned write contract", () => {
  assert.deepEqual(behavioralStoryWriteSchema.parse(storyWrite()), storyWrite());
});

test("Story Bank rejects private locators and duplicate references before D1", () => {
  for (const result of [
    "Read /Users/example/private/result.txt.",
    "Read private-sources/employer/result.md.",
    "Contact owner@example.test.",
    "Use Bearer private-token-value.",
  ]) {
    assert.throws(
      () => validateBehavioralStoryWrite({
        ...storyWrite(),
        story: { ...storyWrite().story, result },
      }),
      (error) => error instanceof BehavioralStoryError && error.code === "behavioral_story_unsafe_payload",
    );
  }
  assert.throws(
    () => behavioralStoryWriteSchema.parse({
      ...storyWrite(),
      story: { ...storyWrite().story, evidenceIds: ["evidence-launch-1", "evidence-launch-1"] },
    }),
  );
});

test("story revisions require a stable operation and exact expected revision", () => {
  assert.throws(() => behavioralStoryWriteSchema.parse({ ...storyWrite(), expectedRevision: -1 }));
  assert.throws(() => behavioralStoryWriteSchema.parse({ ...storyWrite(), operationId: "UPPER CASE" }));
});

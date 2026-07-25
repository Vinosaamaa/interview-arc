import assert from "node:assert/strict";
import test from "node:test";

import { buildSelectedActivityBatch } from "../app/activity-batch.ts";

const selected = [
  {
    key: "bank:leetcode:course-schedule",
    type: "leetcode",
    questionId: "course-schedule",
    title: "Course Schedule",
    url: "https://leetcode.com/problems/course-schedule/",
    minutes: 35,
    topics: ["Graph", "Topological Sort"],
    source: "bank",
  },
  {
    key: "custom:system-design:marketplace",
    type: "system_design",
    title: "Build a Marketplace",
    prompt: "Design a local marketplace.",
    minutes: 55,
    topics: [],
    source: "custom",
  },
];

test("selected activities can be added as one exact timed session", () => {
  const result = buildSelectedActivityBatch({
    date: "2026-07-25",
    stamp: "batch1",
    sessionNumber: 3,
    destination: "session",
    items: selected,
  });

  assert.deepEqual(result.activities.map((activity) => activity.title), [
    "Course Schedule",
    "Build a Marketplace",
  ]);
  assert.deepEqual(result.activities.map((activity) => activity.allocatedSeconds), [2_100, 3_300]);
  assert.ok(result.activities.every((activity) => activity.sessionId === result.session?.id));
  assert.equal(result.session?.label, "Session 3");
  assert.equal(result.session?.allocatedSeconds, 5_400);
  assert.deepEqual(result.session?.activityIds, result.activities.map((activity) => activity.id));
});

test("standalone selection remains the default and creates no session", () => {
  const result = buildSelectedActivityBatch({
    date: "2026-07-25",
    stamp: "batch1",
    sessionNumber: 3,
    destination: "standalone",
    items: selected,
  });

  assert.equal(result.session, null);
  assert.ok(result.activities.every((activity) => activity.sessionId === undefined));
  assert.ok(result.activities.every((activity) => activity.timerGroupId === activity.id));
});

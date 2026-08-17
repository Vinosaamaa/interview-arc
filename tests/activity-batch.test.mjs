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
  assert.ok(result.activities.every((activity) => activity.loopContext === undefined));
});

test("selected practice can bind one Loop while an unchecked row stays universal", () => {
  const loopContext = { loopId: "loop-northstar-backend-2026", stageId: "onsite-coding" };
  const boundAll = buildSelectedActivityBatch({
    date: "2026-07-25",
    stamp: "batch1",
    sessionNumber: 3,
    destination: "standalone",
    items: selected,
    loopContext,
  });
  assert.deepEqual(boundAll.activities.map((activity) => activity.loopContext), [loopContext, loopContext]);

  const unchecked = buildSelectedActivityBatch({
    date: "2026-07-25",
    stamp: "batch1",
    sessionNumber: 3,
    destination: "standalone",
    items: selected,
    loopContext,
    boundKeys: [selected[0].key],
  });
  assert.deepEqual(unchecked.activities[0].loopContext, loopContext);
  assert.equal(unchecked.activities[1].loopContext, undefined);
});

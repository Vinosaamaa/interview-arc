import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  activityKeysBoundToLoop,
  canBindActivityToLoop,
  composerLoopContextRequest,
  composerLoopPrefillFromLoop,
  defaultComposerLoopRoundId,
  EMPTY_COMPOSER_LOOP_BINDING,
  toggleComposerLoopUnboundKey,
} from "../app/activity-composer-loop-binding.ts";

const stages = [
  { stageId: "recruiter", label: "Recruiter", status: "completed", order: 1, completedAt: 1_700 },
  { stageId: "onsite-coding", label: "Onsite coding", status: "scheduled", order: 2, scheduledAt: 2_400 },
  { stageId: "onsite-behavioral", label: "Onsite behavioral", status: "planned", order: 3 },
];

test("hiring Loop binding stays off by default", () => {
  assert.equal(EMPTY_COMPOSER_LOOP_BINDING.hiringLoopEnabled, false);
  assert.equal(EMPTY_COMPOSER_LOOP_BINDING.hiringLoopId, "");
  assert.deepEqual(activityKeysBoundToLoop(["a", "b"], [], false), []);
  assert.equal(composerLoopContextRequest({
    enabled: false,
    loopId: "loop-northstar-backend-2026",
    stageId: "onsite-coding",
  }), null);
});

test("enabled hiring Loop binds every selected practice key until one is unchecked", () => {
  const keys = ["bank:leetcode:two-sum", "bank:system_design:tiktok"];
  assert.deepEqual(activityKeysBoundToLoop(keys, [], true), keys);
  const unbound = toggleComposerLoopUnboundKey([], keys[1]);
  assert.deepEqual(activityKeysBoundToLoop(keys, unbound, true), [keys[0]]);
  assert.deepEqual(composerLoopContextRequest({
    enabled: true,
    loopId: "loop-northstar-backend-2026",
    stageId: "onsite-coding",
  }), { loopId: "loop-northstar-backend-2026", stageId: "onsite-coding" });
  assert.deepEqual(composerLoopContextRequest({
    enabled: true,
    loopId: "loop-northstar-backend-2026",
    stageId: "",
  }), { loopId: "loop-northstar-backend-2026" });
});

test("career focus is excluded from Loop bind keys", () => {
  const practiceKeys = ["bank:leetcode:two-sum"];
  assert.deepEqual(activityKeysBoundToLoop(practiceKeys, [], true), practiceKeys);
  assert.ok(!activityKeysBoundToLoop(practiceKeys, [], true).includes("focus:job-applications"));
});

test("Loop context cannot bind after an activity timer starts", () => {
  assert.equal(canBindActivityToLoop({ status: "planned" }), true);
  assert.equal(canBindActivityToLoop({ status: "planned", timer: { startedAt: 1_700 } }), false);
  assert.equal(canBindActivityToLoop({ status: "running", timer: { runningSince: 1_800 } }), false);
  assert.equal(canBindActivityToLoop({ status: "completed" }), false);
});

test("default Round prefers scheduled, then latest completed, and Loops Add practice prefills that scope", () => {
  assert.equal(defaultComposerLoopRoundId(stages), "onsite-coding");
  assert.equal(defaultComposerLoopRoundId(stages.filter((stage) => stage.status !== "scheduled")), "recruiter");
  assert.equal(defaultComposerLoopRoundId(stages, "onsite-behavioral"), "onsite-behavioral");
  assert.deepEqual(composerLoopPrefillFromLoop({
    loopId: "loop-northstar-backend-2026",
    stages,
    preferredStageId: "recruiter",
  }), {
    hiringLoopEnabled: true,
    hiringLoopId: "loop-northstar-backend-2026",
    hiringLoopStageId: "recruiter",
    hiringLoopUnboundKeys: [],
    reviewOpen: true,
  });
});

test("Review selections keeps Standalone | One session and stamps practice from Hiring Loop", async () => {
  const [home, panel, loops, liveState, commands] = await Promise.all([
    readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/activity-composer-loop-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/loops-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/live-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/practice-state-commands.ts", import.meta.url), "utf8"),
  ]);
  assert.match(home, /hiringLoopEnabled: boolean/);
  assert.match(home, /EMPTY_COMPOSER_LOOP_BINDING/);
  assert.match(home, /ActivityComposerLoopBinding/);
  assert.match(home, /Never binds/);
  assert.match(home, /career-focus-selection/);
  assert.doesNotMatch(home, /Add as Loop/);
  assert.match(home, /aria-label="Add selected activities as"/);
  assert.match(home, /batchDestination === "standalone"/);
  assert.match(home, /batchDestination === "session"/);
  assert.match(home, /loopContext,/);
  assert.match(home, /boundKeys/);
  assert.match(home, /onAddPractice=\{openNewActivity\}/);
  assert.match(panel, /Hiring Loop/);
  assert.match(panel, /Universal practice — no hiring Loop/);
  assert.match(panel, /No round/);
  assert.match(panel, /Career Focus never binds/);
  assert.match(loops, />Add practice</);
  assert.match(loops, /onAddPractice/);
  assert.match(loops, /preferredStageId/);
  const extraUpsert = liveState.slice(
    liveState.indexOf("export async function upsertExtraActivity"),
    liveState.indexOf("export async function upsertFocusBlock"),
  );
  assert.match(extraUpsert, /resolveLoopActivityContext/);
  assert.match(extraUpsert, /loopActivityBindings/);
  assert.match(extraUpsert, /loop_activity_already_started/);
  assert.match(extraUpsert, /payloadLoopContext \?\? resolvedBinding\.loopContext/);
  assert.match(commands, /error instanceof LoopError/);
  const css = await readFile(new URL("../app/interview-arc-v2.css", import.meta.url), "utf8");
  assert.match(css, /\.composer-hiring-loop/);
  assert.match(css, /\.composer-loop-stamp\.bound/);
  assert.match(css, /var\(--primary-deep\)/);
});

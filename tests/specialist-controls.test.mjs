import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  selectNextPracticeActivity,
} from "../db/specialist-controls-policy.ts";
import {
  controlPracticeWorkbench,
} from "../db/specialist-controls-runtime.ts";

test("workbench rollover is explicit, server-identified, and receipt-backed", async () => {
  const calls = [];
  const state = {
    workbench: { id: "workbench-current" },
  };
  const response = await controlPracticeWorkbench(
    state,
    {
      expectedWorkbenchId: "workbench-current",
      mutationId: "mutation-start-fresh-1",
      action: "start_fresh",
      authorization: "explicit_user_instruction",
    },
    "request-hash",
    "2026-08-03",
    {
      now: () => 1_754_240_000_000,
      newWorkbenchId: () => "workbench-replacement",
      startFreshPracticeWorkbench: async (input) => calls.push(input),
    },
  );

  assert.deepEqual(response, {
    result: {
      mutationId: "mutation-start-fresh-1",
      action: "start_fresh",
      archivedWorkbenchId: "workbench-current",
      workbenchId: "workbench-replacement",
      applied: true,
    },
    receiptStored: true,
  });
  assert.deepEqual(calls, [{
    workbenchId: "workbench-current",
    newWorkbenchId: "workbench-replacement",
    openedPacificDate: "2026-08-03",
    mutationId: "mutation-start-fresh-1",
    requestHash: "request-hash",
    receipt: response.result,
    now: 1_754_240_000_000,
  }]);
});

test("workbench rollover rejects stale state before mutation", async () => {
  let called = false;
  await assert.rejects(
    () => controlPracticeWorkbench(
      { workbench: { id: "workbench-newer" } },
      {
        expectedWorkbenchId: "workbench-stale",
        mutationId: "mutation-start-fresh-2",
        action: "start_fresh",
        authorization: "explicit_user_instruction",
      },
      "request-hash",
      "2026-08-03",
      {
        now: () => 1_754_240_000_000,
        newWorkbenchId: () => "workbench-replacement",
        startFreshPracticeWorkbench: async () => { called = true; },
      },
    ),
    (error) => error?.code === "stale_workbench",
  );
  assert.equal(called, false);
});

test("advance selects the next unfinished practice activity in canonical session order", () => {
  const next = selectNextPracticeActivity({
    currentActivityId: "activity-2",
    sessionActivityIds: ["activity-1", "activity-2", "focus-1", "activity-3", "activity-4"],
    practiceActivityIds: new Set(["activity-1", "activity-2", "activity-3", "activity-4"]),
    completedActivityIds: new Set(["activity-1", "activity-4"]),
  });

  assert.equal(next, "activity-3");
});

test("advance never wraps or leaves the session unless the user explicitly names another activity", () => {
  assert.throws(
    () => selectNextPracticeActivity({
      currentActivityId: "activity-3",
      sessionActivityIds: ["activity-1", "activity-2", "activity-3"],
      practiceActivityIds: new Set(["activity-1", "activity-2", "activity-3", "standalone-1"]),
      completedActivityIds: new Set(["activity-1", "activity-2"]),
    }),
    (error) => error?.code === "no_next_activity",
  );

  assert.equal(selectNextPracticeActivity({
    currentActivityId: "activity-3",
    explicitNextActivityId: "standalone-1",
    sessionActivityIds: ["activity-1", "activity-2", "activity-3"],
    practiceActivityIds: new Set(["activity-1", "activity-2", "activity-3", "standalone-1"]),
    completedActivityIds: new Set(["activity-1", "activity-2"]),
  }), "standalone-1");
});

test("advance rejects an unknown or completed explicit destination", () => {
  assert.throws(
    () => selectNextPracticeActivity({
      currentActivityId: "activity-1",
      explicitNextActivityId: "activity-2",
      sessionActivityIds: ["activity-1", "activity-2"],
      practiceActivityIds: new Set(["activity-1", "activity-2"]),
      completedActivityIds: new Set(["activity-2"]),
    }),
    (error) => error?.code === "next_activity_unavailable",
  );

  assert.throws(
    () => selectNextPracticeActivity({
      currentActivityId: "activity-1",
      explicitNextActivityId: "activity-1",
      sessionActivityIds: ["activity-1", "activity-2"],
      practiceActivityIds: new Set(["activity-1", "activity-2"]),
      completedActivityIds: new Set(),
    }),
    (error) => error?.code === "next_activity_unavailable",
  );
});

test("specialist Today controls are registered, allowlisted, and contract-bound", async () => {
  const [worker, store, config, contract, leetcodeGuide] = await Promise.all([
    readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/specialist-controls-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/specialist-today-controls.md", import.meta.url), "utf8"),
    readFile(new URL("../practice/leetcode/AGENTS.md", import.meta.url), "utf8"),
  ]);
  for (const tool of [
    "query_practice_catalog",
    "plan_today_practice",
    "control_practice_timer",
    "control_practice_session_timer",
    "control_practice_workbench",
    "set_practice_result",
  ]) {
    assert.match(worker, new RegExp(`server\\.registerTool\\(\\s*["']${tool}["']`));
    assert.match(config, new RegExp(`["']${tool}["']`));
    assert.equal(contract.includes(`\`${tool}\``), true);
  }
  assert.match(worker, /expectedWorkbenchId/);
  assert.match(worker, /expectedRevision/);
  assert.match(worker, /mutationId/);
  assert.match(store, /db\.batch/);
  assert.match(store, /revisionGuard/);
  assert.match(store, /todayPlanningMutations/);
  assert.match(
    store,
    /export async function controlSessionPracticeTimer[\s\S]*?await db\.batch\(statements/,
  );
  assert.match(
    store,
    /controlSessionPracticeTimer[\s\S]*?pauseStatements[\s\S]*?finishStatements[\s\S]*?todayPlanningMutations/,
  );
  assert.match(
    store,
    /export async function startFreshPracticeWorkbench[\s\S]*?finishStatements[\s\S]*?practiceWorkbenches[\s\S]*?todayPlanningMutations[\s\S]*?await db\.batch\(statements/,
  );
  assert.match(worker, /controlSessionPracticeTimer\(\{ ownerId, \.\.\.control \}\)/);
  assert.doesNotMatch(
    worker,
    /controlPracticeSessionTimer\([\s\S]{0,300}receiptStored:\s*false/,
  );
  assert.match(contract, /explicit user instruction/i);
  assert.match(contract, /authoritative D1 read-back/i);
  assert.match(leetcodeGuide, /control_practice_timer/);
});

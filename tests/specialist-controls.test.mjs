import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  selectNextPracticeActivity,
} from "../db/specialist-controls-policy.ts";

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
});

test("specialist Today controls are registered, allowlisted, and contract-bound", async () => {
  const [worker, config, contract, leetcodeGuide] = await Promise.all([
    readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/specialist-today-controls.md", import.meta.url), "utf8"),
    readFile(new URL("../practice/leetcode/AGENTS.md", import.meta.url), "utf8"),
  ]);
  for (const tool of [
    "query_practice_catalog",
    "plan_today_practice",
    "control_practice_timer",
    "set_practice_result",
  ]) {
    assert.match(worker, new RegExp(`server\\.registerTool\\(\\s*["']${tool}["']`));
    assert.match(config, new RegExp(`["']${tool}["']`));
    assert.equal(contract.includes(`\`${tool}\``), true);
  }
  assert.match(worker, /expectedWorkbenchId/);
  assert.match(worker, /expectedRevision/);
  assert.match(worker, /mutationId/);
  assert.match(contract, /explicit user instruction/i);
  assert.match(contract, /authoritative D1 read-back/i);
  assert.match(leetcodeGuide, /control_practice_timer/);
});

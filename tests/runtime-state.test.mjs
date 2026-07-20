import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dateInTimeZone, emptyJournal } from "../app/current-day.ts";
import { resolveOwnerId, TRUSTED_EMAIL_HEADER } from "../db/owner.ts";
import { foldElapsed, nextTimerState } from "../db/timer-state.ts";

test("today follows the practice timezone instead of the Worker UTC date", () => {
  assert.equal(dateInTimeZone(new Date("2026-07-20T05:30:00Z")), "2026-07-19");
  assert.equal(dateInTimeZone(new Date("2026-07-20T08:00:00Z")), "2026-07-20");
  assert.deepEqual(emptyJournal("2026-07-20").activities, []);
});

test("timer transitions fold elapsed time and permanently lock finish", () => {
  assert.equal(foldElapsed(12, 1_000, 4_900), 15);
  const started = nextTimerState(undefined, "start", 1_000);
  const paused = nextTimerState(started, "pause", 4_900);
  assert.deepEqual(paused, { accumulatedSeconds: 3, runningSince: null, completed: false, revision: 2 });
  const finished = nextTimerState(paused, "finish", 8_000);
  assert.deepEqual(finished, { accumulatedSeconds: 3, runningSince: null, completed: true, revision: 3 });
  assert.equal(nextTimerState(finished, "start", 10_000), finished);
});

test("authenticated emails map to stable, non-PII owner ids", async () => {
  const first = await resolveOwnerId(new Request("https://example.test", { headers: { [TRUSTED_EMAIL_HEADER]: "Person@Example.com" } }));
  const second = await resolveOwnerId(new Request("https://example.test", { headers: { [TRUSTED_EMAIL_HEADER]: " person@example.com " } }));
  const another = await resolveOwnerId(new Request("https://example.test", { headers: { [TRUSTED_EMAIL_HEADER]: "friend@example.com" } }));
  assert.match(first, /^u_[a-f0-9]{32}$/);
  assert.equal(first, second);
  assert.notEqual(first, another);
  assert.equal(await resolveOwnerId(new Request("https://example.test")), "owner");
});

test("D1 migrations cover owner-scoped live state and shared published content", async () => {
  const live = await readFile(new URL("../drizzle/0000_nosy_legion.sql", import.meta.url), "utf8");
  const content = await readFile(new URL("../drizzle/0001_high_nightmare.sql", import.meta.url), "utf8");
  for (const table of ["timers", "outcomes", "extra_activities", "live_sessions"]) {
    assert.match(live, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(live, /`owner_id` text NOT NULL/);
  for (const table of ["content_journals", "content_artifacts", "content_bank", "content_stories"]) {
    assert.match(content, new RegExp("CREATE TABLE `" + table + "`"));
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dateInTimeZone, emptyJournal } from "../app/current-day.ts";
import { SESSION_SECONDS, sessionAllocationSeconds } from "../app/live-types.ts";
import { practiceDateAt, practicePeriodAt } from "../app/practice-time.ts";
import { resolveOwnerId, TRUSTED_EMAIL_HEADER } from "../db/owner.ts";
import { derivePublicationStatus } from "../db/publication-state.ts";
import { foldElapsed, nextTimerState } from "../db/timer-state.ts";
import { isJournalPath, journalBranch, parsePorcelain } from "../scripts/journal-branch.mjs";

test("today follows the practice timezone instead of the Worker UTC date", () => {
  assert.equal(dateInTimeZone(new Date("2026-07-20T05:30:00Z")), "2026-07-19");
  assert.equal(dateInTimeZone(new Date("2026-07-20T08:00:00Z")), "2026-07-20");
  assert.deepEqual(emptyJournal("2026-07-20").activities, []);
});

test("activity completion dates and rhythm periods follow Pacific time across midnight", () => {
  assert.equal(practiceDateAt(Date.parse("2026-07-21T06:59:59Z")), "2026-07-20");
  assert.equal(practiceDateAt(Date.parse("2026-07-21T07:00:00Z")), "2026-07-21");
  assert.equal(practicePeriodAt(Date.parse("2026-07-21T06:30:00Z")), "Evening");
  assert.equal(practicePeriodAt(Date.parse("2026-07-21T07:30:00Z")), "Late night");
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

test("session allocations follow the configurable 40/60/60-minute recipe", () => {
  assert.equal(sessionAllocationSeconds(6, 1, 1), 21_600);
  assert.equal(SESSION_SECONDS, 21_600);
  assert.equal(sessionAllocationSeconds(3, 2, 0), 14_400);
  assert.equal(sessionAllocationSeconds(0, 1, 2), 10_800);
  assert.equal(sessionAllocationSeconds(-2, 0, 0), 0);
});

test("finished activities enter the journal queue without a second toggle", () => {
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: false }), "draft");
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: true }), "ready");
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: false, storedPublication: "ready" }), "ready");
  assert.equal(derivePublicationStatus({ hasArtifact: true, completed: true }), "published");
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: true, storedPublication: "published" }), "ready");
  assert.equal(derivePublicationStatus({ hasArtifact: true, completed: true, storedPublication: "published" }), "published");
});

test("daily checkpoint guard recognizes only journal-owned changes", () => {
  assert.equal(journalBranch("2026-07-20"), "journal/2026-07-20");
  assert.throws(() => journalBranch("July-20"), /ISO date/);
  assert.equal(isJournalPath("data/daily/2026-07-20.json", "2026-07-20"), true);
  assert.equal(isJournalPath("practice/leetcode/attempts/2026-07-20-two-sum.md", "2026-07-20"), true);
  assert.equal(isJournalPath("practice/system-design/sessions/2026-07-20-feed.md", "2026-07-20"), true);
  assert.equal(isJournalPath("app/home-client.tsx", "2026-07-20"), false);
  assert.deepEqual(parsePorcelain("?? data/daily/2026-07-20.json\n M app/home-client.tsx\n"), [
    "data/daily/2026-07-20.json",
    "app/home-client.tsx",
  ]);
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
  const connected = await readFile(new URL("../drizzle/0002_chubby_the_hand.sql", import.meta.url), "utf8");
  const orchestrator = await readFile(new URL("../drizzle/0003_clear_miek.sql", import.meta.url), "utf8");
  for (const table of ["timers", "outcomes", "extra_activities", "live_sessions"]) {
    assert.match(live, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(live, /`owner_id` text NOT NULL/);
  for (const table of ["content_journals", "content_artifacts", "content_bank", "content_stories"]) {
    assert.match(content, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const table of ["publication_statuses", "activity_notes", "integration_tokens"]) {
    assert.match(connected, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(connected, /`token_hash` text PRIMARY KEY NOT NULL/);
  for (const table of ["practice_focus", "timer_intervals"]) {
    assert.match(orchestrator, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(orchestrator, /ALTER TABLE `timers` ADD `started_at` integer/);
});

test("contracts preserve flexible session duration, membership, and exact timestamps", async () => {
  const activity = JSON.parse(await readFile(new URL("../docs/contracts/activity.schema.json", import.meta.url), "utf8"));
  const journal = JSON.parse(await readFile(new URL("../docs/contracts/daily-journal.schema.json", import.meta.url), "utf8"));
  const leetcode = JSON.parse(await readFile(new URL("../docs/contracts/leetcode-log.schema.json", import.meta.url), "utf8"));
  assert.equal(activity.properties.sessionId.type, "string");
  assert.equal(activity.properties.startedAt.format, "date-time");
  assert.equal(activity.properties.endedAt.format, "date-time");
  assert.equal(journal.properties.sessions.items.properties.allocatedSeconds.minimum, 60);
  assert.equal(leetcode.properties.practiceTimezone.const, "America/Los_Angeles");
  assert.equal(leetcode.properties.timing.properties.startedAt.format, "date-time");
});

test("the Chrome companion is scoped to public LeetCode pages and the bridge host", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.deepEqual(manifest.host_permissions, [
    "https://leetcode.com/problems/*",
    "https://limitless-mcp.vinosama.workers.dev/*",
  ]);
  assert.equal(manifest.content_scripts, undefined);
});

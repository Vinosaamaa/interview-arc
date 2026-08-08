import test from "node:test";
import assert from "node:assert/strict";
import {
  averageEffortBreakdown,
  journeyHrefWithoutReader,
  journeyReaderHref,
  pastReaderHref,
  readJourneyReaderState,
  readPastReaderState,
  readWorkspaceRouteView,
  uniqueJourneyEntries,
  workspaceViewHref,
} from "../app/journey-insights.ts";

const entries = [
  { id: "hard", questionId: "q-hard", date: "2026-08-07", type: "leetcode", title: "Hard", elapsedSeconds: 600 },
  { id: "hard", questionId: "q-hard", date: "2026-08-07", type: "leetcode", title: "Hard duplicate", elapsedSeconds: 600 },
  { id: "custom", date: "2026-08-06", type: "leetcode", title: "Custom", elapsedSeconds: 300 },
  { id: "design", date: "2026-08-05", type: "system_design", title: "Design", elapsedSeconds: 900 },
  { id: "zero", date: "2026-08-05", type: "behavioral", title: "Zero", elapsedSeconds: 0 },
  { id: "old", date: "2026-01-01", type: "behavioral", title: "Old", elapsedSeconds: 100 },
];

test("Journey effort uses stable-ID deduplication, range, and authoritative positive time", () => {
  assert.deepEqual(uniqueJourneyEntries(entries, "2026-08-01", "2026-08-07").map((entry) => entry.id), ["hard", "custom", "design", "zero"]);
  const buckets = Object.fromEntries(averageEffortBreakdown(entries, [{ id: "q-hard", title: "Hard", difficulty: "hard" }], "2026-08-01", "2026-08-07").map((bucket) => [bucket.key, bucket]));
  assert.deepEqual({ count: buckets.coding.count, total: buckets.coding.totalSeconds, average: buckets.coding.averageSeconds }, { count: 2, total: 900, average: 450 });
  assert.equal(buckets.hard.count, 1);
  assert.equal(buckets.unknown.count, 1);
  assert.equal(buckets.system_design.averageSeconds, 900);
  assert.equal(buckets.behavioral.averageSeconds, null);
});

test("Journey attempt URLs round-trip state and can return to Journey", () => {
  const href = journeyReaderHref("https://example.test/practice?keep=yes", { attemptId: "activity/one", range: "30", metric: "time", heatmap: "leetcode", day: "2026-08-07", topic: "Graphs" });
  assert.deepEqual(readJourneyReaderState(`https://example.test${href}`), { attemptId: "activity/one", range: "30", metric: "time", heatmap: "leetcode", day: "2026-08-07", topic: "Graphs" });
  const closed = journeyHrefWithoutReader(`https://example.test${href}`);
  assert.match(closed, /view=journey/);
  assert.doesNotMatch(closed, /attempt=/);
  assert.match(closed, /keep=yes/);
});

test("Malformed Journey reader URLs fail closed", () => {
  assert.equal(readJourneyReaderState("https://example.test/?view=journey&attempt=x&range=garbage"), null);
  assert.equal(readJourneyReaderState("https://example.test/?view=journey&attempt=x&day=yesterday"), null);
});

test("Past attempt URLs round-trip stable selection without Journey-only state", () => {
  const href = pastReaderHref("https://example.test/practice?keep=yes&range=30&topic=Graphs", "activity/one");
  assert.deepEqual(readPastReaderState(`https://example.test${href}`), { attemptId: "activity/one" });
  assert.equal(readJourneyReaderState(`https://example.test${href}`), null);
  assert.match(href, /view=past/);
  assert.match(href, /attempt=activity%2Fone/);
  assert.match(href, /keep=yes/);
  assert.doesNotMatch(href, /range=|topic=/);
});

test("Workspace routes keep every primary surface visible in the URL and clear stale reader state", () => {
  const href = workspaceViewHref("https://example.test/practice?keep=yes&view=journey&attempt=old&range=30", "past");
  assert.equal(readWorkspaceRouteView(`https://example.test${href}`), "past");
  assert.match(href, /keep=yes/);
  assert.doesNotMatch(href, /attempt=|range=/);
  assert.equal(readPastReaderState("https://example.test/?view=past&attempt=%20"), null);
  assert.equal(readWorkspaceRouteView("https://example.test/?view=unknown"), null);
});

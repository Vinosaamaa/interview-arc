import test from "node:test";
import assert from "node:assert/strict";
import {
  averageEffortBreakdown,
  bankReaderHref,
  journeyHrefWithoutReader,
  journeyReaderHref,
  loopWorkspaceHref,
  pastReaderHref,
  pastSolutionReaderHref,
  reviewReaderHref,
  reviewSolutionReaderHref,
  readerDepthAfterNestedClose,
  readerClosePlan,
  readJourneyReaderState,
  readLoopWorkspaceState,
  readBankReaderState,
  readPastReaderState,
  readReviewReaderState,
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
  assert.equal(readJourneyReaderState("https://example.test/?view=journey&attempt=x&specialty=leetcode"), null);
  assert.equal(readPastReaderState("https://example.test/?view=past&attempt=x&problem=word-break-ii"), null);
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

test("Review attempt URLs keep the reader owned by Reviews", () => {
  const href = reviewReaderHref("https://example.test/practice?keep=yes&view=reviews#case-transcript-thread", "activity/one");
  assert.deepEqual(readReviewReaderState(`https://example.test${href}`), { attemptId: "activity/one" });
  assert.equal(readPastReaderState(`https://example.test${href}`), null);
  assert.match(href, /view=reviews/);
  assert.match(href, /attempt=activity%2Fone/);
  assert.match(href, /keep=yes/);
  assert.doesNotMatch(href, /#/);
});

test("Review nested solution URLs close back to the exact review attempt", () => {
  const attemptHref = reviewReaderHref("https://example.test/practice?keep=yes&view=reviews", "activity/one");
  const solutionHref = reviewSolutionReaderHref(`https://example.test${attemptHref}`, "activity/one", "leetcode", "word-break-ii");
  assert.deepEqual(readReviewReaderState(`https://example.test${solutionHref}`), {
    attemptId: "activity/one",
    specialty: "leetcode",
    problemId: "word-break-ii",
  });
  assert.deepEqual(readerClosePlan(`https://example.test${solutionHref}`), {
    view: "reviews",
    href: attemptHref,
  });
});

test("Past nested solution URLs retain both attempt and stable problem identity", () => {
  const href = pastSolutionReaderHref("https://example.test/practice?keep=yes", "activity/one", "leetcode", "word-break-ii");
  assert.deepEqual(readPastReaderState(`https://example.test${href}`), {
    attemptId: "activity/one",
    specialty: "leetcode",
    problemId: "word-break-ii",
  });
  assert.match(href, /specialty=leetcode/);
  assert.match(href, /problem=word-break-ii/);
});

test("Workspace routes keep every primary surface visible in the URL and clear stale reader state", () => {
  const href = workspaceViewHref("https://example.test/practice?keep=yes&view=journey&attempt=old&range=30", "past");
  assert.equal(readWorkspaceRouteView(`https://example.test${href}`), "past");
  assert.match(href, /keep=yes/);
  assert.doesNotMatch(href, /attempt=|range=/);
  assert.equal(readPastReaderState("https://example.test/?view=past&attempt=%20"), null);
  assert.equal(readWorkspaceRouteView("https://example.test/?view=unknown"), null);
  assert.equal(readWorkspaceRouteView("https://example.test/?view=reviews"), "reviews");
  assert.equal(readWorkspaceRouteView("https://example.test/?view=loops"), "loops");
  assert.equal(readWorkspaceRouteView("https://example.test/?view=career-materials"), "career-materials");
});

test("Loop routes preserve exact Loop and round selection while Past links retain their origin", () => {
  const loopHref = loopWorkspaceHref("https://example.test/practice?keep=yes&attempt=old", {
    loopId: "loop-example-platform",
    stageId: "round-recruiter",
  });
  assert.equal(loopHref, "/practice?keep=yes&view=loops&loop=loop-example-platform&round=round-recruiter");
  assert.deepEqual(readLoopWorkspaceState(`https://example.test${loopHref}`), {
    loopId: "loop-example-platform",
    stageId: "round-recruiter",
  });
  const pastHref = pastReaderHref(`https://example.test${loopHref}`, "attempt-exact");
  assert.equal(
    pastHref,
    "/practice?keep=yes&view=past&loop=loop-example-platform&round=round-recruiter&attempt=attempt-exact",
  );
  assert.equal(readLoopWorkspaceState(`https://example.test${pastHref}`), null);
});

test("Problem Bank URLs preserve stable problem and nested attempt identity", () => {
  const solution = bankReaderHref("https://example.test/practice?keep=yes", "leetcode", "word-break-ii");
  assert.deepEqual(readBankReaderState(`https://example.test${solution}`), {
    specialty: "leetcode",
    problemId: "word-break-ii",
    attemptId: "",
  });
  assert.match(solution, /view=banks/);
  assert.match(solution, /problem=word-break-ii/);
  assert.match(solution, /keep=yes/);

  const attempt = bankReaderHref(`https://example.test${solution}`, "leetcode", "word-break-ii", "activity/one");
  assert.deepEqual(readBankReaderState(`https://example.test${attempt}`), {
    specialty: "leetcode",
    problemId: "word-break-ii",
    attemptId: "activity/one",
  });
  assert.match(attempt, /attempt=activity%2Fone/);
  assert.equal(readBankReaderState("https://example.test/?view=banks&specialty=unknown&problem=x"), null);
});

test("reader close plans deterministically return Journey, Reviews, Past, and Bank readers to their origin routes", () => {
  const journeyReader = "https://example.test/practice?keep=yes&view=journey&attempt=activity%2Fone&range=30&metric=time&heatmap=leetcode&day=2026-08-07&topic=Graphs#reader";
  const journeySolution = journeyReader.replace("#reader", "&specialty=leetcode&problem=word-break-ii#reader");
  const pastReader = "https://example.test/practice?keep=yes&view=past&attempt=activity%2Fone&range=30#reader";
  const pastSolution = pastReader.replace("#reader", "&specialty=leetcode&problem=word-break-ii#reader");
  const bankAttempt = "https://example.test/practice?keep=yes&view=banks&specialty=leetcode&problem=word-break-ii&attempt=activity%2Fone#reader";
  const reviewReader = "https://example.test/practice?keep=yes&view=reviews&attempt=activity%2Fone#reader";
  const cases = [
    [journeyReader, { view: "journey", href: "/practice?keep=yes&view=journey" }],
    [journeySolution, { view: "journey", href: "/practice?keep=yes&view=journey&attempt=activity%2Fone&range=30&metric=time&heatmap=leetcode&day=2026-08-07&topic=Graphs" }],
    [pastReader, { view: "past", href: "/practice?keep=yes&view=past" }],
    [pastSolution, { view: "past", href: "/practice?keep=yes&view=past&attempt=activity%2Fone" }],
    [bankAttempt, { view: "banks", href: "/practice?keep=yes&view=banks&specialty=leetcode&problem=word-break-ii" }],
    [reviewReader, { view: "reviews", href: "/practice?keep=yes&view=reviews" }],
    ["https://example.test/practice?view=banks&specialty=leetcode&problem=word-break-ii", { view: "banks", href: "/practice?view=banks" }],
  ];
  cases.forEach(([href, expected]) => assert.deepEqual(readerClosePlan(href), expected, href));
  assert.equal(readerClosePlan("https://example.test/practice?view=today"), null);
});

test("direct nested-reader close fallbacks never fabricate browser history depth", () => {
  assert.equal(readerDepthAfterNestedClose(undefined), 0);
  assert.equal(readerDepthAfterNestedClose(0), 0);
  assert.equal(readerDepthAfterNestedClose(1), 0);
  assert.equal(readerDepthAfterNestedClose(3), 2);
});

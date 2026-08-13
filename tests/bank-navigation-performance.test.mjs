import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BANK_INITIAL_VISIBLE_COUNT,
  BANK_VISIBLE_CHUNK_SIZE,
  buildLatestBankAttemptIndex,
  findLatestBankAttempt,
  nextBankVisibleCount,
} from "../app/bank-navigation-performance.ts";

const question = {
  id: "two-sum",
  title: "Two Sum",
  url: "https://example.test/problems/two-sum/",
};

test("the latest-attempt index preserves id, URL, and legacy-title matching", () => {
  const attempts = [
    {
      id: "old-by-id",
      questionId: "two-sum",
      type: "leetcode",
      title: "Two Sum",
      date: "2026-08-01",
      endedAt: "2026-08-01T12:00:00Z",
    },
    {
      id: "new-by-url",
      type: "leetcode",
      title: "Legacy imported title",
      url: "https://example.test/problems/two-sum",
      date: "2026-08-02",
      endedAt: "2026-08-02T12:00:00Z",
    },
    {
      id: "other-specialty",
      type: "behavioral",
      title: "Two Sum",
      date: "2026-08-03",
      endedAt: "2026-08-03T12:00:00Z",
    },
  ];

  const index = buildLatestBankAttemptIndex(attempts);
  assert.equal(findLatestBankAttempt(index, "leetcode", question)?.id, "new-by-url");
  assert.equal(findLatestBankAttempt(index, "behavioral", { id: "legacy", title: "Two Sum" })?.id, "other-specialty");
});

test("the mounted Banks window grows in bounded chunks without truncating the catalog", () => {
  assert.equal(BANK_INITIAL_VISIBLE_COUNT, 36);
  assert.equal(BANK_VISIBLE_CHUNK_SIZE, 36);
  assert.equal(nextBankVisibleCount(BANK_INITIAL_VISIBLE_COUNT, 531), 72);
  assert.equal(nextBankVisibleCount(504, 531), 531);
  assert.equal(nextBankVisibleCount(531, 531), 531);
});

test("Banks renders a bounded card window while keeping the authoritative result count", async () => {
  const [homeClient, styles] = await Promise.all([
    readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/interview-arc-v2.css", import.meta.url), "utf8"),
  ]);

  assert.match(homeClient, /const mountedEntries = visibleEntries\.slice\(0, bankVisibleCount\)/);
  assert.match(homeClient, /mountedEntries\.map\(/);
  assert.match(homeClient, /\{visibleEntries\.length\} result/);
  assert.match(homeClient, /nextBankVisibleCount\(current, visibleEntries\.length\)/);
  assert.match(styles, /\.problem-bank-entry\s*\{[^}]*content-visibility:\s*auto/s);
});

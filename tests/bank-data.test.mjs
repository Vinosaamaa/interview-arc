import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

test("imports the complete deduplicated TikTok company snapshot", async () => {
  const bank = await readJson("practice/leetcode/bank/questions.json");
  assert.equal(bank.questions.length, 350);
  assert.equal(new Set(bank.questions.map((question) => question.id)).size, 350);
  assert.equal(new Set(bank.questions.map((question) => question.url)).size, 350);
  assert.equal(new Set(bank.questions.map((question) => question.problemNumber)).size, 350);
  assert.ok(bank.questions.every((question) => question.url.startsWith("https://leetcode.com/problems/")));
  assert.ok(bank.questions.every((question) => question.companyTags.includes("TikTok")));
  assert.ok(bank.questions.every((question) => question.companySignals.some((signal) =>
    signal.company === "TikTok" && signal.window === "all" && signal.frequencyScale === 8
  )));
});

test("stores all SystemDesign.io questions with reference preparation metadata", async () => {
  const bank = await readJson("practice/system-design/bank/questions.json");
  assert.equal(bank.questions.length, 55);
  assert.equal(new Set(bank.questions.map((question) => question.id)).size, 55);
  assert.ok(bank.questions.every((question) => question.url.startsWith("https://systemdesign.io/question/")));
  assert.ok(bank.questions.every((question) => question.source === "SystemDesign.io"));
  assert.ok(bank.questions.every((question) => question.solutionReference === true));
  assert.deepEqual(
    Object.fromEntries(["easy", "medium", "hard", "very_hard"].map((complexity) => [
      complexity,
      bank.questions.filter((question) => question.complexity === complexity).length,
    ])),
    { easy: 15, medium: 14, hard: 15, very_hard: 11 },
  );
});

test("starts with no mock activity records while preserving the real system-design artifact", async () => {
  const journal = await readJson("data/daily/2026-07-17.json");
  const behavioral = await readJson("practice/behavioral/bank/questions.json");
  assert.deepEqual(journal.sessions, []);
  assert.deepEqual(journal.timerGroups, []);
  assert.deepEqual(journal.activities, []);
  assert.deepEqual(behavioral.questions, []);

  const artifact = await readFile(
    new URL("../practice/system-design/sessions/2026-07-08-design-tiktok-for-you-feed.md", import.meta.url),
    "utf8",
  );
  assert.match(artifact, /TikTok/i);
});

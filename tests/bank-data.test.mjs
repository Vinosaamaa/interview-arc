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

test("stores all Bugfree.ai behavioral questions with canonical answer references", async () => {
  const bank = await readJson("practice/behavioral/bank/questions.json");
  assert.equal(bank.questions.length, 74);
  assert.equal(new Set(bank.questions.map((question) => question.id)).size, 74);
  assert.equal(new Set(bank.questions.map((question) => question.url)).size, 74);
  assert.ok(bank.questions.every((question) => question.url.startsWith("https://bugfree.ai/behavior/")));
  assert.ok(bank.questions.every((question) => question.source === "Bugfree.ai"));
  assert.ok(bank.questions.every((question) => question.solutionReference === true));
  assert.deepEqual(
    Object.fromEntries(["SIMPLE", "STAR", "STARL", "PPF", "IFV"].map((format) => [
      format,
      bank.questions.filter((question) => question.answerFormat === format).length,
    ])),
    { SIMPLE: 3, STAR: 6, STARL: 54, PPF: 3, IFV: 8 },
  );
  assert.deepEqual(
    Object.fromEntries(["public", "may_require_sign_in"].map((access) => [
      access,
      bank.questions.filter((question) => question.referenceAccess === access).length,
    ])),
    { public: 18, may_require_sign_in: 56 },
  );
});

test("starts with no mock activity records while preserving the real system-design artifact", async () => {
  const journal = await readJson("data/daily/2026-07-17.json");
  assert.deepEqual(journal.sessions, []);
  assert.deepEqual(journal.timerGroups, []);
  assert.deepEqual(journal.activities, []);

  const artifact = await readFile(
    new URL("../practice/system-design/sessions/2026-07-08-design-tiktok-for-you-feed.md", import.meta.url),
    "utf8",
  );
  assert.match(artifact, /^# Design a TikTok-Style For You Feed$/m);
  assert.doesNotMatch(artifact, /^# 2026-07-08 System Design:/m);
});

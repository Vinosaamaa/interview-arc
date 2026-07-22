import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readContent } from "../scripts/content-source.mjs";

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
  assert.equal(bank.questions.length, 56);
  assert.equal(new Set(bank.questions.map((question) => question.id)).size, 56);
  const imported = bank.questions.filter((question) => question.source === "SystemDesign.io");
  assert.equal(imported.length, 55);
  assert.ok(imported.every((question) => question.url.startsWith("https://systemdesign.io/question/")));
  assert.ok(bank.questions.every((question) => question.solutionReference === true));
  assert.deepEqual(
    Object.fromEntries(["easy", "medium", "hard", "very_hard"].map((complexity) => [
      complexity,
      imported.filter((question) => question.complexity === complexity).length,
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

test("publishes only the real July 22 practice records while preserving the TikTok solution in the bank", async () => {
  const bank = await readJson("practice/system-design/bank/questions.json");
  const question = bank.questions.find((candidate) => candidate.id === "design-tiktok-style-for-you-feed");
  assert.equal(question.solutionPath, "practice/system-design/solutions/design-tiktok-for-you-feed.md");

  const solution = await readFile(
    new URL("../practice/system-design/solutions/design-tiktok-for-you-feed.md", import.meta.url),
    "utf8",
  );
  assert.match(solution, /^# Design a TikTok-Style For You Feed$/m);
  assert.doesNotMatch(solution, /^## Conversation Transcript$/m);

  await assert.rejects(readFile(new URL("../data/daily/2026-07-17.json", import.meta.url), "utf8"), /ENOENT/);
  await assert.rejects(readFile(new URL("../practice/system-design/sessions/2026-07-08-design-tiktok-for-you-feed.md", import.meta.url), "utf8"), /ENOENT/);

  const content = await readContent(fileURLToPath(new URL("..", import.meta.url)));
  const hydrated = content.questionBanks.systemDesign.find((candidate) => candidate.id === question.id);
  assert.equal(content.journals.length, 1);
  assert.equal(content.journals[0].date, "2026-07-22");
  assert.deepEqual(
    content.journals[0].activities.map((activity) => activity.id).sort(),
    [
      "2026-07-21-session-1-0-0-build-a-marketplace-feature-for-facebook",
      "2026-07-21-session-1-0-0-course-schedule",
    ].sort(),
  );
  assert.deepEqual(
    content.artifacts.map((artifact) => artifact.path).sort(),
    [
      "practice/leetcode/attempts/2026-07-22-course-schedule.md",
      "practice/system-design/sessions/2026-07-22-build-a-marketplace-feature-for-facebook.md",
    ].sort(),
  );
  assert.ok(content.artifacts.every((artifact) => artifact.date === "2026-07-22"));
  assert.ok(hydrated.solutionProfile.summary.length > 100);
  assert.ok(hydrated.solutionProfile.sections.some((section) => section.title === "Requirements"));
});

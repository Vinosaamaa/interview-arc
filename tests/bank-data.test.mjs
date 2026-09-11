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
  assert.equal(bank.questions.length, 399);
  assert.equal(new Set(bank.questions.map((question) => question.id)).size, bank.questions.length);
  assert.equal(new Set(bank.questions.map((question) => question.url)).size, bank.questions.length);
  assert.equal(new Set(bank.questions.map((question) => question.problemNumber)).size, bank.questions.length);
  assert.ok(bank.questions.every((question) => question.url.startsWith("https://leetcode.com/problems/")));
  const snapshot = bank.questions.filter((question) => question.companyTags?.includes("TikTok"));
  assert.equal(snapshot.length, 350);
  assert.ok(snapshot.every((question) => question.companySignals.some((signal) =>
    signal.company === "TikTok" && signal.window === "all" && signal.frequencyScale === 8
  )));
});

test("NeetCode 150 has complete canonical membership and survives bank hydration", async () => {
  const manifest = await readJson("practice/leetcode/bank/neetcode-150.json");
  const bank = await readJson("practice/leetcode/bank/questions.json");
  const ids = manifest.categories.flatMap((category) => category.questionIds);
  assert.equal(ids.length, 150);
  assert.equal(new Set(ids).size, 150);
  assert.equal(manifest.categories.length, 18);
  const tagged = bank.questions.filter((question) => question.topics.includes(manifest.tag));
  assert.deepEqual(tagged.map((question) => question.id).sort(), [...ids].sort());
  for (const category of manifest.categories) {
    for (const id of category.questionIds) {
      const question = tagged.find((candidate) => candidate.id === id);
      assert.ok(question.active, id);
      assert.ok(question.topics.includes(category.title), id);
      assert.equal(question.url, `https://leetcode.com/problems/${id}/`);
    }
  }
  const additions = tagged.filter((question) => question.source === "manual");
  assert.equal(additions.length, 49);
  assert.ok(additions.every((question) => question.companyTags.length === 0
    && question.companySignals === undefined && question.acceptanceRate === undefined));
  const content = await readContent(fileURLToPath(new URL("..", import.meta.url)));
  assert.deepEqual(content.questionBanks.leetcode.filter((question) => question.topics.includes(manifest.tag))
    .map((question) => question.id).sort(), [...ids].sort());
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

test("loads public banks without a frozen personal journal or artifact projection", async () => {
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
  const hydratedCourseSchedule = content.questionBanks.leetcode.find((candidate) => candidate.id === "course-schedule");
  const hydratedMarketplace = content.questionBanks.systemDesign.find(
    (candidate) => candidate.id === "build-a-marketplace-feature-for-facebook",
  );
  assert.deepEqual(content.journals, []);
  assert.deepEqual(content.artifacts, []);
  assert.ok(hydrated.solutionProfile.summary.length > 100);
  assert.ok(hydrated.solutionProfile.sections.some((section) => section.title === "Requirements"));
  assert.equal(hydratedCourseSchedule.solutionProfile, undefined);
  assert.equal(hydratedMarketplace.solutionProfile, undefined);
});

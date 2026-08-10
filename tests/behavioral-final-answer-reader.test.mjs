import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findExactPastSnapshot, orderPastReaderSections } from "../app/behavioral-final-answer-view.ts";

const root = new URL("..", import.meta.url);

test("practice-record API returns the immutable snapshot projection and export formats", async () => {
  const route = await readFile(new URL("app/api/practice-record/route.ts", root), "utf8");
  for (const field of [
    "finalization: record.finalization",
    "finalAnswer: record.finalAnswer",
    "finalAnswerMarkdown: record.finalAnswerMarkdown",
    "finalAnswerHtml: record.finalAnswerHtml",
  ]) assert.match(route, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(route, /finalAnswerSnapshots: record\.finalAnswerSnapshots/);
});

test("Past loads and renders Final tailored answer separately after Conversation", async () => {
  const source = await readFile(new URL("app/home-client.tsx", root), "utf8");
  assert.match(source, /finalAnswer: record\.finalAnswer/);
  assert.match(source, /id="case-final-answer"/);
  assert.match(source, />Final tailored answer</);
  assert.match(source, /aria-label="Final tailored answer"/);
  assert.deepEqual(orderPastReaderSections({
    conversation: "conversation",
    finalAnswer: "final-answer",
    codeAttempts: "code-attempts",
    reviewSections: ["review"],
  }), ["conversation", "final-answer", "code-attempts", "review"]);
});

test("Problem Bank Past-attempt navigation opens the exact activity snapshot", async () => {
  const source = await readFile(new URL("app/home-client.tsx", root), "utf8");
  const attempts = [{ id: "attempt-1" }, { id: "attempt-2" }];
  assert.equal(findExactPastSnapshot(attempts, "attempt-2"), attempts[1]);
  assert.equal(findExactPastSnapshot(attempts, "missing"), null);
  assert.match(source, /findExactPastSnapshot\(libraryEntries, entry\.id\)/);
  assert.match(source, /bankReaderHref\(window\.location\.href, selectedProblem\.type, selectedProblem\.question\.id, exactEntry\.id\)/);
});

test("Export today embeds the same server-rendered Markdown and local HTML", async () => {
  const source = await readFile(new URL("app/home-client.tsx", root), "utf8");
  assert.match(source, /behavioralFinalAnswers/);
  assert.match(source, /finalAnswerMarkdown/);
  assert.match(source, /finalAnswerHtml/);
  assert.match(source, /\/api\/practice-record\?activityId=/);
});

test("responsive Final tailored answer card has visible focus and a single-column mobile layout", async () => {
  const css = await readFile(new URL("app/interview-arc-v2.css", root), "utf8");
  assert.match(css, /\.final-answer-card/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.final-answer-meta/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

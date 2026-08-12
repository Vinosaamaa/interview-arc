import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findExactPastSnapshot, orderPastReaderSections, retainLoadedPastSnapshot } from "../app/behavioral-final-answer-view.ts";

test("reselecting the same Past item keeps its loaded conversation evidence", () => {
  const loaded = {
    id: "attempt-1",
    title: "Loaded title",
    transcriptTurns: [{ turnId: "turn-1" }],
    audioClips: [{ captureId: "capture-1" }],
    codeAttempts: [{ id: "code-1" }],
  };
  const listProjection = { id: "attempt-1", title: "Fresh list title" };
  assert.deepEqual(retainLoadedPastSnapshot(loaded, listProjection), {
    ...loaded,
    title: "Fresh list title",
  });
  assert.equal(retainLoadedPastSnapshot(loaded, { id: "attempt-2", title: "Other" }).id, "attempt-2");
});

const root = new URL("..", import.meta.url);

test("practice-record API returns the immutable snapshot projection and export formats", async () => {
  const route = await readFile(new URL("app/api/practice-record/route.ts", root), "utf8");
  for (const field of [
    "finalization: record.finalization",
    "finalAnswer: record.finalAnswer",
    "finalAnswerMarkdown: record.finalAnswerMarkdown",
    "finalAnswerHtml: record.finalAnswerHtml",
    "practiceScenarios: record.practiceScenarios",
    "practiceScenariosMarkdown: record.practiceScenariosMarkdown",
    "practiceScenariosHtml: record.practiceScenariosHtml",
    "behavioralAnalysis: record.behavioralAnalysis",
    "behavioralAnalysisMarkdown: record.behavioralAnalysisMarkdown",
    "behavioralAnalysisHtml: record.behavioralAnalysisHtml",
    "resumeContext: record.resumeContext",
    "resumeContextMarkdown: record.resumeContextMarkdown",
    "resumeContextHtml: record.resumeContextHtml",
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
    resumeContext: "resume-context",
    practiceScenarios: "practice-scenarios",
    behavioralAnalysis: "behavioral-analysis",
    codeAttempts: "code-attempts",
    reviewSections: ["review"],
  }), ["conversation", "final-answer", "resume-context", "practice-scenarios", "behavioral-analysis", "code-attempts", "review"]);
});

test("Past renders exact profile-revision scenarios as a dedicated labeled section", async () => {
  const source = await readFile(new URL("app/home-client.tsx", root), "utf8");
  assert.match(source, /practiceScenarios: record\.practiceScenarios/);
  assert.match(source, /id="case-practice-scenarios"/);
  assert.match(source, />Practice scenarios</);
  assert.match(source, /not the owner's experience/);
});

test("Past renders one dedicated Behavioral Attempt audit after adjacent attempt evidence", async () => {
  const source = await readFile(new URL("app/home-client.tsx", root), "utf8");
  assert.match(source, /behavioralAnalysis: record\.behavioralAnalysis/);
  assert.match(source, /id="case-behavioral-analysis"/);
  assert.match(source, />Behavioral Attempt</);
  assert.match(source, /Generated coaching — not evidence/);
});

test("Past renders the exact immutable resume context without resume contents", async () => {
  const source = await readFile(new URL("app/home-client.tsx", root), "utf8");
  assert.match(source, /resumeContext: record\.resumeContext/);
  assert.match(source, /id="case-resume-context"/);
  assert.match(source, />Resume context</);
  assert.doesNotMatch(source, /resumeContext\.raw|resumeContext\.objectKey|resumeContext\.providerLocator/);
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
  assert.match(source, /practiceScenariosMarkdown/);
  assert.match(source, /practiceScenariosHtml/);
  assert.match(source, /behavioralAnalysisMarkdown/);
  assert.match(source, /behavioralAnalysisHtml/);
  assert.match(source, /resumeContextMarkdown/);
  assert.match(source, /resumeContextHtml/);
  assert.match(source, /\/api\/practice-record\?activityId=/);
});

test("behavioral snapshot cards preserve visible focus and responsive mobile layouts", async () => {
  const css = await readFile(new URL("app/interview-arc-v2.css", root), "utf8");
  assert.match(css, /\.final-answer-card/);
  assert.match(css, /\.behavioral-attempt-card/);
  assert.match(css, /\.behavioral-claim-audit dl/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.final-answer-meta/);
  assert.match(css, /\.resume-context-card > footer a:focus-visible/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.resume-context-card dl/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

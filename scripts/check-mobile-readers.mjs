// Isolated local-only populated-reader regression. UI_BROWSER=chromium optionally.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright-core";

const base = process.env.UI_BASE_URL ?? "http://127.0.0.1:3053";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const engine = process.env.UI_BROWSER === "chromium" ? chromium : webkit;
const browser = await engine.launch({ headless: true, ...(process.env.UI_BROWSER_PATH ? { executablePath: process.env.UI_BROWSER_PATH } : {}) });
const output = `.cache/mobile-readers-${process.env.UI_BROWSER ?? "webkit"}`;
await mkdir(output, { recursive: true });
const code = 'public class Solution {\n' + Array.from({ length: 100 }, (_, i) => `    // Line ${i}: ${"preserve long code and both scroll axes; ".repeat(4)}`).join('\n') + '\n}';
const specialties = ["leetcode", "system_design", "behavioral"];
const questions = specialties.map(specialty => ({ specialty, questionId: `mobile-${specialty}`, title: `Mobile ${specialty} reader fixture`, prompt: "Synthetic reader fixture.", source: "owner", tags: [], topics: [], companyTags: [], companySignals: [], metadataReferences: [], priority: 0, problemNumber: null, difficulty: "hard", url: null, acceptanceRate: null, metadataCapturedAt: null }));

try {
  const page = await browser.newPage({ viewport: { width: 440, height: 800 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/\/api\/practice-record\?/, async route => {
    const activityId = new URL(route.request().url()).searchParams.get("activityId");
    await route.fulfill({ json: { turns: ["specialist", "user", "specialist"].map((speaker, index) => ({
      activityId, turnId: `turn-${index}`, specialty: "leetcode", speaker, source: "codex", sequence: index + 1,
      occurredAt: Date.parse("2026-09-01T17:00:00Z") + index * 60000, updatedAt: 0,
      body: `Synthetic conversation ${index + 1}. ` + "Explain how each input changes the result, then check the boundary cases. ".repeat(8),
    })), notes: [], audioClips: [], deliveryAnalyses: [], codeAttempts: [], interactionModeTransitions: [], practiceAssets: [], practiceRecord: null } });
  });
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.__copiedCode = text; } } }); });
  await page.route(/\/api\/(state|timer-state)(\?|$)/, async route => {
    const response = await route.fetch();
    const state = await response.json();
    state.personalQuestions = questions;
    state.solutionProfiles = questions.map(q => ({ specialty: q.specialty, questionId: q.questionId, title: q.title, currentRevision: 1, tags: [], updatedAt: 0,
      payload: { schemaVersion: 1, summary: "Synthetic long-form explanation with code, inline signatures, and a table.", tags: [], references: [], sections: [
        { title: "Problem", body: "Given an arithmetic expression containing variables and parentheses, substitute known values and return a normalized result. ".repeat(4) + "Use `expression, String[] evaluationVariables, int[] evaluationValues` without dropping input." },
        { title: "Implementation", body: `\`\`\`java\n${code}\n\`\`\`\n\nEND OF CODE: this paragraph must wrap normally.\n\n| Method | Meaning |\n| --- | --- |\n| evaluateExpressionWithSubstitutions | Preserve every supplied input |` },
      ] } }));
    const start = Date.parse("2026-09-01T17:00:00Z");
    state.historyActivities = questions.map(q => ({ schemaVersion: 1, source: "extra", timingSource: "website", status: "completed", reviewDates: [], id: `attempt-${q.specialty}`, title: q.title, type: q.specialty, questionId: q.questionId, date: "2026-09-01", timerGroupId: "fixture", allocatedSeconds: 3600, notes: "Synthetic attempt fixture.", startedAt: new Date(start).toISOString(), endedAt: new Date(start + 2400000).toISOString() }));
    state.timers ??= {}; state.outcomes ??= {};
    for (const a of state.historyActivities) { state.timers[a.id] = { accumulatedSeconds: 2400, startedAt: start, runningSince: null, completed: true, completedAt: start + 2400000, revision: 1 }; state.outcomes[a.id] = "solved_after_reviewing_approach"; }
    await route.fulfill({ json: state });
  });
  const settle = async () => {
    await page.locator(".arrival-ritual").waitFor({ state: "detached" });
    await page.waitForFunction(() => [...document.querySelectorAll(".reader-workspace,.workspace-reader")].every(e => getComputedStyle(e).opacity === "1"));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const visit = async query => {
    await page.goto(`${base}/?${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Begin today/ }).click();
    await page.locator(".reader-workspace").waitFor();
    await settle();
  };
  const geometry = async (width, height) => {
    const g = await page.locator(".reader-workspace").evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    assert.ok(Math.abs(g.x) <= 1 && Math.abs(g.y) <= 1 && Math.abs(g.width - width) <= 1 && Math.abs(g.height - height) <= 1, JSON.stringify(g));
    assert.equal(await page.locator(".topbar").isVisible(), false);
    assert.equal(await page.locator(".mobile-interview-nav").isVisible(), false);
    // Code may use the prose gutter, but nothing may extend beyond the screen.
    const overflow = await page.locator(".workspace-reader-scroll .reader-group,.workspace-reader-scroll .markdown-body,.workspace-reader-scroll .code-stage").evaluateAll(es => es.filter(e => e.getBoundingClientRect().left < -1 || e.getBoundingClientRect().left + e.scrollWidth > innerWidth + 1).map(e => e.className));
    assert.deepEqual(overflow, [], "Prose must not overflow or be clipped");
  };
  for (const specialty of process.env.UI_SCROLL_ONLY ? [] : specialties) {
    for (const origin of ["banks", "past", "reviews"]) {
      await visit(`view=${origin}&specialty=${specialty}&problem=mobile-${specialty}${origin === "banks" ? "" : `&attempt=attempt-${specialty}`}`);
      await geometry(440, 800);
      const pre = page.locator(".workspace-reader-scroll .code-stage pre").first();
      await pre.scrollIntoViewIfNeeded();
      assert.ok(await pre.evaluate(e => e.scrollWidth > e.clientWidth && parseFloat(getComputedStyle(e).fontSize) >= 15));
      const contrast = await pre.evaluate(e => {
        const luminance = color => {
          const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
          return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
        };
        const background = luminance(getComputedStyle(e.closest('figure')).backgroundColor);
        return [e, ...e.querySelectorAll('span')].map(token => { const foreground = luminance(getComputedStyle(token).color); return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05); });
      });
      assert.ok(contrast.every(ratio => ratio >= 4.5), `Code contrast: ${contrast}`);
      await pre.evaluate(e => { e.scrollLeft = e.scrollWidth; });
      assert.ok(await pre.evaluate(e => e.scrollLeft > 0), "Long code is horizontally reachable");
      await pre.evaluate(e => { e.scrollTop = 100; });
      assert.ok(await pre.evaluate(e => e.scrollTop > 0), "Inline long code is vertically reachable");
      await page.getByRole("button", { name: "Wrap java lines", exact: true }).click();
      assert.ok(await pre.evaluate(e => e.scrollWidth <= e.clientWidth + 1), "Wrapped code fits the viewer");
      await page.getByRole("button", { name: "Copy java", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__copiedCode), `${code}\n`);
      await page.getByRole("button", { name: "Wrap java lines", exact: true }).click();
      const readerScroll = await page.locator(".workspace-reader-scroll").evaluate(e => e.scrollTop);
      await page.getByRole("button", { name: "Expand java", exact: true }).click();
      await page.getByRole("dialog", { name: "java full-screen viewer" }).waitFor();
      const fullCode = page.locator(".code-stage.fullscreen > pre");
      await fullCode.evaluate(e => { e.scrollTop = 100; e.scrollLeft = 100; });
      assert.ok(await fullCode.evaluate(e => e.scrollTop > 0 && e.scrollLeft > 0), "Expanded long code must scroll on both axes");
      assert.ok(await page.locator(".code-stage-dialog").evaluate(e => e.getBoundingClientRect().bottom <= innerHeight + 1), "Expanded dialog grows beyond the viewport");
      await page.screenshot({ path: `${output}/${origin}-${specialty}-code.png` });
      await page.getByRole("button", { name: "Close full-screen java", exact: true }).click();
      await settle();
      assert.ok(Math.abs(await page.locator(".workspace-reader-scroll").evaluate(e => e.scrollTop) - readerScroll) <= 1, "Code expansion must preserve reader scroll");
      assert.ok(await page.locator(".reader-workspace").isVisible(), "Closing code must keep the reader open");
      await page.getByRole("button", { name: "Expand java", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "java full-screen viewer", exact: true }).waitFor({ state: "detached" });
      assert.ok(await page.locator(".reader-workspace").isVisible(), "Escape from code preserves its reader");
      for (const [width, height] of [[440, 956], [440, 650], [375, 760], [440, 800]]) { await page.setViewportSize({ width, height }); await settle(); await geometry(width, height); }
      await page.locator(".workspace-reader-scroll").evaluate(e => { e.scrollTop = e.scrollHeight; });
      await page.screenshot({ path: `${output}/${origin}-${specialty}-end.png` });
      await page.getByRole("button", { name: "Close solution profile", exact: true }).click();
      if (origin !== "banks") {
        await page.waitForSelector(".case-document:not(.solution-profile-document)");
        await settle(); await geometry(440, 800);
        const conversation = page.locator(".conversation-group");
        await conversation.locator("summary").click();
        await conversation.scrollIntoViewIfNeeded();
        const layers = await page.locator(".workspace-reader-scroll, .conversation-group, .conversation-group > div, .case-transcript, .transcript-thread, .transcript-turn article").evaluateAll(es => es.map(e => {
          const s = getComputedStyle(e); return { name: e.className, padding: parseFloat(s.paddingLeft) + parseFloat(s.paddingRight), border: parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth) };
        }));
        assert.ok(layers[0].padding <= 36 && layers[0].border === 0, "Only one outer prose gutter is allowed");
        assert.ok(layers.slice(1).every(s => s.padding === 0 && s.border === 0), JSON.stringify(layers));
        const labels = await conversation.locator("summary > span, summary > small").evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
        assert.ok(labels[0].bottom <= labels[1].top, "Conversation title and metadata must not overlap");
        await page.screenshot({ path: `${output}/${origin}-${specialty}-attempt.png` });
      }
      console.log(`PASS ${origin}/${specialty}: prose, code, copy, wrap, expand, resize, nested close`);
    }
  }
  // Crossing the phone breakpoint must release and reacquire the background lock.
  await visit("view=banks&specialty=leetcode&problem=mobile-leetcode");
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 }); await settle();
    assert.notEqual(await page.evaluate(() => document.body.style.position), "fixed");
    assert.equal(await page.locator(".topbar").isVisible(), true);
    assert.deepEqual(await page.locator(".reader-group,.markdown-body").evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className)), []);
    await page.screenshot({ path: `${output}/desktop-${width}.png` });
  }
  await page.setViewportSize({ width: 440, height: 800 }); await settle(); await geometry(440, 800);
  await page.getByRole("button", { name: "Close solution profile", exact: true }).click();
  assert.notEqual(await page.evaluate(() => document.body.style.position), "fixed");
  assert.equal(await page.locator(".phone-navigation").isVisible(), true);
  console.log("PASS desktop and phone breakpoint transitions; background lock released");
  await page.goto(`${base}/?view=past`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Begin today/ }).click();
  await settle();
  const open = page.locator(".log-entry-open").last();
  await page.evaluate(() => window.scrollTo(0, 150));
  await open.scrollIntoViewIfNeeded();
  const originScroll = await page.evaluate(() => window.scrollY);
  assert.ok(originScroll > 0, "Exercise an already-scrolled originating page");
  await open.click(); await settle();
  await page.locator(".reader-close").click();
  await page.waitForFunction(() => !document.querySelector(".reader-workspace"));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - originScroll) <= 1, "Closing restores the originating page scroll");
  console.log("PASS closing from a scrolled Past page preserves its position");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

// Run against an isolated, seeded local preview; never a production account.
// UI_BASE_URL=http://127.0.0.1:3053 node scripts/check-mobile-ui.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";

const origin = process.env.UI_BASE_URL ?? "http://127.0.0.1:3053";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use an isolated local preview");
const engine = process.env.UI_BROWSER === "chromium" ? chromium : webkit;
const output = process.env.UI_SCREENSHOTS ?? ".cache/mobile-ui";
await mkdir(output, { recursive: true });
const browser = await engine.launch({ headless: true, ...(process.env.UI_BROWSER_PATH ? { executablePath: process.env.UI_BROWSER_PATH } : {}) });
const routes = [
  ...["today", "loops", "reviews", "past", "banks", "journey", "career-materials"].map(view => ["interview", view, `view=${view}`]),
  ...["today", "courses", "history", "analytics"].map(view => ["learn", view, `view=learn&learn=${view}`]),
  ...["journal", "capabilities", "decisions", "incidents", "case-studies", "statistics"].map(view => ["engineering", view, `workspace=engineering&engineering=${view}`]),
];

try {
  const page = await browser.newPage({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const visit = async query => {
    await page.goto(`${origin}/?${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Begin today/ }).click();
    await page.waitForFunction(() => document.body.style.overflow !== "hidden");
    assert.deepEqual(errors, [], "Page must hydrate without script errors");
  };
  const box = locator => locator.evaluate(e => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, client: e.clientWidth, scroll: e.scrollWidth };
  });
  for (const [workspace, view, query] of routes) {
    await visit(query);
    assert.ok(await page.locator(`.active-workspace-${workspace}`).count(), query);
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 440, `${query}: document overflow`);
    const nav = page.locator(".mobile-interview-nav:visible");
    const sizes = await nav.locator("button").evaluateAll(elements => elements.map(e => ({
      height: e.getBoundingClientRect().height, width: e.clientWidth, scroll: e.scrollWidth, font: parseFloat(getComputedStyle(e).fontSize),
    })));
    assert.ok(sizes.every(s => s.height >= 44 && s.font >= 12 && s.scroll <= s.width + 1), `${query}: navigation target or label clipped`);
    if (view === "reviews") assert.ok((await box(page.locator(".review-queue-sheet"))).height >= 580);
    if (view === "banks") {
      assert.ok((await box(page.locator(".problem-bank-list"))).height >= 580);
      const labels = await page.locator(".hero-bank-totals > button > span").evaluateAll(es => es.map(e => ({ width: e.clientWidth, scroll: e.scrollWidth })));
      assert.ok(labels.every(e => e.scroll <= e.width + 1), "Bank total labels clipped");
    }
    await page.screenshot({ path: join(output, `${workspace}-${view}.png`) });
    await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); const e = document.querySelector(".page-content"); e.scrollTop = e.scrollHeight; });
    await page.screenshot({ path: join(output, `${workspace}-${view}-end.png`) });
    console.log(`PASS ${workspace}/${view}`);
  }

  await visit("view=today");
  await page.getByRole("button", { name: "Add activities", exact: true }).click();
  const add = page.locator(".activity-selection-footer .primary-action");
  await add.scrollIntoViewIfNeeded();
  assert.ok(await add.evaluate(e => {
    const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === e || e.contains(hit);
  }), "Activity footer is obscured by navigation");
  assert.ok(await page.locator(".activity-picker-search input").evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 16), "iOS input zoom threshold");
  await page.screenshot({ path: join(output, "activity-dialog.png") });

  await visit("view=banks");
  await page.getByLabel(/^Problem filters/).click();
  const filter = await box(page.locator("details[open] > .control-popover"));
  const dock = await box(page.locator(".mobile-interview-nav:visible"));
  assert.ok(filter.x >= 0 && filter.right <= 440 && filter.y >= 92 && filter.bottom < dock.y, "Filter menu must fit above the dock");
  await page.screenshot({ path: join(output, "bank-filters.png") });

  await visit("view=banks");
  await page.getByRole("button", { name: /Explore all/ }).click();
  await visit("view=banks");
  assert.ok(await page.getByRole("button", { name: /Collapse/ }).isVisible(), "Expanded bank topics survive refresh without hydration failure");

  await visit("workspace=engineering&engineering=journal");
  await page.evaluate(() => window.scrollTo(0, 360));
  for (const panel of ["index", "evidence"]) {
    const start = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: `Open ${panel}`, exact: true }).click();
    const close = page.getByRole("button", { name: `Close ${panel}`, exact: true });
    assert.ok(await close.isVisible());
    await close.click();
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - start) <= 1, `${panel}: changed outer scroll`);
  }
  console.log("PASS dialogs, filters, drawer scroll stability");

  // Synthetic read responses exercise a populated reader without writing user data.
  await page.route(/\/api\/(state|timer-state)(\?|$)/, async route => {
    const response = await route.fetch();
    const state = await response.json();
    const id = "mobile-fixture-attempt";
    const start = Date.parse("2026-09-01T17:00:00Z");
    state.historyActivities = [{ schemaVersion: 1, source: "extra", timingSource: "website", status: "completed", reviewDates: [], id,
      title: "Explain a bounded cache and its eviction policy", type: "system_design", date: "2026-09-01", timerGroupId: "fixture",
      allocatedSeconds: 3600, notes: "Synthetic UI fixture.", startedAt: new Date(start).toISOString(), endedAt: new Date(start + 2400000).toISOString() }];
    state.timers ??= {};
    state.outcomes ??= {};
    state.timers[id] = { accumulatedSeconds: 2400, startedAt: start, runningSince: null, completed: true, completedAt: start + 2400000, revision: 1 };
    state.outcomes[id] = "solved_after_reviewing_approach";
    await route.fulfill({ json: state });
  });
  await visit("view=past");
  await page.getByRole("button", { name: "Read Explain a bounded cache and its eviction policy", exact: true }).click();
  const reader = await box(page.locator(".past-master-detail"));
  const readerDock = await box(page.locator(".mobile-interview-nav:visible"));
  assert.ok(reader.y >= 92 && reader.bottom <= readerDock.y, "Reader must fit between phone header and navigation");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 440, "Reader document overflow");
  await page.screenshot({ path: join(output, "past-reader.png") });
  assert.deepEqual(errors, [], "No hydration or runtime errors after populated reader navigation");
  console.log("PASS populated reader bounds");
} finally {
  await browser.close();
}

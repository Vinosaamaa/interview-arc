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
  for (const [workspace, view, query] of process.env.UI_INTERACTIONS_ONLY ? [] : routes) {
    await visit(query);
    assert.ok(await page.locator(`.active-workspace-${workspace}`).count(), query);
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 440, `${query}: document overflow`);
    const nav = page.locator(".phone-navigation:visible");
    const sizes = await nav.locator("button").evaluateAll(elements => elements.map(e => ({
      top: e.getBoundingClientRect().top, height: e.getBoundingClientRect().height, width: e.clientWidth, scroll: e.scrollWidth, font: parseFloat(getComputedStyle(e).fontSize),
    })));
    assert.equal(sizes.length, workspace === "learn" ? 4 : 5, `${query}: primary destinations and More`);
    assert.ok(sizes.every(s => Math.abs(s.top - sizes[0].top) <= 1), `${query}: navigation wrapped`);
    const chrome = await page.locator(".topbar-context, .topbar-workspace-switch, .topbar-actions").evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, middle: (r.top + r.bottom) / 2 }; }));
    assert.ok(chrome.every(r => Math.abs(r.middle - chrome[0].middle) <= 1), "Top bar must stay on one row");
    assert.ok(chrome[0].right <= chrome[1].left && chrome[1].right <= chrome[2].left, "Top-bar controls overlap");
    assert.ok(sizes.every(s => s.height >= 44 && s.font >= 12 && s.scroll <= s.width + 1), `${query}: navigation target or label clipped`);
    if (view === "reviews") assert.ok(await page.locator(".review-queue-sheet").evaluate(e => getComputedStyle(e).minHeight === "0px" && getComputedStyle(e).overflowY === "visible"), "Reviews uses document scrolling");
    if (view === "banks") {
      assert.ok(await page.locator(".problem-bank-list").evaluate(e => getComputedStyle(e).contain === "none" && getComputedStyle(e).overflowY === "visible"), "Banks uses document scrolling");
      const labels = await page.locator(".hero-bank-totals > button > span:visible").evaluateAll(es => es.map(e => ({ width: e.clientWidth, scroll: e.scrollWidth })));
      assert.ok(labels.every(e => e.scroll <= e.width + 1), "Bank total labels clipped");
    }
    await page.screenshot({ path: join(output, `${workspace}-${view}.png`) });
    await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); const e = document.querySelector(".page-content"); e.scrollTop = e.scrollHeight; });
    await page.screenshot({ path: join(output, `${workspace}-${view}-end.png`) });
    console.log(`PASS ${workspace}/${view}`);
  }

  await visit("view=today");
  await page.locator(".topbar-tools > summary").click();
  await page.getByRole("menuitemradio", { name: "Atmosphere: Rain", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Atmosphere: Off", exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("interview-arc-atmosphere-v1")), "off");
  await visit("view=today");
  await page.locator(".topbar-tools > summary").click();
  assert.equal(await page.getByRole("menuitemradio", { name: "Atmosphere: Off", exact: true }).getAttribute("aria-checked"), "true");
  await page.locator(".topbar-tools > summary").click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = page.locator(".phone-sheet[open]");
  assert.ok(await more.getByRole("button", { name: "Journey", exact: false }).isVisible());
  await page.mouse.click(4, 100);
  assert.equal(await more.count(), 0, "Outside click dismisses More");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await more.count(), 0, "Escape dismisses More");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "More", "Focus returns to opener");
  await page.getByRole("button", { name: "Add activities", exact: true }).click();
  const add = page.locator(".activity-selection-footer .primary-action");
  await add.scrollIntoViewIfNeeded();
  assert.ok(await add.evaluate(e => {
    const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === e || e.contains(hit);
  }), "Activity footer is obscured by navigation");
  assert.ok(await page.locator(".activity-picker-search input").evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 16), "iOS input zoom threshold");
  const questionList = await box(page.locator(".activity-composer-dialog .bank-results"));
  const selection = await box(page.locator(".activity-selection-footer"));
  assert.ok(selection.y >= questionList.bottom - 1, "Selection footer overlaps questions");
  assert.ok(await page.locator(".activity-composer-dialog .bank-results").evaluate(e => e.scrollHeight > e.clientHeight), "Question list has no bounded scrolling area");
  await page.screenshot({ path: join(output, "activity-dialog.png") });

  await visit("view=banks");
  await page.getByLabel(/^Problem filters/).click();
  const filter = await box(page.locator("details[open] > .control-popover"));
  const dock = await box(page.locator(".phone-navigation:visible"));
  assert.ok(filter.x >= 0 && filter.right <= 440 && filter.y >= 56 && filter.bottom < dock.y, "Filter menu must fit above the dock");
  await page.screenshot({ path: join(output, "bank-filters.png") });

  await visit("view=banks");
  await page.getByRole("button", { name: /Explore all/ }).click();
  await visit("view=banks");
  assert.ok(await page.getByRole("button", { name: /Collapse/ }).isVisible(), "Expanded bank topics survive refresh without hydration failure");

  await visit("workspace=engineering&engineering=journal");
  await page.locator(".engineering-contents-nav").evaluate(e => window.scrollTo(0, window.scrollY + e.getBoundingClientRect().top - 90));
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
    state.reviews = { ...state.reviews, [id]: { reviewKey: "mobile-fixture-review", activityId: id, questionId: null, specialty: "system_design", status: "due", reason: "approach_review", dueDate: "2026-09-02", intervalDays: 1, stage: 0, reviewCount: 0 } };
    await route.fulfill({ json: state });
  });
  await visit("view=past");
  await page.getByRole("button", { name: "Read Explain a bounded cache and its eviction policy", exact: true }).click();
  const reader = await box(page.locator(".past-master-detail"));
  assert.equal(await page.locator(".phone-navigation").isVisible(), false);
  assert.ok(Math.abs(reader.y) <= 1 && Math.abs(reader.height - 956) <= 1, "Phone reader must fill the visible viewport");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 440, "Reader document overflow");
  await page.screenshot({ path: join(output, "past-reader.png") });
  assert.deepEqual(errors, [], "No hydration or runtime errors after populated reader navigation");
  console.log("PASS populated reader bounds");

  // The same native sheet must not inherit the Reviews timeline's rotated h2.
  await visit("view=reviews");
  await page.locator(".phone-row-more").first().click();
  assert.ok(await page.locator(".phone-sheet[open] > .phone-sheet-content > header h2").evaluate(e => {
    const s = getComputedStyle(e);
    return s.writingMode === "horizontal-tb" && s.transform === "none" && e.getBoundingClientRect().height < 200;
  }), "Review action title is rotated or oversized");
  assert.equal(await page.locator(".phone-sheet[open]").evaluate(e => e.parentElement === document.body), true);
  await page.locator(".phone-sheet-close").click();
  assert.equal(await page.locator(".review-selection-folio").isVisible(), false, "Phone selection lives in its full-screen cart");

  await visit("view=today");
  await page.getByRole("button", { name: /Add another session/ }).click();
  await page.getByLabel("Coding count", { exact: true }).fill("1");
  await page.getByLabel("System design count", { exact: true }).fill("1");
  await page.getByLabel("Behavioral count", { exact: true }).fill("0");
  await page.getByRole("button", { name: /^Add session \d+$/ }).click();
  for (const width of [375, 440, 1000, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const session = page.locator(".compact-session").first();
    await session.scrollIntoViewIfNeeded();
    assert.ok(await session.evaluate(e => {
      const aligned = parent => {
        const boxes = [...parent.children].filter(child => getComputedStyle(child).display !== "none").map(child => child.getBoundingClientRect());
        return boxes.every(r => Math.abs(r.y + r.height / 2 - boxes[0].y - boxes[0].height / 2) < 2);
      };
      return aligned(e.querySelector(".session-sheet-header")) && aligned(e.querySelector(".today-activity-row"));
    }), `Today header or activity controls wrapped at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Today document overflow");
    await session.locator(".today-activity-more").first().click();
    assert.ok(await page.locator(".phone-sheet[open]").isVisible(), `Activity details inaccessible at ${width}`);
    assert.equal(await session.locator(".today-activity-controls").first().locator(":scope > *").count(), 0, "Open sheet duplicates row controls");
    await page.locator(".phone-sheet-close").click();
    assert.ok(await session.locator(".today-activity-controls").first().locator(":scope > *").count() > 0, "Closing sheet must restore row controls");
    await page.screenshot({ path: join(output, `today-session-${width}.png`) });
  }
  console.log("PASS atmosphere persistence, review sheets, picker and Today rows");
} finally {
  await browser.close();
}

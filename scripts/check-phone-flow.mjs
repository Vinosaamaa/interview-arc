// Synthetic responses on an isolated preview only. No production or practice writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright-core";

const base = process.env.UI_BASE_URL ?? "http://127.0.0.1:3057";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const engineName = process.env.UI_BROWSER ?? "webkit";
const browser = await (engineName === "chromium" ? chromium : webkit).launch({ headless: true });
const output = `.cache/phone-flow-${engineName}`;
await mkdir(output, { recursive: true });
const start = Date.parse("2026-09-01T17:00:00Z");
const history = Array.from({ length: 16 }, (_, i) => ({ schemaVersion: 1, source: "extra", timingSource: "website", status: "completed", reviewDates: [], id: `phone-review-${i}`, title: `Synthetic ${String(i).padStart(2, "0")} design review with a complete title that remains readable in the cart`, type: "system_design", questionId: `phone-question-${i}`, date: "2026-09-01", timerGroupId: "fixture", allocatedSeconds: 3600, notes: "Synthetic UI fixture.", startedAt: new Date(start).toISOString(), endedAt: new Date(start + 2400000).toISOString() }));
const source = { kind: "pasted_jd", displayLocator: "Synthetic role description", capturedAt: 1, fingerprint: "a".repeat(64) };
const target = { targetId: "phone-target", label: "Known saved role", state: "active", company: "Synthetic Company", roleTitle: "Engineer", responsibilities: ["Build reliable services"], requiredQualifications: [], preferredQualifications: [], competencySignals: ["Design reliable services", "Explain tradeoffs", "Work across teams"], seniorityIndicators: [], domainVocabulary: [], verifiedCompanySignals: [], unresolvedAmbiguities: [], ownerNotes: [], source, revision: 1, createdAt: 1 };
const facts = { loopCount: 1, activeLoopCount: 1, stageCount: 1, completedStageCount: 0, scheduledStageCount: 0, interviewDateCount: 0, outcomes: { offer: 0, rejected: 0, withdrawn: 0, closed: 0, unresolved: 1 } };
const loop = { loop: { loopId: "phone-loop", company: "Synthetic Company", roleTitle: "Engineer", state: "active", status: "active", outcome: null, revision: 1, stages: [{ stageId: "technical", label: "Technical", order: 0, status: "planned" }] }, roleBrief: target, activityBindings: [{ activityId: history[0].id, stageId: "technical", roleBriefRevision: 1, specialty: "system_design", questionId: history[0].questionId, title: history[0].title, completed: true }], activityHistory: [{ activityId: history[0].id, stageId: "technical", roleBriefRevision: 1, specialty: "system_design", questionId: history[0].questionId, result: "solved", completedAt: start }], interviewMaterials: [] };

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /hydration|hydrating|didn't match/i.test(message.text())) errors.push(message.text()); });
  const mutations = [];
  let bindingMode = "valid";
  let scopeRevision = 0;
  let savedReviews = [];
  let mutationMode = "reject";
  let latestState;
  await page.route(/\/api\/(state|timer-state)(\?|$)/, async route => {
    const state = await (await route.fetch()).json();
    state.historyActivities = history;
    state.historySessions = [];
    state.sessions = [];
    state.workbench = { ...state.workbench, id: "phone-workbench", status: "open", revision: 1 };
    const date = new URL(route.request().url()).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    state.extraActivities = [{ schemaVersion: 1, id: "phone-behavior", source: "extra", timingSource: "website", type: "behavioral", title: `Synthetic behavioral prompt ${scopeRevision}`, date, timerGroupId: "fixture-today", workbenchId: "phone-workbench", allocatedSeconds: 1800, notes: "", reviewDates: [] }, ...savedReviews.map((id) => ({ ...history.find(item => item.id === id), id: `today-${id}`, status: "planned", date, workbenchId: "phone-workbench", startedAt: undefined, endedAt: undefined }))];
    state.timers = {}; state.outcomes = {}; state.reviews = {};
    for (const item of history) {
      state.timers[item.id] = { accumulatedSeconds: 2400, startedAt: start, runningSince: null, completed: true, completedAt: start + 2400000, revision: 1 };
      state.outcomes[item.id] = "solved_after_reviewing_approach";
      state.reviews[item.id] = { reviewKey: `review-${item.id}`, activityId: item.id, questionId: item.questionId, specialty: item.type, status: "due", reason: "approach_review", dueDate: "2026-09-02", intervalDays: 1, stage: 0, reviewCount: 0 };
    }
    latestState = state;
    await route.fulfill({ json: state });
  });
  await page.route(/\/api\/mutations$/, async route => {
    const payload = route.request().postDataJSON();
    if (payload.mutation.type !== "review-add-today") return route.fulfill({ json: latestState });
    mutations.push(payload.mutation);
    if (mutationMode === "offline") await route.fulfill({ status: 503, json: { error: "Synthetic temporary outage." } });
    else if (mutationMode === "reject") await route.fulfill({ status: 409, json: { error: "Synthetic workbench conflict.", code: "workbench_conflict" } });
    else {
      const added = payload.mutation.reviewKeys.map(key => key.replace(/^review-/, ""));
      savedReviews = [...new Set([...savedReviews, ...added])];
      await route.fulfill({ json: { ...latestState, extraActivities: [...latestState.extraActivities.filter(item => !item.id.startsWith("today-")), ...savedReviews.map(id => ({ ...history.find(item => item.id === id), id: `today-${id}`, date: latestState.extraActivities[0].date, workbenchId: "phone-workbench", status: "planned", startedAt: undefined, endedAt: undefined }))] } });
    }
  });
  await page.route(/\/api\/behavioral-target-bindings\?/, async route => {
    if (bindingMode === "html") return route.fulfill({ contentType: "text/html", body: "<html>Sign in</html>" });
    if (bindingMode === "invalid") return route.fulfill({ json: { bindings: "wrong shape" } });
    if (bindingMode === "malformed") return route.fulfill({ contentType: "application/json", body: "{broken" });
    if (bindingMode === "api-error") return route.fulfill({ status: 401, json: { error: "Please sign in again." } });
    await route.fulfill({ json: { bindings: [{ scope: { type: "activity", id: "phone-behavior" }, directBinding: null, resolution: { source: "activity", binding: null, target } }] } });
  });
  await page.route(/\/api\/loops\?/, route => route.fulfill({ json: { loops: [loop], truncated: false, facts, migrationInbox: [] } }));
  const visit = async query => {
    await page.goto(`${base}/?${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Begin today/ }).click();
    await page.locator(".arrival-ritual").waitFor({ state: "detached" });
    assert.deepEqual(errors, [], "Hard phone navigation must hydrate cleanly");
  };
  const shot = name => page.screenshot({ path: `${output}/${name}.png` });
  await visit("view=reviews");
  assert.ok(await page.getByRole("searchbox", { name: "Search review queue" }).evaluate(e => e.getBoundingClientRect().width >= 200), "Reviews search must remain usable");
  assert.equal(await page.locator(".review-selection-folio").isVisible(), false);
  const picks = page.locator(".phone-row-actions .review-add");
  await picks.nth(0).click(); await picks.nth(1).click();
  assert.equal(mutations.length, 0, "Plus only stages selection");
  await page.locator(".phone-review-cart").click();
  const cart = page.getByRole("dialog", { name: "Selected reviews", exact: true });
  assert.equal(await cart.locator("li").count(), 2);
  await page.waitForFunction(() => { const r = document.querySelector(".phone-sheet-fullscreen[open]")?.getBoundingClientRect(); return r && Math.abs(r.width - innerWidth) <= 1 && Math.abs(r.height - innerHeight) <= 1; });
  assert.ok(await cart.locator("li strong").evaluateAll(es => es.every(e => e.scrollWidth <= e.clientWidth && getComputedStyle(e).whiteSpace !== "nowrap")), "Cart keeps complete titles");
  await shot("reviews-cart");
  await cart.getByRole("button", { name: "Add selected to Today", exact: true }).click();
  await cart.getByRole("alert").waitFor();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].type, "review-add-today");
  assert.equal(mutations[0].reviewKeys.length, 2);
  assert.equal(await cart.locator("li").count(), 2, "Failed queued mutation preserves selection");
  assert.equal(await cart.getByRole("button", { name: "Add selected to Today", exact: true }).isEnabled(), true);
  await shot("reviews-retry");
  mutationMode = "save";
  await cart.getByRole("button", { name: "Add selected to Today", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".phone-review-selection li").length === 0);
  assert.equal(mutations.length, 2, "Retry is explicit and owner confirmation clears saved selections");
  await cart.getByRole("button", { name: "Close", exact: true }).click();
  mutationMode = "offline";
  await page.locator(".phone-row-actions .review-add:not(:disabled)").first().click();
  await page.locator(".phone-review-cart").click();
  await cart.getByRole("button", { name: "Add selected to Today", exact: true }).click();
  await cart.getByRole("status").waitFor();
  const queuedId = mutations.at(-1).mutationId;
  await visit("view=reviews");
  await page.locator(".phone-review-cart").click();
  assert.equal(await cart.locator("li").count(), 1, "Reload retains staged selection");
  await cart.getByRole("status").waitFor();
  assert.equal(await cart.getByRole("button", { name: "Add selected to Today", exact: true }).isEnabled(), false, "Reloaded queued write cannot be added twice");
  mutationMode = "save";
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => document.querySelectorAll(".phone-review-selection li").length === 0);
  assert.equal(mutations.at(-1).mutationId, queuedId, "Reconnect replays the same durable queue identity");
  await cart.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.ok(await page.locator(".review-queue-sheet").evaluate(e => getComputedStyle(e).overflowY === "visible" && e.clientHeight === e.scrollHeight));
  await shot("reviews-end");

  await visit("view=today");
  await page.getByText("Saved role context", { exact: true }).click();
  assert.ok(await page.getByText("Known saved role", { exact: true }).isVisible());
  for (const mode of ["html", "malformed", "invalid", "api-error"]) {
    bindingMode = mode; scopeRevision++;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("button", { name: "Retry role context", exact: true }).waitFor();
    assert.ok(await page.getByText("Known saved role", { exact: true }).isVisible(), "A failed read retains the previous known binding");
    const text = await page.locator(".today-saved-role-context [role=alert]").innerText();
    assert.doesNotMatch(text, /expected pattern|invalid_type|expected.*array|SyntaxError/);
    assert.match(text, mode === "api-error" ? /Please sign in again/ : /Reload this page to reconnect/);
    bindingMode = "valid";
    await page.getByRole("button", { name: "Retry role context", exact: true }).click();
    await page.locator(".today-saved-role-context [role=alert]").waitFor({ state: "detached" });
  }
  await page.locator(".today-activity-more").first().click();
  const result = page.locator(".phone-sheet[open] .result-flag");
  assert.ok(await result.evaluate(e => e.clientWidth >= 200 && e.scrollWidth <= e.clientWidth), "Result label uses the sheet width");
  await shot("today-result");
  await page.locator(".phone-sheet-close").click();
  for (const safe of [0, 34]) {
    await page.locator(".app-shell").evaluate((e, value) => e.style.setProperty("--phone-safe-bottom", `${value}px`), safe);
    const box = await page.locator(".phone-navigation:visible").evaluate(e => ({ height: e.getBoundingClientRect().height, bottom: e.getBoundingClientRect().bottom, padding: parseFloat(getComputedStyle(e).paddingBottom), viewport: window.visualViewport.height }));
    assert.equal(box.height, 53 + Math.max(4, safe));
    assert.equal(box.padding, Math.max(4, safe));
    assert.equal(box.bottom, box.viewport);
  }
  await page.setViewportSize({ width: 390, height: 650 });
  assert.equal(await page.locator(".phone-navigation:visible").evaluate(e => e.getBoundingClientRect().bottom), 650);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("interview-arc-atmosphere-v1", "rain"));
  await visit("view=banks");
  assert.equal(await page.locator(".atmosphere-field.quiet").isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("interview-arc-atmosphere-v1")), "rain");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelectorAll(".problem-bank-entry").length > 36);
  const bankTotal = Number((await page.locator(".bank-result-count").innerText()).match(/\d+/)[0]);
  while (await page.locator(".problem-bank-entry").count() < bankTotal) {
    const count = await page.locator(".problem-bank-entry").count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(previous => { window.scrollTo(0, document.documentElement.scrollHeight); return document.querySelectorAll(".problem-bank-entry").length > previous; }, count);
  }
  assert.equal(await page.locator(".problem-bank-entry").count(), bankTotal, "Phone document scrolling reaches every matching bank question");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await shot("banks-end");
  await page.locator(".phone-navigation").getByRole("button", { name: "Today", exact: true }).click();
  await page.locator(".phone-navigation").getByRole("button", { name: "Banks", exact: true }).click();
  await page.waitForFunction(total => document.querySelectorAll(".problem-bank-entry").length === total, bankTotal);
  // Offscreen content-visibility estimates can change absolute document height;
  // the saved visible question and its viewport offset are the user contract.
  await page.waitForFunction(() => {
    const memory = JSON.parse(sessionStorage.getItem("interview-arc-list-position-v2")).banks.main;
    const anchor = [...document.querySelectorAll(".problem-bank-entry")].find(e => e.dataset.listItemId === memory.anchorId);
    return anchor && Math.abs(anchor.getBoundingClientRect().top - memory.anchorOffset) <= 2;
  });

  await visit("workspace=engineering&engineering=journal");
  assert.ok(await page.locator(".engineering-record-panel").evaluate(e => getComputedStyle(e).overflowY === "visible" && e.clientHeight === e.scrollHeight));
  assert.ok(await page.locator(".engineering-hero-metrics").evaluate(e => [...e.querySelectorAll("dt,dd")].every(child => child.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom)), "Metric labels must fit");
  await shot("engineering");
  for (const panel of ["index", "evidence"]) {
    await page.getByRole("button", { name: `Open ${panel}`, exact: true }).click();
    const sheet = page.locator(".phone-sheet-fullscreen[open]");
    await page.waitForFunction(() => Math.abs(document.querySelector(".phone-sheet-fullscreen[open]").getBoundingClientRect().height - innerHeight) <= 1);
    await shot(`engineering-${panel}`);
    if (panel === "index") await sheet.locator(".phone-sheet-body").evaluate(e => { e.scrollTop = 500; });
    await page.getByRole("button", { name: `Close ${panel}`, exact: true }).click();
    if (panel === "index") {
      await page.getByRole("button", { name: "Open index", exact: true }).click();
      assert.equal(await page.locator(".phone-sheet-body").evaluate(e => e.scrollTop), 500, "Index reopens at its remembered position");
      await page.getByRole("button", { name: "Close index", exact: true }).click();
    }
  }
  await visit("view=loops&loop=phone-loop");
  for (const title of ["Role context", "Linked preparation"]) {
    const toggle = page.getByRole("button", { name: title, exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.ok(await toggle.evaluate(e => [...e.closest("section").children].filter(child => child.tagName !== "HEADER").every(child => child.getBoundingClientRect().height === 0)), "Collapsed sections hide every body child");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await toggle.click();
  }
  await shot("loops-collapsed");
  await visit("view=journey");
  assert.ok(await page.locator(".stat-ledger").evaluate(e => e.getBoundingClientRect().height < 300));
  await shot("journey");
  await page.setViewportSize({ width: 1000, height: 844 });
  await visit("view=banks");
  assert.ok(await page.locator(".problem-bank-list").evaluate(e => e.getBoundingClientRect().height >= 580 && getComputedStyle(e).overflowY === "auto"), "Desktop retains bounded results");
  assert.deepEqual(errors, []);
  console.log(`PASS ${engineName}: staged cart, durable failure/retry, response recovery, result width, safe-area geometry, document scrolling, full-screen navigation, Loop collapse and desktop boundary`);
} finally {
  await browser.close();
}

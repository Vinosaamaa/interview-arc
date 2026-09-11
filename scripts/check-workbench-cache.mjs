// Isolated browser regression: never seed or mutate a production account.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright-core";

const base = process.env.UI_BASE_URL ?? "http://127.0.0.1:3067";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const engine = process.env.UI_BROWSER ?? "webkit";
const browser = await (engine === "chromium" ? chromium : webkit).launch({ headless: true });
await mkdir(".cache/workbench-cache", { recursive: true });
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const activity = { schemaVersion: 2, id: "stale-phone-activity", questionId: "stale-question", type: "behavioral", title: "Synthetic old workbench question", source: "extra", timingSource: "website", status: "planned", date, workbenchId: "archived", timerGroupId: "stale-phone-activity", allocatedSeconds: 3600 };
const session = { id: "stale-phone-session", label: "Synthetic old session", date, source: "extra", workbenchId: "archived", activityIds: [activity.id], allocatedSeconds: 3600 };
try {
  for (const queued of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    await context.addInitScript(({ date, activity, session, queued }) => {
      if (sessionStorage.getItem("seeded")) return;
      localStorage.setItem(`interview-arc-draft-v3-${date}`, JSON.stringify({ workbench: { id: "archived" }, extraActivities: [activity], sessions: [session], focusedActivityId: activity.id, focusedSessionId: session.id, focusedAt: 1 }));
      localStorage.setItem(`interview-arc-queue-v2-${date}`, JSON.stringify(queued ? [{ type: "extra-upsert", activity }, { type: "session-upsert", session }] : []));
      sessionStorage.setItem("seeded", "yes");
    }, { date, activity, session, queued });
    const page = await context.newPage();
    const posts = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let latest;
    await page.route(/\/api\/(state|timer-state)(\?|$)/, async route => {
      const state = await (await route.fetch()).json();
      latest = { ...state, workbench: { ...state.workbench, id: "current", status: "open" }, extraActivities: [], sessions: [], focusBlocks: [], historyActivities: [activity], historySessions: [session], historyFocusBlocks: [], focusedActivityId: null, focusedSessionId: null, focusedAt: null };
      await route.fulfill({ json: latest });
    });
    await page.route(/\/api\/mutations$/, async route => {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ json: latest });
    });
    for (let visit = 0; visit < 2; visit++) {
      await page.goto(`${base}/?view=today`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Begin today/ }).click();
      await page.getByText("No session planned yet.", { exact: true }).waitFor();
      assert.equal(await page.getByText(activity.title, { exact: true }).count(), 0);
      assert.equal(await page.getByText(session.label, { exact: true }).count(), 0);
      assert.equal(await page.getByText("The activity is not an owner-scoped behavioral activity.", { exact: true }).count(), 0);
      assert.deepEqual(posts, [], "A display-cache reload must not emit creation writes");
      const saved = await page.evaluate(date => JSON.parse(localStorage.getItem(`interview-arc-draft-v3-${date}`)), date);
      assert.equal(saved.workbench.id, "current");
      assert.deepEqual(saved.extraActivities, []);
      assert.equal(saved.focusedActivityId, null);
      assert.deepEqual(errors, []);
    }
    await page.screenshot({ path: `.cache/workbench-cache/${engine}-${queued ? "queued" : "cache"}.png`, fullPage: true });
    await context.close();
  }
  console.log(`PASS ${engine}: stale cache, stale queue, repeated reload, cleared focus, zero inferred writes`);
} finally {
  await browser.close();
}

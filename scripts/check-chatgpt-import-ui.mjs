// Synthetic end-to-end check. Only an isolated local database may be used.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { webkit } from "playwright-core";
const origin = process.env.UI_BASE_URL ?? "http://127.0.0.1:3045";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = process.env.UI_SCREENSHOTS ?? ".cache/chatgpt-import-ui";
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?view=past`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Begin today/ }).click();
  const panel = page.getByRole("region", { name: "ChatGPT practice", exact: true });
  await panel.locator(".chatgpt-import-editor > summary").click();
  const bank = await page.evaluate(async () => (await fetch("/api/chatgpt-practice?bank=1")).json());
  assert.equal(bank.visibility, "owner_private");
  assert.ok(bank.questions.length > 0);
  const packet = JSON.parse(await readFile(new URL("../docs/contracts/chatgpt-backfill-synthetic.example.json", import.meta.url), "utf8"));
  packet.packetId = "synthetic-ui-import-v1";
  packet.sessions[0].sessionKey = "synthetic-ui-session-v1";
  for (const a of packet.sessions[0].attempts) {
    const q = bank.questions.find((q) => q.specialty === a.question.specialty && q.availability === "active");
    a.question.questionId = q.questionId;
    a.question.title = q.title;
    a.attemptKey += "-ui-v1";
    a.practiceDate = "2026-09-01";
    a.dateBasis = "user_reported";
  }
  await panel.getByLabel("Session export", { exact: true }).fill(JSON.stringify(packet));
  await panel.getByRole("button", { name: "Preview import", exact: true }).click();
  await panel.getByRole("button", { name: "Save reviewed import" }).waitFor();
  assert.equal(await panel.getByText("Ready for Past", { exact: true }).count(), 2);
  await panel.screenshot({ path: `${output}/desktop-preview.png` });
  await panel.getByRole("button", { name: "Save reviewed import" }).click();
  await panel.getByRole("status").filter({ hasText: /2 completed, 0 pending/ }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Begin today/ }).click();
  await panel.locator(".chatgpt-import-history button").filter({ hasText: packet.sessions[0].attempts[1].question.title }).click();
  const dialog = page.locator(".chatgpt-import-reader");
  await dialog.waitFor({ state: "visible" });
  assert.match(await dialog.innerText(), /Time unknown/);
  await dialog.getByText("Conversation · supplied transcript", { exact: true }).click();
  assert.match(await dialog.innerText(), /def |class |Synthetic/);
  await dialog.screenshot({ path: `${output}/desktop-reader.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile-reader.png` });
  assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "Reader must contain mobile overflow");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await panel.locator(".chatgpt-import-editor > summary").click();
  await panel.screenshot({ path: `${output}/mobile-import.png` });
  assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "Import must contain mobile overflow");
  const after = await page.evaluate(async () => (await fetch("/api/chatgpt-practice?bank=1")).json());
  assert.equal(after.questions.find((q) => q.specialty === "leetcode" && q.questionId === packet.sessions[0].attempts[1].question.questionId).progress.lastOutcome, "solved");
  assert.deepEqual(errors, []);
  console.log("PASS: bank download, preview, save, reload, source reader, bank progress, mobile containment and Escape.");
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` });
  console.error((await page?.locator("body").innerText())?.slice(0, 1800));
  throw error;
} finally { await browser.close(); }

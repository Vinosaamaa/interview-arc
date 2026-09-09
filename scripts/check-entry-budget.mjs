// Run against a built local Worker, not vinext dev or a production account.
import assert from "node:assert/strict";
import { webkit } from "playwright-core";

const base = process.env.UI_BASE_URL ?? "http://127.0.0.1:3054";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
for (const path of ["/", "/?workspace=engineering&engineering=journal"]) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(Buffer.byteLength(html) < 50_000, "Login entry must not serialize the complete content/journal or render the dashboard");
  assert.match(html, /Opening your workspace/);
  console.log(`PASS ${path}: ${Buffer.byteLength(html)} bytes`);
}
const content = await fetch(`${base}/api/content-index`);
assert.equal(content.status, 200);
assert.match(content.headers.get("cache-control"), /private, no-store/);
assert.ok(Array.isArray((await content.json()).questionBanks.leetcode));

const browser = await webkit.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 956 } });
  let attempts = 0;
  await page.route("**/api/content-index", route => ++attempts === 1
    ? route.fulfill({ status: 503, json: { error: "Synthetic temporary failure" } })
    : route.continue());
  await page.goto(`${base}/?workspace=engineering&engineering=journal`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("button", { name: /Begin today/ }).click();
  await page.locator(".active-workspace-engineering").waitFor();
  assert.equal(attempts, 2, "A failed bootstrap must retry explicitly, without a request loop");
  console.log("PASS private content, recoverable entry failure, and Engineering deep link");
} finally { await browser.close(); }

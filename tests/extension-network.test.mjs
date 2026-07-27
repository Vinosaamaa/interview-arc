import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function networkModule(overrides = {}) {
  const source = await readFile(new URL("../extension/companion-network.js", import.meta.url), "utf8");
  const context = {
    AbortController,
    clearTimeout,
    console,
    fetch,
    setTimeout,
    ...overrides,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.InterviewArcCompanionNetwork;
}

test("the Companion service-worker broker returns authenticated API responses", async () => {
  let request;
  const network = await networkModule({
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ currentActivity: { id: "activity-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await network.performRequest(
    network.requestMessage("/companion/state?date=2026-07-26", {}, "ia_test"),
  );

  assert.equal(result.kind, "response");
  assert.equal(result.status, 200);
  assert.equal(result.body.currentActivity.id, "activity-1");
  assert.equal(request.url, "https://limitless-mcp.vinosama.workers.dev/companion/state?date=2026-07-26");
  assert.equal(request.init.headers.authorization, "Bearer ia_test");
  assert.equal(request.init.cache, "no-store");
});

test("the Companion broker classifies a browser-level fetch rejection without discarding credentials", async () => {
  const network = await networkModule({
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const result = await network.performRequest(
    network.requestMessage("/companion/state?date=2026-07-26", {}, "ia_test"),
  );

  assert.equal(result.kind, "transport-error");
  assert.equal(result.code, "network");
  assert.equal(result.message, "Chrome could not reach the Interview Arc bridge.");
  assert.equal("credential" in result, false);
});

test("the Companion broker rejects unknown endpoints before making a request", async () => {
  let calls = 0;
  const network = await networkModule({
    fetch: async () => {
      calls += 1;
      return new Response("{}");
    },
  });

  const result = await network.performRequest(
    network.requestMessage("/audio/upload", {}, "ia_test"),
  );

  assert.equal(result.kind, "transport-error");
  assert.equal(result.code, "invalid-request");
  assert.equal(calls, 0);
});

test("the side panel routes Companion requests through the service worker", async () => {
  const sidePanel = await readFile(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
  const serviceWorker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

  assert.match(sidePanel, /chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(sidePanel, /fetch\(`\\$\\{API_BASE\\}/);
  assert.match(serviceWorker, /InterviewArcCompanionNetwork\.performRequest/);
  assert.equal(manifest.version, "1.1.7");
  assert.equal(manifest.icons["128"], "icons/brand-128.png");
  assert.equal(manifest.action.default_icon["16"], "icons/brand-16.png");
  const sidePanelMarkup = await readFile(
    new URL("../extension/sidepanel.html", import.meta.url),
    "utf8",
  );
  assert.ok(sidePanelMarkup.includes('src="icons/brand.svg"'));
  assert.ok(!sidePanelMarkup.includes(">IA</span>"));
});

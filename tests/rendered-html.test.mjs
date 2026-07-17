import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Interview Arc dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Interview Arc/);
  assert.match(html, /Six hours\. Eight activities/);
  assert.match(html, /Six-hour session countdown/);
  assert.match(html, /Six problems inside one session clock/);
  assert.match(html, /Stopwatch/);
  assert.match(html, /Design a notification system/);
  assert.match(html, /Disagree and commit/);
  assert.match(html, /Solved after reviewing approach/);
  assert.match(html, /Finish and lock stopwatch/);
  assert.match(html, /Add another session/);
  assert.match(html, /Add one activity/);
  assert.match(html, /Story bank/);
  assert.doesNotMatch(html, />＋ Add<\/button>/);
  assert.doesNotMatch(html, /＋ Add activity/);
  assert.doesNotMatch(html, /Test console|Submit attempt|solution\.py/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

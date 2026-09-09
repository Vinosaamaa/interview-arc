import assert from "node:assert/strict";
import test from "node:test";
import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";

test("four isolated Workers can enter and the next waits for a released slot", { timeout: 120_000 }, async () => {
  const releases = [];
  let fifth;
  try {
    for (let i = 0; i < 4; i++) releases.push(await acquireMcpIntegrationLock());
    let entered = false;
    fifth = acquireMcpIntegrationLock().then((release) => { entered = true; return release; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(entered, false);
    await releases.pop()();
    releases.push(await fifth);
    assert.equal(entered, true);
  } finally {
    await Promise.all(releases.map((release) => release()));
  }
});

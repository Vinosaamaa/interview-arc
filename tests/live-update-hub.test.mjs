import assert from "node:assert/strict";
import test from "node:test";

import { OwnerLiveUpdateHub } from "../worker/live-update-hub.ts";

function hubFixture() {
  const stored = new Map();
  const delivered = [];
  const puts = [];
  const state = {
    storage: {
      get: async (key) => stored.get(key),
      put: async (key, value) => {
        puts.push([key, value]);
        stored.set(key, value);
      },
    },
    getWebSockets: () => [{ send: (value) => delivered.push(JSON.parse(value)) }],
  };
  return { hub: new OwnerLiveUpdateHub(state), stored, delivered, puts };
}

test("Live invalidations preserve the committed owner revision and disclose no content", async () => {
  const { hub, delivered } = hubFixture();
  const response = await hub.fetch(new Request("https://live-update.internal/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "live",
      revision: 1_900_000_000_000,
      transcript: "must not leave D1",
      objectKey: "must/not/leave/r2",
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(delivered[0]).sort(), ["occurredAt", "revision", "scope", "type"]);
  assert.equal(delivered[0].type, "practice_changed");
  assert.equal(delivered[0].scope, "live");
  assert.equal(delivered[0].revision, 1_900_000_000_000);
  assert.equal(Number.isSafeInteger(delivered[0].occurredAt), true);
});

test("Live invalidations remain monotonic without rewriting an unchanged high-water mark", async () => {
  const { hub, stored, delivered, puts } = hubFixture();
  stored.set("revision", 500);
  stored.set("liveRevision", 500);

  await hub.fetch(new Request("https://live-update.internal/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "live", revision: 499 }),
  }));

  assert.equal(delivered[0].revision, 500);
  assert.equal(stored.get("revision"), 500);
  assert.equal(stored.get("liveRevision"), 500);
  assert.deepEqual(puts, []);
});

test("Live invalidations use the D1-backed Live revision independently of legacy event traffic", async () => {
  const { hub, stored, delivered } = hubFixture();
  stored.set("revision", 800);

  await hub.fetch(new Request("https://live-update.internal/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "live", revision: 12 }),
  }));

  assert.equal(delivered[0].revision, 12);
  assert.equal(stored.get("liveRevision"), 12);
  assert.equal(stored.get("revision"), 800);
});

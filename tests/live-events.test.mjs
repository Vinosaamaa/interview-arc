import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boundedFallbackDelay,
  liveUpdateReconciliationMode,
  parseLiveUpdate,
} from "../app/live-event-policy.ts";

test("live update envelopes require a positive monotonic revision", () => {
  assert.deepEqual(parseLiveUpdate(JSON.stringify({
    type: "practice_changed",
    revision: 12,
    scope: "timer",
    occurredAt: 1_721_000_000_000,
  })), {
    type: "practice_changed",
    revision: 12,
    scope: "timer",
    occurredAt: 1_721_000_000_000,
  });
  assert.equal(parseLiveUpdate('{"type":"practice_changed","revision":0}'), null);
  assert.equal(parseLiveUpdate("not json"), null);
});

test("fallback refresh backs off and remains bounded", () => {
  assert.equal(boundedFallbackDelay(0, 0), 15_000);
  assert.equal(boundedFallbackDelay(1, 0), 30_000);
  assert.equal(boundedFallbackDelay(9, 0), 120_000);
  assert.equal(boundedFallbackDelay(9, 1), 138_000);
});

test("structural practice events require full-state reconciliation", () => {
  assert.equal(liveUpdateReconciliationMode({
    type: "practice_changed",
    revision: 13,
    scope: "timer",
    occurredAt: 1_721_000_000_000,
  }), "timers");
  for (const scope of ["practice", "publication", "voice_capture", "voice_intent"]) {
    assert.equal(liveUpdateReconciliationMode({
      type: "practice_changed",
      revision: 14,
      scope,
      occurredAt: 1_721_000_000_001,
    }), "practice");
  }
});

test("all live clients use server push instead of recurring one-second HTTP reads", async () => {
  const [liveSync, homeClient, companion, workerConfig, mcpConfig] = await Promise.all([
    readFile(new URL("../app/live-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../extension/sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.mcp.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(liveSync, /subscribeToLiveUpdates/);
  assert.match(liveSync, /reconcilePracticeState/);
  assert.match(liveSync, /onFallback:\s*reconcilePracticeState/);
  assert.doesNotMatch(liveSync, /setInterval\(\(\) => void reconcileTimers\(\), 1000\)/);
  assert.doesNotMatch(homeClient, /void reconcileTimers\(\);\s*\}, 1000\)/);
  assert.match(companion, /new WebSocket/);
  assert.doesNotMatch(companion, /refreshInterval[\s\S]*1000/);
  assert.match(workerConfig, /OwnerLiveUpdateHub/);
  assert.match(mcpConfig, /LIVE_UPDATES/);
});

test("Voice reliability keeps decisions race-safe, status-first, and conflicts terminal", async () => {
  const [schema, durable, bridge, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8"),
    readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_outgoing_shinko_yamashiro.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /deferred_voice_capture_decisions/);
  assert.match(schema, /voice_capture_intents_owner_status_updated_idx/);
  assert.match(migration, /CREATE TABLE `deferred_voice_capture_decisions`/);
  assert.match(durable, /readVoiceCaptureIntentsPage/);
  assert.match(durable, /Close the narrow race/);
  assert.match(bridge, /status === "unresolved"/);
  assert.match(bridge, /voice_capture_identity_conflict/);
  assert.match(bridge, /retryable:\s*false/);
});

test("push publication is best effort after the authoritative mutation commits", async () => {
  const hub = await readFile(new URL("../worker/live-update-hub.ts", import.meta.url), "utf8");
  assert.match(hub, /D1\/REST mutations are authoritative/);
  assert.match(hub, /try \{[\s\S]*ownerStub[\s\S]*\} catch \{/);
  assert.match(hub, /return response\.ok/);
  assert.match(hub, /if \(!namespace\) return false/);
});

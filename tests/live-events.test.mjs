import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boundedFallbackDelay,
  liveUpdateReconciliationMode,
  parseLiveUpdate,
  subscribeToLiveUpdates,
} from "../app/live-event-policy.ts";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  readyState = 0;
  listeners = new Map();

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    if (type === "open") this.readyState = FakeWebSocket.OPEN;
    if (type === "close") this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        listener(event);
      } catch {
        // Browser EventTarget reports listener errors without rethrowing them to
        // the WebSocket producer. Keep this fake aligned with that behavior.
      }
    }
  }

  close() {
    this.readyState = 3;
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
  assert.doesNotMatch(liveSync, /setInterval\(\(\) => void reconcileTimers\(\), 1000\)/);
  assert.doesNotMatch(homeClient, /void reconcileTimers\(\);\s*\}, 1000\)/);
  assert.match(companion, /new WebSocket/);
  assert.doesNotMatch(companion, /refreshInterval[\s\S]*1000/);
  assert.match(workerConfig, /OwnerLiveUpdateHub/);
  assert.match(mcpConfig, /LIVE_UPDATES/);
});

test("live clients filter duplicate revisions independently within each scope", async () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  const updates = [];
  const unsubscribe = subscribeToLiveUpdates({
    url: "wss://example.test/live",
    onUpdate: (update) => updates.push(`${update.scope}:${update.revision}`),
    onFallback: () => {},
  });
  try {
    const socket = FakeWebSocket.instances[0];
    const emit = async (scope, revision) => {
      socket.emit("message", { data: JSON.stringify({
        type: "practice_changed",
        revision,
        scope,
        occurredAt: 1_721_000_000_000 + revision,
      }) });
      await flushMicrotasks();
    };
    await emit("live", 20);
    await emit("timer", 20);
    await emit("live", 20);
    await emit("timer", 19);
    assert.deepEqual(updates, ["live:20", "timer:20"]);
  } finally {
    unsubscribe();
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a failed reconciliation keeps the same scoped revision retryable", async () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  let attempts = 0;
  const unsubscribe = subscribeToLiveUpdates({
    url: "wss://example.test/live",
    onUpdate: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient projection read failure");
    },
    onFallback: () => {},
  });
  try {
    const socket = FakeWebSocket.instances[0];
    const event = { data: JSON.stringify({
      type: "practice_changed",
      revision: 41,
      scope: "live",
      occurredAt: 1_721_000_000_000,
    }) };
    socket.emit("message", event);
    await flushMicrotasks();
    socket.emit("message", event);
    await flushMicrotasks();
    assert.equal(attempts, 2);
  } finally {
    unsubscribe();
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a failed reconciliation schedules bounded authoritative recovery while connected", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 1;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  let fallbackReads = 0;
  const unsubscribe = subscribeToLiveUpdates({
    url: "wss://example.test/live",
    onUpdate: () => {
      throw new Error("transient projection read failure");
    },
    onFallback: () => {
      fallbackReads += 1;
    },
  });
  try {
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    socket.emit("message", { data: JSON.stringify({
      type: "practice_changed",
      revision: 42,
      scope: "live",
      occurredAt: 1_721_000_000_001,
    }) });
    await flushMicrotasks();
    assert.equal(timers.size, 1);
    const [{ callback, delay }] = timers.values();
    assert.ok(delay >= 15_000 && delay <= 17_250);
    await callback();
    assert.equal(fallbackReads, 1);
  } finally {
    unsubscribe();
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("reopening after a disconnect performs an authoritative recovery read", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 1;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  let fallbackReads = 0;
  const unsubscribe = subscribeToLiveUpdates({
    url: "wss://example.test/live",
    onUpdate: () => {},
    onFallback: () => {
      fallbackReads += 1;
    },
  });
  try {
    FakeWebSocket.instances[0].emit("open");
    assert.equal(fallbackReads, 0);
    FakeWebSocket.instances[0].emit("close");
    const reconnect = [...timers.values()].find(({ delay }) => delay === 1_000);
    const disconnectedFallback = [...timers.values()].find(({ delay }) => delay >= 15_000);
    assert.ok(reconnect);
    assert.ok(disconnectedFallback);
    await disconnectedFallback.callback();
    assert.equal(fallbackReads, 1);
    reconnect.callback();
    FakeWebSocket.instances[1].emit("open");
    await flushMicrotasks();
    assert.equal(fallbackReads, 2);
  } finally {
    unsubscribe();
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
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
  assert.match(hub, /signalDelivered/);
  assert.match(hub, /executionContext\.waitUntil/);
  assert.match(hub, /if \(!namespace\) return false/);
});

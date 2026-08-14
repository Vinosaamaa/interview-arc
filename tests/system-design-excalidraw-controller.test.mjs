import assert from "node:assert/strict";
import test from "node:test";

import {
  checkpointSystemDesignDrawing,
  finalizeSystemDesignDrawingAssets,
  PREFLIGHT_LEASE_MS,
  runSystemDesignDrawingPreflight,
} from "../scripts/system-design-excalidraw-controller.mjs";

const nowMs = Date.parse("2026-08-13T20:00:00.000Z");
const activityId = "system-design-activity-1";

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    readLease: async () => null,
    probeServer: async () => ({ healthy: false }),
    startServer: async () => calls.push("start-server"),
    ensureSingleCanvasPage: async () => {
      calls.push("single-page");
      return { browserId: "browser-1", pageId: "page-1", pageCount: 1 };
    },
    probeExclusiveCanvas: async () => {
      calls.push("exclusive-canvas");
      return { healthy: true, browserClients: 1 };
    },
    verifyRoundTrip: async () => calls.push("round-trip"),
    readCurrentCheckpoint: async () => ({ revision: 3, sha256: "a".repeat(64), scene: "{}" }),
    restoreCheckpoint: async () => calls.push("restore-checkpoint"),
    writeLease: async (lease) => calls.push(["write-lease", lease]),
    ...overrides,
  };
}

test("new System Design preflight starts one server, verifies one tab, round-trips, and restores exact state", async () => {
  const deps = dependencies();
  const result = await runSystemDesignDrawingPreflight({ activityId, nowMs }, deps);
  assert.deepEqual(deps.calls.slice(0, 5), [
    "start-server",
    "single-page",
    "exclusive-canvas",
    "round-trip",
    "restore-checkpoint",
  ]);
  assert.equal(result.reused, false);
  assert.equal(result.serverUrl, "http://127.0.0.1:3032");
  assert.equal(result.activityId, activityId);
  assert.equal(result.checkpointRevision, 3);
  assert.equal(result.expiresAt, nowMs + PREFLIGHT_LEASE_MS);
  assert.equal(deps.calls.at(-1)[0], "write-lease");
});

test("checkpoint exports the current scene and advances only the exact current revision", async () => {
  const saved = [];
  const result = await checkpointSystemDesignDrawing({
    activityId,
    altText: "Owner-authored queue architecture",
  }, {
    readCurrentCheckpoint: async () => ({ checkpoint: { revision: 3 } }),
    exportScene: async () => '{"type":"excalidraw","elements":[]}',
    saveCheckpoint: async (input) => {
      saved.push(input);
      return { checkpoint: { revision: 4, sha256: "b".repeat(64) }, duplicate: false };
    },
  });
  assert.equal(saved[0].expectedRevision, 3);
  assert.equal(saved[0].scene, '{"type":"excalidraw","elements":[]}');
  assert.match(saved[0].operationId, /^checkpoint-[a-f0-9]{64}$/);
  assert.equal(result.checkpoint.revision, 4);
});

test("Finish checkpoints first, exports SVG, and stages one exact owner-authored asset set", async () => {
  const staged = [];
  const result = await finalizeSystemDesignDrawingAssets({
    activityId,
    questionId: "design-a-durable-queue",
    altText: "Owner-authored durable queue design",
  }, {
    checkpoint: async () => ({
      checkpoint: { revision: 4, sha256: "b".repeat(64) },
      scene: '{"type":"excalidraw","elements":[]}',
    }),
    exportSvg: async () => "<svg><text>queue</text></svg>",
    stageAssetSet: async (input) => {
      staged.push(input);
      return { status: "staged", manifestSha256: "c".repeat(64), assets: [{ role: "attempt_original_svg" }] };
    },
  });
  assert.equal(staged[0].checkpointRevision, 4);
  assert.equal(staged[0].assets[0].role, "attempt_original_excalidraw");
  assert.equal(staged[0].assets[1].role, "attempt_original_svg");
  assert.match(staged[0].operationId, /^asset-set-[a-f0-9]{64}$/);
  assert.equal(result.manifestSha256, "c".repeat(64));
});

test("a healthy exact-activity lease is reused without another tab or scene round trip", async () => {
  const deps = dependencies({
    readLease: async () => ({
      activityId,
      serverUrl: "http://127.0.0.1:3032",
      browserId: "browser-1",
      pageId: "page-1",
      checkpointRevision: 3,
      checkpointSha256: "a".repeat(64),
      expiresAt: nowMs + 1,
    }),
    probeServer: async () => ({ healthy: true, browserClients: 1 }),
  });
  const result = await runSystemDesignDrawingPreflight({ activityId, nowMs }, deps);
  assert.equal(result.reused, true);
  assert.deepEqual(deps.calls, []);
});

test("an expired or other-activity lease cannot bypass deterministic preflight", async () => {
  for (const lease of [
    { activityId, expiresAt: nowMs - 1 },
    { activityId: "other-activity", expiresAt: nowMs + PREFLIGHT_LEASE_MS },
  ]) {
    const deps = dependencies({ readLease: async () => lease });
    const result = await runSystemDesignDrawingPreflight({ activityId, nowMs }, deps);
    assert.equal(result.reused, false);
    assert.deepEqual(deps.calls.slice(0, 4), ["start-server", "single-page", "exclusive-canvas", "round-trip"]);
  }
});

test("preflight rejects any server, tab, or activity identity outside the fixed contract", async () => {
  await assert.rejects(
    () => runSystemDesignDrawingPreflight({ activityId: "../foreign", nowMs }, dependencies()),
    /stable activity ID/,
  );
  await assert.rejects(
    () => runSystemDesignDrawingPreflight({ activityId, nowMs }, dependencies({
      ensureSingleCanvasPage: async () => ({ browserId: "browser-1", pageId: "page-1", pageCount: 2 }),
    })),
    /exactly one Playwright Chromium tab/,
  );
  await assert.rejects(
    () => runSystemDesignDrawingPreflight({ activityId, nowMs }, dependencies({
      probeExclusiveCanvas: async () => ({ healthy: true, browserClients: 2 }),
    })),
    /only connected browser client/,
  );
});

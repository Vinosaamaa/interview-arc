import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  mergePendingInteractionModes,
  selectableInteractionModes,
} from "../app/interaction-mode-view.ts";
import {
  interactionModeActivityIdBatches,
  interactionModeReadBatchSize,
} from "../db/interaction-mode-policy.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Today receives authoritative registry-driven interaction-mode state", async () => {
  const [store, liveState, liveTypes, liveSync] = await Promise.all([
    read("../db/interaction-mode-store.ts"),
    read("../db/live-state.ts"),
    read("../app/live-types.ts"),
    read("../app/live-sync.ts"),
  ]);

  assert.match(store, /readPracticeInteractionModeSummaries/);
  assert.match(liveState, /interactionModeRegistry/);
  assert.match(liveState, /interactionModes/);
  assert.match(liveTypes, /InteractionModeSummary/);
  assert.match(liveSync, /interactionModeRegistry: state\.interactionModeRegistry/);
  assert.match(liveSync, /interactionModes: state\.interactionModes/);
});

test("Today mode changes use the shared atomic command and truthful recovery UI", async () => {
  const [commands, route, client, styles] = await Promise.all([
    read("../db/practice-state-commands.ts"),
    read("../app/api/mutations/route.ts"),
    read("../app/home-client.tsx"),
    read("../app/interview-arc-v2.css"),
  ]);

  assert.match(commands, /type: "interaction-mode-set"/);
  assert.match(commands, /setPracticeInteractionModeAtomic/);
  assert.match(commands, /interactionModeMutationFingerprint/);
  assert.match(route, /error\.code/);
  assert.match(client, /interaction-mode-selector/);
  assert.match(client, /interaction-mode-badge/);
  assert.match(client, /pending:/);
  assert.match(client, /Try again/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("the Today selector automatically includes newly registered compatible modes", () => {
  const registry = {
    schemaVersion: 1,
    registryVersion: "test-v1",
    compatibility: {
      unknownHistoricalMode: "preserve_as_unknown",
      deprecatedNewSelection: "reject",
      aliases: "normalize_without_persisting_alias",
    },
    modes: [
      { id: "interviewer", supportedSpecialties: ["leetcode"], selectableWhen: ["fresh_attempt"], deprecated: false },
      { id: "mentor", supportedSpecialties: ["leetcode"], selectableWhen: ["fresh_attempt"], deprecated: false },
      { id: "grill", supportedSpecialties: ["leetcode"], selectableWhen: ["fresh_attempt"], deprecated: false },
      { id: "pairing", supportedSpecialties: ["leetcode"], selectableWhen: ["fresh_attempt"], deprecated: false },
      { id: "retired", supportedSpecialties: ["leetcode"], selectableWhen: ["fresh_attempt"], deprecated: true },
    ].map((mode) => ({
      label: mode.id,
      description: `${mode.id} description`,
      helpPolicy: `${mode.id} help`,
      aliases: [],
      defaultFor: [],
      ...mode,
    })),
  };

  assert.deepEqual(
    selectableInteractionModes(registry, "leetcode", "fresh_attempt").map((mode) => mode.id),
    ["interviewer", "mentor", "grill", "pairing"],
  );
});

test("published activity identity uses a targeted journal lookup", async () => {
  const [identity, content] = await Promise.all([
    read("../db/practice-activity-identity.ts"),
    read("../db/content.ts"),
  ]);
  assert.match(identity, /readPublishedJournalActivity/);
  assert.doesNotMatch(identity, /loadContentIndex/);
  assert.match(content, /FROM json_each\(\$\{contentJournals\.payload\}, '\$\.activities'\)/);
});

test("hydration preserves only queued optimistic interaction-mode summaries", () => {
  const server = {
    stable: { state: "needs_selection", current: null },
    pending: { state: "needs_selection", current: null },
  };
  const local = {
    stale: { state: "recorded", current: { lastMutationId: "old" } },
    pending: { state: "recorded", current: { lastMutationId: "pending:mutation-1" } },
  };
  const merged = mergePendingInteractionModes(server, local, [
    { type: "interaction-mode-set", activityId: "pending", mutationId: "mutation-1" },
  ]);
  assert.equal(merged.pending, local.pending);
  assert.equal(merged.stale, undefined);
  assert.equal(merged.stable, server.stable);
});

test("interaction-mode state reads partition large workbenches into bounded batches", () => {
  const ids = Array.from({ length: interactionModeReadBatchSize * 2 + 1 }, (_, index) => `activity-${index}`);
  const batches = [...interactionModeActivityIdBatches([...ids, ids[0]])];
  assert.deepEqual(batches.map((batch) => batch.length), [interactionModeReadBatchSize, interactionModeReadBatchSize, 1]);
  assert.equal(batches.flat().length, ids.length);
});

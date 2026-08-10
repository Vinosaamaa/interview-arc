import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("the Today selector is generated from the registry instead of three hardcoded modes", async () => {
  const client = await read("../app/home-client.tsx");
  assert.match(client, /interactionModeRegistry\.modes/);
  assert.doesNotMatch(client, /\[\s*["']interviewer["']\s*,\s*["']mentor["']\s*,\s*["']grill["']\s*\]/);
});

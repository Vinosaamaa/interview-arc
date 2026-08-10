import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  InteractionModeError,
  classifyInteractionModeAtomicFailure,
  interactionModeRegistry,
  resolveInteractionMode,
} from "../db/interaction-mode-policy.ts";

test("the versioned registry normalizes aliases without persisting them as modes", () => {
  assert.equal(interactionModeRegistry.schemaVersion, 1);
  assert.deepEqual(
    interactionModeRegistry.modes.map((mode) => mode.id),
    ["interviewer", "mentor", "grill"],
  );
  assert.equal(
    resolveInteractionMode("coach", "leetcode", "active_attempt").mode.id,
    "mentor",
  );
  assert.equal(
    resolveInteractionMode("grill me", "behavioral", "fresh_attempt").mode.id,
    "grill",
  );
  assert.equal(
    interactionModeRegistry.modes.some((mode) => mode.id === "coach"),
    false,
  );
});

test("runtime validation is data-driven and rejects deprecated, unknown, and unsupported selections", () => {
  const registry = {
    ...interactionModeRegistry,
    registryVersion: "test-fourth-mode",
    modes: [
      ...interactionModeRegistry.modes,
      {
        id: "observer",
        label: "Observer",
        description: "A test-only registry extension.",
        helpPolicy: "Observe without intervening.",
        supportedSpecialties: ["system_design"],
        selectableWhen: ["active_attempt"],
        aliases: ["watch"],
        defaultFor: [],
        deprecated: false,
      },
      {
        id: "legacy",
        label: "Legacy",
        description: "Readable history only.",
        helpPolicy: "Not selectable.",
        supportedSpecialties: ["leetcode"],
        selectableWhen: ["active_attempt"],
        aliases: [],
        defaultFor: [],
        deprecated: true,
      },
    ],
  };

  assert.equal(
    resolveInteractionMode("watch", "system_design", "active_attempt", registry).mode.id,
    "observer",
  );
  assert.throws(
    () => resolveInteractionMode("observer", "leetcode", "active_attempt", registry),
    (error) => error instanceof InteractionModeError && error.code === "interaction_mode_unsupported_specialty",
  );
  assert.throws(
    () => resolveInteractionMode("observer", "system_design", "review", registry),
    (error) => error instanceof InteractionModeError && error.code === "interaction_mode_unavailable_for_phase",
  );
  assert.throws(
    () => resolveInteractionMode("legacy", "leetcode", "active_attempt", registry),
    (error) => error instanceof InteractionModeError && error.code === "interaction_mode_deprecated",
  );
  assert.throws(
    () => resolveInteractionMode("invented", "leetcode", "active_attempt", registry),
    (error) => error instanceof InteractionModeError && error.code === "interaction_mode_unknown",
  );
});

test("the MCP and D1 tracer keep registry IDs extensible and writes transaction-guarded", async () => {
  const [worker, config, contract, migration, schema, store] = await Promise.all([
    readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/practice-interaction-modes.md", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0027_little_cyclops.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/interaction-mode-store.ts", import.meta.url), "utf8"),
  ]);
  for (const tool of ["get_practice_interaction_mode", "set_practice_interaction_mode"]) {
    assert.match(worker, new RegExp(`server\\.registerTool\\(\\s*["']${tool}["']`));
    assert.match(config, new RegExp(`["']${tool}["']`));
    assert.equal(contract.includes(`\`${tool}\``), true);
  }
  assert.match(migration, /practice_interaction_mode_states/);
  assert.match(migration, /practice_interaction_mode_transitions/);
  assert.match(migration, /practice_interaction_mode_mutations/);
  assert.match(schema, /interactionModeId: text\("interaction_mode_id"\)\.notNull\(\)/);
  assert.match(store, /await db\.batch\(\[/);
  assert.match(store, /d1TransactionalInvariantGuard/);
  assert.match(store, /practiceTranscriptTurns/);
  assert.match(store, /practiceTranscriptTurns\.speaker, "user"/);
  assert.match(store, /transitionReadLimit = 100/);
  assert.match(store, /transitionHistoryTruncated/);
  assert.doesNotMatch(store, /cause:\s*String\(error\)/);
  assert.doesNotMatch(worker, /plan_today_practice[\s\S]{0,500}interactionModeId/);
});

test("atomic failure retryability never treats an invariant conflict as transient", () => {
  assert.deepEqual(
    classifyInteractionModeAtomicFailure(new Error("malformed JSON")),
    {
      code: "interaction_mode_atomic_conflict",
      message: "The interaction-mode preconditions conflicted, so no state was changed.",
      retryable: false,
    },
  );
  assert.equal(
    classifyInteractionModeAtomicFailure(new Error("temporary D1 transport failure")).retryable,
    true,
  );
});

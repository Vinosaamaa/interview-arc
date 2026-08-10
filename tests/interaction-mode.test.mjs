import assert from "node:assert/strict";
import test from "node:test";

import {
  InteractionModeError,
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

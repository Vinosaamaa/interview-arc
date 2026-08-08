import test from "node:test";
import assert from "node:assert/strict";
import { MASTER_PANE_PREFERENCE_KEY, readMasterPanePreference, writeMasterPanePreference } from "../app/ui-preferences.ts";

test("master-pane preferences are versioned and independent", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  writeMasterPanePreference(storage, "library", false);
  writeMasterPanePreference(storage, "banks", true);
  assert.equal(readMasterPanePreference(storage, "library"), false);
  assert.equal(readMasterPanePreference(storage, "banks"), true);
  assert.notEqual(MASTER_PANE_PREFERENCE_KEY.library, MASTER_PANE_PREFERENCE_KEY.banks);
});

test("missing, corrupt, or denied storage falls back safely", () => {
  assert.equal(readMasterPanePreference({ getItem: () => "corrupt" }, "library"), null);
  assert.equal(readMasterPanePreference({ getItem: () => { throw new Error("denied"); } }, "banks"), null);
  assert.doesNotThrow(() => writeMasterPanePreference({ setItem: () => { throw new Error("denied"); } }, "library", true));
});

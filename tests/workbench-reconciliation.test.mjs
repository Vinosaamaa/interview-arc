import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_DRAFT } from "../app/live-types.ts";
import { reconcileWorkbenchCache } from "../app/workbench-reconciliation.ts";

const draft = (id, additions = {}) => ({ ...EMPTY_DRAFT, workbench: { id }, ...additions });
const activity = { id: "old-question", workbenchId: "old" };
const session = { id: "old-session", workbenchId: "old" };
const block = { id: "old-focus", workbenchId: "old" };

test("an empty authoritative workbench clears old cached rows, focus and deleted evidence", () => {
  const server = draft("new");
  const local = draft("old", {
    extraActivities: [activity], sessions: [session], focusBlocks: [block],
    focusedActivityId: activity.id, focusedSessionId: session.id, focusedAt: 10,
    structuredNotes: { [activity.id]: [{ body: "old" }] },
  });
  assert.deepEqual(reconcileWorkbenchCache(server, local, []), { merged: server, mutations: [] });
});

test("missing rows in the same workbench are not recreated from the display cache", () => {
  const server = draft("old");
  assert.deepEqual(reconcileWorkbenchCache(server, draft("old", { extraActivities: [activity] }), []).merged, server);
});

test("stale queued upserts cannot cross a workbench reset, including legacy payloads", () => {
  const queue = [{ type: "extra-upsert", activity }, { type: "session-upsert", session }, { type: "focus-block-upsert", block },
    { type: "extra-upsert", activity: { id: "offline-old" } }];
  assert.deepEqual(reconcileWorkbenchCache(draft("new"), draft("old"), queue).mutations, []);
});

test("archived IDs stay archived even when a stale client has adopted the new workbench ID", () => {
  const server = draft("new", { historyActivities: [activity], historySessions: [session], historyFocusBlocks: [block] });
  assert.deepEqual(reconcileWorkbenchCache(server, draft("new"), [{ type: "extra-upsert", activity: { id: activity.id } }]).mutations, []);
});

test("current-workbench offline edits survive and do not duplicate their queued operation", () => {
  const added = { id: "new-question", workbenchId: "new" };
  const queue = [{ type: "extra-upsert", activity: added }, { type: "activity-note", activityId: "past", note: "correction" }];
  const result = reconcileWorkbenchCache(draft("new"), draft("new"), queue);
  assert.deepEqual(result.merged.extraActivities, [added]);
  assert.deepEqual(result.mutations, queue);
});

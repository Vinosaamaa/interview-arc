import assert from "node:assert/strict";
import test from "node:test";

import {
  rememberEveryReaderGroup,
  rememberReaderGroup,
} from "../app/reader-memory.ts";

test("rememberReaderGroup is idempotent for native details toggle replays", () => {
  const initial = {
    "activity:attempt-1": {
      groups: { conversation: true },
      scrollTop: 240,
    },
  };

  const replay = rememberReaderGroup(
    initial,
    "activity:attempt-1",
    "conversation",
    true,
  );

  assert.equal(replay, initial);
  assert.equal(replay["activity:attempt-1"], initial["activity:attempt-1"]);
});

test("rememberReaderGroup changes one section without losing reader position", () => {
  const initial = {
    "activity:attempt-1": {
      groups: { conversation: true },
      anchorId: "case-facts",
      anchorOffset: 18,
      scrollTop: 240,
    },
  };

  const next = rememberReaderGroup(
    initial,
    "activity:attempt-1",
    "conversation",
    false,
  );

  assert.notEqual(next, initial);
  assert.deepEqual(next["activity:attempt-1"], {
    groups: { conversation: false },
    anchorId: "case-facts",
    anchorOffset: 18,
    scrollTop: 240,
  });
});

test("rememberEveryReaderGroup persists one atomic expand-all update", () => {
  const initial = {
    "activity:attempt-1": {
      groups: { conversation: false, review: true },
      scrollTop: 240,
    },
  };

  const expanded = rememberEveryReaderGroup(
    initial,
    "activity:attempt-1",
    ["conversation", "review", "references"],
    true,
  );

  assert.deepEqual(expanded["activity:attempt-1"], {
    groups: { conversation: true, review: true, references: true },
    scrollTop: 240,
  });
  assert.equal(
    rememberEveryReaderGroup(
      expanded,
      "activity:attempt-1",
      ["conversation", "review", "references"],
      true,
    ),
    expanded,
  );
});

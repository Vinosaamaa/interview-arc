import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_READER_MEMORY_ENTRIES,
  normalizeReaderMemoryState,
  rememberEveryReaderGroup,
  rememberReaderGroup,
  rememberReaderPosition,
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

test("malformed persisted memory is discarded and toggle writes recover safely", () => {
  const malformed = {
    "activity:attempt-1": {
      groups: null,
      scrollTop: 240,
    },
  };

  assert.deepEqual(normalizeReaderMemoryState(malformed), {});
  assert.deepEqual(
    rememberReaderGroup(malformed, "activity:attempt-1", "conversation", true),
    {
      "activity:attempt-1": {
        groups: { conversation: true },
      },
    },
  );
  assert.deepEqual(
    rememberEveryReaderGroup(malformed, "activity:attempt-1", ["review", "references"], true),
    {
      "activity:attempt-1": {
        groups: { review: true, references: true },
      },
    },
  );
});

test("normalization retains only bounded, schema-valid reader memory", () => {
  const oversizedGroups = Object.fromEntries(
    Array.from({ length: 70 }, (_, index) => [`group-${index}`, true]),
  );
  const raw = {
    broken: { groups: [], privatePayload: "discard" },
    valid: { groups: { conversation: true }, scrollTop: 120 },
  };

  assert.deepEqual(normalizeReaderMemoryState(raw), {
    valid: { groups: { conversation: true }, scrollTop: 120 },
  });
  const boundedGroups = rememberEveryReaderGroup({}, "activity:attempt-1", Object.keys(oversizedGroups), true);
  assert.equal(Object.keys(boundedGroups["activity:attempt-1"].groups).length, 64);
  assert.equal(boundedGroups["activity:attempt-1"].groups["group-69"], true);
});

test("reader memory evicts the oldest entry and refreshes a changed active reader", () => {
  let memory = {};
  for (let index = 0; index <= MAX_READER_MEMORY_ENTRIES; index += 1) {
    memory = rememberReaderGroup(memory, `activity:attempt-${index}`, "conversation", true);
  }

  assert.equal(Object.keys(memory).length, MAX_READER_MEMORY_ENTRIES);
  assert.equal(memory["activity:attempt-0"], undefined);

  memory = rememberReaderGroup(memory, "activity:attempt-1", "conversation", false);
  memory = rememberReaderGroup(memory, "activity:new", "conversation", true);
  assert.equal(memory["activity:attempt-1"].groups.conversation, false);
  assert.equal(memory["activity:attempt-2"], undefined);
  assert.equal(Object.keys(memory).at(-1), "activity:new");
});

test("position persistence stays bounded and preserves group state", () => {
  let memory = {};
  for (let index = 0; index < MAX_READER_MEMORY_ENTRIES; index += 1) {
    memory = rememberReaderGroup(memory, `activity:attempt-${index}`, "conversation", true);
  }

  memory = rememberReaderPosition(memory, "activity:attempt-0", {
    scrollTop: 360,
    anchorId: "case-facts",
    anchorOffset: 12,
  });
  memory = rememberReaderPosition(memory, "activity:new", { scrollTop: 24 });

  assert.equal(Object.keys(memory).length, MAX_READER_MEMORY_ENTRIES);
  assert.deepEqual(memory["activity:attempt-0"], {
    groups: { conversation: true },
    scrollTop: 360,
    anchorId: "case-facts",
    anchorOffset: 12,
  });
  assert.equal(memory["activity:attempt-1"], undefined);
});

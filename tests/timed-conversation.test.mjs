import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { foldElapsed, orderContiguousTurns } from "../db/timed-conversation.ts";

test("shared timed-conversation clocks fold only an active interval", () => {
  assert.equal(foldElapsed(12, null, 50_000), 12);
  assert.equal(foldElapsed(12, 45_000, 50_999), 17);
  assert.equal(foldElapsed(12, 55_000, 50_000), 12);
});

test("shared transcript ordering accepts a sortable contiguous batch and rejects gaps", () => {
  const accepted = orderContiguousTurns([{ sequence: 3 }, { sequence: 2 }], 2);
  assert.equal(accepted.contiguous, true);
  assert.deepEqual(accepted.ordered.map((turn) => turn.sequence), [2, 3]);
  assert.equal(orderContiguousTurns([{ sequence: 2 }, { sequence: 4 }], 2).contiguous, false);
  assert.equal(orderContiguousTurns([{ sequence: 2 }, { sequence: 2 }], 2).contiguous, false);
  assert.equal(orderContiguousTurns([{ sequence: 3 }], 2).contiguous, false);
});

test("Interview and Learn both consume the shared timed-conversation module", async () => {
  const [interview, learn, durable] = await Promise.all([
    readFile(new URL("../db/live-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/learn.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8"),
  ]);
  assert.match(interview, /from "\.\/timed-conversation"/);
  assert.match(learn, /from "\.\/timed-conversation"/);
  assert.match(durable, /from "\.\/timed-conversation"/);
});

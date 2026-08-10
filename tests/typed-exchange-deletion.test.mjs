import assert from "node:assert/strict";
import test from "node:test";

import {
  listTypedExchangePairs,
  resolveTypedExchangePair,
  typedExchangeDeletionFingerprint,
  TypedExchangeDeletionError,
} from "../db/typed-exchange-deletion.ts";

const turns = [
  {
    turnId: "typed-user-1",
    specialty: "leetcode",
    speaker: "user",
    body: "Administrative typed turn.",
    source: "codex",
    sequence: 10,
    occurredAt: 100,
    updatedAt: 700,
  },
  {
    turnId: "typed-response-1",
    specialty: "leetcode",
    speaker: "specialist",
    body: "Administrative response.",
    source: "codex",
    sequence: 11,
    occurredAt: 200,
    updatedAt: 800,
  },
];

test("typed exchange pairing requires one adjacent codex user/specialist pair", () => {
  const resolved = resolveTypedExchangePair(turns, "typed-user-1");
  assert.equal(resolved.responseTurn.turnId, "typed-response-1");
  assert.equal(resolved.revision, 800);
  assert.deepEqual(listTypedExchangePairs(turns), [{
    userTurnId: "typed-user-1",
    responseTurnId: "typed-response-1",
    specialty: "leetcode",
    revision: 800,
  }]);

  assert.throws(
    () => resolveTypedExchangePair(turns, "typed-user-1", "wrong-response"),
    (error) => error instanceof TypedExchangeDeletionError
      && error.code === "typed_exchange_reply_mismatch",
  );
  assert.throws(
    () => resolveTypedExchangePair([
      ...turns,
      { ...turns[1], turnId: "competing-response" },
    ], "typed-user-1"),
    (error) => error instanceof TypedExchangeDeletionError
      && error.code === "typed_exchange_reply_mismatch",
  );
  assert.throws(
    () => resolveTypedExchangePair([
      { ...turns[0], source: "audio_transcript" },
      turns[1],
    ], "typed-user-1"),
    (error) => error instanceof TypedExchangeDeletionError
      && error.code === "typed_exchange_source_mismatch",
  );
});

test("typed exchange deletion fingerprints exact immutable retry payloads", async () => {
  const input = {
    activityId: "activity-1",
    userTurnId: "typed-user-1",
    responseTurnId: "typed-response-1",
    expectedRevision: 800,
    reason: "The user confirmed this was administrative.",
  };
  const first = await typedExchangeDeletionFingerprint(input);
  assert.equal(first.length, 64);
  assert.equal(await typedExchangeDeletionFingerprint(input), first);
  assert.notEqual(await typedExchangeDeletionFingerprint({
    ...input,
    reason: "Changed retry payload.",
  }), first);
});

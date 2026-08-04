import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalVoiceBatchTurns, sameVoiceBatchReservation } from "../db/practice-exchange-policy.ts";
import {
  resolveVoiceCaptureBatch,
  voiceCaptureBatchInputSchema,
} from "../mcp-worker/voice-capture-batch.ts";

const input = {
  activityId: "activity-1",
  activityTitle: "Course Schedule",
  specialty: "leetcode",
  captures: [
    { captureId: "capture-a", userTurnId: "user-a" },
    { captureId: "capture-b", userTurnId: "user-b" },
  ],
  responseTurnId: "specialist-1",
  responseBody: "Both traversals work; compare their invariants.",
  responseOccurredAt: 300,
  reason: "Both recordings form one visible answer.",
};

test("the batch MCP contract accepts 2–20 ordered unique captures", () => {
  assert.equal(voiceCaptureBatchInputSchema.safeParse(input).success, true);
  assert.equal(voiceCaptureBatchInputSchema.safeParse({ ...input, captures: input.captures.slice(0, 1) }).success, false);
  assert.equal(voiceCaptureBatchInputSchema.safeParse({
    ...input,
    captures: Array.from({ length: 21 }, (_, index) => ({
      captureId: `capture-${index}`,
      userTurnId: `turn-${index}`,
    })),
  }).success, false);
  assert.equal(voiceCaptureBatchInputSchema.safeParse({
    ...input,
    captures: [input.captures[0], { captureId: "capture-a", userTurnId: "user-b" }],
  }).success, false);
  assert.equal(voiceCaptureBatchInputSchema.safeParse({
    ...input,
    captures: [input.captures[0], { captureId: "capture-b", userTurnId: "user-a" }],
  }).success, false);
});

test("the batch MCP adapter preserves supplied order and reserves one response", async () => {
  const reservations = [];
  const result = await resolveVoiceCaptureBatch(input, async (reservation) => {
    reservations.push(reservation);
    return { duplicate: false, status: "provisional" };
  });
  assert.deepEqual(reservations[0].captures, input.captures);
  assert.equal(reservations[0].responseTurnId, input.responseTurnId);
  assert.deepEqual(result.userTurnIds, ["user-a", "user-b"]);
  assert.equal(result.responseTurnId, "specialist-1");
  assert.match(result.receipt, /2 recordings/);
});

test("reverse delivery still materializes ordered users followed by one response", () => {
  const turns = canonicalVoiceBatchTurns([
    { captureId: "capture-b", userTurnId: "user-b", memberOrder: 1, transcript: "Actually, DFS may use less state.", occurredAt: 200 },
    { captureId: "capture-a", userTurnId: "user-a", memberOrder: 0, transcript: "I can solve this using BFS.", occurredAt: 100 },
  ], {
    turnId: "specialist-1",
    body: "Both traversals work; compare their invariants.",
    occurredAt: 300,
  }, "leetcode", 10);
  assert.deepEqual(turns.map((turn) => [turn.turnId, turn.speaker, turn.sequence]), [
    ["user-a", "user", 10],
    ["user-b", "user", 11],
    ["specialist-1", "specialist", 12],
  ]);
  assert.throws(() => canonicalVoiceBatchTurns([
    { captureId: "capture-a", userTurnId: "user-a", memberOrder: 0, transcript: "A", occurredAt: 100 },
    { captureId: "capture-b", userTurnId: "user-b", memberOrder: 1, transcript: null, occurredAt: null },
  ], { turnId: "specialist-1", body: "S", occurredAt: 300 }, "leetcode", 10), /complete/);
});

test("changed order, membership, activity, specialty, or response content is not an exact retry", () => {
  const reservation = {
    activityId: input.activityId,
    specialty: input.specialty,
    captures: input.captures,
    responseTurnId: input.responseTurnId,
    responseBody: input.responseBody,
    responseOccurredAt: input.responseOccurredAt,
  };
  assert.equal(sameVoiceBatchReservation(reservation, { ...reservation }), true);
  assert.equal(sameVoiceBatchReservation(reservation, { ...reservation, captures: [...reservation.captures].reverse() }), false);
  assert.equal(sameVoiceBatchReservation(reservation, { ...reservation, captures: reservation.captures.slice(0, 1) }), false);
  assert.equal(sameVoiceBatchReservation(reservation, { ...reservation, activityId: "activity-2" }), false);
  assert.equal(sameVoiceBatchReservation(reservation, { ...reservation, specialty: "behavioral" }), false);
  assert.equal(sameVoiceBatchReservation(reservation, { ...reservation, responseBody: "Changed" }), false);
});

test("D1 enforces one group order and one user-turn membership", async () => {
  const migration = await readFile(new URL("../drizzle/0021_voice_response_groups.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
  const insertGroup = db.prepare(`INSERT INTO voice_response_groups
    (owner_id,response_turn_id,activity_id,specialty,response_body,response_occurred_at,member_count,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insertGroup.run("owner", "response-1", "activity-1", "leetcode", "S", 300, 2, "provisional", 1, 1);
  const insertMember = db.prepare(`INSERT INTO voice_response_group_members
    (owner_id,capture_id,response_turn_id,activity_id,user_turn_id,member_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  insertMember.run("owner", "capture-a", "response-1", "activity-1", "user-a", 0, 1, 1);
  assert.throws(
    () => insertMember.run("owner", "capture-b", "response-1", "activity-1", "user-b", 0, 1, 1),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => insertMember.run("owner", "capture-b", "response-1", "activity-1", "user-a", 1, 1, 1),
    /UNIQUE constraint failed/,
  );
  db.close();
});

test("group completion, finish guards, and remediation share the same durable graph", async () => {
  const [store, contract, leetcode, systemDesign, behavioral] = await Promise.all([
    readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/durable-practice-publishing.md", import.meta.url), "utf8"),
    readFile(new URL("../practice/leetcode/AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../practice/system-design/AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../practice/behavioral/AGENTS.md", import.meta.url), "utf8"),
  ]);
  assert.match(store, /notExists\(db\.select[\s\S]*voiceResponseGroupMembers/);
  assert.match(store, /status: "materialized"/);
  assert.match(store, /hasCanonicalMaterializedVoiceGroupMember/);
  assert.match(store, /beginDeleteVoiceCaptureGraph/);
  assert.match(store, /inArray\(activityAudioClips\.id, scope\.clipIds\)/);
  for (const guide of [contract, leetcode, systemDesign, behavioral]) {
    assert.match(guide, /resolve_voice_captures_and_save_response/);
  }
});

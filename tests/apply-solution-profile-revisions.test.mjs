import test from "node:test";
import assert from "node:assert/strict";

import {
  assertTargetState,
  buildMutationBatch,
  executeRemoteBatch,
  resultSetsFromWrangler,
  sha256,
} from "../scripts/apply-solution-profile-revisions.mjs";

const previousPayload = JSON.stringify({ summary: "previous", tags: ["graph"] });
const nextProfile = { summary: "corrected", tags: ["graph", "bfs"] };
const target = {
  questionId: "example-question",
  title: "Example Question",
  expectedCurrentRevision: 2,
  expectedCurrentPayloadSha256: sha256(previousPayload),
  profile: nextProfile,
};
const current = {
  owner_id: "owner-a",
  specialty: "leetcode",
  question_id: target.questionId,
  title: target.title,
  current_revision: 2,
  tags: JSON.stringify(["graph"]),
  payload: previousPayload,
  updated_at: 1_000,
};
const prior = {
  owner_id: "owner-a",
  specialty: "leetcode",
  question_id: target.questionId,
  revision: 2,
  activity_id: "activity-a",
  payload: previousPayload,
  created_at: 900,
};
const before = { owners: [{ owner_id: "owner-a" }], profile: [current], revisions: [prior], links: [] };

test("one guarded repair target is one bounded eight-statement D1 transaction", () => {
  const batch = buildMutationBatch({ targets: [target] }, [before], 2_000);
  assert.equal(batch.length, 8);
  assert.match(batch[0].sql, /current_revision = \?/);
  assert.match(batch[1].sql, /problem_solution_revisions/);
  assert.match(batch[2].sql, /NOT EXISTS/);
  assert.match(batch[3].sql, /^INSERT INTO problem_solution_revisions/);
  assert.match(batch[4].sql, /^UPDATE problem_solution_profiles/);
  assert.deepEqual(batch[3].params.slice(0, 4), ["owner-a", target.questionId, 3, "activity-a"]);
  assert.deepEqual(batch[4].params.slice(-5), ["owner-a", target.questionId, 2, 1_000, previousPayload]);
});

test("applied-state verification preserves the immutable activity link", () => {
  const nextPayload = JSON.stringify(nextProfile);
  const after = {
    owners: [{ owner_id: "owner-a" }],
    profile: [{ ...current, current_revision: 3, payload: nextPayload }],
    revisions: [prior, { ...prior, revision: 3, payload: nextPayload, created_at: 2_000 }],
    links: [],
  };
  assert.equal(assertTargetState(target, after, { allowApplied: true }).nextRevision, 3);

  const relinked = structuredClone(after);
  relinked.revisions[1].activity_id = "different-activity";
  assert.throws(() => assertTargetState(target, relinked, { allowApplied: true }), /does not match/);
});

test("wrangler and Cloudflare response adapters reject partial mutation results", async () => {
  assert.deepEqual(resultSetsFromWrangler(JSON.stringify([{ results: [{ revision: 2 }] }])), [[{ revision: 2 }]]);

  const ok = await executeRemoteBatch([{ sql: "SELECT 1", params: [] }], {
    accountId: "account",
    apiToken: "token",
    databaseId: "database",
    fetchImpl: async () => new Response(JSON.stringify({ success: true, result: [{ success: true }] }), { status: 200 }),
  });
  assert.equal(ok.length, 1);

  await assert.rejects(() => executeRemoteBatch([
    { sql: "SELECT 1", params: [] },
    { sql: "SELECT invalid", params: [] },
  ], {
    accountId: "account",
    apiToken: "token",
    databaseId: "database",
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      result: [{ success: true }, { success: false }],
    }), { status: 200 }),
  }), /statement 2 failed/);
});

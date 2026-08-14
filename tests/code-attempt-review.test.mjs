import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  assertCodeAttemptReviewParity,
  codeAttemptReviewForDisplay,
  pendingCodeAttemptReviewIds,
  planCodeAttemptWrite,
  normalizeCodeAttemptReview,
} from "../db/code-attempt-review.ts";
import { d1TransactionalInvariantGuard } from "../db/d1-transactional-guard.ts";

test("transactional invariant guards are executable D1 batch queries", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const client = {
    prepare(query) {
      return {
        bind(...params) {
          return { params, query };
        },
      };
    },
    async batch(statements) {
      assert.equal(statements.length, 1);
      assert.match(statements[0].query, /select json_extract/i);
      return statements.map((statement) => ({
        success: true,
        results: sqlite.prepare(statement.query).all(...statement.params),
        meta: {},
      }));
    },
  };
  const db = drizzle(client);
  const guard = d1TransactionalInvariantGuard(db, sql`1 = 1`);

  assert.equal(typeof guard._prepare, "function");
  assert.deepEqual(await db.batch([guard]), [[{ allowed: 1 }]]);
  sqlite.close();
});

test("new code-attempt reviews accept only the versioned pending or complete contract", () => {
  assert.deepEqual(
    normalizeCodeAttemptReview({ schemaVersion: 1, status: "pending" }),
    { schemaVersion: 1, status: "pending" },
  );

  const complete = {
    schemaVersion: 1,
    status: "complete",
    summary: "The breadth-first structure is sound, but token parsing is incorrect.",
    whatWentWell: ["The serialization traversal preserves tree shape."],
    whatToImprove: ["Escape the delimiter and compare token contents."],
    testingEvidence: ["The empty-tree round trip failed before the parsing repair."],
    nextStep: "Repair parsing and rerun the round-trip suite.",
    provenance: "specialist_observed",
    reviewedAt: 1_785_727_931_536,
  };
  assert.deepEqual(normalizeCodeAttemptReview(complete), complete);

  assert.equal(normalizeCodeAttemptReview(null), null);
  assert.equal(normalizeCodeAttemptReview({ arbitrary: true }), null);
  assert.equal(normalizeCodeAttemptReview({ schemaVersion: 1, status: "pending", summary: "hidden" }), null);
  assert.equal(normalizeCodeAttemptReview({ ...complete, hiddenConclusion: "not visible" }), null);
});

test("legacy null and arbitrary reviews normalize to an explicit not-recorded reader state", () => {
  assert.deepEqual(codeAttemptReviewForDisplay(null), {
    schemaVersion: 0,
    status: "not_recorded",
  });
  assert.deepEqual(codeAttemptReviewForDisplay({ previousShape: true }), {
    schemaVersion: 0,
    status: "not_recorded",
  });
  assert.deepEqual(
    codeAttemptReviewForDisplay({ schemaVersion: 1, status: "pending" }),
    { schemaVersion: 1, status: "pending" },
  );
});

test("finalization blocks pending new reviews without blocking legacy missing reviews", () => {
  const completeReview = {
    schemaVersion: 1,
    status: "complete",
    summary: "Reviewed.",
    whatWentWell: ["Traversal is linear."],
    whatToImprove: ["Tighten parsing."],
    testingEvidence: ["Round trips passed."],
    provenance: "specialist_observed",
    reviewedAt: 200,
  };
  assert.deepEqual(pendingCodeAttemptReviewIds([
    { id: "legacy-null", review: null },
    { id: "legacy-arbitrary", review: { old: true } },
    { id: "pending-2", review: { schemaVersion: 1, status: "pending" } },
    { id: "complete-3", review: completeReview },
  ]), ["pending-2"]);
});

test("complete structured reviews cannot contain conclusions hidden from the visible specialist review", () => {
  const review = {
    schemaVersion: 1,
    status: "complete",
    summary: "The BFS structure is sound, but token parsing is incorrect.",
    whatWentWell: ["The serialization traversal preserves tree shape."],
    whatToImprove: ["Escape the pipe delimiter and compare token contents."],
    testingEvidence: ["The empty-tree round trip failed with NumberFormatException."],
    nextStep: "Repair parsing and rerun the round-trip suite.",
    provenance: "specialist_observed",
    reviewedAt: 200,
  };
  const visibleResponse = [
    review.summary,
    review.whatWentWell[0],
    review.whatToImprove[0],
    review.testingEvidence[0],
    review.nextStep,
  ].join("\n\n");

  assert.doesNotThrow(() => assertCodeAttemptReviewParity(review, visibleResponse, [
    review.testingEvidence[0],
  ]));
  assert.throws(
    () => assertCodeAttemptReviewParity(
      { ...review, whatToImprove: [...review.whatToImprove, "Use a depth-first format instead."] },
      visibleResponse,
      [review.testingEvidence[0]],
    ),
    /visible specialist review/i,
  );
  assert.throws(
    () => assertCodeAttemptReviewParity(review, visibleResponse, ["A different test was run."]),
    /stored evaluation evidence/i,
  );
  assert.throws(
    () => assertCodeAttemptReviewParity(
      { ...review, summary: "解析需要修复。" },
      visibleResponse,
      [review.testingEvidence[0]],
    ),
    /visible specialist review/i,
  );
});

test("semantic review paraphrases cannot replace the exact visible conclusion", () => {
  const visibleSummary = "Verdict: Accepted, based on your explicit report.";
  const visibleFinding = "You greedily packed the longest valid line from left to right.";
  const visibleImprovement = "A one-pass formatter can reduce auxiliary storage.";
  const visibleNextStep = "Reimplement the one-pass version once.";
  const visibleResponse = [
    visibleSummary,
    visibleFinding,
    visibleImprovement,
    visibleNextStep,
  ].join("\n\n");
  const paritySafeReview = {
    schemaVersion: 1,
    status: "complete",
    summary: visibleSummary,
    whatWentWell: [visibleFinding],
    whatToImprove: [visibleImprovement],
    testingEvidence: [visibleSummary],
    nextStep: visibleNextStep,
    provenance: "specialist_observed",
    reviewedAt: 200,
  };

  assert.doesNotThrow(() => assertCodeAttemptReviewParity(
    paritySafeReview,
    visibleResponse,
    [visibleSummary],
  ));
  assert.throws(
    () => assertCodeAttemptReviewParity(
      {
        ...paritySafeReview,
        summary: "Accepted greedy solution with correct line packing and space distribution.",
      },
      visibleResponse,
      [visibleSummary],
    ),
    /visible specialist review/i,
  );
});

function attempt(overrides = {}) {
  return {
    id: "attempt-1",
    activityId: "activity-1",
    originatingTurnId: "user-turn-1",
    sequence: 1,
    language: "java",
    code: "class Codec {}",
    occurredAt: 100,
    review: { schemaVersion: 1, status: "pending" },
    reviewResponseTurnId: null,
    observedCorrectness: "not_verified",
    concreteFindings: [],
    edgeCases: [],
    complexity: null,
    finalDeclaration: "Evaluation is still running.",
    ...overrides,
  };
}

test("a pending attempt can complete evaluation without rewriting immutable code identity", () => {
  const completeReview = {
    schemaVersion: 1,
    status: "complete",
    summary: "The implementation needs a parsing repair.",
    whatWentWell: ["The traversal preserves tree shape."],
    whatToImprove: ["Compare token contents instead of object identity."],
    testingEvidence: ["The empty-tree round trip failed."],
    nextStep: "Repair parsing and rerun the suite.",
    provenance: "specialist_observed",
    reviewedAt: 200,
  };
  const completed = attempt({
    review: completeReview,
    reviewResponseTurnId: "specialist-turn-1",
    observedCorrectness: "issues_found",
    concreteFindings: ["The empty-tree round trip failed."],
    edgeCases: ["empty tree"],
    complexity: { time: "O(n)", space: "O(n)" },
    finalDeclaration: "Reviewed locally; no platform verdict was observed.",
  });

  assert.equal(planCodeAttemptWrite(attempt(), completed).kind, "update_evaluation");
  assert.equal(planCodeAttemptWrite(completed, completed).kind, "duplicate");

  assert.throws(
    () => planCodeAttemptWrite(attempt(), { ...completed, code: "class Codec { /* changed */ }" }),
    /immutable code attempt identity/i,
  );
  assert.throws(
    () => planCodeAttemptWrite(completed, { ...completed, finalDeclaration: "Changed later." }),
    /complete code attempt review/i,
  );
  assert.equal(planCodeAttemptWrite(null, completed).kind, "insert");
  assert.equal(planCodeAttemptWrite(null, {
    ...completed,
    id: "attempt-2",
    sequence: 2,
    code: "class Codec { /* revised version */ }",
  }).kind, "insert");
});

test("legacy reviews can only be completed through the explicit evidence-backfill transition", () => {
  const backfillReview = {
    schemaVersion: 1,
    status: "complete",
    summary: "The stored implementation needs a parsing repair.",
    whatWentWell: ["The stored traversal preserves tree shape."],
    whatToImprove: ["Use content equality for stored delimiter tokens."],
    testingEvidence: ["The stored empty-tree round trip failed."],
    provenance: "explicit_evidence_backfill",
    reviewedAt: 300,
  };
  const legacy = attempt({
    review: null,
    concreteFindings: ["The stored empty-tree round trip failed."],
  });
  const backfilled = attempt({
    review: backfillReview,
    reviewResponseTurnId: "stored-specialist-turn",
    concreteFindings: ["The stored empty-tree round trip failed."],
  });

  assert.equal(planCodeAttemptWrite(legacy, backfilled).kind, "backfill_review");
  assert.throws(
    () => planCodeAttemptWrite(legacy, {
      ...backfilled,
      review: { ...backfillReview, provenance: "specialist_observed" },
    }),
    /explicit evidence backfill/i,
  );
  assert.throws(
    () => planCodeAttemptWrite(legacy, {
      ...backfilled,
      concreteFindings: [...backfilled.concreteFindings, "A conclusion that was not stored."],
    }),
    /stored attempt evidence/i,
  );
});

test("the D1 migration preserves legacy nullable reviews while recording parity and backfill audit evidence", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0020_code_attempt_reviews.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /reviewResponseTurnId: text\("review_response_turn_id"\)/);
  assert.match(schema, /leetcodeCodeAttemptReviewBackfills/);
  assert.match(migration, /ALTER TABLE `leetcode_code_attempts` ADD `review_response_turn_id` text/);
  assert.match(migration, /CREATE TABLE `leetcode_code_attempt_review_backfills`/);
  assert.match(migration, /CREATE UNIQUE INDEX `code_attempts_owner_activity_sequence_idx`/);
  assert.doesNotMatch(migration, /CREATE TRIGGER/);
  assert.doesNotMatch(migration, /UPDATE `leetcode_code_attempts`/);
});

test("D1 atomically protects one attempt sequence per owner and activity", async () => {
  const migration = await readFile(new URL("../drizzle/0020_code_attempt_reviews.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE leetcode_code_attempts (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      review TEXT,
      PRIMARY KEY (owner_id, id)
    );
  `);
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }

  const insertAttempt = db.prepare(
    "INSERT INTO leetcode_code_attempts (owner_id, id, activity_id, sequence, review) VALUES (?, ?, ?, ?, ?)",
  );
  insertAttempt.run("owner", "attempt-1", "activity-1", 1, null);
  assert.throws(
    () => insertAttempt.run("owner", "attempt-2", "activity-1", 1, null),
    /UNIQUE constraint failed/,
  );
});

test("the shared Code Attempt body renders the same normalized review without duplicating immutable reader code", async () => {
  const [route, client, css, types] = await Promise.all([
    readFile(new URL("../app/api/practice-record/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/interview-arc-v2.css", import.meta.url), "utf8"),
    readFile(new URL("../app/live-types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /codeAttemptReviewForDisplay\(attempt\.review\)/);
  assert.match(types, /review: CodeAttemptReviewDisplay/);
  assert.match(client, /function AttemptReview/);
  for (const label of ["Attempt Review", "Review pending", "Review not recorded", "What Went Well", "What To Improve", "Testing Evidence", "Next Step"]) {
    assert.match(client, new RegExp(label));
  }
  assert.equal((client.match(/<CodeAttemptBody attempt=\{attempt\}/g) ?? []).length, 3);
  assert.match(client, /renderCodeAttempts=\{false\}/);
  assert.match(css, /\.attempt-review-columns/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.attempt-review-columns/);
});

test("the MCP write contract requires specialist-observed review data and leaves evidence backfill to the coordinator", async () => {
  const [{ codeAttemptReviewInputSchema }, durable, coordinatorScript] = await Promise.all([
    import("../mcp-worker/code-attempt-review-schema.ts"),
    readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/backfill-code-attempt-review.mjs", import.meta.url), "utf8"),
  ]);

  assert.equal(codeAttemptReviewInputSchema.safeParse({ schemaVersion: 1, status: "pending" }).success, true);
  assert.equal(codeAttemptReviewInputSchema.safeParse({ schemaVersion: 1, status: "pending", hidden: true }).success, false);
  assert.equal(codeAttemptReviewInputSchema.safeParse({
    schemaVersion: 1,
    status: "complete",
    summary: "Visible review.",
    whatWentWell: ["Good."],
    whatToImprove: ["Improve."],
    testingEvidence: ["Tested."],
    provenance: "explicit_evidence_backfill",
    reviewedAt: 1,
  }).success, false);

  assert.match(durable, /eq\(leetcodeCodeAttempts\.ownerId, ownerId\)/);
  assert.match(durable, /eq\(practiceTranscriptTurns\.ownerId, ownerId\)/);
  assert.match(durable, /Complete every pending Code Attempt review before finalization/);
  assert.match(durable, /Historical review backfill is available only through the coordinator audit command/);
  assert.match(durable, /d1TransactionalInvariantGuard/);
  assert.match(durable, /isD1TransactionalInvariantFailure/);
  assert.match(durable, /const noReadyFinalizationGuard = d1TransactionalInvariantGuard/);
  assert.match(durable, /const exactTranscriptEvidenceGuard = d1TransactionalInvariantGuard/);
  assert.match(durable, /db\.batch\(\[\s*noReadyFinalizationGuard,\s*exactTranscriptEvidenceGuard,\s*db\.insert\(leetcodeCodeAttempts\)/);
  assert.match(durable, /exactCodeAttemptTranscriptEvidenceCondition\(db, ownerId, incoming, review\.status === "complete"\)/);
  assert.match(durable, /db\.batch\(\[\s*exactTranscriptEvidenceGuard,\s*db\.update\(leetcodeCodeAttempts\)/);
  assert.match(durable, /const transcriptState = payload\.complete/);
  assert.match(durable, /exactActivityTranscriptStateCondition\(ownerId, activityId, transcriptState\)/);
  assert.match(durable, /const finalizationStatements = \[\.\.\.finalizationGuards\]/);
  assert.match(durable, /finalizationStatements\.push\(finalizationWrite\)/);
  assert.match(durable, /review\.status === "pending" \? undefined : input\.reviewResponseTurnId/);
  assert.match(coordinatorScript, /explicit_evidence_backfill/);
  assert.match(coordinatorScript, /--apply/);
  assert.match(coordinatorScript, /--confirm-remote/);
  assert.match(coordinatorScript, /assertCodeAttemptReviewParity/);
  assert.match(coordinatorScript, /assertAuditReceipt/);
  assert.match(coordinatorScript, /SELECT json_extract\(/);
  assert.match(coordinatorScript, /UPDATE leetcode_code_attempts/);
  assert.match(coordinatorScript, /The audited review was not applied to the exact historical Code Attempt/);
  assert.match(coordinatorScript, /SELECT id, owner_id, activity_id[\s\S]*SELECT body, speaker[\s\S]*SELECT review_response_turn_id/);
});

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertCodeAttemptReviewParity,
  codeAttemptEvaluationEvidence,
  normalizeCodeAttemptReview,
  planCodeAttemptWrite,
} from "../db/code-attempt-review.ts";

function fail(message) {
  throw new Error(message);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonValue(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`Stored ${label} is not valid JSON.`);
  }
}

function resultSetsFromWrangler(output) {
  const parsed = JSON.parse(output);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.map((batch) => batch?.results ?? batch?.result?.[0]?.results ?? []);
}

const inputPath = argumentValue("--input");
if (!inputPath) {
  fail("Usage: pnpm code-attempt-review:backfill --input <gitignored.json> [--apply] [--remote --confirm-remote] [--persist-to <local-dir>]");
}

const remote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");
const persistTo = argumentValue("--persist-to");
if (remote && !process.argv.includes("--confirm-remote")) {
  fail("Remote review backfill requires the explicit --confirm-remote acknowledgement.");
}
if (remote && persistTo) fail("--persist-to is available only for local D1 validation.");

const root = process.cwd();
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
for (const field of ["attemptId", "activityId", "reviewResponseTurnId", "reason"]) {
  if (typeof input[field] !== "string" || !input[field].trim()) fail(`Backfill input requires ${field}.`);
}
if (input.ownerId !== undefined && (typeof input.ownerId !== "string" || !input.ownerId.trim())) {
  fail("Backfill ownerId must be a non-empty string when provided.");
}
const review = normalizeCodeAttemptReview(input.review);
if (!review || review.status !== "complete" || review.provenance !== "explicit_evidence_backfill") {
  fail("Backfill review must be a complete V1 review with explicit_evidence_backfill provenance.");
}

function execute(sql) {
  const args = [
    "d1", "execute", "DB", remote ? "--remote" : "--local",
    ...(persistTo ? ["--persist-to", path.resolve(persistTo)] : []),
    "--command", sql, "--json",
  ];
  return resultSetsFromWrangler(execFileSync(wrangler, args, { cwd: root, encoding: "utf8" }));
}

const ownerFilter = input.ownerId === undefined ? "" : ` AND owner_id = ${sqlText(input.ownerId)}`;
const ownerForAttempt = `(SELECT owner_id FROM leetcode_code_attempts
  WHERE id = ${sqlText(input.attemptId)} AND activity_id = ${sqlText(input.activityId)}${ownerFilter}
  GROUP BY owner_id HAVING COUNT(*) = 1)`;
const [attempts, visibleTurns, existingAudits] = execute(`SELECT id, owner_id, activity_id, originating_turn_id, sequence, language, code, occurred_at,
  review, review_response_turn_id, observed_correctness, concrete_findings, edge_cases, complexity,
  final_declaration, updated_at
FROM leetcode_code_attempts
WHERE id = ${sqlText(input.attemptId)} AND activity_id = ${sqlText(input.activityId)}${ownerFilter};
SELECT body, speaker
FROM practice_transcript_turns
WHERE owner_id = ${ownerForAttempt}
  AND activity_id = ${sqlText(input.activityId)}
  AND turn_id = ${sqlText(input.reviewResponseTurnId)};
SELECT review_response_turn_id, review, evidence_hash, reason
FROM leetcode_code_attempt_review_backfills
WHERE owner_id = ${ownerForAttempt} AND attempt_id = ${sqlText(input.attemptId)};`);
if (attempts.length !== 1) fail("The uniquely owner-scoped historical Code Attempt was not found.");
const stored = attempts[0];
if (stored.activity_id !== input.activityId) fail("The Code Attempt does not belong to the requested activity.");
if (visibleTurns.length !== 1 || visibleTurns[0].speaker !== "specialist") {
  fail("The owner-scoped visible specialist review turn was not found in this activity.");
}

const existing = {
  id: stored.id,
  activityId: stored.activity_id,
  originatingTurnId: stored.originating_turn_id,
  sequence: stored.sequence,
  language: stored.language,
  code: stored.code,
  occurredAt: stored.occurred_at,
  review: stored.review === null ? null : jsonValue(stored.review, "review"),
  reviewResponseTurnId: stored.review_response_turn_id,
  observedCorrectness: stored.observed_correctness,
  concreteFindings: jsonValue(stored.concrete_findings, "concrete findings"),
  edgeCases: jsonValue(stored.edge_cases, "edge cases"),
  complexity: stored.complexity === null ? null : jsonValue(stored.complexity, "complexity"),
  finalDeclaration: stored.final_declaration,
};
const incoming = {
  ...existing,
  review,
  reviewResponseTurnId: input.reviewResponseTurnId,
};
const plan = planCodeAttemptWrite(existing, incoming);
if (plan.kind !== "backfill_review" && plan.kind !== "duplicate") {
  fail("The historical Code Attempt is not eligible for a review-only backfill.");
}
assertCodeAttemptReviewParity(review, visibleTurns[0].body, codeAttemptEvaluationEvidence(existing));

const evidencePayload = JSON.stringify({
  attemptId: input.attemptId,
  activityId: input.activityId,
  reviewResponseTurnId: input.reviewResponseTurnId,
  review,
  storedEvidence: {
    observedCorrectness: existing.observedCorrectness,
    concreteFindings: existing.concreteFindings,
    edgeCases: existing.edgeCases,
    complexity: existing.complexity,
    finalDeclaration: existing.finalDeclaration,
  },
  visibleReviewBody: visibleTurns[0].body,
});
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(evidencePayload));
const evidenceHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
const expectedAudit = {
  reviewResponseTurnId: input.reviewResponseTurnId,
  review: JSON.stringify(review),
  evidenceHash,
  reason: input.reason.trim(),
};

function assertAuditReceipt(audit, expected) {
  if (!audit) fail("The review-backfill audit receipt was not returned.");
  const mismatches = [
    audit.review_response_turn_id === expected.reviewResponseTurnId ? null : "review turn",
    audit.review === expected.review ? null : "review payload",
    audit.evidence_hash === expected.evidenceHash ? null : "evidence hash",
    audit.reason === expected.reason ? null : "reason",
  ].filter(Boolean);
  if (mismatches.length) {
    fail(`A conflicting review-backfill audit row already exists (${mismatches.join(", ")}).`);
  }
}

if (!apply) {
  console.log(`Validated ${remote ? "remote" : "local"} backfill evidence. Re-run with --apply to write audit evidence ${evidenceHash}.`);
  process.exit(0);
}

const existingAudit = existingAudits[0];
if (existingAudit) {
  assertAuditReceipt(existingAudit, expectedAudit);
  console.log(`Review backfill already applied with evidence hash ${evidenceHash}.`);
  process.exit(0);
}

const createdAt = Date.now();
execute(`SELECT json_extract(
  CASE WHEN
    EXISTS (
      SELECT 1 FROM leetcode_code_attempts
      WHERE owner_id = ${sqlText(stored.owner_id)}
        AND id = ${sqlText(input.attemptId)}
        AND activity_id = ${sqlText(input.activityId)}
        AND (review IS NULL OR json_extract(review, '$.schemaVersion') IS NOT 1)
    )
    AND EXISTS (
      SELECT 1 FROM practice_transcript_turns
      WHERE owner_id = ${sqlText(stored.owner_id)}
        AND activity_id = ${sqlText(input.activityId)}
        AND turn_id = ${sqlText(input.reviewResponseTurnId)}
        AND speaker = 'specialist'
    )
    AND NOT EXISTS (
      SELECT 1 FROM leetcode_code_attempt_review_backfills
      WHERE owner_id = ${sqlText(stored.owner_id)}
        AND attempt_id = ${sqlText(input.attemptId)}
    )
  THEN '{"allowed":1}' ELSE 'invalid' END,
  '$.allowed'
) AS allowed;
INSERT INTO leetcode_code_attempt_review_backfills
  (owner_id, attempt_id, activity_id, review_response_turn_id, review, evidence_hash, reason, created_at)
VALUES (
  ${sqlText(stored.owner_id)}, ${sqlText(input.attemptId)}, ${sqlText(input.activityId)},
  ${sqlText(input.reviewResponseTurnId)}, ${sqlText(expectedAudit.review)}, ${sqlText(evidenceHash)},
  ${sqlText(input.reason.trim())}, ${createdAt}
);
UPDATE leetcode_code_attempts
SET review = ${sqlText(expectedAudit.review)},
  review_response_turn_id = ${sqlText(input.reviewResponseTurnId)},
  updated_at = MAX(updated_at, ${createdAt})
WHERE owner_id = ${sqlText(stored.owner_id)}
  AND id = ${sqlText(input.attemptId)}
  AND activity_id = ${sqlText(input.activityId)}
  AND (review IS NULL OR json_extract(review, '$.schemaVersion') IS NOT 1)
  AND EXISTS (
    SELECT 1 FROM leetcode_code_attempt_review_backfills
    WHERE owner_id = ${sqlText(stored.owner_id)}
      AND attempt_id = ${sqlText(input.attemptId)}
      AND activity_id = ${sqlText(input.activityId)}
      AND review_response_turn_id = ${sqlText(input.reviewResponseTurnId)}
      AND review = ${sqlText(expectedAudit.review)}
      AND evidence_hash = ${sqlText(evidenceHash)}
      AND reason = ${sqlText(input.reason.trim())}
  );`);
const [auditRows, attemptRows] = execute(`
SELECT review_response_turn_id, review, evidence_hash, reason
FROM leetcode_code_attempt_review_backfills
WHERE owner_id = ${sqlText(stored.owner_id)} AND attempt_id = ${sqlText(input.attemptId)};
SELECT review, review_response_turn_id
FROM leetcode_code_attempts
WHERE owner_id = ${sqlText(stored.owner_id)}
  AND id = ${sqlText(input.attemptId)}
  AND activity_id = ${sqlText(input.activityId)};`);
assertAuditReceipt(auditRows?.[0], expectedAudit);
if (
  attemptRows?.length !== 1
  || attemptRows[0].review !== expectedAudit.review
  || attemptRows[0].review_response_turn_id !== input.reviewResponseTurnId
) {
  fail("The audited review was not applied to the exact historical Code Attempt.");
}
console.log(`Applied ${remote ? "remote" : "local"} review backfill with evidence hash ${evidenceHash}.`);

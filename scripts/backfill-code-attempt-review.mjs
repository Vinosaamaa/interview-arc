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

function rowsFromWrangler(output) {
  const parsed = JSON.parse(output);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.flatMap((batch) => batch?.results ?? batch?.result?.[0]?.results ?? []);
}

const inputPath = argumentValue("--input");
if (!inputPath) {
  fail("Usage: pnpm code-attempt-review:backfill --input <gitignored.json> [--apply] [--remote --confirm-remote]");
}

const remote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");
if (remote && !process.argv.includes("--confirm-remote")) {
  fail("Remote review backfill requires the explicit --confirm-remote acknowledgement.");
}

const root = process.cwd();
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
for (const field of ["ownerId", "attemptId", "activityId", "reviewResponseTurnId", "reason"]) {
  if (typeof input[field] !== "string" || !input[field].trim()) fail(`Backfill input requires ${field}.`);
}
const review = normalizeCodeAttemptReview(input.review);
if (!review || review.status !== "complete" || review.provenance !== "explicit_evidence_backfill") {
  fail("Backfill review must be a complete V1 review with explicit_evidence_backfill provenance.");
}

function execute(sql) {
  const args = ["d1", "execute", "DB", remote ? "--remote" : "--local", "--command", sql, "--json"];
  return rowsFromWrangler(execFileSync(wrangler, args, { cwd: root, encoding: "utf8" }));
}

const attempts = execute(`SELECT id, activity_id, originating_turn_id, sequence, language, code, occurred_at,
  review, review_response_turn_id, observed_correctness, concrete_findings, edge_cases, complexity,
  final_declaration, updated_at
FROM leetcode_code_attempts
WHERE owner_id = ${sqlText(input.ownerId)} AND id = ${sqlText(input.attemptId)};`);
if (attempts.length !== 1) fail("The owner-scoped historical Code Attempt was not found.");
const stored = attempts[0];
if (stored.activity_id !== input.activityId) fail("The Code Attempt does not belong to the requested activity.");

const visibleTurns = execute(`SELECT body, speaker
FROM practice_transcript_turns
WHERE owner_id = ${sqlText(input.ownerId)}
  AND activity_id = ${sqlText(input.activityId)}
  AND turn_id = ${sqlText(input.reviewResponseTurnId)};`);
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

if (!apply) {
  console.log(`Validated ${remote ? "remote" : "local"} backfill evidence. Re-run with --apply to write audit evidence ${evidenceHash}.`);
  process.exit(0);
}

const existingAudit = execute(`SELECT review_response_turn_id, review, evidence_hash, reason
FROM leetcode_code_attempt_review_backfills
WHERE owner_id = ${sqlText(input.ownerId)} AND attempt_id = ${sqlText(input.attemptId)};`)[0];
if (existingAudit) {
  if (
    existingAudit.review_response_turn_id !== input.reviewResponseTurnId
    || existingAudit.review !== JSON.stringify(review)
    || existingAudit.evidence_hash !== evidenceHash
    || existingAudit.reason !== input.reason.trim()
  ) {
    fail("A conflicting review-backfill audit row already exists.");
  }
  console.log(`Review backfill already applied with evidence hash ${evidenceHash}.`);
  process.exit(0);
}

execute(`INSERT INTO leetcode_code_attempt_review_backfills
  (owner_id, attempt_id, activity_id, review_response_turn_id, review, evidence_hash, reason, created_at)
VALUES (
  ${sqlText(input.ownerId)}, ${sqlText(input.attemptId)}, ${sqlText(input.activityId)},
  ${sqlText(input.reviewResponseTurnId)}, ${sqlText(JSON.stringify(review))}, ${sqlText(evidenceHash)},
  ${sqlText(input.reason.trim())}, ${Date.now()}
)
;`);

const audit = execute(`SELECT review_response_turn_id, review, evidence_hash, reason
FROM leetcode_code_attempt_review_backfills
WHERE owner_id = ${sqlText(input.ownerId)} AND attempt_id = ${sqlText(input.attemptId)};`)[0];
if (
  !audit
  || audit.review_response_turn_id !== input.reviewResponseTurnId
  || audit.review !== JSON.stringify(review)
  || audit.evidence_hash !== evidenceHash
  || audit.reason !== input.reason.trim()
) {
  fail("A conflicting review-backfill audit row already exists.");
}
console.log(`Applied ${remote ? "remote" : "local"} review backfill with evidence hash ${evidenceHash}.`);

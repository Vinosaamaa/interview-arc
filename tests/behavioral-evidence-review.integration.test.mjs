import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";
import {
  availableMcpPort,
  connectMcpClient,
  runMcpCommand,
  startMcpWorker,
  stopMcpWorker,
  waitForMcpWorker,
} from "./helpers/mcp-worker-harness.mjs";

const project = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent;
}

const callRaw = (client, name, args) => client.callTool({ name, arguments: args });

function sourceWrite(operationId = "source-operation-1", expectedRevision = 0, overrides = {}) {
  return {
    operationId,
    expectedRevision,
    authorization: "behavioral_evidence_specialist",
    source: {
      schemaVersion: 1,
      sourceId: "source-example-repository",
      state: "active",
      projectKey: "example-project",
      kind: "repository",
      label: "Example repository",
      safeHint: "Primary implementation evidence",
      authorization: "user_owned",
      sensitivity: "private",
      availability: "available",
      refreshStatus: "current",
      contentRevision: "revision-1",
      lastInspectedAt: 1_786_291_200_000,
      visibility: "owner_private",
      ...overrides,
    },
  };
}

function evidenceWrite(operationId, evidenceId, overrides = {}) {
  return {
    operationId,
    evidence: {
      evidenceId,
      projectKey: "example-project",
      origin: "code_observation",
      statement: `Sanitized implementation observation for ${evidenceId}.`,
      sourceRevision: "revision-1",
      evidenceGrade: "E2",
      attributionGrade: "A0",
      claimStrength: "project_fact",
      candidateState: "pending",
      safeProvenance: [{ kind: "repository_observation", reference: "source-example-repository-revision-1" }],
      supports: ["The implementation contains the scoped behavior."],
      limitations: ["Personal ownership is not established."],
      tags: ["reliability"],
      ...overrides,
    },
    questionLink: { questionId: "question-example-1", relevance: "supporting" },
  };
}

async function waitForJobs(client, jobIds) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await call(client, "get_specialist_write_status", { jobIds });
    if (result.jobs.every((job) => job.status === "saved" || job.status === "failed")) return result.jobs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Behavioral evidence writes did not settle.");
}

async function saveEvidence(client, input) {
  await call(client, "upsert_behavioral_evidence_item", input);
  const [receipt] = await waitForJobs(client, [input.operationId]);
  assert.equal(receipt.status, "saved");
}

test("source revisions and candidate review are owner-isolated, atomic, and exactly retryable", { timeout: 180_000 }, async () => {
  const ownerToken = "ia_behavioral_review_owner_integration_token";
  const otherToken = "ia_behavioral_review_other_integration_token";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-behavioral-review-"));
    const port = await availableMcpPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await runMcpCommand(wrangler, [
      "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config,
    ], project);
    await runMcpCommand(wrangler, [
      "d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config,
      "--command", `INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
        VALUES
          ('${sha256(ownerToken)}','owner-review','Evidence review owner',1,NULL,NULL),
          ('${sha256(otherToken)}','other-review','Other evidence owner',1,NULL,NULL);`,
    ], project);
    const started = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = started.child;
    await waitForMcpWorker(baseUrl, worker, started.readDiagnosticTail);
    client = await connectMcpClient(baseUrl, ownerToken, "behavioral-review-owner");
    otherClient = await connectMcpClient(baseUrl, otherToken, "behavioral-review-other");

    const created = await call(client, "upsert_behavioral_evidence_source", sourceWrite());
    assert.deepEqual(created, {
      status: "created",
      sourceId: "source-example-repository",
      revision: 1,
      duplicate: false,
    });
    const exactSourceRetry = await call(client, "upsert_behavioral_evidence_source", sourceWrite());
    assert.equal(exactSourceRetry.duplicate, true);
    assert.equal(exactSourceRetry.revision, 1);
    const changedSourceRetry = await callRaw(client, "upsert_behavioral_evidence_source", sourceWrite(
      "source-operation-1",
      0,
      { label: "Changed retry" },
    ));
    assert.equal(changedSourceRetry.isError, true);
    assert.equal(changedSourceRetry.structuredContent.code, "behavioral_evidence_source_operation_conflict");

    const revised = await call(client, "upsert_behavioral_evidence_source", sourceWrite(
      "source-operation-2",
      1,
      { contentRevision: "revision-2", refreshStatus: "changed", lastInspectedAt: 1_786_291_260_000 },
    ));
    assert.equal(revised.status, "revised");
    assert.equal(revised.revision, 2);
    const staleSource = await callRaw(client, "upsert_behavioral_evidence_source", sourceWrite(
      "source-operation-stale",
      1,
      { contentRevision: "revision-3" },
    ));
    assert.equal(staleSource.isError, true);
    assert.equal(staleSource.structuredContent.code, "behavioral_evidence_source_revision_conflict");
    const historical = await call(client, "get_behavioral_evidence_registry", {
      sourceId: "source-example-repository",
      revision: 1,
    });
    assert.equal(historical.sources[0].contentRevision, "revision-1");
    assert.equal((await call(otherClient, "get_behavioral_evidence_registry", {})).sources.length, 0);

    await saveEvidence(client, evidenceWrite("evidence-operation-1", "evidence-candidate-1"));
    await saveEvidence(client, evidenceWrite("evidence-operation-2", "evidence-candidate-2"));
    await saveEvidence(client, evidenceWrite("evidence-operation-3", "evidence-candidate-3"));
    const queue = await call(client, "query_behavioral_evidence_candidates", {});
    assert.deepEqual(queue.candidates.map(({ evidenceId, reviewRevision, candidateState }) => (
      [evidenceId, reviewRevision, candidateState]
    )), [
      ["evidence-candidate-3", 1, "pending"],
      ["evidence-candidate-2", 1, "pending"],
      ["evidence-candidate-1", 1, "pending"],
    ]);
    assert.equal(queue.nextCursor, null);
    const firstPage = await call(client, "query_behavioral_evidence_candidates", { limit: 2 });
    assert.equal(firstPage.truncated, true);
    assert.deepEqual(firstPage.candidates.map(({ evidenceId }) => evidenceId), [
      "evidence-candidate-3",
      "evidence-candidate-2",
    ]);
    assert.deepEqual(firstPage.nextCursor, {
      beforeUpdatedAt: firstPage.candidates[1].updatedAt,
      beforeEvidenceId: "evidence-candidate-2",
    });
    const secondPage = await call(client, "query_behavioral_evidence_candidates", {
      limit: 2,
      ...firstPage.nextCursor,
    });
    assert.equal(secondPage.truncated, false);
    assert.deepEqual(secondPage.candidates.map(({ evidenceId }) => evidenceId), ["evidence-candidate-1"]);
    assert.equal(secondPage.nextCursor, null);
    const incompleteCursor = await callRaw(client, "query_behavioral_evidence_candidates", {
      beforeEvidenceId: "evidence-candidate-2",
    });
    assert.equal(incompleteCursor.isError, true);
    assert.equal((await call(otherClient, "query_behavioral_evidence_candidates", {})).candidates.length, 0);
    const foundation = await call(client, "get_behavioral_foundation_status", {});
    assert.equal(foundation.schemaVersion, 2);
    assert.deepEqual(foundation.sources, {
      total: 1,
      active: 1,
      available: 1,
      changed: 1,
      blocked: 0,
      revisions: 2,
      recent: [foundation.sources.recent[0]],
      lastUpdatedAt: foundation.sources.lastUpdatedAt,
      limit: 6,
      truncated: false,
    });
    assert.equal(foundation.sources.recent[0].contentRevision, "revision-2");
    assert.equal(foundation.candidates.pending, 3);
    assert.equal(foundation.candidates.items.length, 3);

    const review = {
      operationId: "review-operation-1",
      authorization: "explicit_owner_review",
      decisions: [{
        evidenceId: "evidence-candidate-1",
        expectedRevision: 1,
        decision: "accept",
        reason: "The sanitized observation is accurate and useful.",
      }],
    };
    const accepted = await call(client, "review_behavioral_evidence_candidates", review);
    assert.equal(accepted.decisions[0].state, "accepted");
    assert.equal(accepted.decisions[0].revision, 2);
    assert.equal((await call(client, "review_behavioral_evidence_candidates", review)).duplicate, true);
    const changedReviewRetry = await callRaw(client, "review_behavioral_evidence_candidates", {
      ...review,
      decisions: [{ ...review.decisions[0], reason: "Changed retry content." }],
    });
    assert.equal(changedReviewRetry.isError, true);
    assert.equal(changedReviewRetry.structuredContent.code, "behavioral_evidence_review_operation_conflict");
    const otherOwnerReview = await callRaw(otherClient, "review_behavioral_evidence_candidates", {
      ...review,
      operationId: "other-review-operation-1",
    });
    assert.equal(otherOwnerReview.isError, true);
    assert.equal(otherOwnerReview.structuredContent.code, "behavioral_evidence_review_candidate_not_found");

    const staleBatch = await callRaw(client, "review_behavioral_evidence_candidates", {
      operationId: "review-operation-stale-batch",
      authorization: "explicit_owner_review",
      decisions: [
        {
          evidenceId: "evidence-candidate-2",
          expectedRevision: 1,
          decision: "accept",
          reason: "This decision must roll back with the stale companion.",
        },
        {
          evidenceId: "evidence-candidate-1",
          expectedRevision: 1,
          decision: "accept",
          reason: "This revision is stale.",
        },
      ],
    });
    assert.equal(staleBatch.isError, true);
    assert.equal(staleBatch.structuredContent.code, "behavioral_evidence_review_revision_conflict");
    const stillPending = await call(client, "query_behavioral_evidence_candidates", {});
    assert.equal(stillPending.candidates.find(({ evidenceId }) => evidenceId === "evidence-candidate-2").reviewRevision, 1);

    const superseded = await call(client, "review_behavioral_evidence_candidates", {
      operationId: "review-operation-supersede",
      authorization: "explicit_owner_review",
      decisions: [{
        evidenceId: "evidence-candidate-1",
        expectedRevision: 2,
        decision: "supersede",
        reason: "A more precise candidate replaces this observation.",
        replacementEvidenceId: "evidence-candidate-3",
      }],
    });
    assert.equal(superseded.decisions[0].state, "superseded");
    const terminalReview = await callRaw(client, "review_behavioral_evidence_candidates", {
      operationId: "review-operation-terminal",
      authorization: "explicit_owner_review",
      decisions: [{
        evidenceId: "evidence-candidate-1",
        expectedRevision: 3,
        decision: "accept",
        reason: "Terminal evidence cannot be reactivated.",
      }],
    });
    assert.equal(terminalReview.isError, true);
    assert.equal(terminalReview.structuredContent.code, "behavioral_evidence_review_transition_conflict");
  } finally {
    await client?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    await stopMcpWorker(worker);
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

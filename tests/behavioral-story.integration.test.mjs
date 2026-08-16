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

function storyWrite(operationId = "story-create-1", expectedRevision = 0, overrides = {}) {
  return {
    operationId,
    expectedRevision,
    story: {
      schemaVersion: 1,
      storyId: "story-launch-1",
      state: "active",
      title: "Recovered a stalled launch",
      projectKey: "example-project",
      situation: "A customer launch stalled after a reliability regression.",
      task: "Restore the launch while keeping rollback explicit.",
      actions: ["Scoped the failure.", "Added a guarded rollout."],
      result: "The launch resumed without another regression.",
      learning: "Make rollback part of the initial design.",
      claimIds: ["claim-launch-1"],
      evidenceIds: ["evidence-launch-1"],
      gaps: ["Confirm the exact adoption metric."],
      competencies: ["execution", "ownership"],
      questionIds: ["question-launch-1"],
      visibility: "owner_private",
      ...overrides,
    },
  };
}

test("Story Bank persists exact revisions and serves owner-scoped question preflight through MCP", { timeout: 180_000 }, async () => {
  const token = "ia_behavioral_story_owner_integration_token";
  const otherToken = "ia_behavioral_story_other_integration_token";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-story-bank-"));
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
          ('${sha256(token)}','owner-story','Story owner',1,NULL,NULL),
          ('${sha256(otherToken)}','other-story','Other story owner',1,NULL,NULL);
        INSERT INTO behavioral_evidence_items
          (owner_id,evidence_id,project_key,origin,statement,source_revision,evidence_grade,attribution_grade,claim_strength,candidate_state,visibility,safe_provenance,supports,limitations,tags,owner_attestation,created_at,updated_at)
        VALUES
          ('owner-story','evidence-launch-1','example-project','production_evidence','The guarded rollout restored the launch.','production-revision-1','E3','A0','project_fact','accepted','owner_private','[{"kind":"production_evidence","reference":"launch-receipt-1"}]','["The launch resumed."]','["Adoption metric remains unconfirmed."]','["reliability"]',NULL,1,1);
        INSERT INTO behavioral_evidence_question_links
          (owner_id,question_id,evidence_id,relevance,created_at,updated_at)
        VALUES ('owner-story','question-launch-1','evidence-launch-1','supporting',1,1);
        INSERT INTO behavioral_claims
          (owner_id,claim_id,question_id,text,scope,status,claim_strength,evidence_ids,contrary_evidence_ids,gaps,safer_wording,tags,visibility,revision,created_at,updated_at)
        VALUES
          ('owner-story','claim-launch-1','question-launch-1','The guarded rollout restored the launch.','project','verified','project_fact','["evidence-launch-1"]','[]','["Confirm the exact adoption metric."]',NULL,'["reliability"]','owner_private',1,1,1);`,
    ], project);
    const started = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = started.child;
    await waitForMcpWorker(baseUrl, worker, started.readDiagnosticTail);
    client = await connectMcpClient(baseUrl, token, "behavioral-story-owner");

    const created = await call(client, "upsert_behavioral_story", storyWrite());
    assert.deepEqual(created, {
      status: "created",
      storyId: "story-launch-1",
      revision: 1,
      duplicate: false,
    });
    const exactRetry = await call(client, "upsert_behavioral_story", storyWrite());
    assert.equal(exactRetry.duplicate, true);
    assert.equal(exactRetry.revision, 1);
    const changedRetry = await callRaw(client, "upsert_behavioral_story", storyWrite(
      "story-create-1",
      0,
      { title: "Changed retry" },
    ));
    assert.equal(changedRetry.isError, true);
    assert.equal(changedRetry.structuredContent.code, "behavioral_story_operation_conflict");

    const byQuestion = await call(client, "query_behavioral_stories", { questionId: "question-launch-1" });
    assert.equal(byQuestion.stories.length, 1);
    assert.equal(byQuestion.stories[0].revision, 1);
    assert.deepEqual(byQuestion.stories[0].evidenceIds, ["evidence-launch-1"]);
    const evidencePreflight = await call(client, "query_behavioral_evidence", { questionId: "question-launch-1" });
    assert.equal(evidencePreflight.storyCandidates[0].storyId, "story-launch-1");
    const foundation = await call(client, "get_behavioral_foundation_status", {});
    assert.equal(foundation.capabilities.storyBank, "available");
    assert.equal(foundation.stories.active, 1);
    assert.equal(foundation.stories.recent[0].title, "Recovered a stalled launch");

    const revised = await call(client, "upsert_behavioral_story", storyWrite(
      "story-revise-2",
      1,
      { result: "The launch resumed and the rollback remained unused." },
    ));
    assert.equal(revised.status, "revised");
    assert.equal(revised.revision, 2);
    const historical = await call(client, "query_behavioral_stories", {
      storyId: "story-launch-1",
      revision: 1,
      includeArchived: true,
    });
    assert.equal(historical.stories[0].result, "The launch resumed without another regression.");
    const stale = await callRaw(client, "upsert_behavioral_story", storyWrite(
      "story-stale-revision",
      1,
      { learning: "This write is stale." },
    ));
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.code, "behavioral_story_revision_conflict");

    otherClient = await connectMcpClient(baseUrl, otherToken, "behavioral-story-other");
    const isolated = await call(otherClient, "query_behavioral_stories", {
      storyId: "story-launch-1",
      includeArchived: true,
    });
    assert.deepEqual(isolated.stories, []);

    const contenders = await Promise.all([
      callRaw(client, "upsert_behavioral_story", storyWrite("story-race-a", 2, { learning: "Race A." })),
      callRaw(client, "upsert_behavioral_story", storyWrite("story-race-b", 2, { learning: "Race B." })),
    ]);
    assert.equal(contenders.filter((result) => !result.isError).length, 1);
    assert.equal(contenders.filter((result) => result.isError
      && result.structuredContent.code === "behavioral_story_revision_conflict").length, 1);
  } finally {
    await client?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    await stopMcpWorker(worker);
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

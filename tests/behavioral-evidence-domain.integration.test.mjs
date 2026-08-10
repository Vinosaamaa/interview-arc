import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const MAX_WORKER_LOG_CHARS = 20_000;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error
        ? reject(error)
        : resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

async function waitForWorker(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local MCP Worker exited ${child.exitCode} before startup.`);
    try {
      const response = await fetch(`${baseUrl}/mcp`);
      if (response.status === 401 || response.status === 405) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local MCP Worker did not start.");
}

async function connect(baseUrl, token, name) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent;
}

const callRaw = (client, name, args) => client.callTool({ name, arguments: args });

async function waitForJobs(client, jobIds) {
  let latest = [];
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await call(client, "get_specialist_write_status", { jobIds });
    latest = result.jobs;
    if (result.jobs.every((job) => job.status === "saved" || job.status === "failed")) return result.jobs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Behavioral evidence writes did not settle: ${JSON.stringify(latest)}`);
}

test("owner-private evidence and claim state survive reconnect into bounded behavioral preflight", { timeout: 90_000 }, async () => {
  const ownerToken = "ia_behavioral_evidence_owner_integration_token";
  const otherToken = "ia_behavioral_evidence_other_integration_token";
  let releaseIntegrationLock;
  let persistence;
  let worker;
  let ownerClient;
  let otherClient;
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-behavioral-evidence-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(ownerToken)}','owner-behavioral-evidence','Owner evidence integration',1,NULL,NULL),
        ('${sha256(otherToken)}','other-behavioral-evidence','Other evidence integration',1,NULL,NULL);
      INSERT INTO practice_transcript_turns
        (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
      VALUES
        ('owner-behavioral-evidence','activity-behavioral-1','turn-behavioral-owner-1','behavioral','user','I personally designed the retry boundary for the project.','codex',1,1786291200000,1786291200000),
        ('other-behavioral-evidence','activity-behavioral-other','turn-behavioral-other-1','behavioral','user','I owned a different project decision.','codex',1,1786291201000,1786291201000);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let workerLog = "";
    const appendWorkerLog = (chunk) => {
      workerLog = `${workerLog}${chunk}`.slice(-MAX_WORKER_LOG_CHARS);
    };
    worker.stdout.on("data", appendWorkerLog);
    worker.stderr.on("data", appendWorkerLog);
    await waitForWorker(baseUrl, worker);
    ownerClient = await connect(baseUrl, ownerToken, "behavioral-evidence-owner");

    const evidenceInput = {
      operationId: "behavioral-evidence-operation-1",
      evidence: {
        evidenceId: "evidence-owner-statement-1",
        projectKey: "example-project",
        origin: "user_statement",
        statement: "I personally designed the retry boundary for the project.",
        evidenceGrade: "E1",
        attributionGrade: "A3",
        claimStrength: "personal_contribution_candidate",
        candidateState: "accepted",
        safeProvenance: [{ kind: "conversation", reference: "behavioral-confirmation-1" }],
        supports: ["The owner confirms the scoped design contribution."],
        limitations: ["No production outcome is established."],
        tags: ["ownership", "reliability"],
        ownerAttestation: {
          activityId: "activity-behavioral-1",
          userTurnId: "turn-behavioral-owner-1",
          confirmedAt: 1_786_291_200_000,
        },
      },
      questionLink: { questionId: "question-behavioral-1", relevance: "supporting" },
    };
    const queuedEvidence = await call(ownerClient, "upsert_behavioral_evidence_item", evidenceInput);
    const [savedEvidence] = await waitForJobs(ownerClient, [evidenceInput.operationId]);
    assert.equal(queuedEvidence.jobId, evidenceInput.operationId);
    assert.equal(savedEvidence.status, "saved", workerLog);

    const concurrentEvidence = {
      ...evidenceInput,
      evidence: {
        ...evidenceInput.evidence,
        evidenceId: "evidence-concurrent-identical",
        attributionGrade: "A0",
        ownerAttestation: undefined,
        statement: "Two independent receipts may preserve one identical evidence identity.",
      },
      questionLink: { questionId: "question-concurrent-identical", relevance: "supporting" },
    };
    const concurrentOperations = [
      { ...concurrentEvidence, operationId: "behavioral-evidence-concurrent-a" },
      { ...concurrentEvidence, operationId: "behavioral-evidence-concurrent-b" },
    ];
    await Promise.all(concurrentOperations.map((input) => call(
      ownerClient,
      "upsert_behavioral_evidence_item",
      input,
    )));
    const concurrentReceipts = await waitForJobs(
      ownerClient,
      concurrentOperations.map((input) => input.operationId),
    );
    assert.deepEqual(concurrentReceipts.map((receipt) => receipt.status), ["saved", "saved"]);
    assert.deepEqual(
      concurrentReceipts.map((receipt) => receipt.result.status).sort(),
      ["inserted", "unchanged"],
    );
    const concurrentRead = await call(ownerClient, "query_behavioral_evidence", {
      questionId: concurrentEvidence.questionLink.questionId,
    });
    assert.deepEqual(
      concurrentRead.supportingEvidence.map((item) => item.evidenceId),
      [concurrentEvidence.evidence.evidenceId],
    );

    const claimInput = {
      operationId: "behavioral-claim-operation-1",
      expectedRevision: 0,
      claim: {
        claimId: "claim-owner-design-1",
        questionId: "question-behavioral-1",
        text: "I personally designed the retry boundary for the project.",
        scope: "personal_contribution",
        status: "verified",
        claimStrength: "personal_contribution_candidate",
        evidenceIds: [evidenceInput.evidence.evidenceId],
        contraryEvidenceIds: [],
        gaps: ["Production outcome remains unverified."],
        saferWording: "I designed the retry boundary; production impact is not yet established.",
        tags: ["ownership", "reliability"],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", claimInput);
    const [savedClaim] = await waitForJobs(ownerClient, [claimInput.operationId]);
    assert.equal(savedClaim.status, "saved", workerLog);

    await ownerClient.close();
    ownerClient = await connect(baseUrl, ownerToken, "behavioral-evidence-owner-reconnected");
    const preflight = await call(ownerClient, "query_behavioral_evidence", {
      questionId: "question-behavioral-1",
    });
    assert.deepEqual(preflight.supportingEvidence.map((item) => item.evidenceId), [
      evidenceInput.evidence.evidenceId,
    ]);
    assert.deepEqual(preflight.claims.map((item) => [item.claimId, item.status]), [
      [claimInput.claim.claimId, "verified"],
    ]);
    assert.deepEqual(preflight.gaps, [{
      claimId: claimInput.claim.claimId,
      text: "Production outcome remains unverified.",
    }]);
    assert.deepEqual(preflight.storyCandidates, []);

    const foundation = await call(ownerClient, "get_behavioral_foundation_status", {});
    assert.deepEqual(foundation.evidence, {
      total: 2,
      accepted: 2,
      pending: 0,
      rejected: 0,
      superseded: 0,
      projects: 1,
      sourceRevisions: 0,
    });
    assert.deepEqual(foundation.claims, {
      total: 1,
      unverified: 0,
      partial: 0,
      verified: 1,
      contradicted: 0,
      questions: 1,
    });
    assert.deepEqual(foundation.gaps, [{
      claimId: claimInput.claim.claimId,
      questionId: claimInput.claim.questionId,
      text: "Production outcome remains unverified.",
    }]);
    assert.deepEqual(foundation.capabilities, {
      evidenceRead: "available",
      sourceRegistry: "not_available",
      storyBank: "not_available",
      resumeLibrary: "available",
    });

    const overflowClaimValues = Array.from({ length: 50 }, (_, index) => `
      ('owner-behavioral-evidence','claim-overflow-${index}','question-overflow-${index}',
       'Synthetic read-model coverage claim ${index}.','project','unverified','unsupported',
       '[]','[]','[]',NULL,'[]','owner_private',1,1900000000000,1900000000000)
    `).join(",");
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO behavioral_claims
        (owner_id,claim_id,question_id,text,scope,status,claim_strength,evidence_ids,
         contrary_evidence_ids,gaps,safer_wording,tags,visibility,revision,created_at,updated_at)
      VALUES ${overflowClaimValues};
    `]);
    const overLimitFoundation = await call(ownerClient, "get_behavioral_foundation_status", {});
    assert.equal(overLimitFoundation.claims.questions, 51);
    assert.equal(overLimitFoundation.questionCoverage.length, 51);
    assert.deepEqual(
      overLimitFoundation.questionCoverage.find(({ questionId }) => questionId === claimInput.claim.questionId),
      {
        questionId: claimInput.claim.questionId,
        claims: 1,
        verified: 1,
        contradicted: 0,
        gaps: 1,
      },
    );
    assert.equal(overLimitFoundation.truncated.claimDetails, true);

    const revisedClaimInput = {
      ...claimInput,
      operationId: "behavioral-claim-operation-2",
      expectedRevision: 1,
      claim: {
        ...claimInput.claim,
        gaps: [
          "Production outcome remains unverified.",
          "The rollout date remains unverified.",
        ],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", revisedClaimInput);
    const [revisedClaim] = await waitForJobs(ownerClient, [revisedClaimInput.operationId]);
    assert.equal(revisedClaim.status, "saved");
    assert.equal(revisedClaim.result.revision, 2);
    const revisedPreflight = await call(ownerClient, "query_behavioral_evidence", {
      questionId: "question-behavioral-1",
    });
    assert.equal(revisedPreflight.claims[0].revision, 2);
    assert.deepEqual(revisedPreflight.gaps.map((gap) => gap.text), revisedClaimInput.claim.gaps);

    const exactClaimReplay = await call(ownerClient, "set_behavioral_claim_status", claimInput);
    assert.equal(exactClaimReplay.status, "saved");
    assert.equal(exactClaimReplay.duplicate, true);
    assert.equal(exactClaimReplay.result.revision, 1);
    const changedClaimReplay = await callRaw(ownerClient, "set_behavioral_claim_status", {
      ...claimInput,
      claim: { ...claimInput.claim, gaps: ["Changed retry content."] },
    });
    assert.equal(changedClaimReplay.isError, true);
    assert.equal(changedClaimReplay.structuredContent.code, "specialist_write_identity_conflict");

    const staleClaimInput = {
      ...revisedClaimInput,
      operationId: "behavioral-claim-operation-stale",
      expectedRevision: 1,
      claim: { ...revisedClaimInput.claim, gaps: ["A stale checkpoint must not win."] },
    };
    await call(ownerClient, "set_behavioral_claim_status", staleClaimInput);
    const [failedStaleClaim] = await waitForJobs(ownerClient, [staleClaimInput.operationId]);
    assert.equal(failedStaleClaim.status, "failed");
    assert.equal(failedStaleClaim.failure.code, "behavioral_claim_revision_conflict");

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      UPDATE specialist_write_jobs
      SET status='queued', next_attempt_at=0, lease_expires_at=NULL,
          result=NULL, completed_at=NULL, updated_at=0
      WHERE owner_id='owner-behavioral-evidence'
        AND job_id='behavioral-claim-operation-1';
    `]);
    const replayTrigger = {
      operationId: "behavioral-evidence-operation-replay-trigger",
      evidence: {
        evidenceId: "evidence-replay-trigger",
        projectKey: "example-project",
        origin: "user_statement",
        statement: "This benign item triggers the reclaimed write executor.",
        evidenceGrade: "E1",
        attributionGrade: "A0",
        claimStrength: "user_confirmation_required",
        candidateState: "pending",
        safeProvenance: [{ kind: "conversation", reference: "replay-trigger-1" }],
        supports: [],
        limitations: ["Executor trigger only."],
        tags: ["integration"],
      },
      questionLink: { questionId: "question-replay-trigger", relevance: "supporting" },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", replayTrigger);
    const [replayedOriginal, savedTrigger] = await waitForJobs(ownerClient, [
      claimInput.operationId,
      replayTrigger.operationId,
    ]);
    assert.equal(replayedOriginal.status, "saved");
    assert.equal(replayedOriginal.result.revision, 1);
    assert.equal(savedTrigger.status, "saved");
    const afterLeaseReplay = await call(ownerClient, "query_behavioral_evidence", {
      questionId: "question-behavioral-1",
    });
    assert.equal(afterLeaseReplay.claims[0].revision, 2);
    assert.deepEqual(afterLeaseReplay.gaps.map((gap) => gap.text), revisedClaimInput.claim.gaps);

    const immutableClaimRewrite = {
      ...claimInput,
      operationId: "behavioral-claim-operation-immutable-rewrite",
      expectedRevision: 2,
      claim: { ...claimInput.claim, text: "Changed immutable claim text." },
    };
    await call(ownerClient, "set_behavioral_claim_status", immutableClaimRewrite);
    const [failedClaimRewrite] = await waitForJobs(ownerClient, [immutableClaimRewrite.operationId]);
    assert.equal(failedClaimRewrite.status, "failed");
    assert.equal(failedClaimRewrite.failure.code, "behavioral_claim_identity_conflict");

    otherClient = await connect(baseUrl, otherToken, "behavioral-evidence-other");
    const isolated = await call(otherClient, "query_behavioral_evidence", {
      questionId: "question-behavioral-1",
    });
    assert.deepEqual(isolated.supportingEvidence, []);
    assert.deepEqual(isolated.claims, []);
    const isolatedFoundation = await call(otherClient, "get_behavioral_foundation_status", {});
    assert.equal(isolatedFoundation.evidence.total, 0);
    assert.equal(isolatedFoundation.claims.total, 0);
    assert.deepEqual(isolatedFoundation.gaps, []);

    const exactReplay = await call(ownerClient, "upsert_behavioral_evidence_item", evidenceInput);
    assert.equal(exactReplay.status, "saved");
    assert.equal(exactReplay.duplicate, true);
    const changedReplay = await callRaw(ownerClient, "upsert_behavioral_evidence_item", {
      ...evidenceInput,
      evidence: { ...evidenceInput.evidence, statement: "Changed retry content." },
    });
    assert.equal(changedReplay.isError, true);
    assert.equal(changedReplay.structuredContent.code, "specialist_write_identity_conflict");

    const immutableRewrite = {
      ...evidenceInput,
      operationId: "behavioral-evidence-operation-immutable-rewrite",
      evidence: { ...evidenceInput.evidence, statement: "Changed immutable evidence content." },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", immutableRewrite);
    const [failedRewrite] = await waitForJobs(ownerClient, [immutableRewrite.operationId]);
    assert.equal(failedRewrite.status, "failed");
    assert.equal(failedRewrite.failure.code, "behavioral_evidence_identity_conflict");

    const unsafeOperationId = "behavioral-evidence-operation-unsafe";
    const unsafeWrite = await callRaw(ownerClient, "upsert_behavioral_evidence_item", {
      ...evidenceInput,
      operationId: unsafeOperationId,
      evidence: {
        ...evidenceInput.evidence,
        evidenceId: "evidence-unsafe-1",
        statement: "The source is under /Users/example/private-project/.",
      },
    });
    assert.equal(unsafeWrite.isError, true);
    assert.equal(unsafeWrite.structuredContent.code, "behavioral_evidence_unsafe_payload");
    const unsafeReceipt = await callRaw(ownerClient, "get_specialist_write_status", {
      jobIds: [unsafeOperationId],
    });
    assert.equal(unsafeReceipt.isError, true);
    assert.equal(unsafeReceipt.structuredContent.code, "specialist_write_not_found");

    const pendingInput = {
      ...evidenceInput,
      operationId: "behavioral-evidence-operation-pending",
      evidence: {
        ...evidenceInput.evidence,
        evidenceId: "evidence-pending-1",
        attributionGrade: "A0",
        candidateState: "pending",
        ownerAttestation: undefined,
        statement: "A generated hypothesis awaits owner review.",
      },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", pendingInput);
    const [savedPending] = await waitForJobs(ownerClient, [pendingInput.operationId]);
    assert.equal(savedPending.status, "saved");
    const withoutPending = await call(ownerClient, "query_behavioral_evidence", {
      questionId: "question-behavioral-1",
    });
    assert.deepEqual(withoutPending.supportingEvidence.map((item) => item.evidenceId), [
      evidenceInput.evidence.evidenceId,
    ]);

    const missingAttestation = await callRaw(ownerClient, "upsert_behavioral_evidence_item", {
      ...evidenceInput,
      operationId: "behavioral-evidence-operation-missing-attestation",
      evidence: {
        ...evidenceInput.evidence,
        evidenceId: "evidence-missing-attestation",
        ownerAttestation: undefined,
      },
    });
    assert.equal(missingAttestation.isError, true);
    assert.equal(missingAttestation.structuredContent.code, "behavioral_evidence_owner_attestation_required");

    const crossOwnerAttestation = {
      ...evidenceInput,
      operationId: "behavioral-evidence-operation-cross-owner-attestation",
      evidence: {
        ...evidenceInput.evidence,
        evidenceId: "evidence-cross-owner-attestation",
        statement: "I owned a different project decision.",
        ownerAttestation: {
          activityId: "activity-behavioral-other",
          userTurnId: "turn-behavioral-other-1",
          confirmedAt: 1_786_291_201_000,
        },
      },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", crossOwnerAttestation);
    const [failedCrossOwnerAttestation] = await waitForJobs(ownerClient, [crossOwnerAttestation.operationId]);
    assert.equal(failedCrossOwnerAttestation.status, "failed");
    assert.equal(failedCrossOwnerAttestation.failure.code, "behavioral_evidence_owner_attestation_not_found");

    const projectEvidenceInput = {
      operationId: "behavioral-evidence-operation-project-e2",
      evidence: {
        evidenceId: "evidence-project-e2",
        projectKey: "example-project",
        origin: "document",
        statement: "The project documentation describes a retry boundary.",
        sourceRevision: "document-revision-1",
        evidenceGrade: "E2",
        attributionGrade: "A0",
        claimStrength: "project_fact",
        candidateState: "accepted",
        safeProvenance: [{ kind: "document_observation", reference: "architecture-note-1" }],
        supports: ["The design is documented."],
        limitations: ["Implementation is not established."],
        tags: ["reliability"],
      },
      questionLink: { questionId: "question-project-fact", relevance: "supporting" },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", projectEvidenceInput);
    await waitForJobs(ownerClient, [projectEvidenceInput.operationId]);
    const projectClaimInput = {
      operationId: "behavioral-claim-operation-project-e2",
      expectedRevision: 0,
      claim: {
        claimId: "claim-project-e2",
        questionId: "question-project-fact",
        text: "The project implements a retry boundary.",
        scope: "project",
        status: "verified",
        claimStrength: "project_fact",
        evidenceIds: [projectEvidenceInput.evidence.evidenceId],
        contraryEvidenceIds: [],
        gaps: [],
        tags: ["reliability"],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", projectClaimInput);
    const [failedProjectClaim] = await waitForJobs(ownerClient, [projectClaimInput.operationId]);
    assert.equal(failedProjectClaim.status, "failed");
    assert.equal(failedProjectClaim.failure.code, "behavioral_claim_e3_required");

    const otherProjectEvidenceInput = {
      ...projectEvidenceInput,
      operationId: "behavioral-evidence-operation-other-project-e3",
      evidence: {
        ...projectEvidenceInput.evidence,
        evidenceId: "evidence-other-project-e3",
        projectKey: "other-project",
        statement: "A different project implements a retry boundary.",
        sourceRevision: "other-project-revision-1",
        evidenceGrade: "E3",
        safeProvenance: [{ kind: "document_observation", reference: "other-architecture-note-1" }],
      },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", otherProjectEvidenceInput);
    await waitForJobs(ownerClient, [otherProjectEvidenceInput.operationId]);
    const mixedProjectClaimInput = {
      ...projectClaimInput,
      operationId: "behavioral-claim-operation-mixed-projects",
      claim: {
        ...projectClaimInput.claim,
        claimId: "claim-mixed-projects",
        evidenceIds: [
          projectEvidenceInput.evidence.evidenceId,
          otherProjectEvidenceInput.evidence.evidenceId,
        ],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", mixedProjectClaimInput);
    const [failedMixedProjectClaim] = await waitForJobs(ownerClient, [mixedProjectClaimInput.operationId]);
    assert.equal(failedMixedProjectClaim.status, "failed");
    assert.equal(failedMixedProjectClaim.failure.code, "behavioral_claim_project_mismatch");

    const generatedEvidenceInput = {
      ...projectEvidenceInput,
      operationId: "behavioral-evidence-operation-generated-secondary",
      evidence: {
        ...projectEvidenceInput.evidence,
        evidenceId: "evidence-generated-secondary",
        origin: "generated_secondary",
        statement: "A generated handout asserts that the retry boundary exists.",
        evidenceGrade: "E1",
        safeProvenance: [{ kind: "generated_secondary", reference: "generated-handout-1" }],
      },
      questionLink: { questionId: "question-generated-claim", relevance: "supporting" },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", generatedEvidenceInput);
    await waitForJobs(ownerClient, [generatedEvidenceInput.operationId]);
    const generatedClaimInput = {
      operationId: "behavioral-claim-operation-generated-secondary",
      expectedRevision: 0,
      claim: {
        ...projectClaimInput.claim,
        claimId: "claim-generated-secondary",
        questionId: "question-generated-claim",
        evidenceIds: [generatedEvidenceInput.evidence.evidenceId],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", generatedClaimInput);
    const [failedGeneratedClaim] = await waitForJobs(ownerClient, [generatedClaimInput.operationId]);
    assert.equal(failedGeneratedClaim.status, "failed");
    assert.equal(failedGeneratedClaim.failure.code, "behavioral_claim_primary_evidence_required");

    const generatedContraryInput = {
      ...generatedEvidenceInput,
      operationId: "behavioral-evidence-operation-generated-contrary",
      evidence: {
        ...generatedEvidenceInput.evidence,
        evidenceId: "evidence-generated-contrary",
        statement: "Generated prose claims the project lacks a retry boundary.",
      },
      questionLink: { questionId: "question-generated-contrary", relevance: "contrary" },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", generatedContraryInput);
    await waitForJobs(ownerClient, [generatedContraryInput.operationId]);
    const generatedContradiction = {
      operationId: "behavioral-claim-operation-generated-contrary",
      expectedRevision: 0,
      claim: {
        claimId: "claim-generated-contrary",
        questionId: "question-generated-contrary",
        text: "The project has a retry boundary.",
        scope: "project",
        status: "contradicted",
        claimStrength: "contradicted",
        evidenceIds: [],
        contraryEvidenceIds: [generatedContraryInput.evidence.evidenceId],
        gaps: [],
        tags: ["reliability"],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", generatedContradiction);
    const [failedGeneratedContradiction] = await waitForJobs(ownerClient, [generatedContradiction.operationId]);
    assert.equal(failedGeneratedContradiction.status, "failed");
    assert.equal(failedGeneratedContradiction.failure.code, "behavioral_claim_contrary_evidence_required");

    const unsupportedVerification = {
      ...claimInput,
      operationId: "behavioral-claim-operation-unsupported-verified",
      expectedRevision: 0,
      claim: {
        ...claimInput.claim,
        claimId: "claim-unsupported-verified",
        scope: "project",
        claimStrength: "unsupported",
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", unsupportedVerification);
    const [failedUnsupportedVerification] = await waitForJobs(ownerClient, [unsupportedVerification.operationId]);
    assert.equal(failedUnsupportedVerification.status, "failed");
    assert.equal(failedUnsupportedVerification.failure.code, "behavioral_claim_status_strength_conflict");

    const unresolvedContraryInput = {
      operationId: "behavioral-evidence-operation-unresolved-contrary",
      evidence: {
        evidenceId: "evidence-unresolved-contrary",
        projectKey: "example-project",
        origin: "user_statement",
        statement: "The personal ownership statement remains disputed.",
        evidenceGrade: "E1",
        attributionGrade: "A0",
        claimStrength: "contradicted",
        candidateState: "accepted",
        safeProvenance: [{ kind: "conversation", reference: "contrary-confirmation-1" }],
        supports: ["A live contradiction remains."],
        limitations: ["The contradiction is not yet resolved."],
        tags: ["contradiction"],
      },
      questionLink: { questionId: "question-behavioral-1", relevance: "contrary" },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", unresolvedContraryInput);
    await waitForJobs(ownerClient, [unresolvedContraryInput.operationId]);
    const verifyWithContrary = {
      ...revisedClaimInput,
      operationId: "behavioral-claim-operation-unresolved-contrary",
      expectedRevision: 2,
      claim: {
        ...revisedClaimInput.claim,
        contraryEvidenceIds: [unresolvedContraryInput.evidence.evidenceId],
      },
    };
    await call(ownerClient, "set_behavioral_claim_status", verifyWithContrary);
    const [failedVerifyWithContrary] = await waitForJobs(ownerClient, [verifyWithContrary.operationId]);
    assert.equal(failedVerifyWithContrary.status, "failed");
    assert.equal(failedVerifyWithContrary.failure.code, "behavioral_claim_unresolved_contrary_evidence");

    const personalSourceInput = {
      operationId: "behavioral-evidence-operation-personal-source",
      evidence: {
        evidenceId: "evidence-personal-source",
        projectKey: "example-project",
        origin: "code_observation",
        statement: "A retry boundary exists in the inspected source.",
        sourceRevision: "source-revision-1",
        evidenceGrade: "E3",
        attributionGrade: "A2",
        claimStrength: "personal_contribution_candidate",
        candidateState: "accepted",
        safeProvenance: [{ kind: "repository_observation", reference: "repository-observation-1" }],
        supports: ["The project behavior exists."],
        limitations: ["Source does not prove personal authority."],
        tags: ["reliability"],
      },
      questionLink: { questionId: "question-personal-authority", relevance: "supporting" },
    };
    await call(ownerClient, "upsert_behavioral_evidence_item", personalSourceInput);
    await waitForJobs(ownerClient, [personalSourceInput.operationId]);
    const personalClaims = ["ownership", "decision", "leadership"].map((scope) => ({
        operationId: `behavioral-claim-operation-${scope}`,
        expectedRevision: 0,
        claim: {
          claimId: `claim-personal-${scope}`,
          questionId: "question-personal-authority",
          text: `I established the ${scope} for the retry boundary.`,
          scope,
          status: "verified",
          claimStrength: "personal_contribution_candidate",
          evidenceIds: [personalSourceInput.evidence.evidenceId],
          contraryEvidenceIds: [],
          gaps: [],
          tags: [scope],
        },
      }));
    await Promise.all(personalClaims.map((input) => call(ownerClient, "set_behavioral_claim_status", input)));
    const failedPersonalClaims = await waitForJobs(
      ownerClient,
      personalClaims.map((input) => input.operationId),
    );
    for (const failedPersonalClaim of failedPersonalClaims) {
      assert.equal(failedPersonalClaim.status, "failed");
      assert.equal(failedPersonalClaim.failure.code, "behavioral_claim_a3_required");
    }

    const otherClaimInput = {
      ...claimInput,
      operationId: "behavioral-claim-operation-other-owner",
      claim: { ...claimInput.claim, claimId: "claim-other-owner-1" },
    };
    await call(otherClient, "set_behavioral_claim_status", otherClaimInput);
    const [failedOtherClaim] = await waitForJobs(otherClient, [otherClaimInput.operationId]);
    assert.equal(failedOtherClaim.status, "failed");
    assert.equal(failedOtherClaim.failure.code, "behavioral_claim_evidence_missing");

    const boundedWrites = Array.from({ length: 11 }, (_, index) => ({
      operationId: `behavioral-evidence-operation-bounded-${String(index).padStart(2, "0")}`,
      evidence: {
        evidenceId: `evidence-bounded-${String(index).padStart(2, "0")}`,
        projectKey: "example-project",
        origin: "user_statement",
        statement: `Accepted bounded evidence ${index}.`,
        evidenceGrade: "E1",
        attributionGrade: "A0",
        claimStrength: "user_confirmation_required",
        candidateState: "accepted",
        safeProvenance: [{ kind: "conversation", reference: `bounded-fixture-${index}` }],
        supports: [`Bounded support ${index}.`],
        limitations: ["Fixture only."],
        tags: ["bounded"],
      },
      questionLink: { questionId: "question-bounded", relevance: "supporting" },
    }));
    for (let start = 0; start < boundedWrites.length; start += 5) {
      const batch = boundedWrites.slice(start, start + 5);
      await Promise.all(batch.map((input) => call(
        ownerClient,
        "upsert_behavioral_evidence_item",
        input,
      )));
      const batchJobs = await waitForJobs(ownerClient, batch.map((input) => input.operationId));
      assert.equal(batchJobs.every((job) => job.status === "saved"), true, workerLog);
    }
    const bounded = await call(ownerClient, "query_behavioral_evidence", {
      questionId: "question-bounded",
    });
    assert.equal(bounded.supportingEvidence.length, 10);
    assert.equal(bounded.truncated.supportingEvidence, true);
    assert.deepEqual(bounded.supportingEvidence.map((item) => item.evidenceId),
      boundedWrites.slice(0, 10).map((input) => input.evidence.evidenceId));

    const boundedClaims = Array.from({ length: 11 }, (_, index) => ({
      operationId: `behavioral-claim-operation-bounded-${String(index).padStart(2, "0")}`,
      expectedRevision: 0,
      claim: {
        claimId: `claim-bounded-${String(index).padStart(2, "0")}`,
        questionId: "question-bounded-claims",
        text: `Bounded unverified claim ${index}.`,
        scope: "project",
        status: "unverified",
        claimStrength: "user_confirmation_required",
        evidenceIds: [],
        contraryEvidenceIds: [],
        gaps: index === 10 ? ["This omitted claim still has an open gap."] : [],
        tags: ["bounded"],
      },
    }));
    for (let start = 0; start < boundedClaims.length; start += 5) {
      const batch = boundedClaims.slice(start, start + 5);
      await Promise.all(batch.map((input) => call(ownerClient, "set_behavioral_claim_status", input)));
      const batchJobs = await waitForJobs(ownerClient, batch.map((input) => input.operationId));
      assert.equal(batchJobs.every((job) => job.status === "saved"), true, workerLog);
    }
    const boundedClaimRead = await call(ownerClient, "query_behavioral_evidence", {
      questionId: "question-bounded-claims",
    });
    assert.equal(boundedClaimRead.claims.length, 10);
    assert.equal(boundedClaimRead.truncated.claims, true);
    assert.equal(boundedClaimRead.truncated.gaps, true);
  } finally {
    await ownerClient?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

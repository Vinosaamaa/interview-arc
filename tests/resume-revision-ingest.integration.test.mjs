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
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
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

async function waitForWorker(baseUrl, child, readWorkerLog) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Local MCP Worker exited ${child.exitCode} before startup.\n${readWorkerLog()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/mcp`);
      if (response.status === 401 || response.status === 405) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local MCP Worker did not start.\n${readWorkerLog()}`);
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

function resumeImportForm(overrides = {}) {
  const docxBytes = overrides.docxBytes ?? new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const pdfBytes = overrides.pdfBytes ?? new TextEncoder().encode("%PDF-1.7\n% private fixture\n%%EOF");
  const form = new FormData();
  form.set("operationId", overrides.operationId ?? "resume-import-operation-1");
  form.set("resumeId", overrides.resumeId ?? "primary-resume");
  form.set("revisionId", overrides.revisionId ?? "resume-revision-1");
  form.set("sourceLabel", overrides.sourceLabel ?? "Primary resume");
  const sourceFingerprint = overrides.sourceFingerprint ?? sha256("opaque-source-revision-1");
  form.set("sourceFingerprint", sourceFingerprint);
  if (overrides.manifest !== false) {
    const manifest = overrides.manifest ?? {
      schemaVersion: 1,
      sourceProvider: "local_file",
      sourceRevisionFingerprint: sourceFingerprint,
      extractionVersion: "resume-extract-v1",
      capturedAt: 1_786_505_200_000,
      bullets: [{
        occurrenceId: "experience-0",
        sectionLabel: "Experience",
        ordinal: 0,
        text: "Designed and operated a reliable service.",
        contentFingerprint: sha256("Designed and operated a reliable service."),
        claimIds: [],
        evidenceIds: [],
      }],
    };
    form.set("manifest", JSON.stringify(manifest));
  }
  form.set("docx", new File([docxBytes], "resume.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  form.set("pdf", new File([pdfBytes], "resume.pdf", { type: "application/pdf" }));
  return { form, docxBytes, pdfBytes };
}

async function postResumeImport(baseUrl, token, overrides = {}) {
  const response = await fetch(`${baseUrl}/resume/imports`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: resumeImportForm(overrides).form,
  });
  return { response, body: await response.json() };
}

async function deleteResumeFiles(baseUrl, token, resumeId, revisionId, body) {
  const response = await fetch(`${baseUrl}/resume/files/${resumeId}/${revisionId}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("an authenticated staged DOCX/PDF pair becomes one immutable current resume revision", { timeout: 180_000 }, async () => {
  const ownerToken = "ia_resume_revision_owner_integration_token";
  let releaseIntegrationLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-resume-ingest-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    const otherToken = "ia_resume_revision_other_owner_integration_token";
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(ownerToken)}','owner-resume-ingest','Resume ingest integration',1,NULL,NULL),
        ('${sha256(otherToken)}','owner-resume-other','Other resume integration',1,NULL,NULL);
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
    await waitForWorker(baseUrl, worker, () => workerLog);
    client = await connect(baseUrl, ownerToken, "resume-ingest-owner");

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      CREATE TRIGGER fail_transient_resume_insert
      BEFORE INSERT ON resume_sources
      WHEN NEW.resume_id = 'transient-resume'
      BEGIN
        SELECT RAISE(FAIL, 'synthetic transient');
      END;
    `]);
    const transientInput = {
      operationId: "resume-import-transient-operation",
      resumeId: "transient-resume",
      revisionId: "transient-revision-1",
      sourceFingerprint: sha256("opaque-transient-source-revision"),
    };
    const transientFailure = await postResumeImport(baseUrl, ownerToken, transientInput);
    assert.equal(transientFailure.response.status, 503);
    assert.equal(transientFailure.body.code, "resume_import_unavailable");
    const failedStatus = await call(client, "get_resume_import_status", {
      operationId: transientInput.operationId,
    });
    assert.equal(failedStatus.import.status, "retryable_failure");
    assert.equal(failedStatus.import.retryable, true);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", "DROP TRIGGER fail_transient_resume_insert;"]);
    const transientRetry = await postResumeImport(baseUrl, ownerToken, transientInput);
    assert.equal(transientRetry.response.status, 201, JSON.stringify(transientRetry.body));
    assert.equal(transientRetry.body.status, "saved");

    const { docxBytes, pdfBytes } = resumeImportForm();
    const { response, body: imported } = await postResumeImport(baseUrl, ownerToken);
    assert.equal(response.status, 201, `${JSON.stringify(imported)}\n${workerLog}`);
    assert.equal(imported.status, "saved");
    assert.equal(imported.resumeId, "primary-resume");
    assert.equal(imported.revisionId, "resume-revision-1");
    assert.equal(imported.parentRevisionId, null);
    assert.equal(imported.sourceFingerprint, sha256("opaque-source-revision-1"));
    assert.equal(imported.sourceProvider, "local_file");
    assert.equal(imported.sourceRevisionFingerprint, sha256("opaque-source-revision-1"));
    assert.equal(imported.extractionVersion, "resume-extract-v1");
    assert.equal(imported.bulletCount, 1);
    assert.equal(Number.isInteger(imported.importedAt), true);
    assert.equal(imported.currentRevisionId, "resume-revision-1");
    assert.equal(imported.files.docx.sha256, sha256(docxBytes));
    assert.equal(imported.files.pdf.sha256, sha256(pdfBytes));
    assert.equal(JSON.stringify(imported).includes("objectKey"), false);

    const status = await call(client, "get_resume_import_status", {
      operationId: "resume-import-operation-1",
    });
    assert.equal(status.found, true);
    assert.equal(status.import.status, "saved");
    assert.equal(status.import.currentRevisionId, "resume-revision-1");
    assert.equal(status.import.bulletCount, 1);
    assert.deepEqual(status.import.files.map((file) => file.format), ["docx", "pdf"]);
    assert.equal(JSON.stringify(status).includes("objectKey"), false);
    assert.equal(JSON.stringify(status).includes("owner-resume-ingest"), false);

    const exactRetry = await postResumeImport(baseUrl, ownerToken);
    assert.equal(exactRetry.response.status, 200);
    assert.deepEqual(exactRetry.body, imported);

    const changedRetry = await postResumeImport(baseUrl, ownerToken, { sourceLabel: "Changed label" });
    assert.equal(changedRetry.response.status, 409);
    assert.equal(changedRetry.body.code, "resume_import_operation_conflict");

    otherClient = await connect(baseUrl, otherToken, "resume-ingest-other-owner");
    const isolated = await call(otherClient, "get_resume_import_status", {
      operationId: "resume-import-operation-1",
    });
    assert.deepEqual(isolated, { found: false });

    const { response: unchangedResponse, body: unchanged } = await postResumeImport(
      baseUrl,
      ownerToken,
      {
        operationId: "resume-import-operation-2",
        revisionId: "resume-revision-2",
      },
    );
    assert.equal(unchangedResponse.status, 200, JSON.stringify(unchanged));
    assert.equal(unchanged.status, "saved");
    assert.equal(unchanged.unchanged, true);
    assert.equal(unchanged.revisionId, "resume-revision-1");
    assert.equal(unchanged.currentRevisionId, "resume-revision-1");

    const unchangedStatus = await call(client, "get_resume_import_status", {
      operationId: "resume-import-operation-2",
    });
    assert.equal(unchangedStatus.import.status, "saved");
    assert.equal(unchangedStatus.import.unchanged, true);
    assert.equal(unchangedStatus.import.revisionId, "resume-revision-1");

    const newDocxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x01]);
    const newPdfBytes = new TextEncoder().encode("%PDF-1.7\n% second private fixture\n%%EOF");
    const { response: nextResponse, body: next } = await postResumeImport(
      baseUrl,
      ownerToken,
      {
        operationId: "resume-import-operation-3",
        revisionId: "resume-revision-3",
        sourceFingerprint: sha256("opaque-source-revision-3"),
        docxBytes: newDocxBytes,
        pdfBytes: newPdfBytes,
      },
    );
    assert.equal(nextResponse.status, 201, JSON.stringify(next));
    assert.equal(next.revisionId, "resume-revision-3");
    assert.equal(next.parentRevisionId, "resume-revision-1");
    assert.equal(next.currentRevisionId, "resume-revision-3");
    assert.equal(next.files.docx.sha256, sha256(newDocxBytes));
    assert.equal(next.files.pdf.sha256, sha256(newPdfBytes));

    const nextStatus = await call(client, "get_resume_import_status", {
      operationId: "resume-import-operation-3",
    });
    assert.equal(nextStatus.import.parentRevisionId, "resume-revision-1");
    assert.equal(nextStatus.import.sourceFingerprint, sha256("opaque-source-revision-3"));
    assert.equal(nextStatus.import.currentRevisionId, "resume-revision-3");

    const exactRevision = await call(client, "get_resume_revision", {
      resumeId: "primary-resume",
      revisionId: "resume-revision-3",
    });
    assert.equal(exactRevision.found, true);
    assert.equal(exactRevision.revision.current, true);
    assert.equal(exactRevision.revision.sourceProvider, "local_file");
    assert.equal(exactRevision.revision.bullets.length, 1);
    assert.equal(exactRevision.revision.bullets[0].text, "Designed and operated a reliable service.");
    assert.deepEqual(exactRevision.revision.bullets[0].claimIds, []);
    assert.equal(/storageGeneration|objectKey|private-sources|https?:\/\//.test(JSON.stringify(exactRevision)), false);

    const baseComparison = await call(client, "compare_resume_revisions", {
      resumeId: "primary-resume",
      fromRevisionId: "resume-revision-1",
      toRevisionId: "resume-revision-3",
    });
    assert.equal(baseComparison.found, true);
    assert.deepEqual(baseComparison.summary, { added: 0, removed: 0, changed: 0, unchanged: 1 });

    const library = await call(client, "get_resume_library", {});
    assert.equal(library.schemaVersion, 1);
    assert.equal(library.sources.find((source) => source.resumeId === "primary-resume").currentRevisionId, "resume-revision-3");
    assert.deepEqual(
      library.sources.find((source) => source.resumeId === "primary-resume").revisions.map((revision) => revision.revisionId),
      ["resume-revision-3", "resume-revision-1"],
    );
    assert.equal(library.sources.every((source) => source.revisions.every((revision) => (
      revision.files.every((file) => file.downloadPath.startsWith("/api/resume-library/"))
    ))), true);
    assert.equal(/resume-private\/|storageGeneration|objectKey/.test(JSON.stringify(library)), false);

    const isolatedLibrary = await call(otherClient, "get_resume_library", {});
    assert.deepEqual(isolatedLibrary.sources, []);

    const deletionRequest = {
      operationId: "resume-file-delete-primary-r1",
      authorization: "explicit_user_instruction",
      reason: "Synthetic owner-requested retention test.",
    };
    const currentDeletion = await deleteResumeFiles(
      baseUrl,
      ownerToken,
      "primary-resume",
      "resume-revision-3",
      { ...deletionRequest, operationId: "resume-file-delete-current" },
    );
    assert.equal(currentDeletion.response.status, 409);
    assert.equal(currentDeletion.body.code, "resume_current_revision_files_protected");

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      CREATE TRIGGER fail_resume_file_deletion_receipt
      BEFORE UPDATE ON resume_revision_file_deletions
      WHEN NEW.status = 'deleted' AND NEW.revision_id = 'resume-revision-1'
      BEGIN
        SELECT RAISE(FAIL, 'synthetic deletion receipt failure');
      END;
    `]);
    const uncertainDeletion = await deleteResumeFiles(
      baseUrl,
      ownerToken,
      "primary-resume",
      "resume-revision-1",
      deletionRequest,
    );
    assert.equal(uncertainDeletion.response.status, 503);
    assert.equal(uncertainDeletion.body.code, "resume_file_deletion_commit_unavailable");
    assert.equal(uncertainDeletion.body.retryable, true);
    const deletingRevision = await call(client, "get_resume_revision", {
      resumeId: "primary-resume",
      revisionId: "resume-revision-1",
    });
    assert.equal(deletingRevision.revision.files.every((file) => file.downloadPath === null), true);
    assert.equal(deletingRevision.revision.files.every((file) => file.retention.state === "retryable_failure"), true);
    const deletionInProgressDownload = await fetch(`${baseUrl}/resume/files/primary-resume/resume-revision-1/pdf`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(deletionInProgressDownload.status, 503);

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", "DROP TRIGGER fail_resume_file_deletion_receipt;"]);
    const deleted = await deleteResumeFiles(
      baseUrl,
      ownerToken,
      "primary-resume",
      "resume-revision-1",
      deletionRequest,
    );
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.status, "deleted");
    assert.deepEqual(deleted.body.deletedFormats, ["docx", "pdf"]);
    assert.equal(deleted.body.duplicate, false);
    assert.deepEqual(deleted.body.preserved, ["revision", "integrity", "wording", "semantic_links", "activity_context"]);

    const deletionRetry = await deleteResumeFiles(
      baseUrl,
      ownerToken,
      "primary-resume",
      "resume-revision-1",
      deletionRequest,
    );
    assert.equal(deletionRetry.response.status, 200);
    assert.equal(deletionRetry.body.duplicate, true);
    assert.equal(deletionRetry.body.deletedAt, deleted.body.deletedAt);
    const changedDeletionRetry = await deleteResumeFiles(
      baseUrl,
      ownerToken,
      "primary-resume",
      "resume-revision-1",
      { ...deletionRequest, reason: "Changed destructive request." },
    );
    assert.equal(changedDeletionRetry.response.status, 409);
    assert.equal(changedDeletionRetry.body.code, "resume_file_deletion_operation_conflict");

    const deletedRevision = await call(client, "get_resume_revision", {
      resumeId: "primary-resume",
      revisionId: "resume-revision-1",
    });
    assert.equal(deletedRevision.revision.bullets[0].text, "Designed and operated a reliable service.");
    assert.equal(deletedRevision.revision.files.every((file) => file.downloadPath === null), true);
    assert.equal(deletedRevision.revision.files.every((file) => file.retention.state === "deleted"), true);
    assert.equal(deletedRevision.revision.files.every((file) => file.retention.deletedAt === deleted.body.deletedAt), true);
    const deletedDownload = await fetch(`${baseUrl}/resume/files/primary-resume/resume-revision-1/pdf`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(deletedDownload.status, 404);
    const isolatedDeletion = await deleteResumeFiles(
      baseUrl,
      otherToken,
      "primary-resume",
      "resume-revision-1",
      deletionRequest,
    );
    assert.equal(isolatedDeletion.response.status, 404);
    const selectDeleted = await client.callTool({
      name: "set_current_resume_revision",
      arguments: {
        operationId: "select-deleted-primary-r1",
        resumeId: "primary-resume",
        revisionId: "resume-revision-1",
      },
    });
    assert.equal(selectDeleted.isError, true);
    assert.equal(selectDeleted.structuredContent.code, "resume_revision_files_unavailable");
    const reimportDeletedSource = await postResumeImport(baseUrl, ownerToken, {
      operationId: "resume-import-retired-source",
      revisionId: "resume-revision-restored",
    });
    assert.equal(reimportDeletedSource.response.status, 409);
    assert.equal(reimportDeletedSource.body.code, "resume_import_source_files_retired");

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO behavioral_evidence_items
        (owner_id,evidence_id,project_key,origin,statement,source_revision,evidence_grade,attribution_grade,
         claim_strength,candidate_state,visibility,safe_provenance,supports,limitations,tags,owner_attestation,
         review_revision,created_at,updated_at)
      VALUES
        ('owner-resume-ingest','evidence-platform','project-platform','document','A platform capability exists.',
         'source-revision-1','E3','A1','project_fact','accepted','owner_private','[]','[]','[]','[]',NULL,1,1,1);
      INSERT INTO behavioral_claims
        (owner_id,claim_id,question_id,text,scope,status,claim_strength,evidence_ids,contrary_evidence_ids,
         gaps,safer_wording,tags,visibility,revision,created_at,updated_at)
      VALUES
        ('owner-resume-ingest','claim-platform','behavioral-platform','Built a platform capability.','project','verified',
         'project_fact','["evidence-platform"]','[]','[]',NULL,'[]','owner_private',1,1,1);
      INSERT INTO problem_solution_profiles
        (owner_id,specialty,question_id,title,current_revision,tags,payload,updated_at)
      VALUES
        ('owner-resume-ingest','behavioral','behavioral-platform','Platform story',3,'[]','{}',1);
    `]);

    const semanticDocxV1 = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x10, 0x01]);
    const semanticPdfV1 = new TextEncoder().encode("%PDF-1.7\n% semantic v1\n%%EOF");
    const semanticSourceV1 = sha256("google-drive-source-revision-v1");
    const semanticManifestV1 = {
      schemaVersion: 1,
      sourceProvider: "google_drive",
      sourceRevisionFingerprint: semanticSourceV1,
      extractionVersion: "resume-extract-v1",
      capturedAt: 1_786_505_300_000,
      bullets: [{
        occurrenceId: "platform-impact",
        sectionLabel: "Experience",
        ordinal: 0,
        text: "Built a reliable platform capability.",
        contentFingerprint: sha256("Built a reliable platform capability."),
        claimIds: ["claim-platform"],
        evidenceIds: ["evidence-platform"],
      }],
    };
    const semanticImportV1 = await postResumeImport(baseUrl, ownerToken, {
      operationId: "resume-semantic-import-v1",
      resumeId: "semantic-resume",
      revisionId: "semantic-revision-v1",
      sourceLabel: "Semantic resume",
      sourceFingerprint: semanticSourceV1,
      docxBytes: semanticDocxV1,
      pdfBytes: semanticPdfV1,
      manifest: semanticManifestV1,
    });
    assert.equal(semanticImportV1.response.status, 201, JSON.stringify(semanticImportV1.body));

    const backfillAnalysis = {
      schemaVersion: 1,
      answerFormat: "STARL",
      competencies: ["platform engineering"],
      claimAudit: [{
        claim: "Built a platform capability.",
        status: "verified",
        supportingEvidenceIds: ["evidence-platform"],
        contraryEvidenceIds: [],
        gaps: [],
        contradictions: [],
      }],
      reviewDimensions: Object.fromEntries([
        "relevance", "structure", "specificity", "personalOwnership",
        "decisions", "result", "learning", "delivery",
      ].map((dimension) => [dimension, { status: "not_observed" }])),
      strengths: [],
      improvements: [],
      coachingNotes: [],
      likelyFollowUps: [],
      nextDrill: "Rehearse the exact platform example.",
    };
    const backfillSnapshot = {
      schemaVersion: 1,
      answer: "I built a platform capability.",
      scope: "universal",
      question: {
        questionId: "behavioral-platform",
        title: "Platform example",
        prompt: "Tell me about a platform capability.",
      },
      solutionProfile: { questionId: "behavioral-platform", revision: 3 },
      acceptedEvidenceIds: ["evidence-platform"],
      evidenceGaps: [],
      contradictions: [],
      provenance: { responseTurnId: "response-platform-backfill" },
      behavioralAnalysis: backfillAnalysis,
    };
    const legacySnapshot = {
      ...backfillSnapshot,
      provenance: { responseTurnId: "response-platform-legacy" },
    };
    delete legacySnapshot.behavioralAnalysis;
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO behavioral_final_answer_snapshots
        (owner_id,activity_id,snapshot_revision,operation_id,request_fingerprint,snapshot,
         correction_of_revision,correction_reason,finalized_at)
      VALUES
        ('owner-resume-ingest','behavioral-attempt-backfill',1,'answer-backfill-operation','answer-backfill-fingerprint',
         ${sqlText(JSON.stringify(backfillSnapshot))},NULL,NULL,1),
        ('owner-resume-ingest','behavioral-attempt-legacy',1,'answer-legacy-operation','answer-legacy-fingerprint',
         ${sqlText(JSON.stringify(legacySnapshot))},NULL,NULL,1);
    `]);
    const backfillInput = {
      operationId: "resume-context-backfill-platform",
      activityId: "behavioral-attempt-backfill",
      snapshotRevision: 1,
      resumeId: "semantic-resume",
      resumeRevisionId: "semantic-revision-v1",
      provenance: {
        sourceFingerprint: semanticSourceV1,
        docxSha256: semanticImportV1.body.files.docx.sha256,
        pdfSha256: semanticImportV1.body.files.pdf.sha256,
        resumeImportedAt: semanticImportV1.body.importedAt,
        snapshotLoadedAt: semanticImportV1.body.importedAt,
      },
      authorization: "explicit_user_instruction",
      ownerConfirmedAt: semanticImportV1.body.importedAt,
      reason: "Synthetic owner confirmation of the exact loaded snapshot.",
    };
    const mismatchedBackfill = await client.callTool({
      name: "backfill_activity_resume_context",
      arguments: {
        ...backfillInput,
        operationId: "resume-context-backfill-mismatch",
        provenance: { ...backfillInput.provenance, pdfSha256: sha256("different PDF") },
      },
    });
    assert.equal(mismatchedBackfill.isError, true);
    assert.equal(mismatchedBackfill.structuredContent.code, "resume_context_backfill_provenance_mismatch");
    const legacyBackfill = await client.callTool({
      name: "backfill_activity_resume_context",
      arguments: {
        ...backfillInput,
        operationId: "resume-context-backfill-legacy",
        activityId: "behavioral-attempt-legacy",
      },
    });
    assert.equal(legacyBackfill.isError, true);
    assert.equal(legacyBackfill.structuredContent.code, "resume_context_backfill_snapshot_unsupported");
    const legacyContext = await call(client, "get_activity_resume_context", {
      activityId: "behavioral-attempt-legacy",
    });
    assert.deepEqual(legacyContext, {
      found: false,
      contexts: [],
      truncated: false,
      provenanceState: "legacy_unversioned",
    });

    const backfilled = await call(client, "backfill_activity_resume_context", backfillInput);
    assert.equal(backfilled.status, "saved");
    assert.equal(backfilled.state, "backfilled");
    assert.equal(backfilled.duplicate, false);
    assert.deepEqual(backfilled.claimIds, ["claim-platform"]);
    assert.deepEqual(backfilled.evidenceIds, ["evidence-platform"]);
    assert.equal(/sha256|fingerprint|owner-resume/i.test(JSON.stringify(backfilled)), false);
    const backfillRetry = await call(client, "backfill_activity_resume_context", backfillInput);
    assert.equal(backfillRetry.duplicate, true);
    assert.equal(backfillRetry.capturedAt, backfilled.capturedAt);
    const changedBackfillRetry = await client.callTool({
      name: "backfill_activity_resume_context",
      arguments: { ...backfillInput, reason: "A changed historical assertion." },
    });
    assert.equal(changedBackfillRetry.isError, true);
    assert.equal(changedBackfillRetry.structuredContent.code, "resume_context_backfill_operation_conflict");
    const isolatedBackfill = await otherClient.callTool({
      name: "backfill_activity_resume_context",
      arguments: backfillInput,
    });
    assert.equal(isolatedBackfill.isError, true);
    assert.equal(isolatedBackfill.structuredContent.code, "resume_context_backfill_snapshot_unavailable");
    const backfilledContext = await call(client, "get_activity_resume_context", {
      activityId: "behavioral-attempt-backfill",
      snapshotRevision: 1,
    });
    assert.equal(backfilledContext.contexts[0].state, "backfilled");
    assert.equal(backfilledContext.contexts[0].capturedAt, backfilled.capturedAt);

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO activity_resume_contexts
        (owner_id,activity_id,snapshot_revision,resume_id,resume_revision_id,source_label,resume_imported_at,
         state,claim_ids,evidence_ids,captured_at)
      VALUES
        ('owner-resume-ingest','behavioral-attempt-platform',1,'semantic-resume','semantic-revision-v1',
         'Semantic resume',1,'contemporaneous','["claim-platform"]','["evidence-platform"]',2);
    `]);

    const semanticDocxV2 = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x10, 0x02]);
    const semanticPdfV2 = new TextEncoder().encode("%PDF-1.7\n% semantic v2\n%%EOF");
    const semanticSourceV2 = sha256("google-drive-source-revision-v2");
    const semanticManifestV2 = {
      ...semanticManifestV1,
      sourceRevisionFingerprint: semanticSourceV2,
      capturedAt: 1_786_505_400_000,
      bullets: [{
        ...semanticManifestV1.bullets[0],
        text: "Supported a reliable platform capability.",
        contentFingerprint: sha256("Supported a reliable platform capability."),
        claimIds: [],
      }],
    };
    const semanticImportV2 = await postResumeImport(baseUrl, ownerToken, {
      operationId: "resume-semantic-import-v2",
      resumeId: "semantic-resume",
      revisionId: "semantic-revision-v2",
      sourceLabel: "Semantic resume",
      sourceFingerprint: semanticSourceV2,
      docxBytes: semanticDocxV2,
      pdfBytes: semanticPdfV2,
      manifest: semanticManifestV2,
    });
    assert.equal(semanticImportV2.response.status, 201, JSON.stringify(semanticImportV2.body));

    const semanticRevisionV2 = await call(client, "get_resume_revision", {
      resumeId: "semantic-resume",
      revisionId: "semantic-revision-v2",
    });
    assert.equal(semanticRevisionV2.revision.bullets[0].text, "Supported a reliable platform capability.");
    assert.deepEqual(semanticRevisionV2.revision.bullets[0].claimIds, []);
    assert.equal(semanticRevisionV2.revision.reviewImpacts.length, 1);
    assert.deepEqual(semanticRevisionV2.revision.reviewImpacts[0], {
      questionId: "behavioral-platform",
      solutionProfileRevision: 3,
      changedClaimIds: ["claim-platform"],
      status: "needs_review",
      createdAt: semanticImportV2.body.importedAt,
      acknowledgedAt: null,
    });

    const semanticComparison = await call(client, "compare_resume_revisions", {
      resumeId: "semantic-resume",
      fromRevisionId: "semantic-revision-v1",
      toRevisionId: "semantic-revision-v2",
    });
    assert.deepEqual(semanticComparison.summary, { added: 0, removed: 0, changed: 1, unchanged: 0 });
    assert.equal(semanticComparison.changed[0].changes.contentChanged, true);
    assert.deepEqual(semanticComparison.changed[0].changes.claimDelta.removed, ["claim-platform"]);

    const claimUsage = await call(client, "query_resume_reference_usage", {
      referenceType: "claim",
      referenceId: "claim-platform",
    });
    assert.equal(claimUsage.revisionOccurrences.length, 1);
    assert.equal(claimUsage.revisionOccurrences[0].revisionId, "semantic-revision-v1");
    assert.equal(claimUsage.activityContexts.length, 2);
    assert.deepEqual(
      claimUsage.activityContexts.map((context) => context.activityId).sort(),
      ["behavioral-attempt-backfill", "behavioral-attempt-platform"],
    );

    const activityContext = await call(client, "get_activity_resume_context", {
      activityId: "behavioral-attempt-platform",
    });
    assert.equal(activityContext.found, true);
    assert.equal(activityContext.contexts[0].state, "contemporaneous");
    assert.deepEqual(activityContext.contexts[0].claimIds, ["claim-platform"]);

    const currentSelection = await call(client, "set_current_resume_revision", {
      operationId: "select-semantic-resume-v1",
      resumeId: "semantic-resume",
      revisionId: "semantic-revision-v1",
    });
    assert.equal(currentSelection.priorRevisionId, "semantic-revision-v2");
    assert.equal(currentSelection.currentRevisionId, "semantic-revision-v1");
    assert.equal(currentSelection.unchanged, false);
    const currentSelectionRetry = await call(client, "set_current_resume_revision", {
      operationId: "select-semantic-resume-v1",
      resumeId: "semantic-resume",
      revisionId: "semantic-revision-v1",
    });
    assert.equal(currentSelectionRetry.duplicate, true);
    const changedSelectionRetry = await client.callTool({
      name: "set_current_resume_revision",
      arguments: {
        operationId: "select-semantic-resume-v1",
        resumeId: "semantic-resume",
        revisionId: "semantic-revision-v2",
      },
    });
    assert.equal(changedSelectionRetry.isError, true);
    assert.equal(changedSelectionRetry.structuredContent.code, "resume_current_revision_operation_conflict");

    const isolatedRevision = await call(otherClient, "get_resume_revision", {
      resumeId: "semantic-resume",
    });
    assert.deepEqual(isolatedRevision, { found: false });
    const isolatedClaimUsage = await call(otherClient, "query_resume_reference_usage", {
      referenceType: "claim",
      referenceId: "claim-platform",
    });
    assert.deepEqual(isolatedClaimUsage.revisionOccurrences, []);
    assert.deepEqual(isolatedClaimUsage.activityContexts, []);

    const downloaded = await fetch(`${baseUrl}/resume/files/primary-resume/resume-revision-3/pdf`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), newPdfBytes);
    assert.equal(downloaded.headers.get("content-type"), "application/pdf");
    assert.match(downloaded.headers.get("content-disposition"), /^attachment; filename="resume-resume-revision-3\.pdf"$/);
    assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
    assert.equal([...downloaded.headers].some(([name, value]) => /object|storage|r2/i.test(`${name}:${value}`)), false);

    const isolatedDownload = await fetch(`${baseUrl}/resume/files/primary-resume/resume-revision-3/pdf`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assert.equal(isolatedDownload.status, 404);

    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO resume_sources
        (owner_id,resume_id,source_label,current_revision_id,created_at,updated_at)
      VALUES
        ('owner-resume-ingest','missing-resume','Missing object fixture','missing-revision',1,1);
      INSERT INTO resume_revisions
        (owner_id,resume_id,revision_id,parent_revision_id,source_fingerprint,import_operation_id,storage_generation,visibility,imported_at)
      VALUES
        ('owner-resume-ingest','missing-resume','missing-revision',NULL,'${sha256("missing source")}',
         'missing-operation','missing-generation','owner_private',1);
      INSERT INTO resume_revision_files
        (owner_id,resume_id,revision_id,format,sha256,byte_size,mime_type,visibility,created_at)
      VALUES
        ('owner-resume-ingest','missing-resume','missing-revision','pdf','${sha256("missing file")}',12,
         'application/pdf','owner_private',1);
    `]);
    const missingObject = await fetch(`${baseUrl}/resume/files/missing-resume/missing-revision/pdf`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(missingObject.status, 503);
    assert.equal(missingObject.headers.get("cache-control"), "private, no-store");
    assert.equal(/key|bucket|r2|generation/i.test(JSON.stringify(await missingObject.json())), false);

    const concurrentInput = {
      operationId: "resume-import-concurrent-operation",
      resumeId: "concurrent-resume",
      revisionId: "concurrent-revision-1",
      sourceFingerprint: sha256("opaque-concurrent-source-revision"),
    };
    const concurrent = await Promise.all([
      postResumeImport(baseUrl, ownerToken, concurrentInput),
      postResumeImport(baseUrl, ownerToken, concurrentInput),
    ]);
    const concurrentStatuses = concurrent.map(({ response: item }) => item.status).sort();
    assert.equal(concurrentStatuses.includes(201), true);
    assert.equal(concurrentStatuses.every((statusCode) => [200, 201, 409].includes(statusCode)), true);
    for (const result of concurrent.filter(({ response: item }) => item.status === 409)) {
      assert.equal(result.body.code, "resume_import_busy");
      assert.equal(result.body.retryable, true);
    }
    const concurrentReplay = await postResumeImport(baseUrl, ownerToken, concurrentInput);
    assert.equal(concurrentReplay.response.status, 200);
    assert.equal(concurrentReplay.body.status, "saved");
  } finally {
    await otherClient?.close().catch(() => {});
    await client?.close().catch(() => {});
    if (worker && worker.exitCode === null) worker.kill("SIGTERM");
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

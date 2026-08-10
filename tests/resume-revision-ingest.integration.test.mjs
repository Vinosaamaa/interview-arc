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

function resumeImportForm(overrides = {}) {
  const docxBytes = overrides.docxBytes ?? new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const pdfBytes = overrides.pdfBytes ?? new TextEncoder().encode("%PDF-1.7\n% private fixture\n%%EOF");
  const form = new FormData();
  form.set("operationId", overrides.operationId ?? "resume-import-operation-1");
  form.set("resumeId", overrides.resumeId ?? "primary-resume");
  form.set("revisionId", overrides.revisionId ?? "resume-revision-1");
  form.set("sourceLabel", overrides.sourceLabel ?? "Primary resume");
  form.set("sourceFingerprint", overrides.sourceFingerprint ?? sha256("opaque-source-revision-1"));
  form.set("docx", new File([docxBytes], "resume.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  form.set("pdf", new File([pdfBytes], "resume.pdf", { type: "application/pdf" }));
  return { form, docxBytes, pdfBytes };
}

test("an authenticated staged DOCX/PDF pair becomes one immutable current resume revision", { timeout: 90_000 }, async () => {
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
    await waitForWorker(baseUrl, worker);

    const { form, docxBytes, pdfBytes } = resumeImportForm();
    const response = await fetch(`${baseUrl}/resume/imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: form,
    });
    const imported = await response.json();
    assert.equal(response.status, 201, `${JSON.stringify(imported)}\n${workerLog}`);
    assert.equal(imported.status, "saved");
    assert.equal(imported.resumeId, "primary-resume");
    assert.equal(imported.revisionId, "resume-revision-1");
    assert.equal(imported.parentRevisionId, null);
    assert.equal(imported.sourceFingerprint, sha256("opaque-source-revision-1"));
    assert.equal(Number.isInteger(imported.importedAt), true);
    assert.equal(imported.currentRevisionId, "resume-revision-1");
    assert.equal(imported.files.docx.sha256, sha256(docxBytes));
    assert.equal(imported.files.pdf.sha256, sha256(pdfBytes));
    assert.equal(JSON.stringify(imported).includes("objectKey"), false);

    client = await connect(baseUrl, ownerToken, "resume-ingest-owner");
    const status = await call(client, "get_resume_import_status", {
      operationId: "resume-import-operation-1",
    });
    assert.equal(status.found, true);
    assert.equal(status.import.status, "saved");
    assert.equal(status.import.currentRevisionId, "resume-revision-1");
    assert.deepEqual(status.import.files.map((file) => file.format), ["docx", "pdf"]);
    assert.equal(JSON.stringify(status).includes("objectKey"), false);
    assert.equal(JSON.stringify(status).includes("owner-resume-ingest"), false);

    const exactRetry = await fetch(`${baseUrl}/resume/imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: resumeImportForm().form,
    });
    assert.equal(exactRetry.status, 200);
    assert.deepEqual(await exactRetry.json(), imported);

    const changedRetry = await fetch(`${baseUrl}/resume/imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: resumeImportForm({ sourceLabel: "Changed label" }).form,
    });
    assert.equal(changedRetry.status, 409);
    assert.equal((await changedRetry.json()).code, "resume_import_operation_conflict");

    otherClient = await connect(baseUrl, otherToken, "resume-ingest-other-owner");
    const isolated = await call(otherClient, "get_resume_import_status", {
      operationId: "resume-import-operation-1",
    });
    assert.deepEqual(isolated, { found: false });

    const unchangedResponse = await fetch(`${baseUrl}/resume/imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: resumeImportForm({
        operationId: "resume-import-operation-2",
        revisionId: "resume-revision-2",
      }).form,
    });
    const unchanged = await unchangedResponse.json();
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
    const nextResponse = await fetch(`${baseUrl}/resume/imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: resumeImportForm({
        operationId: "resume-import-operation-3",
        revisionId: "resume-revision-3",
        sourceFingerprint: sha256("opaque-source-revision-3"),
        docxBytes: newDocxBytes,
        pdfBytes: newPdfBytes,
      }).form,
    });
    const next = await nextResponse.json();
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
  } finally {
    await otherClient?.close().catch(() => {});
    await client?.close().catch(() => {});
    if (worker && worker.exitCode === null) worker.kill("SIGTERM");
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

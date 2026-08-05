import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

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

async function acquireMcpIntegrationLock() {
  const path = join(tmpdir(), "interview-arc-mcp-integration.lock");
  for (let attempt = 0; attempt < 900; attempt += 1) {
    try {
      await writeFile(path, JSON.stringify({ pid: process.pid }), { flag: "wx" });
      return () => unlink(path).catch(() => {});
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const [contents, metadata] = await Promise.all([
        readFile(path, "utf8").catch(() => ""),
        stat(path).catch(() => undefined),
      ]);
      let ownerPid;
      try { ownerPid = JSON.parse(contents).pid; } catch {}
      let ownerAlive = false;
      if (Number.isInteger(ownerPid)) {
        try { process.kill(ownerPid, 0); ownerAlive = true; } catch (ownerError) {
          if (ownerError?.code !== "ESRCH") ownerAlive = true;
        }
      }
      const incompleteWrite = !ownerPid && metadata && Date.now() - metadata.mtimeMs < 1_000;
      if (!ownerAlive && !incompleteWrite) {
        await unlink(path).catch(() => {});
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for the local MCP integration lock.");
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

async function waitForJobs(call, jobIds) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await call("get_specialist_write_status", { jobIds });
    if (result.jobs.every((job) => job.status === "saved" || job.status === "failed")) return result.jobs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Specialist writes did not settle: ${jobIds.join(", ")}`);
}

test("local MCP persists exact specialist writes through durable receipts and rejects changed retries", { timeout: 90_000 }, async () => {
  const token = "ia_specialist_write_integration_token";
  const tokenHash = sha256(token);
  let releaseIntegrationLock;
  let persistence;
  let worker;
  let client;
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-specialist-writes-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES ('${tokenHash}','owner-specialist-write','Specialist write integration',1,NULL,NULL);
      INSERT INTO practice_transcript_turns
        (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
      VALUES
        ('owner-specialist-write','activity-write','user-write-1','leetcode','user','My submitted code.','codex',1,100,100);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let workerLog = "";
    worker.stdout.on("data", (chunk) => { workerLog += chunk; });
    worker.stderr.on("data", (chunk) => { workerLog += chunk; });
    await waitForWorker(baseUrl, worker);

    client = new Client({ name: "specialist-write-integration", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    const callRaw = (name, args) => client.callTool({ name, arguments: args });
    const call = async (name, args) => {
      const result = await callRaw(name, args);
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}\n${workerLog}`);
      return result.structuredContent;
    };

    const attempt = {
      operationId: "operation-attempt-write-1",
      id: "attempt-write-1",
      activityId: "activity-write",
      originatingTurnId: "user-write-1",
      sequence: 1,
      language: "java",
      code: "class Solution { int answer() { return 42; } }",
      occurredAt: 200,
      review: { schemaVersion: 1, status: "pending" },
      observedCorrectness: "not_verified",
      concreteFindings: [],
      edgeCases: [],
      finalDeclaration: "Evaluation is still running.",
    };
    const queuedAttempt = await call("save_leetcode_code_attempt", attempt);
    assert.equal(queuedAttempt.jobId, attempt.operationId);
    assert.ok(["queued", "processing", "retry_wait", "saved"].includes(queuedAttempt.status));

    // The receipt is D1 state, not connection state. Reconnect before reading
    // it to cover the exact transport-recovery boundary specialists use.
    await client.close();
    client = new Client({ name: "specialist-write-integration-reconnected", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    const [savedAttempt] = await waitForJobs(call, [attempt.operationId]);
    assert.equal(savedAttempt.status, "saved");
    assert.equal(savedAttempt.operation, "leetcode_code_attempt");
    assert.equal(savedAttempt.result.status, "inserted");

    const attemptReplay = await call("save_leetcode_code_attempt", attempt);
    assert.equal(attemptReplay.status, "saved");
    assert.equal(attemptReplay.duplicate, true);
    const changedAttempt = await callRaw("save_leetcode_code_attempt", {
      ...attempt,
      code: "class Solution { int answer() { return 7; } }",
    });
    assert.equal(changedAttempt.isError, true);
    assert.equal(changedAttempt.structuredContent.code, "specialist_write_identity_conflict");
    assert.equal(changedAttempt.structuredContent.retryable, false);

    // Compatibility callers may still send stale response-turn metadata on a
    // pending review. The Worker must normalize that field and save the exact
    // immutable code instead of failing the queued write.
    const stalePendingAttempt = {
      ...attempt,
      operationId: "operation-attempt-write-pending-stale-turn",
      id: "attempt-write-pending-stale-turn",
      sequence: 2,
      reviewResponseTurnId: "stale-specialist-turn",
    };
    const queuedStalePending = await call("save_leetcode_code_attempt", stalePendingAttempt);
    const [savedStalePending] = await waitForJobs(call, [stalePendingAttempt.operationId]);
    assert.equal(queuedStalePending.jobId, stalePendingAttempt.operationId);
    assert.equal(savedStalePending.status, "saved");
    assert.equal(savedStalePending.result.status, "inserted");

    const metadataFor = (problemNumber, difficulty, topics, companyTags, title, url, capturedAt = "2026-08-04T22:00:00.000Z") => ({
      problemNumber,
      difficulty,
      topics,
      companyTags,
      capturedAt,
      sources: [{ title, url, accessedAt: capturedAt }],
    });
    const bankJobs = [
      {
        operationId: "operation-bank-water-1",
        specialty: "leetcode",
        questionId: "trapping-rain-water-ii",
        title: "Trapping Rain Water II",
        url: "https://leetcode.com/problems/trapping-rain-water-ii/",
      tags: ["heap", "matrix"],
      targetMinutes: 45,
      active: true,
      metadata: {
        problemNumber: 407,
        difficulty: "hard",
        acceptanceRate: 42.5,
        topics: ["Heap (Priority Queue)", "Matrix"],
        companyTags: ["Google"],
        companySignals: [{
          company: "Amazon",
          window: "30 days",
          frequencyScore: 4,
          frequencyScale: 5,
          capturedAt: "2026-08-04T22:00:00.000Z",
        }],
        capturedAt: "2026-08-04T22:00:00.000Z",
        sources: [{
          title: "Trapping Rain Water II",
          url: "https://leetcode.com/problems/trapping-rain-water-ii/",
          accessedAt: "2026-08-04T22:00:00.000Z",
        }],
      },
      },
      {
        operationId: "operation-bank-flow-1",
        specialty: "leetcode",
        questionId: "pacific-atlantic-water-flow",
        title: "Pacific Atlantic Water Flow",
        url: "https://leetcode.com/problems/pacific-atlantic-water-flow/",
        tags: ["graph", "matrix"],
        targetMinutes: 35,
        active: true,
        metadata: metadataFor(
          417,
          "medium",
          ["Depth-First Search", "Breadth-First Search", "Matrix"],
          ["Google"],
          "Pacific Atlantic Water Flow",
          "https://leetcode.com/problems/pacific-atlantic-water-flow/",
        ),
      },
      {
        operationId: "operation-bank-pour-1",
        specialty: "leetcode",
        questionId: "pour-water",
        title: "Pour Water",
        url: "https://leetcode.com/problems/pour-water/",
        tags: ["simulation"],
        targetMinutes: 30,
        active: true,
        metadata: metadataFor(755, "medium", ["Array", "Simulation"], [], "Pour Water", "https://leetcode.com/problems/pour-water/"),
      },
      {
        operationId: "operation-bank-swim-1",
        specialty: "leetcode",
        questionId: "swim-in-rising-water",
        title: "Swim in Rising Water",
        url: "https://leetcode.com/problems/swim-in-rising-water/",
        tags: ["heap", "graph"],
        targetMinutes: 40,
        active: true,
        metadata: metadataFor(778, "hard", ["Heap (Priority Queue)", "Binary Search", "Matrix"], ["Amazon"], "Swim in Rising Water", "https://leetcode.com/problems/swim-in-rising-water/"),
      },
      {
        operationId: "operation-bank-grid-query-1",
        specialty: "leetcode",
        questionId: "maximum-number-of-points-from-grid-queries",
        title: "Maximum Number of Points From Grid Queries",
        url: "https://leetcode.com/problems/maximum-number-of-points-from-grid-queries/",
        tags: ["heap", "bfs"],
        targetMinutes: 40,
        active: true,
        metadata: metadataFor(2503, "hard", ["Array", "Binary Search", "Breadth-First Search", "Heap (Priority Queue)"], [], "Maximum Number of Points From Grid Queries", "https://leetcode.com/problems/maximum-number-of-points-from-grid-queries/"),
      },
      {
        operationId: "operation-bank-container-1",
        specialty: "leetcode",
        questionId: "container-with-most-water",
        title: "Container With Most Water",
        url: "https://leetcode.com/problems/container-with-most-water/",
        tags: ["two-pointers"],
        targetMinutes: 30,
        active: true,
        metadata: metadataFor(11, "medium", ["Array", "Two Pointers", "Greedy"], ["Meta"], "Container With Most Water", "https://leetcode.com/problems/container-with-most-water/"),
      },
    ];
    for (const question of bankJobs) await call("upsert_personal_bank_question", question);
    const savedBankJobs = await waitForJobs(call, bankJobs.map((job) => job.operationId));
    assert.deepEqual(savedBankJobs.map((job) => job.status), ["saved", "saved", "saved", "saved", "saved", "saved"]);
    assert.deepEqual(savedBankJobs.map((job) => job.result.status), ["upserted", "upserted", "upserted", "upserted", "upserted", "upserted"]);
    assert.equal(savedBankJobs[0].result.metadata.problemNumber, 407);
    assert.equal(savedBankJobs[0].result.metadata.difficulty, "hard");
    assert.deepEqual(savedBankJobs[0].result.metadata.topics, ["Heap (Priority Queue)", "Matrix"]);
    assert.deepEqual(savedBankJobs[0].result.metadata.companyTags, ["Google"]);
    assert.deepEqual(savedBankJobs[0].result.tags, [
      "heap",
      "matrix",
      "difficulty:hard",
      "topic:heap-priority-queue",
      "topic:matrix",
      "company:google",
      "company:amazon",
    ]);
    assert.equal(new Set(savedBankJobs.map((job) => job.result.questionId)).size, 6);
    const bankReplays = await Promise.all(bankJobs.map((question) => call("upsert_personal_bank_question", question)));
    assert.ok(bankReplays.every((result) => result.status === "saved"));
    const replayedBankJobs = await waitForJobs(call, bankJobs.map((job) => job.operationId));
    assert.ok(replayedBankJobs.every((job) => job.status === "saved"));
    assert.equal(replayedBankJobs[0].result.metadata.problemNumber, 407);

    const invalidMetadata = await call("upsert_personal_bank_question", {
      operationId: "operation-bank-invalid-specialty",
      specialty: "behavioral",
      questionId: "custom:behavioral:metadata-not-allowed",
      title: "Metadata must stay LeetCode-specific",
      metadata: bankJobs[0].metadata,
    });
    const invalidAttempt = await call("save_leetcode_code_attempt", {
      ...attempt,
      operationId: "operation-attempt-invalid-origin",
      id: "attempt-invalid-origin",
      originatingTurnId: "missing-user-turn",
      sequence: 2,
    });
    const independentBank = {
      operationId: "operation-bank-independent-success",
      specialty: "leetcode",
      questionId: "container-with-most-water",
      title: "Container With Most Water",
      url: "https://leetcode.com/problems/container-with-most-water/",
      tags: ["two-pointers"],
      targetMinutes: 30,
      active: true,
    };
    await call("upsert_personal_bank_question", independentBank);
    const partial = await waitForJobs(call, [invalidAttempt.jobId, independentBank.operationId]);
    const invalidMetadataJob = await waitForJobs(call, [invalidMetadata.jobId]);
    assert.equal(invalidMetadataJob[0].status, "failed");
    assert.equal(invalidMetadataJob[0].failure.retryable, false);
    assert.match(invalidMetadataJob[0].failure.message, /only valid for LeetCode/);
    assert.equal(partial[0].status, "failed");
    assert.equal(partial[0].failure.retryable, false);
    assert.equal(partial[1].status, "saved");
    const rejectedRetry = await callRaw("retry_specialist_writes", { jobIds: [invalidAttempt.jobId] });
    assert.equal(rejectedRetry.isError, true);
    assert.equal(rejectedRetry.structuredContent.code, "specialist_write_not_retryable");

    const record = await call("get_activity_practice_record", { activityId: "activity-write" });
    assert.equal(record.codeAttempts.length, 2);
    assert.equal(record.codeAttempts[0].id, attempt.id);
    assert.equal(record.codeAttempts[1].id, stalePendingAttempt.id);
    assert.equal(record.codeAttempts[1].reviewResponseTurnId, null);
  } finally {
    await client?.close().catch(() => {});
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

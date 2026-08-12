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

async function waitForJobs(call, jobIds, baseUrl) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const scheduled = await fetch(`${baseUrl}/__scheduled?cron=*+*+*+*+*`);
    assert.equal(scheduled.ok, true);
    const result = await call("get_specialist_write_status", { jobIds });
    if (result.jobs.every((job) => job.status === "saved" || job.status === "failed")) return result.jobs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Specialist writes did not settle: ${jobIds.join(", ")}`);
}

test("local MCP persists exact specialist writes through durable receipts and rejects changed retries", { timeout: 180_000 }, async () => {
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
        ('owner-specialist-write','activity-write','user-write-1','leetcode','user','My submitted code.','codex',1,100,100),
        ('owner-specialist-write','activity-recovery','user-recovery-1','leetcode','user','I submitted this exact code before finalization.','codex',1,100,100),
        ('owner-specialist-write','activity-recovery','specialist-recovery-review-1','leetcode','specialist','Recovered review. The invariant is correct. Use clearer names. The exact source was reviewed. Keep the recovered implementation.','codex',2,120,120),
        ('owner-specialist-write','activity-deleted-recovery','user-deleted-recovery-1','leetcode','user','I submitted this exact code before finalization.','codex',1,100,100),
        ('owner-specialist-write','activity-deleted-recovery','specialist-deleted-recovery-review-1','leetcode','specialist','Recovered review. The invariant is correct. Use clearer names. The exact source was reviewed. Keep the recovered implementation.','codex',2,120,120),
        ('owner-specialist-write','activity-sequence-recovery','user-sequence-recovery-1','leetcode','user','I submitted this exact code before finalization.','codex',1,100,100),
        ('owner-specialist-write','activity-sequence-recovery','specialist-sequence-recovery-review-1','leetcode','specialist','Recovered review. The invariant is correct. Use clearer names. The exact source was reviewed. Keep the recovered implementation.','codex',2,120,120),
        ('owner-specialist-write','activity-concurrent-recovery','user-concurrent-recovery-1','leetcode','user','I submitted this exact code before finalization.','codex',1,100,100),
        ('owner-specialist-write','activity-concurrent-recovery','specialist-concurrent-recovery-review-1','leetcode','specialist','Recovered review. The invariant is correct. Use clearer names. The exact source was reviewed. Keep the recovered implementation.','codex',2,120,120),
        ('owner-specialist-write','activity-published-recovery','user-published-recovery-1','leetcode','user','Published code.','codex',1,100,100),
        ('owner-specialist-write','activity-published-recovery','specialist-published-recovery-review-1','leetcode','specialist','Published review. Correct. Improve names. Evidence. Next.','codex',2,120,120),
        ('owner-specialist-write-other','activity-cross-owner-recovery','user-cross-owner-recovery-1','leetcode','user','I submitted this exact code before finalization.','codex',1,100,100),
        ('owner-specialist-write-other','activity-cross-owner-recovery','specialist-cross-owner-recovery-review-1','leetcode','specialist','Recovered review. The invariant is correct. Use clearer names. The exact source was reviewed. Keep the recovered implementation.','codex',2,120,120);
      INSERT INTO activity_finalizations
        (owner_id,activity_id,specialty,status,payload,finalized_at,published_at,revision,updated_at)
      VALUES
        ('owner-specialist-write','activity-recovery','leetcode','ready','{"title":"Recovery","complete":true}',200,NULL,1,200),
        ('owner-specialist-write','activity-missing-recovery','leetcode','ready','{"title":"Missing","complete":true}',200,NULL,1,200),
        ('owner-specialist-write','activity-deleted-recovery','leetcode','ready','{"title":"Deleted","complete":true}',200,NULL,1,200),
        ('owner-specialist-write','activity-cross-owner-recovery','leetcode','ready','{"title":"Cross owner","complete":true}',200,NULL,1,200),
        ('owner-specialist-write','activity-sequence-recovery','leetcode','ready','{"title":"Sequence","complete":true}',200,NULL,1,200),
        ('owner-specialist-write','activity-concurrent-recovery','leetcode','ready','{"title":"Concurrent","complete":true}',200,NULL,1,200),
        ('owner-specialist-write','activity-published-recovery','leetcode','published','{"title":"Published","complete":true}',200,300,1,300);
      INSERT INTO typed_practice_exchange_deletions
        (owner_id,operation_id,activity_id,user_turn_id,response_turn_id,specialty,expected_revision,request_fingerprint,reason,receipt,deleted_at)
      VALUES
        ('owner-specialist-write','delete-recovery-evidence','activity-deleted-recovery','user-deleted-recovery-1','specialist-deleted-recovery-review-1','leetcode',1,'deleted-recovery-fingerprint','Owner deleted the typed exchange.','{}',150);
      INSERT INTO leetcode_code_attempts
        (owner_id,id,activity_id,originating_turn_id,sequence,language,code,line_count,occurred_at,review,review_response_turn_id,observed_correctness,concrete_findings,edge_cases,complexity,final_declaration,created_at,updated_at)
      VALUES
        ('owner-specialist-write','attempt-existing-sequence','activity-sequence-recovery','user-sequence-recovery-1',1,'java','class Existing {}',1,110,'{"schemaVersion":1,"status":"complete","summary":"Recovered review.","whatWentWell":["The invariant is correct."],"whatToImprove":["Use clearer names."],"testingEvidence":["The exact source was reviewed."],"nextStep":"Keep the recovered implementation.","provenance":"specialist_observed","reviewedAt":120}','specialist-sequence-recovery-review-1','appears_correct','["The invariant is correct.","The exact source was reviewed."]','["Empty input outside the stated constraints."]','{"time":"O(n)","space":"O(1)"}','The exact historical source and review were recovered.',130,130);
      INSERT INTO problem_solution_profiles
        (owner_id,specialty,question_id,title,current_revision,tags,payload,updated_at)
      VALUES
        ('owner-specialist-write','leetcode','recovery-question','Recovery profile',1,'["array"]','{"summary":"Unchanged by Code Attempt recovery.","sections":[{"title":"Approach, correctness, complexity, edge cases, alternatives, and common mistakes","body":"Problem framing and constraints. Best algorithm. Correctness invariant. Time and space complexity. Edge cases. Alternative. Common mistake. Reference implementation.\\n\\u0060\\u0060\\u0060java\\nclass Solution {}\\n\\u0060\\u0060\\u0060"}],"references":[{"title":"Recovery reference","url":"https://leetcode.com/problems/recovery-question/"}],"tags":["array"]}',190);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--test-scheduled", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
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
    const [savedAttempt] = await waitForJobs(call, [attempt.operationId], baseUrl);
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
    const [savedStalePending] = await waitForJobs(call, [stalePendingAttempt.operationId], baseUrl);
    assert.equal(queuedStalePending.jobId, stalePendingAttempt.operationId);
    assert.equal(savedStalePending.status, "saved");
    assert.equal(savedStalePending.result.status, "inserted");

    const recoveredAttempt = {
      operationId: "operation-attempt-recovery-1",
      id: "attempt-recovery-1",
      activityId: "activity-recovery",
      originatingTurnId: "user-recovery-1",
      sequence: 1,
      language: "java",
      code: "class Solution { int recovered() { return 42; } }",
      occurredAt: 110,
      review: {
        schemaVersion: 1,
        status: "complete",
        summary: "Recovered review.",
        whatWentWell: ["The invariant is correct."],
        whatToImprove: ["Use clearer names."],
        testingEvidence: ["The exact source was reviewed."],
        nextStep: "Keep the recovered implementation.",
        provenance: "specialist_observed",
        reviewedAt: 120,
      },
      reviewResponseTurnId: "specialist-recovery-review-1",
      observedCorrectness: "appears_correct",
      concreteFindings: ["The invariant is correct.", "The exact source was reviewed."],
      edgeCases: ["Empty input outside the stated constraints."],
      complexity: { time: "O(n)", space: "O(1)" },
      finalDeclaration: "The exact historical source and review were recovered.",
      authorization: "explicit_user_instruction",
      auditReason: "Recover an exact pre-finalization owner attempt whose structured projection was missed.",
    };
    const readyBeforeRecovery = await call("get_activity_practice_record", { activityId: "activity-recovery" });
    const profileBeforeRecovery = await call("get_problem_solution_profile", {
      specialty: "leetcode",
      questionId: "recovery-question",
    });
    assert.equal(readyBeforeRecovery.codeAttempts.length, 0);
    assert.equal(readyBeforeRecovery.finalization.status, "ready");

    const ordinaryReadyWrite = await call("save_leetcode_code_attempt", {
      ...recoveredAttempt,
      operationId: "operation-attempt-ready-ordinary-rejected",
      authorization: undefined,
      auditReason: undefined,
    });
    const [ordinaryReadyReceipt] = await waitForJobs(call, [ordinaryReadyWrite.jobId], baseUrl);
    assert.equal(ordinaryReadyReceipt.status, "failed");
    assert.match(ordinaryReadyReceipt.failure.message, /cannot be added after its activity is ready or published/);

    const queuedRecovery = await call("recover_leetcode_code_attempt", recoveredAttempt);
    const [savedRecovery] = await waitForJobs(call, [queuedRecovery.jobId], baseUrl);
    assert.equal(savedRecovery.status, "saved");
    assert.equal(savedRecovery.operation, "leetcode_code_attempt_recovery");
    assert.equal(savedRecovery.result.status, "inserted");
    assert.equal(savedRecovery.result.recovery, true);

    const readyAfterRecovery = await call("get_activity_practice_record", { activityId: "activity-recovery" });
    assert.equal(readyAfterRecovery.codeAttempts.length, 1);
    assert.equal(readyAfterRecovery.codeAttempts[0].code, recoveredAttempt.code);
    assert.deepEqual(readyAfterRecovery.finalization, readyBeforeRecovery.finalization);
    const profileAfterRecovery = await call("get_problem_solution_profile", {
      specialty: "leetcode",
      questionId: "recovery-question",
    });
    assert.deepEqual(profileAfterRecovery, profileBeforeRecovery);

    const recoveryReplay = await call("recover_leetcode_code_attempt", recoveredAttempt);
    assert.equal(recoveryReplay.status, "saved");
    assert.equal(recoveryReplay.duplicate, true);
    const changedRecovery = await callRaw("recover_leetcode_code_attempt", {
      ...recoveredAttempt,
      code: "class Solution { int recovered() { return 7; } }",
    });
    assert.equal(changedRecovery.isError, true);
    assert.equal(changedRecovery.structuredContent.code, "specialist_write_identity_conflict");

    const publishedRecovery = await call("recover_leetcode_code_attempt", {
      ...recoveredAttempt,
      operationId: "operation-attempt-published-recovery-rejected",
      id: "attempt-published-recovery-1",
      activityId: "activity-published-recovery",
      originatingTurnId: "user-published-recovery-1",
      review: {
        ...recoveredAttempt.review,
        summary: "Published review.",
        whatWentWell: ["Correct."],
        whatToImprove: ["Improve names."],
        testingEvidence: ["Evidence."],
        nextStep: "Next.",
      },
      reviewResponseTurnId: "specialist-published-recovery-review-1",
    });
    const [publishedRecoveryReceipt] = await waitForJobs(call, [publishedRecovery.jobId], baseUrl);
    assert.equal(publishedRecoveryReceipt.status, "failed");
    assert.match(publishedRecoveryReceipt.failure.message, /published Code Attempt cannot be recovered/);

    const lateRecovery = await call("recover_leetcode_code_attempt", {
      ...recoveredAttempt,
      operationId: "operation-attempt-late-recovery-rejected",
      id: "attempt-late-recovery-1",
      sequence: 2,
      occurredAt: 201,
    });
    const [lateRecoveryReceipt] = await waitForJobs(call, [lateRecovery.jobId], baseUrl);
    assert.equal(lateRecoveryReceipt.status, "failed");
    assert.match(lateRecoveryReceipt.failure.message, /must predate the ready finalization/);
    const lateReviewRecovery = await call("recover_leetcode_code_attempt", {
      ...recoveredAttempt,
      operationId: "operation-attempt-late-review-recovery-rejected",
      id: "attempt-late-review-recovery-1",
      sequence: 3,
      review: { ...recoveredAttempt.review, reviewedAt: 201 },
    });
    const [lateReviewRecoveryReceipt] = await waitForJobs(call, [lateReviewRecovery.jobId], baseUrl);
    assert.equal(lateReviewRecoveryReceipt.status, "failed");
    assert.match(lateReviewRecoveryReceipt.failure.message, /must predate the ready finalization/);

    const recoveryCase = (slug, overrides = {}) => ({
      ...recoveredAttempt,
      operationId: `operation-attempt-${slug}-recovery`,
      id: `attempt-${slug}-recovery-1`,
      activityId: `activity-${slug}-recovery`,
      originatingTurnId: `user-${slug}-recovery-1`,
      reviewResponseTurnId: `specialist-${slug}-recovery-review-1`,
      ...overrides,
    });
    const rejectedRecoveries = [
      recoveryCase("missing"),
      recoveryCase("cross-owner"),
      recoveryCase("deleted"),
      recoveryCase("sequence"),
    ];
    const rejectedRecoveryJobs = await Promise.all(
      rejectedRecoveries.map((candidate) => call("recover_leetcode_code_attempt", candidate)),
    );
    const rejectedRecoveryReceipts = await waitForJobs(
      call,
      rejectedRecoveryJobs.map((job) => job.jobId),
      baseUrl,
    );
    assert.deepEqual(rejectedRecoveryReceipts.map((job) => job.status), ["failed", "failed", "failed", "failed"]);
    assert.match(rejectedRecoveryReceipts[0].failure.message, /owner-scoped user turn/);
    assert.match(rejectedRecoveryReceipts[1].failure.message, /owner-scoped user turn/);
    assert.match(rejectedRecoveryReceipts[2].failure.message, /transcript evidence changed/);
    assert.match(rejectedRecoveryReceipts[3].failure.message, /already belongs to another code version/);

    const concurrentRecovery = recoveryCase("concurrent");
    const concurrentRecoveryJobs = await Promise.all([
      call("recover_leetcode_code_attempt", concurrentRecovery),
      call("recover_leetcode_code_attempt", {
        ...concurrentRecovery,
        operationId: "operation-attempt-concurrent-recovery-replay",
      }),
    ]);
    const concurrentRecoveryReceipts = await waitForJobs(
      call,
      concurrentRecoveryJobs.map((job) => job.jobId),
      baseUrl,
    );
    assert.deepEqual(concurrentRecoveryReceipts.map((job) => job.status), ["saved", "saved"]);
    assert.deepEqual(
      concurrentRecoveryReceipts.map((job) => job.result.status).sort(),
      ["duplicate", "inserted"],
    );
    const concurrentRecord = await call("get_activity_practice_record", { activityId: "activity-concurrent-recovery" });
    assert.equal(concurrentRecord.codeAttempts.length, 1);
    assert.equal(concurrentRecord.codeAttempts[0].id, concurrentRecovery.id);

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
    const savedBankJobs = await waitForJobs(call, bankJobs.map((job) => job.operationId), baseUrl);
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

    const burstJobs = Array.from({ length: 12 }, (_, index) => ({
      operationId: `operation-bank-burst-${index + 1}`,
      specialty: "leetcode",
      questionId: `custom:leetcode:burst-${index + 1}`,
      title: `Burst write ${index + 1}`,
      tags: ["queue-reliability"],
      active: true,
    }));
    const queuedBurst = await Promise.all(
      burstJobs.map((question) => call("upsert_personal_bank_question", question)),
    );
    assert.ok(queuedBurst.every((job) => ["queued", "processing", "saved"].includes(job.status)));
    const savedBurst = await waitForJobs(call, burstJobs.map((job) => job.operationId), baseUrl);
    assert.ok(savedBurst.every((job) => job.status === "saved"));

    const bankReplays = await Promise.all(bankJobs.map((question) => call("upsert_personal_bank_question", question)));
    assert.ok(bankReplays.every((result) => result.status === "saved"));
    const replayedBankJobs = await waitForJobs(call, bankJobs.map((job) => job.operationId), baseUrl);
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
      sequence: 3,
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
    const partial = await waitForJobs(call, [invalidAttempt.jobId, independentBank.operationId], baseUrl);
    const invalidMetadataJob = await waitForJobs(call, [invalidMetadata.jobId], baseUrl);
    assert.equal(invalidMetadataJob[0].status, "failed");
    assert.equal(invalidMetadataJob[0].failure.retryable, false);
    assert.match(invalidMetadataJob[0].failure.message, /only valid for LeetCode/);
    assert.equal(partial[0].status, "failed");
    assert.equal(partial[0].failure.retryable, false);
    assert.match(partial[0].failure.message, /originating turn is not an owner-scoped user turn/);
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

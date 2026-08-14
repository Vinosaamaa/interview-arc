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
const MAX_WORKER_LOG_BYTES = 64 * 1024;
const profileProse = (topic, count) => Array.from({ length: count }, (_, index) => `${topic}${index + 1}`).join(" ");

function completeSystemDesignProfile() {
  return {
    schemaVersion: 1,
    summary: profileProse("summary", 20),
    sections: [
      { title: "Problem framing and assumptions", body: profileProse("scope", 45) },
      { title: "Functional requirements", body: profileProse("function", 30) },
      { title: "Non-functional requirements", body: profileProse("quality", 30) },
      { title: "Capacity estimates", body: `Assume 10 million users, 50k requests per second, 5 TB retained data, and p99 latency below 200 ms. ${profileProse("estimate", 30)}` },
      { title: "API contracts", body: `${profileProse("api", 40)}\n\n\`\`\`http\nPOST /v1/items\nContent-Type: application/json\n\n{"name":"example"}\n\`\`\`` },
      { title: "Data model", body: `${profileProse("data", 45)}\n\n\`\`\`sql\nCREATE TABLE items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);\n\`\`\`` },
      { title: "Architecture", body: `${profileProse("architecture", 90)}\n\n![Architecture](typed-delete-design.svg)` },
      { title: "End-to-end flows", body: profileProse("flow", 70) },
      { title: "Scaling and performance", body: profileProse("scaling", 60) },
      { title: "Reliability and failure recovery", body: profileProse("recovery", 65) },
      { title: "Security and privacy", body: profileProse("security", 50) },
      { title: "Observability and operations", body: profileProse("operation", 50) },
      { title: "Tradeoffs and alternatives", body: profileProse("tradeoff", 60) },
      { title: "Interview walkthrough", body: profileProse("walkthrough", 65) },
      { title: "Likely follow-ups", body: profileProse("followup", 35) },
    ],
    tags: ["reliability"],
    references: [],
    questionsAndAnswers: {
      status: "not_applicable",
      reason: "No substantial reusable question and answer exchange occurred in this fixture.",
      items: [],
    },
  };
}

function appendDiagnosticTail(current, chunk) {
  return `${current}${chunk}`.slice(-MAX_WORKER_LOG_BYTES);
}

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

const fixtureSql = (ownerTokenHash, otherTokenHash) => `
  INSERT INTO integration_tokens
    (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
  VALUES
    ('${ownerTokenHash}','owner-typed-delete','Typed deletion integration',1,NULL,NULL),
    ('${otherTokenHash}','owner-typed-delete-other','Other owner',1,NULL,NULL);

  INSERT INTO practice_workbenches
    (owner_id,id,status,opened_pacific_date,opened_at,closed_at,updated_at)
  VALUES ('owner-typed-delete','workbench-typed-delete','open','2026-08-09',1,NULL,1);
  INSERT INTO extra_activities
    (owner_id,id,date,workbench_id,payload,revision,updated_at)
  VALUES
    ('owner-typed-delete','activity-delete','2026-08-09','workbench-typed-delete','{"id":"activity-delete","type":"leetcode","title":"Deletion fixture","source":"extra","targetMinutes":40}',0,1),
    ('owner-typed-delete','activity-finalize-race','2026-08-09','workbench-typed-delete','{"schemaVersion":2,"id":"activity-finalize-race","questionId":"finalization-race-question","date":"2026-08-09","source":"extra","type":"systemDesign","title":"Finalization race fixture","timingSource":"website","status":"completed"}',1,900);
  INSERT INTO timers
    (owner_id,subject_id,kind,accumulated_seconds,started_at,running_since,completed,completed_at,revision,updated_at)
  VALUES
    ('owner-typed-delete','activity-delete','activity',123,10,NULL,0,NULL,4,500),
    ('owner-typed-delete','activity-finalize-race','activity',500,100,NULL,1,900,2,900);
  INSERT INTO outcomes
    (owner_id,activity_id,outcome,revision,updated_at)
  VALUES
    ('owner-typed-delete','activity-delete','failed',2,500),
    ('owner-typed-delete','activity-finalize-race','solved_after_reviewing_approach',1,900);
  INSERT INTO practice_notes
    (owner_id,id,activity_id,date,body,kind,pinned,created_at,updated_at)
  VALUES ('owner-typed-delete','note-delete','activity-delete','2026-08-09','Keep this note.','remember',1,400,400);

  INSERT INTO practice_transcript_turns
    (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
  VALUES
    ('owner-typed-delete','activity-delete','typed-user-delete','leetcode','user','Administrative user turn.','codex',0,100,700),
    ('owner-typed-delete','activity-delete','typed-response-delete','leetcode','specialist','Administrative response.','codex',1,200,800),
    ('owner-typed-delete','activity-delete','typed-user-preserve','leetcode','user','Real attempt.','codex',2,300,900),
    ('owner-typed-delete','activity-delete','typed-response-preserve','leetcode','specialist','Real review.','codex',3,400,900),
    ('owner-typed-delete','activity-code-anchor','typed-user-code','leetcode','user','Code attempt.','codex',0,100,600),
    ('owner-typed-delete','activity-code-anchor','typed-response-code','leetcode','specialist','Code review.','codex',1,200,600),
    ('owner-typed-delete','activity-partial','typed-user-partial','leetcode','user','Partial exchange.','codex',0,100,500),
    ('owner-typed-delete','activity-ready','typed-user-ready','leetcode','user','Ready exchange.','codex',0,100,500),
    ('owner-typed-delete','activity-ready','typed-response-ready','leetcode','specialist','Ready response.','codex',1,200,500),
    ('owner-typed-delete','activity-stale','typed-user-stale','leetcode','user','Stale exchange.','codex',0,100,500),
    ('owner-typed-delete','activity-stale','typed-response-stale','leetcode','specialist','Stale response.','codex',1,200,600),
    ('owner-typed-delete','activity-collision','typed-user-collision','leetcode','user','Collision user.','codex',0,100,500),
    ('owner-typed-delete','activity-collision','typed-response-collision','leetcode','specialist','Selected response.','codex',1,200,600),
    ('owner-typed-delete','activity-collision','typed-response-collision-other','leetcode','specialist','Competing response.','codex',1,210,610),
    ('owner-typed-delete','activity-concurrent-id','typed-user-concurrent-id','leetcode','user','Concurrent identity user.','codex',0,100,500),
    ('owner-typed-delete','activity-concurrent-id','typed-response-concurrent-id','leetcode','specialist','Concurrent identity response.','codex',1,200,600),
    ('owner-typed-delete','activity-concurrent-op','typed-user-concurrent-op','leetcode','user','Concurrent operation user.','codex',0,100,500),
    ('owner-typed-delete','activity-concurrent-op','typed-response-concurrent-op','leetcode','specialist','Concurrent operation response.','codex',1,200,600),
    ('owner-typed-delete','activity-legacy','typed-user-legacy','leetcode','user','Legacy append user.','codex',0,100,500),
    ('owner-typed-delete','activity-legacy','typed-response-legacy','leetcode','specialist','Legacy append response.','codex',1,200,600),
    ('owner-typed-delete','activity-review-race','review-origin-user','leetcode','user','Attempt source.','codex',0,100,500),
    ('owner-typed-delete','activity-review-race','review-origin-response','leetcode','specialist','Attempt acknowledgement.','codex',1,200,500),
    ('owner-typed-delete','activity-review-race','review-target-user','leetcode','user','Administrative review prompt.','codex',2,300,500),
    ('owner-typed-delete','activity-review-race','review-target-response','leetcode','specialist','Visible review. Good. Improve. Tested. Next.','codex',3,400,600),
    ('owner-typed-delete','activity-audio-race','typed-user-audio','leetcode','user','Audio target.','codex',0,100,500),
    ('owner-typed-delete','activity-audio-race','typed-response-audio','leetcode','specialist','Audio response.','codex',1,200,600),
    ('owner-typed-delete','activity-finalize-race','typed-user-finalize','system_design','user','Finalization target.','codex',0,100,500),
    ('owner-typed-delete','activity-finalize-race','typed-response-finalize','system_design','specialist','Finalization response.','codex',1,200,600),
    ('owner-typed-delete','activity-repair-anchor','typed-user-repair','leetcode','user','Repair target.','codex',0,100,500),
    ('owner-typed-delete','activity-repair-anchor','typed-response-repair','leetcode','specialist','Repair response.','codex',1,200,600),
    ('owner-typed-delete','activity-live-reserved','typed-user-live-reserved','system_design','user','Reserved Live user.','codex',0,100,500),
    ('owner-typed-delete','activity-live-reserved','typed-response-live-reserved','system_design','specialist','Reserved Live response.','codex',1,200,600),
    ('owner-typed-delete-other','activity-delete','typed-user-delete','leetcode','user','Other owner user.','codex',0,100,700),
    ('owner-typed-delete-other','activity-delete','typed-response-delete','leetcode','specialist','Other owner response.','codex',1,200,800);

  INSERT INTO leetcode_code_attempts
    (owner_id,id,activity_id,originating_turn_id,sequence,language,code,line_count,occurred_at,review,review_response_turn_id,observed_correctness,concrete_findings,edge_cases,complexity,final_declaration,created_at,updated_at)
  VALUES
    ('owner-typed-delete','attempt-preserve','activity-delete','typed-user-preserve',1,'java','class Solution {}',1,450,NULL,'typed-response-preserve','not_verified','[]','[]',NULL,'Preserve this attempt.',450,450),
    ('owner-typed-delete','attempt-code-anchor','activity-code-anchor','typed-user-code',1,'java','class Solution {}',1,250,NULL,'typed-response-code','not_verified','[]','[]',NULL,'Anchors the exchange.',250,250),
    ('owner-typed-delete','attempt-review-race','activity-review-race','review-origin-user',1,'java','class Solution {}',1,250,'{"schemaVersion":1,"status":"pending"}',NULL,'not_verified','[]','[]',NULL,'Pending review.',250,250);

  INSERT INTO voice_response_group_repair_events
    (owner_id,id,response_turn_id,activity_id,prior_status,result_status,reason,created_at)
  VALUES
    ('owner-typed-delete','repair-event-delete-fixture','typed-response-repair','activity-repair-anchor','quarantined_conflict','materialized','Preserve repair audit.',650);

  INSERT INTO live_turn_reservations
    (owner_id,activity_id,turn_id,pair_id,side,sequence,created_at)
  VALUES
    ('owner-typed-delete','activity-live-reserved','typed-user-live-reserved','live-reserved-pair','candidate',0,500),
    ('owner-typed-delete','activity-live-reserved','typed-response-live-reserved','live-reserved-pair','interviewer',1,500);

  INSERT INTO activity_finalizations
    (owner_id,activity_id,specialty,status,payload,finalized_at,published_at,revision,updated_at)
  VALUES ('owner-typed-delete','activity-ready','leetcode','ready','{}',300,NULL,1,300);
`;

test("typed exchange deletion is exact, atomic, owner-scoped, and identity-idempotent", { timeout: 90_000 }, async () => {
  const ownerToken = "ia_typed_exchange_delete_owner_token_178";
  const otherToken = "ia_typed_exchange_delete_other_token_178";
  let releaseIntegrationLock;
  let persistence;
  let worker;
  let ownerClient;
  let ownerRaceClient;
  let otherClient;
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-typed-delete-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", fixtureSql(sha256(ownerToken), sha256(otherToken))]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let workerLog = "";
    worker.stdout.on("data", (chunk) => { workerLog = appendDiagnosticTail(workerLog, chunk); });
    worker.stderr.on("data", (chunk) => { workerLog = appendDiagnosticTail(workerLog, chunk); });
    await waitForWorker(baseUrl, worker);

    const connect = async (name, token) => {
      const client = new Client({ name, version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }));
      return client;
    };
    ownerClient = await connect("typed-delete-owner", ownerToken);
    ownerRaceClient = await connect("typed-delete-owner-race", ownerToken);
    otherClient = await connect("typed-delete-other", otherToken);
    const callRaw = (client, name, args) => client.callTool({ name, arguments: args });
    const call = async (client, name, args) => {
      const result = await callRaw(client, name, args);
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}\n${workerLog}`);
      return result.structuredContent;
    };
    const waitForJob = async (jobId) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const status = await call(ownerClient, "get_specialist_write_status", { jobIds: [jobId] });
        const job = status.jobs[0];
        if (job && ["saved", "failed"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Specialist write ${jobId} did not settle.\n${workerLog}`);
    };

    const before = await call(ownerClient, "get_activity_practice_record", { activityId: "activity-delete" });
    assert.equal(before.typedExchanges.length, 2);
    const target = before.typedExchanges.find((exchange) => exchange.userTurnId === "typed-user-delete");
    assert.equal(target.revision, 800);

    const deletionInput = {
      operationId: "delete-typed-exchange-1",
      activityId: "activity-delete",
      userTurnId: "typed-user-delete",
      expectedRevision: target.revision,
      authorization: "explicit_user_instruction",
      reason: "The user confirmed this typed handoff was administrative.",
    };
    const deleted = await call(ownerClient, "delete_typed_practice_exchange", deletionInput);
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.duplicate, false);
    assert.equal(deleted.responseTurnId, "typed-response-delete");
    assert.deepEqual(deleted.deletedTurnIds, ["typed-user-delete", "typed-response-delete"]);

    const after = await call(ownerClient, "get_activity_practice_record", { activityId: "activity-delete" });
    assert.deepEqual(after.turns.map((turn) => turn.turnId), ["typed-user-preserve", "typed-response-preserve"]);
    assert.equal(after.notes[0].id, "note-delete");
    assert.equal(after.codeAttempts[0].id, "attempt-preserve");
    assert.equal(after.typedExchangeDeletions[0].operationId, deletionInput.operationId);
    assert.equal(after.typedExchangeDeletions[0].requestFingerprint, undefined);

    const replay = await call(ownerClient, "delete_typed_practice_exchange", deletionInput);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.deletedTurnIds, deleted.deletedTurnIds);

    const changedReplay = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      ...deletionInput,
      reason: "Changed retry payload.",
    });
    assert.equal(changedReplay.isError, true);
    assert.equal(changedReplay.structuredContent.code, "typed_exchange_operation_conflict");

    const recreated = await callRaw(ownerClient, "save_practice_exchange", {
      activityId: "activity-delete",
      activityTitle: "Deletion fixture",
      specialty: "leetcode",
      userTurn: { turnId: "typed-user-delete", body: "Administrative user turn.", occurredAt: 100 },
      specialistTurn: { turnId: "typed-response-delete", body: "Administrative response.", occurredAt: 200 },
    });
    assert.equal(recreated.isError, true);
    assert.equal(recreated.structuredContent.code, "typed_exchange_identity_deleted");

    const stale = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-stale",
      activityId: "activity-stale",
      userTurnId: "typed-user-stale",
      responseTurnId: "typed-response-stale",
      expectedRevision: 599,
      authorization: "explicit_user_instruction",
      reason: "Stale revision test.",
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.code, "typed_exchange_revision_conflict");

    const wrongReply = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-wrong-reply",
      activityId: "activity-stale",
      userTurnId: "typed-user-stale",
      responseTurnId: "typed-response-ready",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Wrong reply identity test.",
    });
    assert.equal(wrongReply.isError, true);
    assert.equal(wrongReply.structuredContent.code, "typed_exchange_reply_mismatch");

    const anchored = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-code-anchor",
      activityId: "activity-code-anchor",
      userTurnId: "typed-user-code",
      responseTurnId: "typed-response-code",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Dependent Code Attempt test.",
    });
    assert.equal(anchored.isError, true);
    assert.equal(anchored.structuredContent.code, "typed_exchange_has_dependent_evidence");

    const partial = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-partial",
      activityId: "activity-partial",
      userTurnId: "typed-user-partial",
      expectedRevision: 500,
      authorization: "explicit_user_instruction",
      reason: "Partial pair test.",
    });
    assert.equal(partial.isError, true);
    assert.equal(partial.structuredContent.code, "typed_exchange_reply_mismatch");

    const finalized = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-ready",
      activityId: "activity-ready",
      userTurnId: "typed-user-ready",
      responseTurnId: "typed-response-ready",
      expectedRevision: 500,
      authorization: "explicit_user_instruction",
      reason: "Finalization guard test.",
    });
    assert.equal(finalized.isError, true);
    assert.equal(finalized.structuredContent.code, "typed_exchange_has_dependent_evidence");

    const liveReserved = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-live-reserved",
      activityId: "activity-live-reserved",
      userTurnId: "typed-user-live-reserved",
      responseTurnId: "typed-response-live-reserved",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Live reservation dependency guard test.",
    });
    assert.equal(liveReserved.isError, true);
    assert.equal(liveReserved.structuredContent.code, "typed_exchange_has_dependent_evidence");
    assert.equal(liveReserved.structuredContent.live, 2);

    const crossOwner = await callRaw(otherClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-cross-owner",
      activityId: "activity-stale",
      userTurnId: "typed-user-stale",
      responseTurnId: "typed-response-stale",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Owner boundary test.",
    });
    assert.equal(crossOwner.isError, true);
    assert.equal(crossOwner.structuredContent.code, "typed_exchange_not_found");

    const collision = await call(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-collision",
      activityId: "activity-collision",
      userTurnId: "typed-user-collision",
      responseTurnId: "typed-response-collision",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Explicit response identity wins despite a sequence collision.",
    });
    assert.equal(collision.responseTurnId, "typed-response-collision");
    const collisionAfter = await call(ownerClient, "get_activity_practice_record", { activityId: "activity-collision" });
    assert.deepEqual(collisionAfter.turns.map((turn) => turn.turnId), ["typed-response-collision-other"]);

    const repairAnchored = await callRaw(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-repair-anchor",
      activityId: "activity-repair-anchor",
      userTurnId: "typed-user-repair",
      responseTurnId: "typed-response-repair",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Repair event dependency test.",
    });
    assert.equal(repairAnchored.isError, true);
    assert.equal(repairAnchored.structuredContent.code, "typed_exchange_has_dependent_evidence");
    assert.equal(repairAnchored.structuredContent.voice, 1);

    const concurrentIdentityBase = {
      activityId: "activity-concurrent-id",
      userTurnId: "typed-user-concurrent-id",
      responseTurnId: "typed-response-concurrent-id",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Concurrent identity deletion test.",
    };
    const concurrentIdentityResults = await Promise.all([
      callRaw(ownerClient, "delete_typed_practice_exchange", {
        ...concurrentIdentityBase,
        operationId: "delete-concurrent-identity-a",
      }),
      callRaw(ownerRaceClient, "delete_typed_practice_exchange", {
        ...concurrentIdentityBase,
        operationId: "delete-concurrent-identity-b",
      }),
    ]);
    assert.equal(concurrentIdentityResults.filter((result) => !result.isError).length, 1);
    const concurrentIdentityLoser = concurrentIdentityResults.find((result) => result.isError);
    assert.equal(concurrentIdentityLoser.structuredContent.code, "typed_exchange_already_deleted");
    assert.match(
      concurrentIdentityLoser.structuredContent.existingOperationId,
      /^delete-concurrent-identity-[ab]$/,
    );
    assert.equal(concurrentIdentityLoser.structuredContent.receipt.status, "deleted");

    const concurrentOperationBase = {
      operationId: "delete-concurrent-operation",
      activityId: "activity-concurrent-op",
      userTurnId: "typed-user-concurrent-op",
      responseTurnId: "typed-response-concurrent-op",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
    };
    const concurrentOperationResults = await Promise.all([
      callRaw(ownerClient, "delete_typed_practice_exchange", {
        ...concurrentOperationBase,
        reason: "Concurrent operation payload A.",
      }),
      callRaw(ownerRaceClient, "delete_typed_practice_exchange", {
        ...concurrentOperationBase,
        reason: "Concurrent operation payload B.",
      }),
    ]);
    assert.equal(concurrentOperationResults.filter((result) => !result.isError).length, 1);
    assert.equal(
      concurrentOperationResults.find((result) => result.isError).structuredContent.code,
      "typed_exchange_operation_conflict",
    );

    await call(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-typed-legacy",
      activityId: "activity-legacy",
      userTurnId: "typed-user-legacy",
      responseTurnId: "typed-response-legacy",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Legacy append tombstone test.",
    });
    const legacyAppend = await callRaw(ownerClient, "append_practice_transcript", {
      activityId: "activity-legacy",
      specialty: "leetcode",
      turns: [{
        turnId: "typed-user-legacy",
        speaker: "user",
        body: "Legacy append user.",
        source: "codex",
        sequence: 0,
        occurredAt: 100,
      }],
    });
    assert.equal(legacyAppend.isError, true);
    assert.equal(legacyAppend.structuredContent.code, "typed_exchange_identity_deleted");

    const completeReview = {
      schemaVersion: 1,
      status: "complete",
      summary: "Visible review.",
      whatWentWell: ["Good."],
      whatToImprove: ["Improve."],
      testingEvidence: ["Tested."],
      nextStep: "Next.",
      provenance: "specialist_observed",
      reviewedAt: 700,
    };
    const reviewJobId = "complete-review-race";
    const [reviewEnqueue, reviewDeletion] = await Promise.all([
      callRaw(ownerClient, "save_leetcode_code_attempt", {
        operationId: reviewJobId,
        id: "attempt-review-race",
        activityId: "activity-review-race",
        originatingTurnId: "review-origin-user",
        sequence: 1,
        language: "java",
        code: "class Solution {}",
        occurredAt: 250,
        review: completeReview,
        reviewResponseTurnId: "review-target-response",
        observedCorrectness: "not_verified",
        concreteFindings: ["Tested."],
        edgeCases: [],
        finalDeclaration: "Final.",
      }),
      callRaw(ownerRaceClient, "delete_typed_practice_exchange", {
        operationId: "delete-review-race",
        activityId: "activity-review-race",
        userTurnId: "review-target-user",
        responseTurnId: "review-target-response",
        expectedRevision: 600,
        authorization: "explicit_user_instruction",
        reason: "Code Attempt completion race test.",
      }),
    ]);
    assert.notEqual(reviewEnqueue.isError, true);
    const reviewJob = await waitForJob(reviewJobId);
    if (reviewDeletion.isError) {
      assert.equal(reviewDeletion.structuredContent.code, "typed_exchange_has_dependent_evidence");
      assert.equal(reviewJob.status, "saved");
    } else {
      assert.equal(reviewJob.status, "failed");
      assert.match(reviewJob.failure?.message, /transcript evidence changed during review completion/i);
    }

    const [audioDeletion, audioRegistration] = await Promise.all([
      callRaw(ownerClient, "delete_typed_practice_exchange", {
        operationId: "delete-audio-race",
        activityId: "activity-audio-race",
        userTurnId: "typed-user-audio",
        responseTurnId: "typed-response-audio",
        expectedRevision: 600,
        authorization: "explicit_user_instruction",
        reason: "Audio registration race test.",
      }),
      callRaw(ownerRaceClient, "register_activity_audio_clip", {
        activityId: "activity-audio-race",
        transcriptTurnId: "typed-user-audio",
        clipId: "clip-audio-race",
        filename: "race.m4a",
        mimeType: "audio/mp4",
      }),
    ]);
    assert.equal([audioDeletion, audioRegistration].filter((result) => !result.isError).length, 1);
    if (audioDeletion.isError) {
      assert.equal(audioDeletion.structuredContent.code, "typed_exchange_has_dependent_evidence");
    } else {
      assert.equal(audioRegistration.isError, true);
    }

    await call(ownerClient, "delete_typed_practice_exchange", {
      operationId: "delete-before-finalization",
      activityId: "activity-finalize-race",
      userTurnId: "typed-user-finalize",
      responseTurnId: "typed-response-finalize",
      expectedRevision: 600,
      authorization: "explicit_user_instruction",
      reason: "Finalization transcript snapshot baseline test.",
    });
    const finalizationAfterDeletion = await call(ownerClient, "save_specialist_finalization", {
      activityId: "activity-finalize-race",
      specialty: "system_design",
      questionId: "finalization-race-question",
      finalization: {
        title: "Finalization race fixture",
        complete: true,
        summary: "The exact typed exchange was removed before finalization, so the immutable record preserves an empty conversation without reconstructing it.",
        transcriptScope: "activity_exchanges",
        review: { didWell: ["Preserved the intended evidence."], improve: [] },
        modelAnswer: "A durable model answer.",
        references: [],
        interactionModeClassificationOperationId: "mode-finalization-after-deletion",
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: [],
          assistanceEvents: [],
        },
        solutionProfileAction: "create_or_revise",
        solutionProfile: completeSystemDesignProfile(),
        practiceRecord: {
          prompt: { body: "Design a deletion-safe finalization boundary.", canonicalUrl: null },
          responseStages: [{
            key: "deleted_exchange",
            state: "no_answer_provided",
            ownerResponse: null,
            mentorGuidance: null,
            finalUnderstanding: null,
            turnIds: [],
          }],
          nextDrill: "Explain why deletion and finalization must share an evidence fence.",
        },
      },
    });
    assert.equal(finalizationAfterDeletion.status, "ready");

    const preservation = await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--json", "--command", `
      SELECT CASE WHEN
          (SELECT count(*) FROM practice_transcript_turns WHERE owner_id='owner-typed-delete' AND activity_id='activity-delete') = 2
          AND (SELECT count(*) FROM typed_practice_exchange_deletions WHERE owner_id='owner-typed-delete' AND activity_id='activity-delete') = 1
          AND (SELECT count(*) FROM timers WHERE owner_id='owner-typed-delete' AND subject_id='activity-delete' AND revision=4) = 1
          AND (SELECT count(*) FROM outcomes WHERE owner_id='owner-typed-delete' AND activity_id='activity-delete' AND outcome='failed' AND revision=2) = 1
          AND (SELECT count(*) FROM practice_notes WHERE owner_id='owner-typed-delete' AND id='note-delete') = 1
          AND (SELECT count(*) FROM leetcode_code_attempts WHERE owner_id='owner-typed-delete' AND id IN ('attempt-preserve','attempt-code-anchor')) = 2
          AND (SELECT count(*) FROM practice_transcript_turns WHERE owner_id='owner-typed-delete' AND activity_id IN ('activity-code-anchor','activity-partial','activity-ready','activity-stale')) = 7
          AND (SELECT count(*) FROM practice_transcript_turns WHERE owner_id='owner-typed-delete-other' AND activity_id='activity-delete') = 2
          AND NOT EXISTS (
            SELECT 1 FROM activity_audio_clips clip
            LEFT JOIN practice_transcript_turns turn_row
              ON turn_row.owner_id=clip.owner_id
             AND turn_row.activity_id=clip.activity_id
             AND turn_row.turn_id=clip.transcript_turn_id
            WHERE clip.owner_id='owner-typed-delete'
              AND clip.transcript_turn_id IS NOT NULL
              AND turn_row.turn_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM leetcode_code_attempts attempt
            WHERE attempt.owner_id='owner-typed-delete'
              AND attempt.review_response_turn_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM practice_transcript_turns turn_row
                WHERE turn_row.owner_id=attempt.owner_id
                  AND turn_row.activity_id=attempt.activity_id
                  AND turn_row.turn_id=attempt.review_response_turn_id
              )
          )
        THEN 1 ELSE 0 END AS ok;
    `]);
    const preservationRows = JSON.parse(preservation.stdout);
    assert.equal(preservationRows[0]?.results?.[0]?.ok, 1, preservation.stdout);
  } finally {
    await ownerClient?.close().catch(() => {});
    await ownerRaceClient?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    if (worker && worker.exitCode === null) worker.kill("SIGTERM");
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

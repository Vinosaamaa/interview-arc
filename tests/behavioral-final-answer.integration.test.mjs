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
const MAX_DIAGNOSTIC_CHARS = 16_384;

function appendDiagnosticTail(current, chunk) {
  return `${current}${chunk}`.slice(-MAX_DIAGNOSTIC_CHARS);
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = appendDiagnosticTail(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendDiagnosticTail(stderr, chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

async function waitForWorker(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local MCP Worker exited ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/mcp`);
      if (response.status === 401 || response.status === 405) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local MCP Worker did not start.");
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent;
}

const callRaw = (client, name, args) => client.callTool({ name, arguments: args });

function finalization({
  activityId,
  questionId,
  operationId,
  answer,
  responseTurnId,
  correction,
  solutionRevision = 1,
  scope = "universal",
  target,
}) {
  return {
    activityId,
    specialty: "behavioral",
    questionId,
    finalization: {
      title: "Tell me about a reliability improvement",
      complete: true,
      transcriptScope: "full_activity",
      review: { didWell: ["Scoped the decision."], improve: ["Add a measured outcome."] },
      modelAnswer: answer,
      references: [],
      solutionProfileAction: "create_or_revise",
      solutionProfile: {
        schemaVersion: 1,
        summary: "Retry safety and evidence boundaries.",
        sections: [{ title: "Answer", body: answer }],
        tags: ["reliability"],
        references: [],
        behavioralAnswer: {
          preferred: {
            label: "Universal",
            answer,
            evidence: ["evidence-retry-boundary"],
            evidenceGaps: ["Production impact is not independently measured."],
          },
          alternatives: [],
        },
      },
      finalAnswerOperationId: operationId,
      finalAnswerSnapshot: {
        schemaVersion: 1,
        answer,
        scope,
        question: {
          questionId,
          title: "Tell me about a reliability improvement",
          prompt: "Tell me about a time you improved reliability.",
        },
        solutionProfile: { questionId, revision: solutionRevision },
        acceptedEvidenceIds: ["evidence-retry-boundary"],
        evidenceGaps: ["Production impact is not independently measured."],
        contradictions: [],
        provenance: { responseTurnId },
        ...(target ? { target } : {}),
      },
      ...(correction ? { finalAnswerCorrection: correction } : {}),
    },
  };
}

test("behavioral finalization stores immutable exact snapshots through MCP", { timeout: 90_000 }, async () => {
  const token = "ia_behavioral_final_answer_owner";
  const otherToken = "ia_behavioral_final_answer_other";
  const activityId = "activity-behavioral-final-answer";
  const questionId = "behavioral-reliability-1";
  const responseTurnId = "behavioral-response-1";
  const answer = "I stabilized delivery by making retries identity-idempotent.";
  const correctedAnswer = "I stabilized delivery with identity-idempotent retries and explicit receipts.";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-final-answer-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(token)}','owner-final-answer','Final answer owner',1,NULL,NULL),
        ('${sha256(otherToken)}','other-final-answer','Other owner',1,NULL,NULL);
      INSERT INTO practice_transcript_turns
        (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
      VALUES
        ('owner-final-answer','${activityId}','behavioral-user-1','behavioral','user','I improved retry reliability.','codex',1,1786363200000,1786363200000),
        ('owner-final-answer','${activityId}','${responseTurnId}','behavioral','specialist','${answer}','codex',2,1786363201000,1786363201000),
        ('owner-final-answer','${activityId}','behavioral-response-2','behavioral','specialist','${correctedAnswer}','codex',3,1786363202000,1786363202000),
        ('owner-final-answer','activity-behavioral-voice','behavioral-voice-user','behavioral','user','A recorded answer about retry reliability.','audio_transcript',1,1786363210000,1786363210000),
        ('owner-final-answer','activity-behavioral-voice','behavioral-voice-response','behavioral','specialist','${answer}','codex',2,1786363211000,1786363211000);
      INSERT INTO behavioral_evidence_items
        (owner_id,evidence_id,project_key,origin,statement,source_revision,evidence_grade,
         attribution_grade,claim_strength,candidate_state,visibility,safe_provenance,supports,
         limitations,tags,owner_attestation,created_at,updated_at)
      VALUES
        ('owner-final-answer','evidence-retry-boundary','example-project','user_statement',
         'I improved retry reliability.',NULL,'E1','A0','user_confirmation_required','accepted',
         'owner_private','[]','[]','[]','[]',NULL,1,1);
      INSERT INTO behavioral_evidence_question_links
        (owner_id,question_id,evidence_id,relevance,created_at,updated_at)
      VALUES
        ('owner-final-answer','${questionId}','evidence-retry-boundary','supporting',1,1),
        ('owner-final-answer','behavioral-reliability-voice','evidence-retry-boundary','supporting',1,1);
      INSERT INTO activity_finalizations
        (owner_id,activity_id,specialty,status,payload,finalized_at,published_at,revision,updated_at)
      VALUES
        ('owner-final-answer','activity-behavioral-legacy','behavioral','ready',
         '{"modelAnswer":"A historical answer saved before snapshot v1."}',1786363100000,NULL,1,1786363100000);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "ignore", "ignore"],
    });
    await waitForWorker(baseUrl, worker);
    client = new Client({ name: "final-answer-owner", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));

    const first = await call(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-1",
      answer,
      responseTurnId,
    }));
    assert.equal(first.finalAnswer.status, "created");
    assert.equal(first.finalAnswer.snapshotRevision, 1);

    const record = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(record.finalAnswer.source, "snapshot_v1");
    assert.equal(record.finalAnswer.answer, answer);
    assert.equal(record.finalAnswer.solutionProfile.revision, 1);
    assert.equal(record.finalAnswerSnapshots.length, 1);
    assert.equal(record.finalAnswerSnapshotsTruncated, false);
    assert.match(record.finalAnswerMarkdown, new RegExp(answer));
    assert.match(record.finalAnswerHtml, new RegExp(answer));

    const missingSnapshotPayload = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-missing",
      answer,
      responseTurnId,
    });
    delete missingSnapshotPayload.finalization.finalAnswerOperationId;
    delete missingSnapshotPayload.finalization.finalAnswerSnapshot;
    const missingSnapshot = await callRaw(client, "save_specialist_finalization", missingSnapshotPayload);
    assert.equal(missingSnapshot.isError, true);
    assert.equal(missingSnapshot.structuredContent.code, "behavioral_final_answer_required");

    const changedWithoutCorrection = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-no-correction",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
    }));
    assert.equal(changedWithoutCorrection.isError, true);
    assert.equal(changedWithoutCorrection.structuredContent.code, "behavioral_final_answer_correction_required");

    const exactRetry = await call(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-1",
      answer,
      responseTurnId,
    }));
    assert.equal(exactRetry.finalAnswer.status, "unchanged");
    assert.equal(exactRetry.finalAnswer.snapshotRevision, 1);

    const duplicateSnapshotIdentity = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-duplicate-identity",
      answer,
      responseTurnId,
    }));
    assert.equal(duplicateSnapshotIdentity.isError, true);
    assert.equal(
      duplicateSnapshotIdentity.structuredContent.code,
      "behavioral_final_answer_operation_conflict",
    );

    const changedOperationRetry = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-1",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      correction: { replacesSnapshotRevision: 1, reason: "Clarify the exact mechanism." },
    }));
    assert.equal(changedOperationRetry.isError, true);
    assert.equal(changedOperationRetry.structuredContent.code, "behavioral_final_answer_operation_conflict");

    const corrected = await call(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-2",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      correction: { replacesSnapshotRevision: 1, reason: "Clarify the exact mechanism." },
    }));
    assert.deepEqual(corrected.finalAnswer, { status: "corrected", snapshotRevision: 2 });
    const correctedRecord = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(correctedRecord.finalAnswer.answer, correctedAnswer);
    assert.equal(correctedRecord.finalAnswer.correctionOfRevision, 1);
    assert.equal(correctedRecord.finalAnswerSnapshots.length, 2);
    assert.equal(correctedRecord.finalAnswerSnapshots[0].snapshot.answer, answer);
    assert.equal(correctedRecord.finalAnswerSnapshots[1].snapshot.answer, correctedAnswer);

    const targetBlocked = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-target",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      scope: "target_tailored",
      target: {
        targetId: "target-example",
        revision: 1,
        label: "Example target",
        competencyEmphasis: ["reliability"],
      },
      correction: { replacesSnapshotRevision: 2, reason: "Tailor for an approved target." },
    }));
    assert.equal(targetBlocked.isError, true);
    assert.equal(targetBlocked.structuredContent.code, "behavioral_target_profile_unavailable");

    const voiceSaved = await call(client, "save_specialist_finalization", finalization({
      activityId: "activity-behavioral-voice",
      questionId: "behavioral-reliability-voice",
      operationId: "final-answer-operation-voice",
      answer,
      responseTurnId: "behavioral-voice-response",
    }));
    assert.equal(voiceSaved.finalAnswer.status, "created");
    const voiceRecord = await call(client, "get_activity_practice_record", {
      activityId: "activity-behavioral-voice",
    });
    assert.equal(voiceRecord.turns[0].source, "audio_transcript");
    assert.equal(voiceRecord.finalAnswer.answer, answer);

    const legacyRecord = await call(client, "get_activity_practice_record", {
      activityId: "activity-behavioral-legacy",
    });
    assert.equal(legacyRecord.finalAnswer.source, "legacy_model_answer");
    assert.equal(legacyRecord.finalAnswer.snapshotRevision, null);
    assert.deepEqual(legacyRecord.finalAnswerSnapshots, []);

    otherClient = new Client({ name: "final-answer-other", version: "1.0.0" });
    await otherClient.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${otherToken}` } },
    }));
    const isolated = await call(otherClient, "get_activity_practice_record", { activityId });
    assert.equal(isolated.finalAnswer, null);
    assert.deepEqual(isolated.finalAnswerSnapshots, []);
  } finally {
    await client?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    worker?.kill("SIGTERM");
    if (worker && worker.exitCode === null) await new Promise((resolve) => worker.once("exit", resolve));
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

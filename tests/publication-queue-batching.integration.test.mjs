import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));

const activityCount = 243;
const groupedActivityStart = 160;
const activitiesPerDate = 81;
const practiceDates = ["2026-07-01", "2026-07-02", "2026-07-03"];
const completionBases = practiceDates.map((date) => Date.parse(`${date}T15:00:00.000Z`));
const primaryOwner = "owner-publication-queue-primary";
const otherOwner = "owner-publication-queue-other";
const primaryToken = "ia_publication_queue_primary_276";
const otherToken = "ia_publication_queue_other_owner_276";
const primaryBlockedIndexes = new Set([0, 79, 80, 159, 160, 239, 240, 242]);
const primaryPracticeRecordIndexes = new Set(
  Array.from({ length: 110 }, (_, index) => index + 1),
);
const otherPracticeRecordIndexes = new Set(Array.from({ length: 111 }, (_, index) => index + 120));
const artifactBackedIndex = 159;
const clearedRecordOutcomeIndex = 79;

const activityId = (index) => `activity-${String(index).padStart(3, "0")}`;
const captureId = (index, member) => `capture-${String(index).padStart(3, "0")}-${member}`;
const clipId = (index, member) => `clip-${String(index).padStart(3, "0")}-${member}`;
const userTurnId = (index, member) => `turn-user-${String(index).padStart(3, "0")}-${member}`;
const responseTurnId = (index) => `turn-specialist-${String(index).padStart(3, "0")}`;

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
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

async function waitForWorker(baseUrl, child) {
  let lastError;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local MCP Worker exited ${child.exitCode} before startup.`);
    try {
      const response = await fetch(`${baseUrl}/mcp`);
      if (response.status === 401 || response.status === 405) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("Local MCP Worker did not start.");
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertRows(table, columns, rows) {
  if (!rows.length) return "";
  const statements = [];
  for (let index = 0; index < rows.length; index += 50) {
    statements.push(`INSERT INTO ${table} (${columns.join(",")}) VALUES\n${rows
      .slice(index, index + 50)
      .map((row) => `  (${row.map(sqlLiteral).join(",")})`)
      .join(",\n")};`);
  }
  return statements.join("\n");
}

function primaryEvidence(index, member) {
  const first = member.endsWith("0");
  if (index === 0) return { responseStatus: "provisional", clipStatus: "available", analysisStatus: "available" };
  if (index === 79 && first) return { responseStatus: "materialized", clipStatus: "local_only", analysisStatus: "available" };
  if (index === 80 && first) return { responseStatus: "materialized", clipStatus: "audio_lost", analysisStatus: "available" };
  if (index === 159 && first) return { responseStatus: "materialized", clipStatus: "available", analysisStatus: "queued" };
  if (index === 160 && first) return { responseStatus: "materialized", clipStatus: "available", analysisStatus: "failed" };
  if (index === 239) return { responseStatus: "provisional", clipStatus: "available", analysisStatus: "available" };
  if (index === 240 && first) return { responseStatus: "materialized", clipStatus: "missing", analysisStatus: "missing" };
  if (index === 242 && first) return { responseStatus: "materialized", clipStatus: "available", analysisStatus: "processing" };
  if (index === 241 && first) return {
    responseStatus: "materialized",
    clipStatus: "audio_lost",
    audioLostAcknowledgedAt: 9_999,
    analysisStatus: "available",
  };
  if (index === 238 && first) return {
    responseStatus: "materialized",
    clipStatus: "available",
    analysisStatus: "failed",
    publishWithoutReviewAcknowledgedAt: 9_999,
  };
  return { responseStatus: "materialized", clipStatus: "available", analysisStatus: "available" };
}

function evidenceFor(ownerId, index, member) {
  if (ownerId === primaryOwner) return primaryEvidence(index, member);
  return primaryBlockedIndexes.has(index)
    ? { responseStatus: "materialized", clipStatus: "available", analysisStatus: "available" }
    : { responseStatus: "materialized", clipStatus: "local_only", analysisStatus: "available" };
}

function fixtureSql(primaryTokenHash, otherTokenHash) {
  const workbenches = [];
  const extraActivities = [];
  const timers = [];
  const outcomes = [];
  const interactionModes = [];
  const intents = [];
  const clips = [];
  const analyses = [];
  const responses = [];
  const groups = [];
  const groupMembers = [];
  const turns = [];
  const practiceRecords = [];
  const practiceRecordRevisions = [];
  const contentArtifacts = [];

  for (const [ownerId, ownerLabel] of [[primaryOwner, "Primary"], [otherOwner, "Other"]]) {
    workbenches.push([ownerId, `workbench-${ownerLabel.toLowerCase()}`, "open", practiceDates[0], 1, null, 1]);
    for (let index = 0; index < activityCount; index += 1) {
      const id = activityId(index);
      const dateIndex = Math.floor(index / activitiesPerDate);
      const date = practiceDates[dateIndex];
      const completedAt = completionBases[dateIndex] + (index % activitiesPerDate) * 60_000;
      const startedAt = completedAt - 600_000;
      const specialty = ["leetcode", "system_design", "behavioral"][index % 3];
      const outcome = ["solved", "solved_after_reviewing_approach", "failed"][index % 3];
      const grouped = index >= groupedActivityStart;
      const members = grouped ? ["g0", "g1"] : ["s0"];
      const responseId = responseTurnId(index);
      const responseBody = `${ownerLabel} specialist response ${index}.`;
      const activity = {
        schemaVersion: 2,
        id,
        questionId: `question-${String(index).padStart(3, "0")}`,
        date,
        source: "extra",
        type: specialty,
        title: `${ownerLabel} backlog activity ${String(index).padStart(3, "0")}`,
        allocatedSeconds: specialty === "leetcode" ? 2_400 : 3_600,
        timerGroupId: id,
        timingSource: "website",
        status: "completed",
        ...(index === 2 ? {
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(completedAt).toISOString(),
          elapsedSeconds: 600,
        } : {}),
      };
      extraActivities.push([ownerId, id, date, `workbench-${ownerLabel.toLowerCase()}`, JSON.stringify(activity), 1, completedAt]);
      const recordIndexes = ownerId === primaryOwner ? primaryPracticeRecordIndexes : otherPracticeRecordIndexes;
      if (recordIndexes.has(index)) {
        const recordFingerprint = ownerId === primaryOwner ? "c".repeat(64) : "d".repeat(64);
        const operationId = `record-${ownerLabel.toLowerCase()}-${String(index).padStart(3, "0")}`;
        practiceRecords.push([
          ownerId,
          id,
          1,
          specialty,
          activity.questionId,
          activity.title,
          completedAt,
          date,
          outcome,
          1,
          recordFingerprint,
          operationId,
          completedAt,
        ]);
        practiceRecordRevisions.push([
          ownerId,
          id,
          1,
          operationId,
          `${recordFingerprint}-request`,
          recordFingerprint,
          JSON.stringify({ activityId: id, revision: 1 }),
          completedAt,
        ]);
      }
      if (index !== 2) timers.push([ownerId, id, "activity", 600, startedAt, null, 1, completedAt, 1, completedAt]);
      if (ownerId !== primaryOwner || index !== clearedRecordOutcomeIndex) {
        outcomes.push([ownerId, id, outcome, 1, completedAt]);
      }
      interactionModes.push([
        ownerId,
        id,
        ownerId === primaryOwner ? "mentor" : "grill",
        "2026-08-10.1",
        1,
        "explicit_user_instruction",
        `mode-${String(index).padStart(3, "0")}`,
        completedAt,
      ]);

      let groupStatus = "materialized";
      for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
        const member = members[memberIndex];
        const capture = captureId(index, member);
        const clip = clipId(index, member);
        const userTurn = userTurnId(index, member);
        const userBody = `${ownerLabel} user answer ${index}.${memberIndex}`;
        const occurredAt = completedAt - 5_000 + memberIndex;
        const evidence = evidenceFor(ownerId, index, member);
        groupStatus = evidence.responseStatus;
        intents.push([
          ownerId,
          capture,
          id,
          userTurn,
          clip,
          specialty,
          "accepted",
          ownerId === primaryOwner ? "a".repeat(64) : "b".repeat(64),
          occurredAt,
          occurredAt,
          "specialist",
          "Accepted integration evidence.",
          null,
          occurredAt,
          occurredAt,
        ]);
        turns.push([ownerId, id, userTurn, specialty, "user", userBody, "audio_transcript", memberIndex + 1, occurredAt, occurredAt]);
        if (evidence.clipStatus !== "missing") {
          clips.push([
            ownerId,
            clip,
            id,
            userTurn,
            `test/${clip}.m4a`,
            `${clip}.m4a`,
            "audio/mp4",
            "Synthetic answer",
            12,
            evidence.clipStatus,
            evidence.clipStatus === "audio_lost" ? "Synthetic loss fixture." : null,
            evidence.clipStatus === "audio_lost" ? occurredAt : null,
            evidence.audioLostAcknowledgedAt ?? null,
            occurredAt,
            occurredAt,
          ]);
        }
        if (evidence.analysisStatus !== "missing") {
          analyses.push([
            ownerId,
            `analysis-${String(index).padStart(3, "0")}-${member}`,
            id,
            clip,
            userTurn,
            specialty,
            evidence.analysisStatus,
            JSON.stringify({ schemaVersion: 1, summary: "Synthetic observable delivery evidence." }),
            evidence.analysisStatus === "failed" ? "Synthetic analysis failure." : null,
            evidence.publishWithoutReviewAcknowledgedAt ?? null,
            occurredAt,
            occurredAt,
          ]);
        }
        if (grouped) {
          groupMembers.push([
            ownerId,
            capture,
            responseId,
            id,
            userTurn,
            memberIndex,
            userBody,
            ownerId === primaryOwner ? "a".repeat(64) : "b".repeat(64),
            occurredAt,
            occurredAt,
            occurredAt,
          ]);
        } else {
          responses.push([
            ownerId,
            capture,
            id,
            userTurn,
            responseId,
            specialty,
            responseBody,
            completedAt - 4_000,
            evidence.responseStatus,
            occurredAt,
            occurredAt,
          ]);
        }
      }
      turns.push([ownerId, id, responseId, specialty, "specialist", responseBody, "codex", members.length + 1, completedAt - 4_000, completedAt - 4_000]);
      if (grouped) {
        groups.push([
          ownerId,
          responseId,
          id,
          specialty,
          responseBody,
          completedAt - 4_000,
          members.length,
          groupStatus,
          completedAt - 4_000,
          completedAt - 4_000,
        ]);
      }
    }
  }

  const artifactActivityId = activityId(artifactBackedIndex);
  contentArtifacts.push([
    `practice/legacy/${artifactActivityId}.md`,
    "leetcode-attempt",
    practiceDates[1],
    "Legacy published artifact",
    JSON.stringify({
      path: `practice/legacy/${artifactActivityId}.md`,
      type: "leetcode-attempt",
      title: "Legacy published artifact",
      date: practiceDates[1],
      activityId: artifactActivityId,
      status: "published",
      audioFile: "",
      audioAvailability: "unavailable",
      sections: [],
    }),
    completionBases[1],
  ]);

  return [
    insertRows("integration_tokens", ["token_hash", "owner_id", "label", "created_at", "last_used_at", "revoked_at"], [
      [primaryTokenHash, primaryOwner, "Publication queue primary integration", 1, null, null],
      [otherTokenHash, otherOwner, "Publication queue other integration", 1, null, null],
    ]),
    insertRows("practice_workbenches", ["owner_id", "id", "status", "opened_pacific_date", "opened_at", "closed_at", "updated_at"], workbenches),
    insertRows("extra_activities", ["owner_id", "id", "date", "workbench_id", "payload", "revision", "updated_at"], extraActivities),
    insertRows("timers", ["owner_id", "subject_id", "kind", "accumulated_seconds", "started_at", "running_since", "completed", "completed_at", "revision", "updated_at"], timers),
    insertRows("outcomes", ["owner_id", "activity_id", "outcome", "revision", "updated_at"], outcomes),
    insertRows("practice_interaction_mode_states", ["owner_id", "activity_id", "interaction_mode_id", "registry_version", "revision", "source", "last_mutation_id", "updated_at"], interactionModes),
    insertRows("voice_capture_intents", ["owner_id", "capture_id", "activity_id", "turn_id", "clip_id", "specialty", "status", "checksum", "occurred_at", "decided_at", "decision_source", "decision_reason", "last_error", "created_at", "updated_at"], intents),
    insertRows("activity_audio_clips", ["owner_id", "id", "activity_id", "transcript_turn_id", "object_key", "filename", "mime_type", "label", "duration_seconds", "status", "audio_lost_reason", "audio_lost_detected_at", "audio_lost_acknowledged_at", "created_at", "updated_at"], clips),
    insertRows("activity_delivery_analyses", ["owner_id", "id", "activity_id", "audio_clip_id", "transcript_turn_id", "specialty", "status", "payload", "error", "publish_without_review_acknowledged_at", "created_at", "updated_at"], analyses),
    insertRows("voice_specialist_responses", ["owner_id", "capture_id", "activity_id", "user_turn_id", "response_turn_id", "specialty", "response_body", "response_occurred_at", "status", "created_at", "updated_at"], responses),
    insertRows("voice_response_groups", ["owner_id", "response_turn_id", "activity_id", "specialty", "response_body", "response_occurred_at", "member_count", "status", "created_at", "updated_at"], groups),
    insertRows("voice_response_group_members", ["owner_id", "capture_id", "response_turn_id", "activity_id", "user_turn_id", "member_order", "transcript", "checksum", "occurred_at", "created_at", "updated_at"], groupMembers),
    insertRows("practice_transcript_turns", ["owner_id", "activity_id", "turn_id", "specialty", "speaker", "body", "source", "sequence", "occurred_at", "updated_at"], turns),
    insertRows("practice_records", ["owner_id", "activity_id", "current_revision", "specialty", "question_id", "title", "completed_at", "practice_date", "outcome", "solution_revision", "record_fingerprint", "finalization_operation_id", "updated_at"], practiceRecords),
    insertRows("practice_record_revisions", ["owner_id", "activity_id", "revision", "operation_id", "request_fingerprint", "record_fingerprint", "payload", "created_at"], practiceRecordRevisions),
    insertRows("content_artifacts", ["path", "type", "date", "title", "payload", "updated_at"], contentArtifacts),
  ].join("\n");
}

async function connectClient(baseUrl, token, name) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

async function publicationQueue(client) {
  const result = await client.callTool({ name: "get_publication_queue", arguments: {} });
  if (result.isError) throw new Error(`get_publication_queue failed: ${JSON.stringify(result.content)}`);
  assert.ok(result.structuredContent, "get_publication_queue must return structured content");
  return result.structuredContent;
}

function assertExactPartition(queue, readyIndexes, blockedIndexes, pendingIndexes) {
  const readyIds = readyIndexes.map(activityId);
  const blockedIds = blockedIndexes.map(activityId);
  assert.deepEqual(queue.activities.map((activity) => activity.id), readyIds);
  assert.deepEqual(queue.blockedActivities.map((activity) => activity.activityId), blockedIds);
  assert.equal(new Set(readyIds).size, readyIds.length, "ready activities must not be duplicated");
  assert.equal(new Set(blockedIds).size, blockedIds.length, "blocked activities must not be duplicated");
  assert.deepEqual(
    [...new Set([...readyIds, ...blockedIds])].sort(),
    pendingIndexes.map(activityId).sort(),
    "the complete last batch must be returned exactly once",
  );
  const readyDates = [...new Set(queue.activities.map((activity) => activity.practiceDate))].sort();
  assert.deepEqual(queue.groups, readyDates.map((date) => ({
    date,
    activities: queue.activities.filter((activity) => activity.practiceDate === date),
  })));
}

test("undated get_publication_queue returns a deterministic, exact, owner-scoped backlog across every D1 batch", { timeout: 180_000 }, async () => {
  let releaseIntegrationLock;
  let persistence;
  let worker;
  let primaryClient;
  let otherClient;
  let workerLog = "";
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-publication-queue-"));
    const seedPath = join(persistence, "publication-queue-seed.sql");
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const primaryTokenHash = createHash("sha256").update(primaryToken).digest("hex");
    const otherTokenHash = createHash("sha256").update(otherToken).digest("hex");
    await writeFile(seedPath, fixtureSql(primaryTokenHash, otherTokenHash), "utf8");
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--file", seedPath]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const appendWorkerLog = (chunk) => { workerLog = `${workerLog}${chunk}`.slice(-16_384); };
    worker.stdout.on("data", appendWorkerLog);
    worker.stderr.on("data", appendWorkerLog);
    await waitForWorker(baseUrl, worker);

    primaryClient = await connectClient(baseUrl, primaryToken, "publication-queue-primary-integration");
    otherClient = await connectClient(baseUrl, otherToken, "publication-queue-other-integration");
    const primaryQueue = await publicationQueue(primaryClient);
    const primaryReplay = await publicationQueue(primaryClient);
    const otherQueue = await publicationQueue(otherClient);
    assert.deepEqual(primaryReplay, primaryQueue, "repeated undated reads must be deterministic");

    const allIndexes = Array.from({ length: activityCount }, (_, index) => index);
    const primaryBlocked = allIndexes.filter((index) => (
      primaryBlockedIndexes.has(index) && index !== artifactBackedIndex
    ));
    const primaryReady = allIndexes.filter((index) => (
      !primaryPracticeRecordIndexes.has(index) && !primaryBlockedIndexes.has(index)
    ));
    const primaryPending = [...primaryReady, ...primaryBlocked].sort((left, right) => left - right);
    assert.equal(primaryQueue.date, null);
    assert.equal(primaryQueue.timeZone, "America/Los_Angeles");
    assertExactPartition(primaryQueue, primaryReady, primaryBlocked, primaryPending);
    assert.ok(primaryQueue.activities.every((activity) => activity.title.startsWith("Primary backlog activity")));
    assert.ok(primaryQueue.blockedActivities.every((activity) => activity.title.startsWith("Primary backlog activity")));
    assert.deepEqual(
      Object.fromEntries(primaryQueue.blockedActivities.map((activity) => [activity.activityId, activity.blockers.map((blocker) => ({
        captureId: blocker.captureId,
        kind: blocker.kind,
        status: blocker.status,
      }))])),
      {
        [activityId(0)]: [{ captureId: captureId(0, "s0"), kind: "transcript_not_materialized", status: "provisional" }],
        [activityId(79)]: [{ captureId: captureId(79, "s0"), kind: "audio_not_available", status: "local_only" }],
        [activityId(80)]: [{ captureId: captureId(80, "s0"), kind: "audio_lost_unacknowledged", status: "audio_lost" }],
        [activityId(160)]: [{ captureId: captureId(160, "g0"), kind: "delivery_review_failed", status: "failed" }],
        [activityId(239)]: [
          { captureId: captureId(239, "g0"), kind: "transcript_not_materialized", status: "provisional" },
          { captureId: captureId(239, "g1"), kind: "transcript_not_materialized", status: "provisional" },
        ],
        [activityId(240)]: [{ captureId: captureId(240, "g0"), kind: "audio_not_available", status: "missing" }],
        [activityId(242)]: [{ captureId: captureId(242, "g0"), kind: "delivery_review_pending", status: "processing" }],
      },
    );
    assert.equal(primaryQueue.activities.at(-1).id, activityId(241));
    assert.equal(primaryQueue.activities.find((activity) => activity.id === activityId(161)).audioClips.length, 2);
    assert.equal(primaryQueue.activities.find((activity) => activity.id === activityId(161)).deliveryAnalyses.length, 2);
    assert.deepEqual(
      primaryQueue.activities.find((activity) => activity.id === activityId(241)).recordingUnavailableClipIds,
      [clipId(241, "g0")],
    );

    assert.equal(otherQueue.date, null);
    assert.equal(otherQueue.timeZone, "America/Los_Angeles");
    const otherReady = allIndexes.filter((index) => (
      !otherPracticeRecordIndexes.has(index)
      && primaryBlockedIndexes.has(index)
      && index !== artifactBackedIndex
    ));
    const otherBlocked = allIndexes.filter((index) => !primaryBlockedIndexes.has(index));
    const otherPending = [...otherReady, ...otherBlocked].sort((left, right) => left - right);
    assertExactPartition(otherQueue, otherReady, otherBlocked, otherPending);
    assert.ok(otherQueue.activities.every((activity) => activity.title.startsWith("Other backlog activity")));
    assert.ok(otherQueue.blockedActivities.every((activity) => activity.title.startsWith("Other backlog activity")));
    for (const activity of otherQueue.blockedActivities) {
      const index = Number(activity.activityId.slice("activity-".length));
      const members = index >= groupedActivityStart ? ["g0", "g1"] : ["s0"];
      assert.deepEqual(activity.blockers.map((blocker) => ({
        captureId: blocker.captureId,
        kind: blocker.kind,
        status: blocker.status,
      })), members.map((member) => ({
        captureId: captureId(index, member),
        kind: "audio_not_available",
        status: "local_only",
      })));
    }
    assert.equal(otherQueue.activities.find((activity) => activity.id === activityId(239)).audioClips.length, 2);
    assert.equal(otherQueue.blockedActivities.some((activity) => activity.activityId === activityId(241)), true);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${workerLog}`);
  } finally {
    await primaryClient?.close();
    await otherClient?.close();
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

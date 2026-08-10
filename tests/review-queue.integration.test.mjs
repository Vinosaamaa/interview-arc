import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("./fixtures/wrangler.review-queue.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local Review Queue Worker exited ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/inspect`);
      if (response.status === 400) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local Review Queue Worker did not start.");
}

async function add(baseUrl, ownerId, workbenchId, mutationId, reviewKeys, now) {
  const response = await fetch(`${baseUrl}/review-add`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerId,
      now,
      input: {
        date: "2026-08-09",
        expectedWorkbenchId: workbenchId,
        expectedWorkbenchRevision: now / 10,
        mutationId,
        reviewKeys,
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

async function inspect(baseUrl, ownerId, workbenchId) {
  const response = await fetch(`${baseUrl}/inspect?ownerId=${encodeURIComponent(ownerId)}&workbenchId=${encodeURIComponent(workbenchId)}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function executeCommand(baseUrl, ownerId, command, now) {
  const response = await fetch(`${baseUrl}/practice-command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerId, date: "2026-08-09", command, now }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("concurrent Review Queue planning is atomic, replay-safe, and owner-isolated in D1", { timeout: 90_000 }, async () => {
  let releaseIntegrationLock;
  let persistence;
  let worker;
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-review-queue-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO practice_workbenches
        (owner_id,id,status,opened_pacific_date,opened_at,closed_at,updated_at)
      VALUES
        ('owner-replay','wb-replay','open','2026-08-09',1,NULL,100),
        ('owner-changed','wb-changed','open','2026-08-09',1,NULL,200),
        ('owner-race','wb-race','open','2026-08-09',1,NULL,300),
        ('owner-other','wb-other','open','2026-08-09',1,NULL,400),
        ('owner-payload','wb-payload','open','2026-08-09',1,NULL,500);
      INSERT INTO extra_activities
        (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES
        ('owner-replay','source-replay','2026-08-01',NULL,'{"id":"source-replay","date":"2026-08-01","type":"leetcode","title":"Replay Source","allocatedSeconds":2400}',1,1),
        ('owner-changed','source-changed-a','2026-08-01',NULL,'{"id":"source-changed-a","date":"2026-08-01","type":"leetcode","title":"Changed Source A","allocatedSeconds":2400}',1,1),
        ('owner-changed','source-changed-b','2026-08-02',NULL,'{"id":"source-changed-b","date":"2026-08-02","type":"behavioral","title":"Changed Source B","allocatedSeconds":3600}',1,1),
        ('owner-race','source-race','2026-08-01',NULL,'{"id":"source-race","date":"2026-08-01","type":"system_design","title":"Race Source","allocatedSeconds":3600}',1,1),
        ('owner-other','source-race','2026-08-01',NULL,'{"id":"source-race","date":"2026-08-01","type":"system_design","title":"Other Owner Source","allocatedSeconds":3600}',1,1);
      INSERT INTO timers
        (owner_id,subject_id,kind,accumulated_seconds,started_at,running_since,completed,completed_at,revision,updated_at)
      VALUES
        ('owner-replay','source-replay','activity',1200,1,NULL,1,2,1,2),
        ('owner-changed','source-changed-a','activity',1200,1,NULL,1,2,1,2),
        ('owner-changed','source-changed-b','activity',1800,1,NULL,1,2,1,2),
        ('owner-race','source-race','activity',1800,1,NULL,1,2,1,2),
        ('owner-other','source-race','activity',1800,1,NULL,1,2,1,2);
      INSERT INTO review_schedules
        (owner_id,review_key,activity_id,question_id,specialty,status,reason,due_date,interval_days,stage,review_count,created_at,updated_at)
      VALUES
        ('owner-replay','leetcode:replay','source-replay','replay','leetcode','due','failed','2026-08-09',4,0,0,1,1),
        ('owner-changed','leetcode:changed-a','source-changed-a','changed-a','leetcode','due','failed','2026-08-09',4,0,0,1,1),
        ('owner-changed','behavioral:changed-b','source-changed-b','changed-b','behavioral','due','approach_review','2026-08-09',7,0,0,1,1),
        ('owner-race','system_design:race','source-race','race','system_design','due','failed','2026-08-09',4,0,0,1,1),
        ('owner-other','system_design:race','source-race','race','system_design','due','failed','2026-08-09',4,0,0,1,1);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: "ignore",
    });
    await waitForWorker(baseUrl, worker);

    const exactActivity = {
      schemaVersion: 2,
      id: "payload-activity",
      questionId: "payload-question",
      date: "2026-08-09",
      source: "extra",
      type: "leetcode",
      recordKind: "attempt",
      title: "Preserve this exact activity",
      url: "https://leetcode.com/problems/two-sum/",
      allocatedSeconds: 2400,
      sessionId: "payload-session",
      timerGroupId: "payload-session",
      timingSource: "website",
      status: "planned",
      notes: "Keep every persisted field.",
      vocabularyPackIds: ["arrays"],
      speechTerms: ["two pointer"],
    };
    const exactSession = {
      id: "payload-session",
      date: "2026-08-09",
      label: "Payload session",
      source: "extra",
      allocatedSeconds: 2400,
      activityIds: ["payload-activity"],
    };
    await executeCommand(baseUrl, "owner-payload", { type: "extra-upsert", activity: exactActivity }, 5_010);
    await executeCommand(baseUrl, "owner-payload", { type: "session-upsert", session: exactSession }, 5_020);
    const payloadState = await inspect(baseUrl, "owner-payload", "wb-payload");
    assert.deepEqual(payloadState.activities[0].payload, { ...exactActivity, workbenchId: "wb-payload" });
    assert.deepEqual(payloadState.sessions[0].payload, { ...exactSession, workbenchId: "wb-payload" });

    const exactReplay = await Promise.all([
      add(baseUrl, "owner-replay", "wb-replay", "same-operation", ["leetcode:replay"], 1_000),
      add(baseUrl, "owner-replay", "wb-replay", "same-operation", ["leetcode:replay"], 1_000),
    ]);
    assert.deepEqual(exactReplay.map((result) => result.status), [200, 200]);
    assert.deepEqual(exactReplay.map((result) => result.body.duplicate).sort(), [false, true]);
    const replayState = await inspect(baseUrl, "owner-replay", "wb-replay");
    assert.equal(replayState.activities.length, 1);
    assert.equal(replayState.receipts.length, 1);

    const changedIdentity = await Promise.all([
      add(baseUrl, "owner-changed", "wb-changed", "changed-operation", ["leetcode:changed-a"], 2_000),
      add(baseUrl, "owner-changed", "wb-changed", "changed-operation", ["behavioral:changed-b"], 2_000),
    ]);
    assert.deepEqual(changedIdentity.map((result) => result.status).sort(), [200, 409]);
    assert.equal(changedIdentity.find((result) => result.status === 409)?.body.code, "planning_mutation_identity_conflict");
    const changedState = await inspect(baseUrl, "owner-changed", "wb-changed");
    assert.equal(changedState.activities.length, 1);
    assert.equal(changedState.receipts.length, 1);

    const competingMutations = await Promise.all([
      add(baseUrl, "owner-race", "wb-race", "race-operation-a", ["system_design:race"], 3_000),
      add(baseUrl, "owner-race", "wb-race", "race-operation-b", ["system_design:race"], 3_000),
    ]);
    assert.deepEqual(competingMutations.map((result) => result.status).sort(), [200, 409]);
    assert.ok(["already_planned", "stale_workbench_revision"].includes(
      competingMutations.find((result) => result.status === 409)?.body.code,
    ));
    const raceState = await inspect(baseUrl, "owner-race", "wb-race");
    assert.equal(raceState.activities.length, 1);
    assert.equal(raceState.receipts.length, 1);

    const otherOwner = await add(baseUrl, "owner-other", "wb-other", "other-operation", ["system_design:race"], 4_000);
    assert.equal(otherOwner.status, 200);
    const otherState = await inspect(baseUrl, "owner-other", "wb-other");
    assert.equal(otherState.activities.length, 1);
    assert.equal(otherState.receipts.length, 1);
    assert.equal((await inspect(baseUrl, "owner-race", "wb-race")).activities.length, 1);
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

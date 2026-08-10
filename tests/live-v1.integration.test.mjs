import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

const ownerToken = "ia_live_v1_owner_integration_token_128_bits";
const otherToken = "ia_live_v1_other_integration_token_128_bits";
const revokedToken = "ia_live_v1_revoked_integration_token_128_bits";

let baseUrl;
let persistence;
let releaseIntegrationLock;
let worker;
let workerLog = "";
let activeRoomLease;

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

async function waitForWorker() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (worker.exitCode !== null) {
      throw new Error(`Local MCP Worker exited ${worker.exitCode} before startup.\n${workerLog}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local MCP Worker did not start.\n${workerLog}`);
}

async function request(path, { token = ownerToken, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body !== "string" && !(init.body instanceof ArrayBuffer)) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, headers: response.headers, body };
}

async function queryLocalD1(command) {
  const { stdout } = await run(wrangler, [
    "d1", "execute", "DB", "--local", "--persist-to", persistence,
    "--config", config, "--command", command, "--json",
  ]);
  return JSON.parse(stdout)[0]?.results ?? [];
}

function currentPacificDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

before(async () => {
  releaseIntegrationLock = await acquireMcpIntegrationLock();
  persistence = await mkdtemp(join(tmpdir(), "interview-arc-live-v1-"));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
  await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
    INSERT INTO integration_tokens
      (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
    VALUES
      ('${sha256(ownerToken)}','owner-live','Interview Arc Live',1,NULL,NULL),
      ('${sha256(otherToken)}','other-live','Interview Arc Live',1,NULL,NULL),
      ('${sha256(revokedToken)}','owner-live','Revoked Live',1,NULL,2);
    INSERT INTO practice_workbenches
      (owner_id,id,status,opened_pacific_date,opened_at,closed_at,updated_at)
    VALUES
      ('owner-live','workbench-live','open','2026-08-09',100,NULL,100),
      ('other-live','workbench-other','open','2026-08-09',100,NULL,100);
    INSERT INTO extra_activities
      (owner_id,id,date,workbench_id,payload,revision,updated_at)
    VALUES
      ('owner-live','activity-design','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-design","questionId":"design-feed","date":"2026-08-09","source":"daily","type":"system_design","title":"Design a feed","prompt":"Design a global feed.","allocatedSeconds":3600,"sessionId":"session-live","timerGroupId":"activity-design","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-design-next','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-design-next","questionId":"design-chat","date":"2026-08-09","source":"daily","type":"system_design","title":"Design chat","prompt":"Design global chat.","allocatedSeconds":3600,"sessionId":"session-live","timerGroupId":"activity-design-next","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-code','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-code","questionId":"two-sum","date":"2026-08-09","source":"daily","type":"leetcode","title":"Two Sum","allocatedSeconds":2400,"sessionId":"session-live","timerGroupId":"activity-code","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-terminal','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-terminal","questionId":"design-terminal","date":"2026-08-09","source":"daily","type":"system_design","title":"Terminal mock","prompt":"Design a terminal mock.","allocatedSeconds":3600,"sessionId":"session-terminal","timerGroupId":"activity-terminal","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-race-a','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-race-a","questionId":"design-race-a","date":"2026-08-09","source":"extra","type":"system_design","title":"Race A","allocatedSeconds":3600,"timerGroupId":"activity-race-a","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-race-b','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-race-b","questionId":"design-race-b","date":"2026-08-09","source":"extra","type":"system_design","title":"Race B","allocatedSeconds":3600,"timerGroupId":"activity-race-b","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-finish-a','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-finish-a","questionId":"design-finish-a","date":"2026-08-09","source":"extra","type":"system_design","title":"Finish A","allocatedSeconds":3600,"sessionId":"session-finish-race","timerGroupId":"activity-finish-a","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-finish-b','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-finish-b","questionId":"design-finish-b","date":"2026-08-09","source":"extra","type":"system_design","title":"Finish B","allocatedSeconds":3600,"sessionId":"session-finish-race","timerGroupId":"activity-finish-b","timingSource":"website","status":"planned"}',1,100),
      ('owner-live','activity-published','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-published","questionId":"design-published","date":"2026-08-09","source":"extra","type":"system_design","title":"Published result","allocatedSeconds":3600,"timerGroupId":"activity-published","timingSource":"website","status":"completed"}',1,100),
      ('owner-live','activity-review-attempt','2026-08-09','workbench-live','{"schemaVersion":2,"id":"activity-review-attempt","questionId":"design-review","date":"2026-08-09","source":"extra","type":"system_design","title":"Review attempt","allocatedSeconds":3600,"timerGroupId":"activity-review-attempt","timingSource":"website","status":"planned","reviewOfActivityId":"activity-review-origin","reviewReason":"failed"}',1,100),
      ('other-live','activity-design','2026-08-09','workbench-other','{"schemaVersion":2,"id":"activity-design","questionId":"other-design","date":"2026-08-09","source":"daily","type":"system_design","title":"Other owner secret","prompt":"Do not disclose.","allocatedSeconds":3600,"timerGroupId":"activity-design","timingSource":"website","status":"planned"}',1,100);
    INSERT INTO live_sessions
      (owner_id,id,date,workbench_id,payload,revision,updated_at)
    VALUES
      ('owner-live','session-live','2026-08-09','workbench-live','{"id":"session-live","date":"2026-08-09","label":"System design session","activityIds":["activity-design","activity-design-next","activity-code"],"allocatedSeconds":9600}',1,100),
      ('owner-live','session-terminal','2026-08-09','workbench-live','{"id":"session-terminal","date":"2026-08-09","label":"Terminal session","activityIds":["activity-terminal"],"allocatedSeconds":3600}',1,100),
      ('owner-live','session-finish-race','2026-08-09','workbench-live','{"id":"session-finish-race","date":"2026-08-09","label":"Concurrent finish session","activityIds":["activity-finish-a","activity-finish-b"],"allocatedSeconds":7200}',1,100);
    INSERT INTO timers
      (owner_id,subject_id,kind,accumulated_seconds,started_at,running_since,completed,completed_at,revision,updated_at)
    VALUES
      ('owner-live','activity-design','activity',120,1000,NULL,0,NULL,3,2000),
      ('owner-live','activity-published','activity',300,1000,NULL,1,2000,2,2000),
      ('owner-live','session-live','session',120,1000,NULL,0,NULL,2,2000);
    INSERT INTO outcomes
      (owner_id,activity_id,outcome,revision,updated_at)
    VALUES ('owner-live','activity-design','solved_after_reviewing_approach',2,2000);
    INSERT INTO outcomes
      (owner_id,activity_id,outcome,revision,updated_at)
    VALUES ('owner-live','activity-published','solved',1,2000);
    INSERT INTO publication_statuses
      (owner_id,activity_id,date,status,artifact_path,published_at,revision,updated_at)
    VALUES ('owner-live','activity-published','2026-08-09','published','practice/system-design/published.md',2000,1,2000);
    INSERT INTO practice_focus
      (owner_id,activity_id,session_id,focused_at,updated_at)
    VALUES ('owner-live','activity-design','session-live',1000,2000);
    INSERT INTO practice_transcript_turns
      (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
    VALUES
      ('owner-live','activity-design','legacy-user','system_design','user','Owner transcript body','codex',0,1000,1000),
      ('other-live','activity-design','other-user','system_design','user','Other transcript body','codex',0,1000,1000);
    INSERT INTO live_activity_leases
      (owner_id,activity_id,holder_id,holder_session_id,fencing_token,expires_at,acquired_at,renewed_at,updated_at)
    VALUES ('owner-live','activity-design-next','00000000-0000-4000-8000-000000000001','expired-session',7,1,1,1,1);
    INSERT INTO voice_capture_intents
      (owner_id,capture_id,activity_id,turn_id,clip_id,specialty,status,checksum,occurred_at,decided_at,decision_source,decision_reason,last_error,created_at,updated_at)
    VALUES
      ('owner-live','terminal-pending-capture','activity-terminal','terminal-pending-turn','terminal-pending-clip','system_design','pending','${"1".repeat(64)}',4500,NULL,NULL,NULL,NULL,4500,4500);
  `]);
  worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.on("data", (chunk) => { workerLog += chunk; });
  worker.stderr.on("data", (chunk) => { workerLog += chunk; });
  await waitForWorker();
});

after(async () => {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise((resolve) => worker.once("exit", resolve));
  }
  if (persistence) await rm(persistence, { recursive: true, force: true });
  await releaseIntegrationLock?.();
});

test("Live bearer reads resume only the resolved owner's System Design work", async () => {
  for (const token of [null, "malformed", revokedToken]) {
    const unauthorized = await request("/live/v1/today", { token });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.code, "unauthorized");
  }
  const websocketCredential = await fetch(`${baseUrl}/live/v1/today`, {
    headers: { "sec-websocket-protocol": `ia-bearer.${Buffer.from(ownerToken).toString("base64url")}` },
  });
  assert.equal(websocketCredential.status, 401);

  const today = await request("/live/v1/today");
  assert.equal(today.status, 200, JSON.stringify({ body: today.body, workerLog }));
  assert.equal(today.body.protocolVersion, 1);
  assert.equal(today.body.workbench.id, "workbench-live");
  assert.equal(today.body.workbench.revision, 100);
  assert.equal(today.body.focus.activityId, "activity-design");
  assert.deepEqual(today.body.activities.map((activity) => activity.id), [
    "activity-finish-a",
    "activity-finish-b",
    "activity-design",
    "activity-design-next",
    "activity-code",
    "activity-terminal",
    "activity-race-a",
    "activity-race-b",
    "activity-review-attempt",
  ]);
  const plannedDesign = today.body.activities.find(({ id }) => id === "activity-design");
  assert.equal(plannedDesign.timer.revision, 3);
  assert.equal(plannedDesign.result.value, "solved_after_reviewing_approach");
  assert.equal(plannedDesign.result.revision, 2);
  assert.doesNotMatch(JSON.stringify(today.body), /transcript body|other owner secret/i);

  const activity = await request("/live/v1/activities/activity-design");
  assert.equal(activity.status, 200);
  assert.equal(activity.body.activity.id, "activity-design");
  assert.equal(activity.body.activity.type, "system_design");
  assert.deepEqual(activity.body.pairs, []);
  assert.deepEqual(activity.body.clips, []);
  assert.equal(activity.body.lease.active, false);
  assert.doesNotMatch(JSON.stringify(activity.body), /objectKey|authorization|provider|thread/i);

  const hiddenFromOtherOwner = await request("/live/v1/activities/activity-design", { token: otherToken });
  assert.equal(hiddenFromOtherOwner.status, 200);
  assert.equal(hiddenFromOtherOwner.body.activity.title, "Other owner secret");
  assert.doesNotMatch(JSON.stringify(hiddenFromOtherOwner.body), /Owner transcript body/);

  const nonSystemDesign = await request("/live/v1/activities/activity-code");
  assert.equal(nonSystemDesign.status, 404);
  assert.equal(nonSystemDesign.body.code, "activity_not_found");
});

test("Live leases enforce 90-second fenced ownership, expiry takeover, release, and receipts", async () => {
  const holderId = "11111111-1111-4111-8111-111111111111";
  const holderSessionId = "room-session-a";
  const acquireBody = {
    operationId: "lease-acquire-a",
    holderId,
    holderSessionId,
  };
  const acquired = await request("/live/v1/activities/activity-design/lease/acquire", {
    method: "POST",
    body: acquireBody,
  });
  assert.equal(acquired.status, 200, JSON.stringify({ body: acquired.body, workerLog }));
  assert.equal(acquired.body.duplicate, false);
  assert.equal(acquired.body.receipt.operation, "lease.acquire");
  assert.equal(acquired.body.lease.fencingToken, 1);
  assert.equal(acquired.body.lease.holderSessionId, holderSessionId);
  assert.equal(acquired.body.lease.expiresAt - acquired.body.receipt.committedAt, 90_000);
  assert.equal(acquired.body.activity.lease.active, true);
  assert.equal(acquired.body.activity.lease.holderPresent, true);
  assert.doesNotMatch(JSON.stringify(acquired.body.activity.lease), /holderId|holderSessionId|fencingToken/);

  const replay = await request("/live/v1/activities/activity-design/lease/acquire", {
    method: "POST",
    body: acquireBody,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.deepEqual(replay.body.receipt, acquired.body.receipt);

  const sameRoomRead = await request("/live/v1/activities/activity-design/lease/acquire", {
    method: "POST",
    body: { ...acquireBody, operationId: "lease-acquire-same-room-read" },
  });
  assert.equal(sameRoomRead.status, 200);
  assert.equal(sameRoomRead.body.lease.fencingToken, acquired.body.lease.fencingToken);
  assert.equal(sameRoomRead.body.lease.expiresAt, acquired.body.lease.expiresAt);

  const changedReplay = await request("/live/v1/activities/activity-design/lease/acquire", {
    method: "POST",
    body: { ...acquireBody, holderSessionId: "changed-room" },
  });
  assert.equal(changedReplay.status, 409);
  assert.equal(changedReplay.body.code, "idempotency_conflict");
  assert.equal(changedReplay.body.retryable, false);

  for (const contender of [
    { holderId: "22222222-2222-4222-8222-222222222222", holderSessionId: "other-install" },
    { holderId, holderSessionId: "same-install-new-room" },
  ]) {
    const held = await request("/live/v1/activities/activity-design/lease/acquire", {
      method: "POST",
      body: { operationId: `lease-contender-${contender.holderSessionId}`, ...contender },
    });
    assert.equal(held.status, 409);
    assert.equal(held.body.code, "lease_held");
    assert.equal(held.body.retryable, false);
    assert.equal(held.body.holderPresent, true);
    assert.equal(held.body.expiresAt, acquired.body.lease.expiresAt);
    assert.doesNotMatch(JSON.stringify(held.body), /11111111|room-session-a|fencingToken/);
  }

  const staleRenew = await request("/live/v1/activities/activity-design/lease/renew", {
    method: "POST",
    body: {
      operationId: "lease-renew-stale",
      holderId,
      holderSessionId,
      fencingToken: 999,
    },
  });
  assert.equal(staleRenew.status, 409);
  assert.equal(staleRenew.body.code, "lease_conflict");
  assert.equal(staleRenew.body.retryable, true);

  const renewed = await request("/live/v1/activities/activity-design/lease/renew", {
    method: "POST",
    body: {
      operationId: "lease-renew-a",
      holderId,
      holderSessionId,
      fencingToken: acquired.body.lease.fencingToken,
    },
  });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.lease.fencingToken, acquired.body.lease.fencingToken);
  assert.equal(renewed.body.lease.expiresAt - renewed.body.receipt.committedAt, 90_000);

  const foreignRelease = await request("/live/v1/activities/activity-design/lease/release", {
    method: "POST",
    body: {
      operationId: "lease-release-foreign",
      holderId: "22222222-2222-4222-8222-222222222222",
      holderSessionId: "other-install",
      fencingToken: acquired.body.lease.fencingToken,
    },
  });
  assert.equal(foreignRelease.status, 409);
  assert.equal(foreignRelease.body.code, "lease_conflict");

  const releaseBody = {
    operationId: "lease-release-a",
    holderId,
    holderSessionId,
    fencingToken: acquired.body.lease.fencingToken,
  };
  const released = await request("/live/v1/activities/activity-design/lease/release", {
    method: "POST",
    body: releaseBody,
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.activity.lease.active, false);
  const releaseReplay = await request("/live/v1/activities/activity-design/lease/release", {
    method: "POST",
    body: releaseBody,
  });
  assert.equal(releaseReplay.status, 200);
  assert.equal(releaseReplay.body.duplicate, true);
  assert.deepEqual(releaseReplay.body.receipt, released.body.receipt);

  const receipt = await request("/live/v1/activities/activity-design/receipts/lease-renew-a");
  assert.equal(receipt.status, 200);
  assert.deepEqual(receipt.body.receipt, renewed.body.receipt);
  const hiddenReceipt = await request("/live/v1/activities/activity-design/receipts/lease-renew-a", { token: otherToken });
  assert.equal(hiddenReceipt.status, 404);

  const takeovers = await Promise.all([
    "lease-expired-takeover-a",
    "lease-expired-takeover-b",
  ].map((operationId) => request("/live/v1/activities/activity-design-next/lease/acquire", {
    method: "POST",
    body: { operationId, holderId, holderSessionId: "room-session-next" },
  })));
  assert.deepEqual(takeovers.map(({ status }) => status), [200, 200]);
  assert.equal(takeovers[0].body.lease.fencingToken, 8);
  assert.equal(takeovers[1].body.lease.fencingToken, 8);
  assert.equal(takeovers[0].body.lease.expiresAt, takeovers[1].body.lease.expiresAt);
  assert.equal(takeovers[0].body.lease.holderSessionId, "room-session-next");
  const takeover = takeovers[0];
  const takeoverRelease = await request("/live/v1/activities/activity-design-next/lease/release", {
    method: "POST",
    body: {
      operationId: "lease-expired-takeover-release",
      holderId,
      holderSessionId: "room-session-next",
      fencingToken: takeover.body.lease.fencingToken,
    },
  });
  assert.equal(takeoverRelease.status, 200);
});

test("concurrent Live starts preserve the owner-wide single-active stopwatch invariant", async () => {
  const rooms = [
    {
      activityId: "activity-race-a",
      holderId: "66666666-6666-4666-8666-666666666666",
      holderSessionId: "room-race-a",
    },
    {
      activityId: "activity-race-b",
      holderId: "77777777-7777-4777-8777-777777777777",
      holderSessionId: "room-race-b",
    },
  ];
  const leases = await Promise.all(rooms.map((room) => request(
    `/live/v1/activities/${room.activityId}/lease/acquire`,
    {
      method: "POST",
      body: {
        operationId: `lease-${room.activityId}`,
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
      },
    },
  )));
  assert.deepEqual(leases.map(({ status }) => status), [200, 200]);

  const starts = await Promise.all(rooms.map((room, index) => request(
    `/live/v1/activities/${room.activityId}/commands`,
    {
      method: "POST",
      body: {
        operationId: `start-${room.activityId}`,
        command: "start",
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
        fencingToken: leases[index].body.lease.fencingToken,
        expectedWorkbenchRevision: 100,
        expectedTimerRevision: 0,
      },
    },
  )));
  assert.deepEqual(starts.map(({ status }) => status), [200, 200]);
  const today = await request("/live/v1/today");
  const raceTimers = today.body.activities
    .filter((activity) => activity.id.startsWith("activity-race-"))
    .map((activity) => activity.timer);
  assert.equal(raceTimers.every((timer) => timer?.startedAt != null), true);
  assert.equal(raceTimers.filter((timer) => timer?.runningSince != null).length, 1);
});

test("concurrent sibling finishes complete their parent session exactly once", async () => {
  const rooms = [
    {
      activityId: "activity-finish-a",
      holderId: "88888888-8888-4888-8888-888888888888",
      holderSessionId: "room-finish-a",
    },
    {
      activityId: "activity-finish-b",
      holderId: "99999999-9999-4999-8999-999999999999",
      holderSessionId: "room-finish-b",
    },
  ];
  const leases = [];
  for (const room of rooms) {
    const lease = await request(`/live/v1/activities/${room.activityId}/lease/acquire`, {
      method: "POST",
      body: {
        operationId: `lease-${room.activityId}`,
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
      },
    });
    assert.equal(lease.status, 200);
    leases.push(lease.body.lease);
  }

  for (const [index, room] of rooms.entries()) {
    const identity = { ...room, fencingToken: leases[index].fencingToken };
    const pair = await request(`/live/v1/activities/${room.activityId}/turn-pairs`, {
      method: "POST",
      body: {
        operationId: `pair-${room.activityId}`,
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
        fencingToken: identity.fencingToken,
        pairId: `pair-${room.activityId}`,
        candidate: {
          turnId: `candidate-${room.activityId}`,
          text: `Verified evidence for ${room.activityId}.`,
          evidenceStatus: "verified",
          occurredAt: 5_000 + index * 200,
        },
        interviewer: {
          turnId: `interviewer-${room.activityId}`,
          displayMarkdown: "Continue.",
          spokenText: "Continue.",
          occurredAt: 5_100 + index * 200,
        },
      },
    });
    assert.equal(pair.status, 200);
    const start = await request(`/live/v1/activities/${room.activityId}/commands`, {
      method: "POST",
      body: {
        operationId: `start-${room.activityId}`,
        command: "start",
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
        fencingToken: identity.fencingToken,
        expectedWorkbenchRevision: 100,
        expectedTimerRevision: 0,
      },
    });
    assert.equal(start.status, 200);
    const pause = await request(`/live/v1/activities/${room.activityId}/commands`, {
      method: "POST",
      body: {
        operationId: `pause-${room.activityId}`,
        command: "pause",
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
        fencingToken: identity.fencingToken,
        expectedWorkbenchRevision: 100,
        expectedTimerRevision: 1,
      },
    });
    assert.equal(pause.status, 200);
    const result = await request(`/live/v1/activities/${room.activityId}/commands`, {
      method: "POST",
      body: {
        operationId: `result-${room.activityId}`,
        command: "set_result",
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
        fencingToken: identity.fencingToken,
        expectedWorkbenchRevision: 100,
        expectedResultRevision: 0,
        result: "solved",
      },
    });
    assert.equal(result.status, 200);
  }

  const finishes = await Promise.all(rooms.map((room, index) => request(
    `/live/v1/activities/${room.activityId}/commands`,
    {
      method: "POST",
      body: {
        operationId: `finish-${room.activityId}`,
        command: "finish",
        holderId: room.holderId,
        holderSessionId: room.holderSessionId,
        fencingToken: leases[index].fencingToken,
        expectedWorkbenchRevision: 100,
        expectedTimerRevision: 2,
        expectedResultRevision: 1,
      },
    },
  )));
  assert.deepEqual(finishes.map(({ status }) => status), [200, 200]);
  const today = await request("/live/v1/today");
  const session = today.body.sessions.find(({ id }) => id === "session-finish-race");
  assert.equal(session.timer.completed, true);
  assert.equal(session.timer.runningSince, null);
});

test("Live commits exactly one immutable adjacent transcript pair under the current fence", async () => {
  const holderId = "33333333-3333-4333-8333-333333333333";
  const holderSessionId = "room-pairs";
  const lease = await request("/live/v1/activities/activity-design/lease/acquire", {
    method: "POST",
    body: { operationId: "lease-for-pairs", holderId, holderSessionId },
  });
  assert.equal(lease.status, 200);
  activeRoomLease = { holderId, holderSessionId, fencingToken: lease.body.lease.fencingToken };

  const pairBody = {
    operationId: "pair-operation-1",
    ...activeRoomLease,
    pairId: "pair-1",
    candidate: {
      turnId: "live-candidate-1",
      text: "I would partition the feed by viewer and rank fan-out candidates.",
      evidenceStatus: "best_available",
      occurredAt: 3_000,
    },
    interviewer: {
      turnId: "live-interviewer-1",
      displayMarkdown: "How would you handle celebrity fan-out?",
      spokenText: "How would you handle celebrity fan out?",
      occurredAt: 3_100,
    },
  };
  const committed = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: pairBody,
  });
  assert.equal(committed.status, 200, JSON.stringify({ body: committed.body, workerLog }));
  assert.equal(committed.body.duplicate, false);
  assert.equal(committed.body.receipt.operation, "turn_pair.commit");
  assert.equal(committed.body.pair.candidate.sequence, 1);
  assert.equal(committed.body.pair.interviewer.sequence, 2);
  assert.equal(committed.body.pair.candidate.evidenceStatus, "best_available");
  assert.equal(committed.body.pair.candidate.evidenceSatisfied, true);
  assert.equal(committed.body.activity.pairs.length, 1);
  assert.equal(committed.body.activity.pairs[0].candidate.text, pairBody.candidate.text);
  assert.equal(committed.body.activity.pairs[0].interviewer.displayMarkdown, pairBody.interviewer.displayMarkdown);

  const replay = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: pairBody,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.deepEqual(replay.body.receipt, committed.body.receipt);
  assert.equal(replay.body.activity.pairs.length, 1);

  const changedReplay = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      ...pairBody,
      candidate: { ...pairBody.candidate, text: "Changed retry must not rewrite evidence." },
    },
  });
  assert.equal(changedReplay.status, 409);
  assert.equal(changedReplay.body.code, "idempotency_conflict");

  const identityReuse = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      ...pairBody,
      operationId: "pair-operation-identity-reuse",
      interviewer: {
        ...pairBody.interviewer,
        turnId: "live-interviewer-identity-reuse",
      },
    },
  });
  assert.equal(identityReuse.status, 409);
  assert.equal(identityReuse.body.code, "idempotency_conflict");

  const crossRoleReuse = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      ...pairBody,
      operationId: "pair-operation-cross-role",
      pairId: "pair-cross-role",
      candidate: { ...pairBody.candidate, turnId: "live-candidate-cross-role", occurredAt: 3_200 },
      interviewer: { ...pairBody.interviewer, turnId: "live-candidate-1", occurredAt: 3_300 },
    },
  });
  assert.equal(crossRoleReuse.status, 409);
  assert.equal(crossRoleReuse.body.code, "idempotency_conflict");

  const noCandidate = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      ...pairBody,
      operationId: "pair-operation-no-candidate",
      pairId: "pair-no-candidate",
      candidate: {
        turnId: "live-candidate-none",
        text: "",
        evidenceStatus: "no_candidate",
        occurredAt: 3_400,
      },
      interviewer: { ...pairBody.interviewer, turnId: "live-interviewer-none", occurredAt: 3_500 },
    },
  });
  assert.equal(noCandidate.status, 422);
  assert.equal(noCandidate.body.code, "candidate_evidence_required");
  const afterRejected = await request("/live/v1/activities/activity-design");
  assert.equal(afterRejected.body.pairs.length, 1);

  const possible = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      ...pairBody,
      operationId: "pair-operation-possible",
      pairId: "pair-possible",
      candidate: {
        turnId: "live-candidate-possible",
        text: "The prompt may have leaked into this transcript segment.",
        evidenceStatus: "possible_contamination",
        occurredAt: 3_600,
      },
      interviewer: { ...pairBody.interviewer, turnId: "live-interviewer-possible", occurredAt: 3_700 },
    },
  });
  assert.equal(possible.status, 200);
  assert.equal(possible.body.pair.candidate.sequence, 3);
  assert.equal(possible.body.pair.interviewer.sequence, 4);
  assert.equal(possible.body.pair.candidate.evidenceSatisfied, false);
  assert.deepEqual(possible.body.activity.pairs.map((pair) => pair.pairId), ["pair-1", "pair-possible"]);

  const staleFence = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      ...pairBody,
      operationId: "pair-operation-stale-fence",
      pairId: "pair-stale-fence",
      fencingToken: activeRoomLease.fencingToken - 1,
      candidate: { ...pairBody.candidate, turnId: "live-candidate-stale", occurredAt: 3_800 },
      interviewer: { ...pairBody.interviewer, turnId: "live-interviewer-stale", occurredAt: 3_900 },
    },
  });
  assert.equal(staleFence.status, 409);
  assert.equal(staleFence.body.code, "lease_conflict");
  assert.equal(staleFence.body.retryable, true);
});

test("Live stages and streams optional private clips without weakening accepted text pairs", async () => {
  const clipBytes = new TextEncoder().encode("private-live-clip-content");
  const clipSha256 = sha256Bytes(clipBytes);
  const stageBody = {
    operationId: "clip-stage-1",
    ...activeRoomLease,
    clipId: "clip-live-1",
    candidateTurnId: "live-candidate-1",
    mimeType: "audio/mp4",
    byteSize: clipBytes.byteLength,
    sha256: clipSha256,
  };
  const staged = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: stageBody,
  });
  assert.equal(staged.status, 200, JSON.stringify({ body: staged.body, workerLog }));
  assert.equal(staged.body.clip.status, "staged");
  assert.equal(staged.body.clip.pairId, "pair-1");
  assert.equal(
    staged.body.activity.pairs.find((pair) => pair.pairId === "pair-1").clipId,
    "clip-live-1",
  );
  assert.doesNotMatch(JSON.stringify(staged.body), /objectKey|https?:\/\//i);

  const stageReplay = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: stageBody,
  });
  assert.equal(stageReplay.status, 200);
  assert.equal(stageReplay.body.duplicate, true);
  assert.deepEqual(stageReplay.body.receipt, staged.body.receipt);
  const restaged = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: { ...stageBody, operationId: "clip-stage-2" },
  });
  assert.equal(restaged.status, 200);
  assert.equal(restaged.body.duplicate, false);
  const restageReplay = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: { ...stageBody, operationId: "clip-stage-2" },
  });
  assert.equal(restageReplay.status, 200);
  assert.equal(restageReplay.body.duplicate, true);
  assert.deepEqual(restageReplay.body.receipt, restaged.body.receipt);
  const changedStage = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: { ...stageBody, sha256: "0".repeat(64) },
  });
  assert.equal(changedStage.status, 409);
  assert.equal(changedStage.body.code, "idempotency_conflict");

  const uploadHeaders = {
    "content-type": stageBody.mimeType,
    "content-length": String(stageBody.byteSize),
    "x-content-sha256": stageBody.sha256,
    "x-live-operation-id": "clip-upload-1",
    "x-live-holder-id": activeRoomLease.holderId,
    "x-live-holder-session-id": activeRoomLease.holderSessionId,
    "x-live-fencing-token": String(activeRoomLease.fencingToken),
  };
  const uploaded = await request("/live/v1/activities/activity-design/clips/clip-live-1/content", {
    method: "PUT",
    headers: uploadHeaders,
    body: clipBytes.buffer,
  });
  assert.equal(uploaded.status, 200, JSON.stringify({ body: uploaded.body, workerLog }));
  assert.equal(uploaded.body.clip.status, "available");
  assert.equal(uploaded.body.duplicate, false);

  const uploadReplay = await request("/live/v1/activities/activity-design/clips/clip-live-1/content", {
    method: "PUT",
    headers: uploadHeaders,
    body: clipBytes.buffer,
  });
  assert.equal(uploadReplay.status, 200);
  assert.equal(uploadReplay.body.duplicate, true);
  assert.deepEqual(uploadReplay.body.receipt, uploaded.body.receipt);

  const corruptAvailableOperation = "clip-upload-available-corrupt";
  const corruptAvailable = await request("/live/v1/activities/activity-design/clips/clip-live-1/content", {
    method: "PUT",
    headers: { ...uploadHeaders, "x-live-operation-id": corruptAvailableOperation },
    body: new Uint8Array(clipBytes.byteLength).fill(120).buffer,
  });
  assert.equal(corruptAvailable.status, 422);
  assert.equal(corruptAvailable.body.code, "clip_checksum_mismatch");
  const corruptReceipt = await request(
    `/live/v1/activities/activity-design/receipts/${corruptAvailableOperation}`,
  );
  assert.equal(corruptReceipt.status, 404);

  const concurrentUploadHeaders = {
    ...uploadHeaders,
    "x-live-operation-id": "clip-upload-available-concurrent",
  };
  const availableRetries = await Promise.all([
    request("/live/v1/activities/activity-design/clips/clip-live-1/content", {
      method: "PUT",
      headers: concurrentUploadHeaders,
      body: clipBytes.buffer,
    }),
    request("/live/v1/activities/activity-design/clips/clip-live-1/content", {
      method: "PUT",
      headers: concurrentUploadHeaders,
      body: clipBytes.buffer,
    }),
  ]);
  assert.deepEqual(availableRetries.map(({ status }) => status), [200, 200]);
  assert.deepEqual(availableRetries.map(({ body }) => body.duplicate).sort(), [false, true]);
  assert.deepEqual(availableRetries[0].body.receipt, availableRetries[1].body.receipt);

  const ranged = await fetch(`${baseUrl}/live/v1/activities/activity-design/clips/clip-live-1/content`, {
    headers: {
      authorization: `Bearer ${ownerToken}`,
      range: "bytes=0-6",
    },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 0-6/${clipBytes.byteLength}`);
  assert.equal(new TextDecoder().decode(await ranged.arrayBuffer()), "private");
  assert.doesNotMatch(ranged.url, /r2|object/i);
  const hiddenClip = await fetch(`${baseUrl}/live/v1/activities/activity-design/clips/clip-live-1/content`, {
    headers: { authorization: `Bearer ${otherToken}` },
  });
  assert.equal(hiddenClip.status, 404);

  const recoverableBytes = new TextEncoder().encode("recoverable-private-clip");
  const wrongBytes = new TextEncoder().encode("wrong-value-same-length!");
  assert.equal(wrongBytes.byteLength, recoverableBytes.byteLength);
  const failedStageBody = {
    operationId: "clip-stage-failure",
    ...activeRoomLease,
    clipId: "clip-live-failure",
    candidateTurnId: "live-candidate-possible",
    mimeType: "audio/mp4",
    byteSize: recoverableBytes.byteLength,
    sha256: sha256Bytes(recoverableBytes),
  };
  const failedStage = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: failedStageBody,
  });
  assert.equal(failedStage.status, 200);
  const failedUploadHeaders = {
    "content-type": failedStageBody.mimeType,
    "content-length": String(failedStageBody.byteSize),
    "x-content-sha256": failedStageBody.sha256,
    "x-live-operation-id": "clip-upload-recoverable",
    "x-live-holder-id": activeRoomLease.holderId,
    "x-live-holder-session-id": activeRoomLease.holderSessionId,
    "x-live-fencing-token": String(activeRoomLease.fencingToken),
  };
  const failedUpload = await request("/live/v1/activities/activity-design/clips/clip-live-failure/content", {
    method: "PUT",
    headers: failedUploadHeaders,
    body: wrongBytes.buffer,
  });
  assert.equal(failedUpload.status, 422);
  assert.equal(failedUpload.body.code, "clip_checksum_mismatch");
  assert.equal(failedUpload.body.retryable, true);
  const afterFailure = await request("/live/v1/activities/activity-design");
  assert.equal(afterFailure.body.pairs.length, 2);
  assert.equal(
    afterFailure.body.clips.find((clip) => clip.clipId === failedStageBody.clipId).status,
    "failed",
  );

  const recovered = await request("/live/v1/activities/activity-design/clips/clip-live-failure/content", {
    method: "PUT",
    headers: failedUploadHeaders,
    body: recoverableBytes.buffer,
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.clip.status, "available");

  const racePair = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      operationId: "clip-race-pair-operation",
      ...activeRoomLease,
      pairId: "clip-race-pair",
      candidate: {
        turnId: "clip-race-candidate",
        text: "This candidate text remains authoritative if two clip stages race.",
        evidenceStatus: "verified",
        occurredAt: 4_000,
      },
      interviewer: {
        turnId: "clip-race-interviewer",
        displayMarkdown: "Continue with the trade-off.",
        spokenText: "Continue with the trade off.",
        occurredAt: 4_100,
      },
    },
  });
  assert.equal(racePair.status, 200);
  const raceBytes = new TextEncoder().encode("one-raced-private-clip");
  const raceBase = {
    ...activeRoomLease,
    candidateTurnId: "clip-race-candidate",
    mimeType: "audio/mp4",
    byteSize: raceBytes.byteLength,
    sha256: sha256Bytes(raceBytes),
  };
  const racedStages = await Promise.all([
    request("/live/v1/activities/activity-design/clips/stage", {
      method: "POST",
      body: { ...raceBase, operationId: "clip-race-stage-a", clipId: "clip-race-a" },
    }),
    request("/live/v1/activities/activity-design/clips/stage", {
      method: "POST",
      body: { ...raceBase, operationId: "clip-race-stage-b", clipId: "clip-race-b" },
    }),
  ]);
  assert.deepEqual(racedStages.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(racedStages.find(({ status }) => status === 409).body.code, "idempotency_conflict");
  const afterRace = await request("/live/v1/activities/activity-design");
  assert.equal(afterRace.body.clips.filter((clip) => clip.candidateTurnId === "clip-race-candidate").length, 1);

  const stageFirstBytes = new TextEncoder().encode("stage-before-pair-private-clip");
  const stageFirst = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: {
      operationId: "clip-stage-before-pair",
      ...activeRoomLease,
      clipId: "clip-stage-first",
      candidateTurnId: "stage-first-candidate",
      mimeType: "audio/mp4",
      byteSize: stageFirstBytes.byteLength,
      sha256: sha256Bytes(stageFirstBytes),
    },
  });
  assert.equal(stageFirst.status, 200);
  assert.equal(stageFirst.body.clip.pairId, null);
  const pairedAfterStage = await request("/live/v1/activities/activity-design/turn-pairs", {
    method: "POST",
    body: {
      operationId: "pair-after-clip-stage",
      ...activeRoomLease,
      pairId: "pair-after-stage",
      candidate: {
        turnId: "stage-first-candidate",
        text: "The stable candidate identity should associate its already-staged clip.",
        evidenceStatus: "verified",
        occurredAt: 4_200,
      },
      interviewer: {
        turnId: "stage-first-interviewer",
        displayMarkdown: "Continue.",
        spokenText: "Continue.",
        occurredAt: 4_300,
      },
    },
  });
  assert.equal(pairedAfterStage.status, 200);
  assert.equal(pairedAfterStage.body.pair.clipId, "clip-stage-first");
  assert.equal(
    pairedAfterStage.body.activity.clips.find((clip) => clip.clipId === "clip-stage-first").pairId,
    "pair-after-stage",
  );

  const fenceReuseBytes = new TextEncoder().encode("immutable-upload-operation");
  const fenceReuseStage = {
    operationId: "clip-stage-fence-reuse",
    ...activeRoomLease,
    clipId: "clip-fence-reuse",
    candidateTurnId: "live-candidate-1",
    mimeType: "audio/mp4",
    byteSize: fenceReuseBytes.byteLength,
    sha256: sha256Bytes(fenceReuseBytes),
  };
  const fenceReuseStaged = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: fenceReuseStage,
  });
  assert.equal(fenceReuseStaged.status, 409);
  assert.equal(fenceReuseStaged.body.code, "idempotency_conflict");

  const reusableCandidate = "fence-reuse-candidate";
  const reusableStage = await request("/live/v1/activities/activity-design/clips/stage", {
    method: "POST",
    body: {
      ...fenceReuseStage,
      operationId: "clip-stage-fence-reuse-unique",
      candidateTurnId: reusableCandidate,
    },
  });
  assert.equal(reusableStage.status, 200);
  const failedReuseHeaders = {
    "content-type": "audio/mp4",
    "content-length": String(fenceReuseBytes.byteLength),
    "x-content-sha256": sha256Bytes(fenceReuseBytes),
    "x-live-operation-id": "clip-upload-fence-reuse",
    "x-live-holder-id": activeRoomLease.holderId,
    "x-live-holder-session-id": activeRoomLease.holderSessionId,
    "x-live-fencing-token": String(activeRoomLease.fencingToken),
  };
  const failedReuse = await request("/live/v1/activities/activity-design/clips/clip-fence-reuse/content", {
    method: "PUT",
    headers: failedReuseHeaders,
    body: new Uint8Array(fenceReuseBytes.byteLength).fill(120).buffer,
  });
  assert.equal(failedReuse.status, 422);
  const releasedForFenceReuse = await request("/live/v1/activities/activity-design/lease/release", {
    method: "POST",
    body: { operationId: "clip-fence-reuse-release", ...activeRoomLease },
  });
  assert.equal(releasedForFenceReuse.status, 200);
  const nextHolder = {
    holderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    holderSessionId: "room-after-clip-fence",
  };
  const acquiredAfterFenceReuse = await request("/live/v1/activities/activity-design/lease/acquire", {
    method: "POST",
    body: { operationId: "clip-fence-reuse-acquire", ...nextHolder },
  });
  assert.equal(acquiredAfterFenceReuse.status, 200);
  activeRoomLease = {
    ...nextHolder,
    fencingToken: acquiredAfterFenceReuse.body.lease.fencingToken,
  };
  const changedFenceReuse = await request("/live/v1/activities/activity-design/clips/clip-fence-reuse/content", {
    method: "PUT",
    headers: {
      ...failedReuseHeaders,
      "x-live-holder-id": activeRoomLease.holderId,
      "x-live-holder-session-id": activeRoomLease.holderSessionId,
      "x-live-fencing-token": String(activeRoomLease.fencingToken),
    },
    body: fenceReuseBytes.buffer,
  });
  assert.equal(changedFenceReuse.status, 409);
  assert.equal(changedFenceReuse.body.code, "idempotency_conflict");
});

test("Live result commands keep published results read-only", async () => {
  const holderId = "77777777-7777-4777-8777-777777777777";
  const holderSessionId = "room-published-result";
  const acquired = await request("/live/v1/activities/activity-published/lease/acquire", {
    method: "POST",
    body: { operationId: "published-result-lease", holderId, holderSessionId },
  });
  assert.equal(acquired.status, 200, JSON.stringify({ body: acquired.body, workerLog }));
  const identity = { holderId, holderSessionId, fencingToken: acquired.body.lease.fencingToken };
  const setResult = await request("/live/v1/activities/activity-published/commands", {
    method: "POST",
    body: {
      operationId: "published-result-set",
      command: "set_result",
      ...identity,
      expectedWorkbenchRevision: 100,
      expectedResultRevision: 1,
      result: "failed",
    },
  });
  assert.equal(setResult.status, 409);
  assert.equal(setResult.body.code, "timer_completed");
  assert.equal(setResult.body.retryable, false);

  const clearResult = await request("/live/v1/activities/activity-published/commands", {
    method: "POST",
    body: {
      operationId: "published-result-clear",
      command: "clear_result",
      ...identity,
      expectedWorkbenchRevision: 100,
      expectedResultRevision: 1,
    },
  });
  assert.equal(clearResult.status, 409);
  assert.equal(clearResult.body.code, "timer_completed");
  const persisted = await request("/live/v1/activities/activity-published");
  assert.equal(persisted.body.activity.result.value, "solved");
  assert.equal(persisted.body.activity.result.revision, 1);
});

test("a solved review attempt advances recall cadence and uses its Pacific completion date", async () => {
  const holderId = "88888888-8888-4888-8888-888888888888";
  const holderSessionId = "room-review-attempt";
  const acquired = await request("/live/v1/activities/activity-review-attempt/lease/acquire", {
    method: "POST",
    body: { operationId: "review-attempt-lease", holderId, holderSessionId },
  });
  assert.equal(acquired.status, 200, JSON.stringify({ body: acquired.body, workerLog }));
  const identity = { holderId, holderSessionId, fencingToken: acquired.body.lease.fencingToken };
  const command = (body) => request("/live/v1/activities/activity-review-attempt/commands", {
    method: "POST",
    body: { ...identity, expectedWorkbenchRevision: 100, ...body },
  });
  const result = await command({
    operationId: "review-attempt-result",
    command: "set_result",
    expectedResultRevision: 0,
    result: "solved",
  });
  assert.equal(result.status, 200);
  const started = await command({
    operationId: "review-attempt-start",
    command: "start",
    expectedTimerRevision: 0,
  });
  assert.equal(started.status, 200);
  const pair = await request("/live/v1/activities/activity-review-attempt/turn-pairs", {
    method: "POST",
    body: {
      operationId: "review-attempt-pair",
      ...identity,
      pairId: "review-attempt-pair",
      candidate: {
        turnId: "review-attempt-candidate",
        text: "I can now retrieve the design trade-offs without looking at the prior approach.",
        evidenceStatus: "verified",
        occurredAt: 7_000,
      },
      interviewer: {
        turnId: "review-attempt-interviewer",
        displayMarkdown: "That recall is sufficient.",
        spokenText: "That recall is sufficient.",
        occurredAt: 7_100,
      },
    },
  });
  assert.equal(pair.status, 200);
  const completionDate = currentPacificDate();
  assert.notEqual(completionDate, "2026-08-09");
  const finished = await command({
    operationId: "review-attempt-finish",
    command: "finish",
    expectedTimerRevision: started.body.activity.activity.timer.revision,
    expectedResultRevision: result.body.activity.activity.result.revision,
  });
  assert.equal(finished.status, 200, JSON.stringify({ body: finished.body, workerLog }));

  const reviews = await queryLocalD1(`
    SELECT activity_id, reason, interval_days, stage, review_count
    FROM review_schedules
    WHERE owner_id = 'owner-live' AND review_key = 'system_design:design-review';
  `);
  assert.deepEqual(reviews, [{
    activity_id: "activity-review-attempt",
    reason: "successful_recall",
    interval_days: 21,
    stage: 1,
    review_count: 1,
  }]);
  const publications = await queryLocalD1(`
    SELECT date, status
    FROM publication_statuses
    WHERE owner_id = 'owner-live' AND activity_id = 'activity-review-attempt';
  `);
  assert.deepEqual(publications, [{ date: completionDate, status: "ready" }]);
});

test("Live commands atomically control result, timer, and deterministic finish-next state", async () => {
  const command = (body) => request("/live/v1/activities/activity-design/commands", {
    method: "POST",
    body: { ...activeRoomLease, expectedWorkbenchRevision: 100, ...body },
  });

  const clear = await command({
    operationId: "command-clear-result",
    command: "clear_result",
    expectedResultRevision: 2,
  });
  assert.equal(clear.status, 200, JSON.stringify({ body: clear.body, workerLog }));
  assert.equal(clear.body.activity.activity.result.value, null);
  const setBody = {
    operationId: "command-set-result",
    command: "set_result",
    expectedResultRevision: 0,
    result: "solved",
  };
  const set = await command(setBody);
  assert.equal(set.status, 200);
  assert.equal(set.body.activity.activity.result.value, "solved");
  assert.equal(set.body.activity.activity.result.revision, 1);
  const setReplay = await command(setBody);
  assert.equal(setReplay.status, 200);
  assert.equal(setReplay.body.duplicate, true);
  assert.deepEqual(setReplay.body.receipt, set.body.receipt);
  const changedSetReplay = await command({ ...setBody, result: "failed" });
  assert.equal(changedSetReplay.status, 409);
  assert.equal(changedSetReplay.body.code, "idempotency_conflict");
  const afterChangedSet = await request("/live/v1/activities/activity-design");
  assert.equal(afterChangedSet.body.activity.result.value, "solved");

  const started = await command({
    operationId: "command-start-1",
    command: "start",
    expectedTimerRevision: 3,
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.activity.activity.timer.revision, 4);
  assert.equal(started.body.activity.activity.timer.runningSince != null, true);
  assert.equal(started.body.activity.session.timer.revision, 3);
  assert.equal(started.body.activity.session.timer.runningSince != null, true);
  const startReplay = await command({
    operationId: "command-start-1",
    command: "start",
    expectedTimerRevision: 3,
  });
  assert.equal(startReplay.status, 200);
  assert.equal(startReplay.body.duplicate, true);
  assert.equal(startReplay.body.activity.activity.timer.revision, 4);

  const paused = await command({
    operationId: "command-pause-1",
    command: "pause",
    expectedTimerRevision: 4,
  });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.activity.activity.timer.revision, 5);
  assert.equal(paused.body.activity.activity.timer.runningSince, null);
  assert.equal(paused.body.activity.session.timer.runningSince != null, true);

  const restarted = await command({
    operationId: "command-start-2",
    command: "start",
    expectedTimerRevision: 5,
  });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.activity.activity.timer.revision, 6);
  const stalePause = await command({
    operationId: "command-pause-stale",
    command: "pause",
    expectedTimerRevision: 5,
  });
  assert.equal(stalePause.status, 409);
  assert.equal(stalePause.body.code, "revision_conflict");
  assert.equal(stalePause.body.retryable, true);

  const malformedExplicitAdvance = await command({
    operationId: "command-finish-next-missing-target-revision",
    command: "finish-next",
    expectedTimerRevision: 6,
    expectedResultRevision: 1,
    nextActivityId: "activity-design-next",
  });
  assert.equal(malformedExplicitAdvance.status, 400);
  assert.equal(malformedExplicitAdvance.body.code, "invalid_request");
  const malformedImplicitAdvance = await command({
    operationId: "command-finish-next-missing-discovered-revision",
    command: "finish-next",
    expectedTimerRevision: 6,
    expectedResultRevision: 1,
  });
  assert.equal(malformedImplicitAdvance.status, 400);
  assert.equal(malformedImplicitAdvance.body.code, "invalid_request");

  const advanced = await command({
    operationId: "command-finish-next",
    command: "finish-next",
    expectedTimerRevision: 6,
    expectedResultRevision: 1,
    expectedNextTimerRevision: 0,
  });
  assert.equal(advanced.status, 200, JSON.stringify({ body: advanced.body, workerLog }));
  assert.equal(advanced.body.selectedNextActivityId, "activity-design-next");
  assert.equal(advanced.body.activity.activity.timer.completed, true);
  assert.equal(advanced.body.activity.activity.timer.revision, 7);
  assert.equal(advanced.body.activity.lease.active, false);
  assert.equal(advanced.body.today.focus.activityId, "activity-design-next");
  const nextToday = advanced.body.today.activities.find((activity) => activity.id === "activity-design-next");
  assert.equal(nextToday.timer.revision, 1);
  assert.equal(nextToday.timer.runningSince != null, true);
  const nextProjection = await request("/live/v1/activities/activity-design-next");
  assert.equal(nextProjection.body.lease.active, false);

  const fencedAfterFinish = await command({
    operationId: "command-after-terminal-release",
    command: "pause",
    expectedTimerRevision: 7,
  });
  assert.equal(fencedAfterFinish.status, 409);
  assert.equal(fencedAfterFinish.body.code, "lease_conflict");
});

test("Live finish is evidence-gated and no-next rejection is side-effect-free", async () => {
  const holderId = "44444444-4444-4444-8444-444444444444";
  const holderSessionId = "room-terminal";
  const lease = await request("/live/v1/activities/activity-terminal/lease/acquire", {
    method: "POST",
    body: { operationId: "terminal-lease", holderId, holderSessionId },
  });
  assert.equal(lease.status, 200);
  const terminalLease = { holderId, holderSessionId, fencingToken: lease.body.lease.fencingToken };
  const pair = await request("/live/v1/activities/activity-terminal/turn-pairs", {
    method: "POST",
    body: {
      operationId: "terminal-pair",
      ...terminalLease,
      pairId: "terminal-pair",
      candidate: {
        turnId: "terminal-candidate",
        text: "This segment may include interviewer words.",
        evidenceStatus: "possible_contamination",
        occurredAt: 5_000,
      },
      interviewer: {
        turnId: "terminal-interviewer",
        displayMarkdown: "Please continue.",
        spokenText: "Please continue.",
        occurredAt: 5_100,
      },
    },
  });
  assert.equal(pair.status, 200);
  const terminalCommand = (body) => request("/live/v1/activities/activity-terminal/commands", {
    method: "POST",
    body: { ...terminalLease, expectedWorkbenchRevision: 100, ...body },
  });
  const result = await terminalCommand({
    operationId: "terminal-result",
    command: "set_result",
    expectedResultRevision: 0,
    result: "solved_after_reviewing_approach",
  });
  assert.equal(result.status, 200);
  const started = await terminalCommand({
    operationId: "terminal-start",
    command: "start",
    expectedTimerRevision: 0,
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.activity.activity.timer.revision, 1);

  const blocked = await terminalCommand({
    operationId: "terminal-finish-blocked",
    command: "finish",
    expectedTimerRevision: 1,
    expectedResultRevision: 1,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "candidate_evidence_required");
  const afterBlocked = await request("/live/v1/activities/activity-terminal");
  assert.equal(afterBlocked.body.activity.timer.completed, false);
  assert.equal(afterBlocked.body.activity.timer.revision, 1);
  assert.equal(afterBlocked.body.lease.active, true);

  const confirmed = await terminalCommand({
    operationId: "terminal-confirm-evidence",
    command: "confirm_candidate_evidence",
    pairId: "terminal-pair",
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.confirmation.pairId, "terminal-pair");
  assert.equal(confirmed.body.activity.pairs[0].candidate.evidenceSatisfied, true);
  const confirmationReplay = await terminalCommand({
    operationId: "terminal-confirm-evidence",
    command: "confirm_candidate_evidence",
    pairId: "terminal-pair",
  });
  assert.equal(confirmationReplay.status, 200);
  assert.equal(confirmationReplay.body.duplicate, true);

  const noNext = await terminalCommand({
    operationId: "terminal-no-next",
    command: "finish-next",
    expectedTimerRevision: 1,
    expectedResultRevision: 1,
  });
  assert.equal(noNext.status, 409);
  assert.equal(noNext.body.code, "no_next_activity");
  const afterNoNext = await request("/live/v1/activities/activity-terminal");
  assert.equal(afterNoNext.body.activity.timer.completed, false);
  assert.equal(afterNoNext.body.activity.timer.revision, 1);
  assert.equal(afterNoNext.body.lease.active, true);
  const pendingAfterNoNext = await request("/voice/intents?captureId=terminal-pending-capture");
  assert.equal(pendingAfterNoNext.body.intents[0].status, "pending");
  const rejectedReceipt = await request("/live/v1/activities/activity-terminal/receipts/terminal-no-next");
  assert.equal(rejectedReceipt.status, 404);

  const finished = await terminalCommand({
    operationId: "terminal-finish",
    command: "finish",
    expectedTimerRevision: 1,
    expectedResultRevision: 1,
  });
  assert.equal(finished.status, 200, JSON.stringify({ body: finished.body, workerLog }));
  assert.equal(finished.body.activity.activity.timer.completed, true);
  assert.equal(finished.body.activity.activity.timer.revision, 2);
  assert.equal(finished.body.activity.session.timer.completed, true);
  assert.equal(finished.body.activity.lease.active, false);
  const discardedAfterFinish = await request("/voice/intents?captureId=terminal-pending-capture");
  assert.equal(discardedAfterFinish.body.intents[0].status, "discarded_unclassified");
});

test("a missed Live invalidation is recovered by an authoritative reconnect reread", async () => {
  const before = await request("/live/v1/today");
  const holderId = "55555555-5555-4555-8555-555555555555";
  const holderSessionId = "room-reconnect";
  const lease = await request("/live/v1/activities/activity-design-next/lease/acquire", {
    method: "POST",
    body: { operationId: "reconnect-lease", holderId, holderSessionId },
  });
  assert.equal(lease.status, 200);
  const command = await request("/live/v1/activities/activity-design-next/commands", {
    method: "POST",
    body: {
      operationId: "reconnect-result",
      command: "set_result",
      holderId,
      holderSessionId,
      fencingToken: lease.body.lease.fencingToken,
      expectedWorkbenchRevision: 100,
      expectedResultRevision: 0,
      result: "solved",
    },
  });
  assert.equal(command.status, 200, JSON.stringify({ body: command.body, workerLog }));
  const pair = await request("/live/v1/activities/activity-design-next/turn-pairs", {
    method: "POST",
    body: {
      operationId: "reconnect-pair",
      holderId,
      holderSessionId,
      fencingToken: lease.body.lease.fencingToken,
      pairId: "reconnect-pair",
      candidate: {
        turnId: "reconnect-candidate",
        text: "A durable candidate answer survives a missed invalidation.",
        evidenceStatus: "verified",
        occurredAt: 6_000,
      },
      interviewer: {
        turnId: "reconnect-interviewer",
        displayMarkdown: "That is enough for this recovery check.",
        spokenText: "That is enough for this recovery check.",
        occurredAt: 6_100,
      },
    },
  });
  assert.equal(pair.status, 200);
  const finished = await request("/live/v1/activities/activity-design-next/commands", {
    method: "POST",
    body: {
      operationId: "reconnect-finish",
      command: "finish",
      holderId,
      holderSessionId,
      fencingToken: lease.body.lease.fencingToken,
      expectedWorkbenchRevision: 100,
      expectedTimerRevision: command.body.activity.activity.timer.revision,
      expectedResultRevision: 1,
    },
  });
  assert.equal(finished.status, 200, JSON.stringify({ body: finished.body, workerLog }));
  assert.equal(finished.body.activity.activity.timer.completed, true);
  assert.equal(finished.body.activity.session.timer.completed, false);
  assert.equal(finished.body.activity.lease.active, false);

  // The local contract fixture has no connected Durable Object subscriber.
  // Re-reading after that missed hint still recovers the committed D1 state.
  const reconnected = await request("/live/v1/today");
  assert.equal(reconnected.status, 200);
  assert.equal(reconnected.body.ownerRevision > before.body.ownerRevision, true);
  assert.equal(reconnected.body.activities.some((activity) => activity.id === "activity-design-next"), false);
  assert.equal(reconnected.body.sessions.find((session) => session.id === "session-live").timer.completed, false);
});

test("Today owner revision remains monotonic after the open workbench closes", async () => {
  const before = await request("/live/v1/today");
  assert.equal(before.body.ownerRevision > 0, true);
  await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
    UPDATE practice_workbenches
    SET status = 'closed', closed_at = 999999, updated_at = 999999
    WHERE owner_id = 'owner-live' AND id = 'workbench-live';
  `]);
  const closed = await request("/live/v1/today");
  assert.equal(closed.status, 200);
  assert.equal(closed.body.workbench, null);
  assert.equal(closed.body.ownerRevision >= before.body.ownerRevision, true);
});

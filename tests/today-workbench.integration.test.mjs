import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
    if (child.exitCode !== null) throw new Error(`Local MCP Worker exited ${child.exitCode}.`);
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
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}

test("Today deletion and all-session projection remain owner-scoped and revision-safe", { timeout: 90_000 }, async () => {
  const ownerToken = "ia_today_workbench_owner_integration_token";
  const otherToken = "ia_today_workbench_other_integration_token";
  let releaseIntegrationLock;
  let persistence;
  let worker;
  let owner;
  let other;
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-today-workbench-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(ownerToken)}','owner-today','Owner Today',1,NULL,NULL),
        ('${sha256(otherToken)}','other-today','Other Today',1,NULL,NULL);
      INSERT INTO practice_workbenches
        (owner_id,id,status,opened_pacific_date,opened_at,closed_at,updated_at)
      VALUES
        ('owner-today','workbench-owner','open','2026-08-09',1,NULL,100),
        ('other-today','workbench-other','open','2026-08-09',1,NULL,200);
      INSERT INTO extra_activities
        (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES
        ('owner-today','remove-a','2026-08-09','workbench-owner','{"id":"remove-a","date":"2026-08-09","sessionId":"session-1","type":"leetcode","title":"Remove A","allocatedSeconds":2400}',1,1),
        ('owner-today','remove-b','2026-08-09','workbench-owner','{"id":"remove-b","date":"2026-08-09","sessionId":"session-1","type":"leetcode","title":"Remove B","allocatedSeconds":2400}',1,1),
        ('owner-today','session-three','2026-08-09','workbench-owner','{"id":"session-three","date":"2026-08-09","sessionId":"session-3","type":"leetcode","title":"Session Three","allocatedSeconds":2400}',1,1),
        ('owner-today','completed-row','2026-08-09','workbench-owner','{"id":"completed-row","date":"2026-08-09","sessionId":"session-3","type":"behavioral","title":"Completed Row","allocatedSeconds":3600}',1,1),
        ('owner-today','standalone','2026-08-09','workbench-owner','{"id":"standalone","date":"2026-08-09","type":"system_design","title":"Standalone","allocatedSeconds":3600}',1,1),
        ('other-today','other-row','2026-08-09','workbench-other','{"id":"other-row","date":"2026-08-09","type":"leetcode","title":"Other Row","allocatedSeconds":2400}',1,1);
      INSERT INTO live_sessions
        (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES
        ('owner-today','session-1','2026-08-09','workbench-owner','{"id":"session-1","date":"2026-08-09","label":"Session 1","allocatedSeconds":4800,"activityIds":["remove-a","remove-b"]}',1,1),
        ('owner-today','session-3','2026-08-09','workbench-owner','{"id":"session-3","date":"2026-08-09","label":"Session 3","allocatedSeconds":6000,"activityIds":["session-three","completed-row"]}',1,1);
      INSERT INTO timers
        (owner_id,subject_id,kind,accumulated_seconds,started_at,running_since,completed,completed_at,revision,updated_at)
      VALUES
        ('owner-today','completed-row','activity',120,10,NULL,1,130,1,130);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForWorker(baseUrl, worker);
    owner = await connect(baseUrl, ownerToken, "today-owner");

    const input = {
      expectedWorkbenchId: "workbench-owner",
      expectedWorkbenchRevision: 100,
      mutationId: "remove-owner-a-b",
      activityIds: ["remove-a", "remove-b", "completed-row", "unknown-row"],
      authorization: "explicit_user_instruction",
    };
    const removed = await call(owner, "remove_today_practice_activities", input);
    assert.equal(removed.duplicate, false);
    assert.deepEqual(removed.result.deletedIds, ["remove-a", "remove-b"]);
    assert.deepEqual(
      removed.result.rejected.map((item) => [item.activityId, item.code]),
      [
        ["completed-row", "timer_started"],
        ["unknown-row", "not_in_current_workbench"],
      ],
    );
    assert.deepEqual(
      removed.authoritative.timerInstrument.workbenchActivities.map((item) => [item.id, item.sessionId, item.timer?.completed ?? false]),
      [
        ["session-three", "session-3", false],
        ["completed-row", "session-3", true],
        ["standalone", null, false],
      ],
    );
    assert.deepEqual(removed.authoritative.timerInstrument.sessions[0].activityIds, []);

    const replay = await call(owner, "remove_today_practice_activities", input);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.result.deletedIds, ["remove-a", "remove-b"]);

    const changedReplay = await owner.callTool({
      name: "remove_today_practice_activities",
      arguments: { ...input, activityIds: ["standalone"] },
    });
    assert.equal(changedReplay.isError, true);
    assert.equal(changedReplay.structuredContent.code, "planning_mutation_identity_conflict");

    const stale = await owner.callTool({
      name: "remove_today_practice_activities",
      arguments: { ...input, mutationId: "remove-stale", activityIds: ["standalone"] },
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.code, "stale_workbench_revision");

    const started = await call(owner, "control_practice_timer", {
      expectedWorkbenchId: "workbench-owner",
      mutationId: "start-session-three-child",
      activityId: "session-three",
      expectedRevision: 0,
      action: "start",
      authorization: "explicit_user_instruction",
    });
    assert.equal(started.result.activityId, "session-three");
    assert.equal(started.authoritative.timerInstrument.session.id, "session-3");

    other = await connect(baseUrl, otherToken, "today-other");
    const crossOwner = await call(other, "remove_today_practice_activities", {
      expectedWorkbenchId: "workbench-other",
      expectedWorkbenchRevision: 200,
      mutationId: "remove-cross-owner",
      activityIds: ["standalone"],
      authorization: "explicit_user_instruction",
    });
    assert.deepEqual(crossOwner.result.deletedIds, []);
    assert.equal(crossOwner.result.rejected[0].code, "not_in_current_workbench");
  } finally {
    await owner?.close().catch(() => {});
    await other?.close().catch(() => {});
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseIntegrationLock?.();
  }
});

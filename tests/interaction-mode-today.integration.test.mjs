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
const config = fileURLToPath(new URL("./fixtures/wrangler.interaction-mode-today.jsonc", import.meta.url));
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
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

async function waitForWorker(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local Today mode Worker exited ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/state?ownerId=owner-mode&date=2026-08-10`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local Today mode Worker did not start.");
}

async function state(baseUrl, ownerId) {
  const response = await fetch(`${baseUrl}/state?ownerId=${ownerId}&date=2026-08-10`);
  assert.equal(response.status, 200);
  return response.json();
}

async function command(baseUrl, ownerId, mutation) {
  const response = await fetch(`${baseUrl}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerId, date: "2026-08-10", now: 2_000, command: mutation }),
  });
  return { status: response.status, body: await response.json() };
}

test("Today reads and mutates owner-scoped interaction modes through the authoritative D1 command", { timeout: 90_000 }, async () => {
  let releaseLock;
  let persistence;
  let worker;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-mode-today-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO practice_workbenches (owner_id,id,status,opened_pacific_date,opened_at,closed_at,updated_at) VALUES
        ('owner-mode','workbench-mode','open','2026-08-10',1,NULL,1),
        ('owner-other','workbench-other','open','2026-08-10',1,NULL,1);
      INSERT INTO extra_activities (owner_id,id,date,workbench_id,payload,revision,updated_at) VALUES
        ('owner-mode','activity-mode','2026-08-10','workbench-mode','{"schemaVersion":2,"id":"activity-mode","date":"2026-08-10","source":"extra","type":"behavioral","title":"Mode tracer","allocatedSeconds":3600,"timerGroupId":"activity-mode","timingSource":"website","status":"planned"}',0,1),
        ('owner-other','activity-private','2026-08-10','workbench-other','{"schemaVersion":2,"id":"activity-private","date":"2026-08-10","source":"extra","type":"behavioral","title":"Private tracer","allocatedSeconds":3600,"timerGroupId":"activity-private","timingSource":"website","status":"planned"}',0,1);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], { cwd: project, stdio: "ignore" });
    await waitForWorker(baseUrl, worker);

    const initial = await state(baseUrl, "owner-mode");
    assert.deepEqual(initial.interactionModeRegistry.modes.map((mode) => mode.id), ["interviewer", "mentor", "grill"]);
    assert.deepEqual(initial.interactionModes["activity-mode"], { state: "needs_selection", current: null });

    const mutation = {
      type: "interaction-mode-set",
      activityId: "activity-mode",
      interactionModeId: "mentor",
      expectedRevision: 0,
      mutationId: "website-mode-1",
      source: "explicit_user_instruction",
      reason: "The owner selected mentor on Today.",
      occurredAt: 1_500,
      authorization: "explicit_user_instruction",
    };
    const first = await command(baseUrl, "owner-mode", mutation);
    assert.equal(first.status, 200);
    assert.equal(first.body.interactionModes["activity-mode"].current.interactionModeId, "mentor");
    assert.equal(first.body.interactionModes["activity-mode"].current.revision, 1);
    assert.equal(first.body.mutationReceipt.duplicate, false);

    const exactRetry = await command(baseUrl, "owner-mode", mutation);
    assert.equal(exactRetry.status, 200);
    assert.equal(exactRetry.body.interactionModes["activity-mode"].current.revision, 1);
    assert.equal(exactRetry.body.mutationReceipt.duplicate, true);

    const stale = await command(baseUrl, "owner-mode", {
      ...mutation,
      mutationId: "website-mode-stale",
      interactionModeId: "grill",
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "interaction_mode_stale_revision");
    assert.equal(stale.body.retryable, false);

    const other = await state(baseUrl, "owner-other");
    assert.deepEqual(other.interactionModes["activity-private"], { state: "needs_selection", current: null });
    assert.equal(other.interactionModes["activity-mode"], undefined);
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

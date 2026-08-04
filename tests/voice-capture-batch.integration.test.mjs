import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));
const checksum = (text) => createHash("sha256").update(text).digest("hex");

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
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

function fixtureSql(tokenHash) {
  const captures = [
    ["capture-int-a", "activity-int-two", "turn-int-a", "clip-int-a", checksum("First."), 100],
    ["capture-int-b", "activity-int-two", "turn-int-b", "clip-int-b", checksum("Second."), 200],
    ["capture-int-c1", "activity-int-three", "turn-int-c1", "clip-int-c1", checksum("One."), 1100],
    ["capture-int-c2", "activity-int-three", "turn-int-c2", "clip-int-c2", checksum("Two."), 1200],
    ["capture-int-c3", "activity-int-three", "turn-int-c3", "clip-int-c3", checksum("Three."), 1300],
    ["capture-int-r1", "activity-int-race", "turn-int-r1", "clip-int-r1", checksum("Race one."), 2100],
    ["capture-int-r2", "activity-int-race", "turn-int-r2", "clip-int-r2", checksum("Race two."), 2200],
  ];
  return `
    INSERT INTO integration_tokens
      (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
    VALUES ('${tokenHash}','owner-integration-150','Voice batch integration',1,NULL,NULL);
    ${captures.map(([captureId, activityId, turnId, clipId, checksum, occurredAt]) => `
      INSERT INTO voice_capture_intents
        (owner_id,capture_id,activity_id,turn_id,clip_id,specialty,status,checksum,occurred_at,created_at,updated_at)
      VALUES
        ('owner-integration-150','${captureId}','${activityId}','${turnId}','${clipId}','leetcode','pending','${checksum}',${occurredAt},1,1);
    `).join("\n")}
  `;
}

test("local D1/R2 MCP preserves grouped order, concurrent completion, and whole-group deletion", { timeout: 90_000 }, async () => {
  const persistence = await mkdtemp(join(tmpdir(), "interview-arc-voice-batch-"));
  const token = "ia_voice_batch_integration_token_150";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const port = 40_000 + (process.pid % 20_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  let worker;
  let client;
  try {
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", fixtureSql(tokenHash)]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let workerLog = "";
    worker.stdout.on("data", (chunk) => { workerLog += chunk; });
    worker.stderr.on("data", (chunk) => { workerLog += chunk; });
    await waitForWorker(baseUrl, worker);

    client = new Client({ name: "voice-batch-integration", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
      return result.structuredContent;
    };
    const rest = async (path, init = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body)}\n${workerLog}`);
      return body;
    };
    const deliver = (activityId, capture) => rest("/voice/captures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        activityId,
        specialty: "leetcode",
        captureId: capture.captureId,
        turnId: capture.userTurnId,
        transcript: capture.transcript,
        checksum: capture.checksum,
        occurredAt: capture.occurredAt,
      }),
    });

    const two = [
      { captureId: "capture-int-a", userTurnId: "turn-int-a", transcript: "First.", checksum: checksum("First."), occurredAt: 100 },
      { captureId: "capture-int-b", userTurnId: "turn-int-b", transcript: "Second.", checksum: checksum("Second."), occurredAt: 200 },
    ];
    const twoReservation = {
      activityId: "activity-int-two",
      activityTitle: "Two recordings",
      specialty: "leetcode",
      captures: two.map(({ captureId, userTurnId }) => ({ captureId, userTurnId })),
      responseTurnId: "response-int-two",
      responseBody: "One response for two recordings.",
      responseOccurredAt: 300,
      reason: "One visible multi-recording answer.",
    };
    assert.equal((await call("resolve_voice_captures_and_save_response", twoReservation)).duplicate, false);
    assert.equal((await call("resolve_voice_captures_and_save_response", twoReservation)).duplicate, true);
    await assert.rejects(() => call("resolve_voice_capture_and_save_response", {
      captureId: "capture-int-a",
      activityId: "activity-int-two",
      activityTitle: "Competing single response",
      userTurnId: "turn-int-a",
      responseTurnId: "response-int-competing-single",
      specialty: "leetcode",
      responseBody: "This must not reserve.",
      responseOccurredAt: 301,
      reason: "Cross-flow collision fixture.",
    }), /grouped Voice exchange|another Voice exchange/);
    await deliver("activity-int-two", two[1]);
    assert.deepEqual((await call("get_activity_practice_record", { activityId: "activity-int-two" })).turns, []);
    await deliver("activity-int-two", two[0]);
    const twoRecord = await call("get_activity_practice_record", { activityId: "activity-int-two" });
    assert.deepEqual(twoRecord.turns.map((turn) => turn.turnId), ["turn-int-a", "turn-int-b", "response-int-two"]);

    const audio = new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])], { type: "audio/wav" });
    for (const [index, capture] of two.entries()) {
      const form = new FormData();
      form.set("captureId", capture.captureId);
      form.set("clipId", `clip-int-${index === 0 ? "a" : "b"}`);
      form.set("activityId", "activity-int-two");
      form.set("transcriptTurnId", capture.userTurnId);
      form.set("file", audio, `capture-${index}.wav`);
      await rest("/audio/upload", { method: "POST", body: form });
      await call("save_delivery_analysis", {
        analysisId: `analysis-int-${index}`,
        activityId: "activity-int-two",
        audioClipId: `clip-int-${index === 0 ? "a" : "b"}`,
        transcriptTurnId: capture.userTurnId,
        specialty: "leetcode",
        status: "available",
        payload: { schemaVersion: 1, summary: "Fixture.", strengths: [], improvements: [], observations: [] },
      });
    }
    const deletedTwo = await call("delete_related_voice_capture", {
      captureId: "capture-int-b",
      activityId: "activity-int-two",
      turnId: "turn-int-b",
      authorization: "explicit_user_instruction",
      reason: "Delete integration fixture.",
    });
    assert.deepEqual(deletedTwo.captureIds, ["capture-int-a", "capture-int-b"]);
    const cleanedTwo = await call("get_activity_practice_record", { activityId: "activity-int-two" });
    assert.equal(cleanedTwo.turns.length + cleanedTwo.audioClips.length + cleanedTwo.deliveryAnalyses.length, 0);

    const three = [
      { captureId: "capture-int-c1", userTurnId: "turn-int-c1", transcript: "One.", checksum: checksum("One."), occurredAt: 1100 },
      { captureId: "capture-int-c2", userTurnId: "turn-int-c2", transcript: "Two.", checksum: checksum("Two."), occurredAt: 1200 },
      { captureId: "capture-int-c3", userTurnId: "turn-int-c3", transcript: "Three.", checksum: checksum("Three."), occurredAt: 1300 },
    ];
    await call("resolve_voice_captures_and_save_response", {
      activityId: "activity-int-three",
      activityTitle: "Three recordings",
      specialty: "leetcode",
      captures: three.map(({ captureId, userTurnId }) => ({ captureId, userTurnId })),
      responseTurnId: "response-int-three",
      responseBody: "One response for three recordings.",
      responseOccurredAt: 1400,
      reason: "One concurrent multi-recording answer.",
    });
    await Promise.all(three.map((capture) => deliver("activity-int-three", capture)));
    const threeRecord = await call("get_activity_practice_record", { activityId: "activity-int-three" });
    assert.deepEqual(threeRecord.turns.map((turn) => turn.turnId), [
      "turn-int-c1", "turn-int-c2", "turn-int-c3", "response-int-three",
    ]);
    const deletedThree = await call("delete_related_voice_capture", {
      captureId: "capture-int-c1",
      activityId: "activity-int-three",
      turnId: "turn-int-c1",
      authorization: "explicit_user_instruction",
      reason: "Delete concurrent integration fixture.",
    });
    assert.equal(deletedThree.captureIds.length, 3);

    const raceCaptures = [
      { captureId: "capture-int-r1", userTurnId: "turn-int-r1" },
      { captureId: "capture-int-r2", userTurnId: "turn-int-r2" },
    ];
    const race = await Promise.allSettled([
      call("resolve_voice_captures_and_save_response", {
        activityId: "activity-int-race",
        activityTitle: "Atomic group race",
        specialty: "leetcode",
        captures: raceCaptures,
        responseTurnId: "response-int-race-group",
        responseBody: "Grouped race response.",
        responseOccurredAt: 2300,
        reason: "Atomic cross-flow reservation test.",
      }),
      call("resolve_voice_capture_and_save_response", {
        captureId: "capture-int-r1",
        activityId: "activity-int-race",
        activityTitle: "Atomic single race",
        userTurnId: "turn-int-r1",
        responseTurnId: "response-int-race-single",
        specialty: "leetcode",
        responseBody: "Single race response.",
        responseOccurredAt: 2301,
        reason: "Atomic cross-flow reservation test.",
      }),
    ]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);

    await call("resolve_voice_captures_and_save_response", {
      activityId: "activity-int-unregistered",
      activityTitle: "Registration race cleanup",
      specialty: "leetcode",
      captures: [
        { captureId: "capture-int-u1", userTurnId: "turn-int-u1" },
        { captureId: "capture-int-u2", userTurnId: "turn-int-u2" },
      ],
      responseTurnId: "response-int-unregistered",
      responseBody: "Reserved before registration.",
      responseOccurredAt: 3300,
      reason: "Exercise deferred registration cleanup.",
    });
    const deletedUnregistered = await call("delete_related_voice_capture", {
      captureId: "capture-int-u1",
      activityId: "activity-int-unregistered",
      turnId: "turn-int-u1",
      authorization: "explicit_user_instruction",
      reason: "Delete deferred integration fixture.",
    });
    assert.deepEqual(deletedUnregistered.captureIds, ["capture-int-u1", "capture-int-u2"]);
  } finally {
    await client?.close().catch(() => {});
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    await rm(persistence, { recursive: true, force: true });
  }
});

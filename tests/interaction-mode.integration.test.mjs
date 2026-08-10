import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";
import {
  availableMcpPort,
  connectMcpClient,
  runMcpCommand,
  startMcpWorker,
  waitForMcpWorker,
} from "./helpers/mcp-worker-harness.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function interactionModeFixtureSql(ownerToken, otherToken) {
  return `
    INSERT INTO integration_tokens (token_hash,owner_id,label,created_at,last_used_at,revoked_at) VALUES
      ('${sha256(ownerToken)}','owner-mode','Mode owner',1,NULL,NULL),
      ('${sha256(otherToken)}','owner-other','Other owner',1,NULL,NULL);
    INSERT INTO practice_workbenches (owner_id,id,status,opened_pacific_date,opened_at,closed_at,updated_at) VALUES
      ('owner-mode','workbench-mode','open','2026-08-09',1,NULL,1),
      ('owner-other','workbench-other','open','2026-08-09',1,NULL,1);
    INSERT INTO extra_activities (owner_id,id,date,workbench_id,payload,revision,updated_at) VALUES
      ('owner-mode','activity-mode','2026-08-09','workbench-mode','{"schemaVersion":1,"id":"activity-mode","date":"2026-08-09","source":"extra","type":"leetcode","title":"Mode tracer","allocatedSeconds":2400,"timingSource":"website","status":"running"}',0,1),
      ('owner-mode','activity-other','2026-08-09','workbench-mode','{"schemaVersion":1,"id":"activity-other","date":"2026-08-09","source":"extra","type":"leetcode","title":"Other activity","allocatedSeconds":2400,"timingSource":"website","status":"planned"}',0,1),
      ('owner-other','activity-private','2026-08-09','workbench-other','{"schemaVersion":1,"id":"activity-private","date":"2026-08-09","source":"extra","type":"leetcode","title":"Private activity","allocatedSeconds":2400,"timingSource":"website","status":"planned"}',0,1);
    INSERT INTO practice_transcript_turns (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at) VALUES
      ('owner-mode','activity-mode','voice-switch-turn','leetcode','user','Switch to Mentor.','audio_transcript',1,100,100),
      ('owner-mode','activity-mode','specialist-switch-turn','leetcode','specialist','Would you like Mentor?','codex',2,110,110),
      ('owner-mode','activity-other','wrong-activity-turn','leetcode','user','Administrative note.','audio_transcript',1,100,100),
      ('owner-other','activity-private','other-owner-turn','leetcode','user','Private note.','audio_transcript',1,100,100);
  `;
}

test("interaction mode MCP state is owner-private, atomic, idempotent, revision-guarded, and reconnect-safe", { timeout: 90_000 }, async () => {
  const ownerToken = "ia_interaction_mode_owner_integration_token";
  const otherToken = "ia_interaction_mode_other_integration_token";
  let releaseIntegrationLock;
  let persistence;
  let worker;
  const clients = [];
  try {
    releaseIntegrationLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-interaction-mode-"));
    const port = await availableMcpPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await runMcpCommand(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config], project);
    await runMcpCommand(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", interactionModeFixtureSql(ownerToken, otherToken)], project);
    const startedWorker = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = startedWorker.child;
    await waitForMcpWorker(baseUrl, worker);

    let ownerClient = await connectMcpClient(baseUrl, ownerToken, "interaction-mode-owner");
    clients.push(ownerClient);
    const raw = (client, name, args) => client.callTool({ name, arguments: args });
    const call = async (client, name, args) => {
      const result = await raw(client, name, args);
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}\n${startedWorker.readDiagnosticTail()}`);
      return result.structuredContent;
    };

    const initial = await call(ownerClient, "get_practice_interaction_mode", { activityId: "activity-mode" });
    assert.equal(initial.state, "needs_selection");
    assert.equal(initial.current, null);
    assert.deepEqual(initial.registry.modes.map((mode) => mode.id), ["interviewer", "mentor", "grill"]);

    const firstMutation = {
      activityId: "activity-mode",
      interactionModeId: "coach",
      expectedRevision: 0,
      mutationId: "mode-mutation-1",
      triggerTurnId: "voice-switch-turn",
      source: "explicit_user_instruction",
      reason: "The owner explicitly requested Mentor.",
      occurredAt: 200,
      authorization: "explicit_user_instruction",
    };
    const first = await call(ownerClient, "set_practice_interaction_mode", firstMutation);
    assert.equal(first.duplicate, false);
    assert.equal(first.current.interactionModeId, "mentor");
    assert.equal(first.current.revision, 1);
    assert.equal(first.transitions.length, 1);
    assert.equal(first.transitions[0].fromInteractionModeId, null);
    assert.equal(first.transitions[0].triggerTurnId, "voice-switch-turn");

    await ownerClient.close();
    clients.pop();
    ownerClient = await connectMcpClient(baseUrl, ownerToken, "interaction-mode-owner-reconnected");
    clients.push(ownerClient);
    const afterReconnect = await call(ownerClient, "get_practice_interaction_mode", { activityId: "activity-mode" });
    assert.equal(afterReconnect.current.interactionModeId, "mentor");
    assert.equal(afterReconnect.transitions.length, 1);

    const exactRetry = await call(ownerClient, "set_practice_interaction_mode", firstMutation);
    assert.equal(exactRetry.duplicate, true);
    assert.equal(exactRetry.current.revision, 1);
    assert.equal(exactRetry.transitions.length, 1);

    const turnOverrideInput = {
      ...firstMutation,
      scope: "turn_override",
      responseTurnId: "specialist-switch-turn",
      interactionModeId: "grill",
      expectedRevision: 1,
      mutationId: "mode-turn-override-1",
      reason: "Use Grill for this one specialist response only.",
      occurredAt: 205,
    };
    const turnOverride = await call(ownerClient, "set_practice_interaction_mode", turnOverrideInput);
    assert.equal(turnOverride.receipt.scope, "turn_override");
    assert.equal(turnOverride.current.interactionModeId, "mentor");
    assert.equal(turnOverride.current.revision, 1);
    assert.equal(turnOverride.transitions.length, 1);
    assert.equal(turnOverride.turnOverrides.length, 1);
    assert.equal(turnOverride.turnOverrides[0].overrideInteractionModeId, "grill");
    const activityRecord = await call(ownerClient, "get_activity_practice_record", { activityId: "activity-mode" });
    assert.deepEqual(
      activityRecord.turns.find((turn) => turn.turnId === "specialist-switch-turn").interactionMode,
      { interactionModeId: "grill", revision: 1, turnOverride: true },
    );
    const overrideRetry = await call(ownerClient, "set_practice_interaction_mode", turnOverrideInput);
    assert.equal(overrideRetry.duplicate, true);
    assert.equal(overrideRetry.current.interactionModeId, "mentor");
    const overrideConflict = await raw(ownerClient, "set_practice_interaction_mode", {
      ...turnOverrideInput,
      interactionModeId: "interviewer",
    });
    assert.equal(overrideConflict.isError, true);
    assert.equal(overrideConflict.structuredContent.code, "interaction_mode_mutation_identity_conflict");
    const crossScopeConflict = await raw(ownerClient, "set_practice_interaction_mode", {
      ...firstMutation,
      mutationId: "mode-turn-override-1",
      interactionModeId: "interviewer",
      expectedRevision: 1,
      triggerTurnId: undefined,
      reason: "A conflicting activity-scoped use of the same mutation identity.",
      occurredAt: 206,
    });
    assert.equal(crossScopeConflict.isError, true);
    assert.equal(crossScopeConflict.structuredContent.code, "interaction_mode_mutation_identity_conflict");
    const occupiedTurnConflict = await raw(ownerClient, "set_practice_interaction_mode", {
      ...turnOverrideInput,
      mutationId: "mode-turn-override-2",
      interactionModeId: "interviewer",
    });
    assert.equal(occupiedTurnConflict.isError, true);
    assert.equal(occupiedTurnConflict.structuredContent.code, "interaction_mode_turn_override_conflict");
    const invalidOverrideSource = await raw(ownerClient, "set_practice_interaction_mode", {
      ...turnOverrideInput,
      mutationId: "mode-turn-override-workflow",
      source: "workflow_transition",
    });
    assert.equal(invalidOverrideSource.isError, true);
    assert.equal(invalidOverrideSource.structuredContent.code, "interaction_mode_turn_override_source_invalid");

    const changedRetry = await raw(ownerClient, "set_practice_interaction_mode", {
      ...firstMutation,
      interactionModeId: "interviewer",
    });
    assert.equal(changedRetry.isError, true);
    assert.equal(changedRetry.structuredContent.code, "interaction_mode_mutation_identity_conflict");

    const wrongTurn = await raw(ownerClient, "set_practice_interaction_mode", {
      ...firstMutation,
      mutationId: "mode-mutation-wrong-turn",
      expectedRevision: 1,
      interactionModeId: "grill",
      triggerTurnId: "wrong-activity-turn",
    });
    assert.equal(wrongTurn.isError, true);
    assert.equal(wrongTurn.structuredContent.code, "interaction_mode_trigger_turn_mismatch");

    const specialistTurn = await raw(ownerClient, "set_practice_interaction_mode", {
      ...firstMutation,
      mutationId: "mode-mutation-specialist-turn",
      expectedRevision: 1,
      interactionModeId: "grill",
      triggerTurnId: "specialist-switch-turn",
    });
    assert.equal(specialistTurn.isError, true);
    assert.equal(specialistTurn.structuredContent.code, "interaction_mode_trigger_turn_mismatch");

    const otherClient = await connectMcpClient(baseUrl, otherToken, "interaction-mode-other-owner");
    clients.push(otherClient);
    const crossOwnerRead = await raw(otherClient, "get_practice_interaction_mode", { activityId: "activity-mode" });
    assert.equal(crossOwnerRead.isError, true);
    assert.equal(crossOwnerRead.structuredContent.code, "interaction_mode_activity_not_found");

    const competingClient = await connectMcpClient(baseUrl, ownerToken, "interaction-mode-owner-competing");
    clients.push(competingClient);
    const concurrentInputs = [
      { mutationId: "mode-mutation-concurrent-a", interactionModeId: "interviewer" },
      { mutationId: "mode-mutation-concurrent-b", interactionModeId: "grill" },
    ].map((candidate) => ({
      ...firstMutation,
      ...candidate,
      expectedRevision: 1,
      triggerTurnId: undefined,
      reason: `Concurrent switch to ${candidate.interactionModeId}.`,
      occurredAt: 300,
    }));
    const concurrent = await Promise.all([
      raw(ownerClient, "set_practice_interaction_mode", concurrentInputs[0]),
      raw(competingClient, "set_practice_interaction_mode", concurrentInputs[1]),
    ]);
    assert.equal(concurrent.filter((result) => !result.isError).length, 1);
    assert.equal(concurrent.filter((result) => result.isError).length, 1);
    assert.equal(
      concurrent.find((result) => result.isError).structuredContent.code,
      "interaction_mode_stale_revision",
    );

    const final = await call(ownerClient, "get_practice_interaction_mode", { activityId: "activity-mode" });
    assert.equal(final.current.revision, 2);
    assert.equal(final.transitions.length, 2);
    assert.deepEqual(final.transitionHistory, {
      order: "chronological",
      limit: 100,
      returnedCount: 2,
      truncated: false,
      oldestReturnedRevision: 1,
      latestReturnedRevision: 2,
    });
    assert.deepEqual(final.transitions.map((transition) => transition.toRevision), [1, 2]);
    assert.equal(new Set(final.transitions.map((transition) => transition.mutationId)).size, 2);
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    if (worker && worker.exitCode === null) worker.kill("SIGTERM");
    if (persistence) await rm(persistence, { recursive: true, force: true });
    if (releaseIntegrationLock) await releaseIntegrationLock();
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";
import { CHATGPT_PRACTICE_TOOLS } from "../mcp-worker/scoped-server.ts";
import { availableMcpPort, runMcpCommand, startMcpWorker, stopMcpWorker, waitForMcpWorker } from "./helpers/mcp-worker-harness.mjs";

test("bundled dedicated MCP route authenticates privately and reuses existing practice handlers", { timeout: 120000 }, async () => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const config = fileURLToPath(new URL("./fixtures/wrangler.chatgpt-connector.jsonc", import.meta.url));
  const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
  const release = await acquireMcpIntegrationLock();
  const persistence = await mkdtemp(join(tmpdir(), "arc-chatgpt-test-"));
  let worker; let client;
  try {
    await runMcpCommand(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config], project);
    const port = await availableMcpPort(); const base = `http://127.0.0.1:${port}`;
    worker = startMcpWorker({ wrangler, config, persistence, project, port });
    await waitForMcpWorker(base, worker.child, worker.readDiagnosticTail);
    assert.equal((await fetch(`${base}/chatgpt/mcp`)).status, 401);
    assert.equal((await fetch(`${base}/chatgpt/mcp`, { headers: { "x-interview-arc-authenticated-email": "synthetic@example.test" } })).status, 401);
    const { assertion } = await (await fetch(`${base}/fixture/assertion`)).json();
    assert.equal((await fetch(`${base}/mcp`, { headers: { "cf-access-jwt-assertion": assertion } })).status, 401);
    client = new Client({ name: "Synthetic connector", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/chatgpt/mcp`), { requestInit: { headers: { "cf-access-jwt-assertion": assertion } } }));
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [...CHATGPT_PRACTICE_TOOLS].sort());
    assert.equal(names.includes("search"), true);
    assert.equal(names.includes("control_practice_timer"), true);
    assert.equal(names.includes("save_specialist_finalization"), true);
    assert.equal(names.includes("register_specialist_task"), false);
    assert.equal(names.includes("create_loop"), false);
    assert.equal(names.includes("delete_typed_practice_exchange"), false);
    const catalog = await client.callTool({ name: "query_practice_catalog", arguments: { specialty: "system_design" } });
    assert.equal(catalog.isError, undefined);
    const created = await client.callTool({ name: "create_practice_question", arguments: { operationId: "synthetic-route-question", specialty: "system_design", title: "Synthetic bundled bank question", prompt: "Design a fictional queue.", url: null } });
    assert.equal(created.isError, undefined);
    const search = await client.callTool({ name: "search", arguments: { query: "bundled" } });
    assert.equal(search.structuredContent.results.length, 1);
    const fetched = await client.callTool({ name: "fetch", arguments: { id: search.structuredContent.results[0].id } });
    assert.equal(fetched.structuredContent.text, "Design a fictional queue.");
    const at = Date.now();
    const exchangeInput = { activityId: "synthetic-typed-activity", activityTitle: "Synthetic typed source", specialty: "system_design",
      userTurn: { turnId: "synthetic-user", body: "I would use a durable queue.", occurredAt: at },
      specialistTurn: { turnId: "synthetic-reply", body: "Explain how you would handle retries.", occurredAt: at + 1 } };
    const exchange = await client.callTool({ name: "save_practice_exchange", arguments: exchangeInput });
    assert.equal(exchange.isError, undefined);
    assert.equal((await client.callTool({ name: "save_practice_exchange", arguments: exchangeInput })).structuredContent.duplicate, true);
    const record = await client.callTool({ name: "get_activity_practice_record", arguments: { activityId: exchangeInput.activityId } });
    assert.equal(record.isError, undefined);
    assert.equal(record.structuredContent.turns.length, 2);
    assert.equal(record.structuredContent.turns.every((turn) => turn.source === "chatgpt"), true);
    const code = "class Solution { int answer() { return 42; } }";
    const review = { schemaVersion: 1, status: "complete", summary: "The constant is returned.",
      whatWentWell: ["The method is concise."], whatToImprove: ["Explain the required constant."],
      testingEvidence: ["Inspected the exact source; no execution was performed."],
      nextStep: "State the requirement.", provenance: "specialist_observed", reviewedAt: at + 10 };
    const codeExchange = await client.callTool({ name: "save_practice_exchange", arguments: {
      activityId: "synthetic-code-activity", activityTitle: "Synthetic code review", specialty: "leetcode",
      userTurn: { turnId: "synthetic-code-user", body: `My final code:\n${code}`, occurredAt: at + 5 },
      specialistTurn: { turnId: "synthetic-code-review", body: [review.summary, ...review.whatWentWell, ...review.whatToImprove, ...review.testingEvidence, review.nextStep].join("\n"), occurredAt: at + 10 },
    } });
    assert.equal(codeExchange.isError, undefined);
    const attempt = await client.callTool({ name: "save_leetcode_code_attempt", arguments: {
      operationId: "synthetic-code-attempt", id: "synthetic-code-attempt", activityId: "synthetic-code-activity",
      originatingTurnId: "synthetic-code-user", sequence: 1, language: "java", code, occurredAt: at + 5,
      review, reviewResponseTurnId: "synthetic-code-review", observedCorrectness: "not_verified",
      concreteFindings: [...review.testingEvidence], edgeCases: [], finalDeclaration: "Exact submitted code reviewed without execution.",
    } });
    assert.equal(attempt.isError, undefined);
    let receipt;
    for (let index = 0; index < 30; index++) {
      const status = await client.callTool({ name: "get_specialist_write_status", arguments: { jobIds: ["synthetic-code-attempt"] } });
      receipt = status.structuredContent.jobs[0];
      if (["saved", "failed"].includes(receipt?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(receipt?.status, "saved", JSON.stringify(receipt));
    const codeRecord = await client.callTool({ name: "get_activity_practice_record", arguments: { activityId: "synthetic-code-activity" } });
    assert.equal(codeRecord.structuredContent.codeAttempts[0].code, code);
    assert.deepEqual(codeRecord.structuredContent.codeAttempts[0].review, review);
  } finally { if (client) await client.close(); await stopMcpWorker(worker?.child); await rm(persistence, { recursive: true, force: true }); await release(); }
});

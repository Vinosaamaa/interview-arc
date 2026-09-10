import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    assert.equal(client.getInstructions(), await readFile(new URL("../docs/agents/chatgpt-practice-prompt.md", import.meta.url), "utf8"));
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [...CHATGPT_PRACTICE_TOOLS].sort());
    assert.equal(names.includes("search"), true);
    assert.equal(names.includes("control_practice_timer"), true);
    assert.equal(names.includes("save_specialist_finalization"), true);
    assert.equal(names.includes("register_specialist_task"), false);
    assert.equal(names.includes("create_loop"), false);
    assert.equal(names.includes("delete_typed_practice_exchange"), false);
    const codingQuestion = await client.callTool({ name: "create_practice_question", arguments: { operationId: "synthetic-editor-question", specialty: "leetcode", title: "Synthetic editor exercise", prompt: "Return 42.\nExample: no input -> 42.", url: null } });
    const editor = await client.callTool({ name: "open_coding_editor", arguments: { questionId: codingQuestion.structuredContent.questionId, language: "java", diagramText: "input -> answer" } });
    assert.equal(editor.isError, undefined, JSON.stringify(editor));
    assert.equal(editor.structuredContent.draft.problem.statement, "Return 42.\nExample: no input -> 42.");
    const resource = await client.readResource({ uri: "ui://interview-arc/coding-editor-v1.html" });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(resource.contents[0].text, /Review with ChatGPT/);
    const editorCode = "class Solution {\n    int answer() { return 42; }\n}\n";
    const savedDraft = await client.callTool({ name: "save_coding_draft", arguments: { draftId: editor.structuredContent.draft.draftId, expectedRevision: 1, operationId: "synthetic-editor-save", code: editorCode } });
    assert.equal(savedDraft.isError, undefined, JSON.stringify(savedDraft));
    const rereadDraft = await client.callTool({ name: "get_coding_draft", arguments: { draftId: editor.structuredContent.draft.draftId } });
    assert.equal(rereadDraft.structuredContent.draft.code, editorCode);
    assert.equal(rereadDraft.structuredContent.draft.revision, 2);
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
    const evidence = await client.callTool({ name: "upsert_behavioral_evidence_item", arguments: {
      operationId: "synthetic-chatgpt-fact", evidence: {
        evidenceId: "synthetic-chatgpt-fact", projectKey: "synthetic-project", origin: "user_statement",
        statement: "The owner reports implementing retry handling in a fictional project.", sourceRevision: "synthetic-turn-1",
        evidenceGrade: "E1", attributionGrade: "A1", claimStrength: "project_fact", candidateState: "pending",
        safeProvenance: [{ kind: "conversation", reference: "synthetic-turn-1" }], supports: [], limitations: ["User reported, not independently verified."], tags: [],
      },
      questionLink: { questionId: "synthetic-behavioral-question", relevance: "supporting" },
    } });
    assert.equal(evidence.isError, undefined, JSON.stringify(evidence));
    for (let index = 0; index < 100; index++) {
      const status = await client.callTool({ name: "get_specialist_write_status", arguments: { jobIds: ["synthetic-chatgpt-fact"] } });
      receipt = status.structuredContent.jobs[0];
      if (["saved", "failed"].includes(receipt?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(receipt?.status, "saved", JSON.stringify(receipt));
    const accepted = await client.callTool({ name: "review_behavioral_evidence_candidates", arguments: {
      operationId: "synthetic-chatgpt-accept", authorization: "explicit_owner_review",
      decisions: [{ evidenceId: "synthetic-chatgpt-fact", expectedRevision: 1, decision: "accept", reason: "Synthetic owner authorization to retain this reported fact." }],
    } });
    assert.equal(accepted.isError, undefined, JSON.stringify(accepted));
    assert.equal(accepted.structuredContent.decisions[0].state, "accepted");
    const facts = await client.callTool({ name: "query_behavioral_evidence_candidates", arguments: { projectKey: "synthetic-project", state: "accepted" } });
    assert.equal(facts.isError, undefined, JSON.stringify(facts));
    assert.equal(facts.structuredContent.candidates[0].evidenceId, "synthetic-chatgpt-fact");
    const question = await client.callTool({ name: "create_practice_question", arguments: {
      operationId: "synthetic-editorial-question", specialty: "leetcode", title: "Synthetic coding example", prompt: "Fictional maximum exercise.", url: "https://leetcode.com/problems/two-sum/",
    } });
    const packet = JSON.parse(await readFile(new URL("../docs/contracts/chatgpt-backfill-synthetic.example.json", import.meta.url), "utf8"));
    const coding = packet.sessions[0].attempts.find((a) => a.question.specialty === "leetcode");
    packet.sessions[0].attempts = [coding];
    coding.question.questionId = question.structuredContent.questionId;
    coding.question.url = "https://leetcode.com/problems/two-sum/";
    coding.practiceDate = "2026-09-08"; coding.dateBasis = "user_reported";
    const preview = await client.callTool({ name: "preview_practice_backfill", arguments: { packet } });
    assert.equal(preview.isError, undefined, JSON.stringify(preview));
    const imported = await client.callTool({ name: "apply_practice_backfill", arguments: { packet, previewToken: preview.structuredContent.previewToken } });
    assert.equal(imported.isError, undefined, JSON.stringify(imported));
    assert.equal(imported.structuredContent.records[0].status, "completed");
    const addition = { operationId: "synthetic-editorial", activityId: imported.structuredContent.records[0].activityId,
      questionId: coding.question.questionId, expectedRevision: 0, source: "owner_supplied",
      editorialUrl: "https://leetcode.com/problems/two-sum/editorial/", accessedAt: "2026-09-10T00:00:00Z",
      contentSha256: "a".repeat(64), approachTitles: ["Synthetic approach"], explanation: "Fictional test explanation; no real editorial research is claimed by this test." };
    const editorial = await client.callTool({ name: "backfill_practice_editorial", arguments: addition });
    assert.equal(editorial.isError, undefined, JSON.stringify(editorial));
    assert.equal(editorial.structuredContent.editorial.revision, 1);
    assert.equal((await client.callTool({ name: "backfill_practice_editorial", arguments: addition })).structuredContent.duplicate, true);
    const readback = await client.callTool({ name: "get_practice_editorial", arguments: { activityId: addition.activityId } });
    assert.equal(readback.structuredContent.editorial.explanation, addition.explanation);
  } finally { if (client) await client.close(); await stopMcpWorker(worker?.child); await rm(persistence, { recursive: true, force: true }); await release(); }
});

import { resourceHtml, resourcePdf, resourcePng } from "./fixtures/study-resource-content.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { profile, nativePracticeRecord } from "./helpers/solution-publication-fixture.mjs";

test("bundled dedicated MCP route authenticates privately and reuses existing practice handlers", { timeout: 120000 }, async (t) => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const config = fileURLToPath(new URL("./fixtures/wrangler.chatgpt-connector.jsonc", import.meta.url));
  const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
  const release = await acquireMcpIntegrationLock();
  let persistence; let worker; let client;
  t.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => client?.close(),
      () => stopMcpWorker(worker?.child),
      () => persistence && rm(persistence, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      release,
    ]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Connector test cleanup failed");
  });
  persistence = await mkdtemp(join(tmpdir(), "arc chatgpt test-"));
  {
    await runMcpCommand(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config], project);
    const token = "ia_synthetic_portable_client_token_01";
    const hash = value => createHash("sha256").update(value).digest("hex");
    const sameOwner = `u_${hash("synthetic@example.test").slice(0,32)}`;
    await runMcpCommand(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `INSERT INTO integration_tokens(token_hash,owner_id,label,created_at,last_used_at,revoked_at) VALUES('${hash(token)}','${sameOwner}','Synthetic test',1,NULL,NULL);`], project);
    const native = nativePracticeRecord(), nativePayload = JSON.stringify(native), nativeFingerprint = hash(nativePayload);
    const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
    await runMcpCommand(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO practice_record_revisions(owner_id,activity_id,revision,operation_id,request_fingerprint,record_fingerprint,payload,created_at)
        VALUES('${sameOwner}','${native.activityId}',1,'native-finalize','request-hash','${nativeFingerprint}',${sqlString(nativePayload)},1);
      INSERT INTO practice_records(owner_id,activity_id,current_revision,specialty,question_id,title,completed_at,practice_date,outcome,solution_revision,record_fingerprint,finalization_operation_id,updated_at)
        VALUES('${sameOwner}','${native.activityId}',1,'system_design','${native.questionId}',${sqlString(native.prompt.title)},${Date.parse(native.completedAt)},'${native.practiceDate}','${native.outcome}',NULL,'${nativeFingerprint}','native-finalize',1);
      INSERT INTO activity_finalizations(owner_id,activity_id,specialty,status,payload,finalization_operation_id,finalization_request_fingerprint,practice_record_revision,practice_record_fingerprint)
        VALUES('${sameOwner}','${native.activityId}','system_design','ready','{}','native-finalize','request-hash',1,'${nativeFingerprint}');
    `], project);
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
    const lectureInput = { lectureId: "synthetic-professor", title: "Synthetic Professor lesson", sources: [{ label: "Reference", url: "https://example.com/reference" }], sections: [{ id: "intro", title: "First principles", text: "Teach this complete synthetic section faithfully." }] };
    const lectureSaved = await client.callTool({ name: "save_practice_lecture", arguments: lectureInput });
    assert.equal(lectureSaved.isError, undefined, JSON.stringify(lectureSaved));
    assert.equal((await client.callTool({ name: "save_practice_lecture", arguments: lectureInput })).structuredContent.duplicate, true);
    const lectureRead = await client.callTool({ name: "get_practice_lecture", arguments: { lectureId: lectureInput.lectureId } });
    assert.equal(lectureRead.structuredContent.fragment.text, lectureInput.sections[0].text);
    assert.equal(lectureRead.structuredContent.fingerprint, lectureSaved.structuredContent.fingerprint);
    const lecturePosition = { lectureId: lectureInput.lectureId, operationId: "position-one", expectedRevision: 0, chunkIndex: 0, offsetSeconds: 0, characterOffset: 12 };
    assert.equal((await client.callTool({ name: "save_lecture_position", arguments: lecturePosition })).structuredContent.revision, 1);
    assert.equal((await client.callTool({ name: "save_lecture_position", arguments: lecturePosition })).structuredContent.duplicate, true);
    assert.equal((await client.callTool({ name: "save_lecture_position", arguments: { ...lecturePosition, operationId: "stale-position" } })).isError, true);
    assert.equal((await client.callTool({ name: "list_practice_lectures", arguments: {} })).structuredContent.lectures[0].lectureId, lectureInput.lectureId);
    const generatedLecture = await fetch(`${base}/fixture/lecture-audio`, { method: "POST" });
    assert.equal(generatedLecture.status, 200, await generatedLecture.text());
    const inChatPlayer = await client.callTool({ name: "open_practice_lecture_player", arguments: { lectureId: lectureInput.lectureId } });
    assert.equal(inChatPlayer.isError, undefined, JSON.stringify(inChatPlayer));
    assert.equal(inChatPlayer.structuredContent.ready, true);
    assert.equal(inChatPlayer.structuredContent.speechConfigured, false);
    assert.ok(inChatPlayer._meta.audioUrl);
    assert.equal(JSON.stringify(inChatPlayer.structuredContent).includes("ticket="), false);
    assert.equal(JSON.stringify(inChatPlayer.content).includes("ticket="), false);
    const ticketUrl = new URL(inChatPlayer._meta.audioUrl);
    const localTicketUrl = `${base}${ticketUrl.pathname}${ticketUrl.search}`;
    assert.equal((await fetch(`${base}/lecture-media`)).status, 401);
    assert.equal((await fetch(`${base}/lecture-media?ticket=${"0".repeat(64)}`)).status, 401);
    const inChatAudio = await fetch(localTicketUrl, { headers: { range: "bytes=40-49" } });
    assert.equal(inChatAudio.status, 206);
    assert.equal((await inChatAudio.arrayBuffer()).byteLength, 10);
    assert.equal((await fetch(localTicketUrl, { method: "POST" })).status, 405);
    const playerWidget = await client.readResource({ uri: "ui://interview-arc/lecture-player-v1.html" });
    const filePicker = await client.callTool({ name: "open_study_resource_uploader", arguments: {} });
    assert.equal(filePicker.isError, undefined, JSON.stringify(filePicker));
    const fileWidget = await client.readResource({ uri: "ui://interview-arc/study-resource-uploader-v1.html" });
    assert.match(fileWidget.contents[0].text, /getFileDownloadUrl/);
    assert.match(fileWidget.contents[0].text, /Select from ChatGPT/);
    const fileTools = await client.listTools();
    const saveFileTool = fileTools.tools.find(tool => tool.name === "save_study_resource_file");
    assert.deepEqual(saveFileTool._meta['openai/fileParams'], ['file']);
    assert.equal(saveFileTool._meta['openai/widgetAccessible'], true);
    assert.match(playerWidget.contents[0].text, /Generate lecture audio/);
    assert.match(playerWidget.contents[0].text, /Fit full lecture to 1 hour/);
    const lectureAudio = await fetch(`${base}/fixture/lecture-audio`);
    assert.equal(lectureAudio.headers.get("content-length"), "48044", "real Worker preserves the known stream length");
    assert.equal((await lectureAudio.arrayBuffer()).byteLength, 48044);
    const lectureRange = await fetch(`${base}/fixture/lecture-audio`, { headers: { range: "bytes=40-49" } });
    assert.equal(lectureRange.status, 206);
    assert.equal(lectureRange.headers.get("content-range"), "bytes 40-49/48044");
    assert.equal(lectureRange.headers.get("content-length"), "10");
    assert.equal((await lectureRange.arrayBuffer()).byteLength, 10);
    const coaching = await client.callTool({ name: "get_practice_coaching_guide", arguments: { specialty: "system-design" } });
    assert.equal(coaching.isError, undefined);
    for (const document of [...coaching.structuredContent.requiredDocuments, ...coaching.structuredContent.reviewDocuments]) {
      let offset = 0, expectedSha256, full = "", path;
      do {
        const page = await client.callTool({ name: "get_practice_coaching_guide", arguments: { specialty: "system-design", document, offset, ...(expectedSha256 ? {expectedSha256} : {}) } });
        assert.equal(page.isError, undefined, JSON.stringify(page));
        full += page.structuredContent.text; offset = page.structuredContent.nextOffset;
        expectedSha256 = page.structuredContent.sha256; path = page.structuredContent.path;
      } while (offset !== null);
      assert.equal(full, await readFile(new URL("../" + path, import.meta.url), "utf8"));
      assert.equal(createHash("sha256").update(full).digest("hex"), expectedSha256);
    }
    assert.equal((await client.callTool({name:"get_practice_coaching_guide",arguments:{specialty:"system-design",document:"system-design-arc",offset:16000,expectedSha256:"0".repeat(64)}})).isError,true);
    const attached = await client.callTool({ name: "save_study_resource_file", arguments: { operationId: "chat-attachment", title: "Chat attached original", file: {download_url:"https://files.oaiusercontent.com/synthetic-library.txt",file_id:"file-synthetic",file_name:"source.txt",mime_type:"text/plain"} } });
    assert.equal(attached.isError,undefined,JSON.stringify(attached));
    const attachedId = attached.structuredContent.resource.resourceId;
    const websiteRead = await fetch(`${base}/fixture/resources?resourceId=${attachedId}`);
    assert.equal(websiteRead.status,200);assert.equal((await websiteRead.json()).fragment.text,"Exact ChatGPT attachment content.\n");
    for (const [filename,bytes] of [["source.html",Buffer.from(resourceHtml)],["paper.pdf",resourcePdf()],["picture.png",resourcePng]]) {
      const form = new FormData();form.set("file",new Blob([bytes]),filename);form.set("title",filename);form.set("operationId",filename);
      const uploaded = await fetch(`${base}/fixture/resources`,{method:"POST",headers:{origin:base},body:form});
      const data = await uploaded.json();assert.equal(uploaded.status,201,JSON.stringify(data));
      const toolRead = await client.callTool({name:"get_study_resource",arguments:{resourceId:data.resource.resourceId}});
      assert.equal(toolRead.isError,undefined,JSON.stringify(toolRead));
      if(filename.endsWith("pdf")) assert.match(toolRead.structuredContent.fragment?.text??JSON.stringify(toolRead),/Synthetic complete PDF text/);
      if(filename.endsWith("html")) assert.match(toolRead.structuredContent.fragment.text,/Collapsed but preserved/);
      if(filename.endsWith("png")) {const image=await client.callTool({name:"get_study_resource_image",arguments:{resourceId:data.resource.resourceId}});assert.deepEqual(Buffer.from(image.content.find(c=>c.type==="image").data,"base64"),bytes);}
      const original = await fetch(`${base}/fixture/resources?resourceId=${data.resource.resourceId}&original=1`);
      assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
    }
    const rejectedOrigin = await fetch(`${base}/fixture/resources`,{method:"POST",headers:{origin:"https://different.test"},body:"bad"});
    assert.equal(rejectedOrigin.status,403);
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
    const portable = new Client({ name: "Synthetic CLI client", version: "1" });
    try {
      await portable.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      const portableNames = (await portable.listTools()).tools.map(tool=>tool.name);
      for (const name of ["get_leetcode_problem", "get_leetcode_editorial", "open_coding_editor", "submit_coding_draft", "save_practice_drawing"]) assert.ok(portableNames.includes(name), name);
      const sharedDraft = await portable.callTool({ name: "get_coding_draft", arguments: { draftId: editor.structuredContent.draft.draftId } });
      assert.equal(sharedDraft.structuredContent.draft.code, editorCode);
      const portableCoaching = await portable.callTool({ name: "get_practice_coaching_guide", arguments: { specialty: "system-design" } });
      assert.deepEqual(portableCoaching.structuredContent, coaching.structuredContent);
      assert.equal((await portable.readResource({uri:"ui://interview-arc/coding-editor-v1.html"})).contents[0].mimeType,"text/html;profile=mcp-app");
    } finally { await portable.close(); }
    const catalog = await client.callTool({ name: "query_practice_catalog", arguments: { specialty: "system_design" } });
    assert.equal(catalog.isError, undefined);
    const created = await client.callTool({ name: "create_practice_question", arguments: { operationId: "synthetic-route-question", specialty: "system_design", title: "Synthetic bundled bank question", prompt: "Design a fictional queue.", url: null } });
    assert.equal(created.isError, undefined);
    const sourceLink = await client.callTool({name:"link_study_resource",arguments:{resourceId:attachedId,target:"question",targetId:created.structuredContent.questionId,specialty:"system_design"}});
    assert.equal(sourceLink.isError,undefined,JSON.stringify(sourceLink));
    const current = await client.callTool({name:"query_practice_catalog",arguments:{specialty:"system_design",questionId:created.structuredContent.questionId}});
    const todayData = current.structuredContent;
    const planned = await client.callTool({name:"plan_today_practice",arguments:{mode:"exact_selection",expectedWorkbenchId:todayData.workbench.id,mutationId:"resource-practice-plan",destination:"standalone",selections:[{specialty:"system_design",questionId:created.structuredContent.questionId}]}});
    assert.equal(planned.isError,undefined,JSON.stringify({current:todayData,planned}));
    const activity = planned.structuredContent.authoritative.snapshot.activities.find(a=>a.questionId===created.structuredContent.questionId);
    assert.ok(activity,JSON.stringify(planned.structuredContent));
    const activityLink=await client.callTool({name:"link_study_resource",arguments:{resourceId:attachedId,target:"activity",targetId:activity.id}});
    assert.equal(activityLink.isError,undefined,JSON.stringify(activityLink));
    const lesson = await client.callTool({name:"save_learning_lesson_revision",arguments:{operationId:"resource-lesson-create",expectedRevision:0,authorization:"learning_specialist",scope:{kind:"quick_study"},lesson:{lessonId:"resource-quick-study",state:"active",title:"Synthetic source study",objective:"Read the exact attached source.",sections:[{sectionId:"source",heading:"Original source",body:"Exact ChatGPT attachment content."}],checkpoints:[{checkpointId:"read-source",label:"Read source",description:"Identify the exact source sentence.",required:true}],sourcePins:[{kind:"owner_provided",title:"Chat attached original",path:attachedId,recordId:attachedId}]}}});
    assert.equal(lesson.isError,undefined,JSON.stringify(lesson));
    const lessonLink=await client.callTool({name:"link_study_resource",arguments:{resourceId:attachedId,target:"lesson",targetId:"resource-quick-study",revision:1}});
    assert.equal(lessonLink.isError,undefined,JSON.stringify(lessonLink));
    const learnSession=await client.callTool({name:"create_learning_session",arguments:{operationId:"resource-learning-session",sessionId:"resource-study-session",authorization:"learning_specialist",scope:{kind:"quick_study"},lessonId:"resource-quick-study",lessonRevision:1}});
    assert.equal(learnSession.isError,undefined,JSON.stringify(learnSession));
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

    const designPacket = JSON.parse(await readFile(new URL("../docs/contracts/chatgpt-backfill-synthetic.example.json", import.meta.url), "utf8"));
    const design = designPacket.sessions[0].attempts.find((attempt) => attempt.question.specialty === "system_design");
    designPacket.packetId = "synthetic-solution-design-packet";
    designPacket.sessions[0].sessionKey = "synthetic-solution-design-session";
    designPacket.sessions[0].attempts = [design];
    design.question.questionId = created.structuredContent.questionId;
    design.practiceDate = "2026-09-08"; design.dateBasis = "user_reported";
    const designPreview = await client.callTool({ name: "preview_practice_backfill", arguments: { packet: designPacket } });
    assert.equal(designPreview.isError, undefined, JSON.stringify(designPreview));
    const designImport = await client.callTool({ name: "apply_practice_backfill", arguments: { packet: designPacket, previewToken: designPreview.structuredContent.previewToken } });
    assert.equal(designImport.isError, undefined, JSON.stringify(designImport));
    const completedDesign = designImport.structuredContent.records[0];
    assert.equal(completedDesign.status, "completed");
    const originalFingerprints = await (await fetch(`${base}/fixture/immutable-practice`)).json();
    const importedBefore = await (await fetch(`${base}/fixture/imported-reader?activityId=${encodeURIComponent(completedDesign.activityId)}`)).json();
    assert.equal(importedBefore.record.solutionPublication, null);
    const nativeBefore = await client.callTool({ name: "get_activity_practice_record", arguments: { activityId: native.activityId } });
    assert.equal(nativeBefore.isError, undefined, JSON.stringify(nativeBefore));
    const batch = { batchId: "synthetic-solution-batch", items: [
      { activityId: completedDesign.activityId, specialty: "system_design", questionId: completedDesign.questionId,
        expectedPracticeRevision: completedDesign.revision, expectedPracticeFingerprint: completedDesign.fingerprint,
        expectedSolutionRevision: 0, action: "create_or_revise", solutionProfile: profile() },
      { activityId: native.activityId, specialty: "system_design", questionId: native.questionId,
        expectedPracticeRevision: 1, expectedPracticeFingerprint: nativeFingerprint,
        expectedSolutionRevision: 0, action: "create_or_revise", solutionProfile: profile() },
      { activityId: "missing-synthetic-record", specialty: "system_design", questionId: native.questionId,
        expectedPracticeRevision: 1, expectedPracticeFingerprint: "a".repeat(64),
        expectedSolutionRevision: 0, action: "create_or_revise", solutionProfile: profile() },
    ] };
    const queued = await client.callTool({ name: "publish_practice_solutions", arguments: batch });
    assert.equal(queued.isError, undefined, JSON.stringify(queued));
    let batchResult;
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.equal((await fetch(`${base}/fixture/scheduled`, { method: "POST" })).status, 200);
      const status = await client.callTool({ name: "get_practice_solution_batch", arguments: { batchId: batch.batchId } });
      assert.equal(status.isError, undefined, JSON.stringify(status));
      batchResult = status.structuredContent;
      if (batchResult.status !== "pending") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(batchResult.status, "partial_failure", JSON.stringify(batchResult));
    assert.equal(batchResult.batchReceipt.status, "saved");
    assert.deepEqual(batchResult.items.map(item => item.receipt.status), ["saved", "saved", "failed"]);
    assert.equal(batchResult.items[2].receipt.failure.retryable, false);
    assert.equal(batchResult.items[2].receipt.failure.code, "solution_publication_record_missing");
    for (const item of batchResult.items.slice(0, 2)) {
      const lateRecord = await client.callTool({ name: "get_activity_practice_record", arguments: { activityId: item.activityId } });
      assert.equal(lateRecord.isError, undefined, JSON.stringify(lateRecord));
      assert.deepEqual(lateRecord.structuredContent.solutionPublication, item.receipt.result.publication);
      assert.equal(item.receipt.result.publication.solutionRevision, 1);
    }
    const nativeAfter = await client.callTool({ name: "get_activity_practice_record", arguments: { activityId: native.activityId } });
    assert.deepEqual(nativeAfter.structuredContent.practiceRecord, nativeBefore.structuredContent.practiceRecord);
    const importedAfterResponse = await fetch(`${base}/fixture/imported-reader?activityId=${encodeURIComponent(completedDesign.activityId)}`);
    assert.equal(importedAfterResponse.status, 200);
    assert.equal(importedAfterResponse.headers.get("cache-control"), "private, no-store");
    const importedAfter = await importedAfterResponse.json();
    assert.deepEqual(importedAfter.record.solutionPublication, batchResult.items[0].receipt.result.publication);
    assert.deepEqual({ ...importedAfter.record, solutionPublication: null }, importedBefore.record);
    const repeated = await client.callTool({ name: "publish_practice_solutions", arguments: batch });
    assert.equal(repeated.isError, undefined, JSON.stringify(repeated));
    assert.deepEqual(repeated.structuredContent.items, batchResult.items);
    const changedBatch = structuredClone(batch); changedBatch.items[0].expectedSolutionRevision = 1;
    assert.equal((await client.callTool({ name: "publish_practice_solutions", arguments: changedBatch })).isError, true);
    assert.deepEqual(await (await fetch(`${base}/fixture/immutable-practice`)).json(), originalFingerprints);

    const conflictingChild = await (await fetch(`${base}/fixture/reserve-conflicting-solution-child`, { method: "POST" })).json();
    const interruptedBatch = { batchId: "synthetic-interrupted-batch", items: batch.items.map(item => {
      const reuse = { ...item, expectedSolutionRevision: 1, action: "reuse_current" };
      delete reuse.solutionProfile;
      return reuse;
    }) };
    const interruptedQueued = await client.callTool({ name: "publish_practice_solutions", arguments: interruptedBatch });
    assert.equal(interruptedQueued.isError, undefined, JSON.stringify(interruptedQueued));
    assert.equal(interruptedQueued.structuredContent.items.length, 3);
    let interruptedResult;
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.equal((await fetch(`${base}/fixture/scheduled`, { method: "POST" })).status, 200);
      const status = await client.callTool({ name: "get_practice_solution_batch", arguments: { batchId: interruptedBatch.batchId } });
      assert.equal(status.isError, undefined, JSON.stringify(status));
      interruptedResult = status.structuredContent;
      if (interruptedResult.batchReceipt.status === "failed" && interruptedResult.items[0]?.receipt?.status === "saved") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(interruptedResult.status, "failed", JSON.stringify(interruptedResult));
    assert.equal(interruptedResult.batchReceipt.failure.code, "specialist_write_identity_conflict");
    assert.deepEqual(interruptedResult.items.map(item => item.state), ["saved", "failed", "not_queued"]);
    assert.deepEqual(interruptedResult.items.slice(0, 2).map(item => item.receipt.status), ["saved", "failed"]);
    assert.equal(interruptedResult.items[2].receipt, null);
    assert.equal(interruptedResult.items[0].receipt.result.publication.action, "reused");
    assert.equal(interruptedResult.items[1].jobId, conflictingChild.jobId);
    assert.equal(interruptedResult.items[1].receipt.failure.code, "synthetic_existing_failure");
    assert.deepEqual(await (await fetch(`${base}/fixture/immutable-practice`)).json(), originalFingerprints);
  }
});

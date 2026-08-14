import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";
import { specialistFinalizationJobId } from "../mcp-worker/specialist-write-policy.ts";
import {
  availableMcpPort,
  connectMcpClient,
  runMcpCommand,
  startMcpWorker,
  waitForMcpWorker,
} from "./helpers/mcp-worker-harness.mjs";

const project = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const prose = (topic, count) => Array.from({ length: count }, (_, index) => `${topic}${index + 1}`).join(" ");

const javaCode = `class Solution {
  public int solve(int[] values) {
    int best = values[0];
    for (int value : values) best = Math.max(best, value);
    return best;
  }
}`;
const pythonCode = `class Solution:
    def solve(self, values: list[int]) -> int:
        best = values[0]
        for value in values:
            best = max(best, value)
        return best`;

function completeLeetcodeProfile() {
  return {
    schemaVersion: 1,
    summary: prose("summary", 20),
    sections: [
      { title: "Pattern recognition and constraints", body: prose("pattern", 35) },
      { title: "Best approach", body: prose("algorithm", 70) },
      { title: "Reference implementations", body: `${prose("implementation", 35)}\n\n\`\`\`java\n${javaCode}\n\`\`\`\n\n\`\`\`python\n${pythonCode}\n\`\`\`` },
      { title: "Correctness reasoning", body: `The invariant is preserved before and after every transition. ${prose("proof", 45)} Therefore the algorithm is correct.` },
      { title: "Time and space complexity", body: `Time O(n) visits every value once. Space O(1) keeps only the current optimum. ${prose("complexity", 20)}` },
      { title: "Edge cases", body: `- A single value is its own maximum.\n- Duplicate values preserve the invariant.\n- Maximum integers require no arithmetic.\n${prose("edge", 25)}` },
      {
        title: "Meaningful alternatives",
        body: `### Alternative: Sort a defensive copy

#### When and why to choose
Choose sorting when ordered output is also needed or simple auditing matters more than linear time. ${prose("choice", 20)}

#### Algorithm
Copy the values, sort the copy, and return the final value after confirming the nonempty input contract. ${prose("algorithm", 28)}

#### Invariant and correctness
The invariant is that sorting places no larger value before a smaller final element, so the final element is maximal. ${prose("correctness", 28)}

#### Complexity
Time O(n log n) is dominated by sorting. Space O(n) preserves the caller-owned input. ${prose("cost", 15)}

#### Edge cases
- One value remains unchanged.\n- Equal values remain correct.\n- Extreme integers require no arithmetic.

#### Tradeoffs versus preferred
Sorting is slower and allocates memory, but it can reuse a required ordered representation and is straightforward to inspect. ${prose("tradeoff", 20)}

#### Reference implementation
\`\`\`java
class Solution {
  public int solve(int[] values) {
    int[] copy = values.clone();
    java.util.Arrays.sort(copy);
    return copy[copy.length - 1];
  }
}
\`\`\``,
      },
      { title: "Common mistakes and recall cues", body: prose("mistake", 35) },
      { title: "Interview walkthrough", body: prose("walkthrough", 40) },
    ],
    tags: ["array"],
    references: [{ title: "Maximum value problem", url: "https://example.test/maximum-value", accessedAt: "2026-08-13T18:02:00.000Z" }],
  };
}

function completeSystemDesignProfile() {
  return {
    schemaVersion: 1,
    summary: prose("summary", 20),
    sections: [
      { title: "Problem framing and assumptions", body: prose("scope", 45) },
      { title: "Functional requirements", body: prose("function", 30) },
      { title: "Non-functional requirements", body: prose("quality", 30) },
      { title: "Capacity estimates", body: `Assume 10 million users, 50k requests per second, 5 TB retained data, and p99 latency below 200 ms. ${prose("estimate", 30)}` },
      { title: "API contracts", body: `${prose("contract", 40)}\n\n\`\`\`http\nPOST /v1/items\nContent-Type: application/json\n\n{"name":"example"}\n\nHTTP/1.1 201 Created\n{"id":"item-1"}\n\`\`\`` },
      { title: "Data model", body: `${prose("record", 45)}\n\n\`\`\`sql\nCREATE TABLE items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, version INTEGER NOT NULL);\n\`\`\`` },
      { title: "Architecture", body: `${prose("component", 90)}\n\n![Versioned architecture](design-example.svg)` },
      { title: "End-to-end flows", body: prose("flow", 70) },
      { title: "Scaling and performance", body: prose("scaling", 60) },
      { title: "Reliability and failure recovery", body: prose("recovery", 65) },
      { title: "Security and privacy", body: prose("security", 50) },
      { title: "Observability and operations", body: prose("operation", 50) },
      { title: "Tradeoffs and alternatives", body: prose("tradeoff", 60) },
      { title: "Interview walkthrough", body: prose("walkthrough", 65) },
      { title: "Likely follow-ups", body: prose("followup", 35) },
    ],
    tags: ["event-streaming"],
    references: [],
  };
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent;
}

const callRaw = (client, name, args) => client.callTool({ name, arguments: args });

async function settledJob(client, jobId) {
  const deadline = Date.now() + 6_000;
  let delayMs = 25;
  while (Date.now() < deadline) {
    const result = await call(client, "get_specialist_write_status", { jobIds: [jobId] });
    if (["saved", "failed"].includes(result.jobs[0].status)) return result.jobs[0];
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 250);
  }
  throw new Error(`Specialist write ${jobId} did not settle.`);
}

async function assetRequest(baseUrl, token, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, body };
}

async function stageDesignAssets(baseUrl, token, activityId, questionId, label) {
  const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: { name: label } });
  const checkpointForm = (body = scene) => {
    const checkpoint = new FormData();
    checkpoint.set("metadata", JSON.stringify({
      operationId: "checkpoint-practice-record",
      expectedRevision: 0,
      altText: `${label} original system design checkpoint`,
    }));
    checkpoint.set("scene", new Blob([body], { type: "application/vnd.excalidraw+json" }), "attempt.excalidraw");
    return checkpoint;
  };
  const invalidCheckpoint = await assetRequest(baseUrl, token, `/practice-assets/checkpoints/${encodeURIComponent(activityId)}`, {
    method: "PUT",
    body: checkpointForm(new Uint8Array([0xff, 0xfe, 0xfd])),
  });
  assert.equal(invalidCheckpoint.response.status, 400);
  assert.match(invalidCheckpoint.body.error, /valid UTF-8 JSON/);

  const checkpointResults = await Promise.all([checkpointForm(), checkpointForm()].map((body) => assetRequest(
    baseUrl,
    token,
    `/practice-assets/checkpoints/${encodeURIComponent(activityId)}`,
    { method: "PUT", body },
  )));
  for (const result of checkpointResults) {
    assert.equal(result.response.status, 200);
    assert.equal(result.body.checkpoint.revision, 1);
    assert.match(result.body.checkpoint.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(checkpointResults.map((result) => result.body.duplicate).sort(), [false, true]);

  const restored = await assetRequest(
    baseUrl,
    token,
    `/practice-assets/checkpoints/${encodeURIComponent(activityId)}`,
  );
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.scene, scene);
  assert.equal(restored.body.checkpoint.revision, 1);
  assert.doesNotMatch(JSON.stringify(restored.body), /practice-assets\//);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`;
  const assetForm = (svgBody = svg) => {
    const assets = new FormData();
    assets.set("metadata", JSON.stringify({
      operationId: "asset-set-practice-record",
      questionId,
      checkpointRevision: 1,
      assets: [
        { role: "attempt_original_excalidraw", altText: `${label} editable original design` },
        { role: "attempt_original_svg", altText: `${label} original design preview` },
      ],
    }));
    assets.set("attempt_original_excalidraw", new Blob([scene], { type: "application/vnd.excalidraw+json" }), "attempt.excalidraw");
    assets.set("attempt_original_svg", new Blob([svgBody], { type: "image/svg+xml" }), "attempt.svg");
    return assets;
  };
  const assetResults = await Promise.all([assetForm(), assetForm()].map((body) => assetRequest(
    baseUrl,
    token,
    `/practice-assets/sets/${encodeURIComponent(activityId)}`,
    { method: "POST", body },
  )));
  for (const result of assetResults) {
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "staged");
    assert.match(result.body.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.body.assets.length, 2);
    assert.doesNotMatch(JSON.stringify(result.body), /practice-assets\//);
  }
  assert.deepEqual(assetResults.map((result) => result.body.duplicate).sort(), [false, true]);
  assert.equal(assetResults[0].body.manifestSha256, assetResults[1].body.manifestSha256);
  const staged = assetResults.find((result) => result.body.duplicate === false);
  const changedAssets = new FormData();
  changedAssets.set("metadata", JSON.stringify({
    operationId: "asset-set-practice-record",
    questionId,
    checkpointRevision: 1,
    assets: [
      { role: "attempt_original_excalidraw", altText: `${label} editable original design` },
      { role: "attempt_original_svg", altText: `${label} original design preview` },
    ],
  }));
  changedAssets.set("attempt_original_excalidraw", new Blob([scene], { type: "application/vnd.excalidraw+json" }), "attempt.excalidraw");
  changedAssets.set("attempt_original_svg", new Blob([`${svg}<!-- changed -->`], { type: "image/svg+xml" }), "attempt.svg");
  const conflict = await assetRequest(
    baseUrl,
    token,
    `/practice-assets/sets/${encodeURIComponent(activityId)}`,
    { method: "POST", body: changedAssets },
  );
  assert.equal(conflict.response.status, 400);
  assert.match(conflict.body.error, /different immutable bytes/);
  return { scene, svg, staged };
}

test("complete finalization becomes saved only with an exact immutable Practice Record readback", { timeout: 180_000 }, async () => {
  const token = "ia_practice_record_owner_token_01";
  const otherToken = "ia_practice_record_other_token_01";
  const activityId = "activity-practice-record";
  const incompleteActivityId = "activity-practice-record-incomplete";
  const leetcodeActivityId = "activity-practice-record-leetcode";
  const leetcodeQuestionId = "maximum-value-fixture";
  const storageCollisionActivityId = "activity-practice-record-storage-collision";
  const storageCollisionModeOperation = "mode-practice-record-storage-collision";
  const questionId = "design-durable-finalization";
  const operationId = "mode-practice-record-finalization";
  const startedAt = Date.parse("2026-08-13T18:00:00.000Z");
  const completedAt = Date.parse("2026-08-13T18:02:00.000Z");
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-practice-record-"));
    const port = await availableMcpPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const storageCollisionJobId = await specialistFinalizationJobId(storageCollisionModeOperation);
    await runMcpCommand(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config], project);
    await runMcpCommand(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(token)}','owner-practice-record','Practice Record integration',1,NULL,NULL),
        ('${sha256(otherToken)}','owner-practice-record-other','Other Practice Record owner',1,NULL,NULL);
      INSERT INTO extra_activities
        (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES ('owner-practice-record','${activityId}','2026-08-13',NULL,
        '{"schemaVersion":2,"id":"${activityId}","questionId":"${questionId}","date":"2026-08-13","source":"extra","type":"systemDesign","title":"Design durable finalization","allocatedSeconds":3600,"timingSource":"website","status":"completed","sessionId":"session-practice-record"}',1,${completedAt}),
        ('owner-practice-record-other','${activityId}','2026-08-13',NULL,
        '{"schemaVersion":2,"id":"${activityId}","questionId":"${questionId}","date":"2026-08-13","source":"extra","type":"systemDesign","title":"Other owner durable finalization","allocatedSeconds":3600,"timingSource":"manual","status":"completed","sessionId":"session-practice-record-other"}',1,${completedAt + 120_000}),
        ('owner-practice-record','${incompleteActivityId}','2026-08-13',NULL,
        '{"schemaVersion":2,"id":"${incompleteActivityId}","questionId":"${questionId}","date":"2026-08-13","source":"extra","type":"systemDesign","title":"Incomplete durable finalization","allocatedSeconds":3600,"timingSource":"website","status":"completed"}',1,${completedAt}),
        ('owner-practice-record','${leetcodeActivityId}','2026-08-13',NULL,
        '{"schemaVersion":2,"id":"${leetcodeActivityId}","questionId":"${leetcodeQuestionId}","date":"2026-08-13","source":"extra","type":"leetcode","title":"Maximum Value Fixture","allocatedSeconds":2400,"timingSource":"website","status":"completed"}',1,${completedAt}),
        ('owner-practice-record','${storageCollisionActivityId}','2026-08-13',NULL,
        '{"schemaVersion":2,"id":"${storageCollisionActivityId}","questionId":"${questionId}","date":"2026-08-13","source":"extra","type":"systemDesign","title":"Storage collision fixture","allocatedSeconds":3600,"timingSource":"website","status":"completed"}',1,${completedAt});
      INSERT INTO timers
        (owner_id,subject_id,kind,accumulated_seconds,started_at,running_since,completed,completed_at,revision,updated_at)
      VALUES
        ('owner-practice-record','${activityId}','activity',120,${startedAt},NULL,1,${completedAt},2,${completedAt}),
        ('owner-practice-record-other','${activityId}','activity',240,${startedAt},NULL,1,${completedAt + 120_000},2,${completedAt + 120_000}),
        ('owner-practice-record','${incompleteActivityId}','activity',60,${startedAt},NULL,1,${completedAt},1,${completedAt}),
        ('owner-practice-record','${leetcodeActivityId}','activity',180,${startedAt},NULL,1,${completedAt},2,${completedAt}),
        ('owner-practice-record','${storageCollisionActivityId}','activity',90,${startedAt},NULL,1,${completedAt},2,${completedAt});
      INSERT INTO outcomes (owner_id,activity_id,outcome,revision,updated_at)
      VALUES
        ('owner-practice-record','${activityId}','solved_after_reviewing_approach',1,${completedAt}),
        ('owner-practice-record-other','${activityId}','failed',1,${completedAt + 120_000}),
        ('owner-practice-record','${incompleteActivityId}','failed',1,${completedAt}),
        ('owner-practice-record','${leetcodeActivityId}','solved',1,${completedAt}),
        ('owner-practice-record','${storageCollisionActivityId}','failed',1,${completedAt});
      INSERT INTO practice_transcript_turns
        (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
      VALUES
        ('owner-practice-record','${activityId}','user-practice-record','system_design','user','I would use an owner-scoped outbox.','codex',1,${startedAt + 30_000},${startedAt + 30_000}),
        ('owner-practice-record','${activityId}','specialist-practice-record','system_design','specialist','Add immutable revisions and exact readback.','codex',2,${startedAt + 60_000},${startedAt + 60_000}),
        ('owner-practice-record-other','${activityId}','user-practice-record','system_design','user','Other owner answer must remain isolated.','codex',1,${startedAt + 30_000},${startedAt + 30_000}),
        ('owner-practice-record-other','${activityId}','specialist-practice-record','system_design','specialist','Other owner review must remain isolated.','codex',2,${startedAt + 60_000},${startedAt + 60_000}),
        ('owner-practice-record','${incompleteActivityId}','user-practice-record-incomplete','system_design','user','This activity has no semantic record sidecar.','codex',1,${startedAt + 30_000},${startedAt + 30_000}),
        ('owner-practice-record','${incompleteActivityId}','specialist-practice-record-incomplete','system_design','specialist','The incomplete packet must remain blocked.','codex',2,${startedAt + 60_000},${startedAt + 60_000}),
        ('owner-practice-record','${leetcodeActivityId}','user-practice-record-leetcode','leetcode','user','I scan once and keep the largest value.','codex',1,${startedAt + 30_000},${startedAt + 30_000}),
        ('owner-practice-record','${leetcodeActivityId}','specialist-practice-record-leetcode','leetcode','specialist','The invariant is that best is the maximum of the scanned prefix.','codex',2,${startedAt + 60_000},${startedAt + 60_000}),
        ('owner-practice-record','${storageCollisionActivityId}','user-practice-record-storage-collision','system_design','user','I would persist the semantic packet first.','codex',1,${startedAt + 30_000},${startedAt + 30_000}),
        ('owner-practice-record','${storageCollisionActivityId}','specialist-practice-record-storage-collision','system_design','specialist','Keep the attempt pending through the immutable record write.','codex',2,${startedAt + 60_000},${startedAt + 60_000});
      INSERT INTO practice_notes
        (owner_id,id,activity_id,date,body,kind,pinned,created_at,updated_at)
      VALUES ('owner-practice-record','note-practice-record','${activityId}','2026-08-13','Remember the compare-and-set boundary.','remember',1,${startedAt + 90_000},${startedAt + 90_000});
      INSERT INTO leetcode_code_attempts
        (owner_id,id,activity_id,originating_turn_id,sequence,language,code,line_count,occurred_at,review,review_response_turn_id,observed_correctness,concrete_findings,edge_cases,complexity,final_declaration,created_at,updated_at)
      VALUES ('owner-practice-record','attempt-practice-record-leetcode','${leetcodeActivityId}','user-practice-record-leetcode',1,'java','class Solution { int solve(int[] v) { int b=v[0]; for(int x:v) b=Math.max(b,x); return b; } }',1,${startedAt + 30_000},
        '{"schemaVersion":1,"status":"complete","summary":"The prefix-maximum invariant is correct.","whatWentWell":["Maintained the prefix maximum."],"whatToImprove":["State the nonempty constraint."],"testingEvidence":["Reviewed the exact source against single and duplicate values."],"nextStep":"Reimplement without looking.","provenance":"specialist_observed","reviewedAt":${startedAt + 60_000}}',
        'specialist-practice-record-leetcode','appears_correct','["Maintains the maximum of the scanned prefix."]','["Single value","Duplicate maxima","Extreme integers"]','{"time":"O(n)","space":"O(1)"}','The exact owner code appears correct for the stated constraints.',${startedAt + 60_000},${startedAt + 60_000});
      INSERT INTO practice_record_revisions
        (owner_id,activity_id,revision,operation_id,request_fingerprint,record_fingerprint,payload,created_at)
      VALUES ('owner-practice-record','different-activity',1,'${storageCollisionJobId}','different-request','${"a".repeat(64)}','{}',1);
    `], project);
    const started = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = started.child;
    await waitForMcpWorker(baseUrl, worker);
    client = await connectMcpClient(baseUrl, token, "practice-record-integration");
    otherClient = await connectMcpClient(baseUrl, otherToken, "practice-record-other-owner");

    const primaryAssets = await stageDesignAssets(baseUrl, token, activityId, questionId, "Primary owner");
    const otherAssets = await stageDesignAssets(baseUrl, otherToken, activityId, questionId, "Other owner");

    const finalization = {
      activityId,
      specialty: "system_design",
      questionId,
      finalization: {
        title: "Design durable finalization",
        complete: true,
        summary: "The attempt established an owner-scoped outbox, immutable revisions, and exact readback before success.",
        transcriptScope: "full_activity",
        review: {
          didWell: ["Separated the semantic packet from mechanical persistence."],
          improve: ["State the compare-and-set conflict path earlier."],
        },
        modelAnswer: "Use an owner-scoped outbox, immutable revisions, and exact readback before exposing the completed record.",
        references: [{ title: "Durable execution", url: "https://example.test/durable", accessedAt: "2026-08-13T18:02:00.000Z" }],
        interactionModeClassificationOperationId: operationId,
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: ["specialist-practice-record"],
          assistanceEvents: [],
        },
        solutionProfileAction: "create_or_revise",
        solutionProfile: completeSystemDesignProfile(),
        practiceRecord: {
          prompt: {
            body: "Design a durable asynchronous specialist-finalization pipeline that never exposes partial records.",
            canonicalUrl: "https://example.test/design-durable-finalization",
          },
          responseStages: [{
            key: "durability_boundary",
            state: "partially_answered",
            ownerResponse: "Use an owner-scoped outbox.",
            mentorGuidance: "Add immutable revision insertion, compare-and-set, and exact readback.",
            finalUnderstanding: "The job is saved only after exact revision, fingerprint, and link readback.",
            turnIds: ["user-practice-record", "specialist-practice-record"],
          }],
          nextDrill: "Explain crash recovery between pointer update and receipt completion.",
          assetSet: {
            operationId: "asset-set-practice-record",
            manifestSha256: primaryAssets.staged.body.manifestSha256,
          },
        },
      },
    };

    const queued = await call(client, "save_specialist_finalization", finalization);
    const jobId = queued.writeReceipt?.jobId ?? queued.writeReceipt?.job_id ?? queued.jobId;
    const receipt = queued.writeReceipt?.status === "saved"
      ? queued.writeReceipt
      : await settledJob(client, jobId);
    assert.equal(receipt.status, "saved");
    assert.equal(receipt.result.practiceRecord.revision, 1);
    assert.match(receipt.result.practiceRecord.fingerprint, /^[a-f0-9]{64}$/);

    const readback = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(readback.practiceRecord.revision, 1);
    assert.equal(readback.practiceRecord.fingerprint, receipt.result.practiceRecord.fingerprint);
    assert.equal(readback.practiceRecord.payload.activityId, activityId);
    assert.equal(readback.practiceRecord.payload.questionId, questionId);
    assert.equal(readback.practiceRecord.payload.completedAt, "2026-08-13T18:02:00.000Z");
    assert.equal(readback.practiceRecord.payload.practiceDate, "2026-08-13");
    assert.deepEqual(readback.practiceRecord.payload.timing, {
      source: "website",
      startedAt: "2026-08-13T18:00:00.000Z",
      endedAt: "2026-08-13T18:02:00.000Z",
      elapsedSeconds: 120,
      sessionId: "session-practice-record",
    });
    assert.equal(readback.practiceRecord.payload.transcript.turnCount, 2);
    assert.equal(readback.practiceRecord.payload.transcript.firstTurnId, "user-practice-record");
    assert.equal(readback.practiceRecord.payload.transcript.lastTurnId, "specialist-practice-record");
    assert.deepEqual(readback.practiceRecord.payload.specialtyOutput.codeAttemptIds, []);
    assert.equal(readback.practiceRecord.payload.specialtyOutput.designAssetIds.length, 2);
    assert.equal(readback.practiceRecord.payload.assetLinks.length, 2);
    assert.equal(readback.practiceRecord.payload.specialtyOutput.kind, "your_design");
    assert.deepEqual(readback.practiceRecord.payload.solutionLink, { questionId, profileRevision: 1 });
    assert.equal(readback.finalization.practiceRecordRevision, 1);
    assert.equal(readback.finalization.practiceRecordFingerprint, receipt.result.practiceRecord.fingerprint);
    for (const asset of primaryAssets.staged.body.assets) {
      const file = await assetRequest(baseUrl, token, `/practice-assets/files/${asset.assetId}/${asset.revision}`);
      assert.equal(file.response.status, 200);
      assert.equal(file.body, asset.role === "attempt_original_excalidraw" ? primaryAssets.scene : primaryAssets.svg);
      const foreign = await assetRequest(baseUrl, otherToken, `/practice-assets/files/${asset.assetId}/${asset.revision}`);
      assert.equal(foreign.response.status, 404);
    }

    const replay = await call(client, "save_specialist_finalization", finalization);
    assert.equal(replay.writeReceipt.status, "saved");
    assert.equal(replay.writeReceipt.duplicate, true);
    assert.deepEqual(replay.writeReceipt.result.practiceRecord, receipt.result.practiceRecord);
    const changedReplay = await callRaw(client, "save_specialist_finalization", {
      ...finalization,
      finalization: {
        ...finalization.finalization,
        summary: "Changed bytes must not reuse an immutable finalization identity.",
      },
    });
    assert.equal(changedReplay.isError, true);
    assert.equal(changedReplay.structuredContent.code, "specialist_write_identity_conflict");
    assert.equal(changedReplay.structuredContent.retryable, false);

    const otherFinalization = {
      ...finalization,
      finalization: {
        ...finalization.finalization,
        practiceRecord: {
          ...finalization.finalization.practiceRecord,
          assetSet: {
            operationId: "asset-set-practice-record",
            manifestSha256: otherAssets.staged.body.manifestSha256,
          },
        },
      },
    };
    const otherQueued = await call(otherClient, "save_specialist_finalization", otherFinalization);
    const otherJobId = otherQueued.writeReceipt?.jobId ?? otherQueued.jobId;
    const otherReceipt = otherQueued.writeReceipt?.status === "saved"
      ? otherQueued.writeReceipt
      : await settledJob(otherClient, otherJobId);
    assert.equal(otherReceipt.status, "saved");
    assert.equal(otherReceipt.result.practiceRecord.revision, 1);
    assert.notEqual(otherReceipt.result.practiceRecord.fingerprint, receipt.result.practiceRecord.fingerprint);
    const otherReadback = await call(otherClient, "get_activity_practice_record", { activityId });
    assert.equal(otherReadback.practiceRecord.payload.prompt.title, "Other owner durable finalization");
    assert.equal(otherReadback.practiceRecord.payload.outcome, "failed");
    assert.equal(otherReadback.practiceRecord.payload.timing.source, "manual");
    assert.equal(otherReadback.turns[0].body, "Other owner answer must remain isolated.");
    for (const asset of otherAssets.staged.body.assets) {
      const otherFile = await assetRequest(baseUrl, otherToken, `/practice-assets/files/${asset.assetId}/${asset.revision}`);
      assert.equal(otherFile.response.status, 200);
      assert.equal(otherFile.body, asset.role === "attempt_original_excalidraw" ? otherAssets.scene : otherAssets.svg);
    }
    const ownerReadbackAfterCollision = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(ownerReadbackAfterCollision.practiceRecord.fingerprint, receipt.result.practiceRecord.fingerprint);
    assert.equal(ownerReadbackAfterCollision.turns[0].body, "I would use an owner-scoped outbox.");

    const boundedDetail = "detail ".repeat(2_857);
    const oversizedPacket = await callRaw(client, "save_specialist_finalization", {
      activityId: incompleteActivityId,
      specialty: "system_design",
      questionId,
      finalization: {
        ...finalization.finalization,
        title: "Oversized semantic packet fixture",
        summary: "The structured sidecar intentionally exceeds the bounded immutable Practice Record row budget.",
        solutionProfileAction: "reuse_current",
        solutionProfile: undefined,
        interactionModeClassificationOperationId: "mode-practice-record-oversized",
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: ["specialist-practice-record-incomplete"],
          assistanceEvents: [],
        },
        practiceRecord: {
          prompt: {
            body: "Design a bounded immutable finalization record.",
            canonicalUrl: "https://example.test/design-durable-finalization",
          },
          responseStages: Array.from({ length: 9 }, (_, index) => ({
            key: `oversized_stage_${index + 1}`,
            state: "answered",
            ownerResponse: boundedDetail,
            mentorGuidance: boundedDetail,
            finalUnderstanding: boundedDetail,
            turnIds: ["user-practice-record-incomplete", "specialist-practice-record-incomplete"],
          })),
          nextDrill: "Keep the durable semantic packet bounded before enqueue.",
        },
      },
    });
    assert.equal(oversizedPacket.isError, true);
    assert.equal(oversizedPacket.structuredContent.code, "specialist_write_rejected");
    assert.match(oversizedPacket.structuredContent.error, /bounded byte limit/);
    const oversizedReadback = await call(client, "get_activity_practice_record", {
      activityId: incompleteActivityId,
    });
    assert.equal(oversizedReadback.practiceRecord, null);
    assert.equal(oversizedReadback.finalization, null);

    const foreignTurnPacket = await callRaw(client, "save_specialist_finalization", {
      activityId: incompleteActivityId,
      specialty: "system_design",
      questionId,
      finalization: {
        ...finalization.finalization,
        title: "Foreign turn identity fixture",
        summary: "The semantic sidecar intentionally points at a turn owned by a different activity.",
        solutionProfileAction: "reuse_current",
        solutionProfile: undefined,
        interactionModeClassificationOperationId: "mode-practice-record-foreign-turn",
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: ["specialist-practice-record-incomplete"],
          assistanceEvents: [],
        },
        practiceRecord: {
          prompt: {
            body: "Design a finalization boundary with exact activity-scoped evidence.",
            canonicalUrl: "https://example.test/design-durable-finalization",
          },
          responseStages: [{
            key: "foreign_turn",
            state: "answered",
            ownerResponse: "This response must bind only to its own transcript.",
            mentorGuidance: null,
            finalUnderstanding: "Cross-activity turn identities are rejected before semantic persistence.",
            turnIds: ["user-practice-record"],
          }],
          nextDrill: "Explain why owner isolation alone is insufficient without activity isolation.",
        },
      },
    });
    assert.equal(foreignTurnPacket.isError, true);
    assert.equal(foreignTurnPacket.structuredContent.code, "specialist_write_rejected");
    assert.match(foreignTurnPacket.structuredContent.error, /turn IDs from that exact activity transcript/);
    const foreignTurnReadback = await call(client, "get_activity_practice_record", {
      activityId: incompleteActivityId,
    });
    assert.equal(foreignTurnReadback.practiceRecord, null);
    assert.equal(foreignTurnReadback.finalization, null);

    const leetcodeFinalization = {
      activityId: leetcodeActivityId,
      specialty: "leetcode",
      questionId: leetcodeQuestionId,
      finalization: {
        title: "Maximum Value Fixture",
        complete: true,
        summary: "The owner submitted a one-pass prefix-maximum implementation and explained its invariant and linear complexity.",
        transcriptScope: "activity_exchanges",
        review: {
          didWell: ["Maintained the prefix maximum."],
          improve: ["State the nonempty constraint."],
        },
        modelAnswer: "Scan once, retaining the maximum of the prefix already processed.",
        references: [{ title: "Maximum value problem", url: "https://example.test/maximum-value", accessedAt: "2026-08-13T18:02:00.000Z" }],
        interactionModeClassificationOperationId: "mode-practice-record-leetcode",
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: ["specialist-practice-record-leetcode"],
          assistanceEvents: [],
        },
        solutionProfileAction: "create_or_revise",
        solutionProfile: completeLeetcodeProfile(),
        practiceRecord: {
          prompt: {
            body: "Given a nonempty integer array, return its maximum value using the required solve(int[]) API.",
            canonicalUrl: "https://example.test/maximum-value",
          },
          responseStages: [{
            key: "preferred_algorithm",
            state: "answered",
            ownerResponse: "Scan once and retain the largest value seen.",
            mentorGuidance: "Name the prefix-maximum invariant and nonempty constraint.",
            finalUnderstanding: "After each iteration, best equals the maximum of the scanned prefix.",
            turnIds: ["user-practice-record-leetcode", "specialist-practice-record-leetcode"],
          }],
          nextDrill: "Reimplement the scan and proof without looking.",
        },
      },
    };
    const leetcodeSaved = await call(client, "save_specialist_finalization", leetcodeFinalization);
    assert.equal(leetcodeSaved.writeReceipt.status, "saved");
    const leetcodeReadback = await call(client, "get_activity_practice_record", { activityId: leetcodeActivityId });
    assert.equal(leetcodeReadback.practiceRecord.payload.specialtyOutput.kind, "code_attempts");
    assert.deepEqual(
      leetcodeReadback.practiceRecord.payload.specialtyOutput.codeAttemptIds,
      ["attempt-practice-record-leetcode"],
    );
    assert.equal(leetcodeReadback.codeAttempts[0].code, "class Solution { int solve(int[] v) { int b=v[0]; for(int x:v) b=Math.max(b,x); return b; } }");

    const storageCollision = await callRaw(client, "save_specialist_finalization", {
      activityId: storageCollisionActivityId,
      specialty: "system_design",
      questionId,
      finalization: {
        ...finalization.finalization,
        title: "Storage collision fixture",
        summary: "The semantic phase succeeds, but an injected immutable-operation collision must keep the activity pending.",
        solutionProfileAction: "reuse_current",
        solutionProfile: undefined,
        interactionModeClassificationOperationId: storageCollisionModeOperation,
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: ["specialist-practice-record-storage-collision"],
          assistanceEvents: [],
        },
        practiceRecord: {
          prompt: {
            body: "Design a finalization path that does not expose partial durable state.",
            canonicalUrl: "https://example.test/design-durable-finalization",
          },
          responseStages: [{
            key: "partial_failure",
            state: "partially_answered",
            ownerResponse: "Persist the semantic packet first.",
            mentorGuidance: "Keep the finalization pending until immutable record readback.",
            finalUnderstanding: "A storage collision cannot promote the semantic bundle to ready.",
            turnIds: ["user-practice-record-storage-collision", "specialist-practice-record-storage-collision"],
          }],
          nextDrill: "Explain retry behavior after an ambiguous immutable write.",
        },
      },
    });
    assert.equal(storageCollision.isError, true);
    assert.equal(storageCollision.structuredContent.code, "specialist_write_rejected");
    const storageCollisionReadback = await call(client, "get_activity_practice_record", {
      activityId: storageCollisionActivityId,
    });
    assert.equal(storageCollisionReadback.practiceRecord, null);
    assert.equal(storageCollisionReadback.finalization.status, "draft");
    assert.equal(storageCollisionReadback.finalization.practiceRecordRevision, null);
    assert.equal(storageCollisionReadback.finalization.practiceRecordFingerprint, null);

    const incomplete = await callRaw(client, "save_specialist_finalization", {
      activityId: incompleteActivityId,
      specialty: "system_design",
      questionId,
      finalization: {
        ...finalization.finalization,
        title: "Incomplete durable finalization",
        summary: "The semantic packet intentionally omits its Practice Record sidecar.",
        solutionProfileAction: "reuse_current",
        solutionProfile: undefined,
        interactionModeClassificationOperationId: "mode-practice-record-incomplete",
        interactionModeEvidence: {
          schemaVersion: 1,
          provenance: "recorded",
          materialSpecialistTurnIds: ["specialist-practice-record-incomplete"],
          assistanceEvents: [],
        },
        practiceRecord: undefined,
      },
    });
    assert.equal(incomplete.isError, true);
    assert.equal(incomplete.structuredContent.code, "specialist_write_rejected");
    assert.match(incomplete.structuredContent.error, /exact Practice Record prompt, response stages, and review sidecar/);
    const incompleteReadback = await call(client, "get_activity_practice_record", { activityId: incompleteActivityId });
    assert.equal(incompleteReadback.practiceRecord, null);
    assert.equal(incompleteReadback.finalization, null);
  } finally {
    await otherClient?.close().catch(() => {});
    await client?.close().catch(() => {});
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => worker.once("exit", resolve));
    }
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

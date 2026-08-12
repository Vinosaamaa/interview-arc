import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { acquireMcpIntegrationLock } from "./helpers/mcp-integration-lock.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const project = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const MAX_DIAGNOSTIC_CHARS = 16_384;

function appendDiagnosticTail(current, chunk) {
  return `${current}${chunk}`.slice(-MAX_DIAGNOSTIC_CHARS);
}

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
    child.stdout.on("data", (chunk) => { stdout = appendDiagnosticTail(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendDiagnosticTail(stderr, chunk); });
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

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent;
}

const callRaw = (client, name, args) => client.callTool({ name, arguments: args });

function finalization({
  activityId,
  questionId,
  operationId,
  answer,
  responseTurnId,
  correction,
  solutionRevision = 1,
  scope = "universal",
  target,
  roleBrief,
  story,
  resumeContext = {
    resumeId: "resume-primary",
    revisionId: "resume-revision-1",
  },
  practiceScenarios = [{
    schemaVersion: 1,
    scenarioId: "retry-recovery-scenario",
    revision: 1,
    mode: "hypothetical",
    label: "Hypothetical practice scenario — not the owner's experience",
    purpose: "Practice a constrained recovery incident.",
    canon: {
      realSourceFacts: [{ statement: "Stable operation identities exist.", acceptedEvidenceIds: ["evidence-retry-boundary"] }],
      inventedPremises: ["A regional queue is delayed."],
      inventedActions: ["I introduce a bounded replay worker."],
      inventedResults: ["Recovery falls below ten minutes."],
    },
    answer: "I bounded replay and verified exact recovery receipts.",
    challengeMap: [{ challenge: "Why not retry inline?", response: "It extends visible latency." }],
    likelyFollowUps: ["How did you test ambiguous commits?"],
    limitations: ["The incident and result are invented for practice."],
    visibility: "owner_private",
  }],
}) {
  const selectedStory = story === undefined && questionId === "behavioral-reliability-1"
    ? { storyId: "story-retry-boundary", revision: 1 }
    : story;
  return {
    activityId,
    specialty: "behavioral",
    questionId,
    finalization: {
      title: "Tell me about a reliability improvement",
      complete: true,
      transcriptScope: "full_activity",
      review: { didWell: ["Scoped the decision."], improve: ["Add a measured outcome."] },
      behavioralAnalysis: {
        schemaVersion: 1,
        answerFormat: "STARL",
        competencies: ["ownership", "reliability"],
        claimAudit: [
          {
            claim: "I improved retry reliability.",
            status: "verified",
            supportingEvidenceIds: ["evidence-retry-boundary"],
            contraryEvidenceIds: [],
            gaps: [],
            contradictions: [],
          },
          {
            claim: "The production impact is measured.",
            status: "unverified",
            supportingEvidenceIds: [],
            contraryEvidenceIds: [],
            gaps: ["Production impact is not independently measured."],
            contradictions: [],
          },
        ],
        reviewDimensions: {
          relevance: { status: "strength", observation: "Answered the reliability prompt." },
          structure: { status: "strength", observation: "Used a clear progression." },
          specificity: { status: "mixed", observation: "The production impact is not measured." },
          personalOwnership: { status: "strength", observation: "Named the owner's retry decision." },
          decisions: { status: "strength", observation: "Explained identity-idempotent retries." },
          result: { status: "improvement", observation: "Add a measured outcome." },
          learning: { status: "strength", observation: "Extracted a reusable retry invariant." },
          delivery: { status: "not_observed" },
        },
        strengths: ["Scoped the decision."],
        improvements: ["Add a measured outcome."],
        coachingNotes: ["Generated coaching — not evidence: quantify only after owner confirmation."],
        likelyFollowUps: ["How did you test ambiguous commits?"],
        nextDrill: "Rehearse the measured-outcome follow-up in two minutes.",
      },
      ...(scope === "target_tailored" ? {
        behavioralReview: {
          schemaVersion: 1,
          universalQuality: {
            strengths: ["Scoped the decision."],
            improvements: ["Add a measured outcome."],
          },
          targetAlignment: {
            strengths: ["Connected the decision to reliability ownership."],
            gaps: ["Staff-level influence is not independently established."],
            competencySignals: roleBrief?.competencyEmphasis ?? target?.competencyEmphasis ?? [],
          },
          assistance: {
            level: "probing",
            details: ["Prompted for the measured outcome."],
          },
          evidenceGaps: ["Production impact is not independently measured."],
        },
      } : {}),
      modelAnswer: answer,
      references: [],
      solutionProfileAction: "create_or_revise",
      solutionProfile: {
        schemaVersion: 1,
        summary: "Retry safety and evidence boundaries.",
        sections: [{ title: "Answer", body: answer }],
        tags: ["reliability"],
        references: [],
        behavioralAnswer: {
          preferred: {
            label: "Universal",
            answer,
            evidence: ["evidence-retry-boundary"],
            evidenceGaps: ["Production impact is not independently measured."],
          },
          alternatives: [],
        },
        practiceScenarios,
      },
      finalAnswerOperationId: operationId,
      resumeContext,
      interactionModeClassificationOperationId: `mode-${operationId.toLowerCase()}`,
      interactionModeEvidence: {
        schemaVersion: 1,
        provenance: "recorded",
        materialSpecialistTurnIds: [responseTurnId],
        assistanceEvents: [],
      },
      finalAnswerSnapshot: {
        schemaVersion: 1,
        answer,
        scope,
        question: {
          questionId,
          title: "Tell me about a reliability improvement",
          prompt: "Tell me about a time you improved reliability.",
        },
        solutionProfile: { questionId, revision: solutionRevision },
        ...(selectedStory ? { story: selectedStory } : {}),
        acceptedEvidenceIds: ["evidence-retry-boundary"],
        evidenceGaps: ["Production impact is not independently measured."],
        contradictions: [],
        provenance: { responseTurnId },
        ...(target ? { target } : {}),
        ...(roleBrief ? { roleBrief } : {}),
      },
      ...(correction ? { finalAnswerCorrection: correction } : {}),
      ...(correction ? { interactionModeClassificationCorrection: correction } : {}),
    },
  };
}

test("behavioral finalization stores immutable exact snapshots through MCP", { timeout: 180_000 }, async () => {
  const token = "ia_behavioral_final_answer_owner";
  const otherToken = "ia_behavioral_final_answer_other";
  const activityId = "activity-behavioral-final-answer";
  const questionId = "behavioral-reliability-1";
  const responseTurnId = "behavioral-response-1";
  const answer = "I stabilized delivery by making retries identity-idempotent.";
  const correctedAnswer = "I stabilized delivery with identity-idempotent retries and explicit receipts.";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let sameOwnerClient;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-final-answer-"));
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await run(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config]);
    await run(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config, "--command", `
      INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(token)}','owner-final-answer','Final answer owner',1,NULL,NULL),
        ('${sha256(otherToken)}','other-final-answer','Other owner',1,NULL,NULL);
      INSERT INTO practice_transcript_turns
        (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
      VALUES
        ('owner-final-answer','${activityId}','behavioral-user-1','behavioral','user','I improved retry reliability.','codex',1,1786363200000,1786363200000),
        ('owner-final-answer','${activityId}','${responseTurnId}','behavioral','specialist','${answer}','codex',2,1786363201000,1786363201000),
        ('owner-final-answer','${activityId}','behavioral-response-2','behavioral','specialist','${correctedAnswer}','codex',3,1786363202000,1786363202000),
        ('owner-final-answer','activity-behavioral-voice','behavioral-voice-user','behavioral','user','A recorded answer about retry reliability.','audio_transcript',1,1786363210000,1786363210000),
        ('owner-final-answer','activity-behavioral-voice','behavioral-voice-response','behavioral','specialist','${answer}','codex',2,1786363211000,1786363211000);
      INSERT INTO behavioral_evidence_items
        (owner_id,evidence_id,project_key,origin,statement,source_revision,evidence_grade,
         attribution_grade,claim_strength,candidate_state,visibility,safe_provenance,supports,
         limitations,tags,owner_attestation,created_at,updated_at)
      VALUES
        ('owner-final-answer','evidence-retry-boundary','example-project','user_statement',
         'I improved retry reliability.',NULL,'E1','A0','user_confirmation_required','accepted',
         'owner_private','[]','[]','[]','[]',NULL,1,1);
      INSERT INTO behavioral_evidence_question_links
        (owner_id,question_id,evidence_id,relevance,created_at,updated_at)
      VALUES
        ('owner-final-answer','${questionId}','evidence-retry-boundary','supporting',1,1),
        ('owner-final-answer','behavioral-reliability-voice','evidence-retry-boundary','supporting',1,1);
      INSERT INTO behavioral_claims
        (owner_id,claim_id,question_id,text,scope,status,claim_strength,evidence_ids,
         contrary_evidence_ids,gaps,safer_wording,tags,visibility,revision,created_at,updated_at)
      VALUES
        ('owner-final-answer','claim-retry-reliability','${questionId}',
         'I improved retry reliability.','personal_contribution','verified',
         'personal_contribution_candidate','["evidence-retry-boundary"]','[]','[]',NULL,
         '["reliability"]','owner_private',1,1,1);
      INSERT INTO resume_sources
        (owner_id,resume_id,source_label,current_revision_id,created_at,updated_at)
      VALUES
        ('owner-final-answer','resume-primary','Primary resume','resume-revision-1',1,1);
      INSERT INTO resume_revisions
        (owner_id,resume_id,revision_id,parent_revision_id,source_fingerprint,
         import_operation_id,storage_generation,visibility,imported_at)
      VALUES
        ('owner-final-answer','resume-primary','resume-revision-1',NULL,
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'resume-import-operation-1','resume-storage-generation-1',
         'owner_private',1786363000000);
      INSERT INTO practice_interaction_mode_states
        (owner_id,activity_id,interaction_mode_id,registry_version,revision,source,last_mutation_id,updated_at)
      VALUES
        ('owner-final-answer','${activityId}','interviewer','2026-08-10.1',1,'explicit_user_instruction','mode-seed-1',1786363199000);
      INSERT INTO practice_interaction_mode_transitions
        (owner_id,activity_id,transition_id,mutation_id,from_interaction_mode_id,to_interaction_mode_id,
         from_revision,to_revision,registry_version,trigger_turn_id,source,reason,occurred_at,created_at)
      VALUES
        ('owner-final-answer','${activityId}','mode-transition-seed-1','mode-seed-1',NULL,'interviewer',
         0,1,'2026-08-10.1',NULL,'explicit_user_instruction','Start in Interviewer mode.',1786363199000,1786363199000);
      INSERT INTO timer_intervals (owner_id,subject_id,kind,started_at,ended_at)
      VALUES ('owner-final-answer','${activityId}','activity',1786363200000,1786363203000);
      INSERT INTO activity_finalizations
        (owner_id,activity_id,specialty,status,payload,finalized_at,published_at,revision,updated_at)
      VALUES
        ('owner-final-answer','activity-behavioral-legacy','behavioral','ready',
         '{"modelAnswer":"A historical answer saved before snapshot v1."}',1786363100000,NULL,1,1786363100000);
      INSERT INTO extra_activities (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES ('owner-final-answer','${activityId}','2026-08-10',NULL,
        '{"schemaVersion":2,"id":"${activityId}","questionId":"${questionId}","date":"2026-08-10","source":"extra","type":"behavioral","title":"Reliability improvement","allocatedSeconds":3600,"sessionId":"session-final-answer","timingSource":"website","status":"running"}',1,1),
        ('owner-final-answer','activity-loop-behavioral-other','2026-08-10',NULL,
        '{"schemaVersion":2,"id":"activity-loop-behavioral-other","questionId":"behavioral-other-question","date":"2026-08-10","source":"extra","type":"behavioral","title":"Different behavioral question","allocatedSeconds":1800,"timingSource":"website","status":"planned"}',1,1),
        ('owner-final-answer','activity-loop-legacy-envelope','2026-08-10',NULL,
        '{"schemaVersion":2,"id":"activity-loop-legacy-envelope","questionId":"${questionId}","date":"2026-08-10","source":"extra","type":"behavioral","title":"Legacy Role Brief envelope","allocatedSeconds":1800,"timingSource":"website","status":"planned"}',1,1);
      INSERT INTO loop_activity_bindings
        (owner_id,activity_id,loop_id,stage_id,loop_revision,role_brief_revision,specialty,question_id,
         role_brief_display_snapshot,binding_revision,created_at,updated_at)
      VALUES ('owner-final-answer','activity-loop-legacy-envelope','loop-legacy-envelope',NULL,1,1,
        'behavioral','${questionId}',
        '{"state":"active","label":"Legacy envelope company · Backend Engineer","company":"Legacy envelope company","roleTitle":"Backend Engineer","responsibilities":["Build reliable services"],"requiredQualifications":["Distributed systems"],"preferredQualifications":[],"competencySignals":["reliability"],"seniorityIndicators":[],"domainVocabulary":[],"verifiedCompanySignals":[],"unresolvedAmbiguities":[],"source":{"kind":"pasted_jd","displayLocator":"Owner-provided job description","capturedAt":1786363200000,"fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"revision":1,"createdAt":1786363200000}',
        1,1,1);
      INSERT INTO live_sessions (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES ('owner-final-answer','session-final-answer','2026-08-10',NULL,
        '{"schemaVersion":1,"id":"session-final-answer","date":"2026-08-10","source":"extra","label":"Behavioral final answer","allocatedSeconds":3600,"activityIds":["${activityId}"]}',0,1);
    `]);
    worker = spawn(wrangler, ["dev", "--local", "--persist-to", persistence, "--config", config, "--ip", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      stdio: ["ignore", "ignore", "ignore"],
    });
    await waitForWorker(baseUrl, worker);
    client = new Client({ name: "final-answer-owner", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    sameOwnerClient = new Client({ name: "final-answer-owner-concurrent", version: "1.0.0" });
    await sameOwnerClient.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));

    const legacyEnvelopePreflight = await call(client, "get_behavioral_practice_preflight", {
      boundary: "reconnect_handoff",
      questionId,
      activityId: "activity-loop-legacy-envelope",
    });
    assert.equal(legacyEnvelopePreflight.roleBriefResolution.source, "activity");
    assert.equal(legacyEnvelopePreflight.roleBriefResolution.roleBrief.loopId, "loop-legacy-envelope");
    assert.equal(legacyEnvelopePreflight.roleBriefResolution.roleBrief.label, "Legacy envelope company · Backend Engineer");
    assert.doesNotMatch(JSON.stringify(legacyEnvelopePreflight), /fingerprint|ownerNotes|jdText/);

    const story = await call(client, "upsert_behavioral_story", {
      operationId: "story-final-answer-create-1",
      expectedRevision: 0,
      story: {
        schemaVersion: 1,
        storyId: "story-retry-boundary",
        state: "active",
        title: "Made retries identity-idempotent",
        projectKey: "example-project",
        situation: "A retry path could lose its visible receipt.",
        task: "Preserve one authoritative outcome through ambiguous delivery.",
        actions: ["Bound the retry to a stable identity.", "Read back the durable receipt."],
        result: "The same operation now resolves to one authoritative outcome.",
        learning: "Separate transport uncertainty from operation identity.",
        claimIds: ["claim-retry-reliability"],
        evidenceIds: ["evidence-retry-boundary"],
        gaps: ["Production impact is not independently measured."],
        competencies: ["ownership", "reliability"],
        questionIds: [questionId],
        visibility: "owner_private",
      },
    });
    assert.equal(story.revision, 1);
    const staleStory = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-stale-story",
      answer,
      responseTurnId,
      story: { storyId: "story-retry-boundary", revision: 2 },
    }));
    assert.equal(staleStory.isError, true);
    assert.equal(staleStory.structuredContent.code, "behavioral_final_answer_story_mismatch");
    const unversionedStory = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-unversioned-story",
      answer,
      responseTurnId,
      story: { storyId: "story-retry-boundary" },
    }));
    assert.equal(unversionedStory.isError, true);
    assert.equal(unversionedStory.structuredContent.code, "behavioral_final_answer_story_revision_required");

    const invalidOperationId = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "INVALID-OPERATION",
      answer,
      responseTurnId,
    }));
    assert.equal(invalidOperationId.isError, true);

    const missingResumeContextPayload = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-missing-resume",
      answer,
      responseTurnId,
    });
    delete missingResumeContextPayload.finalization.resumeContext;
    const missingResumeContext = await callRaw(client, "save_specialist_finalization", missingResumeContextPayload);
    assert.equal(missingResumeContext.isError, true);
    assert.equal(missingResumeContext.structuredContent.code, "behavioral_resume_context_required");

    const staleResumeContext = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-stale-resume",
      answer,
      responseTurnId,
      resumeContext: { resumeId: "resume-primary", revisionId: "resume-revision-stale" },
    }));
    assert.equal(staleResumeContext.isError, true);
    assert.equal(staleResumeContext.structuredContent.code, "behavioral_resume_context_mismatch");

    const firstPayload = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-1",
      answer,
      responseTurnId,
    });
    const concurrentFirst = await Promise.all([
      call(client, "save_specialist_finalization", firstPayload),
      call(sameOwnerClient, "save_specialist_finalization", firstPayload),
    ]);
    assert.deepEqual(concurrentFirst.map((result) => result.finalAnswer.status).sort(), ["created", "unchanged"]);
    const first = concurrentFirst.find((result) => result.finalAnswer.status === "created");
    assert.equal(first.finalAnswer.snapshotRevision, 1);
    assert.equal(first.interactionModeClassification.primaryPracticeModeId, "interviewer");
    assert.equal(first.interactionModeClassification.method, "active_timer_seconds");

    const record = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(record.finalAnswer.source, "snapshot_v1");
    assert.equal(record.finalAnswer.answer, answer);
    assert.equal(record.finalAnswer.solutionProfile.revision, 1);
    assert.deepEqual(record.finalAnswer.story, { storyId: "story-retry-boundary", revision: 1 });
    assert.equal(record.finalAnswerSnapshots.length, 1);
    assert.equal(record.finalAnswerSnapshotsTruncated, false);
    assert.equal(record.interactionModeClassification.snapshotRevision, 1);
    assert.equal(record.interactionModeClassification.classification.primaryPracticeModeId, "interviewer");
    assert.equal(record.interactionModeClassificationHistory.length, 1);
    assert.equal(record.turns.find((turn) => turn.turnId === responseTurnId).interactionMode.interactionModeId, "interviewer");
    assert.match(record.finalAnswerMarkdown, new RegExp(answer));
    assert.match(record.finalAnswerHtml, new RegExp(answer));
    assert.equal(record.practiceScenarios.solutionProfile.revision, 1);
    assert.equal(record.practiceScenarios.scenarios[0].scenarioId, "retry-recovery-scenario");
    assert.match(record.practiceScenariosMarkdown, /Hypothetical practice scenario — not the owner's experience/);
    assert.match(record.practiceScenariosHtml, /I bounded replay and verified exact recovery receipts\./);
    assert.equal(record.behavioralAnalysis.snapshotRevision, 1);
    assert.equal(record.behavioralAnalysis.analysis.claimAudit[1].status, "unverified");
    assert.match(record.behavioralAnalysisMarkdown, /Generated coaching — not evidence/);
    assert.match(record.behavioralAnalysisHtml, /Rehearse the measured-outcome follow-up/);
    const { capturedAt, ...resumeContext } = record.resumeContext;
    assert.ok(Number.isInteger(capturedAt) && capturedAt > 0);
    assert.deepEqual(resumeContext, {
      schemaVersion: 1,
      state: "contemporaneous",
      snapshotRevision: 1,
      resumeId: "resume-primary",
      resumeRevisionId: "resume-revision-1",
      sourceLabel: "Primary resume",
      resumeImportedAt: 1786363000000,
      claimIds: ["claim-retry-reliability"],
      evidenceIds: ["evidence-retry-boundary"],
    });
    assert.match(record.resumeContextMarkdown, /Primary resume · revision resume-revision-1/);
    assert.match(record.resumeContextHtml, /data-activity-resume-context="true"/);

    const missingAnalysisPayload = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-missing-analysis",
      answer,
      responseTurnId,
    });
    delete missingAnalysisPayload.finalization.behavioralAnalysis;
    const missingAnalysis = await callRaw(client, "save_specialist_finalization", missingAnalysisPayload);
    assert.equal(missingAnalysis.isError, true);
    assert.equal(missingAnalysis.structuredContent.code, "behavioral_attempt_analysis_required");

    const missingSnapshotPayload = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-missing",
      answer,
      responseTurnId,
    });
    delete missingSnapshotPayload.finalization.finalAnswerOperationId;
    delete missingSnapshotPayload.finalization.finalAnswerSnapshot;
    const missingSnapshot = await callRaw(client, "save_specialist_finalization", missingSnapshotPayload);
    assert.equal(missingSnapshot.isError, true);
    assert.equal(missingSnapshot.structuredContent.code, "behavioral_final_answer_required");

    const changedWithoutCorrection = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-no-correction",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
    }));
    assert.equal(changedWithoutCorrection.isError, true);
    assert.equal(changedWithoutCorrection.structuredContent.code, "behavioral_final_answer_correction_required");

    const exactRetry = await call(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-1",
      answer,
      responseTurnId,
    }));
    assert.equal(exactRetry.finalAnswer.status, "unchanged");
    assert.equal(exactRetry.finalAnswer.snapshotRevision, 1);

    const duplicateSnapshotIdentity = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-duplicate-identity",
      answer,
      responseTurnId,
    }));
    assert.equal(duplicateSnapshotIdentity.isError, true);
    assert.equal(
      duplicateSnapshotIdentity.structuredContent.code,
      "behavioral_final_answer_operation_conflict",
    );

    const changedOperationRetry = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-1",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      correction: { replacesSnapshotRevision: 1, reason: "Clarify the exact mechanism." },
    }));
    assert.equal(changedOperationRetry.isError, true);
    assert.equal(changedOperationRetry.structuredContent.code, "behavioral_final_answer_operation_conflict");

    const corrected = await call(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-2",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      correction: { replacesSnapshotRevision: 1, reason: "Clarify the exact mechanism." },
    }));
    assert.deepEqual(corrected.finalAnswer, { status: "corrected", snapshotRevision: 2 });
    const correctedRecord = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(correctedRecord.finalAnswer.answer, correctedAnswer);
    assert.equal(correctedRecord.finalAnswer.correctionOfRevision, 1);
    assert.equal(correctedRecord.finalAnswerSnapshots.length, 2);
    assert.equal(correctedRecord.practiceScenarios.solutionProfile.revision, 2);
    assert.equal(correctedRecord.practiceScenarios.scenarios[0].scenarioId, "retry-recovery-scenario");
    assert.equal(correctedRecord.finalAnswerSnapshots[0].snapshot.answer, answer);
    assert.equal(correctedRecord.finalAnswerSnapshots[1].snapshot.answer, correctedAnswer);
    assert.equal(correctedRecord.interactionModeClassification.snapshotRevision, 2);
    assert.equal(correctedRecord.interactionModeClassification.correctionOfRevision, 1);
    assert.equal(correctedRecord.interactionModeClassificationHistory.length, 2);
    assert.equal(correctedRecord.behavioralAnalysis.snapshotRevision, 2);
    assert.equal(correctedRecord.resumeContext.snapshotRevision, 2);
    assert.equal(correctedRecord.resumeContext.resumeRevisionId, "resume-revision-1");
    assert.deepEqual(correctedRecord.resumeContextHistory.map((context) => context.snapshotRevision), [1, 2]);

    const orphanTargetReview = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-orphan-target-review",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
    });
    orphanTargetReview.finalization.behavioralReview = {
      schemaVersion: 1,
      universalQuality: {
        strengths: ["Scoped the decision."],
        improvements: ["Add a measured outcome."],
      },
      targetAlignment: { strengths: [], gaps: [], competencySignals: [] },
      assistance: { level: "none", details: [] },
      evidenceGaps: ["Production impact is not independently measured."],
    };
    const orphanTargetReviewResult = await callRaw(
      client,
      "save_specialist_finalization",
      orphanTargetReview,
    );
    assert.equal(orphanTargetReviewResult.isError, true);
    assert.equal(
      orphanTargetReviewResult.structuredContent.code,
      "behavioral_target_review_scope_mismatch",
    );

    const loopId = "loop-example-senior-backend";
    const roleBriefCreated = await call(client, "create_loop", {
      operationId: "loop-final-answer-create-1",
      authorization: "loop_recorder",
      loop: {
        loopId,
        state: "active",
        company: "Example Company",
        roleTitle: "Senior Backend Engineer",
        status: "active",
        openedAt: 1_786_363_203_000,
        outcome: null,
        stages: [{
          stageId: "behavioral-round",
          label: "Behavioral round",
          order: 0,
          status: "planned",
        }],
      },
      roleBrief: {
        label: "Example Company · Senior Backend Engineer",
        state: "active",
        company: "Example Company",
        roleTitle: "Senior Backend Engineer",
        source: {
          kind: "pasted_jd",
          displayLocator: "Owner-provided job description",
          capturedAt: 1_786_363_203_000,
          jdText: "Own reliable distributed services.",
        },
        responsibilities: ["Own reliable distributed services"],
        requiredQualifications: ["Distributed systems"],
        preferredQualifications: [],
        competencySignals: ["reliability"],
        seniorityIndicators: ["owns ambiguous systems"],
        domainVocabulary: ["distributed systems"],
        verifiedCompanySignals: [],
        unresolvedAmbiguities: [],
        ownerNotes: [],
      },
    });
    assert.equal(roleBriefCreated.roleBriefRevision, 1);
    await call(client, "bind_planned_activity_to_loop", {
      operationId: "loop-final-answer-bind-other-question-1",
      activityId: "activity-loop-behavioral-other",
      loopId,
      expectedActivityRevision: 1,
      authorization: "explicit_user_instruction",
    });
    const wrongSpecialtyPreflight = await call(client, "get_behavioral_practice_preflight", {
      boundary: "finalization",
      questionId,
      activityId: "activity-loop-behavioral-other",
    });
    assert.equal(wrongSpecialtyPreflight.roleBriefResolution.source, "none");
    assert.equal(wrongSpecialtyPreflight.targeting.mode, "universal");
    const roleBriefReference = {
      loopId,
      revision: 1,
      label: "Example Company · Senior Backend Engineer",
      company: "Example Company",
      roleTitle: "Senior Backend Engineer",
      competencyEmphasis: ["reliability"],
    };
    const unboundRoleBrief = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-role-brief-unbound",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      scope: "target_tailored",
      roleBrief: roleBriefReference,
      correction: { replacesSnapshotRevision: 2, reason: "Tailor for the bound Loop Role Brief." },
    }));
    assert.equal(unboundRoleBrief.isError, true);
    assert.equal(unboundRoleBrief.structuredContent.code, "behavioral_role_brief_binding_mismatch");
    const activityBinding = await call(client, "bind_planned_activity_to_loop", {
      operationId: "loop-final-answer-bind-1",
      activityId,
      loopId,
      stageId: "behavioral-round",
      expectedActivityRevision: 1,
      authorization: "explicit_user_instruction",
    });
    assert.equal(activityBinding.bindingRevision, 1);
    assert.equal(activityBinding.roleBriefRevision, 1);
    const roleBriefPreflight = await call(client, "get_behavioral_practice_preflight", {
      boundary: "finalization",
      questionId,
      activityId,
    });
    assert.equal(roleBriefPreflight.targeting.mode, "target_tailored");
    assert.equal(roleBriefPreflight.targeting.source, "loop_role_brief");
    assert.deepEqual(roleBriefPreflight.targeting.competencySignals, ["reliability"]);
    assert.equal(roleBriefPreflight.roleBriefResolution.roleBrief.loopId, loopId);
    assert.deepEqual(roleBriefPreflight.acceptedRoleBriefVariants, []);

    const roleBriefMismatch = await callRaw(client, "save_specialist_finalization", finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-role-brief-mismatch",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      scope: "target_tailored",
      roleBrief: {
        ...roleBriefReference,
        label: "Wrong Role Brief label",
      },
      correction: { replacesSnapshotRevision: 2, reason: "Tailor for the bound Loop Role Brief." },
    }));
    assert.equal(roleBriefMismatch.isError, true);
    assert.equal(roleBriefMismatch.structuredContent.code, "behavioral_role_brief_snapshot_mismatch");

    const roleBriefFinalization = finalization({
      activityId,
      questionId,
      operationId: "final-answer-operation-role-brief",
      answer: correctedAnswer,
      responseTurnId: "behavioral-response-2",
      solutionRevision: 2,
      scope: "target_tailored",
      roleBrief: roleBriefReference,
      correction: { replacesSnapshotRevision: 2, reason: "Tailor for the bound Loop Role Brief." },
    });
    roleBriefFinalization.finalization.review.didWell[0] = "  Scoped the decision.  ";
    roleBriefFinalization.finalization.review.improve[0] = "  Add a measured outcome.  ";
    const roleBriefSaved = await call(client, "save_specialist_finalization", roleBriefFinalization);
    assert.equal(roleBriefSaved.finalAnswer.status, "corrected");
    assert.equal(roleBriefSaved.finalAnswer.snapshotRevision, 3);
    const roleBriefRecord = await call(client, "get_activity_practice_record", { activityId });
    assert.equal(roleBriefRecord.finalAnswer.scope, "target_tailored");
    assert.equal(roleBriefRecord.finalAnswer.target, null);
    assert.deepEqual(roleBriefRecord.finalAnswer.roleBrief, {
      loopId,
      revision: 1,
      label: "Example Company · Senior Backend Engineer",
      company: "Example Company",
      roleTitle: "Senior Backend Engineer",
      competencyEmphasis: ["reliability"],
    });
    assert.match(roleBriefRecord.finalAnswerMarkdown, /Role Brief Example Company · Senior Backend Engineer · revision 1/);
    assert.equal(roleBriefRecord.behavioralAnalysis.roleBrief.loopId, loopId);
    const acceptedRoleBriefPreflight = await call(client, "get_behavioral_practice_preflight", {
      boundary: "reconnect_handoff",
      questionId,
      activityId,
    });
    assert.equal(acceptedRoleBriefPreflight.acceptedRoleBriefVariants.length, 1);
    assert.equal(acceptedRoleBriefPreflight.acceptedRoleBriefVariants[0].stale, false);
    assert.equal(acceptedRoleBriefPreflight.acceptedRoleBriefVariants[0].review.assistance.level, "probing");
    const roleBriefExactRetry = await call(
      client,
      "save_specialist_finalization",
      roleBriefFinalization,
    );
    assert.deepEqual(roleBriefExactRetry.finalAnswer, {
      status: "unchanged",
      snapshotRevision: 3,
    });

    const voiceSaved = await call(client, "save_specialist_finalization", finalization({
      activityId: "activity-behavioral-voice",
      questionId: "behavioral-reliability-voice",
      operationId: "final-answer-operation-voice",
      answer,
      responseTurnId: "behavioral-voice-response",
    }));
    assert.equal(voiceSaved.finalAnswer.status, "created");
    const voiceRecord = await call(client, "get_activity_practice_record", {
      activityId: "activity-behavioral-voice",
    });
    assert.equal(voiceRecord.turns[0].source, "audio_transcript");
    assert.equal(voiceRecord.finalAnswer.answer, answer);
    assert.equal(voiceRecord.practiceScenarios.scenarios[0].scenarioId, "retry-recovery-scenario");
    assert.equal(voiceRecord.interactionModeClassification.classification.primaryPracticeModeId, "unrecorded");
    assert.equal(voiceRecord.behavioralAnalysis.analysis.answerFormat, "STARL");

    const legacyRecord = await call(client, "get_activity_practice_record", {
      activityId: "activity-behavioral-legacy",
    });
    assert.equal(legacyRecord.finalAnswer.source, "legacy_model_answer");
    assert.equal(legacyRecord.finalAnswer.snapshotRevision, null);
    assert.deepEqual(legacyRecord.finalAnswerSnapshots, []);
    assert.equal(legacyRecord.resumeContext, null);
    assert.equal(legacyRecord.resumeContextMarkdown, "");
    assert.equal(legacyRecord.resumeContextHtml, "");
    assert.equal(legacyRecord.practiceScenarios, null);
    assert.equal(legacyRecord.practiceScenariosMarkdown, "");
    assert.equal(legacyRecord.practiceScenariosHtml, "");
    assert.equal(legacyRecord.behavioralAnalysis, null);
    assert.equal(legacyRecord.behavioralAnalysisMarkdown, "");
    assert.equal(legacyRecord.behavioralAnalysisHtml, "");

    otherClient = new Client({ name: "final-answer-other", version: "1.0.0" });
    await otherClient.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${otherToken}` } },
    }));
    const isolated = await call(otherClient, "get_activity_practice_record", { activityId });
    assert.equal(isolated.finalAnswer, null);
    assert.deepEqual(isolated.finalAnswerSnapshots, []);
    assert.equal(isolated.behavioralAnalysis, null);
    assert.equal(isolated.resumeContext, null);
    assert.deepEqual(isolated.resumeContextHistory, []);
  } finally {
    await client?.close().catch(() => {});
    await sameOwnerClient?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    worker?.kill("SIGTERM");
    if (worker && worker.exitCode === null) await new Promise((resolve) => worker.once("exit", resolve));
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

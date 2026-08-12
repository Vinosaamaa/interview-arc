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

const project = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const config = fileURLToPath(new URL("../wrangler.mcp.jsonc", import.meta.url));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent;
}

const callRaw = (client, name, args) => client.callTool({ name, arguments: args });

const overviewSections = [
  "orientation",
  "architecture",
  "end_to_end_flows",
  "ownership_and_evidence",
  "decisions_and_tradeoffs",
  "operations_reliability_security",
  "results_and_gaps",
  "interview_walkthrough",
  "likely_follow_ups",
].map((sectionKey) => ({ sectionKey, title: sectionKey.replaceAll("_", " "), body: `Verified ${sectionKey} notes.` }));

const overviewProfile = {
  schemaVersion: 1,
  summary: "A factual overview of the sample platform project.",
  sections: overviewSections,
  tags: ["project-deep-dive", "sample-platform"],
  references: [],
  behavioralAnswer: {
    preferred: {
      label: "Project walkthrough",
      answer: "I can explain the verified project boundaries and keep unresolved results visible.",
      evidence: [],
      evidenceGaps: ["The exact outcome metric remains unresolved."],
    },
    alternatives: [],
  },
  projectDeepDive: {
    projectId: "sample-platform",
    bindingRevision: 1,
    focus: "project_overview",
  },
};

function finalization(activityId, questionId, responseTurnId) {
  const answer = "I explained the platform boundary and kept the unresolved outcome metric explicit.";
  const gap = "The exact outcome metric remains unresolved.";
  const analysis = {
    schemaVersion: 1,
    answerFormat: "STARL",
    competencies: ["technical-depth"],
    claimAudit: [{
      claim: "The exact outcome metric is established.",
      status: "unverified",
      supportingEvidenceIds: [],
      contraryEvidenceIds: [],
      gaps: [gap],
      contradictions: [],
    }],
    reviewDimensions: {
      relevance: { status: "strength", observation: "Stayed on the project boundary." },
      structure: { status: "strength", observation: "Used a clear walkthrough." },
      specificity: { status: "mixed", observation: "The metric remains unresolved." },
      personalOwnership: { status: "strength", observation: "Separated personal work from project facts." },
      decisions: { status: "strength", observation: "Named the decision boundary." },
      result: { status: "improvement", observation: "Confirm the metric before claiming it." },
      learning: { status: "strength", observation: "Kept evidence gaps explicit." },
      delivery: { status: "not_observed" },
    },
    strengths: ["Separated personal work from project facts."],
    improvements: ["Confirm the metric before claiming it."],
    coachingNotes: ["Generated coaching — not evidence: verify the outcome before publication."],
    likelyFollowUps: ["Which system boundary did you personally own?"],
    nextDrill: "Rehearse the end-to-end flow in two minutes.",
  };
  return {
    activityId,
    specialty: "behavioral",
    questionId,
    finalization: {
      title: "Experience Map: Sample Platform",
      complete: true,
      transcriptScope: "full_activity",
      review: { didWell: analysis.strengths, improve: analysis.improvements },
      behavioralAnalysis: analysis,
      modelAnswer: answer,
      references: [],
      solutionProfileAction: "create_or_revise",
      solutionProfile: {
        ...overviewProfile,
        behavioralAnswer: {
          preferred: { ...overviewProfile.behavioralAnswer.preferred, answer },
          alternatives: [],
        },
      },
      finalAnswerOperationId: "project-final-answer-1",
      finalAnswerSnapshot: {
        schemaVersion: 1,
        answer,
        scope: "universal",
        question: { questionId, title: "Experience Map: Sample Platform", prompt: "Walk through this project." },
        solutionProfile: { questionId, revision: 1 },
        acceptedEvidenceIds: [],
        evidenceGaps: [gap],
        contradictions: [],
        provenance: { responseTurnId },
      },
      interactionModeClassificationOperationId: "project-mode-1",
      interactionModeEvidence: {
        schemaVersion: 1,
        provenance: "recorded",
        materialSpecialistTurnIds: [responseTurnId],
        assistanceEvents: [],
      },
    },
  };
}

test("Project Deep Dives bind exact questions, freeze Past links, and project to Learn", { timeout: 240_000 }, async () => {
  const token = "ia_project_deep_dive_owner_token";
  const otherToken = "ia_project_deep_dive_other_token";
  const overviewQuestion = "experience-map-sample-platform";
  const claimQuestion = "sample-platform-resume-claim";
  const otherOverviewQuestion = "sample-platform-second-overview";
  const oldActivity = "activity-sample-platform-past";
  const newActivity = "activity-sample-platform-current";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-project-deep-dive-"));
    const port = await availableMcpPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await runMcpCommand(wrangler, [
      "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", config,
    ], project);
    await runMcpCommand(wrangler, [
      "d1", "execute", "DB", "--local", "--persist-to", persistence, "--config", config,
      "--command", `INSERT INTO integration_tokens
        (token_hash,owner_id,label,created_at,last_used_at,revoked_at)
      VALUES
        ('${sha256(token)}','owner-project','Project owner',1,NULL,NULL),
        ('${sha256(otherToken)}','other-project','Other owner',1,NULL,NULL);
      INSERT INTO owner_bank_questions
        (owner_id,specialty,question_id,title,prompt,url,source,tags,problem_number,difficulty,
         acceptance_rate,topics,company_tags,company_signals,metadata_references,metadata_captured_at,
         priority,target_minutes,active,updated_at)
      VALUES
        ('owner-project','behavioral','${overviewQuestion}','Experience Map: Sample Platform','Walk through this project.',NULL,'personal','["resume-foundation","experience:sample-platform"]',NULL,NULL,NULL,'[]','[]','[]','[]',NULL,100,60,1,1),
        ('owner-project','behavioral','${claimQuestion}','Resume claim: sample platform','Explain this claim.',NULL,'personal','["resume-bullet","experience:sample-platform","claim:claim-sample-platform"]',NULL,NULL,NULL,'[]','[]','[]','[]',NULL,90,45,1,1),
        ('owner-project','behavioral','${otherOverviewQuestion}','Second overview','Duplicate overview.',NULL,'personal','["resume-foundation","experience:sample-platform"]',NULL,NULL,NULL,'[]','[]','[]','[]',NULL,80,45,1,1);
      INSERT INTO behavioral_evidence_sources
        (owner_id,source_id,current_revision,state,project_key,kind,label,safe_hint,availability,created_at,updated_at)
      VALUES ('owner-project','source-sample-platform',1,'active','sample-platform','repository','Sample platform source','Sanitized source hint','available',1,1);
      INSERT INTO behavioral_evidence_items
        (owner_id,evidence_id,project_key,origin,statement,source_revision,evidence_grade,attribution_grade,
         claim_strength,candidate_state,visibility,safe_provenance,supports,limitations,tags,owner_attestation,
         review_revision,created_at,updated_at)
      VALUES ('owner-project','evidence-sample-platform','sample-platform','production_evidence','The sample platform uses explicit operation identities.',NULL,'E3','A0','project_fact','accepted','owner_private','[]','[]','[]','[]',NULL,1,1,1);
      INSERT INTO behavioral_claims
        (owner_id,claim_id,question_id,text,scope,status,claim_strength,evidence_ids,contrary_evidence_ids,
         gaps,safer_wording,tags,visibility,revision,created_at,updated_at)
      VALUES ('owner-project','claim-sample-platform','${claimQuestion}','I implemented explicit operation identities.','personal_contribution','verified','personal_contribution_candidate','["evidence-sample-platform"]','[]','[]',NULL,'["sample-platform"]','owner_private',1,1,1);
      INSERT INTO extra_activities (owner_id,id,date,workbench_id,payload,revision,updated_at)
      VALUES
        ('owner-project','${oldActivity}','2026-08-10',NULL,'{"schemaVersion":2,"id":"${oldActivity}","questionId":"${claimQuestion}","date":"2026-08-10","source":"extra","type":"behavioral","title":"Past claim attempt","allocatedSeconds":2700,"timingSource":"website","status":"completed"}',1,2),
        ('owner-project','${newActivity}','2026-08-12',NULL,'{"schemaVersion":2,"id":"${newActivity}","questionId":"${overviewQuestion}","date":"2026-08-12","source":"extra","type":"behavioral","title":"Current overview attempt","allocatedSeconds":3600,"timingSource":"website","status":"completed"}',1,3);
      INSERT INTO timers (owner_id,subject_id,kind,accumulated_seconds,started_at,running_since,completed,completed_at,revision,updated_at)
      VALUES
        ('owner-project','${oldActivity}','activity',1800,1000,NULL,1,2000,2,2000),
        ('owner-project','${newActivity}','activity',1800,3000,NULL,1,4000,2,4000);
      INSERT INTO outcomes (owner_id,activity_id,outcome,revision,updated_at)
      VALUES ('owner-project','${oldActivity}','solved',1,1900), ('owner-project','${newActivity}','solved',1,3900);
      INSERT INTO practice_transcript_turns
        (owner_id,activity_id,turn_id,specialty,speaker,body,source,sequence,occurred_at,updated_at)
      VALUES
        ('owner-project','${oldActivity}','old-user','behavioral','user','I explained the claim.','codex',1,1500,1500),
        ('owner-project','${oldActivity}','old-response','behavioral','specialist','Keep the evidence boundary explicit.','codex',2,1600,1600),
        ('owner-project','${newActivity}','new-user','behavioral','user','I walked through the platform.','codex',1,3500,3500),
        ('owner-project','${newActivity}','new-response','behavioral','specialist','I explained the platform boundary and kept the unresolved outcome metric explicit.','codex',2,3600,3600);
      INSERT INTO activity_finalizations
        (owner_id,activity_id,specialty,status,payload,finalized_at,published_at,revision,updated_at)
      VALUES ('owner-project','${oldActivity}','behavioral','published','{"title":"Past claim attempt","complete":true,"modelAnswer":"Historical answer bytes","references":[]}',1900,1950,1,1950);
      INSERT INTO problem_solution_profiles
        (owner_id,specialty,question_id,title,current_revision,tags,payload,updated_at)
      VALUES ('owner-project','behavioral','${claimQuestion}','Past claim profile',1,'["legacy"]','{"schemaVersion":1,"summary":"Historical profile bytes","sections":[{"title":"Answer","body":"Historical profile bytes"}],"tags":["legacy"],"references":[],"behavioralAnswer":{"preferred":{"label":"Historical","answer":"Historical answer bytes","evidence":[],"evidenceGaps":[]},"alternatives":[]}}',1900);
      INSERT INTO problem_solution_revisions
        (owner_id,specialty,question_id,revision,activity_id,payload,created_at)
      SELECT owner_id,specialty,question_id,1,'${oldActivity}',payload,1900
      FROM problem_solution_profiles WHERE owner_id='owner-project' AND question_id='${claimQuestion}';
      INSERT INTO activity_solution_links (owner_id,activity_id,specialty,question_id,solution_revision,updated_at)
      VALUES ('owner-project','${oldActivity}','behavioral','${claimQuestion}',1,1900);`,
    ], project);

    const started = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = started.child;
    await waitForMcpWorker(baseUrl, worker);
    client = await connectMcpClient(baseUrl, token, "project-deep-dive-owner");

    const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
    for (const tool of [
      "query_behavioral_project_deep_dives",
      "set_behavioral_project_binding",
      "link_completed_behavioral_project_attempt",
    ]) assert.equal(toolNames.includes(tool), true);

    const migration = await call(client, "query_behavioral_project_deep_dives", { includeMigrationReview: true });
    assert.equal(migration.projects[0].projectId, "sample-platform");
    assert.equal(migration.migrationReview.find((item) => item.questionId === overviewQuestion).focus, "project_overview");
    assert.equal(migration.migrationReview.find((item) => item.questionId === claimQuestion).sourceClaimId, "claim-sample-platform");

    const bindOverview = {
      operationId: "bind-sample-overview-1",
      questionId: overviewQuestion,
      expectedRevision: 0,
      projectId: "sample-platform",
      focus: "project_overview",
      state: "active",
      reason: "Bind the canonical project overview.",
      authorization: "behavioral_specialist",
    };
    const createdOverview = await call(client, "set_behavioral_project_binding", bindOverview);
    assert.equal(createdOverview.bindingRevision, 1);
    assert.equal((await call(client, "set_behavioral_project_binding", bindOverview)).duplicate, true);
    const changedRetry = await callRaw(client, "set_behavioral_project_binding", { ...bindOverview, focus: "architecture" });
    assert.equal(changedRetry.isError, true);
    assert.equal(changedRetry.structuredContent.code, "behavioral_project_operation_conflict");
    const stale = await callRaw(client, "set_behavioral_project_binding", { ...bindOverview, operationId: "bind-sample-overview-stale" });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.code, "behavioral_project_binding_revision_conflict");
    const duplicateOverview = await callRaw(client, "set_behavioral_project_binding", {
      ...bindOverview,
      operationId: "bind-second-overview-1",
      questionId: otherOverviewQuestion,
    });
    assert.equal(duplicateOverview.isError, true);
    assert.equal(duplicateOverview.structuredContent.code, "behavioral_project_binding_scope_conflict");

    const bindClaim = {
      operationId: "bind-sample-claim-1",
      questionId: claimQuestion,
      expectedRevision: 0,
      projectId: "sample-platform",
      focus: "resume_claim",
      sourceClaimId: "claim-sample-platform",
      state: "active",
      reason: "Bind the exact resume claim.",
      authorization: "behavioral_specialist",
    };
    await call(client, "set_behavioral_project_binding", bindClaim);

    const invalidProvisional = await callRaw(client, "save_provisional_solution_profile", {
      specialty: "behavioral",
      questionId: overviewQuestion,
      title: "Invalid overview",
      profile: { ...overviewProfile, sections: [{ title: "Overview", body: "Missing stable keys." }] },
    });
    assert.equal(invalidProvisional.isError, true);
    await call(client, "save_provisional_solution_profile", {
      activityId: newActivity,
      specialty: "behavioral",
      questionId: overviewQuestion,
      title: "Experience Map: Sample Platform",
      profile: overviewProfile,
    });

    const beforePast = await call(client, "get_activity_practice_record", { activityId: oldActivity });
    assert.equal(beforePast.projectDeepDiveLink, null);
    const linkInput = {
      operationId: "link-sample-past-1",
      activityId: oldActivity,
      questionId: claimQuestion,
      bindingRevision: 1,
      authorization: "behavioral_specialist",
    };
    const linkedPast = await call(client, "link_completed_behavioral_project_attempt", linkInput);
    assert.equal(linkedPast.status, "linked");
    assert.equal(linkedPast.solutionRevision, 1);
    assert.equal((await call(client, "link_completed_behavioral_project_attempt", linkInput)).duplicate, true);
    const changedPastRetry = await callRaw(client, "link_completed_behavioral_project_attempt", {
      ...linkInput,
      bindingRevision: 2,
    });
    assert.equal(changedPastRetry.isError, true);
    assert.equal(changedPastRetry.structuredContent.code, "behavioral_project_operation_conflict");
    const afterPast = await call(client, "get_activity_practice_record", { activityId: oldActivity });
    assert.deepEqual(afterPast.turns, beforePast.turns);
    assert.deepEqual(afterPast.finalization, beforePast.finalization);
    assert.deepEqual(afterPast.finalAnswerSnapshots, beforePast.finalAnswerSnapshots);
    assert.equal(afterPast.projectDeepDiveLink.projectId, "sample-platform");
    assert.equal(afterPast.projectDeepDiveLink.source, "completed_attempt_backfill");

    await call(client, "save_specialist_finalization", finalization(newActivity, overviewQuestion, "new-response"));
    const currentRecord = await call(client, "get_activity_practice_record", { activityId: newActivity });
    assert.equal(currentRecord.projectDeepDiveLink.projectId, "sample-platform");
    assert.equal(currentRecord.projectDeepDiveLink.source, "finalization");
    assert.equal(currentRecord.projectDeepDiveLink.solutionRevision, 1);
    const profile = await call(client, "get_problem_solution_profile", { specialty: "behavioral", questionId: overviewQuestion });
    assert.equal(profile.reusable, true);
    assert.equal(profile.projectDeepDiveBinding.currentRevision, 1);

    const projection = await call(client, "query_behavioral_project_deep_dives", { projectId: "sample-platform" });
    assert.equal(projection.activityLinks.length, 2);
    assert.equal(projection.learnProjection.find((item) => item.questionId === overviewQuestion).solutionProfileRevision, 1);

    otherClient = await connectMcpClient(baseUrl, otherToken, "project-deep-dive-other");
    const isolated = await call(otherClient, "query_behavioral_project_deep_dives", { includeMigrationReview: true });
    assert.deepEqual(isolated.projects, []);
    assert.deepEqual(isolated.bindings, []);
    assert.deepEqual(isolated.activityLinks, []);
  } finally {
    await client?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    worker?.kill("SIGTERM");
    if (worker && worker.exitCode === null) await new Promise((resolve) => worker.once("exit", resolve));
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

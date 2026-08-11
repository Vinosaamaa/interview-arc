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

const blueprint = (goal = "Trace Interview Arc from interface to durable state.") => ({
  courseId: "course-interview-arc-architecture",
  state: "draft",
  title: "Interview Arc Architecture for Java and JavaScript Engineers",
  goal,
  priorKnowledge: ["Java services", "JavaScript applications"],
  intendedOutcome: "Explain one request path, its state ownership, and its retry boundary from source evidence.",
  sourcePins: [{
    kind: "repository",
    title: "Interview Arc repository",
    repository: "Vinosaamaa/interview-arc",
    commit: "9dbe912d8ca68f184b3a0fc33dca7fce0bf1d7c9",
    path: "app",
    symbols: ["HomeClient"],
  }],
  modules: [
    {
      moduleId: "request-paths",
      title: "Request paths and durable ownership",
      order: 0,
      objective: "Relate UI actions to Worker and D1 boundaries.",
      lessons: [
        {
          lessonId: "trace-one-request",
          title: "Trace one request",
          order: 0,
          kind: "lesson",
          objective: "Trace one mutation from React to owner-scoped D1 state.",
          prerequisites: [],
        },
        {
          lessonId: "retry-boundaries-lab",
          title: "Retry boundaries lab",
          order: 1,
          kind: "lab",
          objective: "Explain exact retry and changed retry behavior.",
          prerequisites: ["trace-one-request"],
        },
      ],
    },
  ],
});

const lesson = (body = "Follow the request from the client route into the owner-scoped mutation.") => ({
  lessonId: "trace-one-request",
  state: "active",
  title: "Trace one request",
  objective: "Trace one mutation from React to owner-scoped D1 state.",
  prerequisites: ["Understand HTTP request routing"],
  sections: [{ sectionId: "request-flow", heading: "Request flow", body }],
  examples: [{
    exampleId: "java-bridge",
    title: "Java mental-model bridge",
    body: "Treat the Worker route as a controller and the D1 operation as an atomic repository command.",
    language: "text",
  }],
  exercises: [{ exerciseId: "trace-exercise", prompt: "Draw the authoritative write and retry boundary." }],
  homework: [{ homeworkId: "read-route", prompt: "Read the named route and identify owner derivation." }],
  checkpoints: [{
    checkpointId: "explain-retry-boundary",
    label: "Explain the retry boundary",
    description: "Identify the stable operation identity and changed-retry conflict.",
    required: true,
  }],
  sourcePins: [{
    kind: "repository",
    title: "Interview Arc repository",
    repository: "Vinosaamaa/interview-arc",
    commit: "9dbe912d8ca68f184b3a0fc33dca7fce0bf1d7c9",
    path: "mcp-worker/index.ts",
    symbols: ["createServer"],
  }],
});

test("Learn core preserves immutable owner-private Course, Enrollment, Lesson, and Quick Study revisions", { timeout: 180_000 }, async () => {
  const token = "ia_learning_owner_integration_token_2026";
  const otherToken = "ia_learning_other_integration_token_2026";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-learn-core-"));
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
          ('${sha256(token)}','owner-learning','Learning owner',1,NULL,NULL),
          ('${sha256(otherToken)}','other-learning','Other Learning owner',1,NULL,NULL);`,
    ], project);
    const started = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = started.child;
    await waitForMcpWorker(baseUrl, worker);
    client = await connectMcpClient(baseUrl, token, "learning-owner");
    otherClient = await connectMcpClient(baseUrl, otherToken, "learning-other");

    await call(client, "register_specialist_task", {
      specialty: "learning_specialist",
      threadId: "task-learning-specialist",
      hostId: "host-local-test",
      title: "Interview Arc — Learning Specialist",
    });
    const tasks = await call(client, "get_specialist_tasks", {});
    assert.deepEqual(tasks.tasks.map((task) => task.specialty), ["learning_specialist"]);
    assert.deepEqual((await call(otherClient, "get_specialist_tasks", {})).tasks, []);

    const createInput = {
      operationId: "learn-course-create-1",
      authorization: "learning_specialist",
      blueprint: blueprint(),
    };
    const created = await call(client, "create_learning_course_blueprint", createInput);
    assert.deepEqual(created, {
      status: "draft_created",
      courseId: "course-interview-arc-architecture",
      blueprintRevision: 1,
      duplicate: false,
    });
    assert.equal((await call(client, "create_learning_course_blueprint", createInput)).duplicate, true);
    const changedCreate = await callRaw(client, "create_learning_course_blueprint", {
      ...createInput,
      blueprint: blueprint("Changed retry must fail."),
    });
    assert.equal(changedCreate.isError, true);
    assert.equal(changedCreate.structuredContent.code, "learning_operation_conflict");

    const ownerRead = await call(client, "query_learning_workspace", {
      courseId: "course-interview-arc-architecture",
    });
    assert.equal(ownerRead.courses.length, 1);
    assert.equal(ownerRead.courses[0].blueprint.revision, 1);
    assert.equal(ownerRead.courses[0].enrollment, null);
    assert.deepEqual(ownerRead.facts, {
      courseCount: 1,
      draftCourseCount: 1,
      activeCourseCount: 0,
      completedCourseCount: 0,
      activeEnrollmentCount: 0,
      lessonCount: 0,
      completedLessonCount: 0,
      quickStudyCount: 0,
      sessionCount: 0,
      completedSessionCount: 0,
      recordedLearningSeconds: 0,
      homeworkCount: 0,
      completedHomeworkCount: 0,
      checkpointResultCount: 0,
      demonstratedCheckpointCount: 0,
      needsAnotherPassCheckpointCount: 0,
    });
    const isolatedRead = await call(otherClient, "query_learning_workspace", {});
    assert.deepEqual(isolatedRead.courses, []);
    assert.deepEqual(isolatedRead.quickStudies, []);
    assert.equal(isolatedRead.facts.courseCount, 0);

    const revisedBlueprint = blueprint("Trace two authoritative request paths and compare their retry boundaries.");
    const revised = await call(client, "revise_learning_course_blueprint", {
      operationId: "learn-course-revise-2",
      courseId: revisedBlueprint.courseId,
      expectedRevision: 1,
      authorization: "learning_specialist",
      blueprint: revisedBlueprint,
    });
    assert.equal(revised.blueprintRevision, 2);
    const historical = await call(client, "query_learning_workspace", {
      courseId: revisedBlueprint.courseId,
      blueprintRevision: 1,
    });
    assert.equal(historical.courses[0].blueprint.goal, blueprint().goal);
    const current = await call(client, "query_learning_workspace", { courseId: revisedBlueprint.courseId });
    assert.equal(current.courses[0].blueprint.goal, revisedBlueprint.goal);
    const staleRevision = await callRaw(client, "revise_learning_course_blueprint", {
      operationId: "learn-course-revise-stale",
      courseId: revisedBlueprint.courseId,
      expectedRevision: 1,
      authorization: "learning_specialist",
      blueprint: revisedBlueprint,
    });
    assert.equal(staleRevision.isError, true);
    assert.equal(staleRevision.structuredContent.code, "learning_blueprint_revision_conflict");

    const enrollmentInput = {
      operationId: "learn-enroll-1",
      enrollmentId: "enrollment-interview-arc-architecture",
      courseId: revisedBlueprint.courseId,
      expectedBlueprintRevision: 2,
      authorization: "explicit_user_instruction",
    };
    const enrollment = await call(client, "approve_learning_course_enrollment", enrollmentInput);
    assert.equal(enrollment.blueprintRevision, 2);
    assert.equal(enrollment.currentModuleId, "request-paths");
    assert.equal(enrollment.currentLessonId, "trace-one-request");
    assert.equal((await call(client, "approve_learning_course_enrollment", enrollmentInput)).duplicate, true);
    await call(client, "revise_learning_course_blueprint", {
      operationId: "learn-course-revise-3",
      courseId: revisedBlueprint.courseId,
      expectedRevision: 2,
      authorization: "learning_specialist",
      blueprint: blueprint("A later draft must not retarget the existing Enrollment."),
    });
    const pinnedEnrollmentRead = await call(client, "query_learning_workspace", {
      courseId: revisedBlueprint.courseId,
    });
    assert.equal(pinnedEnrollmentRead.courses[0].blueprint.revision, 2);
    assert.equal(pinnedEnrollmentRead.courses[0].enrollment.blueprintRevision, 2);
    const changedEnrollment = await callRaw(client, "approve_learning_course_enrollment", {
      ...enrollmentInput,
      expectedBlueprintRevision: 1,
    });
    assert.equal(changedEnrollment.isError, true);
    assert.equal(changedEnrollment.structuredContent.code, "learning_operation_conflict");
    const otherEnrollment = await callRaw(otherClient, "approve_learning_course_enrollment", {
      ...enrollmentInput,
      operationId: "other-learn-enroll-1",
    });
    assert.equal(otherEnrollment.isError, true);
    assert.equal(otherEnrollment.structuredContent.code, "learning_course_not_found");

    const lessonScope = {
      kind: "course",
      courseId: revisedBlueprint.courseId,
      enrollmentId: enrollmentInput.enrollmentId,
      moduleId: "request-paths",
      blueprintRevision: 2,
    };
    const lessonInput = {
      operationId: "learn-lesson-create-1",
      expectedRevision: 0,
      authorization: "learning_specialist",
      scope: lessonScope,
      lesson: lesson(),
    };
    const lessonCreated = await call(client, "save_learning_lesson_revision", lessonInput);
    assert.equal(lessonCreated.lessonRevision, 1);
    assert.equal(lessonCreated.blueprintRevision, 2);
    assert.equal((await call(client, "save_learning_lesson_revision", lessonInput)).duplicate, true);
    const wrongBlueprint = await callRaw(client, "save_learning_lesson_revision", {
      operationId: "learn-lesson-wrong-blueprint",
      expectedRevision: 1,
      authorization: "learning_specialist",
      scope: { ...lessonScope, blueprintRevision: 1 },
      lesson: lesson("A changed body."),
    });
    assert.equal(wrongBlueprint.isError, true);
    assert.equal(wrongBlueprint.structuredContent.code, "learning_enrollment_blueprint_mismatch");

    const lessonRevised = await call(client, "save_learning_lesson_revision", {
      operationId: "learn-lesson-revise-2",
      expectedRevision: 1,
      authorization: "learning_specialist",
      scope: lessonScope,
      lesson: lesson("Trace owner derivation before the transaction and operation receipt after it."),
    });
    assert.equal(lessonRevised.lessonRevision, 2);
    const oldLesson = await call(client, "query_learning_workspace", {
      courseId: revisedBlueprint.courseId,
      lessonId: "trace-one-request",
      lessonRevision: 1,
    });
    assert.equal(oldLesson.courses[0].lessons[0].current.sections[0].body, lesson().sections[0].body);
    const newLesson = await call(client, "query_learning_workspace", {
      courseId: revisedBlueprint.courseId,
      lessonId: "trace-one-request",
    });
    assert.equal(newLesson.courses[0].lessons[0].current.revision, 2);

    const quickLesson = { ...lesson("Compare Java records and TypeScript object schemas."), lessonId: "quick-study-record-shapes", title: "Record shapes" };
    const quick = await call(client, "save_learning_lesson_revision", {
      operationId: "learn-quick-study-create-1",
      expectedRevision: 0,
      authorization: "learning_specialist",
      scope: { kind: "quick_study" },
      lesson: quickLesson,
    });
    assert.equal(quick.scope.kind, "quick_study");
    assert.equal(quick.blueprintRevision, null);
    await call(client, "create_learning_session", {
      operationId: "learn-quick-session-create-1",
      sessionId: "quick-study-record-shapes-session-1",
      authorization: "learning_specialist",
      scope: { kind: "quick_study" },
      lessonId: quickLesson.lessonId,
      lessonRevision: 1,
    });
    await call(client, "control_learning_session", {
      operationId: "learn-quick-session-start-1",
      sessionId: "quick-study-record-shapes-session-1",
      expectedRevision: 0,
      action: "start",
      authorization: "explicit_user_instruction",
    });
    await call(client, "append_learning_transcript", {
      operationId: "learn-quick-transcript-1",
      sessionId: "quick-study-record-shapes-session-1",
      expectedTranscriptRevision: 0,
      writer: "learning_specialist",
      turns: [{
        turnId: "quick-study-turn-0",
        sequence: 0,
        speaker: "learner",
        source: "typed",
        body: "A Java record is nominal while a TypeScript object type is structurally compatible.",
        occurredAt: 1_786_400_010_000,
      }],
    });
    const quickFinished = await call(client, "finish_learning_session", {
      operationId: "learn-quick-session-finish-1",
      sessionId: "quick-study-record-shapes-session-1",
      expectedRevision: 1,
      expectedTranscriptRevision: 1,
      authorization: "explicit_user_instruction",
      finalization: {
        recap: "The standalone study compared nominal and structural type models.",
        unresolvedQuestions: [],
        recommendedNextAction: "Apply the comparison to one API boundary.",
        checkpointResults: [{
          checkpointId: "explain-retry-boundary",
          status: "demonstrated",
          rationale: "The exact learner turn states the core distinction.",
          evidence: [{ kind: "transcript_turn", turnId: "quick-study-turn-0" }],
        }],
      },
    });
    assert.equal(quickFinished.lessonCompletion.completed, true);
    assert.equal(quickFinished.lessonCompletion.courseCompleted, false);
    const finalRead = await call(client, "query_learning_workspace", {});
    assert.equal(finalRead.courses[0].enrollment.blueprintRevision, 2);
    assert.equal(finalRead.courses[0].lessons[0].current.revision, 2);
    assert.equal(finalRead.quickStudies.length, 1);
    assert.equal(finalRead.quickStudies[0].lesson.courseId, null);
    assert.equal(finalRead.quickStudies[0].lesson.state, "completed");
    assert.equal(finalRead.quickStudies[0].current.revision, 2);
    assert.deepEqual(finalRead.facts, {
      courseCount: 1,
      draftCourseCount: 0,
      activeCourseCount: 1,
      completedCourseCount: 0,
      activeEnrollmentCount: 1,
      lessonCount: 1,
      completedLessonCount: 0,
      quickStudyCount: 1,
      sessionCount: 1,
      completedSessionCount: 1,
      recordedLearningSeconds: 0,
      homeworkCount: 2,
      completedHomeworkCount: 0,
      checkpointResultCount: 1,
      demonstratedCheckpointCount: 1,
      needsAnotherPassCheckpointCount: 0,
    });
    assert.doesNotMatch(JSON.stringify(finalRead), /mastery|readiness|productivity|retentionScore/);
    assert.deepEqual((await call(otherClient, "query_learning_workspace", {})).quickStudies, []);
  } finally {
    await client?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    worker?.kill("SIGTERM");
    if (worker && worker.exitCode === null) await new Promise((resolve) => worker.once("exit", resolve));
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

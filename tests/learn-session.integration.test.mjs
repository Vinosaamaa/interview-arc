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

async function voiceRequest(baseUrl, token, path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

const courseBlueprint = {
  courseId: "course-session-reliability",
  state: "draft",
  title: "Learning Session Reliability",
  goal: "Understand the separate Learning Session state machine.",
  priorKnowledge: ["HTTP APIs"],
  intendedOutcome: "Explain timer and transcript retry boundaries from evidence.",
  sourcePins: [{
    kind: "repository",
    title: "Interview Arc repository",
    repository: "Vinosaamaa/interview-arc",
    commit: "9dbe912d8ca68f184b3a0fc33dca7fce0bf1d7c9",
    path: "db",
    symbols: ["getDb"],
  }],
  modules: [{
    moduleId: "session-core",
    title: "Session core",
    order: 0,
    objective: "Trace durable Learning Session state.",
    lessons: [{
      lessonId: "session-state-machine",
      title: "Session state machine",
      order: 0,
      kind: "lesson",
      objective: "Explain start, pause, resume, Finish, and transcript identity.",
      prerequisites: [],
    }, {
      lessonId: "session-completion-boundary",
      title: "Session and Course completion",
      order: 1,
      kind: "lesson",
      objective: "Explain why one finished Session does not prematurely complete a multi-Lesson Course.",
      prerequisites: ["session-state-machine"],
    }],
  }],
};

const lesson = {
  lessonId: "session-state-machine",
  state: "active",
  title: "Session state machine",
  objective: "Explain start, pause, resume, Finish, and transcript identity.",
  prerequisites: [],
  sections: [{
    sectionId: "state-transitions",
    heading: "State transitions",
    body: "The Learning Session is separate from Interview Activity state.",
  }],
  examples: [],
  exercises: [{ exerciseId: "trace-timer", prompt: "Trace one exact timer retry." }],
  homework: [{
    homeworkId: "trace-session-boundary",
    prompt: "Write one trace showing why Learning Session finalization is separate from Interview outcomes.",
  }],
  checkpoints: [{
    checkpointId: "explain-session-state",
    label: "Explain Session state",
    description: "Name the authoritative revisions and permanent Finish lock.",
    required: true,
  }],
  sourcePins: [],
};

const completionLesson = {
  lessonId: "session-completion-boundary",
  state: "active",
  title: "Session and Course completion",
  objective: "Explain checkpoint-gated Lesson and Course completion.",
  prerequisites: ["session-state-machine"],
  sections: [{
    sectionId: "completion-transitions",
    heading: "Completion transitions",
    body: "A Session may finish while a Lesson remains active; all pinned Blueprint lessons must complete before the Course does.",
  }],
  examples: [],
  exercises: [],
  homework: [],
  checkpoints: [{
    checkpointId: "explain-course-completion",
    label: "Explain Course completion",
    description: "Distinguish Session, Lesson, Enrollment, and Course completion.",
    required: true,
  }],
  sourcePins: [],
};

test("Learning Sessions keep exact timers and transcripts while rejecting all learning-audio persistence", { timeout: 180_000 }, async () => {
  const token = "ia_learning_session_owner_token_2026";
  const otherToken = "ia_learning_session_other_token_2026";
  let releaseLock;
  let persistence;
  let worker;
  let client;
  let otherClient;
  try {
    releaseLock = await acquireMcpIntegrationLock();
    persistence = await mkdtemp(join(tmpdir(), "interview-arc-learn-session-"));
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
          ('${sha256(token)}','owner-learning-session','Learning Session owner',1,NULL,NULL),
          ('${sha256(otherToken)}','other-learning-session','Other owner',1,NULL,NULL);`,
    ], project);
    const started = startMcpWorker({ wrangler, config, persistence, project, port });
    worker = started.child;
    await waitForMcpWorker(baseUrl, worker);
    client = await connectMcpClient(baseUrl, token, "learning-session-owner");
    otherClient = await connectMcpClient(baseUrl, otherToken, "learning-session-other");

    await call(client, "register_specialist_task", {
      specialty: "learning_specialist",
      threadId: "task-learning-session-specialist",
      hostId: "host-local-test",
      title: "Interview Arc — Learning Specialist",
    });

    await call(client, "create_learning_course_blueprint", {
      operationId: "session-course-create-1",
      authorization: "learning_specialist",
      blueprint: courseBlueprint,
    });
    await call(client, "approve_learning_course_enrollment", {
      operationId: "session-enroll-1",
      enrollmentId: "enrollment-session-reliability",
      courseId: courseBlueprint.courseId,
      expectedBlueprintRevision: 1,
      authorization: "explicit_user_instruction",
    });
    const scope = {
      kind: "course",
      courseId: courseBlueprint.courseId,
      enrollmentId: "enrollment-session-reliability",
      moduleId: "session-core",
      blueprintRevision: 1,
    };
    await call(client, "save_learning_lesson_revision", {
      operationId: "session-lesson-create-1",
      expectedRevision: 0,
      authorization: "learning_specialist",
      scope,
      lesson,
    });

    const createSessionInput = {
      operationId: "learning-session-create-1",
      sessionId: "learning-session-reliability-1",
      authorization: "learning_specialist",
      scope,
      lessonId: lesson.lessonId,
      lessonRevision: 1,
    };
    const created = await call(client, "create_learning_session", createSessionInput);
    assert.equal(created.revision, 0);
    assert.equal(created.transcriptRevision, 0);
    assert.equal((await call(client, "create_learning_session", createSessionInput)).duplicate, true);
    assert.deepEqual((await call(otherClient, "query_learning_sessions", {})).sessions, []);

    const startInput = {
      operationId: "learning-session-start-1",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 0,
      action: "start",
      authorization: "explicit_user_instruction",
    };
    const startedSession = await call(client, "control_learning_session", startInput);
    assert.equal(startedSession.state, "running");
    assert.equal(startedSession.revision, 1);
    assert.equal((await call(client, "control_learning_session", startInput)).duplicate, true);
    const changedStart = await callRaw(client, "control_learning_session", { ...startInput, action: "pause" });
    assert.equal(changedStart.isError, true);
    assert.equal(changedStart.structuredContent.code, "learning_operation_conflict");

    const learningContextResponse = await voiceRequest(baseUrl, token, "/voice/context");
    assert.equal(learningContextResponse.status, 200);
    const learningContext = await learningContextResponse.json();
    assert.equal(learningContext.captureTarget, "learning");
    assert.equal(learningContext.focusedActivity, null);
    assert.equal(learningContext.focusedLearningSession.sessionId, createSessionInput.sessionId);
    assert.equal(learningContext.focusedLearningSession.courseId, courseBlueprint.courseId);
    assert.equal(learningContext.focusedLearningSession.blueprintRevision, 1);
    assert.equal(learningContext.focusedLearningSession.courseTitle, courseBlueprint.title);
    assert.equal(learningContext.focusedLearningSession.moduleId, "session-core");
    assert.equal(learningContext.focusedLearningSession.moduleTitle, "Session core");
    assert.equal(learningContext.focusedLearningSession.lessonId, lesson.lessonId);
    assert.equal(learningContext.focusedLearningSession.lessonRevision, 1);
    assert.equal(learningContext.focusedLearningSession.lessonTitle, lesson.title);
    assert.equal(learningContext.focusedLearningSession.transcriptRevision, 0);
    assert.equal(learningContext.focusedLearningSession.nextTranscriptSequence, 0);
    assert.equal(learningContext.focusedLearningSession.evidencePolicy, "transcript_only");
    assert.equal(learningContext.learningTimer.sessionId, createSessionInput.sessionId);
    assert.equal(learningContext.learningTimer.lessonId, lesson.lessonId);
    assert.equal(learningContext.learningTimer.lessonTitle, lesson.title);
    assert.equal(learningContext.learningTimer.courseTitle, courseBlueprint.title);
    assert.equal(learningContext.learningTimer.moduleTitle, "Session core");
    assert.equal(learningContext.learningTimer.state, "running");
    assert.equal(learningContext.learningTimer.accumulatedSeconds, 0);
    assert.equal(learningContext.learningTimer.revision, 1);
    assert.equal(typeof learningContext.learningTimer.runningSince, "number");
    assert.ok(learningContext.learningTimer.serverNow >= learningContext.learningTimer.runningSince);
    assert.equal(learningContext.specialist.specialty, "learning_specialist");

    const otherLearningContext = await voiceRequest(baseUrl, otherToken, "/voice/context");
    assert.equal(otherLearningContext.status, 200);
    const otherLearningContextBody = await otherLearningContext.json();
    assert.equal(otherLearningContextBody.focusedLearningSession, null);
    assert.equal(otherLearningContextBody.learningTimer, null);

    const pauseVoiceTimerInput = {
      protocolVersion: 2,
      operationId: "learning-voice-timer-pause-1",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 1,
      action: "pause",
    };
    const pausedVoiceTimerResponse = await voiceRequest(baseUrl, token, "/voice/learning-timers", {
      method: "POST",
      body: JSON.stringify(pauseVoiceTimerInput),
    });
    assert.equal(pausedVoiceTimerResponse.status, 200);
    const pausedVoiceTimer = await pausedVoiceTimerResponse.json();
    assert.equal(pausedVoiceTimer.duplicate, false);
    assert.equal(pausedVoiceTimer.learningTimer.state, "paused");
    assert.equal(pausedVoiceTimer.learningTimer.revision, 2);
    assert.equal(pausedVoiceTimer.learningTimer.runningSince, null);

    const exactPauseVoiceTimerRetry = await voiceRequest(baseUrl, token, "/voice/learning-timers", {
      method: "POST",
      body: JSON.stringify(pauseVoiceTimerInput),
    });
    assert.equal(exactPauseVoiceTimerRetry.status, 200);
    assert.equal((await exactPauseVoiceTimerRetry.json()).duplicate, true);

    const changedPauseVoiceTimerRetry = await voiceRequest(baseUrl, token, "/voice/learning-timers", {
      method: "POST",
      body: JSON.stringify({ ...pauseVoiceTimerInput, action: "resume", expectedRevision: 2 }),
    });
    assert.equal(changedPauseVoiceTimerRetry.status, 409);
    assert.equal((await changedPauseVoiceTimerRetry.json()).code, "learning_operation_conflict");

    const staleResumeVoiceTimer = await voiceRequest(baseUrl, token, "/voice/learning-timers", {
      method: "POST",
      body: JSON.stringify({
        ...pauseVoiceTimerInput,
        operationId: "learning-voice-timer-resume-stale-1",
        action: "resume",
      }),
    });
    assert.equal(staleResumeVoiceTimer.status, 409);
    assert.equal((await staleResumeVoiceTimer.json()).code, "learning_session_revision_conflict");

    const otherOwnerPauseVoiceTimer = await voiceRequest(baseUrl, otherToken, "/voice/learning-timers", {
      method: "POST",
      body: JSON.stringify({
        ...pauseVoiceTimerInput,
        operationId: "learning-voice-timer-other-owner-1",
      }),
    });
    assert.equal(otherOwnerPauseVoiceTimer.status, 409);
    assert.equal((await otherOwnerPauseVoiceTimer.json()).code, "learning_voice_timer_not_found");

    const pausedContextResponse = await voiceRequest(baseUrl, token, "/voice/context");
    assert.equal(pausedContextResponse.status, 200);
    const pausedContext = await pausedContextResponse.json();
    assert.equal(pausedContext.captureTarget, null);
    assert.equal(pausedContext.focusedLearningSession, null);
    assert.equal(pausedContext.learningTimer.state, "paused");
    assert.equal(pausedContext.learningTimer.revision, 2);

    const pausedVoiceTranscript = await voiceRequest(baseUrl, token, "/voice/learning-transcripts", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: 2,
        operationId: "learning-voice-paused-rejected-1",
        sessionId: createSessionInput.sessionId,
        expectedTranscriptRevision: 0,
        turnId: "learning-voice-paused-turn-0",
        sequence: 0,
        transcript: "A paused Learning Session must not accept Arc Voice text.",
        checksum: sha256("A paused Learning Session must not accept Arc Voice text."),
        occurredAt: 1_786_399_999_000,
      }),
    });
    assert.equal(pausedVoiceTranscript.status, 409);
    assert.equal((await pausedVoiceTranscript.json()).code, "learning_voice_session_not_running");

    const resumeVoiceTimerInput = {
      protocolVersion: 2,
      operationId: "learning-voice-timer-resume-1",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 2,
      action: "resume",
    };
    const resumedVoiceTimerResponse = await voiceRequest(baseUrl, token, "/voice/learning-timers", {
      method: "POST",
      body: JSON.stringify(resumeVoiceTimerInput),
    });
    assert.equal(resumedVoiceTimerResponse.status, 200);
    const resumedVoiceTimer = await resumedVoiceTimerResponse.json();
    assert.equal(resumedVoiceTimer.learningTimer.state, "running");
    assert.equal(resumedVoiceTimer.learningTimer.revision, 3);
    assert.equal(typeof resumedVoiceTimer.learningTimer.runningSince, "number");

    const typedTurns = {
      operationId: "learning-transcript-typed-1",
      sessionId: createSessionInput.sessionId,
      expectedTranscriptRevision: 0,
      writer: "learning_specialist",
      turns: [
        {
          turnId: "learner-turn-0",
          sequence: 0,
          speaker: "learner",
          source: "typed",
          body: "The Learning timer should not reuse an Interview Activity outcome.",
          occurredAt: 1_786_400_000_000,
        },
        {
          turnId: "specialist-turn-1",
          sequence: 1,
          speaker: "specialist",
          source: "typed",
          body: "Correct. It has a separate revision and permanent Finish lock.",
          occurredAt: 1_786_400_001_000,
        },
      ],
    };
    const typedReceipt = await call(client, "append_learning_transcript", typedTurns);
    assert.equal(typedReceipt.transcriptRevision, 1);
    assert.equal(typedReceipt.evidencePolicy, "transcript_only");
    assert.equal((await call(client, "append_learning_transcript", typedTurns)).duplicate, true);

    const voiceReceipt = await call(client, "append_learning_transcript", {
      operationId: "learning-transcript-voice-2",
      sessionId: createSessionInput.sessionId,
      expectedTranscriptRevision: 1,
      writer: "arc_voice",
      turns: [{
        turnId: "learner-voice-turn-2",
        sequence: 2,
        speaker: "learner",
        source: "voice_transcript",
        body: "Voice preserves this text turn but no cloud audio.",
        occurredAt: 1_786_400_002_000,
      }],
    });
    assert.equal(voiceReceipt.transcriptRevision, 2);
    const invalidVoiceEvidence = await callRaw(client, "append_learning_transcript", {
      operationId: "learning-transcript-invalid-audio",
      sessionId: createSessionInput.sessionId,
      expectedTranscriptRevision: 2,
      writer: "arc_voice",
      turns: [{
        turnId: "learner-voice-turn-3",
        sequence: 3,
        speaker: "learner",
        source: "voice_transcript",
        body: "This invalid payload attempts to smuggle audio metadata.",
        occurredAt: 1_786_400_003_000,
        audioClipId: "forbidden-learning-audio",
      }],
    });
    assert.equal(invalidVoiceEvidence.isError, true);

    const audioAttempt = await callRaw(client, "register_activity_audio_clip", {
      activityId: createSessionInput.sessionId,
      clipId: "learning-audio-forbidden",
      filename: "learning-answer.m4a",
      mimeType: "audio/mp4",
      status: "available",
      objectKey: "private/learning-audio-forbidden",
    });
    assert.equal(audioAttempt.isError, true);
    assert.equal(audioAttempt.structuredContent.code, "learning_audio_forbidden");
    const deliveryAttempt = await callRaw(client, "save_delivery_analysis", {
      analysisId: "learning-delivery-forbidden",
      activityId: createSessionInput.sessionId,
      audioClipId: "learning-audio-forbidden",
      transcriptTurnId: "learner-voice-turn-2",
      specialty: "behavioral",
      status: "queued",
    });
    assert.equal(deliveryAttempt.isError, true);
    assert.equal(deliveryAttempt.structuredContent.code, "learning_audio_forbidden");

    const audioForm = new FormData();
    audioForm.set("activityId", createSessionInput.sessionId);
    audioForm.set("clipId", "learning-http-audio-forbidden");
    audioForm.set("file", new Blob(["not durable audio"], { type: "audio/wav" }), "learning.wav");
    const audioHttpAttempt = await fetch(`${baseUrl}/audio/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: audioForm,
    });
    assert.equal(audioHttpAttempt.status, 409);
    assert.equal((await audioHttpAttempt.json()).code, "learning_audio_forbidden");

    const deliveryHttpAttempt = await voiceRequest(baseUrl, token, "/voice/delivery", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: 2,
        id: "learning-http-delivery-forbidden",
        activityId: createSessionInput.sessionId,
        audioClipId: "learning-http-audio-forbidden",
        transcriptTurnId: "learner-voice-turn-2",
        specialty: "behavioral",
        status: "queued",
      }),
    });
    assert.equal(deliveryHttpAttempt.status, 409);
    assert.equal((await deliveryHttpAttempt.json()).code, "learning_audio_forbidden");

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const paused = await call(client, "control_learning_session", {
      operationId: "learning-session-pause-2",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 3,
      action: "pause",
      authorization: "explicit_user_instruction",
    });
    assert.equal(paused.state, "paused");
    assert.ok(paused.accumulatedSeconds >= 1);
    await client.close();
    client = await connectMcpClient(baseUrl, token, "learning-session-owner-reconnected");
    const reconnected = await call(client, "query_learning_sessions", { sessionId: createSessionInput.sessionId });
    assert.equal(reconnected.sessions[0].session.state, "paused");
    assert.equal(reconnected.sessions[0].session.revision, 4);
    assert.equal(reconnected.sessions[0].session.transcriptRevision, 2);
    const staleResume = await callRaw(client, "control_learning_session", {
      operationId: "learning-session-stale-resume",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 1,
      action: "resume",
      authorization: "explicit_user_instruction",
    });
    assert.equal(staleResume.isError, true);
    assert.equal(staleResume.structuredContent.code, "learning_session_revision_conflict");
    const resumed = await call(client, "control_learning_session", {
      operationId: "learning-session-resume-3",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 4,
      action: "resume",
      authorization: "explicit_user_instruction",
    });
    assert.equal(resumed.state, "running");

    const artifact = await call(client, "attach_learning_artifact", {
      operationId: "learning-artifact-attach-1",
      artifactId: "session-boundary-trace",
      lessonId: lesson.lessonId,
      sessionId: createSessionInput.sessionId,
      homeworkId: "trace-session-boundary",
      kind: "trace",
      label: "Learning Session boundary trace",
      mediaType: "text/markdown",
      content: "public-safe learning session boundary trace",
      authorization: "learning_specialist",
    });
    assert.equal(artifact.artifactId, "session-boundary-trace");
    assert.equal((await call(client, "attach_learning_artifact", {
      operationId: "learning-artifact-attach-1",
      artifactId: "session-boundary-trace",
      lessonId: lesson.lessonId,
      sessionId: createSessionInput.sessionId,
      homeworkId: "trace-session-boundary",
      kind: "trace",
      label: "Learning Session boundary trace",
      mediaType: "text/markdown",
      content: "public-safe learning session boundary trace",
      authorization: "learning_specialist",
    })).duplicate, true);
    const changedArtifactRetry = await callRaw(client, "attach_learning_artifact", {
      operationId: "learning-artifact-attach-1",
      artifactId: "session-boundary-trace",
      lessonId: lesson.lessonId,
      sessionId: createSessionInput.sessionId,
      homeworkId: "trace-session-boundary",
      kind: "trace",
      label: "Learning Session boundary trace",
      mediaType: "text/markdown",
      content: "changed retry must not overwrite immutable evidence",
      authorization: "learning_specialist",
    });
    assert.equal(changedArtifactRetry.isError, true);
    assert.equal(changedArtifactRetry.structuredContent.code, "learning_operation_conflict");

    const homework = await call(client, "set_learning_homework_state", {
      operationId: "learning-homework-complete-1",
      lessonId: lesson.lessonId,
      homeworkId: "trace-session-boundary",
      expectedRevision: 1,
      state: "completed",
      authorization: "explicit_user_instruction",
    });
    assert.equal(homework.state, "completed");
    assert.equal(homework.revision, 2);

    const finishInput = {
      operationId: "learning-session-finish-4",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 5,
      expectedTranscriptRevision: 2,
      authorization: "explicit_user_instruction",
      finalization: {
        recap: "Learning Sessions own their timer, transcript, evidence, and permanent Finish lock.",
        unresolvedQuestions: [],
        recommendedNextAction: "Trace one stale Session retry against its expected revision.",
        checkpointResults: [{
          checkpointId: "explain-session-state",
          status: "needs_another_pass",
          rationale: "The evidence identifies the boundary but needs a more precise explanation of both revisions.",
          evidence: [
            { kind: "transcript_turn", turnId: "learner-turn-0" },
            { kind: "artifact", artifactId: "session-boundary-trace" },
            { kind: "homework", homeworkId: "trace-session-boundary", revision: 2 },
          ],
        }],
      },
    };
    const finished = await call(client, "finish_learning_session", finishInput);
    assert.equal(finished.state, "completed");
    assert.equal(finished.revision, 6);
    assert.equal(finished.finalizationRevision, 1);
    assert.equal(finished.checkpointResults[0].status, "needs_another_pass");
    assert.equal(finished.lessonCompletion.completed, false);
    assert.equal((await call(client, "finish_learning_session", finishInput)).duplicate, true);
    const changedFinish = await callRaw(client, "finish_learning_session", {
      ...finishInput,
      finalization: { ...finishInput.finalization, recap: "Changed retry must fail closed." },
    });
    assert.equal(changedFinish.isError, true);
    assert.equal(changedFinish.structuredContent.code, "learning_operation_conflict");
    const resumeFinished = await callRaw(client, "control_learning_session", {
      operationId: "learning-session-resume-after-finish",
      sessionId: createSessionInput.sessionId,
      expectedRevision: 6,
      action: "resume",
      authorization: "explicit_user_instruction",
    });
    assert.equal(resumeFinished.isError, true);
    assert.equal(resumeFinished.structuredContent.code, "learning_session_completed");
    const appendAfterFinish = await callRaw(client, "append_learning_transcript", {
      operationId: "learning-transcript-after-finish",
      sessionId: createSessionInput.sessionId,
      expectedTranscriptRevision: 2,
      writer: "learning_specialist",
      turns: [{
        turnId: "late-turn",
        sequence: 3,
        speaker: "specialist",
        source: "typed",
        body: "Late mutation must fail.",
        occurredAt: 1_786_400_004_000,
      }],
    });
    assert.equal(appendAfterFinish.isError, true);
    assert.equal(appendAfterFinish.structuredContent.code, "learning_session_completed");

    const read = await call(client, "query_learning_sessions", { sessionId: createSessionInput.sessionId });
    assert.equal(read.sessions.length, 1);
    assert.equal(read.sessions[0].session.state, "completed");
    assert.equal(read.sessions[0].evidencePolicy, "transcript_only");
    assert.deepEqual(read.sessions[0].turns.map((turn) => turn.turnId), [
      "learner-turn-0",
      "specialist-turn-1",
      "learner-voice-turn-2",
    ]);
    assert.equal(read.sessions[0].intervals.length, 3);
    assert.ok(read.sessions[0].intervals.every((interval) => interval.endedAt !== null));
    assert.doesNotMatch(JSON.stringify(read), /audioClip|objectKey|deliveryAnalysis|finishBlocker/);
    assert.doesNotMatch(JSON.stringify(read), /"ownerId"|"operationId"|"requestFingerprint"/);
    const evidence = await call(client, "query_learning_evidence", {
      lessonId: lesson.lessonId,
      sessionId: createSessionInput.sessionId,
    });
    assert.equal(evidence.checkpointStates[0].status, "needs_another_pass");
    assert.equal(evidence.checkpointHistory.length, 1);
    assert.equal(evidence.checkpointHistory[0].evidence.length, 3);
    assert.equal(evidence.homework[0].revision, 2);
    assert.deepEqual(evidence.homeworkHistory.map((event) => event.state), ["open", "completed"]);
    assert.equal(evidence.artifacts[0].contentHash, sha256("public-safe learning session boundary trace"));
    assert.equal(evidence.artifacts[0].sizeBytes, Buffer.byteLength("public-safe learning session boundary trace"));
    assert.equal(evidence.finalizations[0].revision, 1);
    assert.doesNotMatch(JSON.stringify(evidence), /learning-artifacts-private|privateLocator/);
    assert.doesNotMatch(JSON.stringify(evidence), /"ownerId"|"operationId"|"requestFingerprint"/);
    const otherEvidence = await call(otherClient, "query_learning_evidence", {});
    assert.deepEqual(otherEvidence.checkpointStates, []);
    assert.deepEqual(otherEvidence.artifacts, []);

    await call(client, "create_learning_session", {
      operationId: "learning-session-create-2",
      sessionId: "learning-session-reliability-2",
      authorization: "learning_specialist",
      scope,
      lessonId: lesson.lessonId,
      lessonRevision: 1,
    });
    await call(client, "control_learning_session", {
      operationId: "learning-session-start-2",
      sessionId: "learning-session-reliability-2",
      expectedRevision: 0,
      action: "start",
      authorization: "explicit_user_instruction",
    });

    const voiceHTTPInput = {
      protocolVersion: 2,
      operationId: "learning-voice-http-2",
      sessionId: "learning-session-reliability-2",
      expectedTranscriptRevision: 0,
      turnId: "learner-voice-http-turn-0",
      sequence: 0,
      transcript: "Arc Voice persists this exact Learning turn without cloud audio.",
      checksum: sha256("Arc Voice persists this exact Learning turn without cloud audio."),
      occurredAt: 1_786_400_004_500,
    };
    const voiceHTTPResponse = await voiceRequest(baseUrl, token, "/voice/learning-transcripts", {
      method: "POST",
      body: JSON.stringify(voiceHTTPInput),
    });
    assert.equal(voiceHTTPResponse.status, 200);
    const voiceHTTPReceipt = await voiceHTTPResponse.json();
    assert.equal(voiceHTTPReceipt.protocolVersion, 2);
    assert.equal(voiceHTTPReceipt.transcriptRevision, 1);
    assert.deepEqual(voiceHTTPReceipt.turnIds, ["learner-voice-http-turn-0"]);
    assert.equal(voiceHTTPReceipt.evidencePolicy, "transcript_only");
    assert.equal(voiceHTTPReceipt.duplicate, false);

    const exactVoiceHTTPRetry = await voiceRequest(baseUrl, token, "/voice/learning-transcripts", {
      method: "POST",
      body: JSON.stringify(voiceHTTPInput),
    });
    assert.equal(exactVoiceHTTPRetry.status, 200);
    assert.equal((await exactVoiceHTTPRetry.json()).duplicate, true);

    const changedVoiceHTTPRetry = await voiceRequest(baseUrl, token, "/voice/learning-transcripts", {
      method: "POST",
      body: JSON.stringify({ ...voiceHTTPInput, transcript: "Changed retries fail closed." }),
    });
    assert.equal(changedVoiceHTTPRetry.status, 409);
    assert.equal((await changedVoiceHTTPRetry.json()).code, "learning_transcript_checksum_mismatch");

    const changedVoiceHTTPIdentity = {
      ...voiceHTTPInput,
      transcript: "Changed retries with a matching checksum still fail closed.",
      checksum: sha256("Changed retries with a matching checksum still fail closed."),
    };
    const changedVoiceHTTPIdentityRetry = await voiceRequest(baseUrl, token, "/voice/learning-transcripts", {
      method: "POST",
      body: JSON.stringify(changedVoiceHTTPIdentity),
    });
    assert.equal(changedVoiceHTTPIdentityRetry.status, 409);
    assert.equal((await changedVoiceHTTPIdentityRetry.json()).code, "learning_operation_conflict");

    const otherOwnerVoiceHTTPAttempt = await voiceRequest(baseUrl, otherToken, "/voice/learning-transcripts", {
      method: "POST",
      body: JSON.stringify(voiceHTTPInput),
    });
    assert.equal(otherOwnerVoiceHTTPAttempt.status, 409);
    assert.equal((await otherOwnerVoiceHTTPAttempt.json()).code, "learning_session_not_found");

    await call(client, "append_learning_transcript", {
      operationId: "learning-transcript-correction-2",
      sessionId: "learning-session-reliability-2",
      expectedTranscriptRevision: 1,
      writer: "learning_specialist",
      turns: [{
        turnId: "learner-correction-turn-0",
        sequence: 1,
        speaker: "learner",
        source: "typed",
        body: "The Session revision serializes timer state while transcriptRevision serializes exact turns.",
        occurredAt: 1_786_400_005_000,
      }],
    });
    const correctionFinalization = {
      recap: "A second exact Session supplies correction evidence without rewriting the prior result.",
      unresolvedQuestions: [],
      recommendedNextAction: "Compare both immutable checkpoint result revisions.",
      checkpointResults: [{
        checkpointId: "explain-session-state",
        status: "demonstrated",
        rationale: "The second transcript states both independent revision boundaries precisely.",
        evidence: [{ kind: "transcript_turn", turnId: "learner-correction-turn-0" }],
      }],
    };
    const missingSupersession = await callRaw(client, "finish_learning_session", {
      operationId: "learning-session-finish-2-missing-supersession",
      sessionId: "learning-session-reliability-2",
      expectedRevision: 1,
      expectedTranscriptRevision: 2,
      authorization: "explicit_user_instruction",
      finalization: correctionFinalization,
    });
    assert.equal(missingSupersession.isError, true);
    assert.equal(missingSupersession.structuredContent.code, "learning_checkpoint_revision_conflict");
    const corrected = await call(client, "finish_learning_session", {
      operationId: "learning-session-finish-2",
      sessionId: "learning-session-reliability-2",
      expectedRevision: 1,
      expectedTranscriptRevision: 2,
      authorization: "explicit_user_instruction",
      finalization: {
        ...correctionFinalization,
        checkpointResults: [{
          ...correctionFinalization.checkpointResults[0],
          supersedesRevision: 1,
        }],
      },
    });
    assert.equal(corrected.checkpointResults[0].revision, 2);
    assert.equal(corrected.lessonCompletion.completed, true);
    assert.equal(corrected.lessonCompletion.lessonRevision, 2);
    assert.equal(corrected.lessonCompletion.courseCompleted, false);
    assert.equal(corrected.lessonCompletion.nextLessonId, completionLesson.lessonId);
    const correctedEvidence = await call(client, "query_learning_evidence", { lessonId: lesson.lessonId });
    assert.equal(correctedEvidence.checkpointStates[0].currentRevision, 2);
    assert.deepEqual(correctedEvidence.checkpointHistory.map((event) => event.revision), [1, 2]);
    assert.equal(correctedEvidence.checkpointHistory[1].supersedesRevision, 1);

    await call(client, "save_learning_lesson_revision", {
      operationId: "completion-lesson-create-1",
      expectedRevision: 0,
      authorization: "learning_specialist",
      scope,
      lesson: completionLesson,
    });
    await call(client, "create_learning_session", {
      operationId: "completion-session-create-1",
      sessionId: "learning-session-completion-1",
      authorization: "learning_specialist",
      scope,
      lessonId: completionLesson.lessonId,
      lessonRevision: 1,
    });
    await call(client, "control_learning_session", {
      operationId: "completion-session-start-1",
      sessionId: "learning-session-completion-1",
      expectedRevision: 0,
      action: "start",
      authorization: "explicit_user_instruction",
    });
    await call(client, "append_learning_transcript", {
      operationId: "completion-transcript-1",
      sessionId: "learning-session-completion-1",
      expectedTranscriptRevision: 0,
      writer: "learning_specialist",
      turns: [{
        turnId: "completion-turn-0",
        sequence: 0,
        speaker: "learner",
        source: "typed",
        body: "Session Finish locks one conversation; demonstrated required checkpoints complete its Lesson; every pinned Lesson completes the Course.",
        occurredAt: 1_786_400_006_000,
      }],
    });
    const courseCompleted = await call(client, "finish_learning_session", {
      operationId: "completion-session-finish-1",
      sessionId: "learning-session-completion-1",
      expectedRevision: 1,
      expectedTranscriptRevision: 1,
      authorization: "explicit_user_instruction",
      finalization: {
        recap: "The final pinned Lesson now has exact checkpoint evidence.",
        unresolvedQuestions: [],
        recommendedNextAction: "Review the immutable Course chronology.",
        checkpointResults: [{
          checkpointId: "explain-course-completion",
          status: "demonstrated",
          rationale: "The exact learner turn distinguishes all four completion boundaries.",
          evidence: [{ kind: "transcript_turn", turnId: "completion-turn-0" }],
        }],
      },
    });
    assert.equal(courseCompleted.lessonCompletion.completed, true);
    assert.equal(courseCompleted.lessonCompletion.courseCompleted, true);
    assert.equal(courseCompleted.lessonCompletion.nextLessonId, null);

    const journey = await call(client, "query_learning_journey", {});
    assert.deepEqual(new Set(journey.events.map((event) => event.kind)), new Set([
      "course_completed",
      "lesson_completed",
      "session_finished",
      "checkpoint_demonstrated",
      "homework_completed",
    ]));
    assert.equal(journey.events.filter((event) => event.kind === "session_finished").length, 3);
    assert.equal(journey.events.filter((event) => event.kind === "checkpoint_demonstrated").length, 2);
    assert.equal(journey.evidencePolicy, "factual_events_only");
    assert.doesNotMatch(JSON.stringify(journey), /The Learning Session is separate|learner-turn|sections|recap/);
    const boundedJourney = await call(client, "query_learning_journey", { limit: 2 });
    assert.equal(boundedJourney.events.length, 2);
    assert.equal(boundedJourney.truncated, true);
    assert.deepEqual((await call(otherClient, "query_learning_journey", {})).events, []);

    const workspace = await call(client, "query_learning_workspace", {});
    assert.equal(workspace.facts.sessionCount, 3);
    assert.equal(workspace.facts.completedSessionCount, 3);
    assert.ok(workspace.facts.recordedLearningSeconds >= 1);
    assert.equal(workspace.facts.homeworkCount, 1);
    assert.equal(workspace.facts.completedHomeworkCount, 1);
    assert.equal(workspace.facts.checkpointResultCount, 2);
    assert.equal(workspace.facts.demonstratedCheckpointCount, 2);
    const analytics = await call(client, "query_learning_analytics", {});
    assert.equal(analytics.overall.courseCount, 1);
    assert.equal(analytics.overall.completedCourseCount, 1);
    assert.equal(analytics.overall.lessonCount, 2);
    assert.equal(analytics.overall.completedLessonCount, 2);
    assert.equal(analytics.overall.sessionCount, 3);
    assert.equal(analytics.overall.completedSessionCount, 3);
    assert.equal(analytics.overall.activeLearningDays, 1);
    assert.equal(analytics.overall.requiredCheckpointCount, 2);
    assert.equal(analytics.overall.demonstratedCheckpointCount, 2);
    assert.equal(analytics.overall.checkpointCoverage, 1);
    assert.equal(analytics.overall.completedHomeworkCount, 1);
    assert.equal(analytics.courses[0].currentLessonId, completionLesson.lessonId);
    assert.equal(analytics.courses[0].timeByModule[0].key, "session-core");
    assert.equal(analytics.courses[0].timeByModule[0].sessionCount, 3);
    assert.equal(analytics.time.byDay[0].sessionCount, 3);
    assert.equal(analytics.time.byWeek[0].sessionCount, 3);
    assert.equal(analytics.time.byMonth[0].sessionCount, 3);
    assert.equal(analytics.time.byCourse[0].sessionCount, 3);
    assert.equal(analytics.recentTopics.length, 2);
    assert.equal(analytics.sessionDurationTrend.length, 3);
    assert.equal(analytics.evidencePolicy, "factual_analytics_only");
    assert.doesNotMatch(JSON.stringify(analytics), /The Learning Session is separate|learner-turn|sections|recap|mastery/);
    const isolatedAnalytics = await call(otherClient, "query_learning_analytics", {});
    assert.equal(isolatedAnalytics.overall.courseCount, 0);
    assert.deepEqual(isolatedAnalytics.courses, []);
  } finally {
    await client?.close().catch(() => {});
    await otherClient?.close().catch(() => {});
    worker?.kill("SIGTERM");
    if (worker && worker.exitCode === null) await new Promise((resolve) => worker.once("exit", resolve));
    if (persistence) await rm(persistence, { recursive: true, force: true });
    await releaseLock?.();
  }
});

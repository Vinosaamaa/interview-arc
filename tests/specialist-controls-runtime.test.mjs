import assert from "node:assert/strict";
import test from "node:test";

import {
  controlPracticeSessionTimer,
  controlPracticeTimer,
  setPracticeResult,
} from "../db/specialist-controls-runtime.ts";
import { nextTimerState } from "../db/timer-state.ts";
import { voiceWorkbenchActivityProjection } from "../db/voice-timer-policy.ts";

function practiceActivity(id, sessionId) {
  return {
    id,
    title: `Activity ${id}`,
    type: "leetcode",
    questionId: `question-${id}`,
    ...(sessionId ? { sessionId } : {}),
  };
}

function liveState({ activities, sessions = [] }) {
  return {
    serverNow: 0,
    workbench: {
      id: "workbench-1",
      status: "open",
      openedPacificDate: "2026-08-02",
      openedAt: 1,
      closedAt: null,
    },
    timers: {},
    sessionTimers: {},
    outcomes: {},
    outcomeRevisions: {},
    publicationStatuses: {},
    notes: {},
    structuredNotes: {},
    reviews: {},
    finalizations: {},
    audioClips: {},
    deliveryAnalyses: {},
    problemPreferences: [],
    solutionProfiles: [],
    solutionRevisions: [],
    activitySolutionLinks: [],
    personalQuestions: [],
    extraActivities: activities,
    focusBlocks: [],
    sessions,
    historyActivities: [],
    historyFocusBlocks: [],
    historySessions: [],
    focusedActivityId: null,
    focusedSessionId: null,
    focusedAt: null,
  };
}

function timerState(existing, action, now) {
  const next = nextTimerState(existing, action, now);
  return {
    accumulatedSeconds: next.accumulatedSeconds,
    startedAt: existing?.startedAt ?? (action === "start" ? now : null),
    runningSince: next.runningSince,
    completed: next.completed,
    completedAt: action === "finish" ? now : null,
    revision: next.revision,
  };
}

function harness(state) {
  let now = 1_000;
  const calls = [];
  const dependencies = {
    now: () => now,
    applyTimerAction: async (subjectId, kind, action, at, options) => {
      calls.push({ subjectId, kind, action, options });
      const timers = kind === "session" ? state.sessionTimers : state.timers;
      timers[subjectId] = timerState(timers[subjectId], action, at);
    },
    prepareVoiceCapturesForFinish: async () => ({}),
    voiceFinishGuardMessage: () => null,
    finishAndAdvancePracticeActivity: async () => {},
    startSessionPracticeActivity: async (input) => {
      calls.push({ atomicSessionStart: input });
      state.sessionTimers[input.sessionId] = timerState(state.sessionTimers[input.sessionId], "start", input.now);
      state.timers[input.activityId] = timerState(state.timers[input.activityId], "start", input.now);
    },
    controlSessionPracticeTimer: async (input) => {
      calls.push({ atomicSessionControl: input });
      const action = input.action === "resume" ? "start" : input.action;
      state.sessionTimers[input.sessionId] = timerState(state.sessionTimers[input.sessionId], action, input.now);
    },
    scheduleCompletedActivity: async () => {},
  };
  return {
    calls,
    dependencies,
    setNow(value) {
      now = value;
    },
  };
}

function timerInput(overrides = {}) {
  return {
    expectedWorkbenchId: "workbench-1",
    mutationId: "mutation-1",
    activityId: "activity-1",
    expectedRevision: 0,
    action: "start",
    ...overrides,
  };
}

function sessionTimerInput(overrides = {}) {
  return {
    expectedWorkbenchId: "workbench-1",
    mutationId: "session-mutation-1",
    sessionId: "session-1",
    expectedRevision: 1,
    action: "pause",
    ...overrides,
  };
}

test("a specialist can pause and resume the current workbench session", async () => {
  const state = liveState({
    activities: [practiceActivity("activity-1", "session-1")],
    sessions: [{ id: "session-1", activityIds: ["activity-1"] }],
  });
  state.sessionTimers["session-1"] = timerState(undefined, "start", 1_000);
  const runtime = harness(state);

  runtime.setNow(6_000);
  const paused = await controlPracticeSessionTimer(
    state,
    sessionTimerInput(),
    "request-hash-1",
    runtime.dependencies,
  );

  assert.equal(paused.result.applied, true);
  assert.equal(paused.receiptStored, true);
  assert.deepEqual(runtime.calls[0].atomicSessionControl, {
    sessionId: "session-1",
    action: "pause",
    expectedRevision: 1,
    mutationId: "session-mutation-1",
    workbenchId: "workbench-1",
    requestHash: "request-hash-1",
    receipt: paused.result,
    now: 6_000,
    activityIds: ["activity-1"],
  });
  assert.deepEqual(
    runtime.calls[0].atomicSessionControl.activityIds,
    ["activity-1"],
  );
  assert.equal(state.sessionTimers["session-1"].revision, 2);
  assert.equal(state.sessionTimers["session-1"].runningSince, null);

  runtime.setNow(7_000);
  const resumed = await controlPracticeSessionTimer(
    state,
    sessionTimerInput({
      mutationId: "session-mutation-2",
      expectedRevision: 2,
      action: "resume",
    }),
    "request-hash-2",
    runtime.dependencies,
  );

  assert.equal(resumed.result.applied, true);
  assert.equal(resumed.receiptStored, true);
  assert.equal(runtime.calls[1].atomicSessionControl.action, "resume");
  assert.equal(state.sessionTimers["session-1"].revision, 3);
  assert.equal(state.sessionTimers["session-1"].runningSince, 7_000);
});

test("session start and finish use the canonical workbench child activities", async () => {
  const state = liveState({
    activities: [
      practiceActivity("activity-1", "session-1"),
      practiceActivity("activity-2", "session-1"),
    ],
    sessions: [{ id: "session-1", activityIds: ["activity-1", "activity-2"] }],
  });
  const runtime = harness(state);

  await controlPracticeSessionTimer(state, sessionTimerInput({
    expectedRevision: 0,
    action: "start",
  }), "request-hash-1", runtime.dependencies);
  await controlPracticeSessionTimer(state, sessionTimerInput({
    mutationId: "session-mutation-2",
    expectedRevision: 1,
    action: "finish",
  }), "request-hash-2", runtime.dependencies);

  assert.deepEqual(runtime.calls.map((call) => call.atomicSessionControl.activityIds), [
    ["activity-1", "activity-2"],
    ["activity-1", "activity-2"],
  ]);
  assert.equal(state.sessionTimers["session-1"].completed, true);
  assert.equal(state.sessionTimers["session-1"].revision, 2);
});

test("session controls reject stale workbenches, stale revisions, and unknown sessions", async () => {
  const state = liveState({
    activities: [practiceActivity("activity-1", "session-1")],
    sessions: [{ id: "session-1", activityIds: ["activity-1"] }],
  });
  state.sessionTimers["session-1"] = timerState(undefined, "start", 1_000);
  const runtime = harness(state);

  await assert.rejects(
    controlPracticeSessionTimer(state, sessionTimerInput({
      expectedWorkbenchId: "old-workbench",
    }), "request-hash", runtime.dependencies),
    (error) => error?.code === "stale_workbench",
  );
  await assert.rejects(
    controlPracticeSessionTimer(state, sessionTimerInput({
      expectedRevision: 0,
    }), "request-hash", runtime.dependencies),
    (error) => error?.code === "stale_timer_revision",
  );
  await assert.rejects(
    controlPracticeSessionTimer(state, sessionTimerInput({
      sessionId: "missing-session",
      expectedRevision: 0,
    }), "request-hash", runtime.dependencies),
    (error) => error?.code === "session_not_found",
  );
  assert.equal(runtime.calls.length, 0);
});

test("a completed session remains permanently locked", async () => {
  const state = liveState({
    activities: [practiceActivity("activity-1", "session-1")],
    sessions: [{ id: "session-1", activityIds: ["activity-1"] }],
  });
  state.sessionTimers["session-1"] = {
    ...timerState(undefined, "start", 1_000),
    completed: true,
    completedAt: 2_000,
    runningSince: null,
  };
  const runtime = harness(state);

  await assert.rejects(
    controlPracticeSessionTimer(state, sessionTimerInput({ action: "resume" }), "request-hash", runtime.dependencies),
    (error) => error?.code === "timer_completed",
  );
  assert.equal(runtime.calls.length, 0);
});

test("an unfocused planned activity in the open workbench can be started", async () => {
  const state = liveState({ activities: [practiceActivity("activity-1")] });
  const runtime = harness(state);

  const response = await controlPracticeTimer(
    state,
    timerInput(),
    "request-hash",
    runtime.dependencies,
  );

  assert.equal(state.focusedActivityId, null);
  assert.equal(state.timers["activity-1"].revision, 1);
  assert.equal(state.timers["activity-1"].runningSince, 1_000);
  assert.equal(response.result.applied, true);
});

test("pause, resume, and finish preserve optimistic timer revisions", async () => {
  const state = liveState({ activities: [practiceActivity("activity-1")] });
  const runtime = harness(state);
  await controlPracticeTimer(state, timerInput(), "hash-1", runtime.dependencies);

  runtime.setNow(6_000);
  await controlPracticeTimer(state, timerInput({
    mutationId: "mutation-2",
    expectedRevision: 1,
    action: "pause",
  }), "hash-2", runtime.dependencies);
  assert.deepEqual(
    {
      seconds: state.timers["activity-1"].accumulatedSeconds,
      revision: state.timers["activity-1"].revision,
      running: state.timers["activity-1"].runningSince,
    },
    { seconds: 5, revision: 2, running: null },
  );

  runtime.setNow(7_000);
  await controlPracticeTimer(state, timerInput({
    mutationId: "mutation-3",
    expectedRevision: 2,
    action: "resume",
  }), "hash-3", runtime.dependencies);
  assert.equal(state.timers["activity-1"].revision, 3);
  assert.equal(state.timers["activity-1"].runningSince, 7_000);

  runtime.setNow(10_000);
  await controlPracticeTimer(state, timerInput({
    mutationId: "mutation-4",
    expectedRevision: 3,
    action: "finish",
  }), "hash-4", runtime.dependencies);
  assert.equal(state.timers["activity-1"].accumulatedSeconds, 8);
  assert.equal(state.timers["activity-1"].revision, 4);
  assert.equal(state.timers["activity-1"].completed, true);
});

test("finish returns stable Voice blocker details before mutating the timer", async () => {
  const state = liveState({ activities: [practiceActivity("activity-1")] });
  const runtime = harness(state);
  await controlPracticeTimer(state, timerInput(), "hash-1", runtime.dependencies);
  const voiceGuard = {
    awaitingDelivery: [],
    missingDurableExchange: [],
    awaitingAudio: [],
    audioLostNeedsAcknowledgement: [],
    needsDecision: [],
    deleting: [],
    conflicts: ["capture-conflict"],
    discardedUnclassified: [],
  };
  runtime.dependencies.prepareVoiceCapturesForFinish = async () => voiceGuard;
  runtime.dependencies.voiceFinishGuardMessage = () => "One Voice group needs repair.";

  await assert.rejects(
    controlPracticeTimer(state, timerInput({
      mutationId: "mutation-2",
      expectedRevision: 1,
      action: "finish",
    }), "hash-2", runtime.dependencies),
    (error) => error?.code === "voice_delivery_blocked"
      && error?.details?.retryable === false
      && error?.details?.voiceGuard === voiceGuard,
  );
  assert.equal(state.timers["activity-1"].revision, 1);
  assert.equal(state.timers["activity-1"].completed, false);
});

test("repairable review scheduling cannot turn a committed finish into failure", async () => {
  const state = liveState({ activities: [practiceActivity("activity-1")] });
  state.outcomes["activity-1"] = "failed";
  const runtime = harness(state);
  await controlPracticeTimer(state, timerInput(), "hash-1", runtime.dependencies);
  runtime.dependencies.scheduleCompletedActivity = async () => {
    throw new Error("temporary review scheduling failure");
  };

  const response = await controlPracticeTimer(state, timerInput({
    mutationId: "mutation-2",
    expectedRevision: 1,
    action: "finish",
  }), "hash-2", runtime.dependencies);

  assert.equal(response.result.applied, true);
  assert.equal(state.timers["activity-1"].completed, true);
});

test("an unfocused planned activity accepts an explicit result", async () => {
  const state = liveState({ activities: [practiceActivity("activity-1")] });
  const changed = [];
  const response = await setPracticeResult(state, {
    expectedWorkbenchId: "workbench-1",
    mutationId: "result-1",
    activityId: "activity-1",
    expectedRevision: 0,
    result: "solved",
    authorization: "explicit_user_instruction",
  }, "result-request-hash", "2026-08-02", {
    now: () => 1_000,
    setPracticeResultAtomic: async (input) => {
      state.outcomes[input.activityId] = input.result;
      state.outcomeRevisions[input.activityId] = input.expectedRevision + 1;
      changed.push([input.activityId, input.result]);
    },
  });

  assert.deepEqual(changed, [["activity-1", "solved"]]);
  assert.equal(response.applied, true);
});

test("stale workbenches and stale timer revisions are rejected before mutation", async () => {
  const state = liveState({ activities: [practiceActivity("activity-1")] });
  const runtime = harness(state);

  await assert.rejects(
    controlPracticeTimer(
      state,
      timerInput({ expectedWorkbenchId: "old-workbench" }),
      "hash-1",
      runtime.dependencies,
    ),
    (error) => error?.code === "stale_workbench",
  );
  state.timers["activity-1"] = timerState(undefined, "start", 1_000);
  await assert.rejects(
    controlPracticeTimer(state, timerInput(), "hash-2", runtime.dependencies),
    (error) => error?.code === "stale_timer_revision",
  );
  assert.equal(runtime.calls.length, 0);
});

test("starting a session activity also starts its parent session", async () => {
  const activity = practiceActivity("activity-1", "session-1");
  const state = liveState({
    activities: [activity, practiceActivity("activity-2", "session-1")],
    sessions: [{ id: "session-1", activityIds: ["activity-1", "activity-2"] }],
  });
  const runtime = harness(state);

  await controlPracticeTimer(state, timerInput(), "hash", runtime.dependencies);

  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].atomicSessionStart.sessionId, "session-1");
  assert.equal(runtime.calls[0].atomicSessionStart.activityId, "activity-1");
  assert.equal(runtime.calls[0].atomicSessionStart.receipt.mutationId, "mutation-1");
  assert.equal(state.sessionTimers["session-1"].revision, 1);
  assert.equal(state.timers["activity-1"].revision, 1);
});

test("the Voice timer projection includes every workbench session and standalone activity", () => {
  assert.deepEqual(
    voiceWorkbenchActivityProjection([
      { id: "session-1", activityIds: ["activity-1", "activity-2"] },
      { id: "session-3", activityIds: ["activity-3", "career-block"] },
    ], ["activity-3", "activity-1", "standalone", "career-block"]),
    {
      activityIds: ["activity-1", "activity-3", "career-block", "standalone"],
      sessionIdByActivityId: {
        "activity-1": "session-1",
        "activity-3": "session-3",
        "career-block": "session-3",
      },
    },
  );
});

test("the Voice timer projection is empty only when the workbench is empty", () => {
  assert.deepEqual(voiceWorkbenchActivityProjection([], []), {
    activityIds: [],
    sessionIdByActivityId: {},
  });
});

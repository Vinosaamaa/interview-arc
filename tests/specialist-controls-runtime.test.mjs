import assert from "node:assert/strict";
import test from "node:test";

import {
  controlPracticeTimer,
  setPracticeResult,
} from "../db/specialist-controls-runtime.ts";
import { nextTimerState } from "../db/timer-state.ts";
import { voiceTimerActivityIds } from "../db/voice-timer-policy.ts";

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
    result: "solved",
    authorization: "explicit_user_instruction",
  }, {
    now: () => 1_000,
    setOutcome: async (activityId, result) => {
      state.outcomes[activityId] = result;
      changed.push([activityId, result]);
    },
    clearActivityReviewSchedules: async () => {},
    scheduleCompletedActivity: async () => {},
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

  assert.deepEqual(runtime.calls.map(({ subjectId, kind, action }) => ({ subjectId, kind, action })), [
    { subjectId: "session-1", kind: "session", action: "start" },
    { subjectId: "activity-1", kind: "activity", action: "start" },
  ]);
  assert.equal(state.sessionTimers["session-1"].revision, 1);
  assert.equal(state.timers["activity-1"].revision, 1);
});

test("the Voice timer projection remains focused-session or focused-activity only", () => {
  assert.deepEqual(voiceTimerActivityIds(null, null), []);
  assert.deepEqual(voiceTimerActivityIds(null, "focused-activity"), ["focused-activity"]);
  assert.deepEqual(
    voiceTimerActivityIds(["session-activity-1", "session-activity-2"], "focused-activity"),
    ["session-activity-1", "session-activity-2"],
  );
});

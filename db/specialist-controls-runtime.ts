import type {
  LiveState,
  OutcomeValue,
  TimerAction,
} from "./live-state.ts";
import {
  selectNextPracticeActivity,
  SpecialistControlError,
} from "./specialist-controls-policy.ts";

export type SpecialistPracticeActivity = {
  id: string;
  title: string;
  type: "leetcode" | "system_design" | "behavioral";
  questionId?: string;
  sessionId?: string;
  reviewOfActivityId?: string;
};

export type SpecialistPracticeRuntime = SpecialistPracticeActivity & {
  timer: LiveState["timers"][string] | null;
  outcome?: OutcomeValue;
};

type SpecialistSession = {
  id: string;
  activityIds: string[];
};

export type PracticeTimerControlInput = {
  expectedWorkbenchId: string;
  mutationId: string;
  activityId: string;
  expectedRevision: number;
  action: "start" | "pause" | "resume" | "finish" | "finish_and_advance";
  nextActivityId?: string;
  expectedNextRevision?: number;
};

export type PracticeTimerControlDependencies = {
  now: () => number;
  applyTimerAction: (
    subjectId: string,
    kind: "activity" | "session",
    action: TimerAction,
    now: number,
    options: {
      activityIds?: string[];
      sessionId?: string;
      expectedRevision?: number;
    },
  ) => Promise<unknown>;
  prepareVoiceCapturesForFinish: (activityId: string, now: number) => Promise<unknown>;
  voiceFinishGuardMessage: (value: unknown) => string | null;
  finishAndAdvancePracticeActivity: (input: {
    currentActivityId: string;
    expectedCurrentRevision: number;
    nextActivityId: string;
    nextSessionId?: string;
    expectedNextRevision: number;
    mutationId: string;
    workbenchId: string;
    requestHash: string;
    receipt: Record<string, unknown>;
    now: number;
  }) => Promise<void>;
  scheduleCompletedActivity: (
    activity: SpecialistPracticeRuntime,
    outcome: OutcomeValue,
    now: number,
  ) => Promise<void>;
};

export type PracticeResultControlInput = {
  expectedWorkbenchId: string;
  mutationId: string;
  activityId: string;
  result: OutcomeValue | null;
  authorization: "explicit_user_instruction" | "authorized_platform_verdict";
};

export type PracticeResultControlDependencies = {
  now: () => number;
  setOutcome: (activityId: string, result: OutcomeValue | null, now: number) => Promise<void>;
  clearActivityReviewSchedules: (activityId: string) => Promise<void>;
  scheduleCompletedActivity: (
    activity: SpecialistPracticeRuntime,
    outcome: OutcomeValue,
    now: number,
  ) => Promise<void>;
};

function requireWorkbench(state: LiveState, expectedWorkbenchId: string) {
  if (!state.workbench || state.workbench.id !== expectedWorkbenchId) {
    throw new SpecialistControlError(
      "stale_workbench",
      "Today changed in another surface. Read Today again before retrying the command.",
    );
  }
}

export function specialistPracticeActivity(state: LiveState, activityId: string) {
  const activity = state.extraActivities.find((candidate) => (
    Boolean(candidate)
    && typeof candidate === "object"
    && (candidate as { id?: unknown }).id === activityId
  )) as SpecialistPracticeActivity | undefined;
  if (!activity || !["leetcode", "system_design", "behavioral"].includes(activity.type)) {
    throw new SpecialistControlError(
      "practice_activity_not_found",
      "The requested practice activity is not available in the current workbench.",
    );
  }
  return activity;
}

export function specialistPracticeRuntime(
  state: LiveState,
  activity: SpecialistPracticeActivity,
): SpecialistPracticeRuntime {
  const outcome = state.outcomes[activity.id];
  return {
    ...activity,
    timer: state.timers[activity.id] ?? null,
    ...(outcome ? { outcome } : {}),
  };
}

function specialistSession(state: LiveState, sessionId: string) {
  const session = state.sessions.find((candidate) => (
    Boolean(candidate)
    && typeof candidate === "object"
    && (candidate as { id?: unknown }).id === sessionId
  )) as SpecialistSession | undefined;
  if (!session || !Array.isArray(session.activityIds)) {
    throw new SpecialistControlError(
      "session_not_found",
      "The requested session is not available in the current workbench.",
    );
  }
  return session;
}

function requireTimerRevision(state: LiveState, activityId: string, expectedRevision: number) {
  const actualRevision = state.timers[activityId]?.revision ?? 0;
  if (actualRevision !== expectedRevision) {
    throw new SpecialistControlError(
      "stale_timer_revision",
      `The activity timer changed from revision ${expectedRevision} to ${actualRevision}. Read Today again before retrying.`,
    );
  }
}

async function finishAndAdvancePracticeTimer(
  state: LiveState,
  input: PracticeTimerControlInput,
  requestHash: string,
  activity: SpecialistPracticeRuntime,
  dependencies: PracticeTimerControlDependencies,
  now: number,
) {
  if (!activity.timer?.startedAt || activity.timer.completed) {
    throw new SpecialistControlError(
      "timer_not_finishable",
      "The current activity must be started and unfinished before advancing.",
    );
  }
  if (!activity.outcome) {
    throw new SpecialistControlError(
      "result_required",
      "Set an explicit result before finishing and advancing.",
    );
  }
  const sessionActivityIds = activity.sessionId
    ? specialistSession(state, activity.sessionId).activityIds
    : [];
  const advancedTo = selectNextPracticeActivity({
    currentActivityId: input.activityId,
    explicitNextActivityId: input.nextActivityId,
    sessionActivityIds,
    practiceActivityIds: new Set(state.extraActivities.flatMap((candidate) => {
      const item = candidate as { id?: unknown; type?: unknown };
      return typeof item.id === "string" && ["leetcode", "system_design", "behavioral"].includes(String(item.type))
        ? [item.id]
        : [];
    })),
    completedActivityIds: new Set(Object.entries(state.timers).flatMap(([id, timer]) => (
      timer?.completed ? [id] : []
    ))),
  });
  const nextPayload = specialistPracticeActivity(state, advancedTo);
  if (input.expectedNextRevision == null) {
    throw new SpecialistControlError(
      "next_timer_revision_required",
      "Finish-and-advance requires the next activity's current timer revision.",
    );
  }
  requireTimerRevision(state, advancedTo, input.expectedNextRevision);
  if (state.timers[advancedTo]?.completed) {
    throw new SpecialistControlError(
      "next_activity_unavailable",
      "The next activity is already finished.",
    );
  }
  const voiceGuard = await dependencies.prepareVoiceCapturesForFinish(input.activityId, now);
  const voiceConflict = dependencies.voiceFinishGuardMessage(voiceGuard);
  if (voiceConflict) {
    throw new SpecialistControlError("timer_state_conflict", voiceConflict);
  }
  const receipt = {
    mutationId: input.mutationId,
    activityId: input.activityId,
    action: input.action,
    advancedTo,
    applied: true,
  };
  await dependencies.finishAndAdvancePracticeActivity({
    currentActivityId: input.activityId,
    expectedCurrentRevision: input.expectedRevision,
    nextActivityId: advancedTo,
    nextSessionId: nextPayload.sessionId,
    expectedNextRevision: input.expectedNextRevision,
    mutationId: input.mutationId,
    workbenchId: input.expectedWorkbenchId,
    requestHash,
    receipt,
    now,
  });
  try {
    await dependencies.scheduleCompletedActivity(activity, activity.outcome, now);
  } catch {
    // Review scheduling is repairable metadata. The atomic timer and receipt
    // commit remains successful and an exact retry is safe.
  }
  return advancedTo;
}

async function applyOrdinaryPracticeTimerAction(
  state: LiveState,
  input: PracticeTimerControlInput,
  activity: SpecialistPracticeRuntime,
  dependencies: PracticeTimerControlDependencies,
  now: number,
) {
  const action: TimerAction = input.action === "resume" ? "start" : input.action as TimerAction;
  if (action === "start" && activity.sessionId) {
    const session = specialistSession(state, activity.sessionId);
    await dependencies.applyTimerAction(activity.sessionId, "session", "start", now, {
      activityIds: session.activityIds,
    });
  }
  await dependencies.applyTimerAction(input.activityId, "activity", action, now, {
    sessionId: activity.sessionId,
    expectedRevision: input.expectedRevision,
  });
  if (action === "finish" && activity.outcome) {
    await dependencies.scheduleCompletedActivity(activity, activity.outcome, now);
  }
}

export async function controlPracticeTimer(
  state: LiveState,
  input: PracticeTimerControlInput,
  requestHash: string,
  dependencies: PracticeTimerControlDependencies,
) {
  requireWorkbench(state, input.expectedWorkbenchId);
  const activityPayload = specialistPracticeActivity(state, input.activityId);
  requireTimerRevision(state, input.activityId, input.expectedRevision);
  const activity = specialistPracticeRuntime(state, activityPayload);
  const now = dependencies.now();
  let advancedTo: string | null = null;
  if (input.action === "finish_and_advance") {
    advancedTo = await finishAndAdvancePracticeTimer(
      state,
      input,
      requestHash,
      activity,
      dependencies,
      now,
    );
  } else {
    await applyOrdinaryPracticeTimerAction(state, input, activity, dependencies, now);
  }

  return {
    result: {
      mutationId: input.mutationId,
      activityId: input.activityId,
      action: input.action,
      advancedTo,
      applied: true,
    },
    receiptStored: input.action === "finish_and_advance",
  };
}

export async function setPracticeResult(
  state: LiveState,
  input: PracticeResultControlInput,
  dependencies: PracticeResultControlDependencies,
) {
  requireWorkbench(state, input.expectedWorkbenchId);
  const activityPayload = specialistPracticeActivity(state, input.activityId);
  const activity = specialistPracticeRuntime(state, activityPayload);
  const now = dependencies.now();
  await dependencies.setOutcome(input.activityId, input.result, now);
  if (!input.result) {
    await dependencies.clearActivityReviewSchedules(input.activityId);
  } else if (activity.timer?.completed) {
    await dependencies.scheduleCompletedActivity(activity, input.result, now);
  }
  return {
    mutationId: input.mutationId,
    activityId: input.activityId,
    result: input.result,
    authorization: input.authorization,
    applied: true,
  };
}

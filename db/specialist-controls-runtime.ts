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

export type PracticeSessionTimerControlInput = {
  expectedWorkbenchId: string;
  mutationId: string;
  sessionId: string;
  expectedRevision: number;
  action: "start" | "pause" | "resume" | "finish";
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
  startSessionPracticeActivity: (input: {
    activityId: string;
    expectedActivityRevision: number;
    sessionId: string;
    sessionActivityIds: string[];
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
  expectedRevision: number;
  result: OutcomeValue | null;
  authorization: "explicit_user_instruction" | "authorized_platform_verdict";
};

export type PracticeResultControlDependencies = {
  now: () => number;
  setPracticeResultAtomic: (input: {
    activityId: string;
    result: OutcomeValue | null;
    expectedRevision: number;
    activity: {
      specialty: "leetcode" | "system_design" | "behavioral";
      questionId?: string;
      reviewOfActivityId?: string;
      completed: boolean;
    };
    completedDate: string;
    mutationId: string;
    workbenchId: string;
    requestHash: string;
    receipt: Record<string, unknown>;
    now: number;
  }) => Promise<void>;
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

function requireSessionTimerRevision(state: LiveState, sessionId: string, expectedRevision: number) {
  const actualRevision = state.sessionTimers[sessionId]?.revision ?? 0;
  if (actualRevision !== expectedRevision) {
    throw new SpecialistControlError(
      "stale_timer_revision",
      `The session timer changed from revision ${expectedRevision} to ${actualRevision}. Read Today again before retrying.`,
    );
  }
}

export async function controlPracticeSessionTimer(
  state: LiveState,
  input: PracticeSessionTimerControlInput,
  dependencies: Pick<PracticeTimerControlDependencies, "now" | "applyTimerAction">,
) {
  requireWorkbench(state, input.expectedWorkbenchId);
  const session = specialistSession(state, input.sessionId);
  requireSessionTimerRevision(state, input.sessionId, input.expectedRevision);
  const timer = state.sessionTimers[input.sessionId];
  if (timer?.completed) {
    throw new SpecialistControlError(
      "timer_completed",
      "The session timer is already finished and cannot be changed.",
    );
  }
  if (input.action === "pause" && !timer?.runningSince) {
    throw new SpecialistControlError(
      "timer_not_running",
      "The session timer must be running before it can be paused.",
    );
  }
  if (input.action === "resume" && (!timer?.startedAt || timer.runningSince)) {
    throw new SpecialistControlError(
      "timer_not_paused",
      "The session timer must be started and paused before it can be resumed.",
    );
  }
  if (input.action === "finish" && !timer?.startedAt) {
    throw new SpecialistControlError(
      "timer_not_finishable",
      "The session timer must be started before it can be finished.",
    );
  }
  const action: TimerAction = input.action === "resume" ? "start" : input.action;
  await dependencies.applyTimerAction(input.sessionId, "session", action, dependencies.now(), {
    activityIds: session.activityIds,
    expectedRevision: input.expectedRevision,
  });
  return {
    mutationId: input.mutationId,
    sessionId: input.sessionId,
    action: input.action,
    applied: true,
  };
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
  requestHash: string,
) {
  const action: TimerAction = input.action === "resume" ? "start" : input.action as TimerAction;
  if (action === "start" && activity.sessionId) {
    const session = specialistSession(state, activity.sessionId);
    const receipt = {
      mutationId: input.mutationId,
      activityId: input.activityId,
      action: input.action,
      advancedTo: null,
      applied: true,
    };
    await dependencies.startSessionPracticeActivity({
      activityId: input.activityId,
      expectedActivityRevision: input.expectedRevision,
      sessionId: activity.sessionId,
      sessionActivityIds: session.activityIds,
      mutationId: input.mutationId,
      workbenchId: input.expectedWorkbenchId,
      requestHash,
      receipt,
      now,
    });
    return true;
  }
  await dependencies.applyTimerAction(input.activityId, "activity", action, now, {
    sessionId: activity.sessionId,
    expectedRevision: input.expectedRevision,
  });
  if (action === "finish" && activity.outcome) {
    try {
      await dependencies.scheduleCompletedActivity(activity, activity.outcome, now);
    } catch {
      // The timer is authoritative. Review scheduling is repairable metadata
      // and must not turn a committed finish into an unreceipted failure.
    }
  }
  return false;
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
    const receiptStored = await applyOrdinaryPracticeTimerAction(
      state,
      input,
      activity,
      dependencies,
      now,
      requestHash,
    );
    return {
      result: {
        mutationId: input.mutationId,
        activityId: input.activityId,
        action: input.action,
        advancedTo,
        applied: true,
      },
      receiptStored,
    };
  }

  return {
    result: {
      mutationId: input.mutationId,
      activityId: input.activityId,
      action: input.action,
      advancedTo,
      applied: true,
    },
    receiptStored: true,
  };
}

export async function setPracticeResult(
  state: LiveState,
  input: PracticeResultControlInput,
  requestHash: string,
  completedDate: string,
  dependencies: PracticeResultControlDependencies,
) {
  requireWorkbench(state, input.expectedWorkbenchId);
  const activityPayload = specialistPracticeActivity(state, input.activityId);
  const activity = specialistPracticeRuntime(state, activityPayload);
  const actualRevision = state.outcomeRevisions[input.activityId] ?? 0;
  if (actualRevision !== input.expectedRevision) {
    throw new SpecialistControlError(
      "stale_result_revision",
      `The activity result changed from revision ${input.expectedRevision} to ${actualRevision}. Read Today again before retrying.`,
    );
  }
  const now = dependencies.now();
  const result = {
    mutationId: input.mutationId,
    activityId: input.activityId,
    result: input.result,
    authorization: input.authorization,
    applied: true,
  };
  await dependencies.setPracticeResultAtomic({
    activityId: input.activityId,
    result: input.result,
    expectedRevision: input.expectedRevision,
    activity: {
      specialty: activity.type,
      ...(activity.questionId ? { questionId: activity.questionId } : {}),
      ...(activity.reviewOfActivityId ? { reviewOfActivityId: activity.reviewOfActivityId } : {}),
      completed: Boolean(activity.timer?.completed),
    },
    completedDate,
    mutationId: input.mutationId,
    workbenchId: input.expectedWorkbenchId,
    requestHash,
    receipt: result,
    now,
  });
  return result;
}

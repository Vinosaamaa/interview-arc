import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  activityNotes,
  activityAudioClips,
  activityDeliveryAnalyses,
  activityFinalizations,
  extraActivities,
  focusBlocks,
  leetcodeCodeAttempts,
  liveSessions,
  outcomes,
  practiceFocus,
  practiceWorkbenches,
  practiceNotes,
  practiceTranscriptTurns,
  problemPreferences,
  publicationStatuses,
  timerIntervals,
  timers,
  reviewSchedules,
  type ExtraActivityRow,
  type FocusBlockRow,
  type LiveSessionRow,
  voiceCaptureIntents,
} from "./schema";
import { foldElapsed, nextTimerState } from "./timer-state";
import {
  prepareVoiceCapturesForFinish,
  readDurablePracticeSummary,
  voiceFinishGuardMessage,
} from "./durable-practice";
import { voiceWorkbenchActivityProjection } from "./voice-timer-policy";

export type TimerKind = "activity" | "session";
export type TimerAction = "start" | "pause" | "finish";
export type OutcomeValue = "solved" | "solved_after_reviewing_approach" | "failed";
export type PublicationStatusValue = "draft" | "ready" | "published";

export class TimerStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimerStateConflictError";
  }
}
export type WorkbenchState = {
  id: string;
  status: "open" | "archived";
  openedPacificDate: string;
  openedAt: number;
  closedAt: number | null;
  revision: number;
};

// Serialized clock as the client consumes it. `runningSince` is server epoch ms;
// the client corrects for clock skew using `serverNow` from the state response.
export type TimerState = {
  accumulatedSeconds: number;
  startedAt: number | null;
  runningSince: number | null;
  completed: boolean;
  completedAt: number | null;
  revision: number;
};

export type LiveState = {
  serverNow: number;
  workbench: WorkbenchState | null;
  timers: Record<string, TimerState>;
  sessionTimers: Record<string, TimerState>;
  outcomes: Record<string, OutcomeValue>;
  outcomeRevisions: Record<string, number>;
  publicationStatuses: Record<string, PublicationStatusValue>;
  notes: Record<string, string>;
  structuredNotes: Record<string, unknown[]>;
  reviews: Record<string, unknown>;
  finalizations: Record<string, unknown>;
  audioClips: Record<string, unknown[]>;
  deliveryAnalyses: Record<string, unknown[]>;
  problemPreferences: unknown[];
  solutionProfiles: unknown[];
  solutionRevisions: unknown[];
  activitySolutionLinks: unknown[];
  personalQuestions: unknown[];
  extraActivities: unknown[];
  focusBlocks: unknown[];
  sessions: unknown[];
  historyActivities: unknown[];
  historyFocusBlocks: unknown[];
  historySessions: unknown[];
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

export type TimerSyncState = {
  serverNow: number;
  timers: Record<string, TimerState>;
  sessionTimers: Record<string, TimerState>;
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

type Db = ReturnType<typeof getDb>;

function toTimerState(row: {
  accumulatedSeconds: number;
  startedAt: number | null;
  runningSince: number | null;
  completed: boolean;
  completedAt: number | null;
  revision: number;
}): TimerState {
  return {
    accumulatedSeconds: row.accumulatedSeconds,
    startedAt: row.startedAt,
    runningSince: row.runningSince,
    completed: row.completed,
    completedAt: row.completedAt,
    revision: row.revision,
  };
}

type ActivityPayload = { id: string; date: string; sessionId?: string | null } & Record<string, unknown>;
type SessionPayload = { id: string; date?: string; activityIds: string[] } & Record<string, unknown>;

function toFocusBlock(row: FocusBlockRow) {
  return {
    id: row.id,
    workbenchId: row.workbenchId,
    activityClass: "focus_block" as const,
    focusCategory: row.category,
    title: row.title,
    plannedSeconds: row.plannedSeconds,
    ...(row.note ? { note: row.note } : {}),
    date: row.date,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ActiveVoiceActivity = ActivityPayload & {
  type: "leetcode" | "system_design" | "behavioral";
  title: string;
  questionId?: string;
  url?: string;
  prompt?: string;
  vocabularyPackIds?: string[];
  speechTerms?: string[];
  timer: TimerState;
};

export type VoiceTimerActivity =
  | (ActivityPayload & {
      activityClass: "practice";
      sessionId: string | null;
      type: "leetcode" | "system_design" | "behavioral";
      title: string;
      questionId?: string;
      url?: string;
      allocatedSeconds: number;
      timer: TimerState | null;
      starred: boolean;
      requiresOutcome: true;
      outcome?: "solved" | "solved_after_reviewing_approach" | "failed";
    })
  | {
      id: string;
      date: string;
      activityClass: "focus_block";
      sessionId: string | null;
      type: "focus_block";
      focusCategory: string;
      title: string;
      allocatedSeconds: number;
      timer: TimerState | null;
      starred: false;
      requiresOutcome: false;
    };

export type VoiceTimerInstrument = {
  serverNow: number;
  workbenchId: string | null;
  workbenchRevision: number | null;
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  session: (SessionPayload & {
    label: string;
    allocatedSeconds: number;
    timer: TimerState;
  }) | null;
  sessions: Array<SessionPayload & {
    label: string;
    allocatedSeconds: number;
    timer: TimerState | null;
  }>;
  activity: VoiceTimerActivity | null;
  // Additive all-workbench projection for new clients. `activities` remains
  // the legacy focused-session slice until native Voice adopts this field.
  workbenchActivities: VoiceTimerActivity[];
  activities: VoiceTimerActivity[];
};

export type VoiceTimerTarget = {
  workbenchId: string;
  activity: VoiceTimerActivity;
  session: { id: string; activityIds: string[] } | null;
};

export async function readVoiceTimerTarget(
  ownerId: string,
  activityId: string,
): Promise<VoiceTimerTarget | null> {
  const db = getDb();
  const workbenchRows = await db
    .select()
    .from(practiceWorkbenches)
    .where(and(
      eq(practiceWorkbenches.ownerId, ownerId),
      eq(practiceWorkbenches.status, "open"),
    ))
    .orderBy(desc(practiceWorkbenches.openedAt))
    .limit(1);
  const workbench = workbenchRows[0];
  if (!workbench) return null;

  const [activityRows, focusBlockRows, sessionRows, timerRows] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, workbench.id),
      eq(extraActivities.id, activityId),
    )),
    db.select().from(focusBlocks).where(and(
      eq(focusBlocks.ownerId, ownerId),
      eq(focusBlocks.workbenchId, workbench.id),
      eq(focusBlocks.id, activityId),
    )),
    db.select().from(liveSessions).where(and(
      eq(liveSessions.ownerId, ownerId),
      eq(liveSessions.workbenchId, workbench.id),
    )),
    db.select().from(timers).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, activityId),
      eq(timers.kind, "activity"),
    )),
  ]);
  const timer = timerRows[0] ? toTimerState(timerRows[0]) : null;
  if (timer?.completed) return null;
  const sessionRow = sessionRows.find((row) => {
    const candidate = row.payload as SessionPayload;
    return Array.isArray(candidate.activityIds) && candidate.activityIds.includes(activityId);
  });
  const sessionPayload = sessionRow?.payload as SessionPayload | undefined;
  const focusBlock = focusBlockRows[0];
  if (focusBlock) {
    return {
      workbenchId: workbench.id,
      activity: {
        id: focusBlock.id,
        date: focusBlock.date,
        activityClass: "focus_block",
        sessionId: sessionRow?.id ?? null,
        type: "focus_block",
        focusCategory: focusBlock.category,
        title: focusBlock.title,
        allocatedSeconds: focusBlock.plannedSeconds,
        timer,
        starred: false,
        requiresOutcome: false,
      },
      session: sessionRow && sessionPayload
        ? { id: sessionRow.id, activityIds: sessionPayload.activityIds }
        : null,
    };
  }

  const activityRow = activityRows[0];
  const payload = activityRow?.payload as ActivityPayload | undefined;
  if (!activityRow || !isVoiceActivityPayload(payload)) return null;
  const questionId = typeof payload.questionId === "string" ? payload.questionId : undefined;
  return {
    workbenchId: workbench.id,
    activity: {
      ...payload,
      activityClass: "practice",
      sessionId: sessionRow?.id ?? null,
      type: payload.type,
      title: payload.title,
      questionId,
      url: typeof payload.url === "string" ? payload.url : undefined,
      allocatedSeconds: payload.allocatedSeconds,
      timer,
      starred: false,
      requiresOutcome: true,
    },
    session: sessionRow && sessionPayload
      ? { id: sessionRow.id, activityIds: sessionPayload.activityIds }
      : null,
  };
}

export async function readActiveVoiceActivity(ownerId: string): Promise<ActiveVoiceActivity | null> {
  const db = getDb();
  const activeTimerRows = await db
    .select()
    .from(timers)
    .where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.kind, "activity"),
      isNotNull(timers.runningSince),
      eq(timers.completed, false),
    ))
    .orderBy(desc(timers.updatedAt))
    .limit(1);
  const activeTimer = activeTimerRows[0];
  if (!activeTimer) return null;

  const activityRows = await db
    .select()
    .from(extraActivities)
    .where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.id, activeTimer.subjectId),
    ));
  const payload = activityRows[0]?.payload as ActivityPayload | undefined;
  if (!payload
      || !["leetcode", "system_design", "behavioral"].includes(String(payload.type))
      || typeof payload.title !== "string") {
    return null;
  }
  return {
    ...payload,
    type: payload.type as ActiveVoiceActivity["type"],
    title: payload.title,
    timer: toTimerState(activeTimer),
  };
}

function isVoiceActivityPayload(payload: ActivityPayload | undefined): payload is ActivityPayload & {
  type: ActiveVoiceActivity["type"];
  title: string;
  allocatedSeconds: number;
} {
  return Boolean(
    payload
    && ["leetcode", "system_design", "behavioral"].includes(String(payload.type))
    && typeof payload.title === "string"
    && typeof payload.allocatedSeconds === "number",
  );
}

export async function readVoiceTimerInstrument(ownerId: string): Promise<VoiceTimerInstrument> {
  const db = getDb();
  const [focusRows, workbenchRows] = await Promise.all([
    db.select().from(practiceFocus).where(eq(practiceFocus.ownerId, ownerId)),
    db
      .select()
      .from(practiceWorkbenches)
      .where(and(
        eq(practiceWorkbenches.ownerId, ownerId),
        eq(practiceWorkbenches.status, "open"),
      ))
      .orderBy(desc(practiceWorkbenches.openedAt))
      .limit(1),
  ]);
  const workbench = workbenchRows[0];
  if (!workbench) {
    return {
      serverNow: Date.now(),
      workbenchId: null,
      workbenchRevision: null,
      focusedActivityId: null,
      focusedSessionId: null,
      session: null,
      sessions: [],
      activity: null,
      workbenchActivities: [],
      activities: [],
    };
  }
  const [sessionRows, activityRows, focusBlockRows] = await Promise.all([
    db.select().from(liveSessions).where(and(
      eq(liveSessions.ownerId, ownerId),
      eq(liveSessions.workbenchId, workbench.id),
    )),
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, workbench.id),
    )),
    db.select().from(focusBlocks).where(and(
      eq(focusBlocks.ownerId, ownerId),
      eq(focusBlocks.workbenchId, workbench.id),
    )),
  ]);
  const subjectIds = [
    ...sessionRows.map((row) => row.id),
    ...activityRows.map((row) => row.id),
    ...focusBlockRows.map((row) => row.id),
  ];
  const questionIds = activityRows.flatMap((row) => {
    const questionId = (row.payload as ActivityPayload).questionId;
    return typeof questionId === "string" ? [questionId] : [];
  });
  const [timerRows, preferenceRows, outcomeRows] = await Promise.all([
    subjectIds.length
      ? db.select().from(timers).where(and(
          eq(timers.ownerId, ownerId),
          inArray(timers.subjectId, subjectIds),
        ))
      : Promise.resolve([]),
    questionIds.length
      ? db.select().from(problemPreferences).where(and(
          eq(problemPreferences.ownerId, ownerId),
          inArray(problemPreferences.questionId, questionIds),
        ))
      : Promise.resolve([]),
    activityRows.length
      ? db.select().from(outcomes).where(and(
          eq(outcomes.ownerId, ownerId),
          inArray(outcomes.activityId, activityRows.map((row) => row.id)),
        ))
      : Promise.resolve([]),
  ]);
  const focus = focusRows[0];
  const activityTimerById = new Map(
    timerRows
      .filter((row) => row.kind === "activity")
      .map((row) => [row.subjectId, toTimerState(row)]),
  );
  const sessionTimerById = new Map(
    timerRows
      .filter((row) => row.kind === "session")
      .map((row) => [row.subjectId, toTimerState(row)]),
  );
  const starredKeys = new Set(
    preferenceRows
      .filter((row) => row.starred)
      .map((row) => `${row.specialty}:${row.questionId}`),
  );
  const activityById = new Map(
    activityRows.map((row) => [row.id, row.payload as ActivityPayload]),
  );
  const focusBlockById = new Map(
    focusBlockRows.map((row) => [row.id, row]),
  );
  const outcomeByActivityId = new Map(
    outcomeRows.map((row) => [row.activityId, row.outcome]),
  );

  const runningSessionTimer = timerRows
    .filter((row) => row.kind === "session" && row.startedAt && !row.completed)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const focusedSessionTimer = focus?.sessionId
    ? sessionTimerById.get(focus.sessionId)
    : undefined;
  const sessionId = (
    focusedSessionTimer?.startedAt && !focusedSessionTimer.completed
      ? focus?.sessionId
      : runningSessionTimer?.subjectId
  ) ?? null;
  const sessionPayload = sessionId
    ? sessionRows.find((row) => row.id === sessionId)?.payload as SessionPayload | undefined
    : undefined;
  const sessionTimer = sessionId ? sessionTimerById.get(sessionId) : undefined;
  const session = (
    sessionPayload
    && sessionTimer?.startedAt
    && !sessionTimer.completed
    && typeof sessionPayload.label === "string"
    && typeof sessionPayload.allocatedSeconds === "number"
  )
    ? {
        ...sessionPayload,
        label: sessionPayload.label,
        allocatedSeconds: sessionPayload.allocatedSeconds,
        timer: sessionTimer,
      }
    : null;

  const sessions = sessionRows.flatMap((row) => {
    const payload = row.payload as SessionPayload;
    if (
      !Array.isArray(payload.activityIds)
      || typeof payload.label !== "string"
      || typeof payload.allocatedSeconds !== "number"
    ) return [];
    return [{
      ...payload,
      label: payload.label,
      allocatedSeconds: payload.allocatedSeconds,
      timer: sessionTimerById.get(row.id) ?? null,
    }];
  });
  const projection = voiceWorkbenchActivityProjection(
    sessions.map((candidate) => ({
      id: candidate.id,
      activityIds: candidate.activityIds,
    })),
    [...activityRows.map((row) => row.id), ...focusBlockRows.map((row) => row.id)],
  );
  const workbenchActivities: VoiceTimerActivity[] = projection.activityIds.flatMap<VoiceTimerActivity>((activityId) => {
    const payload = activityById.get(activityId);
    const focusBlock = focusBlockById.get(activityId);
    if (focusBlock) {
      const timer = activityTimerById.get(activityId) ?? null;
      return [{
        id: focusBlock.id,
        date: focusBlock.date,
        activityClass: "focus_block" as const,
        sessionId: projection.sessionIdByActivityId[activityId] ?? null,
        type: "focus_block" as const,
        focusCategory: focusBlock.category,
        title: focusBlock.title,
        allocatedSeconds: focusBlock.plannedSeconds,
        timer,
        starred: false as const,
        requiresOutcome: false as const,
      } satisfies VoiceTimerActivity];
    }
    if (!isVoiceActivityPayload(payload)) return [];
    const timer = activityTimerById.get(activityId) ?? null;
    const specialty = payload.type;
    const questionId = typeof payload.questionId === "string" ? payload.questionId : undefined;
    return [{
      ...payload,
      activityClass: "practice" as const,
      sessionId: projection.sessionIdByActivityId[activityId] ?? null,
      type: specialty,
      title: payload.title,
      questionId,
      url: typeof payload.url === "string" ? payload.url : undefined,
      allocatedSeconds: payload.allocatedSeconds,
      timer,
      starred: Boolean(questionId && starredKeys.has(`${specialty}:${questionId}`)),
      requiresOutcome: true as const,
      ...(outcomeByActivityId.get(activityId) ? {
        outcome: outcomeByActivityId.get(activityId) as "solved" | "solved_after_reviewing_approach" | "failed",
      } : {}),
    } satisfies VoiceTimerActivity];
  });
  const runningActivity = workbenchActivities.find((candidate) => candidate.timer?.runningSince) ?? null;
  const focusedActivity = focus?.activityId
    ? workbenchActivities.find((candidate) => candidate.id === focus.activityId) ?? null
    : null;
  const legacyActivityIds = session?.activityIds
    ?? (focus?.activityId ? [focus.activityId] : []);
  const activities = legacyActivityIds.flatMap((activityId) => {
    const activity = workbenchActivities.find((candidate) => candidate.id === activityId);
    return activity && !activity.timer?.completed ? [activity] : [];
  });

  return {
    serverNow: Date.now(),
    workbenchId: workbench.id,
    workbenchRevision: workbench.updatedAt,
    focusedActivityId: focus?.activityId ?? null,
    focusedSessionId: focus?.sessionId ?? null,
    session,
    sessions,
    activity: runningActivity ?? focusedActivity,
    workbenchActivities,
    activities,
  };
}

function toWorkbenchState(row: typeof practiceWorkbenches.$inferSelect): WorkbenchState {
  return {
    id: row.id,
    status: row.status,
    openedPacificDate: row.openedPacificDate,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    revision: row.updatedAt,
  };
}

function advanceWorkbenchRevision(
  db: Db,
  ownerId: string,
  workbenchId: string,
  nowMs: number,
) {
  return db.update(practiceWorkbenches).set({
    updatedAt: sql`CASE
      WHEN ${practiceWorkbenches.updatedAt} >= ${nowMs}
        THEN ${practiceWorkbenches.updatedAt} + 1
      ELSE ${nowMs}
    END`,
  }).where(and(
    eq(practiceWorkbenches.ownerId, ownerId),
    eq(practiceWorkbenches.id, workbenchId),
    eq(practiceWorkbenches.status, "open"),
  ));
}

export async function ensureOpenWorkbench(ownerId: string, date: string, nowMs = Date.now()) {
  const db = getDb();
  const rows = await db.select().from(practiceWorkbenches).where(eq(practiceWorkbenches.ownerId, ownerId));
  const current = rows
    .filter((row) => row.status === "open")
    .sort((left, right) => right.openedAt - left.openedAt)[0];
  if (current) return toWorkbenchState(current);

  const id = `workbench-${date}-${crypto.randomUUID()}`;
  await db.insert(practiceWorkbenches).values({
    ownerId,
    id,
    status: "open",
    openedPacificDate: date,
    openedAt: nowMs,
    closedAt: null,
    updatedAt: nowMs,
  });

  // One-time legacy adoption: rows created before workbenches existed become
  // part of the first open workbench instead of disappearing after migration.
  await db
    .update(extraActivities)
    .set({ workbenchId: id, updatedAt: nowMs })
    .where(and(eq(extraActivities.ownerId, ownerId), isNull(extraActivities.workbenchId)));
  await db
    .update(liveSessions)
    .set({ workbenchId: id, updatedAt: nowMs })
    .where(and(eq(liveSessions.ownerId, ownerId), isNull(liveSessions.workbenchId)));

  return { id, status: "open" as const, openedPacificDate: date, openedAt: nowMs, closedAt: null, revision: nowMs };
}

export async function readLiveState(
  ownerId: string,
  date: string,
  options: { includeAll?: boolean } = {},
): Promise<LiveState> {
  const db = getDb();
  const workbench = await ensureOpenWorkbench(ownerId, date);
  const [timerRows, outcomeRows, publicationRows, noteRows, extraRows, focusBlockRows, sessionRows, focusRows] = await Promise.all([
    db.select().from(timers).where(eq(timers.ownerId, ownerId)),
    db.select().from(outcomes).where(eq(outcomes.ownerId, ownerId)),
    db.select().from(publicationStatuses).where(eq(publicationStatuses.ownerId, ownerId)),
    db.select().from(activityNotes).where(eq(activityNotes.ownerId, ownerId)),
    db.select().from(extraActivities).where(eq(extraActivities.ownerId, ownerId)),
    db.select().from(focusBlocks).where(eq(focusBlocks.ownerId, ownerId)),
    db.select().from(liveSessions).where(eq(liveSessions.ownerId, ownerId)),
    db.select().from(practiceFocus).where(eq(practiceFocus.ownerId, ownerId)),
  ]);

  const activityTimers: Record<string, TimerState> = {};
  const sessionTimers: Record<string, TimerState> = {};
  for (const row of timerRows) {
    (row.kind === "session" ? sessionTimers : activityTimers)[row.subjectId] = toTimerState(row);
  }

  const workbenchSessionRows = options.includeAll
    ? sessionRows
    : sessionRows.filter((row) => row.workbenchId === workbench.id);
  const allSessions = workbenchSessionRows.map((row: LiveSessionRow) => row.payload as SessionPayload);

  const visibleSessions = allSessions;
  const workbenchExtraRows = options.includeAll
    ? extraRows
    : extraRows.filter((row) => row.workbenchId === workbench.id);
  const allActivities = workbenchExtraRows.map((row: ExtraActivityRow) => row.payload as ActivityPayload);
  const visibleActivities = allActivities;
  const historySessions = sessionRows.map((row: LiveSessionRow) => row.payload as SessionPayload);
  const historyActivities = extraRows.map((row: ExtraActivityRow) => row.payload as ActivityPayload);
  const visibleFocusBlocks = (options.includeAll
    ? focusBlockRows
    : focusBlockRows.filter((row) => row.workbenchId === workbench.id))
    .map(toFocusBlock);
  const historyFocusBlocks = focusBlockRows.map(toFocusBlock);
  const historyActivityIds = new Set(historyActivities.map((activity) => activity.id));
  const durable = await readDurablePracticeSummary(ownerId, [...historyActivityIds], date);

  const outcomeMap: Record<string, OutcomeValue> = {};
  const outcomeRevisionMap: Record<string, number> = {};
  for (const row of outcomeRows) {
    outcomeMap[row.activityId] = row.outcome as OutcomeValue;
    outcomeRevisionMap[row.activityId] = row.revision;
  }

  const publicationMap: Record<string, PublicationStatusValue> = {};
  for (const row of publicationRows) {
    if (options.includeAll || row.date === date || historyActivityIds.has(row.activityId)) {
      publicationMap[row.activityId] = row.status as PublicationStatusValue;
    }
  }

  const noteMap: Record<string, string> = {};
  for (const row of noteRows) {
    if (options.includeAll || row.date === date || historyActivityIds.has(row.activityId)) noteMap[row.activityId] = row.note;
  }

  const focus = focusRows[0];

  return {
    serverNow: Date.now(),
    workbench,
    timers: activityTimers,
    sessionTimers,
    outcomes: outcomeMap,
    outcomeRevisions: outcomeRevisionMap,
    publicationStatuses: publicationMap,
    notes: noteMap,
    structuredNotes: durable.notes,
    reviews: durable.reviews,
    finalizations: Object.fromEntries(Object.entries(durable.finalizations).map(([activityId, row]) => [activityId, {
      activityId,
      specialty: row.specialty,
      status: row.status,
      finalizedAt: row.finalizedAt,
    }])),
    audioClips: Object.fromEntries(Object.entries(durable.audioClips).map(([activityId, rows]) => [activityId, rows.map((row) => ({
      id: row.id,
      activityId,
      transcriptTurnId: row.transcriptTurnId,
      filename: row.filename,
      mimeType: row.mimeType,
      label: row.label,
      durationSeconds: row.durationSeconds,
      status: row.status,
    }))])),
    deliveryAnalyses: Object.fromEntries(Object.entries(durable.deliveryAnalyses).map(([activityId, rows]) => [activityId, rows.map((row) => ({
      id: row.id,
      activityId,
      audioClipId: row.audioClipId,
      transcriptTurnId: row.transcriptTurnId,
      specialty: row.specialty,
      status: row.status,
      payload: row.payload,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))])),
    problemPreferences: durable.problemPreferences,
    solutionProfiles: durable.solutionProfiles,
    solutionRevisions: durable.solutionRevisions,
    activitySolutionLinks: durable.activitySolutionLinks,
    personalQuestions: durable.personalQuestions,
    extraActivities: visibleActivities,
    focusBlocks: visibleFocusBlocks,
    sessions: visibleSessions,
    historyActivities,
    historyFocusBlocks,
    historySessions,
    focusedActivityId: focus?.activityId ?? null,
    focusedSessionId: focus?.sessionId ?? null,
    focusedAt: focus?.focusedAt ?? null,
  };
}

export async function readTimerSyncState(ownerId: string): Promise<TimerSyncState> {
  const db = getDb();
  const [timerRows, focusRows] = await Promise.all([
    db.select().from(timers).where(eq(timers.ownerId, ownerId)),
    db.select().from(practiceFocus).where(eq(practiceFocus.ownerId, ownerId)),
  ]);

  const activityTimers: Record<string, TimerState> = {};
  const sessionTimers: Record<string, TimerState> = {};
  for (const row of timerRows) {
    (row.kind === "session" ? sessionTimers : activityTimers)[row.subjectId] = toTimerState(row);
  }
  const focus = focusRows[0];

  return {
    serverNow: Date.now(),
    timers: activityTimers,
    sessionTimers,
    focusedActivityId: focus?.activityId ?? null,
    focusedSessionId: focus?.sessionId ?? null,
    focusedAt: focus?.focusedAt ?? null,
  };
}

async function loadTimer(db: Db, ownerId: string, subjectId: string, kind: TimerKind) {
  const rows = await db
    .select()
    .from(timers)
    .where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, subjectId), eq(timers.kind, kind)));
  return rows[0];
}

async function setPracticeFocus(
  ownerId: string,
  activityId: string | null,
  sessionId: string | null,
  nowMs: number,
) {
  const db = getDb();
  await db
    .insert(practiceFocus)
    .values({ ownerId, activityId, sessionId, focusedAt: nowMs, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: practiceFocus.ownerId,
      set: { activityId, sessionId, focusedAt: nowMs, updatedAt: nowMs },
    });
}

async function focusSession(ownerId: string, sessionId: string, activityIds: string[], nowMs: number) {
  const db = getDb();
  const rows = await db.select().from(practiceFocus).where(eq(practiceFocus.ownerId, ownerId));
  const currentActivityId = rows[0]?.activityId;
  await setPracticeFocus(
    ownerId,
    currentActivityId && activityIds.includes(currentActivityId) ? currentActivityId : null,
    sessionId,
    nowMs,
  );
}

async function openTimerInterval(ownerId: string, subjectId: string, kind: TimerKind, nowMs: number) {
  const db = getDb();
  await db.insert(timerIntervals).values({ ownerId, subjectId, kind, startedAt: nowMs }).onConflictDoNothing();
}

async function closeTimerInterval(ownerId: string, subjectId: string, kind: TimerKind, nowMs: number) {
  const db = getDb();
  await db
    .update(timerIntervals)
    .set({ endedAt: nowMs })
    .where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.subjectId, subjectId),
      eq(timerIntervals.kind, kind),
      isNull(timerIntervals.endedAt),
    ));
}

export async function applyTimerAction(
  ownerId: string,
  subjectId: string,
  kind: TimerKind,
  action: TimerAction,
  nowMs: number,
  options: {
    sessionId?: string | null;
    activityIds?: string[];
    requiresOutcome?: boolean;
    expectedRevision?: number;
  } = {},
): Promise<TimerState> {
  const db = getDb();
  const existing = await loadTimer(db, ownerId, subjectId, kind);
  if (
    options.expectedRevision != null
    && (existing?.revision ?? 0) !== options.expectedRevision
  ) {
    throw new TimerStateConflictError(
      "The timer changed in another surface. Read Today again before retrying.",
    );
  }

  // Finished timers are locked permanently and never resume.
  if (existing?.completed) return toTimerState(existing);

  if (action === "finish" && kind === "activity" && options.requiresOutcome !== false) {
    const voiceGuard = await prepareVoiceCapturesForFinish(ownerId, subjectId, nowMs);
    const voiceConflict = voiceFinishGuardMessage(voiceGuard);
    if (voiceConflict) throw new TimerStateConflictError(voiceConflict);
    const result = await db
      .select()
      .from(outcomes)
      .where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, subjectId)));
    if (!result[0]) {
      throw new TimerStateConflictError("Choose Solved, Solved with help, or Failed before finishing this activity.");
    }
  }

  if (action === "start" && kind === "activity" && options.sessionId) {
    const parent = await loadTimer(db, ownerId, options.sessionId, "session");
    if (parent?.completed) {
      throw new TimerStateConflictError("This session is already finished.");
    }
    if (parent?.startedAt && !parent.runningSince) {
      const sessionRows = await db
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.id, options.sessionId)));
      const session = sessionRows[0]?.payload as SessionPayload | undefined;
      await applyTimerAction(ownerId, options.sessionId, "session", "start", nowMs, {
        activityIds: session?.activityIds ?? [],
      });
    }
  }

  if (action === "finish" && kind === "session") {
    const sessionRows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.id, subjectId)));
    const storedSession = sessionRows[0]?.payload as SessionPayload | undefined;
    const activityIds = storedSession?.activityIds ?? [];
    const focusBlockIds = new Set(activityIds.length
      ? (await db.select({ id: focusBlocks.id }).from(focusBlocks).where(and(
          eq(focusBlocks.ownerId, ownerId),
          inArray(focusBlocks.id, activityIds),
        ))).map((row) => row.id)
      : []);
    const missingResults: string[] = [];
    for (const activityId of activityIds) {
      const child = await loadTimer(db, ownerId, activityId, "activity");
      if (!child?.startedAt) continue;
      if (focusBlockIds.has(activityId)) continue;
      const voiceGuard = await prepareVoiceCapturesForFinish(ownerId, activityId, nowMs);
      const voiceConflict = voiceFinishGuardMessage(voiceGuard);
      if (voiceConflict) throw new TimerStateConflictError(voiceConflict);
      const result = await db
        .select()
        .from(outcomes)
        .where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, activityId)));
      if (!result[0]) missingResults.push(activityId);
    }
    if (missingResults.length) {
      throw new TimerStateConflictError(`Choose a result for ${missingResults.length === 1 ? "the started activity" : "every started activity"} before finishing this session.`);
    }
    for (const activityId of activityIds) {
      const child = await loadTimer(db, ownerId, activityId, "activity");
      if (child?.startedAt && !child.completed) {
        await applyTimerAction(ownerId, activityId, "activity", "finish", nowMs, {
          requiresOutcome: !focusBlockIds.has(activityId),
        });
      }
    }
  }

  // A duplicated start from another surface keeps the original segment intact.
  if (action === "start" && existing?.runningSince) {
    if (kind === "activity") await setPracticeFocus(ownerId, subjectId, options.sessionId ?? null, nowMs);
    else await setPracticeFocus(ownerId, null, subjectId, nowMs);
    return toTimerState(existing);
  }

  const next = nextTimerState(existing, action, nowMs);

  if (action === "start") {
    // Enforce the single-active-stopwatch rule server-side so the main tab and
    // the pop-out window can never both drive two activity clocks at once.
    if (kind === "activity") {
      await pauseOtherActivityTimers(ownerId, subjectId, nowMs);
      if (!options.sessionId) await pauseAllSessionTimers(ownerId, nowMs);
      await setPracticeFocus(ownerId, subjectId, options.sessionId ?? null, nowMs);
    } else {
      await pauseOtherSessionTimers(ownerId, subjectId, nowMs);
      await pauseActivityTimersOutside(ownerId, options.activityIds ?? [], nowMs);
      await focusSession(ownerId, subjectId, options.activityIds ?? [], nowMs);
    }
    await openTimerInterval(ownerId, subjectId, kind, nowMs);
    await db
      .insert(timers)
      .values({
        ownerId,
        subjectId,
        kind,
        accumulatedSeconds: next.accumulatedSeconds,
        startedAt: existing?.startedAt ?? nowMs,
        runningSince: next.runningSince,
        completed: false,
        revision: next.revision,
        updatedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [timers.ownerId, timers.subjectId, timers.kind],
        set: {
          startedAt: existing?.startedAt ?? nowMs,
          runningSince: next.runningSince,
          completed: false,
          revision: next.revision,
          updatedAt: nowMs,
        },
        ...(options.expectedRevision != null
          ? { setWhere: eq(timers.revision, options.expectedRevision) }
          : {}),
      });
  } else {
    await closeTimerInterval(ownerId, subjectId, kind, nowMs);
    if (kind === "session" && options.activityIds?.length) {
      await pauseActivityTimers(ownerId, options.activityIds, nowMs);
    }
    await db
      .insert(timers)
      .values({
        ownerId,
        subjectId,
        kind,
        accumulatedSeconds: next.accumulatedSeconds,
        startedAt: existing?.startedAt ?? (action === "finish" ? nowMs : null),
        runningSince: null,
        completed: next.completed,
        completedAt: next.completed ? nowMs : null,
        revision: next.revision,
        updatedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [timers.ownerId, timers.subjectId, timers.kind],
        set: {
          accumulatedSeconds: next.accumulatedSeconds,
          startedAt: existing?.startedAt ?? (action === "finish" ? nowMs : null),
          runningSince: null,
          completed: next.completed,
          completedAt: next.completed ? nowMs : null,
          revision: next.revision,
          updatedAt: nowMs,
        },
        ...(options.expectedRevision != null
          ? { setWhere: eq(timers.revision, options.expectedRevision) }
          : {}),
      });
  }

  const updated = await loadTimer(db, ownerId, subjectId, kind);
  if (
    options.expectedRevision != null
    && (!updated || updated.revision !== next.revision || updated.updatedAt !== nowMs)
  ) {
    throw new TimerStateConflictError(
      "The timer changed in another surface. Read Today again before retrying.",
    );
  }
  if (kind === "activity" && action === "finish" && options.sessionId) {
    const sessionRows = await db.select().from(liveSessions).where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.id, options.sessionId)));
    const session = sessionRows[0]?.payload as SessionPayload | undefined;
    if (session?.activityIds.length) {
      const activityStates = await Promise.all(session.activityIds.map((activityId) => loadTimer(db, ownerId, activityId, "activity")));
      if (activityStates.every((timer) => timer?.completed)) {
        await applyTimerAction(ownerId, options.sessionId, "session", "finish", nowMs, { activityIds: session.activityIds });
      }
    }
  }
  return toTimerState(updated!);
}

export async function applyFocusTimerAction(
  ownerId: string,
  subjectId: string,
  action: TimerAction,
  nowMs: number,
  sessionId?: string | null,
) {
  const db = getDb();
  const rows = await db.select({ id: focusBlocks.id }).from(focusBlocks).where(and(
    eq(focusBlocks.ownerId, ownerId),
    eq(focusBlocks.id, subjectId),
  ));
  if (!rows[0]) throw new TimerStateConflictError("This career focus block no longer exists.");
  return applyTimerAction(ownerId, subjectId, "activity", action, nowMs, {
    requiresOutcome: false,
    sessionId,
  });
}

// Voice locks its destination when recording begins. This check deliberately
// consults immutable timer intervals rather than the current focus row, so a
// valid recording can finish after the user pauses the stopwatch while stale
// recordings can never attach to an unrelated or completed activity.
export async function activityTimerWasRunningAt(ownerId: string, activityId: string, occurredAt: number) {
  const db = getDb();
  const intervals = await db
    .select()
    .from(timerIntervals)
    .where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.subjectId, activityId),
      eq(timerIntervals.kind, "activity"),
    ));
  return intervals.some((interval) => interval.startedAt <= occurredAt
    && (interval.endedAt == null || occurredAt <= interval.endedAt));
}

export async function pauseOtherActivityTimers(ownerId: string, exceptSubjectId: string, nowMs: number) {
  const db = getDb();
  const running = await db
    .select()
    .from(timers)
    .where(
      and(
        eq(timers.ownerId, ownerId),
        eq(timers.kind, "activity"),
        isNotNull(timers.runningSince),
        ne(timers.subjectId, exceptSubjectId),
      ),
    );
  for (const row of running) {
    const folded = foldElapsed(row.accumulatedSeconds, row.runningSince, nowMs);
    await closeTimerInterval(ownerId, row.subjectId, "activity", nowMs);
    await db
      .update(timers)
      .set({ accumulatedSeconds: folded, runningSince: null, revision: row.revision + 1, updatedAt: nowMs })
      .where(
        and(eq(timers.ownerId, ownerId), eq(timers.subjectId, row.subjectId), eq(timers.kind, "activity")),
      );
  }
}

export async function pauseOtherSessionTimers(ownerId: string, exceptSubjectId: string, nowMs: number) {
  const db = getDb();
  const running = await db
    .select()
    .from(timers)
    .where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.kind, "session"),
      isNotNull(timers.runningSince),
      ne(timers.subjectId, exceptSubjectId),
    ));
  for (const row of running) {
    const folded = foldElapsed(row.accumulatedSeconds, row.runningSince, nowMs);
    await closeTimerInterval(ownerId, row.subjectId, "session", nowMs);
    await db
      .update(timers)
      .set({ accumulatedSeconds: folded, runningSince: null, revision: row.revision + 1, updatedAt: nowMs })
      .where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, row.subjectId), eq(timers.kind, "session")));
  }
}

export async function pauseAllSessionTimers(ownerId: string, nowMs: number) {
  const db = getDb();
  const running = await db
    .select()
    .from(timers)
    .where(and(eq(timers.ownerId, ownerId), eq(timers.kind, "session"), isNotNull(timers.runningSince)));
  for (const row of running) {
    const folded = foldElapsed(row.accumulatedSeconds, row.runningSince, nowMs);
    await closeTimerInterval(ownerId, row.subjectId, "session", nowMs);
    await db
      .update(timers)
      .set({ accumulatedSeconds: folded, runningSince: null, revision: row.revision + 1, updatedAt: nowMs })
      .where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, row.subjectId), eq(timers.kind, "session")));
  }
}

export async function pauseActivityTimers(ownerId: string, activityIds: string[], nowMs: number) {
  const db = getDb();
  const allowed = new Set(activityIds);
  const running = await db
    .select()
    .from(timers)
    .where(and(eq(timers.ownerId, ownerId), eq(timers.kind, "activity"), isNotNull(timers.runningSince)));
  for (const row of running) {
    if (!allowed.has(row.subjectId)) continue;
    const folded = foldElapsed(row.accumulatedSeconds, row.runningSince, nowMs);
    await closeTimerInterval(ownerId, row.subjectId, "activity", nowMs);
    await db
      .update(timers)
      .set({ accumulatedSeconds: folded, runningSince: null, revision: row.revision + 1, updatedAt: nowMs })
      .where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, row.subjectId), eq(timers.kind, "activity")));
  }
}

export async function pauseActivityTimersOutside(ownerId: string, activityIds: string[], nowMs: number) {
  const db = getDb();
  const allowed = new Set(activityIds);
  const running = await db
    .select()
    .from(timers)
    .where(and(eq(timers.ownerId, ownerId), eq(timers.kind, "activity"), isNotNull(timers.runningSince)));
  for (const row of running) {
    if (allowed.has(row.subjectId)) continue;
    const folded = foldElapsed(row.accumulatedSeconds, row.runningSince, nowMs);
    await closeTimerInterval(ownerId, row.subjectId, "activity", nowMs);
    await db
      .update(timers)
      .set({ accumulatedSeconds: folded, runningSince: null, revision: row.revision + 1, updatedAt: nowMs })
      .where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, row.subjectId), eq(timers.kind, "activity")));
  }
}

export async function setOutcome(
  ownerId: string,
  activityId: string,
  outcome: OutcomeValue | null,
  nowMs: number,
) {
  const db = getDb();
  const timer = await loadTimer(db, ownerId, activityId, "activity");
  if (!timer?.startedAt) {
    throw new TimerStateConflictError("Start the activity stopwatch before choosing a result.");
  }
  const publication = await db
    .select()
    .from(publicationStatuses)
    .where(and(eq(publicationStatuses.ownerId, ownerId), eq(publicationStatuses.activityId, activityId)));
  if (publication[0]?.status === "published") {
    throw new TimerStateConflictError("Published results are read-only.");
  }
  if (!outcome) {
    await db.delete(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, activityId)));
    return;
  }
  await db
    .insert(outcomes)
    .values({ ownerId, activityId, outcome, revision: 1, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: [outcomes.ownerId, outcomes.activityId],
      set: { outcome, updatedAt: nowMs },
    });
}

export async function setPublicationStatus(
  ownerId: string,
  activityId: string,
  date: string,
  status: PublicationStatusValue,
  nowMs: number,
  artifactPath?: string | null,
) {
  const db = getDb();
  if (status === "published") {
    const [timer, result] = await Promise.all([
      loadTimer(db, ownerId, activityId, "activity"),
      db.select().from(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, activityId))),
    ]);
    if (!timer?.startedAt || !timer.completed || !result[0]?.outcome) {
      throw new TimerStateConflictError(
        "Publication requires a finished activity with an explicit result.",
      );
    }
  }
  await db
    .insert(publicationStatuses)
    .values({
      ownerId,
      activityId,
      date,
      status,
      artifactPath: artifactPath ?? null,
      publishedAt: status === "published" ? nowMs : null,
      revision: 1,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [publicationStatuses.ownerId, publicationStatuses.activityId],
      set: {
        date,
        status,
        artifactPath: artifactPath ?? null,
        publishedAt: status === "published" ? nowMs : null,
        revision: sql`${publicationStatuses.revision} + 1`,
        updatedAt: nowMs,
      },
    });
}

export async function setActivityNote(
  ownerId: string,
  activityId: string,
  date: string,
  note: string,
  nowMs: number,
) {
  const db = getDb();
  await db
    .insert(activityNotes)
    .values({ ownerId, activityId, date, note, revision: 1, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: [activityNotes.ownerId, activityNotes.activityId],
      set: { date, note, revision: sql`${activityNotes.revision} + 1`, updatedAt: nowMs },
    });
}

export async function upsertExtraActivity(
  ownerId: string,
  activity: { id: string; date: string } & Record<string, unknown>,
  nowMs: number,
) {
  const db = getDb();
  const workbench = await ensureOpenWorkbench(ownerId, activity.date, nowMs);
  const payload = { ...activity, workbenchId: workbench.id };
  const upsert = db.insert(extraActivities)
    .values({
      ownerId,
      id: activity.id,
      date: activity.date,
      workbenchId: workbench.id,
      payload,
      revision: 1,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [extraActivities.ownerId, extraActivities.id],
      set: { date: activity.date, workbenchId: workbench.id, payload, updatedAt: nowMs },
    });
  await db.batch([upsert, advanceWorkbenchRevision(db, ownerId, workbench.id, nowMs)]);
}

export async function upsertFocusBlock(
  ownerId: string,
  input: {
    id: string;
    date: string;
    focusCategory: "job_applications";
    title: string;
    plannedSeconds: number;
    note?: string;
  },
  nowMs: number,
) {
  const db = getDb();
  const existingTimer = await loadTimer(db, ownerId, input.id, "activity");
  if (existingTimer?.completed) {
    throw new TimerStateConflictError("Completed career focus blocks are locked.");
  }
  const workbench = await ensureOpenWorkbench(ownerId, input.date, nowMs);
  const existing = await db.select().from(focusBlocks).where(and(
    eq(focusBlocks.ownerId, ownerId),
    eq(focusBlocks.id, input.id),
  ));
  const upsert = db.insert(focusBlocks).values({
    ownerId,
    id: input.id,
    workbenchId: workbench.id,
    date: input.date,
    category: input.focusCategory,
    title: input.title,
    plannedSeconds: input.plannedSeconds,
    note: input.note?.trim() || null,
    createdAt: existing[0]?.createdAt ?? nowMs,
    updatedAt: nowMs,
  }).onConflictDoUpdate({
    target: [focusBlocks.ownerId, focusBlocks.id],
    set: {
      workbenchId: workbench.id,
      date: input.date,
      category: input.focusCategory,
      title: input.title,
      plannedSeconds: input.plannedSeconds,
      note: input.note?.trim() || null,
      updatedAt: nowMs,
    },
  });
  await db.batch([upsert, advanceWorkbenchRevision(db, ownerId, workbench.id, nowMs)]);
}

export async function removeFocusBlock(ownerId: string, id: string) {
  const db = getDb();
  const timer = await loadTimer(db, ownerId, id, "activity");
  if (timer?.startedAt) {
    throw new TimerStateConflictError("Only an untouched career focus block can be removed. Started time stays in Career Work.");
  }
  await db.delete(focusBlocks).where(and(eq(focusBlocks.ownerId, ownerId), eq(focusBlocks.id, id)));
  await db.delete(timers).where(and(
    eq(timers.ownerId, ownerId),
    eq(timers.subjectId, id),
    eq(timers.kind, "activity"),
  ));
}

export async function removeExtraActivity(ownerId: string, id: string) {
  const db = getDb();
  const [
    timer,
    result,
    publication,
    transcript,
    finalization,
    audio,
    notes,
    delivery,
    reviews,
    intervals,
    codeAttempts,
    captureIntents,
  ] = await Promise.all([
    loadTimer(db, ownerId, id, "activity"),
    db.select().from(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, id))),
    db.select().from(publicationStatuses).where(and(eq(publicationStatuses.ownerId, ownerId), eq(publicationStatuses.activityId, id))),
    db.select().from(practiceTranscriptTurns).where(and(eq(practiceTranscriptTurns.ownerId, ownerId), eq(practiceTranscriptTurns.activityId, id))),
    db.select().from(activityFinalizations).where(and(eq(activityFinalizations.ownerId, ownerId), eq(activityFinalizations.activityId, id))),
    db.select().from(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.activityId, id))),
    db.select().from(practiceNotes).where(and(eq(practiceNotes.ownerId, ownerId), eq(practiceNotes.activityId, id))),
    db.select().from(activityDeliveryAnalyses).where(and(eq(activityDeliveryAnalyses.ownerId, ownerId), eq(activityDeliveryAnalyses.activityId, id))),
    db.select().from(reviewSchedules).where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.activityId, id))),
    db.select().from(timerIntervals).where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.subjectId, id),
      eq(timerIntervals.kind, "activity"),
    )),
    db.select().from(leetcodeCodeAttempts).where(and(eq(leetcodeCodeAttempts.ownerId, ownerId), eq(leetcodeCodeAttempts.activityId, id))),
    db.select().from(voiceCaptureIntents).where(and(eq(voiceCaptureIntents.ownerId, ownerId), eq(voiceCaptureIntents.activityId, id))),
  ]);
  if (
    timer?.startedAt ||
    result.length ||
    publication.length ||
    transcript.length ||
    finalization.length ||
    audio.length ||
    notes.length ||
    delivery.length ||
    reviews.length ||
    intervals.length ||
    codeAttempts.length ||
    captureIntents.length
  ) {
    throw new TimerStateConflictError("Only an untouched activity can be removed. Started work stays in your history.");
  }
  await db.delete(extraActivities).where(and(eq(extraActivities.ownerId, ownerId), eq(extraActivities.id, id)));
  await db.delete(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, id)));
  await db.delete(publicationStatuses).where(and(eq(publicationStatuses.ownerId, ownerId), eq(publicationStatuses.activityId, id)));
  await db.delete(activityNotes).where(and(eq(activityNotes.ownerId, ownerId), eq(activityNotes.activityId, id)));
  await db.delete(practiceNotes).where(and(eq(practiceNotes.ownerId, ownerId), eq(practiceNotes.activityId, id)));
  await db.delete(practiceTranscriptTurns).where(and(eq(practiceTranscriptTurns.ownerId, ownerId), eq(practiceTranscriptTurns.activityId, id)));
  await db.delete(activityFinalizations).where(and(eq(activityFinalizations.ownerId, ownerId), eq(activityFinalizations.activityId, id)));
  await db.delete(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.activityId, id)));
  await db.delete(activityDeliveryAnalyses).where(and(eq(activityDeliveryAnalyses.ownerId, ownerId), eq(activityDeliveryAnalyses.activityId, id)));
  await db.delete(reviewSchedules).where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.activityId, id)));
  await db.delete(leetcodeCodeAttempts).where(and(eq(leetcodeCodeAttempts.ownerId, ownerId), eq(leetcodeCodeAttempts.activityId, id)));
  await db.delete(voiceCaptureIntents).where(and(eq(voiceCaptureIntents.ownerId, ownerId), eq(voiceCaptureIntents.activityId, id)));
  await db.delete(timers).where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, id), eq(timers.kind, "activity")));
  await db.delete(timerIntervals).where(and(eq(timerIntervals.ownerId, ownerId), eq(timerIntervals.subjectId, id), eq(timerIntervals.kind, "activity")));
  await db
    .update(practiceFocus)
    .set({ activityId: null, updatedAt: Date.now() })
    .where(and(eq(practiceFocus.ownerId, ownerId), eq(practiceFocus.activityId, id)));
}

export async function upsertLiveSession(
  ownerId: string,
  session: { id: string; date: string } & Record<string, unknown>,
  nowMs: number,
) {
  const db = getDb();
  const workbench = await ensureOpenWorkbench(ownerId, session.date, nowMs);
  const payload = { ...session, workbenchId: workbench.id };
  const upsert = db.insert(liveSessions)
    .values({
      ownerId,
      id: session.id,
      date: session.date,
      workbenchId: workbench.id,
      payload,
      revision: 1,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [liveSessions.ownerId, liveSessions.id],
      set: { date: session.date, workbenchId: workbench.id, payload, updatedAt: nowMs },
    });
  await db.batch([upsert, advanceWorkbenchRevision(db, ownerId, workbench.id, nowMs)]);
}

export async function startFreshWorkbench(
  ownerId: string,
  date: string,
  nowMs: number,
  requestedId?: string,
) {
  const db = getDb();
  const current = await ensureOpenWorkbench(ownerId, date, nowMs);
  const [activityRows, focusRows, sessionRows] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, current.id),
    )),
    db.select().from(focusBlocks).where(and(
      eq(focusBlocks.ownerId, ownerId),
      eq(focusBlocks.workbenchId, current.id),
    )),
    db.select().from(liveSessions).where(and(
      eq(liveSessions.ownerId, ownerId),
      eq(liveSessions.workbenchId, current.id),
    )),
  ]);

  const missingResults: string[] = [];
  for (const row of activityRows) {
    const timer = await loadTimer(db, ownerId, row.id, "activity");
    if (timer?.startedAt) {
      const result = await db
        .select()
        .from(outcomes)
        .where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, row.id)));
      if (!result[0]) missingResults.push(row.id);
    }
  }
  if (missingResults.length) {
    throw new TimerStateConflictError(`Choose a result for ${missingResults.length === 1 ? "the started activity" : "every started activity"} before starting a fresh day.`);
  }

  for (const row of activityRows) {
    const timer = await loadTimer(db, ownerId, row.id, "activity");
    if (timer?.startedAt && !timer.completed) {
      await applyTimerAction(ownerId, row.id, "activity", "finish", nowMs);
    }
  }
  for (const row of focusRows) {
    const timer = await loadTimer(db, ownerId, row.id, "activity");
    if (timer?.startedAt && !timer.completed) {
      await applyTimerAction(ownerId, row.id, "activity", "finish", nowMs, { requiresOutcome: false });
    }
  }
  for (const row of sessionRows) {
    const timer = await loadTimer(db, ownerId, row.id, "session");
    const payload = row.payload as SessionPayload;
    if (timer?.startedAt && !timer.completed) {
      await applyTimerAction(ownerId, row.id, "session", "finish", nowMs, {
        activityIds: payload.activityIds,
      });
    }
  }
  await setPracticeFocus(ownerId, null, null, nowMs);
  await db
    .update(practiceWorkbenches)
    .set({ status: "archived", closedAt: nowMs, updatedAt: nowMs })
    .where(and(
      eq(practiceWorkbenches.ownerId, ownerId),
      eq(practiceWorkbenches.id, current.id),
    ));

  const id = requestedId || `workbench-${date}-${crypto.randomUUID()}`;
  await db.insert(practiceWorkbenches).values({
    ownerId,
    id,
    status: "open",
    openedPacificDate: date,
    openedAt: nowMs,
    closedAt: null,
    updatedAt: nowMs,
  });
  return { id, status: "open" as const, openedPacificDate: date, openedAt: nowMs, closedAt: null, revision: nowMs };
}

export async function rolloverPublishedWorkbench(ownerId: string, date: string, nowMs: number) {
  const db = getDb();
  const current = await ensureOpenWorkbench(ownerId, date, nowMs);
  const activityRows = await db.select().from(extraActivities).where(and(
    eq(extraActivities.ownerId, ownerId),
    eq(extraActivities.workbenchId, current.id),
  ));
  const startedIds: string[] = [];
  for (const row of activityRows) {
    const timer = await loadTimer(db, ownerId, row.id, "activity");
    if (!timer?.startedAt) continue;
    if (!timer.completed) return false;
    const result = await db.select().from(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, row.id)));
    const publication = await db.select().from(publicationStatuses).where(and(eq(publicationStatuses.ownerId, ownerId), eq(publicationStatuses.activityId, row.id)));
    if (!result[0] || publication[0]?.status !== "published") return false;
    startedIds.push(row.id);
  }
  if (!startedIds.length) return false;
  await startFreshWorkbench(ownerId, date, nowMs);
  return true;
}

export async function removeLiveSession(ownerId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.id, id)));
  const session = rows[0]?.payload as SessionPayload | undefined;
  if (!session) return;
  const sessionTimer = await loadTimer(db, ownerId, id, "session");
  if (sessionTimer?.startedAt) {
    throw new TimerStateConflictError("Only an untouched session can be removed. Started work stays in your history.");
  }
  for (const activityId of session.activityIds) {
    const child = await loadTimer(db, ownerId, activityId, "activity");
    if (child?.startedAt) {
      throw new TimerStateConflictError("Only an untouched session can be removed. Started work stays in your history.");
    }
  }
  await db.delete(liveSessions).where(and(eq(liveSessions.ownerId, ownerId), eq(liveSessions.id, id)));
  await db.delete(timers).where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, id), eq(timers.kind, "session")));
  await db.delete(timerIntervals).where(and(eq(timerIntervals.ownerId, ownerId), eq(timerIntervals.subjectId, id), eq(timerIntervals.kind, "session")));
  await db
    .update(practiceFocus)
    .set({ sessionId: null, updatedAt: Date.now() })
    .where(and(eq(practiceFocus.ownerId, ownerId), eq(practiceFocus.sessionId, id)));
  for (const activityId of session.activityIds) {
    await removeExtraActivity(ownerId, activityId);
  }
}

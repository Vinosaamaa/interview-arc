import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  activityNotes,
  activityAudioClips,
  activityDeliveryAnalyses,
  activityFinalizations,
  extraActivities,
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
  type LiveSessionRow,
  voiceCaptureIntents,
} from "./schema";
import { foldElapsed, nextTimerState } from "./timer-state";
import { readDurablePracticeSummary, unresolvedVoiceCaptureCount } from "./durable-practice";

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
  sessions: unknown[];
  historyActivities: unknown[];
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

type ActivityPayload = { id: string; date: string; sessionId?: string } & Record<string, unknown>;
type SessionPayload = { id: string; date?: string; activityIds: string[] } & Record<string, unknown>;

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

export type VoiceTimerActivity = ActivityPayload & {
  type: "leetcode" | "system_design" | "behavioral";
  title: string;
  questionId?: string;
  url?: string;
  allocatedSeconds: number;
  timer: TimerState | null;
  starred: boolean;
};

export type VoiceTimerInstrument = {
  serverNow: number;
  session: (SessionPayload & {
    label: string;
    allocatedSeconds: number;
    timer: TimerState;
  }) | null;
  activity: VoiceTimerActivity | null;
  activities: VoiceTimerActivity[];
};

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
  type: VoiceTimerActivity["type"];
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
    return { serverNow: Date.now(), session: null, activity: null, activities: [] };
  }
  const [sessionRows, activityRows] = await Promise.all([
    db.select().from(liveSessions).where(and(
      eq(liveSessions.ownerId, ownerId),
      eq(liveSessions.workbenchId, workbench.id),
    )),
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, workbench.id),
    )),
  ]);
  const subjectIds = [
    ...sessionRows.map((row) => row.id),
    ...activityRows.map((row) => row.id),
  ];
  const questionIds = activityRows.flatMap((row) => {
    const questionId = (row.payload as ActivityPayload).questionId;
    return typeof questionId === "string" ? [questionId] : [];
  });
  const [timerRows, preferenceRows] = await Promise.all([
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

  const activityIds = session?.activityIds ?? (
    focus?.activityId ? [focus.activityId] : []
  );
  const activities = activityIds.flatMap((activityId) => {
    const payload = activityById.get(activityId);
    if (!isVoiceActivityPayload(payload)) return [];
    const timer = activityTimerById.get(activityId) ?? null;
    if (timer?.completed) return [];
    const specialty = payload.type;
    const questionId = typeof payload.questionId === "string" ? payload.questionId : undefined;
    return [{
      ...payload,
      type: specialty,
      title: payload.title,
      questionId,
      url: typeof payload.url === "string" ? payload.url : undefined,
      allocatedSeconds: payload.allocatedSeconds,
      timer,
      starred: Boolean(questionId && starredKeys.has(`${specialty}:${questionId}`)),
    } satisfies VoiceTimerActivity];
  });
  const runningActivity = activities.find((candidate) => candidate.timer?.runningSince) ?? null;
  const focusedActivity = focus?.activityId
    ? activities.find((candidate) => candidate.id === focus.activityId) ?? null
    : null;

  return {
    serverNow: Date.now(),
    session,
    activity: runningActivity ?? focusedActivity,
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
  };
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

  return { id, status: "open" as const, openedPacificDate: date, openedAt: nowMs, closedAt: null };
}

export async function readLiveState(
  ownerId: string,
  date: string,
  options: { includeAll?: boolean } = {},
): Promise<LiveState> {
  const db = getDb();
  const workbench = await ensureOpenWorkbench(ownerId, date);
  const [timerRows, outcomeRows, publicationRows, noteRows, extraRows, sessionRows, focusRows] = await Promise.all([
    db.select().from(timers).where(eq(timers.ownerId, ownerId)),
    db.select().from(outcomes).where(eq(outcomes.ownerId, ownerId)),
    db.select().from(publicationStatuses).where(eq(publicationStatuses.ownerId, ownerId)),
    db.select().from(activityNotes).where(eq(activityNotes.ownerId, ownerId)),
    db.select().from(extraActivities).where(eq(extraActivities.ownerId, ownerId)),
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
  const historyActivityIds = new Set(historyActivities.map((activity) => activity.id));
  const durable = await readDurablePracticeSummary(ownerId, [...historyActivityIds], date);

  const outcomeMap: Record<string, OutcomeValue> = {};
  for (const row of outcomeRows) outcomeMap[row.activityId] = row.outcome as OutcomeValue;

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
    sessions: visibleSessions,
    historyActivities,
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
  options: { sessionId?: string | null; activityIds?: string[] } = {},
): Promise<TimerState> {
  const db = getDb();
  const existing = await loadTimer(db, ownerId, subjectId, kind);

  // Finished timers are locked permanently and never resume.
  if (existing?.completed) return toTimerState(existing);

  if (action === "finish" && kind === "activity") {
    const unresolvedCaptures = await unresolvedVoiceCaptureCount(ownerId, subjectId);
    if (unresolvedCaptures > 0) {
      throw new TimerStateConflictError(
        `Resolve ${unresolvedCaptures} pending voice capture${unresolvedCaptures === 1 ? "" : "s"} before finishing this activity.`,
      );
    }
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
    const missingResults: string[] = [];
    for (const activityId of activityIds) {
      const child = await loadTimer(db, ownerId, activityId, "activity");
      if (!child?.startedAt) continue;
      const unresolvedCaptures = await unresolvedVoiceCaptureCount(ownerId, activityId);
      if (unresolvedCaptures > 0) {
        throw new TimerStateConflictError(
          `Resolve ${unresolvedCaptures} pending voice capture${unresolvedCaptures === 1 ? "" : "s"} before finishing this session.`,
        );
      }
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
        await applyTimerAction(ownerId, activityId, "activity", "finish", nowMs);
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
      });
  }

  const updated = await loadTimer(db, ownerId, subjectId, kind);
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
  await db
    .insert(extraActivities)
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
  await db
    .insert(liveSessions)
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
}

export async function startFreshWorkbench(
  ownerId: string,
  date: string,
  nowMs: number,
  requestedId?: string,
) {
  const db = getDb();
  const current = await ensureOpenWorkbench(ownerId, date, nowMs);
  const [activityRows, sessionRows] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.workbenchId, current.id),
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
  return { id, status: "open" as const, openedPacificDate: date, openedAt: nowMs, closedAt: null };
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

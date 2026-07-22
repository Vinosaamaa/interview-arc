import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_DRAFT,
  type ExtraActivity,
  type AudioClip,
  type ActivitySolutionLink,
  type FinalizationSummary,
  type LocalDraft,
  type LocalSession,
  type PracticeNote,
  type PersonalQuestion,
  type ProblemPreference,
  type ReviewSchedule,
  type Outcome,
  type PublicationStatus,
  type SolutionProfile,
  type SolutionRevision,
  type TimerDraft,
} from "./live-types";

// Shape returned by GET /api/state and POST /api/mutations. `runningSince` is in
// server epoch ms; we translate it to the local clock on ingest so all in-memory
// math can use `Date.now()` without tracking skew per render.
type ServerTimer = {
  accumulatedSeconds: number;
  startedAt: number | null;
  runningSince: number | null;
  completed: boolean;
  completedAt: number | null;
  revision: number;
};
type ServerLiveState = {
  serverNow: number;
  timers: Record<string, ServerTimer>;
  sessionTimers: Record<string, ServerTimer>;
  outcomes: Record<string, Outcome>;
  publicationStatuses: Record<string, PublicationStatus>;
  notes: Record<string, string>;
  structuredNotes: Record<string, PracticeNote[]>;
  reviews: Record<string, ReviewSchedule>;
  finalizations: Record<string, FinalizationSummary>;
  audioClips: Record<string, AudioClip[]>;
  deliveryAnalyses: LocalDraft["deliveryAnalyses"];
  problemPreferences: ProblemPreference[];
  solutionProfiles: SolutionProfile[];
  solutionRevisions: SolutionRevision[];
  activitySolutionLinks: ActivitySolutionLink[];
  personalQuestions: PersonalQuestion[];
  extraActivities: ExtraActivity[];
  sessions: LocalSession[];
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

export function useReadOnlyLiveState(date: string) {
  const [state, setState] = useState<LocalDraft | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/state?date=${date}`);
        if (!response.ok) return;
        const server = (await response.json()) as ServerLiveState;
        if (!cancelled) setState(serverToDraft(server, server.serverNow - Date.now(), date));
      } catch {
        // Yesterday's card can fall back to versioned journal data offline.
      }
    })();
    return () => { cancelled = true; };
  }, [date]);
  return state;
}

export type Mutation =
  | {
      type: "timer";
      subjectId: string;
      kind: "activity" | "session";
      action: "start" | "pause" | "finish";
      sessionId?: string;
      activityIds?: string[];
    }
  | { type: "outcome"; activityId: string; outcome: Outcome | null; sessionId?: string }
  | { type: "publication-status"; activityId: string; status: PublicationStatus; artifactPath?: string }
  | { type: "activity-note"; activityId: string; note: string }
  | { type: "problem-star"; specialty: import("./live-types").ActivityType; questionId: string; starred: boolean }
  | { type: "personal-question-upsert"; specialty: import("./live-types").ActivityType; question: { questionId: string; title: string; prompt?: string; url?: string; tags?: string[]; priority?: number; targetMinutes?: number } }
  | { type: "extra-upsert"; activity: ExtraActivity }
  | { type: "extra-remove"; id: string }
  | { type: "session-upsert"; session: LocalSession }
  | { type: "session-remove"; id: string; activityIds: string[] };

const RETRY_INTERVAL_MS = 15000;

function draftKey(date: string) {
  return `interview-arc-draft-v3-${date}`;
}
function queueKey(date: string) {
  return `interview-arc-queue-v2-${date}`;
}

function timerToDraft(timer: ServerTimer, offset: number): TimerDraft {
  return {
    elapsedSeconds: timer.accumulatedSeconds,
    runningSince: timer.runningSince === null ? null : timer.runningSince - offset,
    completed: timer.completed,
    startedAt: timer.startedAt,
    completedAt: timer.completedAt,
  };
}

function serverToDraft(state: ServerLiveState, offset: number, date = ""): LocalDraft {
  const timers: Record<string, TimerDraft> = {};
  for (const [id, timer] of Object.entries(state.timers)) timers[id] = timerToDraft(timer, offset);
  const sessionTimers: Record<string, TimerDraft> = {};
  for (const [id, timer] of Object.entries(state.sessionTimers)) sessionTimers[id] = timerToDraft(timer, offset);
  return {
    timers,
    sessionTimers,
    outcomes: state.outcomes ?? {},
    publicationStatuses: state.publicationStatuses ?? {},
    notes: state.notes ?? {},
    structuredNotes: state.structuredNotes ?? {},
    reviews: state.reviews ?? {},
    finalizations: state.finalizations ?? {},
    audioClips: state.audioClips ?? {},
    deliveryAnalyses: state.deliveryAnalyses ?? {},
    problemPreferences: state.problemPreferences ?? [],
    solutionProfiles: state.solutionProfiles ?? [],
    solutionRevisions: state.solutionRevisions ?? [],
    activitySolutionLinks: state.activitySolutionLinks ?? [],
    personalQuestions: state.personalQuestions ?? [],
    extraActivities: state.extraActivities ?? [],
    sessions: (state.sessions ?? []).map((session) => ({ ...session, date: session.date ?? date })),
    focusedActivityId: state.focusedActivityId ?? null,
    focusedSessionId: state.focusedSessionId ?? null,
    focusedAt: state.focusedAt,
  };
}

// Server state wins on conflict; anything created only on this device is kept and
// reported back so it can be pushed up, so a first sync never drops local work.
function mergeDrafts(server: LocalDraft, local: LocalDraft) {
  const serverExtraIds = new Set(server.extraActivities.map((activity) => activity.id));
  const serverSessionIds = new Set(server.sessions.map((session) => session.id));
  const localOnly: Mutation[] = [];

  for (const activity of local.extraActivities) {
    if (!serverExtraIds.has(activity.id)) localOnly.push({ type: "extra-upsert", activity });
  }
  for (const session of local.sessions) {
    if (!serverSessionIds.has(session.id)) localOnly.push({ type: "session-upsert", session });
  }
  const merged: LocalDraft = {
    // Once the server is reachable, mutable practice state is authoritative in
    // D1. The persisted mutation queue—not an old display cache—owns unsynced
    // timer, outcome, publication, and note changes.
    timers: server.timers,
    sessionTimers: server.sessionTimers,
    outcomes: server.outcomes,
    publicationStatuses: server.publicationStatuses,
    notes: server.notes,
    structuredNotes: { ...local.structuredNotes, ...server.structuredNotes },
    reviews: { ...local.reviews, ...server.reviews },
    finalizations: { ...local.finalizations, ...server.finalizations },
    audioClips: { ...local.audioClips, ...server.audioClips },
    deliveryAnalyses: { ...local.deliveryAnalyses, ...server.deliveryAnalyses },
    problemPreferences: server.problemPreferences,
    solutionProfiles: server.solutionProfiles,
    solutionRevisions: server.solutionRevisions,
    activitySolutionLinks: server.activitySolutionLinks,
    personalQuestions: server.personalQuestions,
    extraActivities: [
      ...local.extraActivities.filter((activity) => !serverExtraIds.has(activity.id)),
      ...server.extraActivities,
    ],
    sessions: [
      ...local.sessions.filter((session) => !serverSessionIds.has(session.id)),
      ...server.sessions,
    ],
    focusedActivityId: server.focusedActivityId ?? local.focusedActivityId,
    focusedSessionId: server.focusedSessionId ?? local.focusedSessionId,
    focusedAt: server.focusedAt ?? local.focusedAt,
  };
  return { merged, localOnly };
}

function readDraft(date: string): LocalDraft {
  try {
    const saved = window.localStorage.getItem(draftKey(date));
    if (!saved) return EMPTY_DRAFT;
    const parsed = JSON.parse(saved) as Partial<LocalDraft>;
    return {
      timers: parsed.timers ?? {},
      sessionTimers: parsed.sessionTimers ?? {},
      outcomes: parsed.outcomes ?? {},
      publicationStatuses: parsed.publicationStatuses ?? {},
      notes: parsed.notes ?? {},
      structuredNotes: parsed.structuredNotes ?? {},
      reviews: parsed.reviews ?? {},
      finalizations: parsed.finalizations ?? {},
      audioClips: parsed.audioClips ?? {},
      deliveryAnalyses: parsed.deliveryAnalyses ?? {},
      problemPreferences: parsed.problemPreferences ?? [],
      solutionProfiles: parsed.solutionProfiles ?? [],
      solutionRevisions: parsed.solutionRevisions ?? [],
      activitySolutionLinks: parsed.activitySolutionLinks ?? [],
      personalQuestions: parsed.personalQuestions ?? [],
      extraActivities: parsed.extraActivities ?? [],
      sessions: (parsed.sessions ?? []).map((session) => ({ ...session, date: session.date ?? date })),
      focusedActivityId: parsed.focusedActivityId ?? null,
      focusedSessionId: parsed.focusedSessionId ?? null,
      focusedAt: parsed.focusedAt ?? null,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export type LiveStateController = {
  draft: LocalDraft;
  setDraft: (updater: (current: LocalDraft) => LocalDraft) => void;
  now: number;
  setNow: (value: number) => void;
  hydrated: boolean;
  synced: boolean;
  enqueue: (...mutations: Mutation[]) => void;
};

export function useLiveState(date: string): LiveStateController {
  const [draft, setDraft] = useState<LocalDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const [synced, setSynced] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const offsetRef = useRef(0);
  const queueRef = useRef<Mutation[]>([]);
  const flushingRef = useRef(false);

  const persistQueue = useCallback(() => {
    try {
      window.localStorage.setItem(queueKey(date), JSON.stringify(queueRef.current));
    } catch {
      // Ignore storage quota/availability failures; the retry loop continues.
    }
  }, [date]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (queueRef.current.length === 0) return;
    flushingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const mutation = queueRef.current[0];
        let response: Response;
        try {
          response = await fetch("/api/mutations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ date, mutation }),
          });
        } catch {
          break; // Offline: keep the queue and retry later.
        }
        if (!response.ok) break; // Transient server error: retry later.
        const state = (await response.json()) as ServerLiveState;
        offsetRef.current = state.serverNow - Date.now();
        queueRef.current = queueRef.current.slice(1);
        persistQueue();
        if (queueRef.current.length === 0) {
          // Queue drained: adopt the server's authoritative view (it also reflects
          // server-side effects like pausing other stopwatches on start).
          setDraft(() => serverToDraft(state, offsetRef.current, date));
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [date, persistQueue]);

  const enqueue = useCallback(
    (...mutations: Mutation[]) => {
      if (mutations.length === 0) return;
      queueRef.current = [...queueRef.current, ...mutations];
      persistQueue();
      void flush();
    },
    [flush, persistQueue],
  );

  // Hydrate from localStorage immediately, then reconcile with the server.
  // The local paint must not run after the server merge: a fast /api/state
  // response can land before rAF, and overwriting with the stale local draft
  // would wipe timers/extras that only exist on the server.
  useEffect(() => {
    let cancelled = false;
    let serverApplied = false;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if ((key?.startsWith("interview-arc-draft-") && key !== draftKey(date))
        || (key?.startsWith("interview-arc-queue-") && key !== queueKey(date))) {
        window.localStorage.removeItem(key);
      }
    }
    const localDraft = readDraft(date);
    // Defer the initial state writes out of the synchronous effect body.
    const frame = window.requestAnimationFrame(() => {
      if (cancelled || serverApplied) return;
      setDraft(() => localDraft);
      setHydrated(true);
    });

    try {
      queueRef.current = JSON.parse(window.localStorage.getItem(queueKey(date)) ?? "[]") as Mutation[];
    } catch {
      queueRef.current = [];
    }

    (async () => {
      try {
        const response = await fetch(`/api/state?date=${date}`);
        if (!response.ok) throw new Error("state fetch failed");
        const state = (await response.json()) as ServerLiveState;
        if (cancelled) return;
        offsetRef.current = state.serverNow - Date.now();
        const serverDraft = serverToDraft(state, offsetRef.current, date);
        const { merged, localOnly } = mergeDrafts(serverDraft, localDraft);
        serverApplied = true;
        setDraft(() => merged);
        setHydrated(true);
        if (localOnly.length > 0) enqueue(...localOnly);
        setSynced(true);
      } catch {
        // Offline or API unavailable: keep working from the local cache.
        if (!cancelled && !serverApplied) {
          setDraft(() => localDraft);
          setHydrated(true);
        }
      } finally {
        if (!cancelled) void flush();
      }
    })();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [date, enqueue, flush]);

  // Persist the local cache on every change once hydrated.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(draftKey(date), JSON.stringify(draft));
    } catch {
      // Ignore storage failures; the server queue is the durable path.
    }
  }, [draft, hydrated, date]);

  // Retry the queue when connectivity returns and on a periodic timer.
  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => void flush(), RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [flush]);

  // Drive the display. The dashboard owns auto-finish because each session can
  // have a different allocation.
  useEffect(() => {
    if (![...Object.values(draft.timers), ...Object.values(draft.sessionTimers)].some((timer) => timer.runningSince)) {
      return;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [draft.sessionTimers, draft.timers]);

  const setDraftPublic = useCallback((updater: (current: LocalDraft) => LocalDraft) => {
    setDraft(updater);
  }, []);

  return { draft, setDraft: setDraftPublic, now, setNow, hydrated, synced, enqueue };
}

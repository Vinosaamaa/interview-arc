import { useCallback, useEffect, useRef, useState } from "react";
import { mutationFailureDisposition } from "./mutation-queue";
import { applyTimerSync, type TimerSyncState } from "./timer-reconciliation";
import { requireLiveUpdateReconciliation, subscribeToLiveUpdates } from "./live-event-policy";
import { mergePendingInteractionModes } from "./interaction-mode-view";
import type { PracticeStateCommand } from "../db/practice-state-commands";
import {
  EMPTY_DRAFT,
  type ExtraActivity,
  type FocusBlock,
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
  type Workbench,
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
  workbench: Workbench | null;
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
  focusBlocks: FocusBlock[];
  sessions: LocalSession[];
  historyActivities: ExtraActivity[];
  historyFocusBlocks: FocusBlock[];
  historySessions: LocalSession[];
  interactionModeRegistry: LocalDraft["interactionModeRegistry"];
  interactionModes: LocalDraft["interactionModes"];
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

export type Mutation = PracticeStateCommand;

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
    revision: timer.revision,
  };
}

function serverToDraft(state: ServerLiveState, offset: number, date = ""): LocalDraft {
  const timers: Record<string, TimerDraft> = {};
  for (const [id, timer] of Object.entries(state.timers)) timers[id] = timerToDraft(timer, offset);
  const sessionTimers: Record<string, TimerDraft> = {};
  for (const [id, timer] of Object.entries(state.sessionTimers)) sessionTimers[id] = timerToDraft(timer, offset);
  return {
    workbench: state.workbench ?? null,
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
    focusBlocks: state.focusBlocks ?? [],
    sessions: (state.sessions ?? []).map((session) => ({ ...session, date: session.date ?? date })),
    historyActivities: state.historyActivities ?? state.extraActivities ?? [],
    historyFocusBlocks: state.historyFocusBlocks ?? state.focusBlocks ?? [],
    historySessions: (state.historySessions ?? state.sessions ?? []).map((session) => ({ ...session, date: session.date ?? date })),
    interactionModeRegistry: state.interactionModeRegistry ?? null,
    interactionModes: state.interactionModes ?? {},
    focusedActivityId: state.focusedActivityId ?? null,
    focusedSessionId: state.focusedSessionId ?? null,
    focusedAt: state.focusedAt,
  };
}

// Server state wins on conflict; anything created only on this device is kept and
// reported back so it can be pushed up, so a first sync never drops local work.
function mergeDrafts(server: LocalDraft, local: LocalDraft, queued: readonly Mutation[] = []) {
  const serverExtraIds = new Set(server.extraActivities.map((activity) => activity.id));
  const serverFocusBlockIds = new Set(server.focusBlocks.map((block) => block.id));
  const serverSessionIds = new Set(server.sessions.map((session) => session.id));
  const localOnly: Mutation[] = [];

  for (const activity of local.extraActivities) {
    if (!serverExtraIds.has(activity.id)) localOnly.push({ type: "extra-upsert", activity });
  }
  for (const block of local.focusBlocks) {
    if (!serverFocusBlockIds.has(block.id)) localOnly.push({ type: "focus-block-upsert", block });
  }
  for (const session of local.sessions) {
    if (!serverSessionIds.has(session.id)) localOnly.push({ type: "session-upsert", session });
  }
  const merged: LocalDraft = {
    workbench: server.workbench ?? local.workbench,
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
    focusBlocks: [
      ...local.focusBlocks.filter((block) => !serverFocusBlockIds.has(block.id)),
      ...server.focusBlocks,
    ],
    sessions: [
      ...local.sessions.filter((session) => !serverSessionIds.has(session.id)),
      ...server.sessions,
    ],
    historyActivities: server.historyActivities,
    historyFocusBlocks: server.historyFocusBlocks,
    historySessions: server.historySessions,
    interactionModeRegistry: server.interactionModeRegistry ?? local.interactionModeRegistry,
    interactionModes: mergePendingInteractionModes(server.interactionModes, local.interactionModes, queued),
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
      workbench: parsed.workbench ?? null,
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
      focusBlocks: parsed.focusBlocks ?? [],
      sessions: (parsed.sessions ?? []).map((session) => ({ ...session, date: session.date ?? date })),
      historyActivities: parsed.historyActivities ?? parsed.extraActivities ?? [],
      historyFocusBlocks: parsed.historyFocusBlocks ?? parsed.focusBlocks ?? [],
      historySessions: (parsed.historySessions ?? parsed.sessions ?? []).map((session) => ({ ...session, date: session.date ?? date })),
      interactionModeRegistry: parsed.interactionModeRegistry ?? null,
      interactionModes: parsed.interactionModes ?? {},
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
  mutationError: { type: Mutation["type"]; message: string; code?: string } | null;
  clearMutationError: () => void;
  enqueue: (...mutations: Mutation[]) => void;
};

export function useLiveState(date: string): LiveStateController {
  const [draft, setDraft] = useState<LocalDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const [synced, setSynced] = useState(false);
  const [mutationError, setMutationError] = useState<LiveStateController["mutationError"]>(null);
  const [now, setNow] = useState(() => Date.now());

  const offsetRef = useRef(0);
  const queueRef = useRef<Mutation[]>([]);
  const flushingRef = useRef(false);
  const reconcilingRef = useRef(false);
  const lastTimerSyncServerNowRef = useRef(0);
  const lastPracticeSyncServerNowRef = useRef(0);

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
      let latestState: ServerLiveState | null = null;
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
          setSynced(false);
          break; // Offline: keep the queue and retry later.
        }
        if (!response.ok) {
          if (mutationFailureDisposition(response.status) === "retry") {
            setSynced(false);
            break; // Authentication, throttling, and server failures may recover.
          }

          let failure: { error?: unknown; code?: unknown } = {};
          try {
            failure = await response.json() as { error?: unknown; code?: unknown };
          } catch {
            // Fall back to a stable generic message when an intermediary strips JSON.
          }
          setMutationError({
            type: mutation.type,
            message: typeof failure.error === "string"
              ? failure.error
              : "The server rejected this change because its authoritative state moved.",
            ...(typeof failure.code === "string" ? { code: failure.code } : {}),
          });

          // A validation/state conflict will never succeed when replayed. Drop
          // only that mutation, then reconcile from D1 before continuing so an
          // optimistic timer cannot survive as a browser-only ghost state.
          queueRef.current = queueRef.current.slice(1);
          persistQueue();
          try {
            const stateResponse = await fetch(`/api/state?date=${encodeURIComponent(date)}`);
            if (stateResponse.ok) {
              latestState = (await stateResponse.json()) as ServerLiveState;
              offsetRef.current = latestState.serverNow - Date.now();
              setSynced(true);
            } else {
              setSynced(false);
            }
          } catch {
            setSynced(false);
            // The invalid mutation is already removed. A later successful
            // mutation or the next page load will reconcile authoritative D1.
          }
          continue;
        }
        const state = (await response.json()) as ServerLiveState;
        latestState = state;
        offsetRef.current = state.serverNow - Date.now();
        setSynced(true);
        queueRef.current = queueRef.current.slice(1);
        persistQueue();
      }
      if (queueRef.current.length === 0 && latestState) {
        // Queue drained: adopt the server's authoritative view (it also reflects
        // server-side effects like pausing other stopwatches on start).
        setDraft(() => serverToDraft(latestState, offsetRef.current, date));
      }
    } finally {
      flushingRef.current = false;
    }
  }, [date, persistQueue]);

  const enqueue = useCallback(
    (...mutations: Mutation[]) => {
      if (mutations.length === 0) return;
      setMutationError((current) => (
        current && mutations.some((mutation) => mutation.type === current.type)
          ? null
          : current
      ));
      queueRef.current = [...queueRef.current, ...mutations];
      persistQueue();
      void flush();
    },
    [flush, persistQueue],
  );

  const reconcileTimers = useCallback(async () => {
    if (reconcilingRef.current || flushingRef.current || queueRef.current.length > 0) return false;
    reconcilingRef.current = true;
    try {
      const response = await fetch("/api/timer-state", { cache: "no-store" });
      if (!response.ok) {
        setSynced(false);
        return false;
      }
      const state = (await response.json()) as TimerSyncState;

      // A local action may have been queued while the read was in flight. Let
      // its mutation response reconcile instead of replacing optimistic UI.
      if (flushingRef.current || queueRef.current.length > 0) return false;
      if (state.serverNow < lastTimerSyncServerNowRef.current) return true;
      lastTimerSyncServerNowRef.current = state.serverNow;
      offsetRef.current = state.serverNow - Date.now();
      setDraft((current) => applyTimerSync(current, state, offsetRef.current));
      setSynced(true);
      return true;
    } catch {
      setSynced(false);
      // Transient polling failures must not disturb the current display.
      return false;
    } finally {
      reconcilingRef.current = false;
    }
  }, []);

  const reconcilePracticeState = useCallback(async () => {
    if (reconcilingRef.current || flushingRef.current || queueRef.current.length > 0) return false;
    reconcilingRef.current = true;
    try {
      const response = await fetch(`/api/state?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (!response.ok) {
        setSynced(false);
        return false;
      }
      const state = (await response.json()) as ServerLiveState;

      // Do not overwrite a browser mutation that began while this request was
      // in flight. Its mutation response will carry the authoritative state.
      if (flushingRef.current || queueRef.current.length > 0) return false;
      if (state.serverNow < lastPracticeSyncServerNowRef.current) return true;
      lastPracticeSyncServerNowRef.current = state.serverNow;
      offsetRef.current = state.serverNow - Date.now();
      setDraft(() => serverToDraft(state, offsetRef.current, date));
      setSynced(true);
      return true;
    } catch {
      setSynced(false);
      // A later push event or bounded fallback read will converge on D1.
      return false;
    } finally {
      reconcilingRef.current = false;
    }
  }, [date]);

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
        const { merged, localOnly } = mergeDrafts(serverDraft, localDraft, queueRef.current);
        serverApplied = true;
        setDraft(() => merged);
        setHydrated(true);
        if (localOnly.length > 0) enqueue(...localOnly);
        setSynced(true);
      } catch {
        if (!cancelled) setSynced(false);
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
    const onOnline = () => {
      void flush();
      void reconcilePracticeState();
    };
    const onOffline = () => setSynced(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = window.setInterval(() => void flush(), RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
    };
  }, [flush, reconcilePracticeState]);

  // Voice and the Chrome companion mutate the same D1 state. Timer events can
  // use the compact timer endpoint; every other committed event reconciles the
  // full practice structure so session/activity creates and deletes appear in
  // an already-open website. Only a bounded, low-frequency fallback read runs
  // while push is unavailable.
  useEffect(() => {
    if (!hydrated) return;
    const frame = window.requestAnimationFrame(() => void reconcileTimers());
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const unsubscribe = subscribeToLiveUpdates({
      url: `${protocol}//${window.location.host}/api/live-events`,
      onUpdate: (update) => requireLiveUpdateReconciliation(update, {
        timers: reconcileTimers,
        practice: reconcilePracticeState,
      }),
      onFallback: async () => {
        if (!await reconcilePracticeState()) {
          throw new Error("Authoritative Live fallback reconciliation did not complete.");
        }
      },
    });
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [hydrated, reconcilePracticeState, reconcileTimers]);

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
  const clearMutationError = useCallback(() => setMutationError(null), []);

  return {
    draft,
    setDraft: setDraftPublic,
    now,
    setNow,
    hydrated,
    synced,
    mutationError,
    clearMutationError,
    enqueue,
  };
}

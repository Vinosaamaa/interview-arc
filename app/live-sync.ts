import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_DRAFT,
  elapsed,
  SESSION_SECONDS,
  type ExtraActivity,
  type LocalDraft,
  type LocalSession,
  type Outcome,
  type TimerDraft,
} from "./live-types";

// Shape returned by GET /api/state and POST /api/mutations. `runningSince` is in
// server epoch ms; we translate it to the local clock on ingest so all in-memory
// math can use `Date.now()` without tracking skew per render.
type ServerTimer = {
  accumulatedSeconds: number;
  runningSince: number | null;
  completed: boolean;
  revision: number;
};
type ServerLiveState = {
  serverNow: number;
  timers: Record<string, ServerTimer>;
  sessionTimers: Record<string, ServerTimer>;
  outcomes: Record<string, Outcome>;
  extraActivities: ExtraActivity[];
  sessions: LocalSession[];
};

export type Mutation =
  | { type: "timer"; subjectId: string; kind: "activity" | "session"; action: "start" | "pause" | "finish" }
  | { type: "outcome"; activityId: string; outcome: Outcome | null }
  | { type: "extra-upsert"; activity: ExtraActivity }
  | { type: "extra-remove"; id: string }
  | { type: "session-upsert"; session: LocalSession }
  | { type: "session-remove"; id: string; activityIds: string[] };

const RETRY_INTERVAL_MS = 15000;

function draftKey(date: string) {
  return `interview-arc-draft-v2-${date}`;
}
function queueKey(date: string) {
  return `interview-arc-queue-v1-${date}`;
}

function timerToDraft(timer: ServerTimer, offset: number): TimerDraft {
  return {
    elapsedSeconds: timer.accumulatedSeconds,
    runningSince: timer.runningSince === null ? null : timer.runningSince - offset,
    completed: timer.completed,
  };
}

function serverToDraft(state: ServerLiveState, offset: number): LocalDraft {
  const timers: Record<string, TimerDraft> = {};
  for (const [id, timer] of Object.entries(state.timers)) timers[id] = timerToDraft(timer, offset);
  const sessionTimers: Record<string, TimerDraft> = {};
  for (const [id, timer] of Object.entries(state.sessionTimers)) sessionTimers[id] = timerToDraft(timer, offset);
  return {
    timers,
    sessionTimers,
    outcomes: state.outcomes ?? {},
    extraActivities: state.extraActivities ?? [],
    sessions: state.sessions ?? [],
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
  for (const [activityId, outcome] of Object.entries(local.outcomes)) {
    if (!(activityId in server.outcomes)) localOnly.push({ type: "outcome", activityId, outcome });
  }

  const merged: LocalDraft = {
    timers: { ...local.timers, ...server.timers },
    sessionTimers: { ...local.sessionTimers, ...server.sessionTimers },
    outcomes: { ...local.outcomes, ...server.outcomes },
    extraActivities: [
      ...local.extraActivities.filter((activity) => !serverExtraIds.has(activity.id)),
      ...server.extraActivities,
    ],
    sessions: [
      ...local.sessions.filter((session) => !serverSessionIds.has(session.id)),
      ...server.sessions,
    ],
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
      extraActivities: parsed.extraActivities ?? [],
      sessions: parsed.sessions ?? [],
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
          setDraft(() => serverToDraft(state, offsetRef.current));
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
  useEffect(() => {
    let cancelled = false;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("interview-arc-draft-") && key !== draftKey(date)) {
        window.localStorage.removeItem(key);
      }
    }
    const localDraft = readDraft(date);
    // Defer the initial state writes out of the synchronous effect body.
    const frame = window.requestAnimationFrame(() => {
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
        const serverDraft = serverToDraft(state, offsetRef.current);
        const { merged, localOnly } = mergeDrafts(serverDraft, localDraft);
        setDraft(() => merged);
        if (localOnly.length > 0) enqueue(...localOnly);
        setSynced(true);
      } catch {
        // Offline or API unavailable: keep working from the local cache.
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

  // Drive the display and auto-finish an expired session countdown.
  useEffect(() => {
    if (![...Object.values(draft.timers), ...Object.values(draft.sessionTimers)].some((timer) => timer.runningSince)) {
      return;
    }
    const interval = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      setDraft((current) => {
        const expiredIds = new Set(
          Object.entries(current.sessionTimers)
            .filter(([, timer]) => timer.runningSince && elapsed(timer, timestamp) >= SESSION_SECONDS)
            .map(([id]) => id),
        );
        if (!expiredIds.size) return current;
        for (const id of expiredIds) enqueue({ type: "timer", subjectId: id, kind: "session", action: "finish" });
        return {
          ...current,
          sessionTimers: Object.fromEntries(
            Object.entries(current.sessionTimers).map(([id, timer]) =>
              expiredIds.has(id)
                ? [id, { elapsedSeconds: SESSION_SECONDS, runningSince: null, completed: true }]
                : [id, timer],
            ),
          ),
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [draft.sessionTimers, draft.timers, enqueue]);

  const setDraftPublic = useCallback((updater: (current: LocalDraft) => LocalDraft) => {
    setDraft(updater);
  }, []);

  return { draft, setDraft: setDraftPublic, now, setNow, hydrated, synced, enqueue };
}

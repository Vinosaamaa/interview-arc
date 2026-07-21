import type { JournalActivity, PracticeSession } from "./content-types";

export type ActivityType = JournalActivity["type"];
export type Outcome = "solved" | "solved_after_reviewing_approach" | "failed";
export type PublicationStatus = "draft" | "ready" | "published";
export type TimerDraft = {
  elapsedSeconds: number;
  runningSince: number | null;
  completed: boolean;
  startedAt?: number | null;
  completedAt?: number | null;
};
export type ExtraActivity = JournalActivity & { timerGroupId: string };
export type LocalSession = PracticeSession & { source: "extra"; date: string };
export type LocalDraft = {
  timers: Record<string, TimerDraft>;
  sessionTimers: Record<string, TimerDraft>;
  outcomes: Record<string, Outcome>;
  publicationStatuses: Record<string, PublicationStatus>;
  notes: Record<string, string>;
  extraActivities: ExtraActivity[];
  sessions: LocalSession[];
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

export const CODING_SESSION_MINUTES = 40;
export const INTERVIEW_SESSION_MINUTES = 60;

export function sessionAllocationSeconds(coding: number, systemDesign: number, behavioral: number) {
  const safeCoding = Math.max(0, Math.floor(coding));
  const safeSystemDesign = Math.max(0, Math.floor(systemDesign));
  const safeBehavioral = Math.max(0, Math.floor(behavioral));
  return (
    safeCoding * CODING_SESSION_MINUTES +
    (safeSystemDesign + safeBehavioral) * INTERVIEW_SESSION_MINUTES
  ) * 60;
}

export const SESSION_SECONDS = sessionAllocationSeconds(6, 1, 1);
export const EMPTY_DRAFT: LocalDraft = {
  timers: {},
  sessionTimers: {},
  outcomes: {},
  publicationStatuses: {},
  notes: {},
  extraActivities: [],
  sessions: [],
  focusedActivityId: null,
  focusedSessionId: null,
  focusedAt: null,
};

export function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

// Elapsed time is always derived from timestamps, never counted tick-by-tick,
// so refreshing, backgrounding, or moving between devices never loses time.
export function elapsed(timer: TimerDraft | undefined, now: number) {
  if (!timer) return 0;
  return (
    timer.elapsedSeconds +
    (timer.runningSince ? Math.max(0, Math.floor((now - timer.runningSince) / 1000)) : 0)
  );
}

export function remaining(timer: TimerDraft | undefined, now: number, allocatedSeconds = SESSION_SECONDS) {
  return Math.max(0, allocatedSeconds - elapsed(timer, now));
}

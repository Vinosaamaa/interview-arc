import type { JournalActivity, PracticeSession } from "../app/content-types";
import { emptyJournal } from "../app/current-day";
import { practiceDateAt } from "../app/practice-time";
import { loadContentIndex } from "./content";
import { readLiveState, type PublicationStatusValue, type TimerState } from "./live-state";
import { derivePublicationStatus } from "./publication-state";

export type ConnectedActivity = JournalActivity & {
  timer?: TimerState;
  outcome?: "solved" | "solved_after_reviewing_approach" | "failed";
  publicationStatus: PublicationStatusValue;
  personalNote: string;
  pinnedNotes: unknown[];
  review: unknown | null;
  specialistFinalization: unknown | null;
  audioClips: unknown[];
  deliveryAnalyses: unknown[];
  sessionId?: string;
  practiceDate: string;
};

export function dateInPracticeTimeZone(now = new Date()) {
  return practiceDateAt(now);
}

export async function buildPracticeSnapshot(
  ownerId: string,
  date = dateInPracticeTimeZone(),
  options: { includeAll?: boolean } = {},
) {
  const [content, live] = await Promise.all([loadContentIndex(), readLiveState(ownerId, date, options)]);
  const journal = content.journals.find((candidate) => candidate.date === date) ?? emptyJournal(date);
  const publishedSessions = options.includeAll ? content.journals.flatMap((candidate) => candidate.sessions) : journal.sessions;
  const publishedActivities = options.includeAll ? content.journals.flatMap((candidate) => candidate.activities) : journal.activities;
  const sessions = [...publishedSessions, ...(live.sessions as PracticeSession[])];
  const sessionForActivity = new Map<string, string>();
  sessions.forEach((session) => session.activityIds.forEach((activityId) => sessionForActivity.set(activityId, session.id)));
  const activities = [...publishedActivities, ...(live.extraActivities as JournalActivity[])].map((activity) => {
    const artifact = content.artifacts.find((candidate) => candidate.activityId === activity.id);
    const timer = live.timers[activity.id];
    const outcome = live.outcomes[activity.id] ?? activity.outcome;
    const storedPublication = live.publicationStatuses[activity.id];
    const completed = activity.status === "completed" || Boolean(timer?.completed);
    const publicationStatus = derivePublicationStatus({ hasArtifact: Boolean(artifact), storedPublication, completed });
    const practiceDate = timer?.completedAt ? practiceDateAt(timer.completedAt) : activity.date;
    const sessionId = activity.sessionId ?? sessionForActivity.get(activity.id);
    return {
      ...activity,
      timer,
      outcome,
      publicationStatus,
      personalNote: live.notes[activity.id] ?? "",
      pinnedNotes: live.structuredNotes[activity.id] ?? [],
      review: live.reviews[activity.id] ?? null,
      specialistFinalization: live.finalizations[activity.id] ?? null,
      audioClips: live.audioClips[activity.id] ?? [],
      deliveryAnalyses: live.deliveryAnalyses[activity.id] ?? [],
      practiceDate,
      ...(sessionId ? { sessionId } : {}),
      ...(timer?.startedAt ? { startedAt: new Date(timer.startedAt).toISOString() } : {}),
      ...(timer?.completedAt ? { endedAt: new Date(timer.completedAt).toISOString() } : {}),
      ...(timer ? { elapsedSeconds: timer.accumulatedSeconds } : {}),
      ...(artifact ? { artifactPath: artifact.path } : {}),
    } satisfies ConnectedActivity;
  });
  const focusedActivity = live.focusedActivityId
    ? activities.find((activity) => activity.id === live.focusedActivityId) ?? null
    : null;
  return {
    date,
    serverNow: live.serverNow,
    focus: journal.focus,
    note: journal.note,
    sessions,
    sessionTimers: live.sessionTimers,
    activities,
    readyActivities: activities.filter((activity) => activity.publicationStatus === "ready"),
    focusedActivityId: live.focusedActivityId,
    focusedSessionId: live.focusedSessionId,
    focusedAt: live.focusedAt,
    focusedActivity,
  };
}

export async function buildPublicationQueue(ownerId: string, requestedDate?: string) {
  const [content, live] = await Promise.all([
    loadContentIndex(),
    readLiveState(ownerId, requestedDate ?? dateInPracticeTimeZone(), { includeAll: true }),
  ]);
  const sessions = [
    ...content.journals.flatMap((journal) => journal.sessions),
    ...(live.sessions as PracticeSession[]),
  ];
  const sessionForActivity = new Map<string, string>();
  sessions.forEach((session) => session.activityIds.forEach((activityId) => sessionForActivity.set(activityId, session.id)));
  const byId = new Map<string, JournalActivity>();
  content.journals.flatMap((journal) => journal.activities).forEach((activity) => byId.set(activity.id, activity));
  (live.extraActivities as JournalActivity[]).forEach((activity) => byId.set(activity.id, activity));
  const artifacts = new Map(content.artifacts.filter((artifact) => artifact.activityId).map((artifact) => [artifact.activityId, artifact]));

  const activities = [...byId.values()].flatMap((activity) => {
    const timer = live.timers[activity.id];
    const outcome = live.outcomes[activity.id] ?? activity.outcome;
    const artifact = artifacts.get(activity.id);
    const completed = activity.status === "completed" || Boolean(timer?.completed);
    const publicationStatus = derivePublicationStatus({
      hasArtifact: Boolean(artifact),
      storedPublication: live.publicationStatuses[activity.id],
      completed,
    });
    if (publicationStatus !== "ready") return [];
    const practiceDate = timer?.completedAt ? practiceDateAt(timer.completedAt) : activity.date;
    if (requestedDate && practiceDate !== requestedDate) return [];
    const sessionId = activity.sessionId ?? sessionForActivity.get(activity.id);
    return [{
      ...activity,
      timer,
      outcome,
      publicationStatus,
      practiceDate,
      personalNote: live.notes[activity.id] ?? "",
      pinnedNotes: live.structuredNotes[activity.id] ?? [],
      review: live.reviews[activity.id] ?? null,
      specialistFinalization: live.finalizations[activity.id] ?? null,
      audioClips: live.audioClips[activity.id] ?? [],
      deliveryAnalyses: live.deliveryAnalyses[activity.id] ?? [],
      ...(sessionId ? { sessionId } : {}),
      ...(timer?.startedAt ? { startedAt: new Date(timer.startedAt).toISOString() } : {}),
      ...(timer?.completedAt ? { endedAt: new Date(timer.completedAt).toISOString() } : {}),
      ...(timer ? { elapsedSeconds: timer.accumulatedSeconds } : {}),
    } satisfies ConnectedActivity];
  });
  const groups = [...new Set(activities.map((activity) => activity.practiceDate))]
    .sort()
    .map((date) => ({ date, activities: activities.filter((activity) => activity.practiceDate === date) }));
  return { timeZone: "America/Los_Angeles", activities, groups };
}

import type { JournalActivity, PracticeSession } from "../app/content-types";
import { emptyJournal } from "../app/current-day";
import { practiceDateAt } from "../app/practice-time";
import { loadContentIndex } from "./content";
import { readLiveState, type PublicationStatusValue, type TimerState } from "./live-state";
import { derivePublicationStatus } from "./publication-state";
import { dedupeSnapshotRows } from "./snapshot-rows";
import { readPublicationEvidenceState } from "./durable-practice";
import { readCurrentPracticeRecordActivityIds } from "./practice-records";

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
  recordingUnavailableClipIds?: string[];
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
  const liveSessionRows = options.includeAll ? live.historySessions : live.sessions;
  const liveActivityRows = options.includeAll ? live.historyActivities : live.extraActivities;
  const practiceRecordActivityIds = await readCurrentPracticeRecordActivityIds(
    ownerId,
    [...publishedActivities, ...(liveActivityRows as JournalActivity[])].map((activity) => activity.id),
  );
  const sessions = dedupeSnapshotRows([...publishedSessions, ...(liveSessionRows as PracticeSession[])]);
  const sessionForActivity = new Map<string, string>();
  sessions.forEach((session) => session.activityIds.forEach((activityId) => sessionForActivity.set(activityId, session.id)));
  // A just-published website activity exists in both owner-private live state
  // and the imported journal. Keep one row and prefer the journal copy so its
  // completed status, Pacific publication date, and artifact metadata win.
  const activities = dedupeSnapshotRows([
    ...(liveActivityRows as JournalActivity[]),
    ...publishedActivities,
  ]).map((activity) => {
    const artifact = content.artifacts.find((candidate) => candidate.activityId === activity.id);
    const timer = live.timers[activity.id];
    const outcome = live.outcomes[activity.id] ?? activity.outcome;
    const storedPublication = live.publicationStatuses[activity.id];
    const completed = activity.status === "completed" || Boolean(timer?.completed);
    const publicationStatus = derivePublicationStatus({
      hasArtifact: Boolean(artifact),
      hasPracticeRecord: practiceRecordActivityIds.has(activity.id),
      storedPublication,
      completed,
    });
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
  const activeActivity = activities.find((activity) => Boolean(activity.timer?.runningSince) && !activity.timer?.completed) ?? null;
  return {
    date,
    serverNow: live.serverNow,
    focus: journal.focus,
    note: journal.note,
    sessions,
    sessionTimers: live.sessionTimers,
    activities,
    readyActivities: activities.filter((activity) =>
      activity.publicationStatus === "ready" && Boolean(activity.outcome)
    ),
    focusedActivityId: live.focusedActivityId,
    focusedSessionId: live.focusedSessionId,
    focusedAt: live.focusedAt,
    focusedActivity,
    activeActivityId: activeActivity?.id ?? null,
    activeActivity,
  };
}

export async function buildPublicationQueue(ownerId: string, requestedDate?: string) {
  const [content, live] = await Promise.all([
    loadContentIndex(),
    readLiveState(ownerId, requestedDate ?? dateInPracticeTimeZone(), { includeAll: true }),
  ]);
  const sessions = [
    ...content.journals.flatMap((journal) => journal.sessions),
    ...(live.historySessions as PracticeSession[]),
  ];
  const sessionForActivity = new Map<string, string>();
  sessions.forEach((session) => session.activityIds.forEach((activityId) => sessionForActivity.set(activityId, session.id)));
  const byId = new Map<string, JournalActivity>();
  content.journals.flatMap((journal) => journal.activities).forEach((activity) => byId.set(activity.id, activity));
  (live.historyActivities as JournalActivity[]).forEach((activity) => byId.set(activity.id, activity));
  const artifacts = new Map(content.artifacts.filter((artifact) => artifact.activityId).map((artifact) => [artifact.activityId, artifact]));
  const practiceRecordActivityIds = await readCurrentPracticeRecordActivityIds(ownerId, [...byId.keys()]);

  const eligibleActivities = [...byId.values()].flatMap((activity) => {
    const timer = live.timers[activity.id];
    const outcome = live.outcomes[activity.id] ?? activity.outcome;
    const artifact = artifacts.get(activity.id);
    const completed = activity.status === "completed" || Boolean(timer?.completed);
    const publicationStatus = derivePublicationStatus({
      hasArtifact: Boolean(artifact),
      hasPracticeRecord: practiceRecordActivityIds.has(activity.id),
      storedPublication: live.publicationStatuses[activity.id],
      completed,
    });
    if (publicationStatus === "draft" || !outcome) return [];
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
  }).sort((left, right) => {
    const timestamp = (value?: string) => {
      const parsed = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const leftStartedAt = left.timer?.startedAt ?? timestamp(left.startedAt);
    const rightStartedAt = right.timer?.startedAt ?? timestamp(right.startedAt);
    const leftCompletedAt = left.timer?.completedAt ?? timestamp(left.endedAt) ?? leftStartedAt;
    const rightCompletedAt = right.timer?.completedAt ?? timestamp(right.endedAt) ?? rightStartedAt;
    return left.practiceDate.localeCompare(right.practiceDate)
      || (leftCompletedAt ?? Number.MAX_SAFE_INTEGER) - (rightCompletedAt ?? Number.MAX_SAFE_INTEGER)
      || (leftStartedAt ?? Number.MAX_SAFE_INTEGER) - (rightStartedAt ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id);
  });
  const evidence = await readPublicationEvidenceState(ownerId, eligibleActivities.map((activity) => activity.id));
  const blockersByActivity = new Map<string, typeof evidence.blockers>();
  evidence.blockers.forEach((blocker) => blockersByActivity.set(
    blocker.activityId,
    [...(blockersByActivity.get(blocker.activityId) ?? []), blocker],
  ));
  const blockedActivities = eligibleActivities.flatMap((activity) => {
    const blockers = blockersByActivity.get(activity.id) ?? [];
    return blockers.length ? [{ activityId: activity.id, title: activity.title, blockers }] : [];
  });
  const activities = eligibleActivities.flatMap((activity) => blockersByActivity.has(activity.id) || activity.publicationStatus !== "ready"
    ? []
    : [{
      ...activity,
      recordingUnavailableClipIds: evidence.unavailableClipIds.filter((clipId) => (
        activity.audioClips.some((clip) => (clip as { id?: unknown }).id === clipId)
      )),
    }]);
  const groups = [...new Set(activities.map((activity) => activity.practiceDate))]
    .sort()
    .map((date) => ({ date, activities: activities.filter((activity) => activity.practiceDate === date) }));
  return { timeZone: "America/Los_Angeles", activities, groups, blockedActivities };
}

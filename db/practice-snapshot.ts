import type { JournalActivity, PracticeSession } from "../app/content-types";
import { emptyJournal } from "../app/current-day";
import { loadContentIndex } from "./content";
import { readLiveState, type PublicationStatusValue, type TimerState } from "./live-state";
import { derivePublicationStatus } from "./publication-state";

export type ConnectedActivity = JournalActivity & {
  timer?: TimerState;
  outcome?: "solved" | "solved_after_reviewing_approach" | "failed";
  publicationStatus: PublicationStatusValue;
  personalNote: string;
};

export function dateInPracticeTimeZone(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function buildPracticeSnapshot(ownerId: string, date = dateInPracticeTimeZone()) {
  const [content, live] = await Promise.all([loadContentIndex(), readLiveState(ownerId, date)]);
  const journal = content.journals.find((candidate) => candidate.date === date) ?? emptyJournal(date);
  const activities = [...journal.activities, ...(live.extraActivities as JournalActivity[])].map((activity) => {
    const artifact = content.artifacts.find((candidate) => candidate.activityId === activity.id);
    const timer = live.timers[activity.id];
    const outcome = live.outcomes[activity.id] ?? activity.outcome;
    const storedPublication = live.publicationStatuses[activity.id];
    const completed = activity.status === "completed" || Boolean(timer?.completed) || Boolean(outcome);
    const publicationStatus = derivePublicationStatus({ hasArtifact: Boolean(artifact), storedPublication, completed });
    return {
      ...activity,
      timer,
      outcome,
      publicationStatus,
      personalNote: live.notes[activity.id] ?? "",
      ...(artifact ? { artifactPath: artifact.path } : {}),
    } satisfies ConnectedActivity;
  });
  const sessions = [...journal.sessions, ...(live.sessions as PracticeSession[])];
  return {
    date,
    serverNow: live.serverNow,
    focus: journal.focus,
    note: journal.note,
    sessions,
    sessionTimers: live.sessionTimers,
    activities,
    readyActivities: activities.filter((activity) => activity.publicationStatus === "ready"),
  };
}

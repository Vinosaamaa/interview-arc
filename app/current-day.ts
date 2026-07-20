import type { DailyJournal } from "./content-types";

export const INTERVIEW_TIME_ZONE = "America/Los_Angeles";

export function dateInTimeZone(now: Date, timeZone = INTERVIEW_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function emptyJournal(date: string): DailyJournal {
  return {
    schemaVersion: 1,
    date,
    focus: "Daily practice",
    note: "Build today’s record one honest activity at a time.",
    sessions: [],
    timerGroups: [],
    activities: [],
  };
}

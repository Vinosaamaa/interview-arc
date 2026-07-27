import { and, eq, inArray } from "drizzle-orm";
import { splitIntervalByPacificDate } from "../app/career-work";
import { getDb } from "./index";
import { focusBlocks, timerIntervals, timers } from "./schema";

export type CareerFocusMetrics = {
  totalSeconds: number;
  plannedSeconds: number;
  completedBlocks: number;
  focusDays: number;
  currentStreak: number;
  longestStreak: number;
  averageCompletedSeconds: number;
  byDate: Record<string, number>;
};

function previousDate(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export async function readCareerFocusMetrics(
  ownerId: string,
  from: string,
  to: string,
  nowMs = Date.now(),
): Promise<CareerFocusMetrics> {
  const db = getDb();
  const blocks = await db.select().from(focusBlocks).where(eq(focusBlocks.ownerId, ownerId));
  const ids = blocks.map((block) => block.id);
  const [intervals, timerRows] = ids.length
    ? await Promise.all([
      db.select().from(timerIntervals).where(and(
        eq(timerIntervals.ownerId, ownerId),
        eq(timerIntervals.kind, "activity"),
        inArray(timerIntervals.subjectId, ids),
      )),
      db.select().from(timers).where(and(
        eq(timers.ownerId, ownerId),
        eq(timers.kind, "activity"),
        inArray(timers.subjectId, ids),
      )),
    ])
    : [[], []];

  const byDate: Record<string, number> = {};
  for (const interval of intervals) {
    for (const segment of splitIntervalByPacificDate(interval.startedAt, interval.endedAt ?? nowMs)) {
      if (segment.date < from || segment.date > to) continue;
      byDate[segment.date] = (byDate[segment.date] ?? 0) + segment.seconds;
    }
  }

  const relevantBlocks = blocks.filter((block) => block.date >= from && block.date <= to);
  const timerById = new Map(timerRows.map((timer) => [timer.subjectId, timer]));
  const completedBlocks = relevantBlocks.filter((block) => timerById.get(block.id)?.completed).length;
  const completedIds = new Set(relevantBlocks
    .filter((block) => timerById.get(block.id)?.completed)
    .map((block) => block.id));
  let completedSeconds = 0;
  for (const interval of intervals) {
    if (!completedIds.has(interval.subjectId)) continue;
    completedSeconds += splitIntervalByPacificDate(interval.startedAt, interval.endedAt ?? nowMs)
      .filter((segment) => segment.date >= from && segment.date <= to)
      .reduce((sum, segment) => sum + segment.seconds, 0);
  }
  const activeDates = Object.entries(byDate)
    .filter(([, seconds]) => seconds > 0)
    .map(([date]) => date)
    .sort();
  const activeSet = new Set(activeDates);
  let currentStreak = 0;
  let cursor = to;
  if (!activeSet.has(cursor)) cursor = previousDate(cursor);
  while (activeSet.has(cursor)) {
    currentStreak += 1;
    cursor = previousDate(cursor);
  }
  let longestStreak = 0;
  let run = 0;
  let prior = "";
  for (const date of activeDates) {
    run = prior && previousDate(date) === prior ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prior = date;
  }
  const totalSeconds = Object.values(byDate).reduce((sum, seconds) => sum + seconds, 0);
  return {
    totalSeconds,
    plannedSeconds: relevantBlocks.reduce((sum, block) => sum + block.plannedSeconds, 0),
    completedBlocks,
    focusDays: activeDates.length,
    currentStreak,
    longestStreak,
    averageCompletedSeconds: completedBlocks ? Math.floor(completedSeconds / completedBlocks) : 0,
    byDate,
  };
}

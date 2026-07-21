export const PRACTICE_TIME_ZONE = "America/Los_Angeles";

export function practiceDateAt(value: number | string | Date = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PRACTICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function practiceHourAt(value: number | string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: PRACTICE_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  return Number(hour ?? 0);
}

export function formatPracticeTimestamp(value?: number | string | null, compact = false, includeTimeZone = true) {
  if (value === undefined || value === null || value === "") return "Not recorded";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRACTICE_TIME_ZONE,
    month: "short",
    day: "numeric",
    ...(compact ? {} : { year: "numeric" as const }),
    hour: "numeric",
    minute: "2-digit",
    ...(includeTimeZone ? { timeZoneName: "short" as const } : {}),
  }).format(date);
}

export function formatPracticeTimerTimestamp(value?: number | string | null) {
  if (value === undefined || value === null || value === "") return "";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRACTICE_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function practicePeriodAt(value: number | string) {
  const hour = practiceHourAt(value);
  if (hour < 6) return "Late night";
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

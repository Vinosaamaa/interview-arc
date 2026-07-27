const pacificDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function practiceDateAt(timestamp: number) {
  return pacificDate.format(new Date(timestamp));
}

export const JOB_STATUSES = [
  "saved",
  "applying",
  "needs_attention",
  "applied",
  "interview",
  "offer",
  "rejected",
  "failed",
  "skipped",
  "referral",
  "referred",
] as const;

export type JobStatus = typeof JOB_STATUSES[number];
export type FocusBlock = {
  id: string;
  workbenchId?: string;
  activityClass: "focus_block";
  focusCategory: "job_applications";
  title: string;
  plannedSeconds: number;
  note?: string;
  date: string;
  createdAt: number;
  updatedAt: number;
};

export type CareerSummary = {
  schemaVersion: 1;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  timeZone: "America/Los_Angeles";
  range: { from: string; to: string };
  totals: {
    submitted: number;
    interviewing: number;
    offers: number;
    rejected: number;
    applying: number;
    needsAttention: number;
    failed: number;
    skipped: number;
    awaitingReferral: number;
    referred: number;
  };
  currentStatusCounts: Record<JobStatus, number>;
  daily: Array<{ date: string; submitted: number; referred: number }>;
  bySource: Record<string, number>;
};

export type CareerJob = {
  id: string;
  externalJobId: string | null;
  company: string;
  title: string;
  location: string | null;
  source: string;
  status: JobStatus;
  referralOnly: boolean;
  jobUrl: string | null;
  postedAt: string | null;
  appliedAt: string | null;
  referredAt: string | null;
  statusUpdatedAt: string | null;
  timelineAt: string;
};

export type CareerJobPage = {
  schemaVersion: 1;
  generatedAt: string;
  jobs: CareerJob[];
  page: { nextCursor: string | null; hasMore: boolean };
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string;
function text(value: unknown, label: string, nullable: true): string | null;
function text(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function count(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} must be a nonnegative integer.`);
  return Number(value);
}

function optionalTimestamp(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  const candidate = text(value, label);
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} must be an ISO timestamp.`);
  return candidate;
}

export function splitIntervalByPacificDate(startedAt: number, endedAt: number) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return [];
  const segments: Array<{ date: string; seconds: number }> = [];
  let cursor = Math.floor(startedAt);
  const end = Math.floor(endedAt);
  while (cursor < end) {
    const date = practiceDateAt(cursor);
    if (practiceDateAt(end - 1) === date) {
      segments.push({ date, seconds: Math.floor((end - cursor) / 1_000) });
      break;
    }
    let low = cursor + 1;
    let high = end;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (practiceDateAt(middle) === date) low = middle + 1;
      else high = middle;
    }
    segments.push({ date, seconds: Math.floor((low - cursor) / 1_000) });
    cursor = low;
  }
  return segments.filter((segment) => segment.seconds > 0);
}

export function careerHeatLevel(seconds: number) {
  if (seconds <= 0) return 0;
  if (seconds < 30 * 60) return 1;
  if (seconds < 60 * 60) return 2;
  if (seconds < 2 * 60 * 60) return 3;
  if (seconds === 2 * 60 * 60) return 4;
  return 5;
}

export function normalizeCareerSummary(value: unknown): CareerSummary {
  const input = record(value, "Career summary");
  if (input.schemaVersion !== 1) throw new Error("Unsupported Career summary schema.");
  const totalsInput = record(input.totals, "Career totals");
  const statusInput = record(input.currentStatusCounts, "Current status counts");
  const dailyInput = Array.isArray(input.daily) ? input.daily : (() => { throw new Error("Career daily must be an array."); })();
  const sourceInput = record(input.bySource, "Source counts");
  const rangeInput = record(input.range, "Career range");
  const totals = {
    submitted: count(totalsInput.submitted, "submitted"),
    interviewing: count(totalsInput.interviewing, "interviewing"),
    offers: count(totalsInput.offers, "offers"),
    rejected: count(totalsInput.rejected, "rejected"),
    applying: count(totalsInput.applying, "applying"),
    needsAttention: count(totalsInput.needsAttention, "needsAttention"),
    failed: count(totalsInput.failed, "failed"),
    skipped: count(totalsInput.skipped, "skipped"),
    awaitingReferral: count(totalsInput.awaitingReferral, "awaitingReferral"),
    referred: count(totalsInput.referred, "referred"),
  };
  const currentStatusCounts = Object.fromEntries(JOB_STATUSES.map((status) => [
    status,
    count(statusInput[status], `currentStatusCounts.${status}`),
  ])) as Record<JobStatus, number>;
  return {
    schemaVersion: 1,
    generatedAt: text(input.generatedAt, "generatedAt"),
    sourceUpdatedAt: optionalTimestamp(input.sourceUpdatedAt, "sourceUpdatedAt"),
    timeZone: input.timeZone === "America/Los_Angeles"
      ? input.timeZone
      : (() => { throw new Error("Career summary must use America/Los_Angeles."); })(),
    range: {
      from: text(rangeInput.from, "range.from"),
      to: text(rangeInput.to, "range.to"),
    },
    totals,
    currentStatusCounts,
    daily: dailyInput.map((row, index) => {
      const item = record(row, `daily[${index}]`);
      return {
        date: text(item.date, `daily[${index}].date`),
        submitted: count(item.submitted, `daily[${index}].submitted`),
        referred: count(item.referred, `daily[${index}].referred`),
      };
    }),
    bySource: Object.fromEntries(Object.entries(sourceInput).map(([source, value]) => [
      source,
      count(value, `bySource.${source}`),
    ])),
  };
}

export function normalizeJobPage(value: unknown): CareerJobPage {
  const input = record(value, "Career jobs");
  if (input.schemaVersion !== 1) throw new Error("Unsupported Career jobs schema.");
  if (!Array.isArray(input.jobs)) throw new Error("Career jobs must be an array.");
  const pageInput = record(input.page, "Career job page");
  return {
    schemaVersion: 1,
    generatedAt: text(input.generatedAt, "generatedAt"),
    jobs: input.jobs.map((row, index) => {
      const item = record(row, `jobs[${index}]`);
      if (!JOB_STATUSES.includes(item.status as JobStatus)) throw new Error(`jobs[${index}].status is invalid.`);
      return {
        id: text(item.id, `jobs[${index}].id`),
        externalJobId: text(item.externalJobId, `jobs[${index}].externalJobId`, true),
        company: text(item.company, `jobs[${index}].company`),
        title: text(item.title, `jobs[${index}].title`),
        location: text(item.location, `jobs[${index}].location`, true),
        source: text(item.source, `jobs[${index}].source`),
        status: item.status as JobStatus,
        referralOnly: typeof item.referralOnly === "boolean"
          ? item.referralOnly
          : (() => { throw new Error(`jobs[${index}].referralOnly must be boolean.`); })(),
        jobUrl: text(item.jobUrl, `jobs[${index}].jobUrl`, true),
        postedAt: optionalTimestamp(item.postedAt, `jobs[${index}].postedAt`),
        appliedAt: optionalTimestamp(item.appliedAt, `jobs[${index}].appliedAt`),
        referredAt: optionalTimestamp(item.referredAt, `jobs[${index}].referredAt`),
        statusUpdatedAt: optionalTimestamp(item.statusUpdatedAt, `jobs[${index}].statusUpdatedAt`),
        timelineAt: text(item.timelineAt, `jobs[${index}].timelineAt`),
      };
    }),
    page: {
      nextCursor: text(pageInput.nextCursor, "page.nextCursor", true),
      hasMore: typeof pageInput.hasMore === "boolean"
        ? pageInput.hasMore
        : (() => { throw new Error("page.hasMore must be boolean."); })(),
    },
  };
}

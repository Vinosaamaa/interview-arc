export type JourneyInsightEntry = {
  id: string;
  questionId?: string;
  date: string;
  type: "leetcode" | "system_design" | "behavioral";
  title: string;
  url?: string;
  elapsedSeconds: number;
};

export type JourneyInsightQuestion = {
  id: string;
  title: string;
  url?: string;
  difficulty?: "easy" | "medium" | "hard";
};

export type AverageEffortBucket = {
  key: "coding" | "easy" | "medium" | "hard" | "unknown" | "system_design" | "behavioral";
  label: string;
  count: number;
  totalSeconds: number;
  averageSeconds: number | null;
};

export type ReaderSpecialty = "leetcode" | "system_design" | "behavioral";

export type JourneyReaderState = {
  attemptId: string;
  range: "30" | "90" | "365" | "all";
  metric: "activities" | "time";
  heatmap: "all" | "leetcode" | "system_design" | "behavioral" | "job_applications";
  day: string;
  topic: string;
  specialty?: ReaderSpecialty;
  problemId?: string;
};

export type PastReaderState = {
  attemptId: string;
  specialty?: ReaderSpecialty;
  problemId?: string;
};

export type BankReaderState = {
  specialty: ReaderSpecialty;
  problemId: string;
  attemptId: string;
};

export type WorkspaceRouteView = "today" | "journey" | "reviews" | "past" | "banks";

export type ReaderClosePlan = {
  view: "journey" | "past" | "banks";
  href: string;
};

const READER_QUERY_KEYS = ["attempt", "range", "metric", "heatmap", "day", "topic", "specialty", "problem"] as const;
const READER_SPECIALTIES = ["leetcode", "system_design", "behavioral"] as const;

function clearReaderQuery(url: URL) {
  READER_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
}

function readReaderProblemIdentity(url: URL): { specialty?: ReaderSpecialty; problemId?: string } | null {
  const specialty = url.searchParams.get("specialty")?.trim() ?? "";
  const problemId = url.searchParams.get("problem")?.trim() ?? "";
  if (!specialty && !problemId) return {};
  if (!specialty || !problemId || !READER_SPECIALTIES.includes(specialty as ReaderSpecialty)) return null;
  return { specialty: specialty as ReaderSpecialty, problemId };
}

export function readerDepthAfterNestedClose(value: unknown) {
  const depth = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return Math.max(0, depth - 1);
}

function identity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedUrl(value?: string) {
  return value?.trim().replace(/\/$/, "").toLowerCase() ?? "";
}

export function uniqueJourneyEntries<T extends JourneyInsightEntry>(entries: T[], from: string, through: string): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (entry.date < from || entry.date > through || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function averageEffortBreakdown(
  entries: JourneyInsightEntry[],
  questions: JourneyInsightQuestion[],
  from: string,
  through: string,
): AverageEffortBucket[] {
  const inRange = uniqueJourneyEntries(entries, from, through).filter((entry) => entry.elapsedSeconds > 0);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const byUrl = new Map(questions.flatMap((question) => normalizedUrl(question.url) ? [[normalizedUrl(question.url), question] as const] : []));
  const byTitle = new Map(questions.map((question) => [identity(question.title), question]));
  const totals = new Map<AverageEffortBucket["key"], { count: number; totalSeconds: number }>();
  const add = (key: AverageEffortBucket["key"], seconds: number) => {
    const current = totals.get(key) ?? { count: 0, totalSeconds: 0 };
    totals.set(key, { count: current.count + 1, totalSeconds: current.totalSeconds + seconds });
  };
  inRange.forEach((entry) => {
    if (entry.type === "leetcode") {
      add("coding", entry.elapsedSeconds);
      const question = (entry.questionId ? byId.get(entry.questionId) : undefined)
        ?? (normalizedUrl(entry.url) ? byUrl.get(normalizedUrl(entry.url)) : undefined)
        ?? byTitle.get(identity(entry.title));
      add(question?.difficulty ?? "unknown", entry.elapsedSeconds);
      return;
    }
    add(entry.type, entry.elapsedSeconds);
  });
  return ([
    ["coding", "Coding overall"],
    ["easy", "Coding · Easy"],
    ["medium", "Coding · Medium"],
    ["hard", "Coding · Hard"],
    ["unknown", "Coding · Unknown"],
    ["system_design", "System design"],
    ["behavioral", "Behavioral"],
  ] as const).map(([key, label]) => {
    const value = totals.get(key) ?? { count: 0, totalSeconds: 0 };
    return { key, label, ...value, averageSeconds: value.count ? value.totalSeconds / value.count : null };
  });
}

export function journeyReaderHref(currentHref: string, state: JourneyReaderState) {
  const url = new URL(currentHref);
  url.searchParams.delete("specialty");
  url.searchParams.delete("problem");
  url.searchParams.set("view", "journey");
  url.searchParams.set("attempt", state.attemptId);
  url.searchParams.set("range", state.range);
  url.searchParams.set("metric", state.metric);
  url.searchParams.set("heatmap", state.heatmap);
  if (state.day) url.searchParams.set("day", state.day); else url.searchParams.delete("day");
  if (state.topic) url.searchParams.set("topic", state.topic); else url.searchParams.delete("topic");
  if (state.specialty && state.problemId) {
    url.searchParams.set("specialty", state.specialty);
    url.searchParams.set("problem", state.problemId);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readJourneyReaderState(currentHref: string): JourneyReaderState | null {
  const url = new URL(currentHref);
  if (url.searchParams.get("view") !== "journey") return null;
  const attemptId = url.searchParams.get("attempt")?.trim() ?? "";
  const range = url.searchParams.get("range") ?? "90";
  const metric = url.searchParams.get("metric") ?? "activities";
  const heatmap = url.searchParams.get("heatmap") ?? "all";
  const day = url.searchParams.get("day") ?? "";
  const topic = url.searchParams.get("topic") ?? "";
  const problemIdentity = readReaderProblemIdentity(url);
  if (!attemptId || !["30", "90", "365", "all"].includes(range)
    || !["activities", "time"].includes(metric)
    || !["all", "leetcode", "system_design", "behavioral", "job_applications"].includes(heatmap)
    || (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))
    || !problemIdentity) return null;
  return {
    attemptId,
    range: range as JourneyReaderState["range"],
    metric: metric as JourneyReaderState["metric"],
    heatmap: heatmap as JourneyReaderState["heatmap"],
    day,
    topic,
    ...problemIdentity,
  };
}

export function journeyHrefWithoutReader(currentHref: string) {
  const url = new URL(currentHref);
  clearReaderQuery(url);
  url.searchParams.set("view", "journey");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function pastReaderHref(currentHref: string, attemptId: string) {
  const url = new URL(currentHref);
  url.searchParams.set("view", "past");
  url.searchParams.set("attempt", attemptId);
  READER_QUERY_KEYS.filter((key) => key !== "attempt").forEach((key) => url.searchParams.delete(key));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readPastReaderState(currentHref: string): PastReaderState | null {
  const url = new URL(currentHref);
  if (url.searchParams.get("view") !== "past") return null;
  const attemptId = url.searchParams.get("attempt")?.trim() ?? "";
  const problemIdentity = readReaderProblemIdentity(url);
  if (!attemptId || !problemIdentity) return null;
  return {
    attemptId,
    ...problemIdentity,
  };
}

export function pastSolutionReaderHref(
  currentHref: string,
  attemptId: string,
  specialty: NonNullable<PastReaderState["specialty"]>,
  problemId: string,
) {
  const url = new URL(pastReaderHref(currentHref, attemptId), new URL(currentHref).origin);
  url.searchParams.set("specialty", specialty);
  url.searchParams.set("problem", problemId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function bankReaderHref(
  currentHref: string,
  specialty: BankReaderState["specialty"],
  problemId: string,
  attemptId = "",
) {
  const url = new URL(currentHref);
  clearReaderQuery(url);
  url.searchParams.set("view", "banks");
  url.searchParams.set("specialty", specialty);
  url.searchParams.set("problem", problemId);
  if (attemptId) url.searchParams.set("attempt", attemptId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readBankReaderState(currentHref: string): BankReaderState | null {
  const url = new URL(currentHref);
  if (url.searchParams.get("view") !== "banks") return null;
  const problemIdentity = readReaderProblemIdentity(url);
  const attemptId = url.searchParams.get("attempt")?.trim() ?? "";
  if (!problemIdentity?.specialty || !problemIdentity.problemId) return null;
  return { specialty: problemIdentity.specialty, problemId: problemIdentity.problemId, attemptId };
}

export function workspaceViewHref(currentHref: string, view: WorkspaceRouteView) {
  const url = new URL(currentHref);
  clearReaderQuery(url);
  url.searchParams.set("view", view);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readerClosePlan(currentHref: string): ReaderClosePlan | null {
  const journeyReader = readJourneyReaderState(currentHref);
  if (journeyReader) {
    if (journeyReader.specialty && journeyReader.problemId) {
      return {
        view: "journey",
        href: journeyReaderHref(currentHref, {
          attemptId: journeyReader.attemptId,
          range: journeyReader.range,
          metric: journeyReader.metric,
          heatmap: journeyReader.heatmap,
          day: journeyReader.day,
          topic: journeyReader.topic,
        }),
      };
    }
    return { view: "journey", href: journeyHrefWithoutReader(currentHref) };
  }
  const pastReader = readPastReaderState(currentHref);
  if (pastReader) {
    return {
      view: "past",
      href: pastReader.specialty && pastReader.problemId
        ? pastReaderHref(currentHref, pastReader.attemptId)
        : workspaceViewHref(currentHref, "past"),
    };
  }
  const bankReader = readBankReaderState(currentHref);
  if (bankReader) {
    return {
      view: "banks",
      href: bankReader.attemptId
        ? bankReaderHref(currentHref, bankReader.specialty, bankReader.problemId)
        : workspaceViewHref(currentHref, "banks"),
    };
  }
  return null;
}

export function readWorkspaceRouteView(currentHref: string): WorkspaceRouteView | null {
  const view = new URL(currentHref).searchParams.get("view");
  return view === "today" || view === "journey" || view === "reviews" || view === "past" || view === "banks" ? view : null;
}

import type { LoopActivityContextRequest } from "../db/loop-policy";
import type { ActivityType, ExtraActivity, LocalSession } from "./live-types";

export type ActivityBatchDestination = "standalone" | "session";

export type SelectedActivity = {
  key: string;
  type: ActivityType;
  questionId?: string;
  title: string;
  url?: string;
  prompt?: string;
  minutes: number;
  topics: string[];
  source: "bank" | "custom";
};

type BuildSelectedActivityBatchInput = {
  date: string;
  stamp: string;
  sessionNumber: number;
  destination: ActivityBatchDestination;
  items: SelectedActivity[];
  loopContext?: LoopActivityContextRequest | null;
  boundKeys?: ReadonlySet<string> | readonly string[];
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timerGroupSuffix(type: ActivityType) {
  if (type === "system_design") return "system-design";
  return type;
}

export function buildSelectedActivityBatch({
  date,
  stamp,
  sessionNumber,
  destination,
  items,
  loopContext,
  boundKeys,
}: BuildSelectedActivityBatchInput): {
  activities: ExtraActivity[];
  session: LocalSession | null;
} {
  const sessionId = destination === "session"
    ? `${date}-session-selected-${sessionNumber}-${stamp}`
    : null;
  const bound = boundKeys instanceof Set ? boundKeys : new Set(boundKeys ?? []);
  const bindAll = !boundKeys && Boolean(loopContext);
  const activities = items.map((item, index): ExtraActivity => {
    const id = `${date}-extra-${slugify(item.title)}-${stamp}-${index}`;
    const questionId = item.questionId ?? `personal-${item.type}-${slugify(item.title)}`;
    const bindThis = Boolean(loopContext) && (bindAll || bound.has(item.key));
    return {
      schemaVersion: 2,
      id,
      questionId,
      date,
      source: "extra",
      type: item.type,
      ...(item.type === "leetcode" ? { recordKind: "attempt" as const } : {}),
      title: item.title,
      ...(item.url ? { url: item.url } : {}),
      ...(item.prompt ? { prompt: item.prompt } : item.type !== "leetcode" ? { prompt: item.title } : {}),
      allocatedSeconds: item.minutes * 60,
      ...(sessionId ? { sessionId } : {}),
      timerGroupId: sessionId ? `${sessionId}-${timerGroupSuffix(item.type)}` : id,
      timingSource: "website",
      status: "planned",
      ...(item.topics.length ? { notes: item.topics.join(", ") } : {}),
      ...(bindThis && loopContext ? { loopContext } : {}),
    };
  });

  const session = sessionId ? {
    id: sessionId,
    date,
    label: `Session ${sessionNumber}`,
    source: "extra" as const,
    allocatedSeconds: activities.reduce((total, activity) => total + activity.allocatedSeconds, 0),
    activityIds: activities.map((activity) => activity.id),
  } : null;

  return { activities, session };
}

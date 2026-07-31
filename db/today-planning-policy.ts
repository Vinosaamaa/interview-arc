import type { QuestionBankItem } from "../app/content-types";

export type PlanningSpecialty = "leetcode" | "system_design" | "behavioral";
export type PlanningSort = "frequency" | "recent" | "acceptance";
export type PlanningDirection = "asc" | "desc";
export type PlanningAttention =
  | "due"
  | "needs_review"
  | "solved"
  | "helped"
  | "failed"
  | "todo";

export type PlanningCatalogItem = QuestionBankItem & {
  eligible: boolean;
  disabledReason: string | null;
  starred: boolean;
  lastCompletedAt: number | null;
  attention: PlanningAttention[];
};

type CatalogOptions = {
  search?: string;
  starredQuestionIds?: Set<string>;
  starredOnly?: boolean;
  levels?: Set<"easy" | "medium" | "hard">;
  attentionFilters?: Set<PlanningAttention>;
  attentionByQuestionId?: Map<string, Set<PlanningAttention>>;
  sort?: PlanningSort;
  direction?: PlanningDirection;
  page?: number;
  pageSize?: number;
  blockedQuestionIds?: Set<string>;
  recencyByQuestionId?: Map<string, number>;
};

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function level(question: QuestionBankItem): "easy" | "medium" | "hard" | null {
  if (question.difficulty) return question.difficulty;
  if (question.complexity === "very_easy" || question.complexity === "easy") return "easy";
  if (question.complexity === "medium") return "medium";
  if (question.complexity === "hard" || question.complexity === "very_hard") return "hard";
  return null;
}

function frequency(question: QuestionBankItem) {
  if (question.companySignals?.length) {
    return Math.max(
      ...question.companySignals.map((signal) => (
        signal.frequencyScore / Math.max(1, signal.frequencyScale)
      )),
    );
  }
  if (question.frequency === "high") return 1;
  if (question.frequency === "medium") return 0.5;
  if (question.frequency === "low") return 0.25;
  return -1;
}

export function filterPlanningCatalog(
  questions: QuestionBankItem[],
  options: CatalogOptions = {},
) {
  const query = normalized(options.search ?? "");
  const starred = options.starredQuestionIds ?? new Set<string>();
  const blocked = options.blockedQuestionIds ?? new Set<string>();
  const recency = options.recencyByQuestionId ?? new Map<string, number>();
  const attentionByQuestionId = options.attentionByQuestionId ?? new Map();
  const direction = options.direction === "asc" ? 1 : -1;
  const sort = options.sort ?? "frequency";
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 30)));

  const candidates = questions
    .filter((question) => question.active)
    .map((question): PlanningCatalogItem => ({
      ...question,
      eligible: !blocked.has(question.id),
      disabledReason: blocked.has(question.id) ? "Already on Today" : null,
      starred: starred.has(question.id),
      lastCompletedAt: recency.get(question.id) ?? null,
      attention: [
        ...(attentionByQuestionId.get(question.id)
          ?? new Set<PlanningAttention>(["todo"])),
      ],
    }));

  const attentionCounts = Object.fromEntries(
    (["due", "needs_review", "solved", "helped", "failed", "todo"] as PlanningAttention[])
      .map((attention) => [
        attention,
        candidates.filter((question) => question.attention.includes(attention)).length,
      ]),
  );
  const difficultyCounts = Object.fromEntries(
    (["easy", "medium", "hard"] as const).map((difficulty) => [
      difficulty,
      candidates.filter((question) => level(question) === difficulty).length,
    ]),
  );

  const filtered = candidates
    .filter((question) => {
      if (!query) return true;
      return normalized([
        question.title,
        question.prompt ?? "",
        ...(question.topics ?? []),
        ...(question.tags ?? []),
        ...(question.companyTags ?? []),
      ].join(" ")).includes(query);
    })
    .filter((question) => !options.starredOnly || starred.has(question.id))
    .filter((question) => !options.levels?.size || (
      level(question) != null && options.levels.has(level(question)!)
    ))
    .filter((question) => {
      const filters = options.attentionFilters ?? new Set<PlanningAttention>();
      const review = [...filters].filter(
        (filter) => filter === "due" || filter === "needs_review",
      );
      const result = [...filters].filter((filter) => !review.includes(filter));
      return (review.length === 0 || review.some((filter) => question.attention.includes(filter)))
        && (result.length === 0 || result.some((filter) => question.attention.includes(filter)));
    })
    .sort((left, right) => {
      let comparison = 0;
      if (sort === "acceptance") {
        comparison = (left.acceptanceRate ?? -1) - (right.acceptanceRate ?? -1);
      } else if (sort === "recent") {
        comparison = (left.lastCompletedAt ?? -1) - (right.lastCompletedAt ?? -1);
      } else {
        comparison = frequency(left) - frequency(right);
      }
      return comparison === 0
        ? left.title.localeCompare(right.title)
        : comparison * direction;
    });

  const offset = (page - 1) * pageSize;
  return {
    items: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filtered.length,
    hasMore: offset + pageSize < filtered.length,
    attentionCounts,
    difficultyCounts,
  };
}

export type PlanningSelection =
  | {
      kind: "practice";
      specialty: PlanningSpecialty;
      questionId?: string;
      title: string;
      url?: string;
      prompt?: string;
      minutes: number;
      topics?: string[];
    }
  | {
      kind: "focus";
      focusCategory: "job_applications";
      title: string;
      minutes: number;
      note?: string;
    };

type BuildPlanningBatchInput = {
  date: string;
  workbenchId: string;
  mutationId: string;
  destination: "standalone" | "session";
  sessionNumber: number;
  selections: PlanningSelection[];
};

function idPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}

export function buildPlanningBatch(input: BuildPlanningBatchInput) {
  const suffix = idPart(input.mutationId);
  const sessionId = input.destination === "session"
    ? `${input.date}-session-voice-${suffix}`
    : null;
  const activities: Array<Record<string, unknown> & { id: string; sessionId?: string }> = [];
  const focusBlocks: Array<{
    id: string;
    date: string;
    focusCategory: "job_applications";
    title: string;
    plannedSeconds: number;
    note?: string;
  }> = [];

  input.selections.forEach((selection, index) => {
    const id = `${input.date}-${selection.kind === "focus" ? "focus" : "extra"}-voice-${suffix}-${index}`;
    if (selection.kind === "focus") {
      focusBlocks.push({
        id,
        date: input.date,
        focusCategory: selection.focusCategory,
        title: selection.title,
        plannedSeconds: selection.minutes * 60,
        ...(selection.note ? { note: selection.note } : {}),
      });
      return;
    }
    const questionId = selection.questionId
      ?? `personal-${selection.specialty}-${idPart(selection.title)}`;
    activities.push({
      schemaVersion: 2,
      id,
      questionId,
      date: input.date,
      source: "extra",
      type: selection.specialty,
      ...(selection.specialty === "leetcode" ? { recordKind: "attempt" } : {}),
      title: selection.title,
      ...(selection.url ? { url: selection.url } : {}),
      ...(selection.prompt
        ? { prompt: selection.prompt }
        : selection.specialty !== "leetcode" ? { prompt: selection.title } : {}),
      allocatedSeconds: selection.minutes * 60,
      ...(sessionId ? { sessionId } : {}),
      timerGroupId: sessionId ?? id,
      timingSource: "website",
      status: "planned",
      ...((selection.topics?.length ?? 0) > 0
        ? { notes: selection.topics!.join(", ") }
        : {}),
    });
  });

  const activityIds = [
    ...activities.map((activity) => activity.id),
    ...focusBlocks.map((block) => block.id),
  ];
  const allocatedSeconds = input.selections.reduce(
    (total, selection) => total + selection.minutes * 60,
    0,
  );
  const session = sessionId ? {
    id: sessionId,
    date: input.date,
    label: `Session ${input.sessionNumber}`,
    source: "extra" as const,
    allocatedSeconds,
    activityIds,
    workbenchId: input.workbenchId,
  } : null;

  return { activities, focusBlocks, session };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export async function planningRequestFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

"use client";

import { Fragment, type AnimationEvent, type FormEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { groupTranscriptTurns } from "./transcript-groups";
import {
  buildSelectedActivityBatch,
  type ActivityBatchDestination,
  type SelectedActivity,
} from "./activity-batch";
import { findExactPastSnapshot, orderPastReaderSections, retainLoadedPastSnapshot } from "./behavioral-final-answer-view";
import type {
  ContentArtifact,
  ContentIndex,
  JournalActivity,
  PracticeSession,
  QuestionBankItem,
} from "./content-types";
import {
  CODING_SESSION_MINUTES,
  elapsed,
  formatClock,
  INTERVIEW_SESSION_MINUTES,
  overtime,
  remaining,
  SESSION_SECONDS,
  sessionAllocationSeconds,
  type ActivityType,
  type ExtraActivity,
  type FocusBlock,
  type LocalSession,
  type Outcome,
  type PracticeNote,
  type PublicationStatus,
  type ReviewSchedule,
  type FinalizationSummary,
  type AudioClip,
  type DeliveryAnalysis,
  type TimerDraft,
  type TranscriptTurn,
  type LeetCodeCodeAttempt,
  type InteractionModeSummary,
  type InteractionModeTransitionProjection,
} from "./live-types";
import { careerHeatLevel, type CareerJob, type CareerSummary, type JobStatus } from "./career-work";
import { useLiveState, useReadOnlyLiveState } from "./live-sync";
import { emptyJournal } from "./current-day";
import { ArrivalRitual, PetalField } from "./arrival-ritual";
import { useAmbientSound } from "./ambient-sound";
import { MusicPlaylist } from "./music-playlist";
import {
  averageEffortBreakdown,
  bankReaderHref,
  journeyHrefWithoutReader,
  journeyReaderHref,
  loopWorkspaceHref,
  pastReaderHref,
  pastSolutionReaderHref,
  reviewReaderHref,
  reviewSolutionReaderHref,
  readerDepthAfterNestedClose,
  readerClosePlan,
  readBankReaderState,
  readJourneyReaderState,
  readLoopWorkspaceState,
  readPastReaderState,
  readReviewReaderState,
  readWorkspaceRouteView,
  uniqueJourneyEntries,
  workspaceViewHref,
  type WorkspaceRouteView,
} from "./journey-insights";
import { readMasterPanePreference, writeMasterPanePreference } from "./ui-preferences";
import { acquireDocumentScrollLock, documentScrollLockRequired } from "./document-scroll-policy";
import { effectiveProfileTags, isReusableSolutionProfile } from "./solution-profile-policy";
import { isPastAttemptArtifact } from "./past-artifact-policy";
import BehavioralFoundation from "./behavioral-foundation";
import BehavioralTargetBindings from "./behavioral-target-bindings";
import BehavioralTargetDesk from "./behavioral-target-desk";
import BankDomainOverview from "./bank-domain-overview";
import CareerMaterialsWorkspace from "./career-materials-workspace";
import InterviewPageHero from "./interview-page-hero";
import LearnWorkspace from "./learn-workspace";
import type { LearnDestination } from "./learn-workspace-model";
import { activityLifecycleState } from "./activity-state";
import {
  interactionModeClassificationLabel,
  isRecordedInteractionMode,
  matchesInteractionModeFilter,
  selectableInteractionModes,
} from "./interaction-mode-view";
import {
  formatPracticeTimerTimestamp,
  formatPracticeTimestamp,
  practiceDateAt,
  practicePeriodAt,
  PRACTICE_TIME_ZONE,
} from "./practice-time";
import ReviewQueueView from "./review-queue-view";
import { LoopJourneyFactsPanel, LoopsWorkspace } from "./loops-workspace";
import {
  buildReviewQueue,
  reviewStreakDays,
  type ReviewQueueAttempt,
  type ReviewQueueItem,
} from "../db/review-queue-policy";
import type { BehavioralFinalAnswerProjection } from "../db/behavioral-final-answer";
import type { BehavioralPracticeScenarioProjection } from "../db/behavioral-practice-scenario";
import type { BehavioralAttemptAnalysisProjection } from "../db/behavioral-attempt-analysis";
import type { ActivityResumeContext } from "../db/activity-resume-context";
import type { InteractionModeClassification } from "../db/interaction-mode-classification";

type InterviewView = "today" | "loops" | "journey" | "reviews" | "library" | "banks" | "materials";
type View = InterviewView | "learn";
const INTERVIEW_NAV_ITEMS: ReadonlyArray<readonly [InterviewView, string]> = [
  ["today", "Today"],
  ["loops", "Loops"],
  ["reviews", "Reviews"],
  ["library", "Past"],
  ["banks", "Banks"],
  ["journey", "Journey"],
];
const INTERVIEW_VIEW_TITLES: Record<InterviewView, string> = {
  today: "Interview · Today",
  loops: "Interview · Loops",
  reviews: "Interview · Reviews",
  library: "Interview · Past",
  banks: "Interview · Banks",
  journey: "Interview · Journey",
  materials: "Interview · Career Materials",
};
const LEARN_NAV_ITEMS: ReadonlyArray<readonly [LearnDestination, string]> = [
  ["today", "Today"],
  ["courses", "Courses"],
  ["history", "History"],
  ["analytics", "Statistics"],
];
const LEARN_VIEW_TITLES: Record<LearnDestination, string> = {
  today: "Learn · Today",
  courses: "Learn · Courses",
  history: "Learn · History",
  analytics: "Learn · Statistics",
};

function readLearnDestination(currentHref: string): LearnDestination {
  const destination = new URL(currentHref).searchParams.get("learn");
  return destination === "courses" || destination === "history" || destination === "analytics" ? destination : "today";
}
type ComposerMode = "session" | "activity";
type JourneyRange = 30 | 90 | 365 | "all";
type JourneyMetric = "activities" | "time";
type JourneyHeatmapView = "all" | ActivityType | "job_applications";
type CareerWorkPayload = {
  focus: {
    totalSeconds: number;
    plannedSeconds: number;
    completedBlocks: number;
    focusDays: number;
    currentStreak: number;
    longestStreak: number;
    averageCompletedSeconds: number;
    byDate: Record<string, number>;
  };
  jobJourney: {
    status: "available" | "unavailable";
    stale: boolean;
    summary: CareerSummary | null;
    jobs: { jobs: CareerJob[]; page: { nextCursor: string | null; hasMore: boolean } } | null;
    message?: string;
  };
};
type LibraryAttentionFilter = "due" | "needs_review" | "solved" | "helped" | "failed" | "notes";
type LibraryModeFilter = string;
type BankAttentionFilter = "due" | "needs_review" | "solved" | "helped" | "failed" | "todo" | "notes";
type ComposerAttentionFilter = "due" | "needs_review" | "solved" | "helped" | "failed" | "todo";
type StagedActivity = SelectedActivity;
type DocumentPiP = { requestWindow: (options?: { width?: number; height?: number }) => Promise<Window> };
type HighlightColor = "yellow" | "green" | "pink";
type HighlightNote = { id: string; highlightId: string; body: string; createdAt: number; updatedAt: number };
type ContentHighlight = { id: string; scopeType: "activity" | "solution"; scopeId: string; quote: string; prefix: string; suffix: string; color: HighlightColor; note: string; notes: HighlightNote[]; createdAt: number; updatedAt: number };
type AnnotationPosition = { x: number; y: number; placement: "above" | "below" };
type ChartTooltipModel = {
  id: string;
  title: string;
  body: string;
  foot?: string;
  anchor: { left: number; right: number; top: number; bottom: number; width: number };
};
type PendingHighlight = { quote: string; prefix: string; suffix: string; position: AnnotationPosition };
type ReaderMemory = {
  groups: Record<string, boolean>;
  anchorId?: string;
  anchorOffset?: number;
  scrollTop?: number;
};
type ListSurface = "library" | "banks";
type ListPosition = {
  pageScrollTop: number;
  listScrollTop: number;
  anchorId?: string;
  anchorOffset?: number;
  centerAnchor?: boolean;
};
type ListMode = "main" | "pane";
type MasterPaneState = Record<ListSurface, boolean>;
type ListPositionState = Record<ListSurface, Record<ListMode, ListPosition>>;
type LifecycleDialog =
  | { kind: "session-results"; sessionId: string; missingCount: number }
  | { kind: "workbench-results"; missingCount: number }
  | { kind: "finish-session"; sessionId: string }
  | { kind: "remove-session"; sessionId: string }
  | null;
type UiToast = { id: number; message: string } | null;
type ComposerSortKey = "frequency" | "recent" | "acceptance";
type ComposerSortDirection = "asc" | "desc";
type ComposerSpecialtyView = {
  query: string;
  attentionFilters: ComposerAttentionFilter[];
  levelFilters: Array<"easy" | "medium" | "hard">;
  starFilter: boolean;
  sortKey: ComposerSortKey;
  sortDir: ComposerSortDirection;
  visibleCount: number;
  scrollTop: number;
};
type ComposerSpecialtyViews = Record<ActivityType, ComposerSpecialtyView>;
type WorkspaceUiMemory = {
  libraryTypeFilters?: ActivityType[];
  libraryAttentionFilters?: LibraryAttentionFilter[];
  libraryModeFilters?: LibraryModeFilter[];
  librarySearch?: string;
  libraryStarFilter?: boolean;
  bankTypeFilters?: ActivityType[];
  bankAttentionFilters?: BankAttentionFilter[];
  bankLevelFilters?: Array<"easy" | "medium" | "hard">;
  bankSortKey?: "frequency" | "recent" | "acceptance";
  bankSortDir?: "asc" | "desc";
  bankSearch?: string;
  bankTagFilters?: string[];
  bankStarFilter?: "all" | "starred";
  bankTopicsExpanded?: boolean;
};
type ComposerState = {
  open: boolean;
  mode: ComposerMode;
  type: ActivityType;
  query: string;
  selectedId: string;
  selectedActivities: StagedActivity[];
  focusSelected: boolean;
  focusMinutes: string;
  minutes: string;
  customOpen: boolean;
  customEditingKey: string;
  customTitle: string;
  customUrl: string;
  customPrompt: string;
  customMinutes: string;
  reviewOpen: boolean;
  batchDestination: ActivityBatchDestination;
  editingId: string;
  editingSessionId: string;
  sessionCoding: number;
  sessionSystemDesign: number;
  sessionBehavioral: number;
};
type LogEntry = {
  id: string;
  questionId?: string;
  date: string;
  type: ActivityType;
  title: string;
  subtitle: string;
  status: "planned" | "running" | "completed" | "published";
  outcome?: Outcome;
  elapsedSeconds: number;
  allocatedSeconds: number;
  reviewDates?: string[];
  reviewOfActivityId?: string;
  reviewReason?: ReviewSchedule["reason"];
  url?: string;
  artifact?: ContentArtifact;
  startedAt?: string;
  endedAt?: string;
  sessionId?: string;
  personalNote?: string;
  pinnedNotes?: PracticeNote[];
  review?: ReviewSchedule;
  finalization?: FinalizationSummary;
  transcriptTurns?: TranscriptTurn[];
  audioClips?: AudioClip[];
  deliveryAnalyses?: DeliveryAnalysis[];
  codeAttempts?: LeetCodeCodeAttempt[];
  finalAnswer?: BehavioralFinalAnswerProjection | null;
  practiceScenarios?: BehavioralPracticeScenarioProjection | null;
  behavioralAnalysis?: BehavioralAttemptAnalysisProjection | null;
  resumeContext?: ActivityResumeContext | null;
  interactionModeClassification?: {
    snapshotRevision: number;
    classification: InteractionModeClassification;
  } | null;
  interactionModeTransitions?: InteractionModeTransitionProjection[];
};

const EMPTY_COMPOSER: ComposerState = {
  open: false,
  mode: "activity",
  type: "leetcode",
  query: "",
  selectedId: "",
  selectedActivities: [],
  focusSelected: false,
  focusMinutes: "60",
  minutes: "30",
  customOpen: false,
  customEditingKey: "",
  customTitle: "",
  customUrl: "",
  customPrompt: "",
  customMinutes: "30",
  reviewOpen: false,
  batchDestination: "standalone",
  editingId: "",
  editingSessionId: "",
  sessionCoding: 6,
  sessionSystemDesign: 1,
  sessionBehavioral: 1,
};
const COMPOSER_SORT_OPTIONS = [
  { key: "frequency" as const, label: "Frequency", icon: "freq" },
  { key: "recent" as const, label: "Recent", icon: "recent" },
  { key: "acceptance" as const, label: "Acceptance", icon: "accept" },
];

function createComposerSpecialtyViews(): ComposerSpecialtyViews {
  const createView = (): ComposerSpecialtyView => ({
    query: "",
    attentionFilters: [],
    levelFilters: [],
    starFilter: false,
    sortKey: "frequency",
    sortDir: "asc",
    visibleCount: 20,
    scrollTop: 0,
  });
  return {
    leetcode: createView(),
    system_design: createView(),
    behavioral: createView(),
  };
}
const OUTCOME_ORDER: (Outcome | undefined)[] = [undefined, "solved", "solved_after_reviewing_approach", "failed"];

function readSessionJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.sessionStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function publicationLabel(status: PublicationStatus) {
  if (status === "ready") return "Ready for journal";
  if (status === "published") return "In journal";
  return "Finish to journal";
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function readableDate(date: string, compact = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: compact ? "short" : "long",
    day: "numeric",
    year: "numeric",
    ...(compact ? {} : { weekday: "long" as const }),
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string) {
  return Math.round((Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000);
}

function typeLabel(type: ActivityType) {
  if (type === "leetcode") return "Coding";
  if (type === "system_design") return "System design";
  return "Behavioral";
}

function typeMark(type: ActivityType) {
  if (type === "leetcode") return "C";
  if (type === "system_design") return "S";
  return "B";
}

function outcomeLabel(outcome?: Outcome) {
  if (outcome === "solved") return "Solved";
  if (outcome === "solved_after_reviewing_approach") return "Solved with help";
  if (outcome === "failed") return "Failed";
  return "No result yet";
}

function resultLabel(outcome: Outcome | undefined, activityType: ActivityType) {
  void activityType;
  return outcomeLabel(outcome);
}

function plainText(markdown: string) {
  return markdown.replace(/```[\s\S]*?```/g, "Code example").replace(/[*_`>#-]/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "practice";
}

function normalizedIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function entryMatchesQuestion(entry: LogEntry, type: ActivityType, question: QuestionBankItem) {
  return entry.type === type && (
    entry.questionId === question.id ||
    Boolean(question.url && entry.url && question.url.replace(/\/$/, "") === entry.url.replace(/\/$/, "")) ||
    normalizedIdentity(question.title) === normalizedIdentity(entry.title)
  );
}

function latestFinishedAttempt(entries: LogEntry[], type: ActivityType, question: QuestionBankItem) {
  return entries
    .filter((entry) => entryMatchesQuestion(entry, type, question))
    .sort((left, right) => {
      const leftStamp = Date.parse(left.endedAt ?? `${left.date}T23:59:59Z`);
      const rightStamp = Date.parse(right.endedAt ?? `${right.date}T23:59:59Z`);
      return rightStamp - leftStamp;
    })[0];
}

function blockKeysForQuestion(question: QuestionBankItem) {
  const keys = [`id:${question.id}`, `title:${normalizedIdentity(question.title)}`, `slug:${slugify(question.title)}`];
  if (question.url) keys.push(`url:${question.url.replace(/\/$/, "").toLowerCase()}`);
  return keys;
}

function addActivityToBlocked(blocked: Set<string>, activity: { id: string; questionId?: string; title: string; url?: string }) {
  if (activity.questionId) blocked.add(`id:${activity.questionId}`);
  blocked.add(`title:${normalizedIdentity(activity.title)}`);
  blocked.add(`slug:${slugify(activity.title)}`);
  if (activity.url) blocked.add(`url:${activity.url.replace(/\/$/, "").toLowerCase()}`);
  // Session rows look like `YYYY-MM-DD-session-N-<stamp>-<questionId>`.
  const withoutDate = activity.id.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const sessionMatch = withoutDate.match(/^session-\d+-\d+-\d+-(.+)$/);
  const extraMatch = withoutDate.match(/^extra-(.+?)(?:-\d+)?$/);
  const questionId = sessionMatch?.[1] ?? extraMatch?.[1];
  if (questionId) blocked.add(`id:${questionId}`);
}

function isQuestionBlocked(question: QuestionBankItem, blocked: Set<string>) {
  return blockKeysForQuestion(question).some((key) => blocked.has(key));
}

// Higher is more frequent. Company frequency scores win when present; otherwise
// map behavioral high/medium/low. Unknown frequency sorts last.
function frequencyRank(question: QuestionBankItem) {
  if (question.companySignals?.length) {
    return Math.max(
      ...question.companySignals.map((signal) => signal.frequencyScore / Math.max(1, signal.frequencyScale)),
    );
  }
  if (question.frequency === "high") return 1;
  if (question.frequency === "medium") return 0.5;
  if (question.frequency === "low") return 0.25;
  return -1;
}

function composerQuestionMetadata(question: QuestionBankItem) {
  const metadata: string[] = [];
  if (question.difficulty) {
    metadata.push(question.difficulty[0].toUpperCase() + question.difficulty.slice(1));
  }
  if (typeof question.acceptanceRate === "number") {
    metadata.push(`${question.acceptanceRate.toFixed(1)}% acceptance`);
  }
  const strongestCompanySignal = question.companySignals?.reduce((strongest, signal) => {
    if (!strongest) return signal;
    const strength = signal.frequencyScore / Math.max(1, signal.frequencyScale);
    const strongestStrength = strongest.frequencyScore / Math.max(1, strongest.frequencyScale);
    return strength > strongestStrength ? signal : strongest;
  }, question.companySignals[0]);
  if (strongestCompanySignal) {
    metadata.push(`${strongestCompanySignal.frequencyScore}/${strongestCompanySignal.frequencyScale} frequency`);
  } else if (question.frequency) {
    metadata.push(`${question.frequency[0].toUpperCase() + question.frequency.slice(1)} frequency`);
  }
  metadata.push(...question.topics);
  return metadata.join(" · ");
}

function pickQuestionsByFrequency(pool: QuestionBankItem[], count: number, blocked: Set<string>, salt = "") {
  if (count <= 0) return [] as QuestionBankItem[];
  const candidates = pool
    .filter((question) => question.active && !isQuestionBlocked(question, blocked))
    .sort((left, right) => {
      const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      const rankDiff = frequencyRank(right) - frequencyRank(left);
      if (rankDiff !== 0) return rankDiff;
      const leftKey = `${salt}:${left.id}:${left.title}`;
      const rightKey = `${salt}:${right.id}:${right.title}`;
      return leftKey.localeCompare(rightKey);
    });
  return candidates.slice(0, count);
}

function questionLevel(question: QuestionBankItem): "easy" | "medium" | "hard" | null {
  if (question.difficulty) return question.difficulty;
  if (question.complexity === "very_easy" || question.complexity === "easy") return "easy";
  if (question.complexity === "medium") return "medium";
  if (question.complexity === "hard" || question.complexity === "very_hard") return "hard";
  return null;
}

function recencyScore(question: QuestionBankItem) {
  const stamps = (question.companySignals ?? [])
    .map((signal) => Date.parse(signal.capturedAt))
    .filter((value) => Number.isFinite(value));
  return stamps.length ? Math.max(...stamps) : 0;
}

function displayComplexity(value?: QuestionBankItem["complexity"]) {
  return value?.replace("_", " ");
}

function meaningfulSubtitle(value?: string) {
  const normalized = value?.trim();
  return normalized && !/^[o0]$/i.test(normalized) ? normalized : "";
}

function isResumeCurriculumQuestion(question: QuestionBankItem) {
  const tags = [...question.topics, ...(question.tags ?? [])];
  return tags.includes("resume-foundation") || tags.includes("resume-bullet");
}

function inferredQuestionTags(type: ActivityType, question: QuestionBankItem) {
  const explicit = [...question.topics, ...(question.tags ?? [])].filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];
  const text = `${question.title} ${question.prompt ?? ""}`.toLowerCase();
  const rules: Array<[RegExp, string]> = type === "leetcode"
    ? [
        [/island|grid|matrix|flood|maze/, "Graph traversal"],
        [/course schedule|dependency|topological/, "Topological sort"],
        [/tree|bst|ancestor|path sum/, "Trees"],
        [/substring|subarray|window/, "Sliding window"],
        [/interval|meeting|calendar/, "Intervals"],
        [/linked list|lru|cache/, "Linked structures"],
        [/heap|priority|top k|median/, "Heap"],
        [/binary search|rotated|search/, "Binary search"],
        [/dynamic|subsequence|partition|coin|robber/, "Dynamic programming"],
        [/permutation|combination|n-queens|backtrack/, "Backtracking"],
        [/graph|network|clone|connected/, "Graphs"],
        [/trie|word search|prefix/, "Trie"],
        [/stack|parentheses|histogram|rain water/, "Stack"],
        [/two sum|3sum|4sum|pair/, "Two pointers"],
        [/sort|merge/, "Sorting"],
        [/string|anagram|palindrome/, "Strings"],
        [/array|duplicate|missing/, "Arrays"],
      ]
    : type === "system_design"
      ? [
          [/feed|timeline|social|facebook|twitter|instagram|tiktok/, "Feed systems"],
          [/chat|message|notification|email/, "Messaging"],
          [/search|autocomplete|typeahead/, "Search"],
          [/payment|bank|wallet|checkout|billing/, "Payments"],
          [/video|youtube|stream|media/, "Media delivery"],
          [/location|uber|maps|nearby|delivery/, "Geospatial"],
          [/storage|drive|dropbox|file|photo/, "Storage"],
          [/metric|log|monitor|analytics|counter/, "Observability"],
          [/rate limit|cache|cdn|proxy/, "Traffic control"],
          [/booking|reservation|ticket/, "Reservations"],
          [/auth|permission|security/, "Identity & security"],
        ]
      : [];
  const inferred = rules.filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag);
  return inferred.length ? [...new Set(inferred)] : [type === "leetcode" ? "General coding" : type === "system_design" ? "Distributed systems" : "Behavioral signal"];
}

function Icon({ name }: { name: "close" | "star" | "book" | "sidebar" | "outline" | "plus" | "minus" | "filter" | "sort" | "note" | "edit" | "trash" | "chevron" | "flag" | "play" | "pause" | "clips" | "volume" }) {
  const paths: Record<typeof name, ReactNode> = {
    close: <><path d="M5 5l14 14M19 5 5 19" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M6 8h.01M6 12h.01" /></>,
    outline: <><path d="M5 6h2M10 6h9M5 12h2M10 12h9M5 18h2M10 18h9" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    minus: <path d="M5 12h14" />,
    filter: <path d="M4 6h16l-6.2 7v5l-3.6 2v-7L4 6Z" />,
    sort: <><path d="M8 5v14M5 8l3-3 3 3M16 19V5m-3 11 3 3 3-3" /></>,
    note: <><path d="M5 3h11l3 3v15H5V3Z" /><path d="M15 3v4h4M8 11h8M8 15h8" /></>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" /><path d="m13.5 7 3.5 3.5" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    flag: <><path d="M6 21V4" /><path d="M6 5h9.5l-1.5 3 1.5 3H6" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    clips: <><rect x="5" y="7" width="14" height="12" rx="2" /><path d="M8 7V5h8v2M9 11h6M9 15h4" /></>,
    volume: <><path d="M5 10v4h3l4 4V6L8 10H5Z" /><path d="M16 9c1 1 1 5 0 6M19 7c2 3 2 7 0 10" /></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ChartTooltip({ model, onDismiss }: { model: ChartTooltipModel; onDismiss: () => void }) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: model.anchor.left, top: model.anchor.bottom + 10 });
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const margin = 12;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, model.anchor.left + model.anchor.width / 2 - width / 2));
    const top = model.anchor.top - height - 10 >= margin
      ? model.anchor.top - height - 10
      : Math.min(window.innerHeight - height - margin, model.anchor.bottom + 10);
    setPosition({ left, top });
  }, [model]);
  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    const dismissOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !tooltipRef.current?.contains(event.target)) onDismiss();
    };
    window.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    document.addEventListener("pointerdown", dismissOnOutside);
    return () => {
      window.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
      document.removeEventListener("pointerdown", dismissOnOutside);
    };
  }, [onDismiss]);
  return createPortal(<div className="journey-chart-tooltip" id={model.id} role="tooltip" ref={tooltipRef} style={position}><strong>{model.title}</strong><span>{model.body}</span>{model.foot && <small>{model.foot}</small>}</div>, document.body);
}

function titleFromUrlPath(url: URL) {
  const ignored = new Set(["question", "questions", "problem", "problems", "practice", "behavior", "design"]);
  const segment = url.pathname.split("/").filter(Boolean).reverse().find((part) => !ignored.has(part.toLowerCase())) ?? url.hostname.replace(/^www\./, "");
  const acronyms: Record<string, string> = { lru: "LRU", bfs: "BFS", dfs: "DFS", sql: "SQL", xor: "XOR", api: "API", url: "URL", cdn: "CDN" };
  return decodeURIComponent(segment).split(/[-_]+/).filter(Boolean).map((word) => acronyms[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

function deriveQuestionFromUrl(value: string, type: ActivityType, bank: QuestionBankItem[]) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    let normalizedUrl = `${url.origin}${url.pathname}`.replace(/\/$/, "");
    if (type === "leetcode") {
      if (!/(^|\.)leetcode\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/problems\/([a-z0-9-]+)\/?/i);
      if (!match) return null;
      normalizedUrl = `https://leetcode.com/problems/${match[1].toLowerCase()}`;
    }
    const known = bank.find((question) => question.url?.replace(/\/$/, "").toLowerCase() === normalizedUrl.toLowerCase());
    if (known) return { questionId: known.id, title: known.title, url: known.url ?? normalizedUrl, targetMinutes: known.targetMinutes, prompt: known.prompt };
    return {
      title: titleFromUrlPath(url),
      url: normalizedUrl,
      targetMinutes: type === "leetcode" ? 30 : type === "system_design" ? 60 : 60,
    };
  } catch {
    return null;
  }
}

function ActivityTimer({
  activity,
  timer,
  now,
  onToggle,
  onComplete,
  locked = false,
}: {
  activity: Pick<JournalActivity, "id" | "title">;
  timer?: TimerDraft;
  now: number;
  onToggle: (id: string) => void;
  onComplete: (id: string) => void;
  locked?: boolean;
}) {
  const used = elapsed(timer, now);
  const running = Boolean(timer?.runningSince);
  const complete = Boolean(timer?.completed);
  const started = Boolean(timer?.startedAt);
  return (
    <div className={`activity-timer ${started ? "started" : "unstarted"} ${running ? "running" : ""} ${complete ? "complete" : ""} ${locked ? "locked" : ""}`}>
      <div className="activity-time-copy">
        <span>{complete ? "Final time" : running ? "Running" : timer?.startedAt ? "Paused" : "Stopwatch"}</span>
        <strong>{formatClock(used)}</strong>
      </div>
      <div className="activity-time-actions">
        <button className="start-timer icon-control" onClick={() => onToggle(activity.id)} disabled={complete || locked} aria-label={running ? `Pause ${activity.title}` : `Start ${activity.title}`} title={locked ? "This session is finished" : running ? "Pause stopwatch" : complete ? "Finished activities cannot be resumed" : "Start stopwatch"}>
          <span aria-hidden="true">{running ? "Ⅱ" : "▶"}</span>
        </button>
        <button className="finish-timer icon-control" onClick={() => onComplete(activity.id)} disabled={complete || !started || locked} aria-label={`Finish ${activity.title}`} title={locked ? "This session is finished" : complete ? "Activity finished" : !started ? "Start the stopwatch before finishing" : "Finish and lock stopwatch"}>
          <span aria-hidden="true">{complete ? "✓" : "■"}</span>
        </button>
      </div>
      <small className={`activity-start-time ${started ? "" : "empty"}`} aria-hidden={!started}>
        {timer?.startedAt ? formatPracticeTimerTimestamp(timer.startedAt) : "\u00A0"}
      </small>
    </div>
  );
}

function ActivityStateStamp({ timer }: { timer?: TimerDraft }) {
  const state = activityLifecycleState(timer);
  return (
    <span className={`activity-state-stamp ${state.key}`}>
      <i aria-hidden="true" />
      {state.label}
    </span>
  );
}

function SessionCountdown({
  session,
  timer,
  now,
  onToggle,
  onComplete,
}: {
  session: PracticeSession;
  timer?: TimerDraft;
  now: number;
  onToggle: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const allocated = session.allocatedSeconds ?? SESSION_SECONDS;
  const timeLeft = remaining(timer, now, allocated);
  const overtimeSeconds = overtime(timer, now, allocated);
  const running = Boolean(timer?.runningSince);
  const complete = Boolean(timer?.completed);
  const started = Boolean(timer?.startedAt);
  const progress = Math.min(100, (elapsed(timer, now) / allocated) * 100);
  return (
    <div className={`session-countdown ${running ? "running" : ""} ${complete ? "complete" : ""}`}>
      <div className="countdown-copy">
        <span>{formatDuration(allocated)} session countdown</span>
        <strong>{overtimeSeconds ? `+${formatClock(overtimeSeconds)}` : formatClock(timeLeft)}</strong>
        <small>{complete ? "Session finished" : overtimeSeconds ? `Overtime · ${running ? "still running" : "paused"}` : running ? "Session in progress" : timer?.elapsedSeconds ? "Session paused" : "Ready when you are"}</small>
      </div>
      <div className="countdown-controls">
        <button onClick={() => onToggle(session.id)} disabled={complete} aria-label={running ? `Pause ${session.label}` : `Start ${session.label}`} title={running ? "Pause session countdown" : "Start session countdown"}><span aria-hidden="true">{running ? "Ⅱ" : "▶"}</span></button>
        <button onClick={() => onComplete(session.id)} disabled={complete || !started} aria-label={`Finish ${session.label}`} title={complete ? "Session finished" : !started ? "Start the session countdown before finishing" : "Finish session now"}><span aria-hidden="true">{complete ? "✓" : "■"}</span></button>
      </div>
      <span className="countdown-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
    </div>
  );
}

function SessionCountControl({
  label,
  mark,
  value,
  minutesEach,
  max,
  onChange,
}: {
  label: string;
  mark: string;
  value: number;
  minutesEach: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const contribution = value * minutesEach * 60;
  return (
    <div className="session-count-card">
      <div className="session-count-label">
        <span aria-hidden="true">{mark}</span>
        <strong>{label}</strong>
      </div>
      <input
        className="session-count-value"
        type="number"
        min="0"
        max={max}
        value={value}
        onChange={(event) => onChange(Math.min(max, Math.max(0, Math.floor(Number(event.target.value) || 0))))}
        aria-label={`${label} count`}
      />
      <span className="session-contribution">{minutesEach} min each · {formatDuration(contribution)}</span>
      <div className="count-stepper">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0} aria-label={`Remove one ${label.toLowerCase()}`}>−</button>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Add one ${label.toLowerCase()}`}>＋</button>
      </div>
    </div>
  );
}

function ResultFlag({
  outcome,
  activityType,
  onChange,
  disabled = false,
  required = false,
}: {
  outcome?: Outcome;
  activityType: ActivityType;
  onChange: (outcome?: Outcome) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const currentIndex = OUTCOME_ORDER.indexOf(outcome);
  const next = OUTCOME_ORDER[(currentIndex + 1) % OUTCOME_ORDER.length];
  return (
    <div className={`result-flag-wrap ${required ? "result-required" : ""}`}>
      <button className={`result-flag ${outcome ?? "unset"}`} onClick={() => onChange(next)} disabled={disabled} aria-label={`Result: ${resultLabel(outcome, activityType)}. Select the next result.`} title={disabled ? "Start the activity stopwatch before choosing a result" : "Change result"}>
        <Icon name="flag" />
      </button>
      <div className="result-legend" role="tooltip">
        <strong>Result flag</strong>
        <span><i className="unset" /> Not set</span>
        <span><i className="solved" /> Solved</span>
        <span><i className="reviewed" /> Solved with help</span>
        <span><i className="failed" /> Failed</span>
      </div>
    </div>
  );
}

function StaticResultFlag({ outcome, label }: { outcome?: Outcome; label?: string }) {
  const text = label ?? outcomeLabel(outcome);
  return (
    <span className={`static-result-flag ${outcome ?? "unset"}`} aria-label={`Latest result: ${text}`} title={text}>
      <Icon name="flag" />
    </span>
  );
}

function PublicationControl({
  status,
}: {
  status: PublicationStatus;
}) {
  return (
    <div
      className={`publication-control ${status}`}
      data-tooltip={status === "published" ? "A permanent solution or transcript exists in your journal." : status === "ready" ? "This finished activity will be included automatically the next time its specialist publishes." : "Finish the stopwatch to include this activity in the specialist journal queue."}
      aria-label={publicationLabel(status)}
      title={status === "published" ? "The specialist task created the permanent journal record" : status === "ready" ? "Automatically included in the next specialist publication" : "Finish the stopwatch to make this ready for publication"}
    >
      <span aria-hidden="true">{status === "published" ? "✓" : status === "ready" ? "↑" : "◇"}</span>
      {publicationLabel(status)}
    </div>
  );
}

function PipNowPanel({
  activity,
  activityTimer,
  session,
  sessionTimer,
  outcome,
  starred = false,
  activityLocked = false,
  now,
  onToggleActivity,
  onCompleteActivity,
  onToggleSession,
  onCompleteSession,
  onOutcome,
  onToggleStar,
}: {
  activity?: JournalActivity | ExtraActivity | FocusBlock | null;
  activityTimer?: TimerDraft;
  session?: PracticeSession | null;
  sessionTimer?: TimerDraft;
  outcome?: Outcome;
  starred?: boolean;
  activityLocked?: boolean;
  now: number;
  onToggleActivity: (id: string) => void;
  onCompleteActivity: (id: string) => void;
  onToggleSession: (id: string) => void;
  onCompleteSession: (id: string) => void;
  onOutcome: (id: string, outcome?: Outcome) => void;
  onToggleStar: (type: ActivityType, questionId?: string) => void;
}) {
  const focusActivity = activity?.activityClass === "focus_block";
  const sessionAllocated = session?.allocatedSeconds ?? SESSION_SECONDS;
  const sessionLeft = session ? remaining(sessionTimer, now, sessionAllocated) : 0;
  const sessionOvertime = session ? overtime(sessionTimer, now, sessionAllocated) : 0;
  const sessionRunning = Boolean(session && sessionTimer?.runningSince);
  const sessionComplete = Boolean(session && sessionTimer?.completed);
  const sessionStarted = Boolean(sessionTimer?.startedAt);
  const sessionProgress = session ? Math.min(100, (elapsed(sessionTimer, now) / sessionAllocated) * 100) : 0;
  const activityUsed = activity ? elapsed(activityTimer, now) : 0;
  const activityRunning = Boolean(activityTimer?.runningSince);
  const activityComplete = Boolean(activityTimer?.completed);
  const activityStarted = Boolean(activityTimer?.startedAt);
  const live = sessionRunning || activityRunning;

  return (
    <div className={`pip-hud ${live ? "live" : ""}`}>
      <header className="pip-hud-top">
        <div>
          <span className="pip-kicker">{live ? "Live now" : "Standby"}</span>
          <strong>Interview Arc</strong>
        </div>
        <i className={`pip-pulse ${live ? "on" : ""}`} aria-hidden="true" />
      </header>

      {session ? (
        <section className={`pip-clock session ${sessionRunning ? "running" : ""} ${sessionComplete ? "complete" : ""}`}>
          <div className="pip-clock-copy">
            <span>{sessionOvertime ? "Session overtime" : "Session left"}</span>
            <strong>{sessionOvertime ? `+${formatClock(sessionOvertime)}` : formatClock(sessionLeft)}</strong>
            <small>{sessionComplete ? "Finished" : sessionOvertime ? `${session.label} · ${sessionRunning ? "still running" : "paused"}` : sessionRunning ? session.label : `${session.label} · paused`}</small>
          </div>
          <div className="pip-clock-actions">
            <button type="button" className="pip-btn primary" onClick={() => onToggleSession(session.id)} disabled={sessionComplete} aria-label={sessionRunning ? `Pause ${session.label}` : `Start ${session.label}`}>
              <span aria-hidden="true">{sessionRunning ? "Ⅱ" : "▶"}</span>
            </button>
            <button type="button" className="pip-btn" onClick={() => onCompleteSession(session.id)} disabled={sessionComplete || !sessionStarted} aria-label={`Finish ${session.label}`} title={!sessionStarted ? "Start the session countdown before finishing" : "Finish session"}>
              <span aria-hidden="true">{sessionComplete ? "✓" : "■"}</span>
            </button>
          </div>
          <span className="pip-track" aria-hidden="true"><i style={{ width: `${sessionProgress}%` }} /></span>
        </section>
      ) : null}

      {activity ? (
        <section className={`pip-clock activity ${activityRunning ? "running" : ""} ${activityComplete ? "complete" : ""}`}>
          <div className="pip-problem">
            <span className={`type-mark ${focusActivity ? "focus-block" : activity.type}`}>{focusActivity ? "J" : typeMark(activity.type)}</span>
            <div>
              <small>{focusActivity ? "Career focus stopwatch" : `${typeLabel(activity.type)} stopwatch`}</small>
              <strong className="pip-problem-title">{activity.title}</strong>
            </div>
          </div>
          <div className="pip-clock-row">
            <strong className="pip-elapsed">{formatClock(activityUsed)}</strong>
            <div className="pip-clock-actions">
              <button type="button" className="pip-btn primary" onClick={() => onToggleActivity(activity.id)} disabled={activityComplete || activityLocked} aria-label={activityRunning ? `Pause ${activity.title}` : `Start ${activity.title}`}>
                <span aria-hidden="true">{activityRunning ? "Ⅱ" : "▶"}</span>
              </button>
              <button type="button" className="pip-btn" onClick={() => onCompleteActivity(activity.id)} disabled={activityComplete || !activityStarted || (!focusActivity && !outcome) || activityLocked} aria-label={`Finish ${activity.title}`} title={activityLocked ? "This session is finished" : !activityStarted ? "Start the stopwatch before finishing" : !focusActivity && !outcome ? "Choose a result before finishing" : "Finish activity"}>
                <span aria-hidden="true">{activityComplete ? "✓" : "■"}</span>
              </button>
              {!focusActivity && <ResultFlag activityType={activity.type} outcome={outcome} onChange={(next) => onOutcome(activity.id, next)} disabled={!activityStarted || activityComplete || activityLocked} />}
              {!focusActivity && <button
                type="button"
                className={`pip-btn pip-star ${starred ? "starred" : ""}`}
                onClick={() => onToggleStar(activity.type, activity.questionId)}
                disabled={!activity.questionId}
                aria-label={`${starred ? "Unstar" : "Star"} ${activity.title}`}
                aria-pressed={starred}
                title={activity.questionId ? starred ? "Remove from starred problems" : "Keep this problem in your starred review set" : "A stable bank question is required to star this activity"}
              >
                <Icon name="star" />
              </button>}
            </div>
          </div>
          {!focusActivity && activity.url ? <a className="pip-open" href={activity.url} target="_blank" rel="noreferrer">Open problem ↗</a> : null}
        </section>
      ) : (
        <p className="pip-empty">No active problem yet. Add or start one on Today.</p>
      )}
    </div>
  );
}

function StandaloneActivityCard({ children, title, onRemove, removeDisabled = false }: { children: ReactNode; title: string; onRemove: () => void; removeDisabled?: boolean }) {
  return (
    <article className="standalone-activity-card">
      {children}
      <button className={`icon-action danger ${removeDisabled ? "action-locked" : ""}`} onClick={onRemove} aria-disabled={removeDisabled} aria-label={`Remove ${title}`} title={removeDisabled ? "Started activities stay in your history" : "Remove untouched activity"}><Icon name="close" /></button>
    </article>
  );
}

const CODE_KEYWORDS = new Set([
  "abstract", "async", "await", "boolean", "break", "case", "catch", "class", "const", "continue", "def", "do", "else", "enum", "extends", "false", "final", "finally", "float", "for", "from", "if", "implements", "import", "in", "instanceof", "int", "interface", "let", "list", "long", "map", "new", "none", "null", "private", "protected", "public", "raise", "return", "self", "static", "string", "super", "switch", "this", "throw", "true", "try", "var", "void", "while", "yield",
]);

function highlightedCode(code: string) {
  const tokenPattern = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/gm;
  return code.split(tokenPattern).filter(Boolean).map((token, index) => {
    const kind = token.startsWith("//") || token.startsWith("#")
      ? "comment"
      : token.startsWith('"') || token.startsWith("'")
        ? "string"
        : /^\d/.test(token)
          ? "number"
          : CODE_KEYWORDS.has(token.toLowerCase())
            ? "keyword"
            : "plain";
    return kind === "plain" ? token : <span className={`syntax-${kind}`} key={`${index}-${token.slice(0, 8)}`}>{token}</span>;
  });
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return <figure className="code-stage"><figcaption><span>{language || "code"}</span><button type="button" onClick={() => void navigator.clipboard.writeText(code)}>Copy</button></figcaption><pre><code>{highlightedCode(code.replace(/\n$/, ""))}</code></pre></figure>;
}

function DiagramFigure({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const updateZoom = useCallback((amount: number) => {
    setZoom((current) => Math.min(2.4, Math.max(.65, Number((current + amount).toFixed(2)))));
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const releaseScrollLock = acquireDocumentScrollLock();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      releaseScrollLock();
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [expanded]);

  const figure = <span className={`architecture-diagram ${expanded ? "expanded" : ""}`} role="group" aria-label={alt || "Architecture diagram"}>
    <span className="diagram-caption"><strong>{alt || "Architecture diagram"}</strong><span className="diagram-controls">
      <button type="button" onClick={() => updateZoom(-.2)} disabled={zoom <= .65} aria-label="Zoom diagram out" title="Zoom out"><Icon name="minus" /></button>
      <button type="button" className="diagram-zoom-value" onClick={() => setZoom(1)} aria-label="Reset diagram zoom" title="Reset zoom">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={() => updateZoom(.2)} disabled={zoom >= 2.4} aria-label="Zoom diagram in" title="Zoom in"><Icon name="plus" /></button>
      <button type="button" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Exit full-screen diagram" : "View diagram full screen"} title={expanded ? "Exit full screen" : "Full screen"}>{expanded ? "↙" : "↗"}</button>
    </span></span>
    <span className="architecture-diagram-viewport">
      <img src={src} alt={alt} style={{ width: `${zoom * 100}%` }} />
    </span>
    <small>Zoom, then scroll or use a trackpad to inspect the architecture.</small>
  </span>;

  if (!expanded || typeof document === "undefined") return figure;

  return <>
    <span className="architecture-diagram-placeholder" aria-hidden="true" />
    {createPortal(
      <span className="diagram-viewer-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setExpanded(false);
      }}>
        <span className="diagram-viewer-shell" role="dialog" aria-modal="true" aria-label={`${alt || "Architecture diagram"} full-screen viewer`}>
          {figure}
        </span>
      </span>,
      document.body,
    )}
  </>;
}

function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  const language = className?.match(/language-([\w-]+)/)?.[1];
  if (!language) return <code className={className}>{children}</code>;
  return <CodeBlock language={language} code={String(children)} />;
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const imageSrc = typeof src === "string" ? src : "";
  if (/\/diagrams\/|\.svg(?:$|\?)/i.test(imageSrc)) {
    return <DiagramFigure src={imageSrc} alt={alt ?? "Architecture diagram"} />;
  }
  return <img src={imageSrc} alt={alt ?? ""} />;
}

const MARKDOWN_COMPONENTS = {
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  code: MarkdownCode,
  img: MarkdownImage,
};

function MarkdownBody({ source }: { source: string }) {
  return <div className="markdown-body"><Markdown
    remarkPlugins={[remarkGfm]}
    components={MARKDOWN_COMPONENTS}
  >{source}</Markdown></div>;
}

function formatAudioDuration(seconds: number | null) {
  if (seconds == null) return "—:——";
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function GroupedAnswerPlayback({ clips, deliveryAnalyses }: { clips: AudioClip[]; deliveryAnalyses: DeliveryAnalysis[] }) {
  const playable = clips.filter((clip) => clip.status === "available");
  const [activeClipId, setActiveClipId] = useState(playable[0]?.id ?? clips[0]?.id ?? "");
  const [playing, setPlaying] = useState(false);
  const [segmentTime, setSegmentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({});
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeekRef = useRef(0);
  const resumeAfterSwitchRef = useRef(false);
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? playable[0] ?? clips[0];
  const activeIndex = activeClip ? clips.findIndex((clip) => clip.id === activeClip.id) : -1;
  const activePlayableIndex = activeClip ? playable.findIndex((clip) => clip.id === activeClip.id) : -1;
  const clipDuration = (clip: AudioClip) => measuredDurations[clip.id] ?? clip.durationSeconds ?? 0;
  const totalSeconds = playable.reduce((total, clip) => total + clipDuration(clip), 0);
  const elapsedBeforeActive = playable.slice(0, Math.max(0, activePlayableIndex)).reduce((total, clip) => total + clipDuration(clip), 0);
  const cumulativeTime = Math.min(totalSeconds || Number.POSITIVE_INFINITY, elapsedBeforeActive + segmentTime);
  const activeAnalyses = activeClip ? deliveryAnalyses.filter((analysis) => analysis.audioClipId === activeClip.id) : [];

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume, activeClipId]);

  function selectSegment(clip: AudioClip) {
    if (clip.status !== "available") return;
    resumeAfterSwitchRef.current = playing;
    pendingSeekRef.current = 0;
    setSegmentTime(0);
    setActiveClipId(clip.id);
  }

  function continueToNextSegment() {
    const next = playable[activePlayableIndex + 1];
    if (!next) {
      setPlaying(false);
      setSegmentTime(clipDuration(activeClip));
      return;
    }
    resumeAfterSwitchRef.current = true;
    pendingSeekRef.current = 0;
    setSegmentTime(0);
    setActiveClipId(next.id);
  }

  function prepareActiveAudio() {
    const audio = audioRef.current;
    if (!audio || !activeClip) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setMeasuredDurations((current) => current[activeClip.id] === audio.duration ? current : { ...current, [activeClip.id]: audio.duration });
    }
    audio.currentTime = Math.min(pendingSeekRef.current, Number.isFinite(audio.duration) ? audio.duration : pendingSeekRef.current);
    setSegmentTime(audio.currentTime);
    if (resumeAfterSwitchRef.current) {
      resumeAfterSwitchRef.current = false;
      void audio.play();
    }
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  function seekAnswer(value: number) {
    if (!playable.length) return;
    let remaining = Math.max(0, Math.min(totalSeconds, value));
    let target = playable[playable.length - 1];
    for (const clip of playable) {
      const duration = clipDuration(clip);
      if (remaining <= duration || clip === playable[playable.length - 1]) {
        target = clip;
        break;
      }
      remaining -= duration;
    }
    if (target.id === activeClip?.id && audioRef.current) {
      audioRef.current.currentTime = remaining;
      setSegmentTime(remaining);
      return;
    }
    resumeAfterSwitchRef.current = playing;
    pendingSeekRef.current = remaining;
    setSegmentTime(remaining);
    setActiveClipId(target.id);
  }

  return <div className="answer-playback has-audio grouped-answer-playback">
    {activeClip?.status === "available" ? <div className="answer-player answer-player-unified">
      <button type="button" className="answer-play-toggle" onClick={togglePlayback} aria-label={playing ? "Pause answer" : "Play answer"} title={playing ? "Pause" : "Play"}><Icon name={playing ? "pause" : "play"} /></button>
      <time>{formatAudioDuration(Number.isFinite(cumulativeTime) ? cumulativeTime : 0)} / {totalSeconds > 0 ? formatAudioDuration(totalSeconds) : "—:——"}</time>
      <div className="answer-progress-shell">
        <input type="range" min="0" max={Math.max(totalSeconds, 1)} step="0.05" value={Math.min(cumulativeTime || 0, Math.max(totalSeconds, 1))} onChange={(event) => seekAnswer(Number(event.target.value))} aria-label="Answer playback position" />
        {totalSeconds > 0 && playable.slice(0, -1).map((clip, index) => {
          const boundary = playable.slice(0, index + 1).reduce((sum, item) => sum + clipDuration(item), 0);
          return <i className="answer-segment-marker" style={{ left: `${(boundary / totalSeconds) * 100}%` }} aria-hidden="true" key={clip.id} />;
        })}
      </div>
      <button type="button" className="answer-segment-count" onClick={() => document.getElementById(`answer-recording-${activeClip.id}`)?.toggleAttribute("open")} aria-label={`${playable.length} recorded answer segments`} title={`${playable.length} segments · ${formatAudioDuration(totalSeconds)}`}><Icon name="clips" /><b>{playable.length}</b></button>
      <label className="answer-volume" title="Volume"><Icon name="volume" /><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Answer playback volume" /></label>
      <audio
        key={activeClip.id}
        ref={audioRef}
        preload="metadata"
        src={`/api/audio/${encodeURIComponent(activeClip.id)}`}
        onLoadedMetadata={prepareActiveAudio}
        onTimeUpdate={(event) => setSegmentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={continueToNextSegment}
      />
    </div> : <div className="answer-player-status"><strong>Recording unavailable</strong><small>{activeClip?.status.replaceAll("_", " ")}</small></div>}
    {(clips.length > 1 || activeAnalyses.length > 0) && <details className="answer-recording-details" id={`answer-recording-${activeClip?.id}`}><summary>Recording details and delivery coaching</summary><div className="answer-segments" aria-label="Recorded answer segments">{clips.map((clip, index) => <button type="button" className={clip.id === activeClip?.id ? "active" : ""} key={clip.id} disabled={clip.status !== "available"} onClick={() => selectSegment(clip)} aria-label={`Play answer segment ${index + 1}`} title={clip.status === "available" ? clip.filename : clip.status.replaceAll("_", " ")}><span>{String(index + 1).padStart(2, "0")}</span><i aria-hidden="true" /><small>{formatAudioDuration(clip.durationSeconds)}</small></button>)}</div>{activeAnalyses.length > 0 && <div className="answer-segment-coaching">{activeAnalyses.map((analysis) => <DeliveryReview key={analysis.id} analysis={analysis} segmentLabel={`Segment ${activeIndex + 1}`} />)}</div>}</details>}
  </div>;
}

function ActivityTranscript({
  turns,
  clips,
  deliveryAnalyses,
  codeAttempts,
  modeTransitions = [],
}: {
  turns: TranscriptTurn[];
  clips: AudioClip[];
  deliveryAnalyses: DeliveryAnalysis[];
  codeAttempts: LeetCodeCodeAttempt[];
  modeTransitions?: InteractionModeTransitionProjection[];
}) {
  const groups = useMemo(() => groupTranscriptTurns(turns), [turns]);
  const groupOccurredAt = (group: (typeof groups)[number]) => (
    group.kind === "voice_answer" ? group.turns[0].occurredAt : group.turn.occurredAt
  );
  return (
    <section className="case-transcript" aria-label="Conversation transcript and answer recordings">
      <div className="case-transcript-heading"><span className="eyebrow">CONVERSATION TRANSCRIPT</span><p>Your recording sits between the prompt and the answer it captures.</p></div>
      <div className="transcript-thread">
        {groups.map((group, groupIndex) => {
          const firstOccurredAt = groupOccurredAt(group);
          const previousOccurredAt = groupIndex > 0 ? groupOccurredAt(groups[groupIndex - 1]) : Number.NEGATIVE_INFINITY;
          const precedingTransitions = modeTransitions.filter((transition) => (
            transition.occurredAt > previousOccurredAt && transition.occurredAt <= firstOccurredAt
          ));
          if (group.kind === "voice_answer") {
            const turnIds = new Set(group.turns.map((turn) => turn.turnId));
            const answerClips = clips.filter((clip) => clip.transcriptTurnId && turnIds.has(clip.transcriptTurnId));
            const combinedTranscript = group.turns.map((turn) => turn.body).join("\n\n");
            const firstTurn = group.turns[0];
            return <Fragment key={group.id}>{precedingTransitions.map((transition) => <div className={`mode-transition-divider mode-${transition.toInteractionModeId}`} role="separator" aria-label={`Interaction mode changed to ${transition.toInteractionModeId}`} key={transition.transitionId}><span>Mode change</span><strong>{transition.toInteractionModeId.replaceAll("_", " ")}</strong><small>{transition.reason}</small></div>)}<div className="transcript-turn user voice-answer-group" data-answer-turn-id={firstTurn.turnId}>
              {answerClips.length > 0 && <GroupedAnswerPlayback clips={answerClips} deliveryAnalyses={deliveryAnalyses} />}
              <article>
                <header><span>Your answer{group.turns.length > 1 ? ` · ${group.turns.length} voice segments` : ""}</span><time>{formatPracticeTimestamp(new Date(firstTurn.occurredAt).toISOString())}</time></header>
                <MarkdownBody source={combinedTranscript} />
              </article>
            </div></Fragment>;
          }
          const turn = group.turn;
          const turnCodeAttempts = codeAttempts.filter((attempt) => attempt.originatingTurnId === turn.turnId);
          const transcriptBody = transcriptBodyWithoutCodeAttempts(turn.body, turnCodeAttempts);
          const answerClips = turn.speaker === "user"
            ? clips.filter((clip) => clip.transcriptTurnId === turn.turnId)
            : [];
          const modeId = turn.speaker === "specialist" ? turn.interactionMode?.interactionModeId : null;
          return <Fragment key={group.id}>{precedingTransitions.map((transition) => <div className={`mode-transition-divider mode-${transition.toInteractionModeId}`} role="separator" aria-label={`Interaction mode changed to ${transition.toInteractionModeId}`} key={transition.transitionId}><span>Mode change</span><strong>{transition.toInteractionModeId.replaceAll("_", " ")}</strong><small>{transition.reason}</small></div>)}<div className={`transcript-turn ${turn.speaker} ${modeId ? `mode-${modeId}` : ""}`} data-answer-turn-id={turn.speaker === "user" ? turn.turnId : undefined}>
            {turn.speaker === "user" && answerClips.length > 0 && <GroupedAnswerPlayback clips={answerClips} deliveryAnalyses={deliveryAnalyses} />}
            <article aria-label={turn.speaker === "specialist" && modeId ? `Specialist response in ${modeId} mode` : undefined}>
              <header><span>{turn.speaker === "specialist" ? "Specialist" : "Your answer"}{turn.speaker === "specialist" && turn.interactionMode?.turnOverride ? <small className="mode-turn-override-note">One-turn {turn.interactionMode.interactionModeId.replaceAll("_", " ")} override</small> : null}</span><time>{formatPracticeTimestamp(new Date(turn.occurredAt).toISOString())}</time></header>
              {turnCodeAttempts.map((attempt) => <details className="code-attempt-card compact" key={attempt.id}><summary><strong>Code Attempt {attempt.sequence} · {attempt.language} · {attempt.lineCount} lines</strong><span>Expand code</span></summary><CodeAttemptBody attempt={attempt} /></details>)}
              {transcriptBody.trim() && <MarkdownBody source={transcriptBody} />}
            </article>
          </div></Fragment>;
        })}
      </div>
    </section>
  );
}

function FinalAnswerCard({ finalAnswer }: { finalAnswer: BehavioralFinalAnswerProjection }) {
  const snapshotLabel = finalAnswer.source === "legacy_model_answer"
    ? "Legacy answer · saved before snapshot v1"
    : `${finalAnswer.scope === "target_tailored" ? "Target-tailored" : "Universal"} · Snapshot ${finalAnswer.snapshotRevision}`;
  return <section className={`final-answer-card ${finalAnswer.source}`} aria-label="Final tailored answer">
    <header>
      <div><span>FINAL ANSWER SNAPSHOT</span><small>{snapshotLabel}</small></div>
      {finalAnswer.solutionProfile && <strong>Solution revision {finalAnswer.solutionProfile.revision}</strong>}
    </header>
    {(finalAnswer.roleBrief || finalAnswer.target) && <div className="final-answer-target"><span>{finalAnswer.roleBrief?.label ?? finalAnswer.target?.label}</span><small>{(finalAnswer.roleBrief?.competencyEmphasis ?? finalAnswer.target?.competencyEmphasis ?? []).join(" · ")}</small></div>}
    <div className="final-answer-body"><MarkdownBody source={finalAnswer.answer} /></div>
    <div className="final-answer-meta">
      <section><h5>Evidence used</h5>{finalAnswer.acceptedEvidenceIds.length ? <ul>{finalAnswer.acceptedEvidenceIds.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No accepted evidence IDs recorded.</p>}</section>
      <section><h5>Evidence gaps</h5>{finalAnswer.evidenceGaps.length ? <ul>{finalAnswer.evidenceGaps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section>
      <section><h5>Contradictions</h5>{finalAnswer.contradictions.length ? <ul>{finalAnswer.contradictions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section>
    </div>
    {finalAnswer.correctionOfRevision && <footer><strong>Explicit correction</strong><span>Replaces snapshot {finalAnswer.correctionOfRevision}</span>{finalAnswer.correctionReason && <p>{finalAnswer.correctionReason}</p>}</footer>}
  </section>;
}

function ResumeContextCard({ context }: { context: ActivityResumeContext }) {
  const revisionPath = `${encodeURIComponent(context.resumeId)}/${encodeURIComponent(context.resumeRevisionId)}`;
  return <section className="resume-context-card" aria-label="Resume context">
    <header><div><span>IMMUTABLE RÉSUMÉ CONTEXT</span><strong>{context.sourceLabel}</strong></div><small>Answer snapshot {context.snapshotRevision}</small></header>
    <dl>
      <div><dt>Résumé revision</dt><dd>{context.resumeRevisionId}</dd></div>
      <div><dt>Captured state</dt><dd>{context.state}</dd></div>
      <div><dt>Claims linked</dt><dd>{context.claimIds.length}</dd></div>
      <div><dt>Evidence linked</dt><dd>{context.evidenceIds.length}</dd></div>
    </dl>
    {(context.claimIds.length > 0 || context.evidenceIds.length > 0) && <div className="resume-context-references">
      {context.claimIds.length > 0 && <p><strong>Claims</strong><span>{context.claimIds.join(" · ")}</span></p>}
      {context.evidenceIds.length > 0 && <p><strong>Evidence</strong><span>{context.evidenceIds.join(" · ")}</span></p>}
    </div>}
    <footer><a href={`/api/resume-library/${revisionPath}/pdf`}>Download exact PDF</a><a href={`/api/resume-library/${revisionPath}/docx`}>Download exact DOCX</a></footer>
  </section>;
}

function PracticeScenariosCard({ projection }: { projection: BehavioralPracticeScenarioProjection }) {
  return <section className="practice-scenarios-card" aria-label="Behavioral practice scenarios">
    <header><div><span>LABELED PRACTICE MATERIAL</span><strong>Solution revision {projection.solutionProfile.revision}</strong></div><p>{"Hypothetical or fictional practice scenario — not the owner's experience."}</p></header>
    {projection.scenarios.map((scenario) => <article className={`practice-scenario ${scenario.mode}`} key={`${scenario.scenarioId}:${scenario.revision}`}>
      <div className="practice-scenario-heading"><div><span>{scenario.label}</span><h4>{scenario.purpose}</h4></div><small>Scenario {scenario.scenarioId} · revision {scenario.revision}</small></div>
      <div className="practice-scenario-answer"><MarkdownBody source={scenario.answer} /></div>
      <div className="practice-scenario-grid">
        <section><h5>Real source facts</h5>{scenario.canon.realSourceFacts.length ? <ul>{scenario.canon.realSourceFacts.map((fact, index) => <li key={`${scenario.scenarioId}-fact-${index}`}>{fact.statement}{fact.acceptedEvidenceIds.length ? <small>Evidence references: {fact.acceptedEvidenceIds.join(" · ")}</small> : null}</li>)}</ul> : <p>None recorded.</p>}</section>
        <section><h5>Invented premises</h5>{scenario.canon.inventedPremises.length ? <ul>{scenario.canon.inventedPremises.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section>
        <section><h5>Invented actions</h5>{scenario.canon.inventedActions.length ? <ul>{scenario.canon.inventedActions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section>
        <section><h5>Invented results</h5>{scenario.canon.inventedResults.length ? <ul>{scenario.canon.inventedResults.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section>
      </div>
      <details><summary>Challenge map and follow-ups</summary><div className="practice-scenario-grid"><section><h5>Challenge map</h5>{scenario.challengeMap.length ? <dl>{scenario.challengeMap.map((item) => <div key={item.challenge}><dt>{item.challenge}</dt><dd>{item.response}</dd></div>)}</dl> : <p>None recorded.</p>}</section><section><h5>Likely follow-ups</h5>{scenario.likelyFollowUps.length ? <ul>{scenario.likelyFollowUps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section><section><h5>Limitations</h5>{scenario.limitations.length ? <ul>{scenario.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section></div></details>
    </article>)}
  </section>;
}

function BehavioralAttemptAnalysisCard({ projection }: { projection: BehavioralAttemptAnalysisProjection }) {
  const { analysis } = projection;
  return <section className="behavioral-attempt-card" aria-label="Behavioral Attempt analysis">
    <header><div><span>BEHAVIORAL ATTEMPT · IMMUTABLE AUDIT</span><strong>{analysis.answerFormat} · snapshot {projection.snapshotRevision}</strong></div><p>{projection.question.questionId} · Profile revision {projection.solutionProfile.revision}</p>{projection.story && <p>Story {projection.story.storyId} · {projection.story.revision ? `revision ${projection.story.revision}` : "legacy unversioned reference"}{projection.story.alternativeId ? ` · alternative ${projection.story.alternativeId}` : ""}</p>}{projection.roleBrief && <p>Role Brief {projection.roleBrief.label} · revision {projection.roleBrief.revision}</p>}{projection.target && <p>Legacy Target Profile {projection.target.label} · revision {projection.target.revision}</p>}</header>
    <div className="behavioral-attempt-competencies" aria-label="Competencies">{analysis.competencies.map((item) => <span key={item}>{item}</span>)}</div>
    <div className="behavioral-claim-audit">{analysis.claimAudit.map((claim, index) => <article className={`claim-${claim.status}`} key={`${claim.claim}-${index}`}><header><strong>{claim.status}</strong><span>{claim.claim}</span></header><dl><div><dt>Supporting evidence</dt><dd>{claim.supportingEvidenceIds.join(" · ") || "None"}</dd></div><div><dt>Contrary evidence</dt><dd>{claim.contraryEvidenceIds.join(" · ") || "None"}</dd></div><div><dt>Missing</dt><dd>{claim.gaps.join(" · ") || "None"}</dd></div><div><dt>Contradictions</dt><dd>{claim.contradictions.join(" · ") || "None"}</dd></div></dl></article>)}</div>
    <div className="behavioral-attempt-dimensions" aria-label="Structured review dimensions">{Object.entries(analysis.reviewDimensions).map(([dimension, value]) => <article className={`dimension-${value.status}`} key={dimension}><span>{dimension.replace(/([A-Z])/g, " $1")}</span><strong>{value.status.replaceAll("_", " ")}</strong>{value.observation && <p>{value.observation}</p>}</article>)}</div>
    <div className="behavioral-attempt-review"><section><h5>What worked</h5>{analysis.strengths.length ? <ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section><section><h5>Improve next</h5>{analysis.improvements.length ? <ul>{analysis.improvements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section></div>
    <aside><strong>Generated coaching — not evidence</strong>{analysis.coachingNotes.length ? <ul>{analysis.coachingNotes.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</aside>
    <footer><section><h5>Likely follow-ups</h5>{analysis.likelyFollowUps.length ? <ul>{analysis.likelyFollowUps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded.</p>}</section><section><h5>Next drill</h5><p>{analysis.nextDrill}</p></section></footer>
  </section>;
}

function InteractionModeMarkers({ snapshot }: { snapshot?: LogEntry["interactionModeClassification"] }) {
  const classification = snapshot?.classification;
  if (!isRecordedInteractionMode(classification)) return null;
  const label = interactionModeClassificationLabel(classification);
  const shares = classification.modeShares;
  return <>
    <i className={`mode-classification-chip mode-${classification.primaryPracticeModeId}`}>{label}</i>
    {classification.hadMentorAssistance && <i className="mode-assistance-chip">Mentor assistance{classification.highestHintRung !== "none" ? ` · ${classification.highestHintRung}` : ""}</i>}
    <span className="mode-share-ribbon" aria-label={`${label}. ${shares.map((share) => `${share.interactionModeId} ${Math.round(share.basisPoints / 100)} percent`).join(", ")}`}>
      {shares.map((share) => <i className={`mode-${share.interactionModeId}`} style={{ width: `${share.basisPoints / 100}%` }} key={share.interactionModeId} />)}
    </span>
  </>;
}

function CaseModeTags({ snapshot }: { snapshot?: LogEntry["interactionModeClassification"] }) {
  const classification = snapshot?.classification;
  if (!isRecordedInteractionMode(classification)) return null;
  return <div className="case-mode-tags" aria-label="Practice mode">
    <i className={`mode-classification-chip mode-${classification.primaryPracticeModeId}`}>{interactionModeClassificationLabel(classification)}</i>
    {classification.hadMentorAssistance && <i className="mode-assistance-chip">Mentor assistance{classification.highestHintRung !== "none" ? ` · ${classification.highestHintRung}` : ""}</i>}
  </div>;
}

function transcriptBodyWithoutCodeAttempts(source: string, attempts: LeetCodeCodeAttempt[]) {
  if (!attempts.length) return source;
  const attemptBodies = new Set(attempts.map((attempt) => attempt.code.trim().replace(/\r\n/g, "\n")));
  return source.replace(/```[^\n]*\n([\s\S]*?)```/g, (block, code: string) => (
    attemptBodies.has(code.trim().replace(/\r\n/g, "\n")) ? "" : block
  )).replace(/\n{3,}/g, "\n\n");
}

function CodeAttemptBody({ attempt }: { attempt: LeetCodeCodeAttempt }) {
  return <div className="code-attempt-body">
    <pre><code>{attempt.code}</code></pre>
    <p><strong>{attempt.observedCorrectness.replaceAll("_", " ")}</strong> · {attempt.finalDeclaration}</p>
    {attempt.complexity && <div className="code-attempt-complexity">{attempt.complexity.time && <span>Time: {attempt.complexity.time}</span>}{attempt.complexity.space && <span>Space: {attempt.complexity.space}</span>}</div>}
    {attempt.concreteFindings.length > 0 && <ul>{attempt.concreteFindings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
    {attempt.edgeCases.length > 0 && <details className="code-attempt-review"><summary>Edge cases reviewed</summary><ul>{attempt.edgeCases.map((edgeCase) => <li key={edgeCase}>{edgeCase}</li>)}</ul></details>}
    <AttemptReview review={attempt.review} />
  </div>;
}

function AttemptReview({ review }: { review: LeetCodeCodeAttempt["review"] }) {
  if (review.status === "not_recorded") {
    return <section className="attempt-review not-recorded" aria-label="Attempt Review">
      <h4>Attempt Review</h4>
      <p>Review not recorded</p>
    </section>;
  }
  if (review.status === "pending") {
    return <section className="attempt-review pending" aria-label="Attempt Review">
      <h4>Attempt Review</h4>
      <p>Review pending</p>
    </section>;
  }
  return <section className="attempt-review complete" aria-label="Attempt Review">
    <header><h4>Attempt Review</h4><small>{review.provenance === "explicit_evidence_backfill" ? "Evidence backfill" : "Specialist review"}</small></header>
    <p className="attempt-review-summary">{review.summary}</p>
    <div className="attempt-review-columns">
      <section><h5>What Went Well</h5><ul>{review.whatWentWell.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h5>What To Improve</h5><ul>{review.whatToImprove.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    <section className="attempt-review-testing"><h5>Testing Evidence</h5><ul>{review.testingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
    {review.nextStep && <p className="attempt-review-next"><strong>Next Step</strong><span>{review.nextStep}</span></p>}
  </section>;
}

function DeliveryReview({ analysis, segmentLabel }: { analysis: DeliveryAnalysis; segmentLabel?: string }) {
  if (analysis.status !== "available" || !analysis.payload) {
    return <div className={`delivery-review-status ${analysis.status}`}><span>{segmentLabel ? `${segmentLabel} coach` : "Delivery coach"}</span><small>{analysis.status === "failed" ? analysis.error ?? "Analysis will retry." : analysis.status}</small></div>;
  }
  const payload = analysis.payload;
  return <details className="delivery-review">
    <summary><span>{segmentLabel ? `${segmentLabel} delivery` : "Delivery review"}</span><small>{payload.wordsPerMinute ? `${Math.round(payload.wordsPerMinute)} words/min` : "Observable speech evidence"}</small></summary>
    <p>{payload.summary}</p>
    <div className="delivery-review-columns"><section><strong>Working well</strong><ul>{payload.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section><section><strong>Try next</strong><ul>{payload.improvements.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
    {payload.observations.length > 0 && <div className="delivery-observations">{payload.observations.map((observation, index) => <article key={`${observation.dimension}-${index}`}><span>{observation.dimension.replaceAll("_", " ")}</span><p>{observation.evidence}</p><small>{observation.coaching}</small></article>)}</div>}
  </details>;
}

type ReaderSection = ContentArtifact["sections"][number];
type ReaderGroupKey = "record" | "conversation" | "solution" | "reflection" | "review";

const READER_GROUPS: Array<{ key: ReaderGroupKey; title: string }> = [
  { key: "record", title: "Attempt record" },
  { key: "conversation", title: "Conversation" },
  { key: "solution", title: "Reference solution" },
  { key: "reflection", title: "Feedback and interview answer" },
  { key: "review", title: "Review and evidence" },
];

function isTranscriptSection(title: string) {
  return /conversation transcript|full (activity )?transcript|activity exchanges?|raw exchanges?/i.test(title);
}

function readerGroupFor(title: string): ReaderGroupKey {
  if (isTranscriptSection(title)) return "conversation";
  if (/what went well|what to improve|improved interview answer|interview-ready|closing summary/i.test(title)) return "reflection";
  if (/review plan|delivery recordings?|delivery review|references/i.test(title)) return "review";
  if (/complete reference|generated reference|problem framing|functional requirements|non-functional|scale|capacity|api contract|data model|architecture|read and write|scaling|reliability|failure|security|privacy|tradeoffs|problem summary|pattern recognition|best approach|correctness|implementation|complexity|edge cases?|alternatives?|recall cue/i.test(title)) return "solution";
  return "record";
}

function groupReaderSections(sections: ReaderSection[]) {
  const groups = new Map<ReaderGroupKey, ReaderSection[]>();
  sections.forEach((section) => {
    const key = readerGroupFor(section.title);
    groups.set(key, [...(groups.get(key) ?? []), section]);
  });
  return READER_GROUPS.flatMap((group) => {
    const items = groups.get(group.key) ?? [];
    return items.length ? [{ ...group, sections: items }] : [];
  });
}

function dedupeReaderSections(sections: ReaderSection[]) {
  const byTitle = new Map<string, ReaderSection>();
  sections.forEach((section) => {
    const key = section.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, section);
  });
  return [...byTitle.values()];
}

function ReaderSectionBody({ section, id }: { section: ReaderSection; id: string }) {
  return <section className="reader-subsection" id={id}><h3>{section.title}</h3><MarkdownBody source={section.body} /></section>;
}

function codeSectionFamily(section: ReaderSection) {
  if (!/```[\w-]+\n[\s\S]*?```/.test(section.body)) return null;
  const match = section.title.match(/^(.*?)[\s]*[—-][\s]*(Java|Python)$/i);
  return match ? match[1].trim() : null;
}

function LanguageCodeTabs({ sections, idPrefix, title }: { sections: ReaderSection[]; idPrefix: string; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = sections[activeIndex] ?? sections[0];
  const match = active?.body.match(/```([\w-]+)\n([\s\S]*?)```/);
  if (!active || !match) return null;
  return <section className="language-code-tabs" id={`${idPrefix}-${slugify(title)}-0`}><header><h3>{title}</h3><div role="tablist" aria-label={`${title} language`}>{sections.map((section, index) => <button type="button" role="tab" aria-selected={activeIndex === index} className={activeIndex === index ? "active" : ""} onClick={() => setActiveIndex(index)} key={section.title}>{section.title.match(/[—-]\s*(Java|Python)$/i)?.[1] ?? `Option ${index + 1}`}</button>)}</div></header><CodeBlock language={match[1]} code={match[2]} /></section>;
}

function revealReaderOutlineTarget(link: HTMLAnchorElement) {
  const href = link.getAttribute("href");
  if (!href?.startsWith("#")) return;
  const target = document.getElementById(decodeURIComponent(href.slice(1)));
  const group = target instanceof HTMLDetailsElement && target.matches("details.reader-group")
    ? target
    : target?.closest<HTMLDetailsElement>("details.reader-group");
  if (group && !group.open) group.open = true;
  if (!target) return;
  const nextUrl = new URL(window.location.href);
  nextUrl.hash = href;
  window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  window.requestAnimationFrame(() => target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  }));
}

function ReaderOutline({ children }: { children: ReactNode }) {
  const outlineRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const outline = outlineRef.current;
      if (outline?.open && event.target instanceof Node && !outline.contains(event.target)) outline.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && outlineRef.current?.open) outlineRef.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  return <details className="reader-outline" ref={outlineRef} onClick={(event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
    if (link) {
      event.preventDefault();
      revealReaderOutlineTarget(link);
    }
    if (link && outlineRef.current) outlineRef.current.open = false;
  }}><summary aria-label="Open contents" title="Contents"><Icon name="outline" /></summary><nav>{children}</nav></details>;
}

function ModalReaderPane({ className, label, focusKey, restoreFocusRef, children }: { className: string; label: string; focusKey: string; restoreFocusRef?: { current: HTMLElement | null }; children: ReactNode }) {
  const paneRef = useRef<HTMLElement>(null);
  const fallbackOpenerRef = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null);
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    openerRef.current ??= restoreFocusRef?.current ?? fallbackOpenerRef.current;
    const opener = openerRef.current;
    const background = [...document.querySelectorAll<HTMLElement>(".sidebar, .topbar")];
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    const focusable = () => [...pane.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getClientRects().length > 0);
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const targets = focusable();
      if (!targets.length) {
        event.preventDefault();
        pane.focus({ preventScroll: true });
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    pane.addEventListener("keydown", trapTab);
    return () => {
      pane.removeEventListener("keydown", trapTab);
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [restoreFocusRef]);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const close = pane.querySelector<HTMLElement>(".reader-close");
    const firstFocusable = pane.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])");
    (close ?? firstFocusable ?? pane).focus({ preventScroll: true });
  }, [focusKey]);
  return <aside className={className} ref={paneRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}>{children}</aside>;
}

function ReaderGroupSections({ sections, idPrefix, coding }: { sections: ReaderSection[]; idPrefix: string; coding: boolean }) {
  const families = new Map<string, ReaderSection[]>();
  if (coding) sections.forEach((section) => {
    const family = codeSectionFamily(section);
    if (family) families.set(family, [...(families.get(family) ?? []), section]);
  });
  const renderedFamilies = new Set<string>();
  return <>{sections.map((section, index) => {
    const family = codeSectionFamily(section);
    const siblings = family ? families.get(family) ?? [] : [];
    if (family && siblings.length > 1) {
      if (renderedFamilies.has(family)) return null;
      renderedFamilies.add(family);
      return <LanguageCodeTabs sections={siblings} idPrefix={idPrefix} title={family} key={family} />;
    }
    return <ReaderSectionBody section={section} id={`${idPrefix}-${slugify(section.title)}-${index}`} key={`${section.title}-${index}`} />;
  })}</>;
}

function SolutionReaderGroup({ group, idPrefix, coding, open, onToggle }: { group: ReturnType<typeof groupReaderSections>[number]; idPrefix: string; coding: boolean; open: boolean; onToggle: (open: boolean) => void }) {
  return <details className={`reader-group solution-reader-group ${group.key}-group`} id={`${idPrefix}-group-${group.key}`} open={open} onToggle={(event) => onToggle(event.currentTarget.open)}><summary><span>{group.title}</span><small>{group.sections.length} section{group.sections.length === 1 ? "" : "s"}</small></summary><div><ReaderGroupSections sections={group.sections} idPrefix={idPrefix} coding={coding} /></div></details>;
}

function HighlightShelf({ highlights, onRemove }: { highlights: ContentHighlight[]; onRemove: (id: string) => void }) {
  if (!highlights.length) return null;
  return <details className="highlight-shelf"><summary>{highlights.length} saved highlight{highlights.length === 1 ? "" : "s"}</summary><div>{highlights.map((highlight) => <article key={highlight.id}><mark>{highlight.quote}</mark><button type="button" onClick={() => onRemove(highlight.id)} aria-label="Remove highlight" title="Remove highlight"><Icon name="trash" /></button></article>)}</div></details>;
}

function FormattedHighlightNote({ body }: { body: string }) {
  const parts = body.split(/(\*\*[^*]+\*\*|_[^_]+_|<u>[^<]+<\/u>|\n)/g).filter((part) => part !== "");
  return <p>{parts.map((part, index) => {
    if (part === "\n") return <br key={index} />;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("_") && part.endsWith("_")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("<u>") && part.endsWith("</u>")) return <u key={index}>{part.slice(3, -4)}</u>;
    return part;
  })}</p>;
}

function MetricRing({ label, value, detail, color }: { label: string; value: number; detail: string; color: string }) {
  const safeValue = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <article className="metric-ring-card">
      <div className="metric-ring" style={{ background: `conic-gradient(${color} ${safeValue}%, #e7ebe5 ${safeValue}% 100%)` }}>
        <span><strong>{safeValue}%</strong><small>{label}</small></span>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function AnimatedComposerStage({ children, motionKey }: { children: ReactNode; motionKey: ComposerMode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => {
        setHeight(content.getBoundingClientRect().height);
        frameRef.current = null;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [motionKey]);

  return (
    <div className="composer-stage" style={height === undefined ? undefined : { height }}>
      <div className="composer-stage-inner" ref={contentRef} key={motionKey}>{children}</div>
    </div>
  );
}

export default function HomeClient({ content, today }: { content: ContentIndex; today: string }) {
  const journal = useMemo(
    () => content.journals.find((candidate) => candidate.date === today) ?? emptyJournal(today),
    [content.journals, today],
  );
  // Keep the server and first client render identical. The arrival screen masks
  // the one-time restoration, so the remembered workspace is ready before the
  // user enters without forcing React to discard a mismatched server tree.
  const [view, setView] = useState<View>("today");
  const [learnDestination, setLearnDestination] = useState<LearnDestination>("today");
  const [viewMemoryReady, setViewMemoryReady] = useState(false);
  const {
    draft,
    setDraft,
    now,
    setNow,
    hydrated,
    synced,
    mutationError,
    clearMutationError,
    enqueue,
  } = useLiveState(journal.date);
  const yesterdayDate = shiftDate(journal.date, -1);
  const yesterdayDraft = useReadOnlyLiveState(yesterdayDate);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [composerClosing, setComposerClosing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [selectedProblem, setSelectedProblem] = useState<{ type: ActivityType; question: QuestionBankItem } | null>(null);
  const [libraryNestedProblem, setLibraryNestedProblem] = useState<{ type: ActivityType; question: QuestionBankItem } | null>(null);
  const [bankNestedEntry, setBankNestedEntry] = useState<LogEntry | null>(null);
  const [journeyNestedEntry, setJourneyNestedEntry] = useState<LogEntry | null>(null);
  const [journeyNestedProblem, setJourneyNestedProblem] = useState<{ type: ActivityType; question: QuestionBankItem } | null>(null);
  const [reviewNestedEntry, setReviewNestedEntry] = useState<LogEntry | null>(null);
  const [reviewNestedProblem, setReviewNestedProblem] = useState<{ type: ActivityType; question: QuestionBankItem } | null>(null);
  const nestedReaderFocus = (view === "library" && Boolean(libraryNestedProblem))
    || (view === "banks" && Boolean(bankNestedEntry))
    || (view === "journey" && Boolean(journeyNestedEntry || journeyNestedProblem))
    || (view === "reviews" && Boolean(reviewNestedEntry || reviewNestedProblem));
  const [masterPaneState, setMasterPaneState] = useState<MasterPaneState>({ library: false, banks: false });
  const activeListSurface: ListSurface | null = view === "library" || view === "banks" ? view : null;
  const masterPaneOpen = activeListSurface ? masterPaneState[activeListSurface] : false;
  const setMasterPaneOpen = useCallback((next: boolean | ((current: boolean) => boolean), surface = activeListSurface) => {
    if (!surface) return;
    setMasterPaneState((current) => ({
      ...current,
      [surface]: typeof next === "function" ? next(current[surface]) : next,
    }));
  }, [activeListSurface]);
  const [workspaceUiMemory] = useState(() =>
    readSessionJson<WorkspaceUiMemory>("interview-arc-workspace-ui-v1", {})
  );
  const [readerClosing, setReaderClosing] = useState(false);
  const [listRestoring, setListRestoring] = useState<ListSurface | null>(null);
  const [lifecycleDialog, setLifecycleDialog] = useState<LifecycleDialog>(null);
  const [uiToast, setUiToast] = useState<UiToast>(null);
  const [pendingReviewKeys, setPendingReviewKeys] = useState<string[]>([]);
  const [freshDayConfirmOpen, setFreshDayConfirmOpen] = useState(false);
  const [requiredResultIds, setRequiredResultIds] = useState<string[]>([]);
  const [lastModeIntent, setLastModeIntent] = useState<{ activityId: string; interactionModeId: string } | null>(null);
  const [libraryTypeFilters, setLibraryTypeFilters] = useState<ActivityType[]>(workspaceUiMemory.libraryTypeFilters ?? []);
  const [libraryAttentionFilters, setLibraryAttentionFilters] = useState<LibraryAttentionFilter[]>(workspaceUiMemory.libraryAttentionFilters ?? []);
  const [libraryModeFilters, setLibraryModeFilters] = useState<LibraryModeFilter[]>(workspaceUiMemory.libraryModeFilters ?? []);
  const [librarySearch, setLibrarySearch] = useState(workspaceUiMemory.librarySearch ?? "");
  const [libraryStarFilter, setLibraryStarFilter] = useState(workspaceUiMemory.libraryStarFilter ?? false);
  const [bankTypeFilters, setBankTypeFilters] = useState<ActivityType[]>(workspaceUiMemory.bankTypeFilters ?? []);
  const [bankAttentionFilters, setBankAttentionFilters] = useState<BankAttentionFilter[]>(workspaceUiMemory.bankAttentionFilters ?? []);
  const [bankLevelFilters, setBankLevelFilters] = useState<Array<"easy" | "medium" | "hard">>(workspaceUiMemory.bankLevelFilters ?? []);
  const [bankSortKey, setBankSortKey] = useState<"frequency" | "recent" | "acceptance">(workspaceUiMemory.bankSortKey ?? "frequency");
  const [bankSortDir, setBankSortDir] = useState<"asc" | "desc">(workspaceUiMemory.bankSortDir ?? "asc");
  const [bankSearch, setBankSearch] = useState(workspaceUiMemory.bankSearch ?? "");
  const [bankTagFilters, setBankTagFilters] = useState<string[]>(workspaceUiMemory.bankTagFilters ?? []);
  const [bankStarFilter, setBankStarFilter] = useState<"all" | "starred">(workspaceUiMemory.bankStarFilter ?? "all");
  const [bankTopicsExpanded, setBankTopicsExpanded] = useState(workspaceUiMemory.bankTopicsExpanded ?? false);
  const [expandedBankDesk, setExpandedBankDesk] = useState<ActivityType | null>(null);
  const composerSpecialtyViewsRef = useRef<ComposerSpecialtyViews>(createComposerSpecialtyViews());
  const [composerAttentionFilters, setComposerAttentionFilters] = useState<ComposerAttentionFilter[]>([]);
  const [composerLevelFilters, setComposerLevelFilters] = useState<Array<"easy" | "medium" | "hard">>([]);
  const [composerStarFilter, setComposerStarFilter] = useState(false);
  const [composerSortKey, setComposerSortKey] = useState<ComposerSortKey>("frequency");
  const [composerSortDir, setComposerSortDir] = useState<ComposerSortDirection>("asc");
  const [composerVisibleCount, setComposerVisibleCount] = useState(20);
  const [journeyRange, setJourneyRange] = useState<JourneyRange>(90);
  const [journeyMetric, setJourneyMetric] = useState<JourneyMetric>("activities");
  const [journeyHeatmapView, setJourneyHeatmapView] = useState<JourneyHeatmapView>("all");
  const [journeyDate, setJourneyDate] = useState("");
  const [journeyTopic, setJourneyTopic] = useState("");
  const [journeyReaderOrderIds, setJourneyReaderOrderIds] = useState<string[]>([]);
  const [pastReaderOrderIds, setPastReaderOrderIds] = useState<string[]>([]);
  const [reviewReaderOrderIds, setReviewReaderOrderIds] = useState<string[]>([]);
  const [readerNotFound, setReaderNotFound] = useState("");
  const [chartTooltip, setChartTooltip] = useState<ChartTooltipModel | null>(null);
  const workspaceUrlHydratedRef = useRef(false);
  const restoreWorkspaceLocationRef = useRef<() => void>(() => {});
  const reviewReaderOpenerRef = useRef<HTMLElement | null>(null);
  const [careerWork, setCareerWork] = useState<CareerWorkPayload | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerLoadingMore, setCareerLoadingMore] = useState(false);
  const [careerSearch, setCareerSearch] = useState("");
  const [careerStatuses, setCareerStatuses] = useState<JobStatus[]>([]);
  const [careerSource, setCareerSource] = useState("");
  const [careerReferral, setCareerReferral] = useState<"all" | "only" | "exclude">("all");
  const [careerSelectedJob, setCareerSelectedJob] = useState<CareerJob | null>(null);
  const careerQueryKeyRef = useRef("");
  const [focusComposerOpen, setFocusComposerOpen] = useState(false);
  const [editingFocusBlockId, setEditingFocusBlockId] = useState("");
  const [focusTitle, setFocusTitle] = useState("Job applications");
  const [focusMinutes, setFocusMinutes] = useState("60");
  const [focusNote, setFocusNote] = useState("");
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [arrivalState, setArrivalState] = useState<"show" | "leaving" | "entered">("show");
  const [soundMuted, setSoundMuted] = useState(false);
  const [petalsEnabled, setPetalsEnabled] = useState(true);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [integrationToken, setIntegrationToken] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [contentHighlights, setContentHighlights] = useState<ContentHighlight[]>([]);
  const [pendingHighlight, setPendingHighlight] = useState<PendingHighlight | null>(null);
  const [selectedHighlightId, setSelectedHighlightId] = useState("");
  const [annotationPosition, setAnnotationPosition] = useState<AnnotationPosition | null>(null);
  const [highlightNoteDraft, setHighlightNoteDraft] = useState("");
  const [highlightNoteEditing, setHighlightNoteEditing] = useState(false);
  const [editingHighlightNoteId, setEditingHighlightNoteId] = useState("");
  const [expandedHighlightNoteIds, setExpandedHighlightNoteIds] = useState<string[]>([]);
  const [inspectedHighlightNoteId, setInspectedHighlightNoteId] = useState("");
  const [highlightPaletteOpen, setHighlightPaletteOpen] = useState(false);
  const [highlightColorDraft, setHighlightColorDraft] = useState<HighlightColor>(() => {
    if (typeof window === "undefined") return "yellow";
    const stored = window.localStorage.getItem("interview-arc-highlight-color");
    return stored === "green" || stored === "pink" ? stored : "yellow";
  });
  const [highlightBusy, setHighlightBusy] = useState(false);
  const [readerMemory, setReaderMemory] = useState<Record<string, ReaderMemory>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.sessionStorage.getItem("interview-arc-reader-memory-v1") ?? "{}") as Record<string, ReaderMemory>;
    } catch {
      return {};
    }
  });
  const readerDocumentRef = useRef<HTMLDivElement>(null);
  const highlightNoteEditorRef = useRef<HTMLTextAreaElement>(null);
  const readerScrollFrameRef = useRef(0);
  const readerCloseTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const composerListRef = useRef<HTMLDivElement>(null);
  const pendingComposerScrollRestoreRef = useRef<number | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const pastListRef = useRef<HTMLDivElement>(null);
  const bankListRef = useRef<HTMLDivElement>(null);
  const pendingListRestoreRef = useRef<(ListPosition & { surface: ListSurface }) | null>(null);
  const pendingSelectedRevealRef = useRef<ListSurface | null>(null);
  const listPositionMemoryRef = useRef<ListPositionState>(readSessionJson<ListPositionState>(
    "interview-arc-list-position-v2",
    {
      library: {
        main: { pageScrollTop: 0, listScrollTop: 0 },
        pane: { pageScrollTop: 0, listScrollTop: 0 },
      },
      banks: {
        main: { pageScrollTop: 0, listScrollTop: 0 },
        pane: { pageScrollTop: 0, listScrollTop: 0 },
      },
    },
  ));
  const highlightRangesRef = useRef(new Map<string, Range[]>());
  const {
    playing: ambientPlaying,
    playlist: ambientPlaylist,
    trackIndex: ambientTrackIndex,
    trackName,
    trackArtist,
    volume: musicVolume,
    start: startAmbient,
    stop: stopAmbient,
    next: nextAmbientTrack,
    previous: previousAmbientTrack,
    playTrack: playAmbientTrack,
    setVolume: setMusicVolume,
  } = useAmbientSound(today);

  const closeComposer = useCallback(() => {
    if (!composer.open || composerClosing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setComposer(EMPTY_COMPOSER);
      return;
    }
    setComposerClosing(true);
  }, [composer.open, composerClosing]);

  const finishComposerClose = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    if (!composerClosing || event.target !== event.currentTarget || event.animationName !== "modalBackdropOut") return;
    setComposer(EMPTY_COMPOSER);
    setComposerClosing(false);
  }, [composerClosing]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSoundMuted(window.localStorage.getItem("interview-arc-sound-muted") === "true");
      setPetalsEnabled(window.localStorage.getItem("interview-arc-petals-paused") !== "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [today]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1976px)");
    const synchronizePane = (event?: MediaQueryListEvent) => {
      const narrow = event?.matches ?? query.matches;
      if (narrow) {
        setMasterPaneState({ library: false, banks: false });
        return;
      }
      setMasterPaneState({
        library: readMasterPanePreference(window.localStorage, "library") ?? true,
        banks: readMasterPanePreference(window.localStorage, "banks") ?? true,
      });
    };
    const frame = window.requestAnimationFrame(() => synchronizePane());
    query.addEventListener("change", synchronizePane);
    return () => {
      window.cancelAnimationFrame(frame);
      query.removeEventListener("change", synchronizePane);
    };
  }, []);

  useEffect(() => () => {
    if (readerCloseTimerRef.current !== null) window.clearTimeout(readerCloseTimerRef.current);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const pendingScrollTop = pendingComposerScrollRestoreRef.current;
    if (!composer.open || pendingScrollTop === null) return;
    pendingComposerScrollRestoreRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (composerListRef.current) composerListRef.current.scrollTop = pendingScrollTop;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composer.open, composer.type, composerVisibleCount]);

  useLayoutEffect(() => {
    const pending = pendingListRestoreRef.current;
    if (!listRestoring || !pending || pending.surface !== listRestoring) return;
    const list = pending.surface === "library" ? pastListRef.current : bankListRef.current;
    window.scrollTo({ top: pending.pageScrollTop, behavior: "instant" });
    if (list) {
      list.scrollTop = pending.listScrollTop;
      const anchor = pending.anchorId
        ? [...list.querySelectorAll<HTMLElement>("[data-list-item-id]")].find((item) => item.dataset.listItemId === pending.anchorId)
        : null;
      if (anchor) {
        const overflowY = window.getComputedStyle(list).overflowY;
        const internallyScrollable = (overflowY === "auto" || overflowY === "scroll")
          && list.scrollHeight > list.clientHeight + 2;
        const referenceTop = internallyScrollable ? list.getBoundingClientRect().top : 0;
        const targetOffset = pending.centerAnchor
          ? Math.max(0, ((internallyScrollable ? list.clientHeight : window.innerHeight) - anchor.offsetHeight) / 2)
          : pending.anchorOffset;
        if (typeof targetOffset === "number") {
          const delta = anchor.getBoundingClientRect().top - referenceTop - targetOffset;
          if (internallyScrollable) list.scrollTop += delta;
          else window.scrollBy({ top: delta, behavior: "instant" });
        }
      }
    }
    pendingListRestoreRef.current = null;
    setListRestoring(null);
  }, [listRestoring]);

  useLayoutEffect(() => {
    if (readerClosing) return;
    const surface: ListSurface | null = view === "library" && selectedEntry
      ? "library"
      : view === "banks" && selectedProblem
        ? "banks"
        : null;
    if (!surface || pendingSelectedRevealRef.current !== surface) return;
    pendingSelectedRevealRef.current = null;
    const list = surface === "library" ? pastListRef.current : bankListRef.current;
    const itemId = surface === "library"
      ? `library:${selectedEntry!.id}`
      : `banks:${selectedProblem!.type}:${selectedProblem!.question.id}`;
    const frame = window.requestAnimationFrame(() => {
      if (!list || list.clientHeight === 0) return;
      const selected = [...list.querySelectorAll<HTMLElement>("[data-list-item-id]")]
        .find((item) => item.dataset.listItemId === itemId);
      if (!selected) return;
      const target = list.scrollTop
        + selected.getBoundingClientRect().top
        - list.getBoundingClientRect().top
        - Math.max(0, (list.clientHeight - selected.offsetHeight) / 2);
      list.scrollTo({ top: Math.max(0, target), behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [masterPaneOpen, readerClosing, selectedEntry, selectedProblem, view]);

  useEffect(() => {
    window.sessionStorage.setItem("interview-arc-reader-memory-v1", JSON.stringify(readerMemory));
  }, [readerMemory]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const routeView = readWorkspaceRouteView(window.location.href);
      if (readJourneyReaderState(window.location.href)) {
        setView("journey");
        setViewMemoryReady(true);
        return;
      }
      if (readReviewReaderState(window.location.href)) {
        setView("reviews");
        setViewMemoryReady(true);
        return;
      }
      if (readPastReaderState(window.location.href)) {
        setView("library");
        setViewMemoryReady(true);
        return;
      }
      if (readBankReaderState(window.location.href)) {
        setView("banks");
        setViewMemoryReady(true);
        return;
      }
      if (routeView) {
        if (routeView === "learn") setLearnDestination(readLearnDestination(window.location.href));
        setView(routeView === "past" ? "library" : routeView === "career-materials" ? "materials" : routeView);
        setViewMemoryReady(true);
        return;
      }
      const stored = window.sessionStorage.getItem("interview-arc-active-view");
      if (stored === "loops" || stored === "journey" || stored === "reviews" || stored === "library" || stored === "banks" || stored === "materials" || stored === "learn") {
        setView(stored);
        if (stored === "learn") {
          const storedLearn = window.sessionStorage.getItem("interview-arc-learn-destination");
          if (storedLearn === "courses" || storedLearn === "history" || storedLearn === "analytics") setLearnDestination(storedLearn);
        }
      }
      setViewMemoryReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (viewMemoryReady) window.sessionStorage.setItem("interview-arc-active-view", view);
  }, [view, viewMemoryReady]);

  useEffect(() => {
    if (viewMemoryReady) window.sessionStorage.setItem("interview-arc-learn-destination", learnDestination);
  }, [learnDestination, viewMemoryReady]);

  useEffect(() => {
    const memory: WorkspaceUiMemory = {
      libraryTypeFilters,
      libraryAttentionFilters,
      libraryModeFilters,
      librarySearch,
      libraryStarFilter,
      bankTypeFilters,
      bankAttentionFilters,
      bankLevelFilters,
      bankSortKey,
      bankSortDir,
      bankSearch,
      bankTagFilters,
      bankStarFilter,
      bankTopicsExpanded,
    };
    window.sessionStorage.setItem("interview-arc-workspace-ui-v1", JSON.stringify(memory));
  }, [
    bankAttentionFilters,
    bankLevelFilters,
    bankSearch,
    bankSortDir,
    bankSortKey,
    bankStarFilter,
    bankTagFilters,
    bankTopicsExpanded,
    bankTypeFilters,
    libraryAttentionFilters,
    libraryModeFilters,
    librarySearch,
    libraryStarFilter,
    libraryTypeFilters,
  ]);

  useEffect(() => {
    const showArrivalAfterBackNavigation = (event: PageTransitionEvent) => {
      if (event.persisted) setArrivalState("show");
    };
    window.addEventListener("pageshow", showArrivalAfterBackNavigation);
    return () => window.removeEventListener("pageshow", showArrivalAfterBackNavigation);
  }, []);

  useEffect(() => {
    const closeControlMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document.querySelectorAll<HTMLDetailsElement>("details.control-menu[open]").forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
    };
    const closeControlMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll<HTMLDetailsElement>("details.control-menu[open]").forEach((menu) => {
        menu.open = false;
      });
    };
    document.addEventListener("pointerdown", closeControlMenus);
    document.addEventListener("keydown", closeControlMenusOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeControlMenus);
      document.removeEventListener("keydown", closeControlMenusOnEscape);
    };
  }, []);

  const documentScrollLocked = documentScrollLockRequired({
    arrivalState,
    view,
    pastReaderOpen: Boolean(selectedEntry),
    bankReaderOpen: Boolean(selectedProblem),
    journeyReaderOpen: Boolean(journeyNestedEntry || journeyNestedProblem),
    reviewReaderOpen: Boolean(reviewNestedEntry || reviewNestedProblem),
  });

  useLayoutEffect(() => {
    if (!documentScrollLocked) return;
    return acquireDocumentScrollLock();
  }, [documentScrollLocked]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPipSupported("documentPictureInPicture" in window));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Close the pop-out if the dashboard unmounts so it never outlives its opener.
  useEffect(() => () => pipWindowRef.current?.close(), []);

  useEffect(() => {
    if (!composer.open && !integrationOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (composer.open) closeComposer();
        setIntegrationOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [closeComposer, composer.open, integrationOpen]);

  useEffect(() => {
    if (!selectedEntry && !selectedProblem && !journeyNestedEntry && !journeyNestedProblem && !reviewNestedEntry && !reviewNestedProblem) return;
    const closeReader = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!nestedReaderFocus && masterPaneOpen && window.matchMedia("(max-width: 1976px)").matches) {
        setMasterPaneOpen(false);
        return;
      }
      closeReaderPanel();
    };
    window.addEventListener("keydown", closeReader);
    return () => window.removeEventListener("keydown", closeReader);
  }, [bankNestedEntry, journeyNestedEntry, journeyNestedProblem, libraryNestedProblem, masterPaneOpen, nestedReaderFocus, reviewNestedEntry, reviewNestedProblem, selectedEntry, selectedProblem, setMasterPaneOpen]);

  useEffect(() => {
    if (!masterPaneOpen) return;
    const closeMasterPane = (event: PointerEvent) => {
      if (!window.matchMedia("(max-width: 1976px)").matches) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".past-master-pane, .bank-master-pane, .master-pane-toggle")) return;
      setMasterPaneOpen(false);
    };
    document.addEventListener("pointerdown", closeMasterPane);
    return () => document.removeEventListener("pointerdown", closeMasterPane);
  }, [masterPaneOpen, setMasterPaneOpen]);

  function enterArc() {
    if (!soundMuted) startAmbient();
    setArrivalState("leaving");
    window.setTimeout(() => setArrivalState("entered"), 850);
  }

  function toggleArrivalSound() {
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    window.localStorage.setItem("interview-arc-sound-muted", String(nextMuted));
  }

  function toggleAmbientSound() {
    if (ambientPlaying) {
      stopAmbient();
      setSoundMuted(true);
      window.localStorage.setItem("interview-arc-sound-muted", "true");
      return;
    }
    startAmbient();
    setSoundMuted(false);
    window.localStorage.setItem("interview-arc-sound-muted", "false");
  }

  function chooseAmbientTrack(index: number) {
    playAmbientTrack(index);
    setSoundMuted(false);
    window.localStorage.setItem("interview-arc-sound-muted", "false");
  }

  function togglePetals() {
    setPetalsEnabled((current) => {
      window.localStorage.setItem("interview-arc-petals-paused", String(current));
      return !current;
    });
  }

  const allTodayActivities = useMemo(() => {
    return draft.extraActivities.filter((activity) =>
      draft.publicationStatuses[activity.id] !== "published" && !activity.artifactPath
    );
  }, [draft.extraActivities, draft.publicationStatuses]);
  const currentFocusBlocks = draft.focusBlocks;
  const allSessions: PracticeSession[] = useMemo(() => {
    const visibleActivityIds = new Set([
      ...allTodayActivities.map((activity) => activity.id),
      ...currentFocusBlocks.map((block) => block.id),
    ]);
    return draft.sessions.filter((session) =>
      session.activityIds.some((activityId) => visibleActivityIds.has(activityId))
    );
  }, [allTodayActivities, currentFocusBlocks, draft.sessions]);
  const sessionByActivityId = useMemo(() => {
    const membership = new Map<string, PracticeSession>();
    allSessions.forEach((session) => session.activityIds.forEach((activityId) => membership.set(activityId, session)));
    return membership;
  }, [allSessions]);
  const assignedExtraIds = new Set(allSessions.flatMap((session) => session.activityIds));
  const looseActivities = allTodayActivities.filter((activity) => !assignedExtraIds.has(activity.id));
  const looseFocusBlocks = currentFocusBlocks.filter((block) => !assignedExtraIds.has(block.id));

  function interactionModePhase(activityId: string) {
    const timer = draft.timers[activityId];
    return timer?.completed
      ? "review" as const
      : timer?.startedAt
        ? "active_attempt" as const
        : "fresh_attempt" as const;
  }

  function interactionModeDefinition(activityId: string) {
    const modeId = draft.interactionModes[activityId]?.current?.interactionModeId;
    return draft.interactionModeRegistry?.modes.find((mode) => mode.id === modeId) ?? null;
  }

  function interactionModeBadge(activityId: string) {
    const summary = draft.interactionModes[activityId];
    const definition = interactionModeDefinition(activityId);
    const pending = summary?.current?.lastMutationId.startsWith("pending:");
    return (
      <span className={`interaction-mode-badge ${summary?.state === "recorded" ? "recorded" : "unselected"} ${pending ? "pending" : ""}`}>
        {pending ? "Saving" : definition?.label ?? summary?.current?.interactionModeId ?? "Choose mode"}
      </span>
    );
  }

  function selectInteractionMode(activity: JournalActivity, interactionModeId: string) {
    const registry = draft.interactionModeRegistry;
    if (!registry) return;
    const timestamp = Date.now();
    const mutationId = `website-mode-${crypto.randomUUID()}`;
    const prior = draft.interactionModes[activity.id]?.current ?? null;
    const expectedRevision = prior?.revision ?? 0;
    setLastModeIntent({ activityId: activity.id, interactionModeId });
    setDraft((current) => ({
      ...current,
      interactionModes: {
        ...current.interactionModes,
        [activity.id]: {
          state: "recorded",
          current: {
            activityId: activity.id,
            interactionModeId,
            registryVersion: registry.registryVersion,
            revision: expectedRevision + 1,
            source: "explicit_user_instruction",
            lastMutationId: `pending:${mutationId}`,
            updatedAt: timestamp,
          },
        } satisfies InteractionModeSummary,
      },
    }));
    enqueue({
      type: "interaction-mode-set",
      activityId: activity.id,
      interactionModeId,
      expectedRevision,
      mutationId,
      source: "explicit_user_instruction",
      reason: `The owner selected ${interactionModeId} on Today.`,
      occurredAt: timestamp,
      authorization: "explicit_user_instruction",
    });
  }

  const careerQueryParams = useCallback((cursor?: string) => {
    const params = new URLSearchParams({
      from: shiftDate(journal.date, -364),
      to: journal.date,
      limit: "50",
    });
    if (careerSearch.trim()) params.set("q", careerSearch.trim());
    if (careerStatuses.length) params.set("status", careerStatuses.join(","));
    if (careerSource) params.set("source", careerSource);
    if (careerReferral !== "all") params.set("referral", careerReferral);
    if (cursor) params.set("cursor", cursor);
    return params;
  }, [careerReferral, careerSearch, careerSource, careerStatuses, journal.date]);

  const careerQueryKey = careerQueryParams().toString();
  careerQueryKeyRef.current = careerQueryKey;

  useEffect(() => {
    if (view !== "journey") return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCareerLoading(true);
      const params = careerQueryParams();
      void fetch(`/api/career-work?${params}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Career Work could not load.");
          return response.json() as Promise<CareerWorkPayload>;
        })
        .then((payload) => {
          if (!cancelled) setCareerWork(payload);
        })
        .catch(() => {
          if (!cancelled) setCareerWork(null);
        })
        .finally(() => {
          if (!cancelled) setCareerLoading(false);
        });
    }, careerSearch ? 250 : 0);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [careerQueryParams, careerSearch, view, draft.historyFocusBlocks, draft.timers]);

  async function loadMoreCareerJobs() {
    const cursor = careerWork?.jobJourney.jobs?.page.nextCursor;
    if (!cursor || careerLoadingMore) return;
    const expectedQueryKey = careerQueryKeyRef.current;
    setCareerLoadingMore(true);
    try {
      const response = await fetch(`/api/career-work?${careerQueryParams(cursor)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("More jobs could not load.");
      const payload = await response.json() as CareerWorkPayload;
      if (
        expectedQueryKey !== careerQueryKeyRef.current ||
        payload.jobJourney.status !== "available" ||
        !payload.jobJourney.jobs
      ) return;
      setCareerWork((current) => {
        if (current?.jobJourney.status !== "available" || !current.jobJourney.jobs) return payload;
        const jobs = [...current.jobJourney.jobs.jobs, ...payload.jobJourney.jobs.jobs];
        return {
          ...payload,
          focus: current.focus,
          jobJourney: {
            ...payload.jobJourney,
            jobs: {
              ...payload.jobJourney.jobs,
              jobs: [...new Map(jobs.map((job) => [job.id, job])).values()],
            },
          },
        };
      });
    } catch {
      showUiToast("More Job Journey records could not load.");
    } finally {
      setCareerLoadingMore(false);
    }
  }

  useEffect(() => {
    const finished = allSessions.filter((session) => session.activityIds.length > 0
      && !draft.sessionTimers[session.id]?.completed
      && session.activityIds.every((activityId) => draft.timers[activityId]?.completed)
      && session.activityIds.every((activityId) => (
        currentFocusBlocks.some((block) => block.id === activityId)
        || Boolean(draft.outcomes[activityId])
      )));
    if (!finished.length) return;
    const timestamp = Date.now();
    finished.forEach((session) => enqueue({
      type: "timer",
      subjectId: session.id,
      kind: "session",
      action: "finish",
      activityIds: session.activityIds,
    }));
    const finishedIds = new Set(finished.map((session) => session.id));
    setDraft((current) => ({
      ...current,
      sessionTimers: Object.fromEntries(
        Object.entries(current.sessionTimers).map(([id, timer]) => {
          return finishedIds.has(id)
            ? [id, {
              ...timer,
              elapsedSeconds: elapsed(timer, timestamp),
              runningSince: null,
              completed: true,
              completedAt: timestamp,
            }]
            : [id, timer];
        }),
      ),
    }));
  }, [allSessions, currentFocusBlocks, draft.outcomes, draft.sessionTimers, draft.timers, enqueue, setDraft]);

  const activePracticeActivity =
    allTodayActivities.find((activity) => Boolean(draft.timers[activity.id]?.runningSince) && !draft.timers[activity.id]?.completed) ??
    null;
  const activeFocusBlock =
    currentFocusBlocks.find((block) => Boolean(draft.timers[block.id]?.runningSince) && !draft.timers[block.id]?.completed) ??
    null;
  const activeActivity = activePracticeActivity;
  const lastFocusedPracticeActivity =
    allTodayActivities.find((activity) => activity.id === draft.focusedActivityId) ?? null;
  const lastFocusedBlock =
    currentFocusBlocks.find((block) => block.id === draft.focusedActivityId) ?? null;
  const lastFocusedActivity = lastFocusedPracticeActivity;
  const focusedSubject = activePracticeActivity ?? activeFocusBlock ?? lastFocusedPracticeActivity ?? lastFocusedBlock;
  const focusedSession = focusedSubject
    ? sessionByActivityId.get(focusedSubject.id) ?? null
    : allSessions.find((session) => session.id === draft.focusedSessionId) ?? null;

  // The pop-out may offer the last paused activity as a resume target, but only
  // an actively running stopwatch is exposed to Voice as linked work.
  const pipActivity =
    activePracticeActivity ??
    activeFocusBlock ??
    lastFocusedPracticeActivity ??
    lastFocusedBlock ??
    allTodayActivities.find((activity) => !draft.timers[activity.id]?.completed) ??
    currentFocusBlocks.find((block) => !draft.timers[block.id]?.completed) ??
    allTodayActivities[0] ??
    currentFocusBlocks[0] ??
    null;
  const pipPracticeActivity = pipActivity?.activityClass === "focus_block" ? null : pipActivity;
  const pipSession =
    focusedSession ?? allSessions.find((session) => draft.sessionTimers[session.id]?.runningSince) ?? allSessions[0] ?? null;

  const questionBanks = useMemo(() => {
    const canonical: Record<ActivityType, QuestionBankItem[]> = {
      leetcode: content.questionBanks.leetcode,
      system_design: content.questionBanks.systemDesign,
      behavioral: content.questionBanks.behavioral,
    };
    const personal = draft.personalQuestions.reduce<Record<ActivityType, QuestionBankItem[]>>((result, question) => {
      result[question.specialty].push({
        id: question.questionId,
        title: question.title,
        prompt: question.prompt ?? undefined,
        url: question.url ?? undefined,
        source: question.source,
        problemNumber: question.problemNumber ?? undefined,
        difficulty: question.difficulty ?? undefined,
        acceptanceRate: question.acceptanceRate ?? undefined,
        topics: question.topics ?? [],
        tags: question.tags,
        companyTags: question.companyTags ?? [],
        companySignals: question.companySignals ?? [],
        priority: question.priority,
        targetMinutes: question.targetMinutes,
        active: question.active,
      });
      return result;
    }, { leetcode: [], system_design: [], behavioral: [] });
    return Object.fromEntries((Object.keys(canonical) as ActivityType[]).map((type) => {
      const personalById = new Map(personal[type].map((question) => [question.id, question]));
      const canonicalIds = new Set(canonical[type].map((question) => question.id));
      const mergedCanonical = canonical[type].map((question) => {
        const ownerQuestion = personalById.get(question.id);
        if (!ownerQuestion) return question;
        const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
        const signals = new Map(
          [...(question.companySignals ?? []), ...(ownerQuestion.companySignals ?? [])]
            .map((signal) => [`${signal.company}\u0000${signal.window}\u0000${signal.capturedAt}`, signal]),
        );
        return {
          ...question,
          problemNumber: ownerQuestion.problemNumber ?? question.problemNumber,
          difficulty: ownerQuestion.difficulty ?? question.difficulty,
          acceptanceRate: ownerQuestion.acceptanceRate ?? question.acceptanceRate,
          topics: unique([...question.topics, ...ownerQuestion.topics]),
          tags: unique([...(question.tags ?? []), ...(ownerQuestion.tags ?? [])]),
          companyTags: unique([...(question.companyTags ?? []), ...(ownerQuestion.companyTags ?? [])]),
          companySignals: [...signals.values()],
          priority: ownerQuestion.priority,
          targetMinutes: ownerQuestion.targetMinutes,
          active: ownerQuestion.active,
        };
      });
      return [type, [
        ...personal[type].filter((question) => !canonicalIds.has(question.id)),
        ...mergedCanonical,
      ]];
    })) as Record<ActivityType, QuestionBankItem[]>;
  }, [content.questionBanks, draft.personalQuestions]);

  const bankFor = useCallback((type: ActivityType) => questionBanks[type], [questionBanks]);

  function isStarred(type: ActivityType, questionId?: string) {
    return Boolean(questionId && draft.problemPreferences.some((preference) => preference.specialty === type && preference.questionId === questionId && preference.starred));
  }

  function toggleProblemStar(type: ActivityType, questionId?: string) {
    if (!questionId) return;
    const starred = !isStarred(type, questionId);
    setDraft((current) => ({
      ...current,
      problemPreferences: [
        ...current.problemPreferences.filter((preference) => !(preference.specialty === type && preference.questionId === questionId)),
        { specialty: type, questionId, starred, updatedAt: Date.now() },
      ],
    }));
    enqueue({ type: "problem-star", specialty: type, questionId, starred });
  }

  function profileFor(type: ActivityType, questionId?: string) {
    return questionId ? draft.solutionProfiles.find((profile) => profile.specialty === type && profile.questionId === questionId) : undefined;
  }

  function hasReusableSolution(type: ActivityType, question: QuestionBankItem) {
    const owner = profileFor(type, question.id)?.payload;
    const canonical = question.solutionProfile;
    const effective = owner && canonical
      ? { ...canonical, ...owner, tags: effectiveProfileTags(canonical, owner) }
      : owner ?? canonical;
    return isReusableSolutionProfile(type, effective);
  }

  function toggleTimer(activityId: string) {
    // Event-handler timestamp; this is not evaluated during render.
    const timestamp = Date.now();
    setNow(timestamp);
    const priorTimer = draft.timers[activityId];
    if (priorTimer?.completed) return;
    const parentSession = sessionByActivityId.get(activityId);
    if (parentSession && draft.sessionTimers[parentSession.id]?.completed) return;
    const session = parentSession;
    const action = priorTimer?.runningSince ? "pause" : "start";
    const sessionTimer = session ? draft.sessionTimers[session.id] : undefined;
    enqueue(
      ...(action === "start" && session && !sessionTimer?.runningSince && !sessionTimer?.completed
        ? [{ type: "timer" as const, subjectId: session.id, kind: "session" as const, action: "start" as const, activityIds: session.activityIds }]
        : []),
      {
        type: "timer",
        subjectId: activityId,
        kind: "activity",
        action,
        sessionId: session?.id,
      },
    );
    setDraft((current) => {
      const timers = { ...current.timers };
      const prior = timers[activityId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      if (prior.completed) return current;
      if (prior.runningSince) {
        timers[activityId] = { ...prior, elapsedSeconds: elapsed(prior, timestamp), runningSince: null };
      } else {
        for (const [id, active] of Object.entries(timers)) {
          if (active.runningSince) timers[id] = { ...active, elapsedSeconds: elapsed(active, timestamp), runningSince: null };
        }
        timers[activityId] = {
          ...prior,
          elapsedSeconds: prior.elapsedSeconds,
          startedAt: prior.startedAt ?? timestamp,
          runningSince: timestamp,
          completed: false,
          completedAt: null,
        };
      }
      const sessionTimers = { ...current.sessionTimers };
      if (action === "start" && session && !sessionTimer?.completed) {
        for (const [id, active] of Object.entries(sessionTimers)) {
          if (id !== session.id && active.runningSince) {
            sessionTimers[id] = { ...active, elapsedSeconds: elapsed(active, timestamp), runningSince: null };
          }
        }
        const activeSession = sessionTimers[session.id] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
        sessionTimers[session.id] = {
          ...activeSession,
          startedAt: activeSession.startedAt ?? timestamp,
          runningSince: activeSession.runningSince ?? timestamp,
        };
      } else if (action === "start" && !session) {
        for (const [id, active] of Object.entries(sessionTimers)) {
          if (active.runningSince) {
            sessionTimers[id] = { ...active, elapsedSeconds: elapsed(active, timestamp), runningSince: null };
          }
        }
      }
      return {
        ...current,
        timers,
        sessionTimers,
        focusedActivityId: activityId,
        focusedSessionId: session?.id ?? null,
        focusedAt: timestamp,
      };
    });
  }

  function toggleSessionTimer(sessionId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    const priorSession = draft.sessionTimers[sessionId];
    if (priorSession?.completed) return;
    const session = allSessions.find((candidate) => candidate.id === sessionId);
    enqueue({
      type: "timer",
      subjectId: sessionId,
      kind: "session",
      action: priorSession?.runningSince ? "pause" : "start",
      activityIds: session?.activityIds ?? [],
    });
    setDraft((current) => {
      const prior = current.sessionTimers[sessionId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      if (prior.completed) return current;
      const pausing = Boolean(prior.runningSince);
      const sessionTimers = { ...current.sessionTimers };
      if (!pausing) {
        for (const [id, active] of Object.entries(sessionTimers)) {
          if (id !== sessionId && active.runningSince) {
            sessionTimers[id] = { ...active, elapsedSeconds: elapsed(active, timestamp), runningSince: null };
          }
        }
      }
      sessionTimers[sessionId] = pausing
        ? { ...prior, elapsedSeconds: elapsed(prior, timestamp), runningSince: null, completed: false }
        : { ...prior, startedAt: prior.startedAt ?? timestamp, runningSince: timestamp, completed: false };
      const timers = { ...current.timers };
      if (!pausing && session) {
        for (const [activityId, activityTimer] of Object.entries(timers)) {
          if (activityTimer.runningSince && !session.activityIds.includes(activityId)) {
            timers[activityId] = { ...activityTimer, elapsedSeconds: elapsed(activityTimer, timestamp), runningSince: null };
          }
        }
      }
      if (pausing && session) {
        session.activityIds.forEach((activityId) => {
          const activityTimer = timers[activityId];
          if (activityTimer?.runningSince) {
            timers[activityId] = { ...activityTimer, elapsedSeconds: elapsed(activityTimer, timestamp), runningSince: null };
          }
        });
      }
      return {
        ...current,
        timers,
        sessionTimers,
        focusedSessionId: sessionId,
        focusedAt: timestamp,
      };
    });
  }

  function completeSessionTimer(sessionId: string) {
    const existing = draft.sessionTimers[sessionId];
    if (!existing?.startedAt || existing.completed) return;
    const session = allSessions.find((candidate) => candidate.id === sessionId);
    const practiceActivityIds = new Set(allTodayActivities.map((activity) => activity.id));
    const missingResults = session?.activityIds.filter((activityId) => (
      practiceActivityIds.has(activityId) &&
      Boolean(draft.timers[activityId]?.startedAt) && !draft.outcomes[activityId]
    )) ?? [];
    if (missingResults.length) {
      setRequiredResultIds(missingResults);
      setLifecycleDialog({ kind: "session-results", sessionId, missingCount: missingResults.length });
      return;
    }
    setLifecycleDialog({ kind: "finish-session", sessionId });
  }

  function finishSessionTimer(sessionId: string) {
    const timestamp = Date.now();
    const existing = draft.sessionTimers[sessionId];
    if (!existing?.startedAt || existing.completed) return;
    const session = allSessions.find((candidate) => candidate.id === sessionId);
    setLifecycleDialog(null);
    setNow(timestamp);
    enqueue({ type: "timer", subjectId: sessionId, kind: "session", action: "finish", activityIds: session?.activityIds ?? [] });
    setDraft((current) => {
      const prior = current.sessionTimers[sessionId];
      if (!prior?.startedAt || prior.completed) return current;
      const timers = { ...current.timers };
      session?.activityIds.forEach((activityId) => {
        const activityTimer = timers[activityId];
        if (activityTimer?.startedAt && !activityTimer.completed) {
          timers[activityId] = {
            ...activityTimer,
            elapsedSeconds: elapsed(activityTimer, timestamp),
            runningSince: null,
            completed: true,
            completedAt: timestamp,
          };
        }
      });
      return {
        ...current,
        timers,
        sessionTimers: {
          ...current.sessionTimers,
          [sessionId]: {
            ...prior,
            elapsedSeconds: elapsed(prior, timestamp),
            startedAt: prior.startedAt,
            runningSince: null,
            completed: true,
            completedAt: timestamp,
          },
        },
      };
    });
  }

  function completeTimer(activityId: string) {
    const timestamp = Date.now();
    const existing = draft.timers[activityId];
    if (!existing?.startedAt || existing.completed) return;
    const parentSession = sessionByActivityId.get(activityId);
    if (parentSession && draft.sessionTimers[parentSession.id]?.completed) return;
    if (!draft.outcomes[activityId]) {
      setRequiredResultIds((current) => [...new Set([...current, activityId])]);
      showUiToast("Choose a result before completing this activity.");
      return;
    }
    setNow(timestamp);
    enqueue({
      type: "timer",
      subjectId: activityId,
      kind: "activity",
      action: "finish",
      sessionId: sessionByActivityId.get(activityId)?.id,
    });
    setDraft((current) => {
      const prior = current.timers[activityId];
      if (!prior?.startedAt || prior.completed) return current;
      return {
        ...current,
        timers: {
          ...current.timers,
          [activityId]: {
            ...prior,
            elapsedSeconds: elapsed(prior, timestamp),
            startedAt: prior.startedAt ?? timestamp,
            runningSince: null,
            completed: true,
            completedAt: timestamp,
          },
        },
        focusedActivityId: activityId,
        focusedSessionId: sessionByActivityId.get(activityId)?.id ?? current.focusedSessionId,
        focusedAt: timestamp,
      };
    });
  }

  function completeFocusBlock(blockId: string) {
    const timestamp = Date.now();
    const existing = draft.timers[blockId];
    if (!existing?.startedAt || existing.completed) return;
    setNow(timestamp);
    const parentSession = sessionByActivityId.get(blockId);
    enqueue({ type: "timer", subjectId: blockId, kind: "activity", action: "finish", sessionId: parentSession?.id });
    setDraft((current) => ({
      ...current,
      timers: {
        ...current.timers,
        [blockId]: {
          ...current.timers[blockId],
          elapsedSeconds: elapsed(current.timers[blockId], timestamp),
          runningSince: null,
          completed: true,
          completedAt: timestamp,
        },
      },
      focusedActivityId: blockId,
      focusedSessionId: parentSession?.id ?? null,
      focusedAt: timestamp,
    }));
  }

  function saveFocusBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = focusTitle.trim();
    const plannedSeconds = Math.max(60, Math.min(12 * 60 * 60, Math.round(Number(focusMinutes) * 60)));
    if (!title || !Number.isFinite(plannedSeconds)) return;
    const timestamp = Date.now();
    const existingBlock = draft.focusBlocks.find((block) => block.id === editingFocusBlockId);
    const block: FocusBlock = {
      id: existingBlock?.id ?? `${journal.date}-focus-job-applications-${crypto.randomUUID()}`,
      workbenchId: draft.workbench?.id,
      activityClass: "focus_block",
      focusCategory: "job_applications",
      title,
      plannedSeconds,
      ...(focusNote.trim() ? { note: focusNote.trim() } : {}),
      date: journal.date,
      createdAt: existingBlock?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    setDraft((current) => ({
      ...current,
      focusBlocks: existingBlock
        ? current.focusBlocks.map((candidate) => candidate.id === block.id ? block : candidate)
        : [...current.focusBlocks, block],
    }));
    enqueue({ type: "focus-block-upsert", block });
    setFocusComposerOpen(false);
    setEditingFocusBlockId("");
    setFocusTitle("Job applications");
    setFocusMinutes("60");
    setFocusNote("");
    showUiToast(existingBlock ? "Career focus block updated." : "Job application focus block added to Today.");
  }

  function closeFocusComposer() {
    setFocusComposerOpen(false);
    setEditingFocusBlockId("");
    setFocusTitle("Job applications");
    setFocusMinutes("60");
    setFocusNote("");
  }

  function editFocusBlock(block: FocusBlock) {
    if (draft.timers[block.id]?.completed) {
      showUiToast("Completed career focus blocks are locked.");
      return;
    }
    setEditingFocusBlockId(block.id);
    setFocusTitle(block.title);
    setFocusMinutes(String(Math.round(block.plannedSeconds / 60)));
    setFocusNote(block.note ?? "");
    setFocusComposerOpen(true);
  }

  function removeFocusBlockFromToday(blockId: string) {
    if (draft.timers[blockId]?.startedAt) {
      showUiToast("Started career time stays in Career Work.");
      return;
    }
    const parentSession = sessionByActivityId.get(blockId);
    const nextSession = parentSession ? {
      ...parentSession,
      activityIds: parentSession.activityIds.filter((id) => id !== blockId),
      allocatedSeconds: Math.max(0, parentSession.allocatedSeconds - (currentFocusBlocks.find((block) => block.id === blockId)?.plannedSeconds ?? 0)),
    } : null;
    const removesEmptySession = Boolean(nextSession && nextSession.activityIds.length === 0);
    enqueue(
      { type: "focus-block-remove", id: blockId },
      ...(nextSession
        ? removesEmptySession
          ? [{ type: "session-remove" as const, id: nextSession.id, activityIds: [] }]
          : [{ type: "session-upsert" as const, session: nextSession as LocalSession }]
        : []),
    );
    setDraft((current) => ({
      ...current,
      focusBlocks: current.focusBlocks.filter((block) => block.id !== blockId),
      sessions: nextSession
        ? removesEmptySession
          ? current.sessions.filter((session) => session.id !== nextSession.id)
          : current.sessions.map((session) => session.id === nextSession.id ? nextSession as LocalSession : session)
        : current.sessions,
    }));
  }

  function setOutcome(activityId: string, outcome?: Outcome) {
    const timer = draft.timers[activityId];
    if (!timer?.startedAt || draft.publicationStatuses[activityId] === "published") return;
    enqueue({ type: "outcome", activityId, outcome: outcome ?? null, sessionId: sessionByActivityId.get(activityId)?.id });
    setDraft((current) => {
      const outcomes = { ...current.outcomes };
      if (outcome) outcomes[activityId] = outcome;
      else delete outcomes[activityId];
      return {
        ...current,
        outcomes,
      };
    });
    if (outcome) setRequiredResultIds((current) => current.filter((id) => id !== activityId));
  }

  async function createConnectionToken() {
    setIntegrationBusy(true);
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Interview Arc tools" }),
      });
      if (!response.ok) throw new Error("Unable to create token");
      const payload = (await response.json()) as { token: string };
      setIntegrationToken(payload.token);
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function copyConnectionToken() {
    if (!integrationToken) return;
    await navigator.clipboard.writeText(integrationToken);
  }

  function isActivityComplete(activity: JournalActivity) {
    if (activity.status === "completed") return true;
    return Boolean(activity.artifactPath || draft.timers[activity.id]?.completed);
  }

  function savePersonalNote(activityId: string, note: string) {
    setDraft((current) => ({ ...current, notes: { ...current.notes, [activityId]: note } }));
    enqueue({ type: "activity-note", activityId, note });
    setSelectedEntry((current) => current && (current.artifact?.activityId || current.id) === activityId
      ? { ...current, personalNote: note }
      : current);
  }

  function openNoteComposer(note?: PracticeNote | "personal") {
    setNoteComposerOpen(true);
    if (note === "personal") {
      setEditingNoteId("personal");
      setNoteDraft(selectedEntry?.personalNote ?? "");
    } else if (note) {
      setEditingNoteId(note.id);
      setNoteDraft(note.body);
    } else {
      setEditingNoteId("");
      setNoteDraft("");
    }
  }

  async function saveCaseNote() {
    if (!selectedEntryActivityId || !noteDraft.trim()) return;
    setNoteBusy(true);
    try {
      if (editingNoteId === "personal") {
        savePersonalNote(selectedEntryActivityId, noteDraft.trim());
      } else if (editingNoteId) {
        const response = await fetch("/api/practice-notes", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noteId: editingNoteId, body: noteDraft.trim() }),
        });
        if (!response.ok) throw new Error("Unable to update note");
        const updatedAt = Date.now();
        setDraft((current) => ({ ...current, structuredNotes: { ...current.structuredNotes, [selectedEntryActivityId]: (current.structuredNotes[selectedEntryActivityId] ?? []).map((note) => note.id === editingNoteId ? { ...note, body: noteDraft.trim(), updatedAt } : note) } }));
        setSelectedEntry((current) => current ? { ...current, pinnedNotes: (current.pinnedNotes ?? []).map((note) => note.id === editingNoteId ? { ...note, body: noteDraft.trim(), updatedAt } : note) } : current);
      } else {
        const response = await fetch("/api/practice-notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ activityId: selectedEntryActivityId, date: readerSelectedEntry?.date, body: noteDraft.trim(), kind: "remember" }),
        });
        if (!response.ok) throw new Error("Unable to add note");
        const note = await response.json() as PracticeNote;
        setDraft((current) => ({ ...current, structuredNotes: { ...current.structuredNotes, [selectedEntryActivityId]: [...(current.structuredNotes[selectedEntryActivityId] ?? []), note] } }));
        setSelectedEntry((current) => current ? { ...current, pinnedNotes: [...(current.pinnedNotes ?? []), note] } : current);
      }
    } finally {
      setNoteBusy(false);
      setNoteComposerOpen(false);
      setEditingNoteId("");
      setNoteDraft("");
    }
  }

  async function deleteCaseNote(noteId: string) {
    if (!selectedEntryActivityId) return;
    if (noteId === "personal") {
      savePersonalNote(selectedEntryActivityId, "");
      return;
    }
    const response = await fetch(`/api/practice-notes?noteId=${encodeURIComponent(noteId)}`, { method: "DELETE" });
    if (!response.ok) return;
    setDraft((current) => ({ ...current, structuredNotes: { ...current.structuredNotes, [selectedEntryActivityId]: (current.structuredNotes[selectedEntryActivityId] ?? []).filter((note) => note.id !== noteId) } }));
    setSelectedEntry((current) => current ? { ...current, pinnedNotes: (current.pinnedNotes ?? []).filter((note) => note.id !== noteId) } : current);
  }

  function publicationStatusFor(activity: JournalActivity): PublicationStatus {
    const stored = draft.publicationStatuses[activity.id];
    if (activity.artifactPath || stored === "published") return "published";
    if (isActivityComplete(activity) || stored === "ready") return "ready";
    return "draft";
  }

  function openNewActivity() {
    composerSpecialtyViewsRef.current = createComposerSpecialtyViews();
    pendingComposerScrollRestoreRef.current = 0;
    setComposerClosing(false);
    setComposerAttentionFilters([]);
    setComposerLevelFilters([]);
    setComposerStarFilter(false);
    setComposerSortKey("frequency");
    setComposerSortDir("asc");
    setComposerVisibleCount(20);
    setComposer({ ...EMPTY_COMPOSER, open: true, mode: "activity" });
  }

  function openNewSession() {
    composerSpecialtyViewsRef.current = createComposerSpecialtyViews();
    pendingComposerScrollRestoreRef.current = 0;
    setComposerClosing(false);
    setComposerAttentionFilters([]);
    setComposerLevelFilters([]);
    setComposerStarFilter(false);
    setComposerSortKey("frequency");
    setComposerSortDir("asc");
    setComposerVisibleCount(20);
    setComposer({ ...EMPTY_COMPOSER, open: true, mode: "session" });
  }

  function isSessionEditable(session: LocalSession) {
    const sessionTimer = draft.sessionTimers[session.id];
    if (sessionTimer?.runningSince || sessionTimer?.completed || sessionTimer?.elapsedSeconds) return false;
    return session.activityIds.every((activityId) => {
      const activity = allTodayActivities.find((candidate) => candidate.id === activityId);
      const focusBlock = currentFocusBlocks.find((candidate) => candidate.id === activityId);
      const timer = draft.timers[activityId];
      return !timer?.runningSince && !timer?.completed && !timer?.elapsedSeconds &&
        (focusBlock || activity?.status !== "completed") &&
        !activity?.artifactPath && !draft.publicationStatuses[activityId];
    });
  }

  function openEditSession(session: LocalSession) {
    if (!isSessionEditable(session)) return;
    composerSpecialtyViewsRef.current = createComposerSpecialtyViews();
    pendingComposerScrollRestoreRef.current = 0;
    setComposerClosing(false);
    const activities = sessionActivities(session);
    setComposer({
      ...EMPTY_COMPOSER,
      open: true,
      mode: "session",
      editingSessionId: session.id,
      sessionCoding: activities.filter((activity) => activity.type === "leetcode").length,
      sessionSystemDesign: activities.filter((activity) => activity.type === "system_design").length,
      sessionBehavioral: activities.filter((activity) => activity.type === "behavioral").length,
    });
  }

  function rememberComposerSpecialtyView(
    type = composer.type,
    patch: Partial<ComposerSpecialtyView> = {},
  ) {
    const current = composerSpecialtyViewsRef.current[type];
    composerSpecialtyViewsRef.current[type] = {
      ...current,
      ...(type === composer.type ? {
        query: composer.query,
        attentionFilters: composerAttentionFilters,
        levelFilters: composerLevelFilters,
        starFilter: composerStarFilter,
        sortKey: composerSortKey,
        sortDir: composerSortDir,
        visibleCount: composerVisibleCount,
        scrollTop: composerListRef.current?.scrollTop ?? current.scrollTop,
      } : {}),
      ...patch,
    };
  }

  function resetActiveComposerResults(patch: Partial<ComposerSpecialtyView> = {}) {
    if (composerListRef.current) composerListRef.current.scrollTop = 0;
    pendingComposerScrollRestoreRef.current = 0;
    setComposerVisibleCount(20);
    rememberComposerSpecialtyView(composer.type, {
      visibleCount: 20,
      scrollTop: 0,
      ...patch,
    });
  }

  function switchComposerType(type: ActivityType, preserveCustomDraft = false) {
    if (type === composer.type) return;
    rememberComposerSpecialtyView();
    const next = composerSpecialtyViewsRef.current[type];
    pendingComposerScrollRestoreRef.current = next.scrollTop;
    setComposerAttentionFilters(next.attentionFilters);
    setComposerLevelFilters(next.levelFilters);
    setComposerStarFilter(next.starFilter);
    setComposerSortKey(next.sortKey);
    setComposerSortDir(next.sortDir);
    setComposerVisibleCount(next.visibleCount);
    setComposer((current) => ({
      ...current,
      type,
      query: next.query,
      selectedId: "",
      minutes: type === "leetcode" ? "30" : "60",
      ...(!preserveCustomDraft ? {
        customOpen: false,
        customEditingKey: "",
        customTitle: "",
        customUrl: "",
        customPrompt: "",
      } : {}),
      customMinutes: type === "leetcode" ? "30" : "60",
    }));
  }

  function listModeFor(surface: ListSurface): ListMode {
    return surface === "library"
      ? selectedEntry ? "pane" : "main"
      : selectedProblem ? "pane" : "main";
  }

  function rememberListPosition(surface: ListSurface, mode: ListMode, position: ListPosition) {
    listPositionMemoryRef.current[surface][mode] = position;
    window.sessionStorage.setItem("interview-arc-list-position-v2", JSON.stringify(listPositionMemoryRef.current));
  }

  function captureListPosition(surface: ListSurface, mode = listModeFor(surface), remember = true): ListPosition {
    const list = surface === "library" ? pastListRef.current : bankListRef.current;
    const overflowY = list ? window.getComputedStyle(list).overflowY : "";
    const internallyScrollable = Boolean(
      list
      && (overflowY === "auto" || overflowY === "scroll")
      && list.scrollHeight > list.clientHeight + 2
    );
    const referenceTop = internallyScrollable && list ? list.getBoundingClientRect().top : 0;
    const anchor = list
      ? [...list.querySelectorAll<HTMLElement>("[data-list-item-id]")]
        .find((item) => item.getBoundingClientRect().bottom > referenceTop + 1)
      : null;
    const position = {
      pageScrollTop: window.scrollY,
      listScrollTop: list?.scrollTop ?? 0,
      ...(anchor ? {
        anchorId: anchor.dataset.listItemId,
        anchorOffset: anchor.getBoundingClientRect().top - referenceTop,
      } : {}),
    };
    if (remember) rememberListPosition(surface, mode, position);
    return position;
  }

  function restorePageScroll(scrollY: unknown) {
    const top = typeof scrollY === "number" && Number.isFinite(scrollY)
      ? Math.max(0, scrollY)
      : 0;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
    });
  }

  function openJournalEntry(entry: LibraryEntry) {
    if (readerCloseTimerRef.current !== null) {
      window.clearTimeout(readerCloseTimerRef.current);
      readerCloseTimerRef.current = null;
    }
    const openingReader = view !== "library" || !selectedEntry;
    if (view === "library" && !selectedEntry) captureListPosition("library", "main");
    if (view === "library" && selectedEntry) {
      captureListPosition("library", "pane");
      rememberListPosition("library", "main", {
        ...listPositionMemoryRef.current.library.main,
        anchorId: `library:${entry.id}`,
        centerAnchor: true,
      });
    }
    if (openingReader || (view === "library" && masterPaneState.library)) pendingSelectedRevealRef.current = "library";
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1976px)").matches) setMasterPaneOpen(false, "library");
    setReaderClosing(false);
    setSelectedEntry((current) => retainLoadedPastSnapshot(current, entry));
    transitionToView("library");
  }

  function openJourneyEntry(entry: LibraryEntry, orderedEntries: LogEntry[] = journeyRangeEntries) {
    setChartTooltip(null);
    setJourneyReaderOrderIds(uniqueJourneyEntries(orderedEntries, journeyStartDate, journal.date).map((candidate) => candidate.id));
    setReaderNotFound("");
    const currentJourneyReader = readJourneyReaderState(window.location.href);
    const currentDepth = currentJourneyReader && Number.isInteger(window.history.state?.interviewArcJourneyDepth)
      ? window.history.state.interviewArcJourneyDepth as number
      : 0;
    const originScrollY = currentJourneyReader && typeof window.history.state?.interviewArcJourneyScrollY === "number"
      ? window.history.state.interviewArcJourneyScrollY as number
      : window.scrollY;
    if (!currentJourneyReader) {
      window.history.replaceState(
        {
          interviewArcWorkspaceView: "journey",
          interviewArcJourneyDepth: 0,
          interviewArcJourneyScrollY: originScrollY,
        },
        "",
        journeyHrefWithoutReader(window.location.href),
      );
    }
    const href = journeyReaderHref(window.location.href, {
      attemptId: entry.id,
      range: String(journeyRange) as "30" | "90" | "365" | "all",
      metric: journeyMetric,
      heatmap: journeyHeatmapView,
      day: journeyDate,
      topic: journeyTopic,
    });
    window.history.pushState(
      {
        interviewArcJourneyReader: true,
        interviewArcJourneyDepth: currentDepth + 1,
        interviewArcJourneyScrollY: originScrollY,
      },
      "",
      href,
    );
    setReaderClosing(false);
    setJourneyNestedEntry((current) => retainLoadedPastSnapshot(current, entry));
    setJourneyNestedProblem(null);
    transitionToView("journey");
  }

  function openPastEntry(entry: LibraryEntry, orderedEntries: LogEntry[] = libraryEntries) {
    setChartTooltip(null);
    setPastReaderOrderIds([...new Set(orderedEntries.map((candidate) => candidate.id))]);
    setJourneyReaderOrderIds([]);
    setReaderNotFound("");
    const currentPastReader = readPastReaderState(window.location.href);
    const currentDepth = currentPastReader && Number.isInteger(window.history.state?.interviewArcPastDepth)
      ? window.history.state.interviewArcPastDepth as number
      : 0;
    if (!currentPastReader) {
      window.history.replaceState({ interviewArcPastDepth: 0 }, "", workspaceViewHref(window.location.href, "past"));
    }
    window.history.pushState(
      {
        interviewArcPastReader: true,
        interviewArcPastDepth: currentDepth + 1,
        ...(window.history.state?.interviewArcLoopOrigin ? { interviewArcLoopOrigin: true } : {}),
      },
      "",
      pastReaderHref(window.location.href, entry.id),
    );
    openJournalEntry(entry);
  }

  function openReviewEntry(entry: LibraryEntry, orderedEntries: LogEntry[]) {
    setChartTooltip(null);
    setReviewReaderOrderIds([...new Set(orderedEntries.map((candidate) => candidate.id))]);
    setReaderNotFound("");
    const currentReviewReader = readReviewReaderState(window.location.href);
    const currentDepth = currentReviewReader && Number.isInteger(window.history.state?.interviewArcReviewDepth)
      ? window.history.state.interviewArcReviewDepth as number
      : 0;
    if (!currentReviewReader) {
      window.history.replaceState(
        { interviewArcWorkspaceView: "reviews", interviewArcReviewDepth: 0 },
        "",
        workspaceViewHref(window.location.href, "reviews"),
      );
    }
    window.history.pushState(
      { interviewArcReviewReader: true, interviewArcReviewDepth: currentDepth + 1 },
      "",
      reviewReaderHref(window.location.href, entry.id),
    );
    setReaderClosing(false);
    setReviewNestedEntry((current) => retainLoadedPastSnapshot(current, entry));
    setReviewNestedProblem(null);
    transitionToView("reviews");
  }

  function openLoopActivity(activityId: string) {
    const entry = libraryEntries.find((candidate) => (
      candidate.id === activityId || candidate.artifact?.activityId === activityId
    ));
    const loopState = readLoopWorkspaceState(window.location.href) ?? { loopId: "", stageId: "" };
    window.history.replaceState(
      {
        ...window.history.state,
        interviewArcWorkspaceView: "loops",
        interviewArcLoopScrollY: window.scrollY,
        interviewArcLoopFocusActivity: activityId,
      },
      "",
      loopWorkspaceHref(window.location.href, loopState),
    );
    window.history.pushState(
      { interviewArcPastReader: true, interviewArcPastDepth: 1, interviewArcLoopOrigin: true },
      "",
      pastReaderHref(window.location.href, activityId),
    );
    setPastReaderOrderIds(entry ? [entry.id] : []);
    setJourneyReaderOrderIds([]);
    setReaderClosing(false);
    setReaderNotFound(entry ? "" : activityId);
    if (!entry) window.sessionStorage.removeItem("interview-arc-selected-past");
    setSelectedEntry(entry ?? null);
    setLibraryNestedProblem(null);
    transitionToView("library");
  }

  function showChartTooltip(target: Element, model: Omit<ChartTooltipModel, "anchor">) {
    const rect = target.getBoundingClientRect();
    setChartTooltip({ ...model, anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width } });
  }

  function closeMasterAfterSelection() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1976px)").matches) setMasterPaneOpen(false);
  }

  function toggleMasterPane() {
    if (!masterPaneOpen && (view === "library" || view === "banks")) pendingSelectedRevealRef.current = view;
    const surface = activeListSurface;
    if (!surface) return;
    setMasterPaneState((current) => {
      const open = !current[surface];
      writeMasterPanePreference(window.localStorage, surface, open);
      return { ...current, [surface]: open };
    });
  }

  function todayBlockedQuestions(excludedActivityIds: string[] = []) {
    const excludedIds = new Set(excludedActivityIds);
    const blocked = new Set<string>();
    allTodayActivities
      .filter((activity) => !excludedIds.has(activity.id))
      .forEach((activity) => addActivityToBlocked(blocked, activity));
    return blocked;
  }

  function sessionBlockedQuestions(editingSessionId = "") {
    return todayBlockedQuestions(draft.sessions.find((session) => session.id === editingSessionId)?.activityIds ?? []);
  }

  function availableSessionQuestions(type: ActivityType, editingSessionId = "") {
    const blocked = sessionBlockedQuestions(editingSessionId);
    const bank = bankFor(type);
    const dueQuestionIds = new Set(Object.values(draft.reviews)
      .filter((review) => review.specialty === type && review.questionId
        && (review.status === "due" || (review.status === "scheduled" && review.dueDate <= journal.date)))
      .map((review) => review.questionId as string));
    const available = bank.filter((question) => {
      const completedBefore = Boolean(latestFinishedAttempt(libraryEntries, type, question));
      return question.active
        && !isQuestionBlocked(question, blocked)
        && (!completedBefore || dueQuestionIds.has(question.id));
    });
    if (type !== "behavioral") return available;
    const curriculum = bank.filter(isResumeCurriculumQuestion);
    if (!curriculum.length) return [];
    const unfinishedCurriculum = available.filter(isResumeCurriculumQuestion);
    return unfinishedCurriculum.length
      ? unfinishedCurriculum
      : available.filter((question) => !isResumeCurriculumQuestion(question));
  }

  function selectBankQuestion(question: QuestionBankItem) {
    setComposer((current) => ({
      ...current,
      selectedActivities: current.selectedActivities.some((item) => item.type === current.type && item.questionId === question.id)
        ? current.selectedActivities.filter((item) => !(item.type === current.type && item.questionId === question.id))
        : [...current.selectedActivities, {
            key: `bank:${current.type}:${question.id}`,
            type: current.type,
            questionId: question.id,
            title: question.title,
            ...(question.url ? { url: question.url } : {}),
            ...(question.prompt ? { prompt: question.prompt } : {}),
            minutes: question.targetMinutes,
            topics: question.topics,
            source: "bank" as const,
          }],
    }));
  }

  function openCustomActivity(prefillUrl = "") {
    const bank = bankFor(composer.type);
    const derived = prefillUrl ? deriveQuestionFromUrl(prefillUrl, composer.type, bank) : null;
    setComposer((current) => ({
      ...current,
      customOpen: true,
      customEditingKey: "",
      customTitle: derived?.title ?? "",
      customUrl: derived?.url ?? prefillUrl,
      customPrompt: derived?.prompt ?? "",
      customMinutes: String(derived?.targetMinutes ?? (current.type === "leetcode" ? 30 : 60)),
    }));
  }

  function editStagedActivity(item: StagedActivity) {
    if (item.source !== "custom") return;
    setComposer((current) => ({
      ...current,
      customOpen: true,
      customEditingKey: item.key,
      type: item.type,
      customTitle: item.title,
      customUrl: item.url ?? "",
      customPrompt: item.prompt ?? "",
      customMinutes: String(item.minutes),
      reviewOpen: false,
    }));
  }

  function stageCustomActivity() {
    const title = composer.customTitle.trim();
    if (!title) return;
    const rawUrl = composer.customUrl.trim();
    const derived = rawUrl ? deriveQuestionFromUrl(rawUrl, composer.type, bankFor(composer.type)) : null;
    if (rawUrl && !derived) return;
    const minutes = Math.max(1, Number(composer.customMinutes) || (composer.type === "leetcode" ? 30 : 60));
    const existingKey = composer.customEditingKey;
    const key = existingKey || `custom:${composer.type}:${slugify(title)}:${Date.now().toString(36)}`;
    const item: StagedActivity = {
      key,
      type: composer.type,
      ...(derived?.questionId ? { questionId: derived.questionId } : {}),
      title: derived?.title ?? title,
      ...(derived?.url ? { url: derived.url } : {}),
      ...(composer.customPrompt.trim() || derived?.prompt ? { prompt: composer.customPrompt.trim() || derived?.prompt } : {}),
      minutes,
      topics: [],
      source: derived?.questionId ? "bank" : "custom",
    };
    setComposer((current) => ({
      ...current,
      selectedActivities: [
        ...current.selectedActivities.filter((candidate) =>
          candidate.key !== existingKey
          && !(item.questionId && candidate.type === item.type && candidate.questionId === item.questionId)
          && !(!item.questionId && candidate.type === item.type && normalizedIdentity(candidate.title) === normalizedIdentity(item.title))
        ),
        item,
      ],
      customOpen: false,
      customEditingKey: "",
      customTitle: "",
      customUrl: "",
      customPrompt: "",
      customMinutes: current.type === "leetcode" ? "30" : "60",
    }));
  }

  function removeStagedActivity(key: string) {
    setComposer((current) => ({
      ...current,
      selectedActivities: current.selectedActivities.filter((item) => item.key !== key),
    }));
  }

  function openProblemProfile(
    type: ActivityType,
    question: QuestionBankItem,
  ) {
    if (readerCloseTimerRef.current !== null) {
      window.clearTimeout(readerCloseTimerRef.current);
      readerCloseTimerRef.current = null;
    }
    const openingReader = view !== "banks" || !selectedProblem;
    if (view === "banks" && !selectedProblem) captureListPosition("banks", "main");
    if (view === "banks" && selectedProblem) {
      captureListPosition("banks", "pane");
      rememberListPosition("banks", "main", {
        ...listPositionMemoryRef.current.banks.main,
        anchorId: `banks:${type}:${question.id}`,
        centerAnchor: true,
      });
    }
    if (openingReader) pendingSelectedRevealRef.current = "banks";
    const currentBankReader = readBankReaderState(window.location.href);
    const currentDepth = currentBankReader && Number.isInteger(window.history.state?.interviewArcBankDepth)
      ? window.history.state.interviewArcBankDepth as number
      : 0;
    if (!currentBankReader) {
      window.history.replaceState(
        { interviewArcWorkspaceView: "banks", interviewArcBankDepth: 0 },
        "",
        workspaceViewHref(window.location.href, "banks"),
      );
    }
    window.history.pushState(
      { interviewArcBankReader: true, interviewArcBankDepth: currentDepth + 1 },
      "",
      bankReaderHref(window.location.href, type, question.id),
    );
    setReaderNotFound("");
    closeMasterAfterSelection();
    setReaderClosing(false);
    setBankNestedEntry(null);
    setSelectedProblem({ type, question });
  }

  function openAttemptFromSolution(entry: LibraryEntry) {
    const exactEntry = findExactPastSnapshot(libraryEntries, entry.id);
    if (!exactEntry) {
      setReaderNotFound("That exact historical attempt is no longer available.");
      return;
    }
    setReaderClosing(false);
    if (view === "banks" && selectedProblem) {
      const currentDepth = Number.isInteger(window.history.state?.interviewArcBankDepth)
        ? window.history.state.interviewArcBankDepth as number
        : 1;
      window.history.pushState(
        { interviewArcBankReader: true, interviewArcBankDepth: currentDepth + 1 },
        "",
        bankReaderHref(window.location.href, selectedProblem.type, selectedProblem.question.id, exactEntry.id),
      );
      setBankNestedEntry((current) => retainLoadedPastSnapshot(current, exactEntry));
      return;
    }
    if (view === "journey") {
      openJourneyEntry(exactEntry, selectedProblemAttempts);
      return;
    }
    if (view === "reviews") {
      openReviewEntry(exactEntry, selectedProblemAttempts);
      return;
    }
    setLibraryNestedProblem(null);
    openPastEntry(exactEntry, selectedProblemAttempts);
  }

  function bankQuestionForEntry(entry: LogEntry) {
    return bankFor(entry.type).find((question) =>
      question.id === entry.questionId ||
      normalizedIdentity(question.title) === normalizedIdentity(entry.title)
    );
  }

  function openEntrySolution(entry: LogEntry) {
    const question = bankQuestionForEntry(entry);
    if (!question || !hasReusableSolution(entry.type, question)) return;
    if (view === "journey" && journeyNestedEntry) {
      const journeyState = readJourneyReaderState(window.location.href);
      if (!journeyState) return;
      const currentDepth = Number(window.history.state?.interviewArcJourneyDepth ?? 1);
      window.history.pushState(
        {
          interviewArcJourneyReader: true,
          interviewArcJourneyDepth: currentDepth + 1,
          interviewArcJourneyScrollY: window.history.state?.interviewArcJourneyScrollY,
        },
        "",
        journeyReaderHref(window.location.href, { ...journeyState, specialty: entry.type, problemId: question.id }),
      );
      setReaderClosing(false);
      setJourneyNestedProblem({ type: entry.type, question });
      return;
    }
    if (view === "reviews" && reviewNestedEntry) {
      const reviewState = readReviewReaderState(window.location.href);
      if (!reviewState) return;
      const currentDepth = Number(window.history.state?.interviewArcReviewDepth ?? 1);
      window.history.pushState(
        { interviewArcReviewReader: true, interviewArcReviewDepth: currentDepth + 1 },
        "",
        reviewSolutionReaderHref(window.location.href, entry.id, entry.type, question.id),
      );
      setReaderClosing(false);
      setReviewNestedProblem({ type: entry.type, question });
      return;
    }
    if (view === "banks" && bankNestedEntry && selectedProblem) {
      const currentDepth = Number(window.history.state?.interviewArcBankDepth ?? 2);
      window.history.pushState(
        { interviewArcBankReader: true, interviewArcBankDepth: currentDepth + 1 },
        "",
        bankReaderHref(window.location.href, selectedProblem.type, selectedProblem.question.id),
      );
      setReaderClosing(false);
      setBankNestedEntry(null);
      return;
    }
    if (view === "library" && !selectedEntry) {
      captureListPosition("library", "main");
      setSelectedEntry(entry);
    }
    if (view === "library") {
      const currentDepth = Number(window.history.state?.interviewArcPastDepth ?? 1);
      window.history.pushState(
        { interviewArcPastReader: true, interviewArcPastDepth: currentDepth + 1 },
        "",
        pastSolutionReaderHref(window.location.href, entry.id, entry.type, question.id),
      );
    }
    setReaderClosing(false);
    setLibraryNestedProblem({ type: entry.type, question });
    transitionToView("library");
  }

  function addEntryToToday(entry: LogEntry) {
    const question = bankQuestionForEntry(entry);
    if (question) addBankQuestionToToday(question, entry.type);
  }

  function addBankQuestionToToday(question: QuestionBankItem, type: ActivityType) {
    if (isQuestionBlocked(question, todayBlockedQuestions())) {
      window.alert("That question is already on Today. Interview Arc allows one attempt per Pacific practice day.");
      return;
    }
    const baseId = `${journal.date}-extra-${slugify(question.title)}`;
    let id = baseId;
    let suffix = 2;
    while (draft.extraActivities.some((activity) => activity.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const activity: ExtraActivity = {
      schemaVersion: 2,
      id,
      questionId: question.id,
      date: journal.date,
      source: "extra",
      type,
      ...(type === "leetcode" ? { recordKind: "attempt" as const } : {}),
      title: question.title,
      ...(question.url ? { url: question.url } : {}),
      ...(question.prompt ? { prompt: question.prompt } : {}),
      allocatedSeconds: question.targetMinutes * 60,
      timerGroupId: id,
      timingSource: "website",
      status: "planned",
      ...(question.topics.length ? { notes: question.topics.join(", ") } : {}),
    };
    setDraft((current) => ({ ...current, extraActivities: [...current.extraActivities, activity] }));
    enqueue({ type: "extra-upsert", activity });
    setView("today");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".loose-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer.editingId) {
      if (!composer.selectedActivities.length && !composer.focusSelected) return;
      const blocked = todayBlockedQuestions();
      const duplicate = composer.selectedActivities.find((item) => {
        const identity: QuestionBankItem = {
          id: item.questionId ?? `personal-${item.type}-${slugify(item.title)}`,
          title: item.title,
          ...(item.url ? { url: item.url } : {}),
          topics: item.topics,
          targetMinutes: item.minutes,
          active: true,
        };
        if (isQuestionBlocked(identity, blocked)) return true;
        blockKeysForQuestion(identity).forEach((key) => blocked.add(key));
        return false;
      });
      if (duplicate) {
        showUiToast(`${duplicate.title} is already on Today or selected more than once.`);
        return;
      }
      const batchStamp = Date.now().toString(36);
      const { activities, session: builtSession } = buildSelectedActivityBatch({
        date: journal.date,
        stamp: batchStamp,
        sessionNumber: allSessions.length + 1,
        destination: composer.batchDestination,
        items: composer.selectedActivities,
      });
      const focusBlock: FocusBlock | null = composer.focusSelected ? {
        id: `${journal.date}-focus-job-applications-${batchStamp}`,
        workbenchId: draft.workbench?.id,
        activityClass: "focus_block",
        focusCategory: "job_applications",
        title: "Job applications",
        plannedSeconds: Math.max(60, Math.min(12 * 60 * 60, Math.round((Number(composer.focusMinutes) || 60) * 60))),
        date: journal.date,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } : null;
      const session = builtSession && focusBlock ? {
        ...builtSession,
        allocatedSeconds: builtSession.allocatedSeconds + focusBlock.plannedSeconds,
        activityIds: [...builtSession.activityIds, focusBlock.id],
      } : builtSession;
      setDraft((current) => ({
        ...current,
        extraActivities: [...current.extraActivities, ...activities],
        focusBlocks: focusBlock ? [...current.focusBlocks, focusBlock] : current.focusBlocks,
        sessions: session ? [...current.sessions, session] : current.sessions,
      }));
      enqueue(
        ...composer.selectedActivities
          .filter((item) => item.source === "custom" && !item.questionId)
          .map((item) => ({
            type: "personal-question-upsert" as const,
            specialty: item.type,
            question: {
              questionId: `personal-${item.type}-${slugify(item.title)}`,
              title: item.title,
              ...(item.url ? { url: item.url } : {}),
              ...(item.prompt ? { prompt: item.prompt } : item.type !== "leetcode" ? { prompt: item.title } : {}),
              targetMinutes: item.minutes,
            },
          })),
        ...(session ? [{ type: "session-upsert" as const, session }] : []),
        ...activities.map((activity) => ({ type: "extra-upsert" as const, activity })),
        ...(focusBlock ? [{ type: "focus-block-upsert" as const, block: focusBlock }] : []),
      );
      closeComposer();
      const addedCount = activities.length + (focusBlock ? 1 : 0);
      showUiToast(session
        ? `${addedCount} ${addedCount === 1 ? "activity" : "activities"} added as ${session.label}.`
        : `${addedCount} ${addedCount === 1 ? "activity" : "activities"} added to Today.`);
      return;
    }
    const bank = bankFor(composer.type);
    const selected = bank.find((question) => question.id === composer.selectedId);
    const derived = !selected ? deriveQuestionFromUrl(composer.query, composer.type, bank) : null;
    if (composer.type === "leetcode" && !selected && !derived) return;
    const title = selected?.title ?? derived?.title ?? composer.query.trim();
    if (!title) return;
    const minutes = Math.max(1, Number(composer.minutes) || selected?.targetMinutes || derived?.targetMinutes || 30);
    const existing = draft.extraActivities.find((activity) => activity.id === composer.editingId);
    const id = existing?.id ?? `${journal.date}-extra-${slugify(title)}-${event.timeStamp.toString(36)}`;
    const questionId = selected?.id ?? derived?.questionId ?? existing?.questionId ?? `personal-${composer.type}-${slugify(title)}`;
    const blocked = todayBlockedQuestions(existing ? [existing.id] : []);
    const identityQuestion: QuestionBankItem = {
      id: questionId,
      title,
      url: selected?.url ?? derived?.url,
      topics: [],
      targetMinutes: minutes,
      active: true,
    };
    if (isQuestionBlocked(identityQuestion, blocked)) {
      window.alert("That question is already on Today. Interview Arc allows one attempt per Pacific practice day.");
      return;
    }
    const activity: ExtraActivity = {
      schemaVersion: 2,
      id,
      questionId,
      date: journal.date,
      source: "extra",
      type: composer.type,
      ...(composer.type === "leetcode" ? { recordKind: "attempt" as const } : {}),
      title,
      ...(selected?.url || derived?.url ? { url: selected?.url ?? derived?.url } : {}),
      ...(selected?.prompt || derived?.prompt ? { prompt: selected?.prompt ?? derived?.prompt } : composer.type !== "leetcode" ? { prompt: title } : {}),
      allocatedSeconds: minutes * 60,
      timerGroupId: existing?.timerGroupId ?? id,
      timingSource: "website",
      status: "planned",
      ...(selected?.topics?.length ? { notes: selected.topics.join(", ") } : {}),
    };
    setDraft((current) => ({
      ...current,
      extraActivities: existing
        ? current.extraActivities.map((item) => item.id === activity.id ? activity : item)
        : [...current.extraActivities, activity],
    }));
    enqueue(
      { type: "extra-upsert", activity },
      ...(!selected && !derived?.questionId ? [{
        type: "personal-question-upsert" as const,
        specialty: composer.type,
        question: {
          questionId,
          title,
          ...(derived?.url ? { url: derived.url } : {}),
          ...(composer.type !== "leetcode" ? { prompt: title } : {}),
          targetMinutes: minutes,
        },
      }] : []),
    );
    closeComposer();
  }

  function saveFullSession() {
    const existing = draft.sessions.find((session) => session.id === composer.editingSessionId);
    if (existing && !isSessionEditable(existing)) return;
    const sessionNumber = existing
      ? allSessions.findIndex((session) => session.id === existing.id) + 1
      : allSessions.length + 1;
    const sessionId = existing?.id ?? `${journal.date}-session-${sessionNumber}-${draft.extraActivities.length}-${draft.sessions.length}`;
    // Skip anything already on today, except the unstarted session currently
    // being rebuilt. Earlier days remain eligible for a fresh practice day.
    const blocked = sessionBlockedQuestions(existing?.id);
    const dueReviews = Object.values(draft.reviews)
      .filter((review) => review.status === "due" || (review.status === "scheduled" && review.dueDate <= journal.date))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
    const reviewByQuestion = new Map(dueReviews.filter((review) => review.questionId).map((review) => [`${review.specialty}:${review.questionId}`, review]));
    const reviewCapacity: Record<ActivityType, number> = {
      leetcode: composer.sessionCoding,
      system_design: composer.sessionSystemDesign,
      behavioral: composer.sessionBehavioral,
    };
    const selectedReviewKeys = new Set<string>();
    const selectedReviewCounts: Record<ActivityType, number> = { leetcode: 0, system_design: 0, behavioral: 0 };
    for (const review of dueReviews) {
      if (selectedReviewKeys.size >= 2) break;
      if (!review.questionId) continue;
      if (selectedReviewCounts[review.specialty] >= reviewCapacity[review.specialty]) continue;
      const pool = bankFor(review.specialty);
      const question = pool.find((candidate) => candidate.id === review.questionId && candidate.active && !isQuestionBlocked(candidate, blocked));
      if (!question) continue;
      selectedReviewKeys.add(`${review.specialty}:${review.questionId}`);
      selectedReviewCounts[review.specialty] += 1;
    }
    function pickSessionQuestions(type: ActivityType, pool: QuestionBankItem[], count: number) {
      const reviews = dueReviews.flatMap((review) => {
        if (review.specialty !== type || !review.questionId || !selectedReviewKeys.has(`${review.specialty}:${review.questionId}`)) return [];
        const question = pool.find((candidate) => candidate.id === review.questionId && candidate.active && !isQuestionBlocked(candidate, blocked));
        return question ? [question] : [];
      });
      reviews.forEach((question) => blockKeysForQuestion(question).forEach((key) => blocked.add(key)));
      const fresh = pickQuestionsByFrequency(pool, count - reviews.length, blocked, `${sessionId}:${type}`);
      fresh.forEach((question) => blockKeysForQuestion(question).forEach((key) => blocked.add(key)));
      return [...reviews, ...fresh];
    }
    const codingQuestions = pickSessionQuestions("leetcode", availableSessionQuestions("leetcode", existing?.id), composer.sessionCoding);
    const systemQuestions = pickSessionQuestions("system_design", availableSessionQuestions("system_design", existing?.id), composer.sessionSystemDesign);
    const behaviorQuestions = pickSessionQuestions("behavioral", availableSessionQuestions("behavioral", existing?.id), composer.sessionBehavioral);
    if (
      codingQuestions.length !== composer.sessionCoding ||
      systemQuestions.length !== composer.sessionSystemDesign ||
      behaviorQuestions.length !== composer.sessionBehavioral
    ) {
      window.alert("That exact recipe is no longer available after today’s other picks. Reduce one of the counts and try again.");
      return;
    }
    const activities: ExtraActivity[] = codingQuestions.map((question) => ({
      schemaVersion: 2,
      id: `${sessionId}-${question.id}`,
      questionId: question.id,
      date: journal.date,
      source: "extra",
      type: "leetcode",
      recordKind: "attempt",
      title: question.title,
      url: question.url,
      allocatedSeconds: CODING_SESSION_MINUTES * 60,
      sessionId,
      timerGroupId: `${sessionId}-coding`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
      ...(reviewByQuestion.get(`leetcode:${question.id}`) ? {
        reviewOfActivityId: reviewByQuestion.get(`leetcode:${question.id}`)!.activityId,
        reviewReason: reviewByQuestion.get(`leetcode:${question.id}`)!.reason,
      } : {}),
    }));
    systemQuestions.forEach((question) => activities.push({
      schemaVersion: 2,
      id: `${sessionId}-${question.id}`,
      questionId: question.id,
      date: journal.date,
      source: "extra",
      type: "system_design",
      title: question.title,
      ...(question.url ? { url: question.url } : {}),
      prompt: question.prompt,
      allocatedSeconds: INTERVIEW_SESSION_MINUTES * 60,
      sessionId,
      timerGroupId: `${sessionId}-system-design`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
      ...(reviewByQuestion.get(`system_design:${question.id}`) ? {
        reviewOfActivityId: reviewByQuestion.get(`system_design:${question.id}`)!.activityId,
        reviewReason: reviewByQuestion.get(`system_design:${question.id}`)!.reason,
      } : {}),
    }));
    behaviorQuestions.forEach((question) => activities.push({
      schemaVersion: 2,
      id: `${sessionId}-${question.id}`,
      questionId: question.id,
      date: journal.date,
      source: "extra",
      type: "behavioral",
      title: question.title,
      ...(question.url ? { url: question.url } : {}),
      prompt: question.prompt,
      allocatedSeconds: INTERVIEW_SESSION_MINUTES * 60,
      sessionId,
      timerGroupId: `${sessionId}-behavioral`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
      ...(reviewByQuestion.get(`behavioral:${question.id}`) ? {
        reviewOfActivityId: reviewByQuestion.get(`behavioral:${question.id}`)!.activityId,
        reviewReason: reviewByQuestion.get(`behavioral:${question.id}`)!.reason,
      } : {}),
    }));
    if (activities.length === 0) {
      window.alert("Choose at least one activity. Questions already planned today stay out of new sessions until a new day.");
      return;
    }
    const actualCoding = activities.filter((activity) => activity.type === "leetcode").length;
    const actualSystemDesign = activities.filter((activity) => activity.type === "system_design").length;
    const actualBehavioral = activities.filter((activity) => activity.type === "behavioral").length;
    const session: LocalSession = {
      id: sessionId,
      date: existing?.date ?? journal.date,
      label: existing?.label ?? `Session ${sessionNumber}`,
      source: "extra",
      allocatedSeconds: sessionAllocationSeconds(actualCoding, actualSystemDesign, actualBehavioral),
      activityIds: activities.map((activity) => activity.id),
    };
    const replacedIds = new Set(existing?.activityIds ?? []);
    setDraft((current) => {
      const timers = { ...current.timers };
      const outcomes = { ...current.outcomes };
      const publicationStatuses = { ...current.publicationStatuses };
      const notes = { ...current.notes };
      replacedIds.forEach((id) => {
        delete timers[id];
        delete outcomes[id];
        delete publicationStatuses[id];
        delete notes[id];
      });
      return {
        ...current,
        timers,
        outcomes,
        publicationStatuses,
        notes,
        extraActivities: [
          ...current.extraActivities.filter((activity) => !replacedIds.has(activity.id)),
          ...activities,
        ],
        sessions: existing
          ? current.sessions.map((candidate) => candidate.id === session.id ? session : candidate)
          : [...current.sessions, session],
      };
    });
    enqueue(
      ...(existing ? [{ type: "session-remove" as const, id: existing.id, activityIds: existing.activityIds }] : []),
      { type: "session-upsert", session },
      ...activities.map((activity) => ({ type: "extra-upsert" as const, activity })),
    );
    closeComposer();
  }

  function showUiToast(message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setUiToast({ id: Date.now(), message });
    toastTimerRef.current = window.setTimeout(() => {
      setUiToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }

  function removeActivity(activityId: string) {
    if (draft.timers[activityId]?.startedAt || draft.outcomes[activityId] || draft.publicationStatuses[activityId]) {
      showUiToast("This activity already contains practice work, so it stays in your history.");
      return;
    }
    if (!draft.workbench) {
      showUiToast("Today is still loading. Try removing this activity again.");
      return;
    }
    enqueue({
      type: "extra-remove",
      id: activityId,
      mutationId: `website-remove-${crypto.randomUUID()}`,
      expectedWorkbenchRevision: draft.workbench.revision,
    });
    setDraft((current) => {
      const timers = { ...current.timers };
      const outcomes = { ...current.outcomes };
      const publicationStatuses = { ...current.publicationStatuses };
      const notes = { ...current.notes };
      delete timers[activityId];
      delete outcomes[activityId];
      delete publicationStatuses[activityId];
      delete notes[activityId];
      return {
        ...current,
        timers,
        outcomes,
        publicationStatuses,
        notes,
        extraActivities: current.extraActivities.filter((activity) => activity.id !== activityId),
        sessions: current.sessions.map((session) => ({ ...session, activityIds: session.activityIds.filter((id) => id !== activityId) })),
      };
    });
  }

  function removeSession(session: LocalSession) {
    if (!isSessionEditable(session)) {
      showUiToast("This session contains started or completed work and cannot be removed.");
      return;
    }
    setLifecycleDialog({ kind: "remove-session", sessionId: session.id });
  }

  function confirmRemoveSession(sessionId: string) {
    const session = draft.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || !isSessionEditable(session)) {
      setLifecycleDialog(null);
      showUiToast("This session changed and can no longer be removed.");
      return;
    }
    setLifecycleDialog(null);
    const ids = new Set(session.activityIds);
    const focusIds = currentFocusBlocks.filter((block) => ids.has(block.id)).map((block) => block.id);
    enqueue(
      { type: "session-remove", id: session.id, activityIds: session.activityIds },
      ...focusIds.map((id) => ({ type: "focus-block-remove" as const, id })),
    );
    setDraft((current) => {
      const timers = { ...current.timers };
      const sessionTimers = { ...current.sessionTimers };
      const outcomes = { ...current.outcomes };
      const publicationStatuses = { ...current.publicationStatuses };
      const notes = { ...current.notes };
      ids.forEach((id) => {
        delete timers[id];
        delete outcomes[id];
        delete publicationStatuses[id];
        delete notes[id];
      });
      delete sessionTimers[session.id];
      return {
        ...current,
        timers,
        sessionTimers,
        outcomes,
        publicationStatuses,
        notes,
        extraActivities: current.extraActivities.filter((activity) => !ids.has(activity.id)),
        focusBlocks: current.focusBlocks.filter((block) => !ids.has(block.id)),
        sessions: current.sessions.filter((item) => item.id !== session.id),
      };
    });
  }

  async function exportDraft() {
    const timestamp = now;
    const timers = Object.fromEntries(Object.entries(draft.timers).map(([id, timer]) => [id, {
      elapsedSeconds: elapsed(timer, timestamp),
      running: Boolean(timer.runningSince),
      completed: timer.completed,
      startedAt: timer.startedAt ? new Date(timer.startedAt).toISOString() : null,
      endedAt: timer.completedAt ? new Date(timer.completedAt).toISOString() : null,
      practiceDate: timer.completedAt ? practiceDateAt(timer.completedAt) : null,
      timingSource: "website",
    }]));
    const sessionTimers = Object.fromEntries(Object.entries(draft.sessionTimers).map(([id, timer]) => {
      const allocatedSeconds = allSessions.find((session) => session.id === id)?.allocatedSeconds ?? SESSION_SECONDS;
      return [id, {
        elapsedSeconds: Math.min(allocatedSeconds, elapsed(timer, timestamp)),
        remainingSeconds: remaining(timer, timestamp, allocatedSeconds),
        running: Boolean(timer.runningSince),
        completed: timer.completed,
        startedAt: timer.startedAt ? new Date(timer.startedAt).toISOString() : null,
        endedAt: timer.completedAt ? new Date(timer.completedAt).toISOString() : null,
        timingSource: "website",
      }];
    }));
    const effectivePublicationStatuses = Object.fromEntries(
      allTodayActivities.map((activity) => [activity.id, publicationStatusFor(activity)]),
    );
    const publishQueueActivityIds = allTodayActivities
      .filter((activity) => publicationStatusFor(activity) === "ready")
      .map((activity) => activity.id);
    const publishQueueByDate = Object.fromEntries(
      [...new Set(publishQueueActivityIds.map((activityId) => {
        const timer = draft.timers[activityId];
        return timer?.completedAt ? practiceDateAt(timer.completedAt) : journal.date;
      }))].sort().map((date) => [date, publishQueueActivityIds.filter((activityId) => {
        const timer = draft.timers[activityId];
        return (timer?.completedAt ? practiceDateAt(timer.completedAt) : journal.date) === date;
      })]),
    );
    let behavioralFinalAnswers: Record<string, {
      finalAnswer: BehavioralFinalAnswerProjection;
      finalAnswerMarkdown: string;
      finalAnswerHtml: string;
      practiceScenarios: BehavioralPracticeScenarioProjection | null;
      practiceScenariosMarkdown: string;
      practiceScenariosHtml: string;
      behavioralAnalysis: BehavioralAttemptAnalysisProjection | null;
      behavioralAnalysisMarkdown: string;
      behavioralAnalysisHtml: string;
      resumeContext: ActivityResumeContext | null;
      resumeContextMarkdown: string;
      resumeContextHtml: string;
    }> = {};
    try {
      const behavioralActivityIds = [...new Set(
        allTodayActivities
          .filter((activity) => activity.type === "behavioral")
          .map((activity) => activity.id),
      )];
      const records = await Promise.all(behavioralActivityIds.map(async (activityId) => {
        const response = await fetch(`/api/practice-record?activityId=${encodeURIComponent(activityId)}`);
        if (!response.ok) throw new Error("Behavioral final-answer export read failed.");
        const record = await response.json() as {
          finalAnswer: BehavioralFinalAnswerProjection | null;
          finalAnswerMarkdown: string;
          finalAnswerHtml: string;
          practiceScenarios: BehavioralPracticeScenarioProjection | null;
          practiceScenariosMarkdown: string;
          practiceScenariosHtml: string;
          behavioralAnalysis: BehavioralAttemptAnalysisProjection | null;
          behavioralAnalysisMarkdown: string;
          behavioralAnalysisHtml: string;
          resumeContext: ActivityResumeContext | null;
          resumeContextMarkdown: string;
          resumeContextHtml: string;
        };
        return [activityId, record] as const;
      }));
      behavioralFinalAnswers = Object.fromEntries(records.flatMap(([activityId, record]) => (
        record.finalAnswer ? [[activityId, {
          finalAnswer: record.finalAnswer,
          finalAnswerMarkdown: record.finalAnswerMarkdown,
          finalAnswerHtml: record.finalAnswerHtml,
          practiceScenarios: record.practiceScenarios,
          practiceScenariosMarkdown: record.practiceScenariosMarkdown,
          practiceScenariosHtml: record.practiceScenariosHtml,
          behavioralAnalysis: record.behavioralAnalysis,
          behavioralAnalysisMarkdown: record.behavioralAnalysisMarkdown,
          behavioralAnalysisHtml: record.behavioralAnalysisHtml,
          resumeContext: record.resumeContext,
          resumeContextMarkdown: record.resumeContextMarkdown,
          resumeContextHtml: record.resumeContextHtml,
        }]] : []
      )));
    } catch {
      showUiToast("Export stopped because an authoritative final answer could not be read.");
      return;
    }
    const payload = {
      schemaVersion: 7,
      date: journal.date,
      practiceTimeZone: PRACTICE_TIME_ZONE,
      exportedAt: new Date(timestamp).toISOString(),
      localDraft: true,
      sessionTimers,
      timers,
      outcomes: draft.outcomes,
      publicationStatuses: effectivePublicationStatuses,
      notes: draft.notes,
      structuredNotes: draft.structuredNotes,
      reviews: draft.reviews,
      finalizations: draft.finalizations,
      behavioralFinalAnswers,
      audioClips: draft.audioClips,
      problemPreferences: draft.problemPreferences,
      solutionProfiles: draft.solutionProfiles,
      solutionRevisions: draft.solutionRevisions,
      activitySolutionLinks: draft.activitySolutionLinks,
      personalQuestions: draft.personalQuestions,
      publishQueueActivityIds,
      publishQueueByDate,
      sessions: draft.sessions,
      extraActivities: draft.extraActivities,
      focusedActivityId: draft.focusedActivityId,
      focusedSessionId: draft.focusedSessionId,
      focusedAt: draft.focusedAt ? new Date(draft.focusedAt).toISOString() : null,
    };
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal-${journal.date}-draft.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // Document Picture-in-Picture: an always-on-top "Now" window that stays visible
  // over LeetCode or the desktop editor. It renders a React portal into the pop-out
  // document, so it shares the exact same live state and controls as the dashboard.
  async function openNowWindow() {
    const dpip = (window as Window & { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
    if (!dpip) return;
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
      pipWindowRef.current = null;
      setPipWindow(null);
      return;
    }
    try {
      const win = await dpip.requestWindow({ width: 360, height: 320 });
      for (const node of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
        win.document.head.appendChild(node.cloneNode(true));
      }
      win.document.body.classList.add("pip-body");
      win.addEventListener("pagehide", () => {
        pipWindowRef.current = null;
        setPipWindow(null);
      }, { once: true });
      pipWindowRef.current = win;
      setPipWindow(win);
    } catch {
      // The request needs a user gesture and can be cancelled; ignore failures.
    }
  }

  useEffect(() => {
    if (!pipWindow || pipWindow.closed) return;
    // A visible document-PiP window gets its own display clock. Server
    // reconciliation is shared by the owner-scoped push connection.
    const interval = pipWindow.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => pipWindow.clearInterval(interval);
  }, [pipWindow, setNow]);

  const logEntries = useMemo(() => {
    const entries: LogEntry[] = [];
    const artifactByActivity = new Map(content.artifacts.filter((artifact) => artifact.activityId).map((artifact) => [artifact.activityId, artifact]));
    const knownSessionByActivity = new Map<string, string>();
    content.journals.flatMap((daily) => daily.sessions).forEach((session) => session.activityIds.forEach((id) => knownSessionByActivity.set(id, session.id)));
    [...draft.historySessions, ...draft.sessions, ...(yesterdayDraft?.historySessions ?? [])].forEach((session) => session.activityIds.forEach((id) => knownSessionByActivity.set(id, session.id)));
    for (const daily of content.journals) {
      for (const activity of daily.activities) {
        const liveDraft = daily.date === journal.date ? draft : daily.date === yesterdayDate ? yesterdayDraft : null;
        const localTimer = liveDraft?.timers[activity.id];
        const localOutcome = liveDraft?.outcomes[activity.id];
        const artifact = artifactByActivity.get(activity.id);
        const running = Boolean(localTimer?.runningSince);
        const complete = activity.status === "completed" || Boolean(localTimer?.completed) || Boolean(artifact);
        const startedAt = localTimer?.startedAt ? new Date(localTimer.startedAt).toISOString() : activity.startedAt;
        const endedAt = localTimer?.completedAt ? new Date(localTimer.completedAt).toISOString() : activity.endedAt;
        entries.push({
          id: activity.id,
          questionId: activity.questionId,
          date: endedAt ? practiceDateAt(endedAt) : activity.date,
          type: activity.type,
          title: activity.title,
          subtitle: activity.notes ?? activity.prompt ?? (activity.type === "leetcode" ? "Coding problem" : "Interview practice"),
          status: artifact ? "published" : complete ? "completed" : running ? "running" : "planned",
          outcome: localOutcome ?? activity.outcome,
          elapsedSeconds: localTimer ? elapsed(localTimer, now) : activity.elapsedSeconds ?? 0,
          allocatedSeconds: activity.allocatedSeconds,
          reviewDates: activity.reviewDates,
          reviewOfActivityId: activity.reviewOfActivityId,
          reviewReason: activity.reviewReason,
          url: activity.url,
          artifact,
          startedAt,
          endedAt,
          sessionId: activity.sessionId ?? knownSessionByActivity.get(activity.id),
          personalNote: liveDraft?.notes[activity.id] ?? "",
          pinnedNotes: liveDraft?.structuredNotes[activity.id] ?? [],
          review: liveDraft?.reviews[activity.id],
          finalization: liveDraft?.finalizations[activity.id],
          interactionModeClassification: liveDraft?.finalizations[activity.id]?.interactionModeClassification ?? null,
          audioClips: draft.audioClips[activity.id] ?? [],
          deliveryAnalyses: liveDraft?.deliveryAnalyses[activity.id] ?? [],
        });
      }
    }
    const durableActivities = [
      ...draft.historyActivities,
      ...draft.extraActivities.filter((activity) => !draft.historyActivities.some((candidate) => candidate.id === activity.id)),
    ];
    for (const activity of durableActivities) {
      if (entries.some((entry) => entry.id === activity.id)) continue;
      const timer = draft.timers[activity.id];
      const outcome = draft.outcomes[activity.id];
      const startedAt = timer?.startedAt ? new Date(timer.startedAt).toISOString() : activity.startedAt;
      const endedAt = timer?.completedAt ? new Date(timer.completedAt).toISOString() : activity.endedAt;
      entries.push({
        id: activity.id,
        questionId: activity.questionId,
        date: endedAt ? practiceDateAt(endedAt) : activity.date,
        type: activity.type,
        title: activity.title,
        subtitle: activity.notes ?? activity.prompt ?? "Locally added activity",
        status: timer?.completed ? "completed" : timer?.runningSince ? "running" : "planned",
        outcome,
        elapsedSeconds: elapsed(timer, now),
        allocatedSeconds: activity.allocatedSeconds,
        reviewDates: activity.reviewDates,
        reviewOfActivityId: activity.reviewOfActivityId,
        reviewReason: activity.reviewReason,
        url: activity.url,
        startedAt,
        endedAt,
        sessionId: activity.sessionId ?? knownSessionByActivity.get(activity.id),
        personalNote: draft.notes[activity.id] ?? "",
        pinnedNotes: draft.structuredNotes[activity.id] ?? [],
        review: draft.reviews[activity.id],
        finalization: draft.finalizations[activity.id],
        interactionModeClassification: draft.finalizations[activity.id]?.interactionModeClassification ?? null,
        audioClips: draft.audioClips[activity.id] ?? [],
        deliveryAnalyses: draft.deliveryAnalyses[activity.id] ?? [],
      });
    }
    for (const activity of yesterdayDraft?.historyActivities ?? []) {
      if (entries.some((entry) => entry.id === activity.id)) continue;
      const timer = yesterdayDraft?.timers[activity.id];
      const outcome = yesterdayDraft?.outcomes[activity.id];
      const startedAt = timer?.startedAt ? new Date(timer.startedAt).toISOString() : activity.startedAt;
      const endedAt = timer?.completedAt ? new Date(timer.completedAt).toISOString() : activity.endedAt;
      entries.push({
        id: activity.id,
        questionId: activity.questionId,
        date: endedAt ? practiceDateAt(endedAt) : activity.date,
        type: activity.type,
        title: activity.title,
        subtitle: activity.notes ?? activity.prompt ?? "Website-created activity",
        status: timer?.completed ? "completed" : timer?.runningSince ? "running" : "planned",
        outcome,
        elapsedSeconds: elapsed(timer, now),
        allocatedSeconds: activity.allocatedSeconds,
        reviewDates: activity.reviewDates,
        reviewOfActivityId: activity.reviewOfActivityId,
        reviewReason: activity.reviewReason,
        url: activity.url,
        startedAt,
        endedAt,
        sessionId: activity.sessionId ?? knownSessionByActivity.get(activity.id),
        personalNote: yesterdayDraft?.notes[activity.id] ?? "",
        pinnedNotes: yesterdayDraft?.structuredNotes[activity.id] ?? [],
        review: yesterdayDraft?.reviews[activity.id],
        finalization: yesterdayDraft?.finalizations[activity.id],
        interactionModeClassification: yesterdayDraft?.finalizations[activity.id]?.interactionModeClassification ?? null,
        audioClips: draft.audioClips[activity.id] ?? yesterdayDraft?.audioClips[activity.id] ?? [],
        deliveryAnalyses: draft.deliveryAnalyses[activity.id] ?? yesterdayDraft?.deliveryAnalyses[activity.id] ?? [],
      });
    }
    for (const artifact of content.artifacts.filter(isPastAttemptArtifact)) {
      if (artifact.activityId && entries.some((entry) => entry.id === artifact.activityId)) continue;
      const inferredType: ActivityType = artifact.type === "leetcode" || artifact.type === "behavioral" ? artifact.type : "system_design";
      const preview = artifact.sections.find((section) => /summary|short answer|question/i.test(section.title))?.body ?? "Published interview record";
      const noteSection = artifact.sections.find((section) => /pinned notes?|notes to remember/i.test(section.title));
      entries.push({ id: artifact.path, date: artifact.date, type: inferredType, title: artifact.title, subtitle: plainText(preview).slice(0, 160), status: "published", elapsedSeconds: 0, allocatedSeconds: 0, artifact, personalNote: noteSection?.body ?? "", audioClips: draft.audioClips[artifact.activityId] ?? [], deliveryAnalyses: draft.deliveryAnalyses[artifact.activityId] ?? [] });
    }
    return entries.sort((left, right) => right.date.localeCompare(left.date)
      || (right.endedAt ?? "").localeCompare(left.endedAt ?? "")
      || left.title.localeCompare(right.title));
  }, [content.artifacts, content.journals, draft, journal.date, now, yesterdayDate, yesterdayDraft]);

  const libraryEntries = useMemo(
    () => logEntries.filter((entry) => entry.status === "completed" || entry.status === "published"),
    [logEntries],
  );

  const reviewQueueAttempts = useMemo<ReviewQueueAttempt[]>(() => libraryEntries.map((entry) => ({
    id: entry.id,
    questionId: entry.questionId,
    date: entry.date,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    outcome: entry.outcome,
    allocatedSeconds: entry.allocatedSeconds,
    url: entry.url,
    reviewOfActivityId: entry.reviewOfActivityId,
  })), [libraryEntries]);
  const reviewQueueItems = useMemo(() => buildReviewQueue(
    reviewQueueAttempts,
    Object.values(draft.reviews),
    journal.date,
  ), [draft.reviews, journal.date, reviewQueueAttempts]);
  const reviewQueueStreak = useMemo(
    () => reviewStreakDays(reviewQueueAttempts, journal.date),
    [journal.date, reviewQueueAttempts],
  );
  const reviewBlockedQuestionIds = useMemo(() => new Set(draft.extraActivities.flatMap((activity) => (
    activity.questionId ? [activity.questionId] : []
  ))), [draft.extraActivities]);
  const reviewBlockedTitles = useMemo(() => new Set(draft.extraActivities.map((activity) => (
    normalizedIdentity(activity.title)
  ))), [draft.extraActivities]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPendingReviewKeys((current) => current.filter((reviewKey) => {
        const item = reviewQueueItems.find((candidate) => candidate.reviewKey === reviewKey);
        if (!item) return false;
        return !(Boolean(item.questionId && reviewBlockedQuestionIds.has(item.questionId))
          || reviewBlockedTitles.has(normalizedIdentity(item.title)));
      })));
    return () => window.cancelAnimationFrame(frame);
  }, [reviewBlockedQuestionIds, reviewBlockedTitles, reviewQueueItems]);

  function addReviewsToToday(items: ReviewQueueItem[]) {
    const workbenchId = draft.workbench?.id;
    if (!workbenchId || items.length === 0) {
      showUiToast("Today is still loading. Try again when the workbench is ready.");
      return;
    }
    const reviewKeys = [...new Set(items.map((item) => item.reviewKey))];
    setPendingReviewKeys((current) => [
      ...new Set([
        ...(mutationError?.type === "review-add-today" ? [] : current),
        ...reviewKeys,
      ]),
    ]);
    enqueue({
      type: "review-add-today",
      mutationId: `review-queue-${crypto.randomUUID()}`,
      expectedWorkbenchId: workbenchId,
      expectedWorkbenchRevision: draft.workbench.revision,
      reviewKeys,
    });
    showUiToast(`${reviewKeys.length} review${reviewKeys.length === 1 ? "" : "s"} queued for Today.`);
  }

  function deferReview(item: ReviewQueueItem) {
    const targetDueDate = shiftDate(journal.date, 7);
    setDraft((current) => {
      const review = current.reviews[item.activityId];
      if (!review || review.reviewKey !== item.reviewKey) return current;
      return {
        ...current,
        reviews: {
          ...current.reviews,
          [item.activityId]: { ...review, status: "scheduled", dueDate: targetDueDate },
        },
      };
    });
    enqueue({ type: "review-defer", reviewKey: item.reviewKey, expectedDueDate: item.dueDate });
    showUiToast(`${item.title} is queued to move to next week.`);
  }

  function openReviewAttempt(item: ReviewQueueItem) {
    const entry = libraryEntries.find((candidate) => candidate.id === item.activityId);
    if (!entry) {
      showUiToast("That completed attempt is no longer available. Refresh the queue.");
      return;
    }
    if (document.activeElement instanceof HTMLElement) reviewReaderOpenerRef.current = document.activeElement;
    openReviewEntry(entry, reviewQueueItems.flatMap((candidate) => (
      libraryEntries.find((entryCandidate) => entryCandidate.id === candidate.activityId) ?? []
    )));
  }

  function dismissReviewQueueError() {
    if (mutationError?.type === "review-add-today") setPendingReviewKeys([]);
    clearMutationError();
  }

  useEffect(() => {
    if (!viewMemoryReady || !workspaceUrlHydratedRef.current) return;
    if (readJourneyReaderState(window.location.href) || readReviewReaderState(window.location.href) || readPastReaderState(window.location.href) || readBankReaderState(window.location.href)) return;
    if (view === "library" && selectedEntry) {
      window.history.replaceState(
        { interviewArcPastReader: true, interviewArcPastDepth: 0 },
        "",
        pastReaderHref(window.location.href, selectedEntry.id),
      );
      if (!pastReaderOrderIds.length) {
        const frame = window.requestAnimationFrame(() => {
          setPastReaderOrderIds(libraryEntries.map((entry) => entry.id));
        });
        return () => window.cancelAnimationFrame(frame);
      }
      return;
    }
    if (view === "banks" && selectedProblem) {
      window.history.replaceState(
        { interviewArcBankReader: true, interviewArcBankDepth: 0 },
        "",
        bankReaderHref(window.location.href, selectedProblem.type, selectedProblem.question.id),
      );
      return;
    }
    const routeView = routeViewFor(view);
    if (readWorkspaceRouteView(window.location.href) !== routeView) {
      window.history.replaceState(
        { interviewArcWorkspaceView: routeView },
        "",
        workspaceViewHref(window.location.href, routeView),
      );
    }
  }, [libraryEntries, pastReaderOrderIds.length, selectedEntry, selectedProblem, view, viewMemoryReady]);

  useEffect(() => {
    if (selectedEntry) {
      window.sessionStorage.setItem("interview-arc-selected-past", selectedEntry.id);
      return;
    }
    const storedId = window.sessionStorage.getItem("interview-arc-selected-past");
    const stored = storedId ? libraryEntries.find((entry) => entry.id === storedId) : undefined;
    if (!stored) return;
    const frame = window.requestAnimationFrame(() => setSelectedEntry(stored));
    return () => window.cancelAnimationFrame(frame);
  }, [libraryEntries, selectedEntry]);

  useEffect(() => {
    if (selectedProblem) {
      window.sessionStorage.setItem(
        "interview-arc-selected-bank",
        JSON.stringify({ type: selectedProblem.type, questionId: selectedProblem.question.id }),
      );
      return;
    }
    try {
      const stored = JSON.parse(window.sessionStorage.getItem("interview-arc-selected-bank") ?? "null") as
        | { type: ActivityType; questionId: string }
        | null;
      if (!stored || !["leetcode", "system_design", "behavioral"].includes(stored.type)) return;
      const question = bankFor(stored.type).find((candidate) => candidate.id === stored.questionId);
      if (!question) return;
      const frame = window.requestAnimationFrame(() => setSelectedProblem({ type: stored.type, question }));
      return () => window.cancelAnimationFrame(frame);
    } catch {
      window.sessionStorage.removeItem("interview-arc-selected-bank");
    }
  }, [bankFor, selectedProblem]);

  function transitionToView(nextView: View) {
    if (nextView === view) return;
    setView(nextView);
  }

  function routeViewFor(nextView: View): WorkspaceRouteView {
    if (nextView === "library") return "past";
    if (nextView === "materials") return "career-materials";
    return nextView;
  }

  function navigateToPrimaryView(nextView: View) {
    if (nextView === view) return;
    if (readerCloseTimerRef.current !== null) {
      window.clearTimeout(readerCloseTimerRef.current);
      readerCloseTimerRef.current = null;
    }
    if (view === "library" || view === "banks") {
      captureListPosition(view, listModeFor(view));
    }
    setReaderNotFound("");
    if (view === "journey") {
      setJourneyNestedEntry(null);
      setJourneyNestedProblem(null);
      setJourneyReaderOrderIds([]);
    }
    if (view === "reviews") {
      setReviewNestedEntry(null);
      setReviewNestedProblem(null);
      setReviewReaderOrderIds([]);
    }
    if (view === "banks") {
      setSelectedProblem(null);
      setBankNestedEntry(null);
    }
    if (nextView === "library" || nextView === "banks") {
      const nextMode: ListMode = nextView === "library"
        ? selectedEntry ? "pane" : "main"
        : selectedProblem ? "pane" : "main";
      const position = listPositionMemoryRef.current[nextView][nextMode];
      pendingListRestoreRef.current = { surface: nextView, ...position };
      setListRestoring(nextView);
    }
    setReaderClosing(false);
    window.history.pushState(
      { interviewArcWorkspaceView: routeViewFor(nextView) },
      "",
      workspaceViewHref(window.location.href, routeViewFor(nextView)),
    );
    transitionToView(nextView);
  }

  function navigateToLearn(nextDestination: LearnDestination) {
    if (view === "learn" && learnDestination === nextDestination) return;
    const route = new URL(workspaceViewHref(window.location.href, "learn"), window.location.origin);
    route.searchParams.set("learn", nextDestination);
    window.history.pushState(
      { interviewArcWorkspaceView: "learn", interviewArcLearnDestination: nextDestination },
      "",
      `${route.pathname}${route.search}${route.hash}`,
    );
    setLearnDestination(nextDestination);
    transitionToView("learn");
  }

  function startFreshPracticeDay() {
    const missingResults = allTodayActivities.filter((activity) => (
      Boolean(draft.timers[activity.id]?.startedAt) && !draft.outcomes[activity.id]
    )).map((activity) => activity.id);
    if (missingResults.length) {
      setRequiredResultIds(missingResults);
      setFreshDayConfirmOpen(false);
      setLifecycleDialog({ kind: "workbench-results", missingCount: missingResults.length });
      return;
    }
    const timestamp = Date.now();
    const openedPacificDate = practiceDateAt(timestamp);
    const workbenchId = `workbench-${openedPacificDate}-${crypto.randomUUID()}`;
    enqueue({ type: "workbench-start-fresh", workbenchId });
    setDraft((current) => ({
      ...current,
      workbench: {
        id: workbenchId,
        status: "open",
        openedPacificDate,
        openedAt: timestamp,
        closedAt: null,
        revision: timestamp,
      },
      extraActivities: [],
      focusBlocks: [],
      sessions: [],
      historyActivities: [
        ...current.historyActivities.filter((activity) => !current.extraActivities.some((candidate) => candidate.id === activity.id)),
        ...current.extraActivities,
      ],
      historySessions: [
        ...current.historySessions.filter((session) => !current.sessions.some((candidate) => candidate.id === session.id)),
        ...current.sessions,
      ],
      historyFocusBlocks: [
        ...current.historyFocusBlocks.filter((block) => !current.focusBlocks.some((candidate) => candidate.id === block.id)),
        ...current.focusBlocks,
      ],
      focusedActivityId: null,
      focusedSessionId: null,
      focusedAt: timestamp,
    }));
    setFreshDayConfirmOpen(false);
  }

  const groupedLog = useMemo(() => {
    const groups = new Map<string, LogEntry[]>();
    const searchNeedle = librarySearch.toLowerCase().trim();
    for (const entry of libraryEntries) {
      if (libraryTypeFilters.length > 0 && !libraryTypeFilters.includes(entry.type)) continue;
      if (libraryStarFilter && (!entry.questionId || !draft.problemPreferences.some((preference) =>
        preference.specialty === entry.type && preference.questionId === entry.questionId && preference.starred
      ))) continue;
      if (searchNeedle && ![
        entry.title,
        entry.subtitle,
        entry.personalNote,
        ...(entry.pinnedNotes?.map((note) => note.body) ?? []),
      ].some((value) => value?.toLowerCase().includes(searchNeedle))) continue;
      const hasNotes = Boolean(entry.personalNote?.trim() || entry.pinnedNotes?.length);
      const needsReview = Boolean(entry.review && entry.review.status !== "dismissed" && entry.review.status !== "completed");
      const reviewFilters = libraryAttentionFilters.filter((filter) => filter === "due" || filter === "needs_review");
      const outcomeFilters = libraryAttentionFilters.filter((filter) => filter === "solved" || filter === "helped" || filter === "failed");
      if (reviewFilters.length > 0 && !reviewFilters.some((filter) => filter === "due" ? entry.review?.status === "due" : needsReview)) continue;
      if (outcomeFilters.length > 0 && !outcomeFilters.some((filter) => filter === "solved"
        ? entry.outcome === "solved"
        : filter === "helped" ? entry.outcome === "solved_after_reviewing_approach" : entry.outcome === "failed")) continue;
      if (libraryAttentionFilters.includes("notes") && !hasNotes) continue;
      const modeClassification = entry.interactionModeClassification?.classification;
      if (libraryModeFilters.length > 0 && !libraryModeFilters.some((filter) => matchesInteractionModeFilter(modeClassification, filter))) continue;
      groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [draft.problemPreferences, libraryAttentionFilters, libraryEntries, libraryModeFilters, librarySearch, libraryStarFilter, libraryTypeFilters]);

  const filteredPastEntries = useMemo(
    () => groupedLog.flatMap(([, entries]) => entries),
    [groupedLog],
  );

  const completedEntries = useMemo(
    () => logEntries.filter((entry) => entry.status === "completed" || entry.status === "published"),
    [logEntries],
  );
  const codingSolved = completedEntries.filter((entry) => entry.type === "leetcode" && (entry.outcome === "solved" || entry.outcome === "solved_after_reviewing_approach")).length;
  const codingFailed = completedEntries.filter((entry) => entry.type === "leetcode" && entry.outcome === "failed").length;
  const systemCompleted = completedEntries.filter((entry) => entry.type === "system_design").length;
  const behaviorCompleted = completedEntries.filter((entry) => entry.type === "behavioral").length;
  const totalRecordedSeconds = completedEntries.reduce((sum, entry) => sum + entry.elapsedSeconds, 0);
  const outcomeCounts = {
    solved: completedEntries.filter((entry) => entry.type === "leetcode" && entry.outcome === "solved").length,
    reviewed: completedEntries.filter((entry) => entry.type === "leetcode" && entry.outcome === "solved_after_reviewing_approach").length,
    failed: codingFailed,
  };
  const codingAttemptCount = outcomeCounts.solved + outcomeCounts.reviewed + outcomeCounts.failed;

  const journeyStartDate = useMemo(() => {
    if (journeyRange !== "all") return shiftDate(journal.date, -(journeyRange - 1));
    return completedEntries.length
      ? completedEntries.reduce((earliest, entry) => entry.date < earliest ? entry.date : earliest, journal.date)
      : shiftDate(journal.date, -29);
  }, [completedEntries, journal.date, journeyRange]);

  const journeyStats = useMemo(() => {
    const dayCount = Math.max(1, daysBetween(journeyStartDate, journal.date) + 1);
    return Array.from({ length: dayCount }, (_, index) => {
      const date = shiftDate(journeyStartDate, index);
      const complete = completedEntries.filter((entry) => entry.date === date);
      return {
        date,
        coding: complete.filter((entry) => entry.type === "leetcode").length,
        system: complete.filter((entry) => entry.type === "system_design").length,
        behavioral: complete.filter((entry) => entry.type === "behavioral").length,
        seconds: complete.reduce((sum, entry) => sum + entry.elapsedSeconds, 0),
      };
    });
  }, [completedEntries, journal.date, journeyStartDate]);

  const heatmapDays = useMemo(() => {
    let start = shiftDate(journal.date, -364);
    const weekday = new Date(`${start}T12:00:00Z`).getUTCDay();
    start = shiftDate(start, -((weekday + 6) % 7));
    const dayCount = daysBetween(start, journal.date) + 1;
    return Array.from({ length: dayCount }, (_, index) => {
      const date = shiftDate(start, index);
      const entries = completedEntries.filter((entry) => entry.date === date);
      const finished = entries.filter((entry) => entry.type !== "leetcode" || entry.outcome === "solved" || entry.outcome === "solved_after_reviewing_approach");
      return {
        date,
        count: finished.length,
        coding: finished.filter((entry) => entry.type === "leetcode").length,
        system: finished.filter((entry) => entry.type === "system_design").length,
        behavioral: finished.filter((entry) => entry.type === "behavioral").length,
        failed: entries.filter((entry) => entry.outcome === "failed").length,
        seconds: entries.reduce((sum, entry) => sum + entry.elapsedSeconds, 0),
      };
    });
  }, [completedEntries, journal.date]);
  const displayedHeatmapDays = useMemo(() => heatmapDays.map((day) => {
    if (journeyHeatmapView === "job_applications") {
      const seconds = careerWork?.focus.byDate[day.date] ?? 0;
      return { ...day, count: careerHeatLevel(seconds), seconds, failed: 0 };
    }
    if (journeyHeatmapView === "all") return day;
    const count = journeyHeatmapView === "leetcode"
      ? day.coding
      : journeyHeatmapView === "system_design"
        ? day.system
        : day.behavioral;
    return { ...day, count };
  }), [careerWork?.focus.byDate, heatmapDays, journeyHeatmapView]);

  const activeDates = useMemo(
    () => [...new Set(completedEntries.map((entry) => entry.date))].sort(),
    [completedEntries],
  );
  const streaks = useMemo(() => {
    const active = new Set(activeDates);
    let current = 0;
    let cursor = active.has(journal.date) ? journal.date : shiftDate(journal.date, -1);
    while (active.has(cursor)) {
      current += 1;
      cursor = shiftDate(cursor, -1);
    }
    let longest = 0;
    let run = 0;
    let previous = "";
    activeDates.forEach((date) => {
      run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = date;
    });
    return { current, longest };
  }, [activeDates, journal.date]);

  const codingQuestionFor = useCallback((entry: LogEntry) => {
    return content.questionBanks.leetcode.find((question) => (
      Boolean(entry.questionId && question.id === entry.questionId) ||
      Boolean(question.url && entry.url && question.url.replace(/\/$/, "") === entry.url.replace(/\/$/, "")) ||
      normalizedIdentity(question.title) === normalizedIdentity(entry.title)
    ));
  }, [content.questionBanks.leetcode]);

  const journeyRangeEntries = useMemo(
    () => uniqueJourneyEntries(completedEntries, journeyStartDate, journal.date),
    [completedEntries, journal.date, journeyStartDate],
  );
  const averageEffort = useMemo(
    () => averageEffortBreakdown(journeyRangeEntries, content.questionBanks.leetcode, journeyStartDate, journal.date),
    [content.questionBanks.leetcode, journeyRangeEntries, journal.date, journeyStartDate],
  );

  const topicStats = useMemo(() => {
    const topics = new Map<string, { count: number; entries: LogEntry[] }>();
    libraryEntries.filter((entry) => entry.type === "leetcode").forEach((entry) => {
      codingQuestionFor(entry)?.topics.forEach((topic) => {
        const current = topics.get(topic) ?? { count: 0, entries: [] };
        topics.set(topic, { count: current.count + 1, entries: [...current.entries, entry] });
      });
    });
    return [...topics.entries()]
      .map(([topic, value]) => ({ topic, ...value }))
      .sort((left, right) => right.count - left.count || left.topic.localeCompare(right.topic))
      .slice(0, 12);
  }, [codingQuestionFor, libraryEntries]);

  const difficultyStats = useMemo(() => {
    const values = { easy: 0, medium: 0, hard: 0, unknown: 0 };
    libraryEntries.filter((entry) => entry.type === "leetcode").forEach((entry) => {
      const difficulty = codingQuestionFor(entry)?.difficulty ?? "unknown";
      values[difficulty] += 1;
    });
    return values;
  }, [codingQuestionFor, libraryEntries]);

  const selectedJourneyEntries = journeyDate
    ? completedEntries.filter((entry) => entry.date === journeyDate && (
      journeyHeatmapView === "all"
      || (journeyHeatmapView !== "job_applications" && entry.type === journeyHeatmapView)
    ))
    : [];
  const selectedFocusBlocks = journeyDate
    ? draft.historyFocusBlocks.filter((block) => block.date === journeyDate)
    : [];
  const selectedTopicEntries = topicStats.find((topic) => topic.topic === journeyTopic)?.entries ?? [];

  useEffect(() => {
    const onWorkspacePopState = () => restoreWorkspaceLocationRef.current();
    window.addEventListener("popstate", onWorkspacePopState);
    return () => window.removeEventListener("popstate", onWorkspacePopState);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const restoreWorkspaceLocation = () => {
      const journeyState = readJourneyReaderState(window.location.href);
      if (journeyState) {
        const range = journeyState.range === "all" ? "all" : Number(journeyState.range) as JourneyRange;
        const start = range === "all"
          ? libraryEntries.reduce((earliest, entry) => entry.date < earliest ? entry.date : earliest, journal.date)
          : shiftDate(journal.date, -(range - 1));
        const inRange = uniqueJourneyEntries(libraryEntries, start, journal.date);
        const ordered = journeyState.day
          ? inRange.filter((entry) => entry.date === journeyState.day && (journeyState.heatmap === "all" || journeyState.heatmap === "job_applications" || entry.type === journeyState.heatmap))
          : journeyState.topic
            ? inRange.filter((entry) => entry.type === "leetcode" && codingQuestionFor(entry)?.topics.includes(journeyState.topic))
            : inRange;
        const candidates = journeyState.day || journeyState.topic ? ordered : inRange;
        const entry = candidates.find((candidate) => candidate.id === journeyState.attemptId);
        const nestedProblem = journeyState.specialty && journeyState.problemId
          ? bankFor(journeyState.specialty).find((candidate) => candidate.id === journeyState.problemId)
          : undefined;
        setJourneyRange(range);
        setJourneyMetric(journeyState.metric);
        setJourneyHeatmapView(journeyState.heatmap);
        setJourneyDate(journeyState.day);
        setJourneyTopic(journeyState.topic);
        setJourneyReaderOrderIds(candidates.map((candidate) => candidate.id));
        setPastReaderOrderIds([]);
        if (!entry || (journeyState.problemId && (!nestedProblem || entry.type !== journeyState.specialty
          || (entry.questionId !== journeyState.problemId && normalizedIdentity(entry.title) !== normalizedIdentity(nestedProblem.title))))) {
          setJourneyNestedEntry(null);
          setJourneyNestedProblem(null);
          setReaderNotFound(journeyState.attemptId);
          setView("journey");
          return;
        }
        setReaderNotFound("");
        setReaderClosing(false);
        setJourneyNestedEntry((current) => retainLoadedPastSnapshot(current, entry));
        setJourneyNestedProblem(nestedProblem && journeyState.specialty ? { type: journeyState.specialty, question: nestedProblem } : null);
        setView("journey");
        return;
      }

      const reviewState = readReviewReaderState(window.location.href);
      if (reviewState) {
        const queueEntries = reviewQueueItems.flatMap((item) => (
          libraryEntries.find((entry) => entry.id === item.activityId) ?? []
        ));
        const rememberedOrder = reviewReaderOrderIds.length
          ? reviewReaderOrderIds.flatMap((id) => libraryEntries.find((entry) => entry.id === id) ?? [])
          : queueEntries;
        const candidates = rememberedOrder.some((entry) => entry.id === reviewState.attemptId)
          ? rememberedOrder
          : libraryEntries;
        const entry = candidates.find((candidate) => candidate.id === reviewState.attemptId);
        const nestedProblem = reviewState.specialty && reviewState.problemId
          ? bankFor(reviewState.specialty).find((candidate) => candidate.id === reviewState.problemId)
          : undefined;
        setReviewReaderOrderIds(candidates.map((candidate) => candidate.id));
        setJourneyNestedEntry(null);
        setJourneyNestedProblem(null);
        if (!entry || (reviewState.problemId && (!nestedProblem || entry.type !== reviewState.specialty
          || (entry.questionId !== reviewState.problemId && normalizedIdentity(entry.title) !== normalizedIdentity(nestedProblem.title))))) {
          setReviewNestedEntry(null);
          setReviewNestedProblem(null);
          setReaderNotFound(reviewState.attemptId);
          setView("reviews");
          return;
        }
        setReaderNotFound("");
        setReaderClosing(false);
        setReviewNestedEntry((current) => retainLoadedPastSnapshot(current, entry));
        setReviewNestedProblem(nestedProblem && reviewState.specialty ? { type: reviewState.specialty, question: nestedProblem } : null);
        setView("reviews");
        return;
      }

      const pastState = readPastReaderState(window.location.href);
      if (pastState) {
        const rememberedOrder = pastReaderOrderIds.length
          ? pastReaderOrderIds.flatMap((id) => libraryEntries.find((entry) => entry.id === id) ?? [])
          : filteredPastEntries;
        const candidates = rememberedOrder.some((entry) => entry.id === pastState.attemptId)
          ? rememberedOrder
          : libraryEntries;
        const entry = candidates.find((candidate) => (
          candidate.id === pastState.attemptId || candidate.artifact?.activityId === pastState.attemptId
        ));
        const nestedProblem = pastState.specialty && pastState.problemId
          ? bankFor(pastState.specialty).find((candidate) => candidate.id === pastState.problemId)
          : undefined;
        setPastReaderOrderIds(candidates.map((candidate) => candidate.id));
        setJourneyReaderOrderIds([]);
        setJourneyNestedEntry(null);
        setJourneyNestedProblem(null);
        if (!entry || (pastState.problemId && (!nestedProblem || entry.type !== pastState.specialty
          || (entry.questionId !== pastState.problemId && normalizedIdentity(entry.title) !== normalizedIdentity(nestedProblem.title))))) {
          window.sessionStorage.removeItem("interview-arc-selected-past");
          setSelectedEntry(null);
          setLibraryNestedProblem(null);
          setReaderNotFound(pastState.attemptId);
          setView("library");
          return;
        }
        setReaderNotFound("");
        setReaderClosing(false);
        pendingSelectedRevealRef.current = "library";
        setSelectedEntry((current) => retainLoadedPastSnapshot(current, entry));
        setLibraryNestedProblem(nestedProblem && pastState.specialty ? { type: pastState.specialty, question: nestedProblem } : null);
        setView("library");
        return;
      }

      const bankState = readBankReaderState(window.location.href);
      if (bankState) {
        const question = bankFor(bankState.specialty).find((candidate) => candidate.id === bankState.problemId);
        const attempt = bankState.attemptId
          ? libraryEntries.find((candidate) => candidate.id === bankState.attemptId)
          : undefined;
        setJourneyNestedEntry(null);
        setJourneyNestedProblem(null);
        setReaderClosing(false);
        setView("banks");
        if (!question || (bankState.attemptId && (!attempt || attempt.type !== bankState.specialty || attempt.questionId !== bankState.problemId))) {
          if (!question) window.sessionStorage.removeItem("interview-arc-selected-bank");
          setSelectedProblem(question ? { type: bankState.specialty, question } : null);
          setBankNestedEntry(null);
          setReaderNotFound(bankState.attemptId || bankState.problemId);
          return;
        }
        setReaderNotFound("");
        setSelectedProblem({ type: bankState.specialty, question });
        setBankNestedEntry((current) => attempt ? retainLoadedPastSnapshot(current, attempt) : null);
        return;
      }

      const routeView = readWorkspaceRouteView(window.location.href);
      if (!routeView) return;
      if (routeView === "journey" || routeView === "past") {
        if (routeView === "past") {
          window.sessionStorage.removeItem("interview-arc-selected-past");
          setSelectedEntry(null);
        }
        setJourneyNestedEntry(null);
        setJourneyNestedProblem(null);
        setJourneyReaderOrderIds([]);
        setPastReaderOrderIds([]);
        setReaderNotFound("");
      }
      if (routeView === "banks") {
        window.sessionStorage.removeItem("interview-arc-selected-bank");
        setSelectedProblem(null);
        setBankNestedEntry(null);
        setReaderNotFound("");
      }
      if (routeView === "reviews") {
        setReviewNestedEntry(null);
        setReviewNestedProblem(null);
        setReviewReaderOrderIds([]);
        setReaderNotFound("");
      }
      if (routeView === "learn") setLearnDestination(readLearnDestination(window.location.href));
      setView(routeView === "past" ? "library" : routeView === "career-materials" ? "materials" : routeView);
      if (routeView === "journey") {
        restorePageScroll(window.history.state?.interviewArcJourneyScrollY);
      } else if (routeView === "loops") {
        restorePageScroll(window.history.state?.interviewArcLoopScrollY);
      }
    };
    restoreWorkspaceLocationRef.current = restoreWorkspaceLocation;
    const readerRouteUnavailable = Boolean(readerNotFound) && Boolean(
      readJourneyReaderState(window.location.href)
      || readReviewReaderState(window.location.href)
      || readPastReaderState(window.location.href)
      || readBankReaderState(window.location.href)
    );
    if (!workspaceUrlHydratedRef.current || readerRouteUnavailable) {
      workspaceUrlHydratedRef.current = true;
      restoreWorkspaceLocation();
    }
  }, [bankFor, codingQuestionFor, filteredPastEntries, hydrated, journal.date, libraryEntries, pastReaderOrderIds, readerNotFound, reviewQueueItems, reviewReaderOrderIds]);
  const yesterdayEntries = logEntries.filter((entry) => entry.date === yesterdayDate);
  const yesterdayCompleted = yesterdayEntries.filter((entry) => entry.status === "completed" || entry.status === "published");
  const yesterdaySeconds = yesterdayCompleted.reduce((sum, entry) => sum + entry.elapsedSeconds, 0);
  const yesterdaySessions = new Set([
    ...(content.journals.find((entry) => entry.date === yesterdayDate)?.sessions.map((session) => session.id) ?? []),
    ...(yesterdayDraft?.sessions.map((session) => session.id) ?? []),
  ]).size;
  const recentSeven = completedEntries.filter((entry) => entry.date >= shiftDate(journal.date, -6) && entry.date <= journal.date).length;
  const priorSeven = completedEntries.filter((entry) => entry.date >= shiftDate(journal.date, -13) && entry.date <= shiftDate(journal.date, -7)).length;
  const momentumDelta = priorSeven ? Math.round(((recentSeven - priorSeven) / priorSeven) * 100) : recentSeven ? 100 : 0;
  const practiceRhythm = useMemo(() => {
    const periods = ["Morning", "Afternoon", "Evening", "Late night"].map((label) => ({ label, count: 0, seconds: 0 }));
    completedEntries.forEach((entry) => {
      const startedAt = entry.startedAt;
      if (!startedAt) return;
      const period = periods.find((candidate) => candidate.label === practicePeriodAt(startedAt));
      if (period) {
        period.count += 1;
        period.seconds += entry.elapsedSeconds;
      }
    });
    return periods;
  }, [completedEntries]);
  const maxRhythmCount = Math.max(1, ...practiceRhythm.map((period) => period.count));
  const sessionRollups = useMemo(() => {
    const catalog = new Map<string, PracticeSession>();
    content.journals.flatMap((daily) => daily.sessions).forEach((session) => catalog.set(session.id, session));
    [...draft.historySessions, ...(yesterdayDraft?.historySessions ?? [])].forEach((session) => catalog.set(session.id, session));
    return [...catalog.values()].map((session) => {
      const records = completedEntries.filter((entry) => entry.sessionId === session.id);
      return {
        session,
        completed: records.length,
        total: session.activityIds.length,
        seconds: records.reduce((sum, entry) => sum + entry.elapsedSeconds, 0),
        dates: [...new Set(records.map((entry) => entry.date))].sort(),
      };
    }).filter((rollup) => rollup.completed > 0).sort((left, right) => (right.dates.at(-1) ?? "").localeCompare(left.dates.at(-1) ?? "")).slice(0, 8);
  }, [completedEntries, content.journals, draft.historySessions, yesterdayDraft?.historySessions]);
  const calendarDays = useMemo(() => {
    const anchor = new Date(`${journal.date}T12:00:00Z`);
    return Array.from({ length: 35 }, (_, index) => {
      const date = new Date(anchor);
      date.setUTCDate(anchor.getUTCDate() - (34 - index));
      const key = date.toISOString().slice(0, 10);
      return { key, day: date.getUTCDate(), hasEntries: libraryEntries.some((entry) => entry.date === key) };
    });
  }, [journal.date, libraryEntries]);

  function sessionActivities(session: PracticeSession) {
    return allTodayActivities.filter((activity) => session.activityIds.includes(activity.id));
  }

  function sessionFocusBlocks(session: PracticeSession) {
    return currentFocusBlocks.filter((block) => session.activityIds.includes(block.id));
  }

  function renderSession(session: PracticeSession, index: number) {
    const activities = sessionActivities(session);
    const focusBlocksInSession = sessionFocusBlocks(session);
    const sessionItemCount = activities.length + focusBlocksInSession.length;
    const coding = activities.filter((activity) => activity.type === "leetcode");
    const mockActivities = activities
      .filter((activity) => activity.type !== "leetcode")
      .sort((left, right) => (left.type === right.type ? 0 : left.type === "system_design" ? -1 : 1));
    const complete = activities.filter(isActivityComplete).length
      + focusBlocksInSession.filter((block) => draft.timers[block.id]?.completed).length;
    const codingSeconds = coding.reduce((sum, activity) => sum + elapsed(draft.timers[activity.id], now), 0);
    const localSession = draft.sessions.find((item) => item.id === session.id);
    const sessionLocked = Boolean(draft.sessionTimers[session.id]?.completed);
    return (
      <article className="session-sheet" key={session.id}>
        <header className="session-sheet-header">
          <div className="session-number"><span>{String(index + 1).padStart(2, "0")}</span><small>{session.source === "daily" ? "Required" : "Added"}</small></div>
          <div className="session-heading-copy"><p>Practice session</p><h2>{session.label}</h2><span>{sessionItemCount} {sessionItemCount === 1 ? "activity" : "activities"} · {formatDuration(session.allocatedSeconds)} window</span></div>
          <SessionCountdown session={session} timer={draft.sessionTimers[session.id]} now={now} onToggle={toggleSessionTimer} onComplete={completeSessionTimer} />
          <div className="session-progress"><strong>{complete}/{sessionItemCount}</strong><span>finished</span></div>
          {localSession && <div className="session-header-actions">{focusBlocksInSession.length === 0 && <button className="edit-session" onClick={() => openEditSession(localSession)} disabled={!isSessionEditable(localSession)} title={isSessionEditable(localSession) ? "Change this session recipe" : "A session recipe locks after timing or completion begins"}>Edit recipe</button>}<button className={`icon-action danger ${!isSessionEditable(localSession) ? "action-locked" : ""}`} onClick={() => removeSession(localSession)} aria-disabled={!isSessionEditable(localSession)} aria-label={`Remove ${localSession.label}`} title={isSessionEditable(localSession) ? "Remove untouched session" : "Started sessions stay in your history"}><Icon name="close" /></button></div>}
        </header>

        {coding.length > 0 && <section className="coding-ledger">
          <div className="ledger-heading">
            <div><span className="type-chip leetcode">Coding</span><h3>{coding.length} coding {coding.length === 1 ? "problem" : "problems"} inside one session clock</h3><p>The session countdown follows your recipe. Each row keeps a compact stopwatch for your record.</p></div>
            <div className="coding-total"><span>Problem stopwatches</span><strong>{formatClock(codingSeconds)}</strong><small>tracked inside this session</small></div>
          </div>
          <div className="problem-ledger">
            {coding.map((activity, problemIndex) => {
              const isExtra = activity.source === "extra";
              return (
                <div className="problem-ledger-row" key={activity.id}>
                  <span className={`row-count ${isActivityComplete(activity) ? "complete" : ""}`}>{isActivityComplete(activity) ? "✓" : problemIndex + 1}</span>
                  <div className="problem-title"><strong>{activity.title}</strong><div className="activity-state-pills"><ActivityStateStamp timer={draft.timers[activity.id]} />{interactionModeBadge(activity.id)}</div><span>{activity.notes ?? "Coding problem"}</span>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open on LeetCode ↗</a>}</div>
                  <ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} locked={sessionLocked} />
                  <ResultFlag activityType={activity.type} outcome={draft.outcomes[activity.id] ?? activity.outcome} onChange={(outcome) => setOutcome(activity.id, outcome)} disabled={!draft.timers[activity.id]?.startedAt || draft.publicationStatuses[activity.id] === "published"} required={requiredResultIds.includes(activity.id)} />
                  <PublicationControl status={publicationStatusFor(activity)} />
                  <button className={`star-control ${isStarred(activity.type, activity.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(activity.type, activity.questionId)} disabled={!activity.questionId} aria-label={`${isStarred(activity.type, activity.questionId) ? "Unstar" : "Star"} ${activity.title}`} title={activity.questionId ? "Keep this problem in your starred review set" : "A stable bank question is required to star this activity"}>★</button>
                  {isExtra && <button className={`icon-action danger row-remove ${draft.timers[activity.id]?.startedAt ? "action-locked" : ""}`} onClick={() => removeActivity(activity.id)} aria-disabled={Boolean(draft.timers[activity.id]?.startedAt)} aria-label={`Remove ${activity.title}`} title={draft.timers[activity.id]?.startedAt ? "Started activities stay in your history" : "Remove untouched activity"}><Icon name="close" /></button>}
                </div>
              );
            })}
          </div>
          <p className="ledger-note">Solve and submit on LeetCode. Interview Arc records the time and result you choose; it does not execute or inspect your submission.</p>
        </section>}

        <div className="mock-grid">
          {mockActivities.map((item) => {
            const isExtra = item.source === "extra";
            return (
              <section className={`mock-sheet ${item.type}`} key={item.id}>
                <div className="mock-topline"><span className={`type-chip ${item.type}`}>{typeLabel(item.type)}</span><div className="mock-state-actions"><ActivityStateStamp timer={draft.timers[item.id]} />{interactionModeBadge(item.id)}{isExtra && <button className={`icon-action danger ${draft.timers[item.id]?.startedAt ? "action-locked" : ""}`} onClick={() => removeActivity(item.id)} aria-disabled={Boolean(draft.timers[item.id]?.startedAt)} aria-label={`Remove ${item.title}`} title={draft.timers[item.id]?.startedAt ? "Started activities stay in your history" : "Remove untouched activity"}><Icon name="close" /></button>}</div></div>
                <h3>{item.title}</h3>
                <p>{item.prompt}</p>
                <div className="mock-controls">
                  <ActivityTimer activity={item} timer={draft.timers[item.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} locked={sessionLocked} />
                  <ResultFlag activityType={item.type} outcome={draft.outcomes[item.id] ?? item.outcome} onChange={(outcome) => setOutcome(item.id, outcome)} disabled={!draft.timers[item.id]?.startedAt || draft.publicationStatuses[item.id] === "published"} required={requiredResultIds.includes(item.id)} />
                  <PublicationControl status={publicationStatusFor(item)} />
                  <button className={`star-control ${isStarred(item.type, item.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(item.type, item.questionId)} disabled={!item.questionId} aria-label={`${isStarred(item.type, item.questionId) ? "Unstar" : "Star"} ${item.title}`}>★</button>
                </div>
                <div className="publish-instruction">Finish the activity, then say <strong>“Publish this session”</strong> in the {item.type === "system_design" ? "system-design" : "behavioral"} task. Finished work is ready automatically.</div>
              </section>
            );
          })}
        </div>
        {focusBlocksInSession.length > 0 && <section className="session-career-focus" aria-label="Career focus in this session">
          <div className="ledger-heading"><div><span className="type-chip focus-block">Career focus</span><h3>Job application work inside this session</h3><p>Time is recorded without a result, review, or publication artifact.</p></div></div>
          <div className="career-focus-list">{focusBlocksInSession.map((block) => <article className={`career-focus-card ${draft.timers[block.id]?.completed ? "completed" : ""}`} key={block.id}><span className="career-focus-mark" aria-hidden="true">J</span><div className="career-focus-copy"><small>Focus block · {Math.round(block.plannedSeconds / 60)} planned min</small><strong>{block.title}</strong>{block.note && <p>{block.note}</p>}</div><ActivityTimer activity={block} timer={draft.timers[block.id]} now={now} onToggle={toggleTimer} onComplete={completeFocusBlock} locked={sessionLocked} /><div className="career-focus-actions"><button className="icon-action" onClick={() => editFocusBlock(block)} disabled={Boolean(draft.timers[block.id]?.completed || sessionLocked)} aria-label={`Edit ${block.title}`}>✎</button><button className="icon-action" onClick={() => removeFocusBlockFromToday(block.id)} disabled={Boolean(draft.timers[block.id]?.startedAt || sessionLocked)} aria-label={`Remove ${block.title}`}>×</button></div></article>)}</div>
        </section>}
      </article>
    );
  }

  function renderToday() {
    const totalToday = allTodayActivities.length;
    const railFocusBlock = currentFocusBlocks.find((block) => draft.timers[block.id]?.runningSince)
      ?? currentFocusBlocks.find((block) => block.id === draft.focusedActivityId)
      ?? null;
    const railFocusTimer = railFocusBlock ? draft.timers[railFocusBlock.id] : undefined;
    const railActivity = activeActivity ?? lastFocusedActivity;
    const focusTimer = railActivity ? draft.timers[railActivity.id] : undefined;
    const focusPublication = railActivity ? publicationStatusFor(railActivity) : "draft";
    const focusPhase = focusTimer?.completed
      ? focusPublication === "published" ? "In journal" : "Ready to publish"
      : focusTimer?.runningSince ? "Running now" : focusTimer?.startedAt ? "Last activity · paused" : "Not started";
    const railSession = railActivity ? sessionByActivityId.get(railActivity.id) ?? focusedSession : focusedSession;
    const railSessionTimer = railSession ? draft.sessionTimers[railSession.id] : undefined;
    return (
      <>
        <InterviewPageHero tone="today" eyebrow={`TODAY · ${journal.focus.toUpperCase()}`} title={<>{totalToday ? `${totalToday} activities.` : "A clean page."}<br /><em>One honest record.</em></>} description={journal.note} metrics={[
          { value: `${yesterdayCompleted.length}/${yesterdayEntries.length}`, label: "finished yesterday" },
          { value: formatDuration(yesterdaySeconds), label: "recorded yesterday" },
          { value: yesterdaySessions, label: `session${yesterdaySessions === 1 ? "" : "s"} planned` },
        ]} />

        <section className={`orchestrator-rail ${railFocusTimer?.runningSince || activeActivity ? "has-focus" : railFocusBlock || railActivity ? "has-history" : "empty"}`} aria-label="Current workbench activity">
          <div className="orchestrator-signal"><span className={railFocusTimer?.runningSince || focusTimer?.runningSince ? "live" : ""} /><small>NOW</small></div>
          {railFocusBlock ? <>
            <div className="orchestrator-focus career"><span className="career-focus-mark">J</span><div><small>{railFocusTimer?.completed ? "Career focus · complete" : railFocusTimer?.runningSince ? "Career focus · running now" : "Career focus · paused"}</small><strong>{railFocusBlock.title}</strong><span>{railFocusBlock.note ?? "Job application focus block"}</span></div></div>
            <div className="orchestrator-clock"><span>Recorded</span><strong>{formatClock(elapsed(railFocusTimer, now))}</strong><small>{PRACTICE_TIME_ZONE}</small></div>
            <div className="orchestrator-lifecycle career" aria-label="Career focus lifecycle"><i className="done">Planned</i><b /><i className={railFocusTimer?.startedAt ? "done" : ""}>In progress</i><b /><i className={railFocusTimer?.completed ? "done" : ""}>Complete</i></div>
            {!railFocusTimer?.runningSince && !railFocusTimer?.completed && <button className="orchestrator-resume" onClick={() => toggleTimer(railFocusBlock.id)}>Resume</button>}
          </> : railActivity ? <>
            <div className="orchestrator-focus"><span className={`type-mark ${railActivity.type}`}>{typeMark(railActivity.type)}</span><div><small>{focusPhase} · {railSession?.label ?? "Standalone practice"}</small><strong>{activeActivity ? railActivity.title : "No activity running"}</strong><span>{activeActivity ? railActivity.title : `${railActivity.title} was the last focused activity.`}</span></div></div>
            <div className="orchestrator-clock"><span>Recorded</span><strong>{formatClock(elapsed(focusTimer, now))}</strong><small>{PRACTICE_TIME_ZONE}</small></div>
            <div className="orchestrator-lifecycle" aria-label={`Lifecycle: ${focusPhase}`}><i className="done">Planned</i><b /><i className={focusTimer?.startedAt ? "done" : ""}>In progress</i><b /><i className={focusTimer?.completed ? "done" : ""}>Ready</i><b /><i className={focusPublication === "published" ? "done" : ""}>Journal</i></div>
            {!activeActivity && !focusTimer?.completed && !railSessionTimer?.completed && <button className="orchestrator-resume" onClick={() => toggleTimer(railActivity.id)}>Resume</button>}
            {activeActivity && railActivity.url && <a href={railActivity.url} target="_blank" rel="noreferrer">Open workspace ↗</a>}
          </> : railSessionTimer?.runningSince
            ? <div className="orchestrator-empty"><strong>No activity running.</strong><span>Your session clock is running. Start one activity stopwatch to link Voice and begin focused work.</span></div>
            : <div className="orchestrator-empty"><strong>No activity running.</strong><span>Start any activity stopwatch when you are ready. Voice stays unlinked until then.</span></div>}
        </section>

        {railActivity && draft.interactionModeRegistry && <section className="interaction-mode-selector" aria-labelledby="interaction-mode-heading">
          <div className="interaction-mode-selector-copy">
            <span className="eyebrow">INTERACTION MODE</span>
            <strong id="interaction-mode-heading">How should the specialist work with you?</strong>
            <small>{interactionModeDefinition(railActivity.id)?.description ?? "Choose explicitly. Legacy activities stay unclassified until you do."}</small>
          </div>
          <div className="interaction-mode-options" role="group" aria-label={`Interaction mode for ${railActivity.title}`}>
            {selectableInteractionModes(
              draft.interactionModeRegistry,
              railActivity.type,
              interactionModePhase(railActivity.id),
            ).map((mode) => {
              const summary = draft.interactionModes[railActivity.id];
              const selected = summary?.current?.interactionModeId === mode.id;
              const pending = summary?.current?.lastMutationId.startsWith("pending:");
              return <button key={mode.id} type="button" aria-pressed={selected} disabled={Boolean(pending || selected)} onClick={() => selectInteractionMode(railActivity, mode.id)} title={mode.helpPolicy}><strong>{mode.label}</strong><span>{mode.description}</span></button>;
            })}
          </div>
          <div className="interaction-mode-status" aria-live="polite">
            {draft.interactionModes[railActivity.id]?.current?.lastMutationId.startsWith("pending:")
              ? <span className="saving">Saving mode…</span>
              : mutationError?.type === "interaction-mode-set"
                ? <><span className="error">{mutationError.message}</span>{lastModeIntent?.activityId === railActivity.id && <button type="button" onClick={() => selectInteractionMode(railActivity, lastModeIntent.interactionModeId)}>Try again</button>}</>
                : <span>{interactionModeDefinition(railActivity.id) ? `Revision ${draft.interactionModes[railActivity.id]?.current?.revision ?? 0} · synced` : "Selection required"}</span>}
          </div>
        </section>}

        <div className="today-actions"><div><h2>Current workbench</h2><p>It stays open across Pacific midnight until you publish it or explicitly start fresh.</p></div><div><button className="secondary-action" onClick={() => allTodayActivities.length || allSessions.length || currentFocusBlocks.length ? setFreshDayConfirmOpen(true) : startFreshPracticeDay()}>Start fresh day</button><button className="secondary-action" onClick={openNewActivity}>Add activities</button><button className="primary-action" onClick={openNewSession}>＋ Add another session</button></div></div>
        <BehavioralTargetBindings activities={allTodayActivities} sessions={allSessions} />
        <section className="session-stack">{allSessions.length ? allSessions.map(renderSession) : <div className="quiet-empty session-empty"><strong>No session planned yet.</strong><span>Add another session to choose up to six coding questions and one question from each available interview bank.</span></div>}</section>

        <section className="loose-section">
          <div className="section-title"><div><span className="eyebrow">STANDALONE PRACTICE</span><h2>Outside a full session</h2><p>Each card keeps only the controls you need: stopwatch, result, journal state, star, and remove.</p></div></div>
          {looseActivities.length === 0 ? <div className="quiet-empty"><strong>No standalone activities yet.</strong><span>Use “Add activities” above to select across the banks or create a custom prompt.</span></div> : <div className="loose-list">{looseActivities.map((activity) => <StandaloneActivityCard key={activity.id} title={activity.title} onRemove={() => removeActivity(activity.id)} removeDisabled={Boolean(draft.timers[activity.id]?.startedAt)}><span className={`type-mark ${activity.type}`}>{typeMark(activity.type)}</span><div className="loose-activity-copy"><div className="loose-activity-meta"><small>{typeLabel(activity.type)}</small><ActivityStateStamp timer={draft.timers[activity.id]} />{interactionModeBadge(activity.id)}</div><strong>{activity.title}</strong>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open reference ↗</a>}</div><ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} /><ResultFlag activityType={activity.type} outcome={draft.outcomes[activity.id] ?? activity.outcome} onChange={(outcome) => setOutcome(activity.id, outcome)} disabled={!draft.timers[activity.id]?.startedAt || draft.publicationStatuses[activity.id] === "published"} required={requiredResultIds.includes(activity.id)} /><PublicationControl status={publicationStatusFor(activity)} /><button className={`star-control ${isStarred(activity.type, activity.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(activity.type, activity.questionId)} disabled={!activity.questionId} aria-label={`${isStarred(activity.type, activity.questionId) ? "Unstar" : "Star"} ${activity.title}`}>★</button></StandaloneActivityCard>)}</div>}
          {looseFocusBlocks.length > 0 && <section className="career-focus-section" aria-labelledby="career-focus-title"><header><div><span className="eyebrow">CAREER WORK</span><h3 id="career-focus-title">Job application focus</h3></div><small>Time only · no result or publication required</small></header><div className="career-focus-list">{looseFocusBlocks.map((block) => <article className={`career-focus-card ${draft.timers[block.id]?.completed ? "completed" : ""}`} key={block.id}><span className="career-focus-mark" aria-hidden="true">J</span><div className="career-focus-copy"><small>Focus block · {Math.round(block.plannedSeconds / 60)} planned min</small><strong>{block.title}</strong>{block.note && <p>{block.note}</p>}</div><ActivityTimer activity={block} timer={draft.timers[block.id]} now={now} onToggle={toggleTimer} onComplete={completeFocusBlock} /><div className="career-focus-actions"><button className="icon-action" onClick={() => editFocusBlock(block)} disabled={Boolean(draft.timers[block.id]?.completed)} aria-label={`Edit ${block.title}`}>✎</button><button className="icon-action" onClick={() => removeFocusBlockFromToday(block.id)} disabled={Boolean(draft.timers[block.id]?.startedAt)} aria-label={`Remove ${block.title}`}>×</button></div></article>)}</div></section>}
        </section>
      </>
    );
  }

  function renderJourney() {
    const metricValues = journeyStats.map((day) => journeyMetric === "activities"
      ? day.coding + day.system + day.behavioral
      : Math.round(day.seconds / 60));
    const metricMax = Math.max(1, ...metricValues);
    const plotPoints = journeyStats.map((day, index) => {
      const x = journeyStats.length === 1 ? 400 : 42 + (index / (journeyStats.length - 1)) * 716;
      const value = metricValues[index];
      const y = 205 - (value / metricMax) * 155;
      return { day, value, x, y };
    });
    const linePoints = plotPoints.map((point) => `${point.x},${point.y}`).join(" ");
    const areaPath = plotPoints.length
      ? `M ${plotPoints[0].x} 205 L ${plotPoints.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${plotPoints.at(-1)!.x} 205 Z`
      : "";
    const activeDayAverage = activeDates.length ? completedEntries.length / activeDates.length : 0;
    const maxTopicCount = Math.max(1, ...topicStats.map((topic) => topic.count));
    const maxDifficulty = Math.max(1, difficultyStats.easy, difficultyStats.medium, difficultyStats.hard, difficultyStats.unknown);
    const effortEntries = journeyRangeEntries.filter((entry) => entry.type === "leetcode" && entry.outcome && entry.elapsedSeconds > 0);
    const maxEffortMinutes = Math.max(1, ...effortEntries.map((entry) => entry.elapsedSeconds / 60));
    return (
      <section className={`view-page journey-page ${journeyNestedEntry || journeyNestedProblem ? "has-open-reader" : ""}`}>
        <InterviewPageHero tone="journey" eyebrow="JOURNEY · PUBLISHED + TODAY'S LIVE RECORD" title={<>Your practice,<br /><em>mapped over time.</em></>} description="This page counts only recorded work. Explore consistency, outcomes, topic coverage, effort, and the exact days behind every trend." metrics={[
          { value: activeDates.length, label: "active days" },
          { value: streaks.longest, label: "longest streak" },
          { value: activeDayAverage.toFixed(1), label: "per active day" },
        ]} />
        {readerNotFound && <div className="journey-reader-not-found" role="alert"><strong>That practice record is unavailable.</strong><span>The saved reader link points to <code>{readerNotFound}</code>, which is not present in the current authoritative record.</span></div>}
        {(journeyNestedEntry || journeyNestedProblem) && <div className={`journey-reader-detail reader-workspace focused-attempt-workspace ${readerClosing ? "reader-closing" : ""}`}><aside className="journey-reader-pane focused-attempt-pane" role="dialog" aria-modal="true" aria-label="Selected Journey reader">{journeyNestedProblem ? renderSolutionReader() : renderCaseReader()}</aside></div>}
        <div className="stat-ledger">
          <article className="stat-block coding-stat"><span>Coding solved</span><strong>{codingSolved}</strong><small>{codingFailed} failed attempt{codingFailed === 1 ? "" : "s"}</small></article>
          <article className="stat-block system-stat"><span>System designs</span><strong>{systemCompleted}</strong><small>completed or published</small></article>
          <article className="stat-block behavior-stat"><span>Behavioral answers</span><strong>{behaviorCompleted}</strong><small>completed or published</small></article>
          <article className="stat-block time-stat"><span>Recorded time</span><strong>{formatDuration(totalRecordedSeconds)}</strong><small>from completed activity timers</small></article>
        </div>

        <LoopJourneyFactsPanel />

        <div className="journey-pulse" aria-label="Practice consistency summary">
          <article><span>Current streak</span><strong>{streaks.current}</strong><small>day{streaks.current === 1 ? "" : "s"}</small></article>
          <article><span>Longest streak</span><strong>{streaks.longest}</strong><small>consecutive days</small></article>
          <article><span>Active days</span><strong>{activeDates.length}</strong><small>with completed work</small></article>
          <article><span>Per active day</span><strong>{activeDayAverage.toFixed(1)}</strong><small>activities on average</small></article>
          <article className={momentumDelta >= 0 ? "positive" : "negative"}><span>7-day momentum</span><strong>{momentumDelta > 0 ? "+" : ""}{momentumDelta}%</strong><small>{recentSeven} now · {priorSeven} prior</small></article>
        </div>

        <section className="chart-sheet average-effort-sheet" aria-labelledby="average-effort-title">
          <div className="chart-heading"><div><span className="eyebrow">AVERAGE EFFORT</span><h2 id="average-effort-title">Time per completed activity</h2><p>{readableDate(journeyStartDate, true)} through {readableDate(journal.date, true)} · positive authoritative timers only</p></div></div>
          <div className="average-effort-grid">{averageEffort.map((bucket) => <article key={bucket.key}><span>{bucket.label}</span><strong>{bucket.averageSeconds === null ? "—" : formatDuration(bucket.averageSeconds)}</strong><small>{bucket.count ? `${bucket.count} activit${bucket.count === 1 ? "y" : "ies"} · ${formatDuration(bucket.totalSeconds)} total` : "No recorded activities"}</small></article>)}</div>
        </section>

        <article className={`chart-sheet heatmap-sheet ${journeyHeatmapView === "job_applications" ? "career-map" : ""}`}>
          <div className="chart-heading"><div><span className="eyebrow">365-DAY JOURNEY MAP</span><h2>{journeyHeatmapView === "job_applications" ? "Career focus at a glance" : "Consistency at a glance"}</h2><p>{journeyHeatmapView === "job_applications" ? "Color measures elapsed job-application focus time, split correctly at Pacific midnight." : "Color measures finished coding and mock-interview work. Failed attempts remain visible without inflating the shade."}</p></div></div>
          <div className="heatmap-command-bar">
          <div className="heatmap-view-selector" role="group" aria-label="Journey map category">{([
            ["all", "All practice"],
            ["leetcode", "Coding"],
            ["system_design", "System design"],
            ["behavioral", "Behavioral"],
            ["job_applications", "Job applications"],
          ] as Array<[JourneyHeatmapView, string]>).map(([value, label]) => <button key={value} className={journeyHeatmapView === value ? "active" : ""} onClick={() => setJourneyHeatmapView(value)}>{label}</button>)}</div>
          <div className="heatmap-legend" aria-label="Activity intensity"><span>Less</span>{Array.from({ length: journeyHeatmapView === "job_applications" ? 6 : 5 }, (_, level) => <i className={`level-${level}`} key={level} />)}<span>More</span></div>
          </div>
          <div className="heatmap-scroll">
            <div className="heatmap-days"><span>M</span><span>W</span><span>F</span></div>
            <div className="practice-heatmap" role="grid" aria-label="Completed practice during the last 365 days">
              {displayedHeatmapDays.map((day) => {
                const level = day.count === 0 ? 0 : Math.min(journeyHeatmapView === "job_applications" ? 5 : 4, day.count);
                const tooltipId = `heatmap-tooltip-${day.date}`;
                const tooltipBody = journeyHeatmapView === "job_applications" ? `${formatDuration(day.seconds)} career focus` : `${day.count} finished · ${day.coding} coding · ${day.system} system · ${day.behavioral} behavioral${day.failed ? ` · ${day.failed} failed` : ""}`;
                return <button
                  key={day.date}
                  className={`heat-day level-${level} ${journeyDate === day.date ? "selected" : ""}`}
                  onPointerEnter={(event) => showChartTooltip(event.currentTarget, { id: tooltipId, title: readableDate(day.date, true), body: tooltipBody, foot: `${formatDuration(day.seconds)} recorded` })}
                  onPointerLeave={() => setChartTooltip(null)}
                  onFocus={(event) => showChartTooltip(event.currentTarget, { id: tooltipId, title: readableDate(day.date, true), body: tooltipBody, foot: `${formatDuration(day.seconds)} recorded` })}
                  onBlur={() => setChartTooltip(null)}
                  onClick={(event) => { setJourneyDate(day.date); showChartTooltip(event.currentTarget, { id: tooltipId, title: readableDate(day.date, true), body: tooltipBody, foot: `${formatDuration(day.seconds)} recorded` }); }}
                  aria-describedby={chartTooltip?.id === tooltipId ? tooltipId : undefined}
                  aria-label={journeyHeatmapView === "job_applications" ? `${readableDate(day.date)}: ${formatDuration(day.seconds)} job application focus` : `${readableDate(day.date)}: ${day.count} finished activities`}
                />;
              })}
            </div>
          </div>
          <div className="heatmap-foot"><span>{readableDate(displayedHeatmapDays[0].date, true)}</span><span>Select a square to inspect the day</span><span>{readableDate(journal.date, true)}</span></div>
          {journeyDate && <div className="journey-day-inspector">
            <div><span className="eyebrow">SELECTED DAY</span><h3>{readableDate(journeyDate)}</h3><p>{journeyHeatmapView === "job_applications" ? `${formatDuration(careerWork?.focus.byDate[journeyDate] ?? 0)} of job-application focus.` : selectedJourneyEntries.length ? `${selectedJourneyEntries.length} completed record${selectedJourneyEntries.length === 1 ? "" : "s"}.` : "No completed work was recorded on this day."}</p></div>
            <div>{journeyHeatmapView === "job_applications" ? selectedFocusBlocks.map((block) => <article className="career-day-record" key={block.id}><span className="career-focus-mark">J</span><i><strong>{block.title}</strong><small>{Math.round(block.plannedSeconds / 60)} planned min{block.note ? ` · ${block.note}` : ""}</small></i></article>) : selectedJourneyEntries.map((entry) => <button key={entry.id} onClick={() => openJourneyEntry(entry, selectedJourneyEntries)}><span className={`type-mark ${entry.type}`}>{typeMark(entry.type)}</span><i><strong>{entry.title}</strong><small>{typeLabel(entry.type)} · {entry.elapsedSeconds ? formatDuration(entry.elapsedSeconds) : "time not recorded"}</small></i><b>Read →</b></button>)}</div>
          </div>}
        </article>

        <section className="career-work-panel" aria-labelledby="career-work-title">
          <header><div><span className="eyebrow">CAREER WORK</span><h2 id="career-work-title">Focus here. Applications from Job Journey.</h2><p>Interview Arc owns only your focus time. Job Journey remains authoritative for companies, roles, URLs, referrals, and pipeline status.</p></div><span className={`career-source-status ${careerWork?.jobJourney.status ?? "unavailable"}`}>{careerLoading ? "Refreshing…" : careerWork?.jobJourney.status === "available" ? careerWork.jobJourney.stale ? "Job Journey · cached" : "Job Journey connected" : "Application data unavailable"}</span></header>
          <div className="career-local-ledger">
            <article><span>Focused time</span><strong>{formatDuration(careerWork?.focus.totalSeconds ?? 0)}</strong><small>last 365 days</small></article>
            <article><span>Completed blocks</span><strong>{careerWork?.focus.completedBlocks ?? 0}</strong><small>career focus sessions</small></article>
            <article><span>Focus days</span><strong>{careerWork?.focus.focusDays ?? 0}</strong><small>{careerWork?.focus.currentStreak ?? 0}-day current streak</small></article>
            <article><span>Average block</span><strong>{formatDuration(careerWork?.focus.averageCompletedSeconds ?? 0)}</strong><small>completed focus time</small></article>
          </div>
          {careerWork?.jobJourney.status === "available" && careerWork.jobJourney.summary && careerWork.jobJourney.jobs ? <>
            <div className="career-pipeline-ledger">
              <article><span>Submitted</span><strong>{careerWork.jobJourney.summary.totals.submitted}</strong></article>
              <article><span>Interviewing</span><strong>{careerWork.jobJourney.summary.totals.interviewing}</strong></article>
              <article><span>Offers</span><strong>{careerWork.jobJourney.summary.totals.offers}</strong></article>
              <article><span>Awaiting referral</span><strong>{careerWork.jobJourney.summary.totals.awaitingReferral}</strong></article>
            </div>
            <div className="career-job-controls">
              <label><span className="sr-only">Search jobs</span><input type="search" value={careerSearch} onChange={(event) => setCareerSearch(event.target.value)} placeholder="Search company, role, location, source, or job ID" /></label>
              <details className="career-status-picker"><summary>{careerStatuses.length ? `${careerStatuses.length} statuses` : "All statuses"}</summary><div>{Object.keys(careerWork.jobJourney.summary.currentStatusCounts).map((status) => <label key={status}><input type="checkbox" checked={careerStatuses.includes(status as JobStatus)} onChange={() => setCareerStatuses((current) => current.includes(status as JobStatus) ? current.filter((value) => value !== status) : [...current, status as JobStatus])} /><span>{status.replaceAll("_", " ")}</span><small>{careerWork.jobJourney.summary?.currentStatusCounts[status as JobStatus] ?? 0}</small></label>)}</div></details>
              <select value={careerSource} onChange={(event) => setCareerSource(event.target.value)} aria-label="Filter jobs by source"><option value="">All sources</option>{Object.keys(careerWork.jobJourney.summary.bySource).sort().map((source) => <option key={source} value={source}>{source}</option>)}</select>
              <select value={careerReferral} onChange={(event) => setCareerReferral(event.target.value as "all" | "only" | "exclude")} aria-label="Filter jobs by referral"><option value="all">All referral states</option><option value="only">Referral only</option><option value="exclude">Exclude referral-only</option></select>
            </div>
            <div className="career-job-list">{careerWork.jobJourney.jobs.jobs.map((job) => <button key={job.id} onClick={() => setCareerSelectedJob(job)}><span><strong>{job.title}</strong><small>{job.company}{job.location ? ` · ${job.location}` : ""}</small></span><i>{job.status.replaceAll("_", " ")}</i></button>)}</div>
            {careerWork.jobJourney.jobs.page.hasMore && careerWork.jobJourney.jobs.page.nextCursor && <button type="button" className="career-load-more" onClick={() => void loadMoreCareerJobs()} disabled={careerLoadingMore}>{careerLoadingMore ? "Loading more…" : "Load more applications"}</button>}
          </> : <div className="career-unavailable"><strong>Your focus record is safe and current.</strong><p>{careerWork?.jobJourney.message ?? "Job Journey’s v1 integration is not connected yet. Application details will appear here after its private API is deployed and configured."}</p></div>}
        </section>

        <section className="metric-rings" aria-label="Coding outcome rates">
          <MetricRing label="Solved" value={codingAttemptCount ? (outcomeCounts.solved / codingAttemptCount) * 100 : 0} detail={`${outcomeCounts.solved} coding attempt${outcomeCounts.solved === 1 ? "" : "s"} solved without help.`} color="#91a72f" />
          <MetricRing label="After review" value={codingAttemptCount ? (outcomeCounts.reviewed / codingAttemptCount) * 100 : 0} detail={`${outcomeCounts.reviewed} attempt${outcomeCounts.reviewed === 1 ? "" : "s"} completed after reviewing the approach.`} color="#6577d8" />
          <MetricRing label="Failed" value={codingAttemptCount ? (outcomeCounts.failed / codingAttemptCount) * 100 : 0} detail={`${outcomeCounts.failed} recorded failure${outcomeCounts.failed === 1 ? "" : "s"}; these remain evidence for future review.`} color="#d46a52" />
        </section>

        <div className="analytics-grid journey-detail-grid">
          <article className="chart-sheet trend-sheet">
            <div className="chart-heading"><div><span className="eyebrow">PACE OVER TIME</span><h2>{journeyMetric === "activities" ? "Completed activities" : "Recorded minutes"}</h2></div><div className="journey-controls"><div role="group" aria-label="Journey date range">{([30, 90, 365, "all"] as const).map((range) => <button key={range} className={journeyRange === range ? "active" : ""} onClick={() => setJourneyRange(range)}>{range === "all" ? "All" : `${range}d`}</button>)}</div><div role="group" aria-label="Journey metric"><button className={journeyMetric === "activities" ? "active" : ""} onClick={() => setJourneyMetric("activities")}>Output</button><button className={journeyMetric === "time" ? "active" : ""} onClick={() => setJourneyMetric("time")}>Time</button></div></div></div>
            <div className="trend-plot">
              <svg viewBox="0 0 800 235" role="img" aria-label={`${journeyMetric} trend from ${journeyStartDate} through ${journal.date}`}>
                <defs><linearGradient id="journey-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9eb532" stopOpacity=".34"/><stop offset="1" stopColor="#9eb532" stopOpacity="0"/></linearGradient></defs>
                {[50, 101.7, 153.3, 205].map((y) => <line key={y} x1="42" x2="758" y1={y} y2={y} className="plot-rule" />)}
                <path d={areaPath} fill="url(#journey-area)" />
                <polyline points={linePoints} className="trend-line" />
                {plotPoints.filter((point) => point.value > 0).map((point) => { const tooltipId = `trend-tooltip-${point.day.date}`; const show = (target: Element) => showChartTooltip(target, { id: tooltipId, title: readableDate(point.day.date, true), body: `${point.value} ${journeyMetric === "time" ? "recorded minutes" : "finished activities"}` }); return <circle key={point.day.date} cx={point.x} cy={point.y} r={journeyDate === point.day.date ? 5.5 : 3.5} className={journeyDate === point.day.date ? "selected" : ""} tabIndex={0} role="button" onPointerEnter={(event) => show(event.currentTarget)} onPointerLeave={() => setChartTooltip(null)} onFocus={(event) => show(event.currentTarget)} onBlur={() => setChartTooltip(null)} onClick={(event) => { setJourneyDate(point.day.date); show(event.currentTarget); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setJourneyDate(point.day.date); }} aria-describedby={chartTooltip?.id === tooltipId ? tooltipId : undefined} aria-label={`${readableDate(point.day.date)}: ${point.value} ${journeyMetric === "time" ? "minutes" : "activities"}`} />; })}
                <text x="42" y="228">{readableDate(journeyStartDate, true)}</text><text x="758" y="228" textAnchor="end">{readableDate(journal.date, true)}</text><text x="42" y="43">{metricMax} {journeyMetric === "time" ? "min" : "max"}</text>
              </svg>
            </div>
            <div className="chart-legend"><span className="leetcode">Coding</span><span className="system_design">System design</span><span className="behavioral">Behavioral</span></div>
          </article>

          <article className="chart-sheet outcome-chart">
            <div className="chart-heading"><div><span className="eyebrow">CODING LADDER</span><h2>Difficulty mix</h2></div></div>
            <div className="difficulty-bars">{(["easy", "medium", "hard", "unknown"] as const).map((level) => <div key={level}><span>{level}</span><i><b style={{ width: `${(difficultyStats[level] / maxDifficulty) * 100}%` }} /></i><strong>{difficultyStats[level]}</strong></div>)}</div>
            <p>Difficulty comes from the question bank. Custom URLs stay “unknown” until bank metadata is added.</p>
          </article>

          <article className="chart-sheet topic-sheet">
            <div className="chart-heading"><div><span className="eyebrow">SKILL COVERAGE</span><h2>Topics practiced</h2><p>Select a topic to see the records behind it.</p></div></div>
            {topicStats.length ? <div className="topic-bars">{topicStats.map((topic) => <button key={topic.topic} className={journeyTopic === topic.topic ? "active" : ""} onClick={() => setJourneyTopic((current) => current === topic.topic ? "" : topic.topic)}><span>{topic.topic}</span><i><b style={{ width: `${(topic.count / maxTopicCount) * 100}%` }} /></i><strong>{topic.count}</strong></button>)}</div> : <div className="chart-empty rich-empty"><strong>No topic coverage yet.</strong><span>Finish bank-linked coding problems to build this map.</span></div>}
            {journeyTopic && <div className="topic-records"><strong>{journeyTopic}</strong>{selectedTopicEntries.map((entry) => <button key={entry.id} onClick={() => openJourneyEntry(entry, selectedTopicEntries)}>{entry.title}<span>{readableDate(entry.date, true)} →</span></button>)}</div>}
          </article>

          <article className="chart-sheet effort-sheet">
            <div className="chart-heading"><div><span className="eyebrow">EFFORT MAP</span><h2>Time spent versus outcome</h2><p>Each point is one coding attempt. Select a point to open its record.</p></div></div>
            {effortEntries.length ? <svg className="effort-map" viewBox="0 0 800 245" role="img" aria-label="Coding attempts plotted by elapsed time and outcome">
              {[{ label: "Solved", y: 52 }, { label: "After review", y: 122 }, { label: "Failed", y: 192 }].map((row) => <g key={row.label}><line x1="125" x2="760" y1={row.y} y2={row.y} /><text x="18" y={row.y + 4}>{row.label}</text></g>)}
              {effortEntries.map((entry) => {
                const minutes = entry.elapsedSeconds / 60;
                const y = entry.outcome === "solved" ? 52 : entry.outcome === "solved_after_reviewing_approach" ? 122 : 192;
                const x = 125 + (minutes / maxEffortMinutes) * 635;
                const tooltipId = `effort-tooltip-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                const show = (target: Element) => showChartTooltip(target, { id: tooltipId, title: entry.title, body: `${Math.round(minutes)} min · ${outcomeLabel(entry.outcome)}`, foot: readableDate(entry.date, true) });
                return <circle key={entry.id} cx={x} cy={y} r="7" className={entry.outcome} tabIndex={0} role="button" onPointerEnter={(event) => show(event.currentTarget)} onPointerLeave={() => setChartTooltip(null)} onFocus={(event) => show(event.currentTarget)} onBlur={() => setChartTooltip(null)} onClick={(event) => { show(event.currentTarget); openJourneyEntry(entry, effortEntries); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openJourneyEntry(entry, effortEntries); }} aria-describedby={chartTooltip?.id === tooltipId ? tooltipId : undefined} aria-label={`${entry.title}, ${Math.round(minutes)} minutes, ${outcomeLabel(entry.outcome)}`} />;
              })}
              <text x="125" y="235">0 min</text><text x="760" y="235" textAnchor="end">{Math.ceil(maxEffortMinutes)} min</text>
            </svg> : <div className="chart-empty rich-empty"><strong>Your effort map starts with a finished coding timer.</strong><span>Elapsed time and an outcome are both required; Interview Arc will not infer either.</span></div>}
          </article>

          <article className="chart-sheet rhythm-sheet">
            <div className="chart-heading"><div><span className="eyebrow">PACIFIC PRACTICE RHYTHM</span><h2>When sessions begin</h2><p>Activity starts grouped by Pacific time. This reports your schedule; it does not infer productivity.</p></div></div>
            <div className="rhythm-bars">{practiceRhythm.map((period) => <div key={period.label}><span>{period.label}</span><i><b style={{ width: `${(period.count / maxRhythmCount) * 100}%` }} /></i><strong>{period.count}</strong><small>{period.seconds ? formatDuration(period.seconds) : "—"}</small></div>)}</div>
          </article>

          <article className="chart-sheet session-ledger-sheet">
            <div className="chart-heading"><div><span className="eyebrow">SESSION LEDGER</span><h2>Work completed together</h2><p>A session remains one group even when Pacific midnight divides its activities between two journal days.</p></div></div>
            {sessionRollups.length ? <div className="session-rollups">{sessionRollups.map((rollup) => <div key={rollup.session.id}><div><strong>{rollup.session.label}</strong><small>{rollup.dates.map((date) => readableDate(date, true)).join(" → ")}</small></div><span>{rollup.completed}/{rollup.total}</span><i><b style={{ width: `${Math.min(100, (rollup.completed / Math.max(1, rollup.total)) * 100)}%` }} /></i><em>{formatDuration(rollup.seconds)}</em></div>)}</div> : <div className="chart-empty rich-empty"><strong>No completed session activity yet.</strong><span>Session-level completion and time will appear after the first grouped activity finishes.</span></div>}
          </article>

        </div>
      </section>
    );
  }

  function scrollToLogDate(date: string) {
    document.getElementById(`log-date-${date}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderReviewQueue() {
    return <section className={`review-queue-workspace ${reviewNestedEntry || reviewNestedProblem ? "has-open-reader" : ""}`}>
    <div className="review-queue-base" inert={reviewNestedEntry || reviewNestedProblem ? true : undefined}>
      <ReviewQueueView
        items={reviewQueueItems}
        loading={!hydrated}
        stale={hydrated && !synced}
        errorMessage={mutationError?.type === "review-add-today" || mutationError?.type === "review-defer"
          ? mutationError.message
          : null}
        readerUnavailable={readerNotFound || null}
        reviewStreak={reviewQueueStreak}
        blockedQuestionIds={reviewBlockedQuestionIds}
        blockedTitles={reviewBlockedTitles}
        pendingReviewKeys={new Set(
          mutationError?.type === "review-add-today" ? [] : pendingReviewKeys,
        )}
        canAddToToday={Boolean(draft.workbench)}
        onAddToToday={addReviewsToToday}
        onDefer={deferReview}
        onOpenAttempt={openReviewAttempt}
        onDismissError={dismissReviewQueueError}
        onDismissReaderUnavailable={() => { setReaderNotFound(""); window.history.replaceState({ interviewArcWorkspaceView: "reviews", interviewArcReviewDepth: 0 }, "", workspaceViewHref(window.location.href, "reviews")); }}
      />
    </div>
    {arrivalState === "entered" && (reviewNestedEntry || reviewNestedProblem) && <div className={`review-reader-detail reader-workspace focused-attempt-workspace ${readerClosing ? "reader-closing" : ""}`}><ModalReaderPane focusKey={reviewNestedProblem ? `review-solution-${reviewNestedProblem.type}-${reviewNestedProblem.question.id}` : `review-attempt-${reviewNestedEntry?.id ?? "unknown"}`} restoreFocusRef={reviewReaderOpenerRef} className="review-reader-pane focused-attempt-pane" label="Selected Review Queue reader">{reviewNestedProblem ? renderSolutionReader() : renderCaseReader()}</ModalReaderPane></div>}
    </section>;
  }

  function renderLibrary() {
    const attentionFilterCount = (filter: LibraryAttentionFilter) => libraryEntries.filter((entry) => {
      const hasNotes = Boolean(entry.personalNote?.trim() || entry.pinnedNotes?.length);
      const needsReview = Boolean(entry.review && entry.review.status !== "dismissed" && entry.review.status !== "completed");
      if (filter === "due") return entry.review?.status === "due";
      if (filter === "needs_review") return needsReview;
      if (filter === "solved") return entry.outcome === "solved";
      if (filter === "helped") return entry.outcome === "solved_after_reviewing_approach";
      if (filter === "failed") return entry.outcome === "failed";
      return hasNotes;
    }).length;
    const attentionGroups: Array<{ label: string; tone: string; options: Array<{ value: LibraryAttentionFilter; label: string }> }> = [
      { label: "Review filters", tone: "review", options: [
        { value: "due", label: "Due now" },
        { value: "needs_review", label: "Needs review" },
      ] },
      { label: "Result filters", tone: "result", options: [
        { value: "solved", label: "Solved" },
        { value: "helped", label: "Solved with help" },
        { value: "failed", label: "Failed" },
      ] },
      { label: "Record filters", tone: "record", options: [
        { value: "notes", label: "Has notes" },
      ] },
    ];
    const toggleTypeFilter = (type: ActivityType) => setLibraryTypeFilters((current) => current.includes(type)
      ? current.filter((candidate) => candidate !== type)
      : [...current, type]);
    const toggleAttentionFilter = (filter: LibraryAttentionFilter) => setLibraryAttentionFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
    const modeFilterOptions = [
      ...(draft.interactionModeRegistry?.modes.filter((mode) => !mode.deprecated).map((mode) => ({
        value: mode.id,
        label: interactionModeClassificationLabel({ primaryPracticeModeId: mode.id }),
      })) ?? []),
      { value: "mixed", label: "Mixed practice" },
      { value: "mentor_assistance", label: "Any Mentor assistance" },
      { value: "unrecorded", label: "Mode not recorded" },
    ];
    const toggleModeFilter = (filter: LibraryModeFilter) => setLibraryModeFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
    const modeFilterCount = (filter: LibraryModeFilter) => libraryEntries.filter((entry) => (
      matchesInteractionModeFilter(entry.interactionModeClassification?.classification, filter)
    )).length;
    const activePastFilterCount = libraryAttentionFilters.length + libraryModeFilters.length;
    const hasPastFilters = libraryTypeFilters.length > 0 || activePastFilterCount > 0;
    const visibleRecordCount = groupedLog.reduce((sum, [, entries]) => sum + entries.length, 0);
    return (
      <section className={`view-page library-page ${selectedEntry ? "has-open-entry" : ""} ${listRestoring === "library" ? "list-restoring" : ""}`}>
        <InterviewPageHero tone="past" eyebrow="PAST · COMPLETED WORK" title={<>Read the journey<br /><em>like a field journal.</em></>} description="Past contains finished activity timers and published case files—never planned work or result flags by themselves." metrics={[
          { value: visibleRecordCount, label: "records" },
          { value: activeDates.length, label: "active days" },
          { value: "Pacific", label: "record" },
        ]} />
        {readerNotFound && <div className="journey-reader-not-found" role="alert"><strong>That practice record is unavailable.</strong><span>The saved reader link points to <code>{readerNotFound}</code>, which is not present in the current authoritative record.</span></div>}
        <div className={`past-master-detail ${masterPaneOpen ? "master-pane-open" : ""} ${selectedEntry ? "reader-workspace" : ""} ${nestedReaderFocus ? "nested-reader-focus" : ""} ${readerClosing ? "reader-closing" : ""}`}>
          <div
            className="past-master-pane"
            onClickCapture={(event) => {
              const target = event.target;
              if (target instanceof Element && target.closest(".log-entry-open")) closeMasterAfterSelection();
            }}
          >
            <div className="past-control-deck">
              <div className="library-toolbar bank-toolbar compact-toolbar past-toolbar">
                <div className="bank-filter-rail primary-bank-controls past-filter-rail">
                  <div className="filter-row type-control" role="group" aria-label="Filter past practice by type">{(["leetcode", "system_design", "behavioral"] as const).map((filter) => <button key={filter} className={libraryTypeFilters.includes(filter) ? "active" : ""} aria-pressed={libraryTypeFilters.includes(filter)} onClick={() => toggleTypeFilter(filter)}>{typeLabel(filter)}</button>)}</div>
                  <div className="bank-icon-tools" aria-label="Past tools">
                    {hasPastFilters && <button type="button" className="filter-clear" onClick={() => { setLibraryTypeFilters([]); setLibraryAttentionFilters([]); setLibraryModeFilters([]); }}>Clear</button>}
                    <button className={`collection-toggle icon-tool ${libraryStarFilter ? "active" : ""}`} onClick={() => setLibraryStarFilter((current) => !current)} aria-pressed={libraryStarFilter} aria-label={libraryStarFilter ? "Show all completed practice" : "Show starred completed practice"} title={libraryStarFilter ? "Showing starred practice" : "Show starred practice"}><Icon name="star" /></button>
                    <details className={`control-menu icon-menu ${activePastFilterCount > 0 ? "active" : ""}`}>
                      <summary aria-label={`More filters${activePastFilterCount ? `, ${activePastFilterCount} active` : ""}`} title={`${activePastFilterCount || "No"} active filters`}><Icon name="filter" />{activePastFilterCount > 0 && <i>{activePastFilterCount}</i>}</summary>
                      <div className="control-popover compact-filter-popover attention-menu">
                        {attentionGroups.map((group) => <div className={`compact-filter-group ${group.tone}`} role="group" aria-label={group.label} key={group.label}>{group.options.map((option) => <button type="button" key={option.value} className={libraryAttentionFilters.includes(option.value) ? "active" : ""} aria-pressed={libraryAttentionFilters.includes(option.value)} onClick={() => toggleAttentionFilter(option.value)}><span>{option.label}</span><small>{attentionFilterCount(option.value)}</small><i aria-hidden="true">✓</i></button>)}</div>)}
                        <div className="compact-filter-group mode" role="group" aria-label="Interaction-mode filters">{modeFilterOptions.map((option) => <button type="button" key={option.value} className={libraryModeFilters.includes(option.value) ? "active" : ""} aria-pressed={libraryModeFilters.includes(option.value)} onClick={() => toggleModeFilter(option.value)}><span>{option.label}</span><small>{modeFilterCount(option.value)}</small><i aria-hidden="true">✓</i></button>)}</div>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
              <label className="bank-search-bar past-search-bar">
                <span className="bank-search-icon" aria-hidden="true"><svg viewBox="0 0 20 20" width="16" height="16" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12.8 12.8 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
                <input type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search" aria-label="Search completed practice" />
                {librarySearch ? <button type="button" className="bank-search-clear" onClick={() => setLibrarySearch("")} aria-label="Clear search">×</button> : <span className="bank-search-clear-spacer" aria-hidden="true" />}
                <span className="bank-result-count" aria-live="polite">{visibleRecordCount} record{visibleRecordCount === 1 ? "" : "s"}</span>
              </label>
            </div>
            <div className="log-layout">
              <div className="dated-log" ref={pastListRef} onScroll={() => {
                const position = {
                  pageScrollTop: window.scrollY,
                  listScrollTop: pastListRef.current?.scrollTop ?? 0,
                };
                listPositionMemoryRef.current.library[selectedEntry ? "pane" : "main"] = position;
              }}>
                {groupedLog.length ? groupedLog.map(([date, entries]) => <section className="log-day" id={`log-date-${date}`} key={date}><header><time>{readableDate(date)}</time><span>{entries.length} record{entries.length === 1 ? "" : "s"} · Pacific day</span></header><div className="log-day-entries">{entries.map((entry) => { const reusableQuestion = bankQuestionForEntry(entry); const reusableSolution = Boolean(reusableQuestion && hasReusableSolution(entry.type, reusableQuestion)); return <article className={`log-entry ${entry.type} ${selectedEntry?.id === entry.id ? "selected" : ""}`} data-list-item-id={`library:${entry.id}`} key={entry.id}><button className="log-entry-open" onClick={() => openPastEntry(entry, filteredPastEntries)} aria-label={`Read ${entry.title}`}><span className={`type-mark ${entry.type}`}>{typeMark(entry.type)}</span><div className="log-entry-copy"><small>{typeLabel(entry.type)} · {entry.status}{entry.sessionId ? " · session activity" : " · standalone"}</small><strong>{entry.title}</strong>{meaningfulSubtitle(entry.subtitle) && <span>{meaningfulSubtitle(entry.subtitle)}</span>}<div className="entry-badges">{entry.review?.status === "due" && <i className="review-badge due">Due now</i>}{entry.review?.status === "scheduled" && <i className="review-badge">Review {entry.review.dueDate}</i>}{Boolean(entry.personalNote?.trim() || entry.pinnedNotes?.length) && <i className="note-badge">Pinned note</i>}{entry.outcome === "solved" && <i className="independent-badge">Solved</i>}{entry.outcome === "solved_after_reviewing_approach" && <i className="help-badge">Solved with help</i>}{entry.outcome === "failed" && <i className="failure-badge">Failed attempt</i>}<InteractionModeMarkers snapshot={entry.interactionModeClassification} /></div>{entry.startedAt && <span className="entry-time-range">{formatPracticeTimestamp(entry.startedAt, true)} → {entry.endedAt ? formatPracticeTimestamp(entry.endedAt, true) : "Paused"}</span>}</div><div className="log-entry-meta"><strong>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "—"}</strong><span>{entry.artifact ? "Published record" : entry.status}</span></div></button><div className="log-entry-actions"><StaticResultFlag outcome={entry.outcome} label={resultLabel(entry.outcome, entry.type)} /><button className={`star-control ${isStarred(entry.type, entry.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(entry.type, entry.questionId)} disabled={!entry.questionId} aria-label={`${isStarred(entry.type, entry.questionId) ? "Unstar" : "Star"} ${entry.title}`} title="Star this problem"><Icon name="star" /></button><button className={`icon-action solution-control ${reusableSolution ? "solution-available" : ""}`} onClick={() => openEntrySolution(entry)} disabled={!reusableSolution} aria-label={reusableSolution ? `Open reusable solution for ${entry.title}` : `No reusable solution for ${entry.title}`} title={reusableSolution ? "Open reusable solution" : "No reusable solution yet"}><Icon name="book" /></button><button className="icon-action add-practice-control" onClick={() => addEntryToToday(entry)} disabled={!reusableQuestion || Boolean(reusableQuestion && isQuestionBlocked(reusableQuestion, todayBlockedQuestions()))} aria-label={`Add ${entry.title} to Today`} title="Add to Today"><Icon name="plus" /></button></div></article>; })}</div></section>) : <div className="quiet-empty library-empty"><strong>No completed work in this filter yet.</strong><span>Try another filter, or finish an activity to add it to the field journal.</span></div>}
              </div>
              <aside className="log-calendar"><span className="eyebrow">JUMP TO A DAY</span><h2>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</h2><div className="calendar-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div className="calendar-mini">{calendarDays.map((day) => day.hasEntries ? <button key={day.key} onClick={() => scrollToLogDate(day.key)} title={`Jump to ${day.key}`}>{day.day}<i /></button> : <span key={day.key}>{day.day}</span>)}</div><div className="calendar-dates">{groupedLog.map(([date]) => <button key={date} onClick={() => scrollToLogDate(date)}>{readableDate(date, true)} <span>↘</span></button>)}</div></aside>
            </div>
          </div>
          {selectedEntry && <aside className="past-entry-pane" aria-label="Selected practice record">{libraryNestedProblem ? renderSolutionReader() : renderCaseReader()}</aside>}
        </div>
      </section>
    );
  }

  function renderBanks() {
    const todayBlocked = todayBlockedQuestions();
    const bankEntries = [
      ...bankFor("leetcode").map((question) => ({ type: "leetcode" as const, question })),
      ...bankFor("system_design").map((question) => ({ type: "system_design" as const, question })),
      ...bankFor("behavioral").map((question) => ({ type: "behavioral" as const, question })),
    ].map((entry) => {
      const latestAttempt = latestFinishedAttempt(libraryEntries, entry.type, entry.question);
      const needsReview = Boolean(latestAttempt?.review && latestAttempt.review.status !== "dismissed" && latestAttempt.review.status !== "completed");
      const dueNow = Boolean(latestAttempt?.review && (latestAttempt.review.status === "due" || (latestAttempt.review.status === "scheduled" && latestAttempt.review.dueDate <= journal.date)));
      return {
        ...entry,
        latestAttempt,
        finished: Boolean(latestAttempt),
        needsReview,
        dueNow,
        hasNotes: Boolean(latestAttempt?.personalNote?.trim() || latestAttempt?.pinnedNotes?.length),
      };
    });
    const tagsForEntry = (type: ActivityType, question: QuestionBankItem) => [...new Set([
      ...inferredQuestionTags(type, question),
      ...(profileFor(type, question.id)?.tags ?? []),
    ])];
    const tagCatalog = (["leetcode", "system_design", "behavioral"] as const).map((type) => {
      const counts = new Map<string, number>();
      bankEntries.filter((entry) => entry.type === type).forEach((entry) => {
        tagsForEntry(type, entry.question).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
      });
      return {
        type,
        tags: [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
      };
    });
    const searchNeedle = bankSearch.toLowerCase().trim();
    const filteredEntries = bankEntries.filter((entry) => {
      const level = questionLevel(entry.question);
      const attentionMatch = (filter: BankAttentionFilter) => {
        if (filter === "due") return entry.dueNow;
        if (filter === "needs_review") return entry.needsReview;
        if (filter === "solved") return entry.latestAttempt?.outcome === "solved";
        if (filter === "helped") return entry.latestAttempt?.outcome === "solved_after_reviewing_approach";
        if (filter === "failed") return entry.latestAttempt?.outcome === "failed";
        if (filter === "todo") return !entry.latestAttempt;
        return entry.hasNotes;
      };
      const reviewFilters = bankAttentionFilters.filter((filter) => filter === "due" || filter === "needs_review");
      const resultFilters = bankAttentionFilters.filter((filter) => filter === "solved" || filter === "helped" || filter === "failed" || filter === "todo");
      return (bankTypeFilters.length === 0 || bankTypeFilters.includes(entry.type))
        && (reviewFilters.length === 0 || reviewFilters.some(attentionMatch))
        && (resultFilters.length === 0 || resultFilters.some(attentionMatch))
        && (!bankAttentionFilters.includes("notes") || attentionMatch("notes"))
        && (bankLevelFilters.length === 0 || (level !== null && bankLevelFilters.includes(level)))
        && (bankStarFilter === "all" || isStarred(entry.type, entry.question.id))
        && (bankTagFilters.length === 0 || tagsForEntry(entry.type, entry.question).some((tag) => bankTagFilters.includes(`${entry.type}:${tag}`)))
        && (!searchNeedle
          || entry.question.title.toLowerCase().includes(searchNeedle)
          || (entry.question.prompt?.toLowerCase().includes(searchNeedle) ?? false)
          || tagsForEntry(entry.type, entry.question).some((tag) => tag.toLowerCase().includes(searchNeedle))
          || (profileFor(entry.type, entry.question.id)?.tags.some((tag) => tag.includes(searchNeedle)) ?? false)
          || (entry.question.problemNumber !== undefined && String(entry.question.problemNumber).includes(searchNeedle))
          || (entry.question.companyTags?.some((tag) => tag.toLowerCase().includes(searchNeedle)) ?? false));
    });
    const visibleEntries = [...filteredEntries].sort((left, right) => {
      let cmp = 0;
      if (bankSortKey === "frequency") {
        cmp = frequencyRank(left.question) - frequencyRank(right.question);
      } else if (bankSortKey === "acceptance") {
        cmp = (left.question.acceptanceRate ?? -1) - (right.question.acceptanceRate ?? -1);
      } else {
        cmp = recencyScore(left.question) - recencyScore(right.question);
      }
      if (cmp === 0) cmp = left.question.title.localeCompare(right.question.title);
      return bankSortDir === "asc" ? cmp : -cmp;
    });
    function toggleSort(key: typeof bankSortKey) {
      if (bankSortKey === key) {
        setBankSortDir((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setBankSortKey(key);
      setBankSortDir("asc");
    }
    const sortOptions = [
      { key: "frequency" as const, label: "Frequency", icon: "freq" },
      { key: "recent" as const, label: "Recent", icon: "recent" },
      { key: "acceptance" as const, label: "Acceptance", icon: "accept" },
    ];
    const behavioralCurriculum = bankFor("behavioral").filter(isResumeCurriculumQuestion);
    const completedBehavioralCurriculum = behavioralCurriculum
      .filter((question) => Boolean(latestFinishedAttempt(libraryEntries, "behavioral", question)))
      .map((question) => question.id);
    const bankOverviewFor = (type: Extract<ActivityType, "leetcode" | "system_design">) => {
      const entries = bankEntries.filter((entry) => entry.type === type);
      return {
        total: entries.length,
        finished: entries.filter((entry) => entry.finished).length,
        dueNow: entries.filter((entry) => entry.dueNow).length,
        needsReview: entries.filter((entry) => entry.needsReview).length,
        reusableSolutions: entries.filter((entry) => hasReusableSolution(type, entry.question)).length,
        starred: entries.filter((entry) => isStarred(type, entry.question.id)).length,
        topicCount: new Set(entries.flatMap((entry) => tagsForEntry(type, entry.question))).size,
      };
    };
    const activeBankFilterCount = bankLevelFilters.length + bankAttentionFilters.length;
    const hasBankFilters = bankTypeFilters.length > 0
      || bankAttentionFilters.length > 0
      || bankLevelFilters.length > 0
      || bankTagFilters.length > 0;
    const toggleBankTypeFilter = (type: ActivityType) => setBankTypeFilters((current) => current.includes(type)
      ? current.filter((candidate) => candidate !== type)
      : [...current, type]);
    const toggleBankAttentionFilter = (filter: BankAttentionFilter) => setBankAttentionFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
    const toggleBankLevelFilter = (filter: "easy" | "medium" | "hard") => setBankLevelFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
    const toggleBankTagFilter = (filter: string) => setBankTagFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
    const difficultyCount = (filter: "easy" | "medium" | "hard") => bankEntries.filter((entry) => questionLevel(entry.question) === filter).length;
    const attentionCount = (filter: BankAttentionFilter) => bankEntries.filter((entry) => {
      if (filter === "due") return entry.dueNow;
      if (filter === "needs_review") return entry.needsReview;
      if (filter === "solved") return entry.latestAttempt?.outcome === "solved";
      if (filter === "helped") return entry.latestAttempt?.outcome === "solved_after_reviewing_approach";
      if (filter === "failed") return entry.latestAttempt?.outcome === "failed";
      if (filter === "todo") return !entry.latestAttempt;
      return entry.hasNotes;
    }).length;
    const clearBankFilters = () => {
      setBankTypeFilters([]);
      setBankAttentionFilters([]);
      setBankLevelFilters([]);
      setBankTagFilters([]);
    };
    const activeSort = sortOptions.find((option) => option.key === bankSortKey) ?? sortOptions[0];
    return (
      <section className={`view-page banks-page ${selectedProblem ? "has-open-solution" : ""} ${listRestoring === "banks" ? "list-restoring" : ""}`}>
        <InterviewPageHero tone="banks" eyebrow="PROBLEM BANKS · ALL PRACTICE SOURCES" title={<>Choose the next thing<br /><em>worth practicing.</em></>} description="Browse every coding, system-design, and behavioral prompt in one place. Practice today adds the question to standalone practice and takes you directly to Today." footer={<div className="bank-totals hero-bank-totals" aria-label="Question bank totals">
          {([[
            "leetcode", bankFor("leetcode").length, "Coding problems"],
            ["system_design", bankFor("system_design").length, "System designs"],
            ["behavioral", bankFor("behavioral").length, "Behavioral prompts"],
          ] as const).map(([type, total, label]) => <button type="button" className={`${type} ${expandedBankDesk === type ? "active" : ""}`} aria-expanded={expandedBankDesk === type} aria-controls={`bank-domain-desk-${type}`} onClick={() => setExpandedBankDesk((current) => current === type ? null : type)} key={type}><strong>{total}</strong><span>{label}</span><i aria-hidden="true">{expandedBankDesk === type ? "−" : "+"}</i></button>)}
        </div>} />
        {readerNotFound && <div className="journey-reader-not-found" role="alert"><strong>That Bank reader is unavailable.</strong><span>The saved reader link points to <code>{readerNotFound}</code>, which is not present in the current authoritative record.</span></div>}
        <div className="bank-domain-desks">
          {(["leetcode", "system_design", "behavioral"] as const).map((type) => {
            const open = expandedBankDesk === type;
            return <div className={`bank-domain-desk-shell ${open ? "open" : ""}`} id={`bank-domain-desk-${type}`} aria-hidden={!open} inert={open ? undefined : true} key={type}><div>
              {type === "behavioral" ? <>
                <BehavioralTargetDesk enabled={open} />
                <BehavioralFoundation
                  key={open ? "open" : "closed"}
                  enabled={open}
                  curriculumQuestionIds={behavioralCurriculum.map((question) => question.id)}
                  completedCurriculumQuestionIds={completedBehavioralCurriculum}
                />
              </> : <BankDomainOverview type={type} {...bankOverviewFor(type)} />}
            </div></div>;
          })}
        </div>
        <div className={`bank-master-detail ${masterPaneOpen ? "master-pane-open" : ""} ${selectedProblem ? "reader-workspace" : ""} ${nestedReaderFocus ? "nested-reader-focus" : ""} ${readerClosing ? "reader-closing" : ""}`}>
        <div
          className="bank-master-pane"
          onClickCapture={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".problem-bank-entry")) closeMasterAfterSelection();
          }}
        >
        <div className="bank-control-deck">
          <div className="bank-search-row"><label className="bank-search-bar">
            <span className="bank-search-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12.8 12.8 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </span>
            <input
              type="search"
              value={bankSearch}
              onChange={(event) => setBankSearch(event.target.value)}
              placeholder="Search title, topic, company, or #…"
              aria-label="Search problem banks"
            />
            {bankSearch ? (
              <button type="button" className="bank-search-clear" onClick={() => setBankSearch("")} aria-label="Clear search">×</button>
            ) : <span className="bank-search-clear-spacer" aria-hidden="true" />}
            <span className="bank-result-count" aria-live="polite">{visibleEntries.length} result{visibleEntries.length === 1 ? "" : "s"}</span>
          </label></div>
          <div className={`topic-ribbon ${bankTopicsExpanded ? "expanded" : ""}`}>
            <div className="topic-ribbon-head"><span>Patterns & competencies</span>{bankTagFilters.length > 0 && <button className="filter-clear clear-topic" onClick={() => setBankTagFilters([])}>Clear</button>}<button className="topic-expand" onClick={() => setBankTopicsExpanded((current) => !current)}>{bankTopicsExpanded ? "Collapse" : "Explore all"}<Icon name="chevron" /></button></div>
            <div className="topic-ribbon-columns">{tagCatalog.map((group) => <section className={group.type} key={group.type}><header><i className={`type-mark ${group.type}`}>{typeMark(group.type)}</i><strong>{typeLabel(group.type)}</strong></header><div>{group.tags.slice(0, bankTopicsExpanded ? undefined : 3).map(({ tag, count }) => { const filterKey = `${group.type}:${tag}`; return <button key={tag} className={bankTagFilters.includes(filterKey) ? "active" : ""} aria-pressed={bankTagFilters.includes(filterKey)} onClick={() => toggleBankTagFilter(filterKey)}><span>{tag}</span><small>{count}</small></button>; })}</div></section>)}</div>
          </div>
          <div className="library-toolbar bank-toolbar compact-toolbar">
            <div className="bank-filter-rail primary-bank-controls">
              <div className="filter-row type-control" role="group" aria-label="Filter problem banks by question type">
                  {(["leetcode", "system_design", "behavioral"] as const).map((filter) => (
                    <button key={filter} className={bankTypeFilters.includes(filter) ? "active" : ""} aria-pressed={bankTypeFilters.includes(filter)} onClick={() => toggleBankTypeFilter(filter)}>
                      {typeLabel(filter)}
                    </button>
                  ))}
              </div>
              <div className="bank-icon-tools" aria-label="Problem bank tools">
                {hasBankFilters && <button type="button" className="filter-clear" onClick={clearBankFilters}>Clear</button>}
                <button className={`collection-toggle icon-tool ${bankStarFilter === "starred" ? "active" : ""}`} onClick={() => setBankStarFilter((current) => current === "starred" ? "all" : "starred")} aria-pressed={bankStarFilter === "starred"} aria-label={bankStarFilter === "starred" ? "Show all problems" : "Show starred problems"} title={bankStarFilter === "starred" ? "Showing starred problems" : "Show starred problems"}><Icon name="star" /></button>
                <details className={`control-menu icon-menu ${activeBankFilterCount > 0 ? "active" : ""}`}><summary aria-label={`Problem filters${activeBankFilterCount ? `, ${activeBankFilterCount} active` : ""}`} title={`${activeBankFilterCount || "No"} active filters`}><Icon name="filter" />{activeBankFilterCount > 0 && <i>{activeBankFilterCount}</i>}</summary><div className="control-popover compact-filter-popover bank-attention-menu"><div className="compact-filter-group review" role="group" aria-label="Review filters">{([['due', 'Due now'], ['needs_review', 'Needs review']] as const).map(([filter, label]) => <button type="button" key={filter} className={bankAttentionFilters.includes(filter) ? "active" : ""} aria-pressed={bankAttentionFilters.includes(filter)} onClick={() => toggleBankAttentionFilter(filter)}><span>{label}</span><small>{attentionCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div><div className="compact-filter-group result" role="group" aria-label="Result filters">{([['solved', 'Solved'], ['helped', 'Solved with help'], ['failed', 'Failed'], ['todo', 'To do']] as const).map(([filter, label]) => <button type="button" key={filter} className={bankAttentionFilters.includes(filter) ? "active" : ""} aria-pressed={bankAttentionFilters.includes(filter)} onClick={() => toggleBankAttentionFilter(filter)}><span>{label}</span><small>{attentionCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div><div className="compact-filter-group record" role="group" aria-label="Record filters"><button type="button" className={bankAttentionFilters.includes("notes") ? "active" : ""} aria-pressed={bankAttentionFilters.includes("notes")} onClick={() => toggleBankAttentionFilter("notes")}><span>Has notes</span><small>{attentionCount("notes")}</small><i aria-hidden="true">✓</i></button></div><div className="compact-filter-group difficulty" role="group" aria-label="Difficulty filters">{(["easy", "medium", "hard"] as const).map((filter) => <button type="button" key={filter} className={bankLevelFilters.includes(filter) ? "active" : ""} aria-pressed={bankLevelFilters.includes(filter)} onClick={() => toggleBankLevelFilter(filter)}><span>{filter[0].toUpperCase() + filter.slice(1)}</span><small>{difficultyCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div></div></details>
                <details className="control-menu sort-menu icon-menu"><summary aria-label={`Sort by ${activeSort.label}, ${bankSortDir === "asc" ? "ascending" : "descending"}`} title={`Sort: ${activeSort.label} · ${bankSortDir === "asc" ? "low to high" : "high to low"}`}><span className={`bank-sort-glyph ${activeSort.icon}`} aria-hidden="true" /><small className="sort-direction-badge" aria-hidden="true">{bankSortDir === "asc" ? "↑" : "↓"}</small></summary><div className="control-popover"><strong>Order by</strong>
                  {sortOptions.map((option) => {
                    const active = bankSortKey === option.key;
                    const direction = active ? bankSortDir : null;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={active ? "active" : ""}
                        onClick={() => toggleSort(option.key)}
                        aria-pressed={active}
                        aria-label={`${option.label}: ${active ? (direction === "asc" ? "low to high, click to reverse" : "high to low, click to reverse") : "sort low to high"}`}
                        title={`${option.label} · ${active ? (direction === "asc" ? "↑ low→high" : "↓ high→low") : "click to sort"}`}
                      >
                        <span>{option.label}</span><small aria-hidden="true">{active ? (direction === "asc" ? "↑ low to high" : "↓ high to low") : ""}</small>
                      </button>
                    );
                  })}
                </div></details>
              </div>
            </div>
          </div>
        </div>
        <div className="problem-bank-list" ref={bankListRef} onScroll={() => {
          const position = {
            pageScrollTop: window.scrollY,
            listScrollTop: bankListRef.current?.scrollTop ?? 0,
          };
          listPositionMemoryRef.current.banks[selectedProblem ? "pane" : "main"] = position;
        }} tabIndex={0} aria-label="Problem bank results">
          {visibleEntries.map(({ type, question, finished, latestAttempt }) => { const blockedToday = isQuestionBlocked(question, todayBlocked); const active = selectedProblem?.type === type && selectedProblem.question.id === question.id; const reusableSolution = hasReusableSolution(type, question); return <article className={`problem-bank-entry ${type} ${active ? "selected" : ""}`} data-list-item-id={`banks:${type}:${question.id}`} role="button" tabIndex={0} aria-label={`View solution for ${question.title}`} onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, a, input, summary")) return; openProblemProfile(type, question); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); openProblemProfile(type, question); } }} key={`${type}-${question.id}`}>
            <span className={`type-mark ${type}`}>{typeMark(type)}</span>
            <div className="problem-bank-copy"><small>{typeLabel(type)}{question.difficulty ? ` · ${question.difficulty}` : ""}{question.complexity ? ` · ${displayComplexity(question.complexity)}` : ""} · {finished ? "finished" : "to practice"}</small><strong className="problem-title">{question.title}</strong>{question.prompt && question.prompt !== question.title && <p>{question.prompt}</p>}{question.url && <a className="nested-card-link" href={question.url} target="_blank" rel="noreferrer">{question.solutionReference ? "Open question & solution references ↗" : "Open problem ↗"}</a>}</div>
            <div className="bank-entry-meta"><span>{question.targetMinutes} min estimate</span>{question.problemNumber && <small>#{question.problemNumber}{typeof question.acceptanceRate === "number" ? ` · ${question.acceptanceRate.toFixed(1)}% acceptance` : ""}</small>}{question.companySignals?.[0] && <small>{question.companySignals[0].company} frequency {question.companySignals[0].frequencyScore}/{question.companySignals[0].frequencyScale} · {question.companySignals[0].window}</small>}{question.answerFormat && <small>{question.answerFormat} answer · {question.frequency ?? "medium"} frequency</small>}{question.solutionReference && <small>Reference solution{question.referenceAccess === "may_require_sign_in" ? " may require sign-in" : " available"}</small>}<small className={`content-tags ${type}`}>{tagsForEntry(type, question).slice(0, 4).map((tag) => `#${tag}`).join("  ")}</small></div>
            <div className="bank-entry-actions"><StaticResultFlag outcome={latestAttempt?.outcome} /><button className={`icon-action ${isStarred(type, question.id) ? "active starred" : ""}`} onClick={() => toggleProblemStar(type, question.id)} aria-label={`${isStarred(type, question.id) ? "Unstar" : "Star"} ${question.title}`} title={isStarred(type, question.id) ? "Unstar" : "Star"}><Icon name="star" /></button><button className={`icon-action solution-control ${reusableSolution ? "solution-available" : ""}`} onClick={() => openProblemProfile(type, question)} disabled={!reusableSolution} aria-label={reusableSolution ? `View solution for ${question.title}` : `No reusable solution for ${question.title}`} title={reusableSolution ? "View solution" : "No reusable solution yet"}><Icon name="book" /></button><button className="icon-action practice" onClick={() => addBankQuestionToToday(question, type)} disabled={blockedToday} aria-label={blockedToday ? `${question.title} is already on Today` : `Practice ${question.title} today`} title={blockedToday ? "Already on Today" : "Practice today"}><Icon name="plus" /></button></div>
          </article>; })}
          {!visibleEntries.length && <div className="quiet-empty bank-empty"><strong>No questions match these filters.</strong><span>Change type, progress, level, or search text.</span></div>}
        </div>
        </div>
        <aside className="bank-solution-pane" aria-label="Selected problem solution">{selectedProblem ? bankNestedEntry ? renderCaseReader() : renderSolutionReader() : null}</aside>
        </div>
      </section>
    );
  }

  const activeBank = bankFor(composer.type);
  const composerBlocked = todayBlockedQuestions(composer.editingId ? [composer.editingId] : []);
  const composerQuestionEntries = activeBank.map((question) => {
    const latestAttempt = latestFinishedAttempt(libraryEntries, composer.type, question);
    const needsReview = Boolean(latestAttempt?.review && latestAttempt.review.status !== "dismissed" && latestAttempt.review.status !== "completed");
    const dueNow = Boolean(latestAttempt?.review && (latestAttempt.review.status === "due" || (latestAttempt.review.status === "scheduled" && latestAttempt.review.dueDate <= journal.date)));
    return { question, latestAttempt, needsReview, dueNow, blockedToday: isQuestionBlocked(question, composerBlocked) };
  });
  const filteredQuestionEntries = composerQuestionEntries.filter((entry) => {
    const { question, latestAttempt, needsReview, dueNow } = entry;
    const needle = composer.query.toLowerCase().trim();
    const reviewFilters = composerAttentionFilters.filter((filter) => filter === "due" || filter === "needs_review");
    const resultFilters = composerAttentionFilters.filter((filter) => filter === "solved" || filter === "helped" || filter === "failed" || filter === "todo");
    const matchesReview = (filter: ComposerAttentionFilter) => filter === "due" ? dueNow : needsReview;
    const matchesResult = (filter: ComposerAttentionFilter) => filter === "solved"
      ? latestAttempt?.outcome === "solved"
      : filter === "helped"
        ? latestAttempt?.outcome === "solved_after_reviewing_approach"
        : filter === "failed" ? latestAttempt?.outcome === "failed" : !latestAttempt;
    return question.active
      && (!needle || question.title.toLowerCase().includes(needle) || question.topics.some((topic) => topic.toLowerCase().includes(needle)))
      && (reviewFilters.length === 0 || reviewFilters.some(matchesReview))
      && (resultFilters.length === 0 || resultFilters.some(matchesResult))
      && (composerLevelFilters.length === 0 || (questionLevel(question) !== null && composerLevelFilters.includes(questionLevel(question)!)))
      && (!composerStarFilter || isStarred(composer.type, question.id));
  });
  const orderedQuestionEntries = [...filteredQuestionEntries].sort((left, right) => {
    let comparison = 0;
    if (composerSortKey === "frequency") {
      comparison = frequencyRank(left.question) - frequencyRank(right.question);
    } else if (composerSortKey === "acceptance") {
      comparison = (left.question.acceptanceRate ?? -1) - (right.question.acceptanceRate ?? -1);
    } else {
      comparison = recencyScore(left.question) - recencyScore(right.question);
    }
    if (comparison === 0) comparison = left.question.title.localeCompare(right.question.title);
    return composerSortDir === "asc" ? comparison : -comparison;
  });
  const visibleQuestionEntries = orderedQuestionEntries.slice(0, composerVisibleCount);
  const derivedUrl = deriveQuestionFromUrl(composer.query, composer.type, activeBank);
  const derivedBlocked = Boolean(derivedUrl && isQuestionBlocked({ id: derivedUrl.questionId ?? `personal-${composer.type}-${slugify(derivedUrl.title)}`, title: derivedUrl.title, url: derivedUrl.url, topics: [], targetMinutes: derivedUrl.targetMinutes, active: true }, composerBlocked));
  const canSaveActivity = composer.editingId
    ? !derivedBlocked && (composer.type === "leetcode" ? Boolean(composer.selectedId || derivedUrl) : Boolean(composer.selectedId || derivedUrl || composer.query.trim()))
    : composer.selectedActivities.length > 0 || composer.focusSelected;
  const selectedActivityCount = composer.selectedActivities.length + (composer.focusSelected ? 1 : 0);
  const selectedActivityMinutes = composer.selectedActivities.reduce((total, activity) => total + activity.minutes, 0)
    + (composer.focusSelected ? Math.max(1, Number(composer.focusMinutes) || 60) : 0);
  const stagedByType = (["leetcode", "system_design", "behavioral"] as const).map((type) => ({
    type,
    items: composer.selectedActivities.filter((item) => item.type === type),
  })).filter((group) => group.items.length > 0);
  const customUrlInvalid = Boolean(composer.customUrl.trim() && !deriveQuestionFromUrl(composer.customUrl, composer.type, activeBank));
  const activeComposerFilterCount = composerAttentionFilters.length + composerLevelFilters.length;
  const hasComposerFilters = activeComposerFilterCount > 0 || composerStarFilter;
  const activeComposerSort = COMPOSER_SORT_OPTIONS.find((option) => option.key === composerSortKey) ?? COMPOSER_SORT_OPTIONS[0];
  const composerAttentionCount = (filter: ComposerAttentionFilter) => composerQuestionEntries.filter((entry) => {
    if (filter === "due") return entry.dueNow;
    if (filter === "needs_review") return entry.needsReview;
    if (filter === "solved") return entry.latestAttempt?.outcome === "solved";
    if (filter === "helped") return entry.latestAttempt?.outcome === "solved_after_reviewing_approach";
    if (filter === "failed") return entry.latestAttempt?.outcome === "failed";
    return !entry.latestAttempt;
  }).length;
  const composerLevelCount = (level: "easy" | "medium" | "hard") => composerQuestionEntries.filter((entry) => questionLevel(entry.question) === level).length;
  const toggleComposerAttentionFilter = (filter: ComposerAttentionFilter) => {
    const next = composerAttentionFilters.includes(filter)
      ? composerAttentionFilters.filter((candidate) => candidate !== filter)
      : [...composerAttentionFilters, filter];
    setComposerAttentionFilters(next);
    resetActiveComposerResults({ attentionFilters: next });
  };
  const toggleComposerLevelFilter = (filter: "easy" | "medium" | "hard") => {
    const next = composerLevelFilters.includes(filter)
      ? composerLevelFilters.filter((candidate) => candidate !== filter)
      : [...composerLevelFilters, filter];
    setComposerLevelFilters(next);
    resetActiveComposerResults({ levelFilters: next });
  };
  const clearComposerFilters = () => {
    setComposerAttentionFilters([]);
    setComposerLevelFilters([]);
    setComposerStarFilter(false);
    resetActiveComposerResults({ attentionFilters: [], levelFilters: [], starFilter: false });
  };
  const toggleComposerStarFilter = () => {
    const next = !composerStarFilter;
    setComposerStarFilter(next);
    resetActiveComposerResults({ starFilter: next });
  };
  const updateComposerQuery = (query: string) => {
    setComposer((current) => ({ ...current, query }));
    resetActiveComposerResults({ query });
  };
  const toggleComposerSort = (key: ComposerSortKey) => {
    const nextDirection = composerSortKey === key
      ? composerSortDir === "asc" ? "desc" : "asc"
      : "asc";
    setComposerSortKey(key);
    setComposerSortDir(nextDirection);
    resetActiveComposerResults({ sortKey: key, sortDir: nextDirection });
  };
  const handleComposerListScroll = (list: HTMLDivElement) => {
    rememberComposerSpecialtyView(composer.type, { scrollTop: list.scrollTop });
    if (list.scrollTop + list.clientHeight < list.scrollHeight - 72 || composerVisibleCount >= orderedQuestionEntries.length) return;
    setComposerVisibleCount((current) => {
      const next = Math.min(orderedQuestionEntries.length, current + 20);
      rememberComposerSpecialtyView(composer.type, { visibleCount: next, scrollTop: list.scrollTop });
      return next;
    });
  };
  const sessionAvailability = {
    coding: availableSessionQuestions("leetcode", composer.editingSessionId).length,
    systemDesign: availableSessionQuestions("system_design", composer.editingSessionId).length,
    behavioral: availableSessionQuestions("behavioral", composer.editingSessionId).length,
  };
  const sessionTotalSeconds = sessionAllocationSeconds(
    composer.sessionCoding,
    composer.sessionSystemDesign,
    composer.sessionBehavioral,
  );
  const canSaveSession = sessionTotalSeconds > 0 &&
    composer.sessionCoding <= sessionAvailability.coding &&
    composer.sessionSystemDesign <= sessionAvailability.systemDesign &&
    composer.sessionBehavioral <= sessionAvailability.behavioral;
  const readerSelectedEntry = view === "library"
    ? libraryNestedProblem ? null : selectedEntry
    : view === "banks"
      ? bankNestedEntry
      : view === "journey"
        ? journeyNestedProblem ? null : journeyNestedEntry
        : view === "reviews"
          ? reviewNestedProblem ? null : reviewNestedEntry
          : null;
  const journeyReaderEntries = journeyReaderOrderIds.flatMap((id) => {
    const entry = libraryEntries.find((candidate) => candidate.id === id);
    return entry ? [entry] : [];
  });
  const pastReaderEntries = pastReaderOrderIds.flatMap((id) => {
    const entry = libraryEntries.find((candidate) => candidate.id === id);
    return entry ? [entry] : [];
  });
  const reviewReaderEntries = reviewReaderOrderIds.flatMap((id) => {
    const entry = libraryEntries.find((candidate) => candidate.id === id);
    return entry ? [entry] : [];
  });
  const currentReaderHref = typeof window === "undefined" ? "https://interview-arc.invalid/" : window.location.href;
  const currentJourneyReaderState = readJourneyReaderState(currentReaderHref);
  const currentPastReaderState = readPastReaderState(currentReaderHref);
  const currentReviewReaderState = readReviewReaderState(currentReaderHref);
  const currentBankReaderState = readBankReaderState(currentReaderHref);
  const bankReaderEntries = selectedProblem
    ? libraryEntries.filter((entry) => entry.type === selectedProblem.type && entry.questionId === selectedProblem.question.id)
    : [];
  const readerNavigationEntries = currentJourneyReaderState
    ? journeyReaderEntries
    : currentReviewReaderState
      ? reviewReaderEntries
    : currentPastReaderState
      ? pastReaderEntries
      : currentBankReaderState?.attemptId
        ? bankReaderEntries
        : [];
  const readerNavigationIndex = readerSelectedEntry
    ? readerNavigationEntries.findIndex((entry) => entry.id === readerSelectedEntry.id)
    : -1;
  const navigateReaderEntry = (entry: LibraryEntry) => {
    if (currentJourneyReaderState) openJourneyEntry(entry, readerNavigationEntries);
    else if (currentReviewReaderState) openReviewEntry(entry, readerNavigationEntries);
    else if (currentBankReaderState?.attemptId) openAttemptFromSolution(entry);
    else openPastEntry(entry, readerNavigationEntries);
  };
  const readerSelectedProblem = view === "banks"
    ? bankNestedEntry ? null : selectedProblem
    : view === "library"
      ? libraryNestedProblem
      : view === "journey"
        ? journeyNestedProblem
        : view === "reviews"
          ? reviewNestedProblem
          : null;
  const ownerProblemProfile = readerSelectedProblem ? profileFor(readerSelectedProblem.type, readerSelectedProblem.question.id) : undefined;
  const canonicalProblemProfile = readerSelectedProblem?.question.solutionProfile;
  const selectedProblemProfile = ownerProblemProfile && canonicalProblemProfile ? {
    ...ownerProblemProfile,
    tags: effectiveProfileTags(canonicalProblemProfile, ownerProblemProfile.payload),
    payload: {
      ...canonicalProblemProfile,
      ...ownerProblemProfile.payload,
      sections: [...new Map([
        ...canonicalProblemProfile.sections.map((section) => [section.title.trim().toLowerCase(), section] as const),
        ...ownerProblemProfile.payload.sections.map((section) => [section.title.trim().toLowerCase(), section] as const),
      ]).values()],
      references: [...new Map([
        ...canonicalProblemProfile.references.map((reference) => [reference.url, reference] as const),
        ...ownerProblemProfile.payload.references.map((reference) => [reference.url, reference] as const),
      ]).values()],
    },
  } : ownerProblemProfile ?? (canonicalProblemProfile ? {
    specialty: readerSelectedProblem!.type,
    questionId: readerSelectedProblem!.question.id,
    title: readerSelectedProblem!.question.title,
    currentRevision: 1,
    tags: canonicalProblemProfile.tags,
    payload: canonicalProblemProfile,
    updatedAt: 0,
  } : undefined);
  const selectedProblemProfileReusable = isReusableSolutionProfile(readerSelectedProblem?.type ?? "leetcode", selectedProblemProfile?.payload);
  const selectedProblemPracticeScenarios = selectedProblemProfile?.payload.practiceScenarios?.length ? {
    solutionProfile: { questionId: selectedProblemProfile.questionId, revision: selectedProblemProfile.currentRevision },
    scenarios: selectedProblemProfile.payload.practiceScenarios,
  } : null;
  const selectedProblemAttempts = readerSelectedProblem
    ? libraryEntries.filter((entry) => entry.type === readerSelectedProblem.type && entry.questionId === readerSelectedProblem.question.id)
    : [];
  const selectedProblemRevisions = readerSelectedProblem
    ? draft.solutionRevisions.filter((revision) => revision.specialty === readerSelectedProblem.type && revision.questionId === readerSelectedProblem.question.id)
    : [];
  const selectedEntryActivityId = readerSelectedEntry?.artifact?.activityId || (readerSelectedEntry && !readerSelectedEntry.id.includes("/") ? readerSelectedEntry.id : "");
  const selectedEntryTurns = readerSelectedEntry?.transcriptTurns ?? [];
  const selectedEntryClips = readerSelectedEntry?.audioClips ?? [];
  const selectedEntryDeliveryAnalyses = readerSelectedEntry?.deliveryAnalyses ?? [];
  const selectedEntryCodeAttempts = readerSelectedEntry?.codeAttempts ?? [];
  const selectedEntryModeTransitions = readerSelectedEntry?.interactionModeTransitions ?? [];
  const selectedEntryFinalAnswer = readerSelectedEntry?.finalAnswer ?? null;
  const selectedEntryPracticeScenarios = readerSelectedEntry?.practiceScenarios ?? null;
  const selectedEntryBehavioralAnalysis = readerSelectedEntry?.behavioralAnalysis ?? null;
  const selectedEntryResumeContext = readerSelectedEntry?.resumeContext ?? null;
  const selectedCaseSections = dedupeReaderSections(readerSelectedEntry?.artifact?.sections.filter((section) => !(selectedEntryTurns.length && isTranscriptSection(section.title))) ?? []);
  const selectedCaseGroups = groupReaderSections(selectedCaseSections);
  const selectedSolutionGroups = groupReaderSections(selectedProblemProfileReusable ? selectedProblemProfile?.payload.sections ?? [] : []);
  const highlightScope = readerSelectedEntry
    ? { scopeType: "activity" as const, scopeId: selectedEntryActivityId || readerSelectedEntry.id }
    : readerSelectedProblem
      ? { scopeType: "solution" as const, scopeId: `${readerSelectedProblem.type}:${readerSelectedProblem.question.id}` }
      : null;
  const highlightScopeType = highlightScope?.scopeType;
  const highlightScopeId = highlightScope?.scopeId;
  const readerMemoryKey = readerSelectedEntry
    ? `activity:${selectedEntryActivityId || readerSelectedEntry.id}`
    : readerSelectedProblem
      ? `solution:${readerSelectedProblem.type}:${readerSelectedProblem.question.id}`
      : "";
  const activeReaderMemory = readerMemoryKey ? readerMemory[readerMemoryKey] : undefined;

  function readerGroupOpen(groupId: string, defaultOpen: boolean) {
    return activeReaderMemory?.groups[groupId] ?? defaultOpen;
  }

  function rememberReaderGroup(groupId: string, open: boolean) {
    if (!readerMemoryKey) return;
    setReaderMemory((current) => ({
      ...current,
      [readerMemoryKey]: {
        ...(current[readerMemoryKey] ?? { groups: {} }),
        groups: { ...(current[readerMemoryKey]?.groups ?? {}), [groupId]: open },
      },
    }));
  }

  function rememberReaderPosition() {
    if (!readerMemoryKey || !readerDocumentRef.current) return;
    window.cancelAnimationFrame(readerScrollFrameRef.current);
    readerScrollFrameRef.current = window.requestAnimationFrame(() => {
      const root = readerDocumentRef.current;
      if (!root) return;
      const rootTop = root.getBoundingClientRect().top;
      const anchors = [...root.querySelectorAll<HTMLElement>("[id]")].filter((node) => node.offsetParent !== null);
      const anchor = anchors.reduce<HTMLElement | null>((best, node) => {
        const offset = node.getBoundingClientRect().top - rootTop;
        return offset <= 28 ? node : best;
      }, null);
      setReaderMemory((current) => ({
        ...current,
        [readerMemoryKey]: {
          ...(current[readerMemoryKey] ?? { groups: {} }),
          scrollTop: root.scrollTop,
          anchorId: anchor?.id,
          anchorOffset: anchor ? anchor.getBoundingClientRect().top - rootTop : undefined,
        },
      }));
    });
  }

  useEffect(() => {
    if (!readerMemoryKey) return;
    const frame = window.requestAnimationFrame(() => {
      const root = readerDocumentRef.current;
      const memory = readerMemory[readerMemoryKey];
      if (!root || !memory) return;
      const anchor = memory.anchorId ? document.getElementById(memory.anchorId) : null;
      if (anchor && root.contains(anchor)) {
        root.scrollTop += anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - (memory.anchorOffset ?? 0);
      } else if (typeof memory.scrollTop === "number") {
        root.scrollTop = memory.scrollTop;
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // Restore only when the reader identity changes. Scroll updates write new
    // memory continuously and must not yank the reader back mid-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerMemoryKey]);

  useEffect(() => {
    window.localStorage.setItem("interview-arc-highlight-color", highlightColorDraft);
  }, [highlightColorDraft]);

  useEffect(() => {
    queueMicrotask(() => setPendingHighlight(null));
    queueMicrotask(() => setSelectedHighlightId(""));
    queueMicrotask(() => setAnnotationPosition(null));
    if (!highlightScopeType || !highlightScopeId) { queueMicrotask(() => setContentHighlights([])); return; }
    const controller = new AbortController();
    void fetch(`/api/highlights?scopeType=${highlightScopeType}&scopeId=${encodeURIComponent(highlightScopeId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ContentHighlight[]> : [])
      .then((rows) => setContentHighlights(rows.map((row) => ({ ...row, note: row.note ?? "", notes: row.notes ?? [] }))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [highlightScopeId, highlightScopeType]);

  useEffect(() => {
    const root = readerDocumentRef.current;
    const css = CSS as typeof CSS & { highlights?: Map<string, unknown> };
    const HighlightConstructor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const rangeMap = highlightRangesRef.current;
    rangeMap.clear();
    if (!root || !css.highlights || !HighlightConstructor) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let combined = "";
    while (walker.nextNode()) { const node = walker.currentNode as Text; nodes.push(node); combined += node.data; }
    const locate = (offset: number) => {
      let seen = 0;
      for (const node of nodes) {
        if (offset <= seen + node.data.length) return { node, offset: Math.max(0, offset - seen) };
        seen += node.data.length;
      }
      return null;
    };
    const styleRanges = new Map<string, Range[]>();
    const addStyledRange = (name: string, range: Range) => styleRanges.set(name, [...(styleRanges.get(name) ?? []), range]);
    contentHighlights.forEach((highlight) => {
      let index = combined.indexOf(highlight.quote);
      while (index >= 0) {
        const prefixMatches = !highlight.prefix || combined.slice(Math.max(0, index - highlight.prefix.length), index).endsWith(highlight.prefix);
        const suffixMatches = !highlight.suffix || combined.slice(index + highlight.quote.length, index + highlight.quote.length + highlight.suffix.length).startsWith(highlight.suffix);
        if (prefixMatches && suffixMatches) break;
        index = combined.indexOf(highlight.quote, index + 1);
      }
      if (index < 0) return;
      const start = locate(index); const end = locate(index + highlight.quote.length);
      if (!start || !end) return;
      const fullRange = new Range(); fullRange.setStart(start.node, start.offset); fullRange.setEnd(end.node, end.offset);
      const segments: Range[] = [];
      let seen = 0;
      const highlightEnd = index + highlight.quote.length;
      nodes.forEach((node) => {
        const nodeStart = seen;
        const nodeEnd = seen + node.data.length;
        seen = nodeEnd;
        const segmentStart = Math.max(index, nodeStart);
        const segmentEnd = Math.min(highlightEnd, nodeEnd);
        if (segmentStart >= segmentEnd) return;
        const segment = new Range();
        segment.setStart(node, segmentStart - nodeStart);
        segment.setEnd(node, segmentEnd - nodeStart);
        segments.push(segment);
      });
      if (!segments.length) segments.push(fullRange);
      rangeMap.set(highlight.id, segments);
      const styleName = `interview-arc-${highlight.notes.length ? "note-" : ""}${highlight.color}`;
      segments.forEach((segment) => addStyledRange(styleName, segment));
    });
    styleRanges.forEach((ranges, name) => css.highlights?.set(name, new HighlightConstructor(...ranges)));
    return () => { styleRanges.forEach((_, name) => css.highlights?.delete(name)); rangeMap.clear(); };
  }, [contentHighlights, selectedEntry?.id, selectedProblem?.question.id]);

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.interviewArcHighlights = "saved";
    style.textContent = `
      ::highlight(interview-arc-yellow){color:inherit;background:rgba(250,207,72,.62)}
      ::highlight(interview-arc-green){color:inherit;background:rgba(105,211,148,.48)}
      ::highlight(interview-arc-pink){color:inherit;background:rgba(246,149,185,.5)}
      ::highlight(interview-arc-note-yellow){color:inherit;background:transparent;text-decoration:underline #d39a00 3px;text-underline-offset:4px}
      ::highlight(interview-arc-note-green){color:inherit;background:transparent;text-decoration:underline #2b9b62 3px;text-underline-offset:4px}
      ::highlight(interview-arc-note-pink){color:inherit;background:transparent;text-decoration:underline #d45083 3px;text-underline-offset:4px}
    `;
    document.head.append(style);
    return () => style.remove();
  }, []);

  function annotationPositionFor(rect: DOMRect): AnnotationPosition {
    const popoverHalfWidth = 158;
    const x = Math.min(window.innerWidth - popoverHalfWidth - 12, Math.max(popoverHalfWidth + 12, rect.left + rect.width / 2));
    const placement = rect.top >= 210 ? "above" : "below";
    return { x, y: placement === "above" ? rect.top - 10 : rect.bottom + 10, placement };
  }

  function closeAnnotationPopover() {
    setPendingHighlight(null);
    setSelectedHighlightId("");
    setAnnotationPosition(null);
    setHighlightNoteDraft("");
    setHighlightNoteEditing(false);
    setEditingHighlightNoteId("");
    setHighlightPaletteOpen(false);
  }

  function highlightAtPoint(x: number, y: number) {
    return [...highlightRangesRef.current.entries()].reverse().find(([, ranges]) => ranges.some((range) => [...range.getClientRects()].some((rect) => x >= rect.left - 3 && x <= rect.right + 3 && y >= rect.top - 3 && y <= rect.bottom + 3)));
  }

  function captureHighlightSelection(clientX?: number, clientY?: number) {
    const root = readerDocumentRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || !selection.rangeCount) {
      setPendingHighlight(null);
      if (typeof clientX === "number" && typeof clientY === "number") {
        const match = highlightAtPoint(clientX, clientY);
        if (match) {
          const rects = match[1].flatMap((range) => [...range.getClientRects()]);
          const rect = rects.find((candidate) => clientX >= candidate.left - 3 && clientX <= candidate.right + 3 && clientY >= candidate.top - 3 && clientY <= candidate.bottom + 3) ?? rects.at(-1);
          if (!rect) return;
          setSelectedHighlightId(match[0]);
          setAnnotationPosition(annotationPositionFor(rect));
          setHighlightNoteDraft("");
          setHighlightNoteEditing(false);
          setEditingHighlightNoteId("");
          setHighlightPaletteOpen(false);
          return;
        }
      }
      setSelectedHighlightId("");
      setAnnotationPosition(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const quote = range.cloneContents().textContent ?? "";
    if (!quote.trim()) return;
    const allText = root.textContent ?? "";
    const before = new Range();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const index = (before.cloneContents().textContent ?? "").length;
    const visibleRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const anchorRect = visibleRects.at(-1) ?? range.getBoundingClientRect();
    setSelectedHighlightId("");
    setAnnotationPosition(null);
    setHighlightNoteDraft("");
    setHighlightNoteEditing(false);
    setHighlightPaletteOpen(false);
    setPendingHighlight({ quote, prefix: allText.slice(Math.max(0, index - 120), index), suffix: allText.slice(index + quote.length, index + quote.length + 120), position: annotationPositionFor(anchorRect) });
  }

  async function saveHighlight(note = "", color: HighlightColor = highlightColorDraft) {
    if (!highlightScope || !pendingHighlight) return;
    setHighlightBusy(true);
    const selector = { quote: pendingHighlight.quote, prefix: pendingHighlight.prefix, suffix: pendingHighlight.suffix };
    const response = await fetch("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...highlightScope, ...selector, color, note }) });
    setHighlightBusy(false);
    if (!response.ok) return;
    const row = await response.json() as ContentHighlight;
    setContentHighlights((current) => [...current, row]);
    closeAnnotationPopover();
    window.getSelection()?.removeAllRanges();
  }

  async function removeHighlight(id: string) {
    setHighlightBusy(true);
    const response = await fetch(`/api/highlights?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setHighlightBusy(false);
    if (response.ok) { setContentHighlights((current) => current.filter((highlight) => highlight.id !== id)); closeAnnotationPopover(); }
  }

  async function addHighlightNote(highlightId: string, body: string) {
    setHighlightBusy(true);
    const response = await fetch("/api/highlight-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId, body }) });
    setHighlightBusy(false);
    if (!response.ok) return;
    const note = await response.json() as HighlightNote;
    setContentHighlights((current) => current.map((highlight) => highlight.id === highlightId ? { ...highlight, notes: [...highlight.notes, note] } : highlight));
    setHighlightNoteDraft("");
    setHighlightNoteEditing(false);
    setEditingHighlightNoteId("");
  }

  async function updateHighlightNote(id: string, body: string) {
    setHighlightBusy(true);
    const response = await fetch("/api/highlight-notes", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, body }) });
    setHighlightBusy(false);
    if (!response.ok) return;
    const note = await response.json() as HighlightNote;
    setContentHighlights((current) => current.map((highlight) => highlight.id === note.highlightId
      ? { ...highlight, notes: highlight.notes.map((candidate) => candidate.id === note.id ? note : candidate) }
      : highlight));
    setHighlightNoteDraft("");
    setHighlightNoteEditing(false);
    setEditingHighlightNoteId("");
  }

  async function removeHighlightNote(note: HighlightNote) {
    setHighlightBusy(true);
    const response = await fetch(`/api/highlight-notes?id=${encodeURIComponent(note.id)}`, { method: "DELETE" });
    setHighlightBusy(false);
    if (!response.ok) return;
    setContentHighlights((current) => current.map((highlight) => highlight.id === note.highlightId
      ? { ...highlight, notes: highlight.notes.filter((candidate) => candidate.id !== note.id) }
      : highlight));
    if (editingHighlightNoteId === note.id) {
      setHighlightNoteDraft("");
      setHighlightNoteEditing(false);
      setEditingHighlightNoteId("");
    }
  }

  function formatHighlightNote(marker: "bold" | "italic" | "underline") {
    const editor = highlightNoteEditorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = highlightNoteDraft.slice(start, end) || (marker === "bold" ? "bold text" : marker === "italic" ? "italic text" : "underlined text");
    const [before, after] = marker === "bold" ? ["**", "**"] : marker === "italic" ? ["_", "_"] : ["<u>", "</u>"];
    const next = `${highlightNoteDraft.slice(0, start)}${before}${selected}${after}${highlightNoteDraft.slice(end)}`;
    setHighlightNoteDraft(next);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function renderAnnotationPopover() {
    const selectedHighlight = contentHighlights.find((highlight) => highlight.id === selectedHighlightId);
    const position = pendingHighlight?.position ?? annotationPosition;
    if (!position || (!pendingHighlight && !selectedHighlight)) return null;
    const style = { left: position.x, top: position.y };
    const portal = (content: ReactNode) => typeof document === "undefined" ? null : createPortal(content, document.body);
    if (pendingHighlight && !highlightNoteEditing) return portal(<div className={`annotation-popover selection-annotation ${position.placement}`} style={style} role="toolbar" aria-label="Selected text actions" onMouseDown={(event) => event.preventDefault()}>
      <button className={`annotation-current-color ${highlightColorDraft}`} type="button" onClick={() => setHighlightPaletteOpen((current) => !current)} disabled={highlightBusy} aria-label={`Current highlight color: ${highlightColorDraft}. Choose another color`} aria-expanded={highlightPaletteOpen} title="Choose color"><span /></button>
      <button type="button" onClick={() => void saveHighlight()} disabled={highlightBusy} aria-label="Highlight selected text" title="Highlight"><Icon name="edit" /></button>
      <button type="button" onClick={() => { setHighlightNoteDraft(""); setHighlightNoteEditing(true); }} disabled={highlightBusy} aria-label="Underline selected text and add a note" title="Add note"><Icon name="note" /></button>
      {highlightPaletteOpen && <div className="annotation-color-menu annotation-colors" role="group" aria-label="Highlight color">
        {(["yellow", "green", "pink"] as HighlightColor[]).map((color) => <button className={`${color} ${highlightColorDraft === color ? "selected" : ""}`} type="button" onClick={() => { setHighlightColorDraft(color); setHighlightPaletteOpen(false); }} aria-pressed={highlightColorDraft === color} aria-label={`Use ${color} for future highlights`} title={`${color[0].toUpperCase()}${color.slice(1)}`} key={color}><span /></button>)}
      </div>}
    </div>);
    if (pendingHighlight) return portal(<form className={`annotation-popover annotation-note-editor rich-note-editor ${position.placement}`} style={style} onSubmit={(event) => { event.preventDefault(); void saveHighlight(highlightNoteDraft); }} onMouseDown={(event) => event.stopPropagation()}>
      <label htmlFor="new-highlight-note">Add a note to this highlight</label>
      <div className="note-format-toolbar" role="toolbar" aria-label="Note formatting"><button type="button" onClick={() => formatHighlightNote("bold")} aria-label="Bold"><strong>B</strong></button><button type="button" onClick={() => formatHighlightNote("italic")} aria-label="Italic"><em>I</em></button><button type="button" onClick={() => formatHighlightNote("underline")} aria-label="Underline"><u>U</u></button></div>
      <textarea id="new-highlight-note" ref={highlightNoteEditorRef} autoFocus value={highlightNoteDraft} onChange={(event) => setHighlightNoteDraft(event.target.value)} placeholder="Why does this matter?" />
      <div className="annotation-form-actions"><button type="button" onClick={() => setHighlightNoteEditing(false)}>Cancel</button><button type="submit" disabled={highlightBusy || !highlightNoteDraft.trim()}>{highlightBusy ? "Saving…" : "Save note"}</button></div>
    </form>);
    if (!selectedHighlight) return null;
    return portal(<section className={`annotation-popover saved-annotation ${selectedHighlight.notes.length ? "has-note" : "compact no-note"} ${position.placement}`} style={style} aria-label="Highlight actions" onMouseDown={(event) => event.stopPropagation()}>
      {highlightNoteEditing ? <form className="rich-note-editor" onSubmit={(event) => { event.preventDefault(); if (editingHighlightNoteId) void updateHighlightNote(editingHighlightNoteId, highlightNoteDraft); else void addHighlightNote(selectedHighlight.id, highlightNoteDraft); }}>
        <label htmlFor="saved-highlight-note">{editingHighlightNoteId ? "Edit note" : "New note"}</label>
        <div className="note-format-toolbar" role="toolbar" aria-label="Note formatting"><button type="button" onClick={() => formatHighlightNote("bold")} aria-label="Bold"><strong>B</strong></button><button type="button" onClick={() => formatHighlightNote("italic")} aria-label="Italic"><em>I</em></button><button type="button" onClick={() => formatHighlightNote("underline")} aria-label="Underline"><u>U</u></button></div>
        <textarea id="saved-highlight-note" ref={highlightNoteEditorRef} autoFocus value={highlightNoteDraft} onChange={(event) => setHighlightNoteDraft(event.target.value)} placeholder="Add a note…" />
        <div className="annotation-form-actions"><button type="button" onClick={() => { setHighlightNoteDraft(""); setHighlightNoteEditing(false); setEditingHighlightNoteId(""); }}>Cancel</button><button type="submit" disabled={highlightBusy || !highlightNoteDraft.trim()}>{highlightBusy ? "Saving…" : "Save note"}</button></div>
      </form> : <>
        {selectedHighlight.notes.length > 0 && <div className="highlight-note-list">{selectedHighlight.notes.map((note, index) => {
          const expanded = expandedHighlightNoteIds.includes(note.id);
          const veryLong = note.body.length > 700;
          return <article className={`highlight-note-card tone-${index % 3} ${expanded ? "expanded" : ""}`} key={note.id}><header><time>{formatPracticeTimestamp(new Date(note.updatedAt).toISOString(), true)}</time><div><button type="button" onClick={() => { setEditingHighlightNoteId(note.id); setHighlightNoteDraft(note.body); setHighlightNoteEditing(true); }} aria-label="Edit note" title="Edit note"><Icon name="edit" /></button><button type="button" onClick={() => void removeHighlightNote(note)} aria-label="Delete note" title="Delete note"><Icon name="close" /></button></div></header><FormattedHighlightNote body={note.body} />{note.body.length > 150 && <button className="highlight-note-expand" type="button" onClick={() => veryLong ? setInspectedHighlightNoteId(note.id) : setExpandedHighlightNoteIds((current) => current.includes(note.id) ? current.filter((id) => id !== note.id) : [...current, note.id])}>{veryLong ? "Open full note" : expanded ? "Show less" : "Read more"}</button>}</article>;
        })}</div>}
        <div className="annotation-actions"><button type="button" onClick={() => { setEditingHighlightNoteId(""); setHighlightNoteDraft(""); setHighlightNoteEditing(true); }} aria-label="Add another note" title="Add note"><Icon name="note" /><i><Icon name="plus" /></i></button><button className="danger" type="button" onClick={() => void removeHighlight(selectedHighlight.id)} disabled={highlightBusy} aria-label="Remove highlight" title="Remove highlight"><Icon name="trash" /></button></div>
      </>}
      {inspectedHighlightNoteId && selectedHighlight.notes.find((note) => note.id === inspectedHighlightNoteId) && portal(<div className="long-note-backdrop" role="presentation" onMouseDown={() => setInspectedHighlightNoteId("")}><article className="long-note-inspector" role="dialog" aria-modal="true" aria-label="Full highlight note" onMouseDown={(event) => event.stopPropagation()}><header><div><span>Highlight note</span><time>{formatPracticeTimestamp(new Date(selectedHighlight.notes.find((note) => note.id === inspectedHighlightNoteId)!.updatedAt).toISOString(), true)}</time></div><button type="button" className="icon-action" onClick={() => setInspectedHighlightNoteId("")} aria-label="Close full note"><Icon name="close" /></button></header><FormattedHighlightNote body={selectedHighlight.notes.find((note) => note.id === inspectedHighlightNoteId)!.body} /></article></div>)}
    </section>);
  }

  useEffect(() => {
    if (!selectedEntryActivityId) return;
    const controller = new AbortController();
    void fetch(`/api/practice-record?activityId=${encodeURIComponent(selectedEntryActivityId)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{
        turns: TranscriptTurn[];
        notes: PracticeNote[];
        audioClips: AudioClip[];
        deliveryAnalyses: DeliveryAnalysis[];
        codeAttempts: LeetCodeCodeAttempt[];
        finalAnswer: BehavioralFinalAnswerProjection | null;
        practiceScenarios: BehavioralPracticeScenarioProjection | null;
        behavioralAnalysis: BehavioralAttemptAnalysisProjection | null;
        resumeContext: ActivityResumeContext | null;
        interactionModeClassification: LogEntry["interactionModeClassification"];
        interactionModeTransitions: InteractionModeTransitionProjection[];
      }> : null)
      .then((record) => {
        if (!record) return;
        const enrich = (current: LogEntry | null) => current && (current.artifact?.activityId || current.id) === selectedEntryActivityId
          ? { ...current, transcriptTurns: record.turns, pinnedNotes: record.notes, audioClips: record.audioClips, deliveryAnalyses: record.deliveryAnalyses, codeAttempts: record.codeAttempts, finalAnswer: record.finalAnswer, practiceScenarios: record.practiceScenarios, behavioralAnalysis: record.behavioralAnalysis, resumeContext: record.resumeContext, interactionModeClassification: record.interactionModeClassification, interactionModeTransitions: record.interactionModeTransitions }
          : current;
        if (view === "banks") setBankNestedEntry(enrich);
        else if (view === "journey") setJourneyNestedEntry(enrich);
        else if (view === "reviews") setReviewNestedEntry(enrich);
        else setSelectedEntry(enrich);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Unable to load the practice transcript.");
        }
      });
    return () => controller.abort();
  }, [selectedEntryActivityId, view]);

  function setEveryReaderGroup(open: boolean) {
    if (!readerMemoryKey) return;
    const groups = [...(readerDocumentRef.current?.querySelectorAll<HTMLDetailsElement>("details.reader-group") ?? [])];
    setReaderMemory((current) => ({
      ...current,
      [readerMemoryKey]: {
        ...(current[readerMemoryKey] ?? { groups: {} }),
        groups: {
          ...(current[readerMemoryKey]?.groups ?? {}),
          ...Object.fromEntries(groups.map((group) => [group.id, open])),
        },
      },
    }));
  }

  function closeReaderPanel() {
    const closePlan = readerClosePlan(window.location.href);
    if (view === "library" && window.history.state?.interviewArcLoopOrigin) {
      window.sessionStorage.removeItem("interview-arc-selected-past");
      const storedDepth = Number(window.history.state?.interviewArcPastDepth ?? 1);
      const depth = Number.isInteger(storedDepth) && storedDepth > 0 ? storedDepth : 1;
      setSelectedEntry(null);
      setLibraryNestedProblem(null);
      setPastReaderOrderIds([]);
      setReaderNotFound("");
      setReaderClosing(false);
      window.history.go(-depth);
      return;
    }
    if (view === "journey" && closePlan?.view === "journey") {
      const journeyState = readJourneyReaderState(window.location.href);
      const depth = Number(window.history.state?.interviewArcJourneyDepth ?? 0);
      const scrollY = window.history.state?.interviewArcJourneyScrollY;
      if (journeyState?.problemId) {
        setJourneyNestedProblem(null);
        setReaderNotFound("");
        setReaderClosing(false);
        if (window.history.state?.interviewArcJourneyReader && depth > 1) window.history.go(-1);
        else window.history.replaceState(
          {
            interviewArcJourneyReader: true,
            interviewArcJourneyDepth: readerDepthAfterNestedClose(depth),
            interviewArcJourneyScrollY: scrollY,
          },
          "",
          closePlan.href,
        );
        return;
      }
      setJourneyNestedEntry(null);
      setJourneyNestedProblem(null);
      setJourneyReaderOrderIds([]);
      setReaderNotFound("");
      setReaderClosing(false);
      restorePageScroll(scrollY);
      if (window.history.state?.interviewArcJourneyReader && depth > 0) window.history.go(-depth);
      else window.history.replaceState(
        {
          interviewArcWorkspaceView: "journey",
          interviewArcJourneyDepth: 0,
          interviewArcJourneyScrollY: scrollY,
        },
        "",
        closePlan.href,
      );
      return;
    }
    if (view === "reviews" && closePlan?.view === "reviews") {
      const reviewState = readReviewReaderState(window.location.href);
      const depth = Number(window.history.state?.interviewArcReviewDepth ?? 0);
      setReaderNotFound("");
      setReaderClosing(false);
      if (reviewState?.problemId) {
        setReviewNestedProblem(null);
        if (window.history.state?.interviewArcReviewReader && depth > 1) window.history.go(-1);
        else window.history.replaceState(
          { interviewArcReviewReader: true, interviewArcReviewDepth: readerDepthAfterNestedClose(depth) },
          "",
          closePlan.href,
        );
        return;
      }
      setReviewNestedEntry(null);
      setReviewNestedProblem(null);
      setReviewReaderOrderIds([]);
      if (window.history.state?.interviewArcReviewReader && depth > 0) window.history.go(-depth);
      else window.history.replaceState(
        { interviewArcWorkspaceView: "reviews", interviewArcReviewDepth: 0 },
        "",
        closePlan.href,
      );
      return;
    }
    if (view === "library" && libraryNestedProblem && closePlan?.view === "past") {
      const depth = Number(window.history.state?.interviewArcPastDepth ?? 0);
      setLibraryNestedProblem(null);
      setReaderNotFound("");
      setReaderClosing(false);
      if (window.history.state?.interviewArcPastReader && depth > 1) window.history.go(-1);
      else window.history.replaceState(
        { interviewArcPastReader: true, interviewArcPastDepth: readerDepthAfterNestedClose(depth) },
        "",
        closePlan.href,
      );
      return;
    }
    if (view === "banks" && closePlan?.view === "banks") {
      const bankState = readBankReaderState(window.location.href);
      const depth = Number(window.history.state?.interviewArcBankDepth ?? 0);
      setReaderNotFound("");
      setReaderClosing(false);
      if (bankState?.attemptId) {
        setBankNestedEntry(null);
        if (window.history.state?.interviewArcBankReader && depth > 1) window.history.go(-(depth - 1));
        else window.history.replaceState(
          { interviewArcBankReader: true, interviewArcBankDepth: readerDepthAfterNestedClose(depth) },
          "",
          closePlan.href,
        );
        return;
      }
      const position = listPositionMemoryRef.current.banks.main;
      pendingListRestoreRef.current = { surface: "banks", ...position };
      setListRestoring("banks");
      window.sessionStorage.removeItem("interview-arc-selected-bank");
      setSelectedProblem(null);
      setBankNestedEntry(null);
      if (window.history.state?.interviewArcBankReader && depth > 0) window.history.go(-depth);
      else window.history.replaceState(
        { interviewArcWorkspaceView: "banks", interviewArcBankDepth: 0 },
        "",
        closePlan.href,
      );
      return;
    }
    if (view === "library" && !libraryNestedProblem && closePlan?.view === "journey") {
      window.sessionStorage.removeItem("interview-arc-selected-past");
      const depth = Number(window.history.state?.interviewArcJourneyDepth ?? 0);
      const scrollY = window.history.state?.interviewArcJourneyScrollY;
      setSelectedEntry(null);
      setJourneyReaderOrderIds([]);
      setPastReaderOrderIds([]);
      setReaderNotFound("");
      setReaderClosing(false);
      setView("journey");
      restorePageScroll(scrollY);
      if (window.history.state?.interviewArcJourneyReader && depth > 0) window.history.go(-depth);
      else {
        window.history.replaceState(
          {
            interviewArcWorkspaceView: "journey",
            interviewArcJourneyDepth: 0,
            interviewArcJourneyScrollY: scrollY,
          },
          "",
          closePlan.href,
        );
      }
      return;
    }
    if (view === "library" && !libraryNestedProblem && closePlan?.view === "past") {
      window.sessionStorage.removeItem("interview-arc-selected-past");
      const depth = Number(window.history.state?.interviewArcPastDepth ?? 0);
      const position = listPositionMemoryRef.current.library.main;
      pendingListRestoreRef.current = { surface: "library", ...position };
      setListRestoring("library");
      setSelectedEntry(null);
      setPastReaderOrderIds([]);
      setJourneyReaderOrderIds([]);
      setReaderNotFound("");
      setReaderClosing(false);
      if (window.history.state?.interviewArcPastReader && depth > 0) window.history.go(-depth);
      else {
        window.history.replaceState(
          { interviewArcWorkspaceView: "past", interviewArcPastDepth: 0 },
          "",
          closePlan.href,
        );
      }
      return;
    }
    if (readerCloseTimerRef.current !== null) window.clearTimeout(readerCloseTimerRef.current);
    const finishClose = () => {
      if (view === "library" && libraryNestedProblem) {
        setLibraryNestedProblem(null);
        setReaderClosing(false);
        readerCloseTimerRef.current = null;
        return;
      }
      if (view === "banks" && bankNestedEntry) {
        setBankNestedEntry(null);
        setReaderClosing(false);
        readerCloseTimerRef.current = null;
        return;
      }
      if (view === "library") {
        const position = listPositionMemoryRef.current.library.main;
        window.sessionStorage.removeItem("interview-arc-selected-past");
        pendingListRestoreRef.current = { surface: "library", ...position };
        setListRestoring("library");
        setSelectedEntry(null);
        setReaderClosing(false);
      }
      if (view === "banks") {
        const position = listPositionMemoryRef.current.banks.main;
        window.sessionStorage.removeItem("interview-arc-selected-bank");
        pendingListRestoreRef.current = { surface: "banks", ...position };
        setListRestoring("banks");
        setSelectedProblem(null);
        setReaderClosing(false);
      }
      readerCloseTimerRef.current = null;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    setReaderClosing(true);
    readerCloseTimerRef.current = window.setTimeout(finishClose, 190);
  }

  function renderCaseReader() {
    const selectedEntry = readerSelectedEntry;
    if (!selectedEntry) return null;
    return (
      <article className={`workspace-reader journal-case-reader ${nestedReaderFocus ? "nested-reader" : ""}`} aria-labelledby="journal-reader-title" aria-label="Case file contents">
        <div className="reader-chrome">
          <div className="reader-chrome-leading">{!nestedReaderFocus && <button type="button" className={`master-pane-toggle icon-action ${masterPaneOpen ? "active" : ""}`} onClick={toggleMasterPane} aria-expanded={masterPaneOpen} aria-label={masterPaneOpen ? "Hide problem list" : "Show problem list"} title={masterPaneOpen ? "Hide problem list" : "Show problem list"}><Icon name="sidebar" /></button>}<ReaderOutline><a href="#case-summary">Overview</a>{Boolean(selectedEntry.personalNote?.trim() || selectedEntry.pinnedNotes?.length) && <a href="#case-notes">Notes</a>}<a href="#case-facts">Timeline</a>{selectedCaseGroups.filter((group) => group.key === "record").map((group) => <div className="toc-group" key={group.key}><a className="toc-parent" href={`#case-group-${group.key}`}>{group.title}</a>{group.sections.map((section, index) => <a className="toc-child" key={`${section.title}-${index}`} href={`#case-${slugify(section.title)}-${index}`}>{section.title}</a>)}</div>)}{selectedEntryTurns.length > 0 && <div className="toc-group"><a className="toc-parent" href="#case-transcript">Conversation</a><a className="toc-child" href="#case-transcript-thread">Transcript and recordings</a></div>}{selectedEntryFinalAnswer && <a href="#case-final-answer">Final tailored answer</a>}{selectedEntryResumeContext && <a href="#case-resume-context">Resume context</a>}{selectedEntryPracticeScenarios && <a href="#case-practice-scenarios">Practice scenarios</a>}{selectedEntryBehavioralAnalysis && <a href="#case-behavioral-analysis">Behavioral Attempt</a>}{selectedCaseGroups.filter((group) => group.key !== "record").map((group) => <div className="toc-group" key={group.key}><a className="toc-parent" href={`#case-group-${group.key}`}>{group.title}</a>{group.sections.map((section, index) => <a className="toc-child" key={`${section.title}-${index}`} href={`#case-${slugify(section.title)}-${index}`}>{section.title}</a>)}</div>)}</ReaderOutline></div>
          <div className="reader-chrome-actions">{readerNavigationIndex >= 0 && <div className="reader-attempt-navigation" aria-label="Past practice records"><button type="button" onClick={() => navigateReaderEntry(readerNavigationEntries[readerNavigationIndex - 1])} disabled={readerNavigationIndex <= 0} aria-label="Previous practice record" title={readerNavigationIndex <= 0 ? "First record in this list" : "Previous practice record"}>←</button><span>{readerNavigationIndex + 1} / {readerNavigationEntries.length}</span><button type="button" onClick={() => navigateReaderEntry(readerNavigationEntries[readerNavigationIndex + 1])} disabled={readerNavigationIndex >= readerNavigationEntries.length - 1} aria-label="Next practice record" title={readerNavigationIndex >= readerNavigationEntries.length - 1 ? "Last record in this list" : "Next practice record"}>→</button></div>}<button className="icon-action" onClick={() => setEveryReaderGroup(false)} aria-label="Collapse all sections" title="Collapse all"><Icon name="minus" /></button><button className="icon-action" onClick={() => setEveryReaderGroup(true)} aria-label="Expand all sections" title="Expand all"><Icon name="plus" /></button><button className="reader-close icon-action" onClick={closeReaderPanel} aria-label="Close case file" title="Close"><Icon name="close" /></button></div>
        </div>
        <div className="case-document workspace-reader-scroll" ref={readerDocumentRef} onScroll={rememberReaderPosition} onMouseUp={(event) => captureHighlightSelection(event.clientX, event.clientY)} onKeyUp={() => captureHighlightSelection()}>
          <header id="case-summary"><div><span className={`type-chip ${selectedEntry.type}`}>{typeLabel(selectedEntry.type)}</span><CaseModeTags snapshot={selectedEntry.interactionModeClassification} /><time>{readableDate(selectedEntry.date)} · Pacific</time></div><div className="case-title-row"><h2 id="journal-reader-title">{selectedEntry.title}</h2><div className="case-title-actions"><button className={`star-control ${isStarred(selectedEntry.type, selectedEntry.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(selectedEntry.type, selectedEntry.questionId)} disabled={!selectedEntry.questionId} aria-label={`${isStarred(selectedEntry.type, selectedEntry.questionId) ? "Unstar" : "Star"} ${selectedEntry.title}`} title="Star this problem"><Icon name="star" /></button><button className="icon-action note-add" onClick={() => openNoteComposer()} disabled={!selectedEntryActivityId} aria-label="Add a note" title="Add a note"><Icon name="note" /><i><Icon name="plus" /></i></button></div></div>{meaningfulSubtitle(selectedEntry.subtitle) && <p>{meaningfulSubtitle(selectedEntry.subtitle)}</p>}{Boolean(bankQuestionForEntry(selectedEntry) && hasReusableSolution(selectedEntry.type, bankQuestionForEntry(selectedEntry)!)) && <button className="solution-link-button" onClick={() => openEntrySolution(selectedEntry)}>Open reusable solution →</button>}</header>
          {Boolean(selectedEntry.personalNote?.trim() || selectedEntry.pinnedNotes?.length) && <aside className="pinned-notes" id="case-notes" aria-label="Pinned practice notes"><span>NOTES</span>{selectedEntry.personalNote?.trim() && <article><div className="note-actions"><button onClick={() => openNoteComposer("personal")} aria-label="Edit personal note" title="Edit"><Icon name="edit" /></button><button onClick={() => void deleteCaseNote("personal")} aria-label="Delete personal note" title="Delete"><Icon name="trash" /></button></div><MarkdownBody source={selectedEntry.personalNote} /></article>}{selectedEntry.pinnedNotes?.map((note) => <article key={note.id}><header><small>{note.kind}</small><div className="note-actions"><button onClick={() => openNoteComposer(note)} aria-label={`Edit ${note.kind} note`} title="Edit"><Icon name="edit" /></button><button onClick={() => void deleteCaseNote(note.id)} aria-label={`Delete ${note.kind} note`} title="Delete"><Icon name="trash" /></button></div></header><MarkdownBody source={note.body} /></article>)}</aside>}
          {noteComposerOpen && <form className="case-note-composer" onSubmit={(event) => { event.preventDefault(); void saveCaseNote(); }}><label htmlFor="case-note">{editingNoteId ? "Edit note" : "Add a note"}</label><textarea id="case-note" autoFocus value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="A concise reminder, mistake, or pattern to keep visible…" /><div><button type="button" onClick={() => { setNoteComposerOpen(false); setEditingNoteId(""); setNoteDraft(""); }}>Cancel</button><button type="submit" disabled={noteBusy || !noteDraft.trim()}>{noteBusy ? "Saving…" : "Save note"}</button></div></form>}
          <div className="letter-facts" id="case-facts"><div><span>Status</span><strong>{selectedEntry.status}</strong></div><div><span>Time recorded</span><strong>{selectedEntry.elapsedSeconds ? formatClock(selectedEntry.elapsedSeconds) : "Not recorded"}</strong></div>{selectedEntry.startedAt && <div><span>Started</span><strong>{formatPracticeTimestamp(selectedEntry.startedAt)}</strong></div>}{selectedEntry.endedAt && <div><span>Finished</span><strong>{formatPracticeTimestamp(selectedEntry.endedAt)}</strong></div>}{selectedEntry.sessionId && <div><span>Session</span><strong>{selectedEntry.sessionId}</strong></div>}{selectedEntry.outcome && <div><span>Result</span><strong>{resultLabel(selectedEntry.outcome, selectedEntry.type)}</strong></div>}{selectedEntry.review && <div className="review-fact"><span>{selectedEntry.review.status === "due" ? "Review due" : "Next review"}</span><strong>{selectedEntry.review.dueDate}</strong><small>{selectedEntry.review.reason.replaceAll("_", " ")} · {selectedEntry.review.intervalDays} day interval</small></div>}</div>
          <div className="letter-sections layered-reader">
            {selectedEntry.artifact
              ? selectedCaseGroups.filter((group) => group.key === "record").map((group) => { const groupId = `case-group-${group.key}`; return <details className="reader-group record-group" id={groupId} open={readerGroupOpen(groupId, true)} onToggle={(event) => rememberReaderGroup(groupId, event.currentTarget.open)} key={group.key}><summary><span>{group.title}</span><small>{group.sections.length} section{group.sections.length === 1 ? "" : "s"}</small></summary><div><ReaderGroupSections sections={group.sections} idPrefix="case" coding={selectedEntry.type === "leetcode"} /></div></details>; })
              : <div className="unpublished-letter" id="case-draft"><span className="eyebrow">D1 DRAFT · NOT YET IN THE JOURNAL</span><h3>The attempt is saved; its case file is still waiting for finalization.</h3><p>The coordinator will ask the matching specialist to finalize the transcript, review, solution, and consulted references. No unrelated task conversation is included.</p>{selectedEntry.finalization && <p><strong>Specialist bundle:</strong> {selectedEntry.finalization.status}</p>}{selectedEntry.url && <a href={selectedEntry.url} target="_blank" rel="noreferrer">Open original problem ↗</a>}</div>}
            {orderPastReaderSections({
              conversation: selectedEntryTurns.length > 0 ? <details className="reader-group conversation-group" id="case-transcript" open={readerGroupOpen("case-transcript", false)} onToggle={(event) => rememberReaderGroup("case-transcript", event.currentTarget.open)} key="conversation"><summary><span>Conversation</span><small>{selectedEntryTurns.length} exchange{selectedEntryTurns.length === 1 ? "" : "s"} · recordings inline</small></summary><div id="case-transcript-thread"><ActivityTranscript turns={selectedEntryTurns} clips={selectedEntryClips} deliveryAnalyses={selectedEntryDeliveryAnalyses} codeAttempts={selectedEntryCodeAttempts} modeTransitions={selectedEntryModeTransitions} /></div></details> : null,
              finalAnswer: selectedEntryFinalAnswer ? <details className="reader-group final-answer-group" id="case-final-answer" open={readerGroupOpen("case-final-answer", true)} onToggle={(event) => rememberReaderGroup("case-final-answer", event.currentTarget.open)} key="final-answer"><summary><span>Final tailored answer</span><small>{selectedEntryFinalAnswer.source === "snapshot_v1" ? `Immutable snapshot ${selectedEntryFinalAnswer.snapshotRevision}` : "Legacy fallback"}</small></summary><div><FinalAnswerCard finalAnswer={selectedEntryFinalAnswer} /></div></details> : null,
              resumeContext: selectedEntryResumeContext ? <details className="reader-group resume-context-group" id="case-resume-context" open={readerGroupOpen("case-resume-context", true)} onToggle={(event) => rememberReaderGroup("case-resume-context", event.currentTarget.open)} key="resume-context"><summary><span>Resume context</span><small>Exact owner-private revision used by this answer</small></summary><div><ResumeContextCard context={selectedEntryResumeContext} /></div></details> : null,
              practiceScenarios: selectedEntryPracticeScenarios ? <details className="reader-group practice-scenarios-group" id="case-practice-scenarios" open={readerGroupOpen("case-practice-scenarios", false)} onToggle={(event) => rememberReaderGroup("case-practice-scenarios", event.currentTarget.open)} key="practice-scenarios"><summary><span>Practice scenarios</span><small>{selectedEntryPracticeScenarios.scenarios.length} labeled exercise{selectedEntryPracticeScenarios.scenarios.length === 1 ? "" : "s"}</small></summary><div><PracticeScenariosCard projection={selectedEntryPracticeScenarios} /></div></details> : null,
              behavioralAnalysis: selectedEntryBehavioralAnalysis ? <details className="reader-group behavioral-analysis-group" id="case-behavioral-analysis" open={readerGroupOpen("case-behavioral-analysis", true)} onToggle={(event) => rememberReaderGroup("case-behavioral-analysis", event.currentTarget.open)} key="behavioral-analysis"><summary><span>Behavioral Attempt</span><small>Claim audit · coaching · next drill</small></summary><div><BehavioralAttemptAnalysisCard projection={selectedEntryBehavioralAnalysis} /></div></details> : null,
              codeAttempts: selectedEntryCodeAttempts.length > 0 ? <details className="reader-group code-attempts-group" id="case-code-attempts" open={readerGroupOpen("case-code-attempts", true)} onToggle={(event) => rememberReaderGroup("case-code-attempts", event.currentTarget.open)} key="code-attempts"><summary><span>User Code Attempts</span><small>{selectedEntryCodeAttempts.length} version{selectedEntryCodeAttempts.length === 1 ? "" : "s"}</small></summary><div>{selectedEntryCodeAttempts.map((attempt) => <article className="code-attempt-card" key={attempt.id}><header><strong>Code Attempt {attempt.sequence} · {attempt.language}</strong><span>{attempt.lineCount} lines</span></header><CodeAttemptBody attempt={attempt} /></article>)}</div></details> : null,
              reviewSections: selectedEntry.artifact ? selectedCaseGroups.filter((group) => group.key !== "record").map((group) => { const groupId = `case-group-${group.key}`; return <details className={`reader-group ${group.key}-group`} id={groupId} open={readerGroupOpen(groupId, group.key !== "conversation")} onToggle={(event) => rememberReaderGroup(groupId, event.currentTarget.open)} key={group.key}><summary><span>{group.title}</span><small>{group.sections.length} section{group.sections.length === 1 ? "" : "s"}</small></summary><div><ReaderGroupSections sections={group.sections} idPrefix="case" coding={selectedEntry.type === "leetcode"} /></div></details>; }) : [],
            })}
          </div>
          <footer>Interview Arc · {selectedEntry.id}</footer>
        </div>
        {renderAnnotationPopover()}
      </article>
    );
  }

  function renderSolutionReader() {
    const selectedProblem = readerSelectedProblem;
    if (!selectedProblem) return null;
    return (
      <article className={`workspace-reader knowledge-reader ${nestedReaderFocus ? "nested-reader" : ""}`} aria-labelledby="solution-profile-title">
        <div className="reader-chrome"><div className="reader-chrome-leading">{!nestedReaderFocus && <button type="button" className={`master-pane-toggle icon-action ${masterPaneOpen ? "active" : ""}`} onClick={toggleMasterPane} aria-expanded={masterPaneOpen} aria-label={masterPaneOpen ? "Hide problem list" : "Show problem list"} title={masterPaneOpen ? "Hide problem list" : "Show problem list"}><Icon name="sidebar" /></button>}<ReaderOutline><a href="#solution-profile-summary">Overview</a>{selectedSolutionGroups.map((group) => <div className="toc-group" key={group.key}><a className="toc-parent" href={`#solution-group-${group.key}`}>{group.title}</a>{group.sections.map((section, index) => <a className="toc-child" key={`${section.title}-${index}`} href={`#solution-${slugify(section.title)}-${index}`}>{section.title}</a>)}</div>)}<a href="#solution-attempts">Past attempts</a></ReaderOutline></div><div className="reader-chrome-actions"><button className="icon-action" onClick={() => setEveryReaderGroup(false)} aria-label="Collapse all sections" title="Collapse all"><Icon name="minus" /></button><button className="icon-action" onClick={() => setEveryReaderGroup(true)} aria-label="Expand all sections" title="Expand all"><Icon name="plus" /></button><button className="reader-close icon-action" onClick={closeReaderPanel} aria-label="Close solution profile" title="Close"><Icon name="close" /></button></div></div>
        <div className="case-document solution-profile-document workspace-reader-scroll" ref={readerDocumentRef} onScroll={rememberReaderPosition} onMouseUp={(event) => captureHighlightSelection(event.clientX, event.clientY)} onKeyUp={() => captureHighlightSelection()}>
          <header id="solution-profile-summary"><div><span className={`type-chip ${selectedProblem.type}`}>{typeLabel(selectedProblem.type)}</span><span className="profile-revision">{selectedProblemProfileReusable ? `Solution revision ${selectedProblemProfile!.currentRevision}` : selectedProblemProfile ? "Solution incomplete" : "No solution yet"}</span><button className={`star-control ${isStarred(selectedProblem.type, selectedProblem.question.id) ? "starred" : ""}`} onClick={() => toggleProblemStar(selectedProblem.type, selectedProblem.question.id)} aria-label={`${isStarred(selectedProblem.type, selectedProblem.question.id) ? "Unstar" : "Star"} ${selectedProblem.question.title}`}><Icon name="star" /></button></div><h2 id="solution-profile-title">{selectedProblem.question.title}</h2><p>{selectedProblemProfileReusable ? selectedProblemProfile!.payload.summary : selectedProblem.question.prompt ?? "Finish and finalize an attempt to build this reusable Solution Profile."}</p></header>
          <div className="profile-tags">{[...new Set([...selectedProblem.question.topics, ...(selectedProblem.question.tags ?? []), ...(selectedProblemProfileReusable ? selectedProblemProfile?.tags ?? [] : [])])].map((tag) => <span key={tag}>{tag}</span>)}</div>
          {selectedProblemProfileReusable && selectedProblemProfile?.payload.behavioralAnswer && <section className="canonical-answer-card"><span className="eyebrow">YOUR PREFERRED ANSWER</span><h3>{selectedProblemProfile.payload.behavioralAnswer.preferred.label}</h3><MarkdownBody source={selectedProblemProfile.payload.behavioralAnswer.preferred.answer} />{selectedProblemProfile.payload.behavioralAnswer.preferred.evidence.length > 0 && <div className="answer-evidence"><strong>Verified evidence</strong><ul>{selectedProblemProfile.payload.behavioralAnswer.preferred.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selectedProblemProfile.payload.behavioralAnswer.preferred.evidenceGaps.length > 0 && <div className="answer-gaps"><strong>Evidence still needed</strong><ul>{selectedProblemProfile.payload.behavioralAnswer.preferred.evidenceGaps.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selectedProblemProfile.payload.behavioralAnswer.alternatives.length > 0 && <details className="answer-alternatives"><summary>{selectedProblemProfile.payload.behavioralAnswer.alternatives.length} alternative story {selectedProblemProfile.payload.behavioralAnswer.alternatives.length === 1 ? "variant" : "variants"}</summary>{selectedProblemProfile.payload.behavioralAnswer.alternatives.map((variant) => <article key={variant.label}><h4>{variant.label}</h4>{variant.whenToUse && <small>Best when: {variant.whenToUse}</small>}<MarkdownBody source={variant.answer} /></article>)}</details>}</section>}
          {selectedProblemPracticeScenarios && <PracticeScenariosCard projection={selectedProblemPracticeScenarios} />}
          {selectedProblemProfileReusable ? <div className="letter-sections solution-sections layered-reader">{selectedSolutionGroups.map((group) => { const groupId = `solution-group-${group.key}`; return <SolutionReaderGroup group={group} idPrefix="solution" coding={selectedProblem.type === "leetcode"} open={readerGroupOpen(groupId, group.key !== "conversation")} onToggle={(open) => rememberReaderGroup(groupId, open)} key={group.key} />; })}</div> : <div className="unpublished-letter"><span className="eyebrow">KNOWLEDGE PROFILE</span><h3>{selectedProblemProfile ? "This saved solution is incomplete." : "This problem has no finalized solution yet."}</h3><p>{selectedProblemProfile ? "Interview Arc will not label or open it as reusable until a new validated revision contains the complete reference answer." : "The matching specialist creates it when a completed attempt is finalized. Past keeps the transcript; this reader keeps the reusable answer."}</p></div>}
          <section className="attempt-history" id="solution-attempts"><span className="eyebrow">PAST ATTEMPTS</span>{selectedProblemAttempts.length ? selectedProblemAttempts.map((entry) => <button key={entry.id} onClick={() => openAttemptFromSolution(entry)}><span>{readableDate(entry.date, true)}</span><strong>{resultLabel(entry.outcome, entry.type)}</strong><small>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "No timer"} · Read case →</small></button>) : <p>No completed attempt is linked yet.</p>}</section>
          {selectedProblemRevisions.length > 1 && <section className="revision-history"><span className="eyebrow">SOLUTION HISTORY</span><p>{selectedProblemRevisions.length} immutable revisions are linked to past attempts. The profile above is the current revision.</p></section>}
          {selectedProblemProfileReusable && selectedProblemProfile?.payload.references.length ? <section className="profile-references"><span className="eyebrow">REFERENCES CONSULTED</span>{selectedProblemProfile.payload.references.map((reference) => <a key={`${reference.url}-${reference.accessedAt}`} href={reference.url} target="_blank" rel="noreferrer">{reference.title} ↗<small>{reference.accessedAt}</small></a>)}</section> : null}
          <footer>Interview Arc · {selectedProblem.type}:{selectedProblem.question.id}</footer>
        </div>
        {renderAnnotationPopover()}
      </article>
    );
  }

  function renderLifecycleDialog() {
    if (!lifecycleDialog) return null;
    const session = "sessionId" in lifecycleDialog
      ? allSessions.find((candidate) => candidate.id === lifecycleDialog.sessionId)
      : undefined;
    const content = lifecycleDialog.kind === "session-results"
        ? {
          eyebrow: "RESULTS REQUIRED",
          title: "Finish the missing results",
          description: `${lifecycleDialog.missingCount} started ${lifecycleDialog.missingCount === 1 ? "activity needs" : "activities need"} a result before ${session?.label ?? "this session"} can close.`,
        }
        : lifecycleDialog.kind === "workbench-results"
          ? {
            eyebrow: "RESULTS REQUIRED",
            title: "Finish the missing results",
            description: `${lifecycleDialog.missingCount} started ${lifecycleDialog.missingCount === 1 ? "activity needs" : "activities need"} a result before you can start a fresh workbench.`,
          }
        : lifecycleDialog.kind === "finish-session"
          ? {
            eyebrow: "FINISH PRACTICE SESSION",
            title: `Finish ${session?.label ?? "this session"}?`,
            description: "Every started activity timer will close now. Never-started activities remain not attempted and cannot be started after the session is finished.",
          }
          : {
            eyebrow: "REMOVE UNTOUCHED SESSION",
            title: `Remove ${session?.label ?? "this session"}?`,
            description: "The untouched session and its planned activities will return to the question pool.",
          };
    const destructiveAction = lifecycleDialog.kind === "finish-session"
      ? () => finishSessionTimer(lifecycleDialog.sessionId)
      : lifecycleDialog.kind === "remove-session"
        ? () => confirmRemoveSession(lifecycleDialog.sessionId)
        : null;
    return <div className="modal-backdrop" role="presentation" onMouseDown={() => setLifecycleDialog(null)}>
      <section className="confirmation-dialog lifecycle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lifecycle-dialog-title" aria-describedby="lifecycle-dialog-description" onMouseDown={(event) => event.stopPropagation()}>
        <span className="eyebrow">{content.eyebrow}</span>
        <h2 id="lifecycle-dialog-title">{content.title}</h2>
        <p id="lifecycle-dialog-description">{content.description}</p>
        <div className="confirmation-actions">
          {destructiveAction ? <button className="secondary-action" onClick={() => setLifecycleDialog(null)}>Keep working</button> : null}
          <button className={destructiveAction ? "primary-action" : "secondary-action"} onClick={destructiveAction ?? (() => setLifecycleDialog(null))}>
            {lifecycleDialog.kind === "finish-session" ? "Finish session" : lifecycleDialog.kind === "remove-session" ? "Remove session" : "Review results"}
          </button>
        </div>
      </section>
    </div>;
  }

  return (
    <>
    {chartTooltip && <ChartTooltip model={chartTooltip} onDismiss={() => setChartTooltip(null)} />}
    <main className={`app-shell active-view-${view}`} aria-hidden={arrivalState !== "entered"}>
      <a className="skip-link" href="#practice-content">Skip to practice</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigateToPrimaryView("today")}><span className="brand-mark" aria-hidden="true" /><span>Interview Arc</span></button>
        <nav className="workspace-nav" aria-label="Workspaces">
          <button type="button" className={view !== "learn" ? "active" : ""} aria-current={view !== "learn" ? "page" : undefined} onClick={() => navigateToPrimaryView("today")}><span aria-hidden="true">I</span><strong>Interview</strong></button>
          <button type="button" className={view === "learn" ? "active learn" : "learn"} aria-current={view === "learn" ? "page" : undefined} onClick={() => navigateToLearn(learnDestination)}><span aria-hidden="true">L</span><strong>Learn</strong></button>
          <button type="button" disabled title="Engineering workspace is coming later"><span aria-hidden="true">E</span><strong>Engineering</strong><small>Later</small></button>
        </nav>
        <div className="local-nav-label"><span>{view === "learn" ? "Learn" : "Interview"}</span><small>Workspace</small></div>
        {view === "learn"
          ? <nav className="primary-nav learn-local-nav" aria-label="Learn navigation">{LEARN_NAV_ITEMS.map(([id, label], index) => <button key={id} className={learnDestination === id ? "active" : ""} aria-current={learnDestination === id ? "page" : undefined} onClick={() => navigateToLearn(id)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
          : <><nav className="primary-nav" aria-label="Interview navigation">{INTERVIEW_NAV_ITEMS.map(([id, label], index) => <button key={id} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => navigateToPrimaryView(id)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav><nav className="materials-nav" aria-label="Career Materials navigation"><button type="button" className={view === "materials" ? "active" : ""} aria-current={view === "materials" ? "page" : undefined} onClick={() => navigateToPrimaryView("materials")}><span aria-hidden="true">CM</span><strong>Career Materials</strong><small>Private</small></button></nav></>}
        <div className="sidebar-status"><span className={view !== "learn" && [...Object.values(draft.timers), ...Object.values(draft.sessionTimers)].some((timer) => timer.runningSince) ? "live" : ""} /><div><strong>{view === "learn" ? "Private Learning record" : [...Object.values(draft.timers), ...Object.values(draft.sessionTimers)].some((timer) => timer.runningSince) ? "Timer running" : hydrated ? "Draft saved locally" : "Loading draft"}</strong><small>{view === "learn" ? "Transcript-only sessions · no cloud audio" : "Session countdown + one activity stopwatch"}</small></div></div>
        <div className="profile"><span>IA</span><div><strong>Interview Arc owner</strong><small>Private preparation record</small></div></div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="topbar-context"><strong>{view === "learn" ? LEARN_VIEW_TITLES[learnDestination] : INTERVIEW_VIEW_TITLES[view]}</strong><span>{readableDate(journal.date)}</span></div>
          <div>
            <div className={`music-dock ${ambientPlaying ? "active" : ""}`}>
              <button onClick={toggleAmbientSound} aria-pressed={ambientPlaying} title={ambientPlaying ? "Pause music" : "Play music"}><span aria-hidden="true">{ambientPlaying ? "Ⅱ" : "▶"}</span><i><small>{ambientPlaying ? "PLAYING" : "PAUSED"}</small><strong>{trackName}</strong></i></button>
              <button className="music-next" onClick={previousAmbientTrack} aria-label="Previous music track" title={`Previous track · ${trackArtist}`}>↞</button>
              <button className="music-next" onClick={nextAmbientTrack} aria-label="Next music track" title={`Next track · ${trackArtist}`}>↠</button>
              <label><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} aria-label="Music volume" /></label>
              <MusicPlaylist playlist={ambientPlaylist} currentIndex={ambientTrackIndex} onSelect={chooseAmbientTrack} />
            </div>
            <button className={`atmosphere-toggle ${petalsEnabled ? "active" : ""}`} onClick={togglePetals} aria-pressed={petalsEnabled} title={petalsEnabled ? "Pause cherry blossoms" : "Resume cherry blossoms"}><span aria-hidden="true">✦</span>Petals</button>
            {view === "today" && pipSupported && <button className={`secondary-action pip-toggle ${pipWindow && !pipWindow.closed ? "active" : ""}`} onClick={openNowWindow} aria-pressed={Boolean(pipWindow && !pipWindow.closed)}>{pipWindow && !pipWindow.closed ? "Close timer" : "Pop out timer"}</button>}
            <button className="secondary-action" onClick={() => setIntegrationOpen(true)}>Connect</button>
            {view !== "learn" && <button className="secondary-action" onClick={() => void exportDraft()}>Export today</button>}
          </div>
        </header>
        <div className="page-content" id="practice-content">{view === "today" && renderToday()}{view === "loops" && <LoopsWorkspace onOpenActivity={openLoopActivity} />}{view === "journey" && renderJourney()}{view === "reviews" && renderReviewQueue()}{view === "library" && renderLibrary()}{view === "banks" && renderBanks()}{view === "materials" && <CareerMaterialsWorkspace />}{view === "learn" && <LearnWorkspace destination={learnDestination} />}</div>
      </section>

      {view === "learn"
        ? <nav className="mobile-interview-nav mobile-learn-nav" aria-label="Learn navigation">{LEARN_NAV_ITEMS.map(([id, label]) => <button key={id} type="button" className={learnDestination === id ? "active" : ""} aria-current={learnDestination === id ? "page" : undefined} onClick={() => navigateToLearn(id)}>{label}</button>)}</nav>
        : <nav className="mobile-interview-nav" aria-label="Interview navigation">{INTERVIEW_NAV_ITEMS.map(([id, label]) => <button key={id} type="button" className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => navigateToPrimaryView(id)}>{label}</button>)}<button type="button" className={view === "materials" ? "active materials" : "materials"} aria-current={view === "materials" ? "page" : undefined} onClick={() => navigateToPrimaryView("materials")}>Materials</button></nav>}

      {composer.open && <div className={`modal-backdrop ${composerClosing ? "closing" : ""}`} role="presentation" onMouseDown={closeComposer} onAnimationEnd={finishComposerClose}>
        <section className={`composer ${composer.mode === "activity" && !composer.editingId ? "activity-composer-dialog" : ""} ${composerClosing ? "closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="composer-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={closeComposer} aria-label="Close">×</button>
          <span className="eyebrow">BUILD TODAY&apos;S WORK</span>
          <h2 id="composer-title">{composer.editingSessionId ? "Edit session recipe" : composer.editingId ? "Edit this activity" : composer.mode === "session" ? "Build another session" : "Add activities"}</h2>
          {!composer.editingId && !composer.editingSessionId && <div className="composer-mode">
            <button className={composer.mode === "session" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, mode: "session" }))}>Full session</button>
            <button className={composer.mode === "activity" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, mode: "activity" }))}>Activities</button>
          </div>}
          <AnimatedComposerStage motionKey={composer.mode}>
          {composer.mode === "session" && !composer.editingId ? <div className="session-composer">
            <p>Shape the session you need. The default is six coding problems, one system-design mock, and one behavioral mock. When available, Interview Arc places up to two due reviews first and fills the remaining slots with new bank questions.</p>
            {bankFor("behavioral").filter(isResumeCurriculumQuestion).length === 0 && <div className="resume-setup-warning"><strong>Résumé foundation is not ready yet.</strong><span>Interview Arc will not substitute a random behavioral prompt. Connect the Behavioral specialist once to build the private résumé curriculum.</span></div>}
            <div className="session-recipe" aria-label="Session recipe">
              <SessionCountControl label="Coding" mark="C" value={composer.sessionCoding} minutesEach={CODING_SESSION_MINUTES} max={sessionAvailability.coding} onChange={(value) => setComposer((current) => ({ ...current, sessionCoding: value }))} />
              <SessionCountControl label="System design" mark="S" value={composer.sessionSystemDesign} minutesEach={INTERVIEW_SESSION_MINUTES} max={sessionAvailability.systemDesign} onChange={(value) => setComposer((current) => ({ ...current, sessionSystemDesign: value }))} />
              <SessionCountControl label="Behavioral" mark="B" value={composer.sessionBehavioral} minutesEach={INTERVIEW_SESSION_MINUTES} max={sessionAvailability.behavioral} onChange={(value) => setComposer((current) => ({ ...current, sessionBehavioral: value }))} />
            </div>
            <div className="session-total-strip">
              <div><span>SESSION COUNTDOWN</span><small>{composer.sessionCoding * CODING_SESSION_MINUTES}m coding + {composer.sessionSystemDesign * INTERVIEW_SESSION_MINUTES}m system design + {composer.sessionBehavioral * INTERVIEW_SESSION_MINUTES}m behavioral</small></div>
              <strong>{formatDuration(sessionTotalSeconds)}</strong>
            </div>
            <small>{sessionAvailability.coding} coding, {sessionAvailability.systemDesign} system-design, and {sessionAvailability.behavioral} behavioral questions are available after today&apos;s other picks. A recipe locks once its timer, activity work, or completion begins.</small>
            <button className="primary-action full-width" onClick={saveFullSession} disabled={!canSaveSession}>{composer.editingSessionId ? "Save session recipe" : `Add session ${allSessions.length + 1}`}</button>
          </div> : <form className={`multi-activity-composer ${composer.customOpen || composer.reviewOpen ? "expanded-details" : ""}`} onSubmit={saveActivity}>
            <div className="type-selector" role="group" aria-label="Practice type">{(["leetcode", "system_design", "behavioral"] as const).map((type) => <button type="button" key={type} className={`${type} ${composer.type === type ? "active" : ""}`} onClick={() => switchComposerType(type)}>{typeLabel(type)}{composer.selectedActivities.some((item) => item.type === type) && <small>{composer.selectedActivities.filter((item) => item.type === type).length}</small>}</button>)}</div>
            <div
              className={`career-quick-add ${composer.focusSelected ? "selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={composer.focusSelected}
              onClick={() => setComposer((current) => ({ ...current, focusSelected: !current.focusSelected }))}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setComposer((current) => ({ ...current, focusSelected: !current.focusSelected }));
                }
              }}
            >
              <span className="career-focus-mark" aria-hidden="true">J</span>
              <span><strong>Job applications</strong><small>Career focus · time only · no result or publication</small></span>
              <span className="career-quick-add-controls">
                <label
                  className="career-duration-control"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={composer.focusMinutes}
                    onChange={(event) => setComposer((current) => ({ ...current, focusMinutes: event.target.value, focusSelected: true }))}
                    aria-label="Planned minutes"
                  />
                  <span aria-hidden="true">min</span>
                </label>
                <i aria-hidden="true">{composer.focusSelected ? "Selected" : "Add"}</i>
              </span>
            </div>
            <div className="activity-picker-toolbar">
              <div className="activity-picker-heading"><span>Search this specialty, then keep selecting across searches and tabs.</span>{hasComposerFilters && <button type="button" className="filter-clear" onClick={clearComposerFilters}>Clear</button>}<div className="bank-icon-tools activity-picker-tools"><button type="button" className={`collection-toggle icon-tool ${composerStarFilter ? "active" : ""}`} onClick={toggleComposerStarFilter} aria-pressed={composerStarFilter} aria-label={composerStarFilter ? "Show all questions" : "Show starred questions"} title={composerStarFilter ? "Showing starred questions" : "Show starred questions"}><Icon name="star" /></button><details className={`control-menu icon-menu ${activeComposerFilterCount > 0 ? "active" : ""}`}><summary aria-label={`Activity filters${activeComposerFilterCount ? `, ${activeComposerFilterCount} active` : ""}`} title={`${activeComposerFilterCount || "No"} active filters`}><Icon name="filter" />{activeComposerFilterCount > 0 && <i>{activeComposerFilterCount}</i>}</summary><div className="control-popover compact-filter-popover activity-filter-menu"><div className="compact-filter-group review" role="group" aria-label="Review filters">{([['due', 'Due now'], ['needs_review', 'Needs review']] as const).map(([filter, label]) => <button type="button" key={filter} className={composerAttentionFilters.includes(filter) ? "active" : ""} aria-pressed={composerAttentionFilters.includes(filter)} onClick={() => toggleComposerAttentionFilter(filter)}><span>{label}</span><small>{composerAttentionCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div><div className="compact-filter-group result" role="group" aria-label="Result filters">{([['solved', 'Solved'], ['helped', 'Solved with help'], ['failed', 'Failed'], ['todo', 'To do']] as const).map(([filter, label]) => <button type="button" key={filter} className={composerAttentionFilters.includes(filter) ? "active" : ""} aria-pressed={composerAttentionFilters.includes(filter)} onClick={() => toggleComposerAttentionFilter(filter)}><span>{label}</span><small>{composerAttentionCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div><div className="compact-filter-group difficulty" role="group" aria-label="Difficulty filters">{(["easy", "medium", "hard"] as const).map((filter) => <button type="button" key={filter} className={composerLevelFilters.includes(filter) ? "active" : ""} aria-pressed={composerLevelFilters.includes(filter)} onClick={() => toggleComposerLevelFilter(filter)}><span>{filter[0].toUpperCase() + filter.slice(1)}</span><small>{composerLevelCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div></div></details><details className="control-menu sort-menu icon-menu"><summary aria-label={`Sort by ${activeComposerSort.label}, ${composerSortDir === "asc" ? "ascending" : "descending"}`} title={`Sort: ${activeComposerSort.label} · ${composerSortDir === "asc" ? "low to high" : "high to low"}`}><span className={`bank-sort-glyph ${activeComposerSort.icon}`} aria-hidden="true" /><small className="sort-direction-badge" aria-hidden="true">{composerSortDir === "asc" ? "↑" : "↓"}</small></summary><div className="control-popover"><strong>Order by</strong>{COMPOSER_SORT_OPTIONS.map((option) => { const active = composerSortKey === option.key; return <button key={option.key} type="button" className={active ? "active" : ""} onClick={() => toggleComposerSort(option.key)} aria-pressed={active}><span>{option.label}</span><small aria-hidden="true">{active ? composerSortDir === "asc" ? "↑ low to high" : "↓ high to low" : ""}</small></button>; })}</div></details></div></div>
              <label className="bank-search-bar activity-picker-search"><span className="bank-search-icon" aria-hidden="true"><svg viewBox="0 0 20 20" width="16" height="16" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12.8 12.8 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span><input autoFocus type="search" value={composer.query} onChange={(event) => updateComposerQuery(event.target.value)} placeholder={composer.type === "leetcode" ? "Search titles and topics, or paste a LeetCode URL" : "Search titles and topics, or paste a public URL"} aria-label="Search activity questions" />{composer.query ? <button type="button" className="bank-search-clear" onClick={() => updateComposerQuery("")} aria-label="Clear search">×</button> : <span className="bank-search-clear-spacer" aria-hidden="true" />}<span className="bank-result-count" aria-live="polite">{filteredQuestionEntries.length}</span></label>
            </div>
            <div className="composer-specialty-surface" key={composer.type}>
              {derivedUrl && <div className={`derived-question ${derivedBlocked ? "blocked" : ""}`}><span>{derivedUrl.questionId ? "Question matched in the bank" : "Public URL ready to stage"}</span><strong>{derivedUrl.title}</strong><small>{derivedUrl.url}</small>{derivedBlocked ? <em>Already on Today</em> : <button type="button" onClick={() => { const known = activeBank.find((question) => question.id === derivedUrl.questionId); if (known) selectBankQuestion(known); else openCustomActivity(derivedUrl.url); }}>{derivedUrl.questionId && composer.selectedActivities.some((item) => item.type === composer.type && item.questionId === derivedUrl.questionId) ? "Remove selection" : derivedUrl.questionId ? "Select activity" : "Review custom activity"}</button>}</div>}
              {!derivedUrl && <div className="bank-results" ref={composerListRef} onScroll={(event) => handleComposerListScroll(event.currentTarget)}>{visibleQuestionEntries.length ? visibleQuestionEntries.map(({ question, latestAttempt, blockedToday }) => { const selected = composer.selectedActivities.some((item) => item.type === composer.type && item.questionId === question.id); return <button type="button" className={`${selected ? "selected" : ""} ${blockedToday ? "blocked" : ""}`} key={question.id} onClick={() => selectBankQuestion(question)} disabled={blockedToday} aria-pressed={selected} aria-label={blockedToday ? `${question.title} is already on Today` : `${selected ? "Remove" : "Select"} ${question.title}`}><span className={`type-mark ${composer.type}`}>{typeMark(composer.type)}</span><div><strong>{question.title}</strong><small className="activity-card-meta"><span>{composerQuestionMetadata(question)}</span>{blockedToday && <em>Already on Today</em>}</small></div><StaticResultFlag outcome={latestAttempt?.outcome} /></button>; }) : <p className="no-results">No bank match. Create a custom activity for a private, offline, or not-yet-indexed prompt.</p>}{visibleQuestionEntries.length < filteredQuestionEntries.length && <span className="picker-load-status">Scroll for more · {filteredQuestionEntries.length - visibleQuestionEntries.length} remaining</span>}</div>}
            </div>
            <button className="custom-activity-trigger" type="button" onClick={() => composer.customOpen ? setComposer((current) => ({ ...current, customOpen: false, customEditingKey: "" })) : openCustomActivity()}>＋ Custom activity</button>
            {composer.customOpen && <section className="custom-activity-card" aria-label="Custom activity">
              <div><strong>{composer.customEditingKey ? "Edit custom activity" : "Create a custom activity"}</strong><small>Title is required. A public URL and prompt are optional.</small></div>
              <label><span>Specialty</span><select value={composer.type} onChange={(event) => switchComposerType(event.target.value as ActivityType, true)}><option value="leetcode">Coding</option><option value="system_design">System design</option><option value="behavioral">Behavioral</option></select></label>
              <label><span>Title</span><input value={composer.customTitle} onChange={(event) => setComposer((current) => ({ ...current, customTitle: event.target.value }))} placeholder="Required" /></label>
              <label><span>Public URL</span><input type="url" value={composer.customUrl} onChange={(event) => { const value = event.target.value; const derived = deriveQuestionFromUrl(value, composer.type, bankFor(composer.type)); setComposer((current) => ({ ...current, customUrl: value, ...(!current.customTitle && derived?.title ? { customTitle: derived.title } : {}) })); }} placeholder="Optional" />{customUrlInvalid && <em>Use a complete public http or https URL.</em>}</label>
              <label className="custom-prompt"><span>Description or prompt</span><textarea value={composer.customPrompt} onChange={(event) => setComposer((current) => ({ ...current, customPrompt: event.target.value }))} placeholder="Optional context for the specialist" /></label>
              <label><span>Planned minutes</span><input type="number" min="1" max="360" value={composer.customMinutes} onChange={(event) => setComposer((current) => ({ ...current, customMinutes: event.target.value }))} /></label>
              {composer.type === "leetcode" && !composer.customUrl.trim() && !composer.customPrompt.trim() && <p>A title-only coding activity is allowed, but the specialist may need you to provide the full prompt later.</p>}
              <div className="custom-activity-actions"><button type="button" onClick={() => setComposer((current) => ({ ...current, customOpen: false, customEditingKey: "" }))}>Cancel</button><button type="button" className="primary-action" disabled={!composer.customTitle.trim() || customUrlInvalid} onClick={stageCustomActivity}>{composer.customEditingKey ? "Save selection" : "Add to selections"}</button></div>
            </section>}
            {composer.reviewOpen && <section className="selection-review" aria-label="Review selected activities"><header><div><strong>Review selections</strong><small>Remove anything without searching for it again.</small></div><button type="button" onClick={() => setComposer((current) => ({ ...current, selectedActivities: [], focusSelected: false }))} disabled={!selectedActivityCount}>Clear all</button></header>{composer.focusSelected && <div className="selection-review-group"><h3>Career focus</h3><article><div><strong>Job applications</strong><small>{Math.max(1, Number(composer.focusMinutes) || 60)} min · Time only</small></div><button type="button" onClick={() => setComposer((current) => ({ ...current, focusSelected: false }))} aria-label="Remove Job applications">×</button></article></div>}{stagedByType.length ? stagedByType.map((group) => <div className="selection-review-group" key={group.type}><h3>{typeLabel(group.type)}</h3>{group.items.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{item.minutes} min{item.source === "custom" ? " · Custom" : ""}</small></div>{item.source === "custom" && <button type="button" onClick={() => editStagedActivity(item)} aria-label={`Edit ${item.title}`}>Edit</button>}<button type="button" onClick={() => removeStagedActivity(item.key)} aria-label={`Remove ${item.title}`}>×</button></article>)}</div>) : !composer.focusSelected && <p className="no-results">No activities selected yet.</p>}</section>}
            <footer className="activity-selection-footer">
              <div className="selection-summary"><strong className="selection-count" key={selectedActivityCount}>{selectedActivityCount} selected</strong><small>{composer.batchDestination === "session" ? `${selectedActivityMinutes} min session countdown` : `${selectedActivityMinutes} total minutes`}</small></div>
              {!composer.editingId && <div className="activity-destination" role="radiogroup" aria-label="Add selected activities as">
                <span>Add as</span>
                <button type="button" role="radio" aria-checked={composer.batchDestination === "standalone"} className={composer.batchDestination === "standalone" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, batchDestination: "standalone" }))}>Standalone</button>
                <button type="button" role="radio" aria-checked={composer.batchDestination === "session"} className={composer.batchDestination === "session" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, batchDestination: "session" }))}>One session</button>
              </div>}
              <button type="button" onClick={() => setComposer((current) => ({ ...current, reviewOpen: !current.reviewOpen }))} disabled={!selectedActivityCount}>{composer.reviewOpen ? "Hide review" : "Review selections"}</button>
              <button className="primary-action" type="submit" disabled={!canSaveActivity}>{composer.editingId ? "Save changes" : selectedActivityCount ? composer.batchDestination === "session" ? `Add ${selectedActivityCount} as one session` : `Add ${selectedActivityCount} to Today` : "Add to Today"}</button>
            </footer>
          </form>}
          </AnimatedComposerStage>
        </section>
      </div>}

      {freshDayConfirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setFreshDayConfirmOpen(false)}>
        <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="fresh-day-title" aria-describedby="fresh-day-description" onMouseDown={(event) => event.stopPropagation()}>
          <span className="eyebrow">NEW PRACTICE WORKBENCH</span>
          <h2 id="fresh-day-title">Start a fresh day?</h2>
          <p id="fresh-day-description">Started activities will close at the current time and remain in Past for later batch publication. Every started activity must already have a result. Never-started questions return to the selection pool.</p>
          <div className="confirmation-actions"><button className="secondary-action" onClick={() => setFreshDayConfirmOpen(false)}>Keep working</button><button className="primary-action" onClick={startFreshPracticeDay}>Start fresh day</button></div>
        </section>
      </div>}

      {focusComposerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={closeFocusComposer}>
        <form className="focus-composer" role="dialog" aria-modal="true" aria-labelledby="focus-composer-title" onSubmit={saveFocusBlock} onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" type="button" onClick={closeFocusComposer} aria-label="Close">×</button>
          <span className="eyebrow">CAREER FOCUS</span>
          <h2 id="focus-composer-title">{editingFocusBlockId ? "Edit career focus." : "Block time for job applications."}</h2>
          <p>This records honest focus time in Journey. It does not create a practice problem, result, review, or publication artifact.</p>
          <label><span>Title</span><input autoFocus value={focusTitle} onChange={(event) => setFocusTitle(event.target.value)} required /></label>
          <label><span>Planned minutes</span><input type="number" min="1" max="720" value={focusMinutes} onChange={(event) => setFocusMinutes(event.target.value)} required /></label>
          <label><span>Optional note</span><textarea value={focusNote} onChange={(event) => setFocusNote(event.target.value)} placeholder="Goal, application batch, or reminder" /></label>
          <div className="confirmation-actions"><button className="secondary-action" type="button" onClick={closeFocusComposer}>Cancel</button><button className="primary-action" type="submit" disabled={!focusTitle.trim()}>{editingFocusBlockId ? "Save changes" : "Add focus block"}</button></div>
        </form>
      </div>}

      {careerSelectedJob && <div className="modal-backdrop career-drawer-backdrop" role="presentation" onMouseDown={() => setCareerSelectedJob(null)}>
        <aside className="career-job-drawer" role="dialog" aria-modal="true" aria-labelledby="career-job-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setCareerSelectedJob(null)} aria-label="Close">×</button>
          <span className="eyebrow">JOB JOURNEY · READ ONLY</span>
          <h2 id="career-job-title">{careerSelectedJob.title}</h2>
          <p className="career-job-company">{careerSelectedJob.company}{careerSelectedJob.location ? ` · ${careerSelectedJob.location}` : ""}</p>
          <dl><div><dt>Status</dt><dd>{careerSelectedJob.status.replaceAll("_", " ")}</dd></div><div><dt>Source</dt><dd>{careerSelectedJob.source}</dd></div><div><dt>External job ID</dt><dd>{careerSelectedJob.externalJobId ?? "Not recorded"}</dd></div><div><dt>Applied</dt><dd>{careerSelectedJob.appliedAt ? formatPracticeTimestamp(Date.parse(careerSelectedJob.appliedAt)) : "Not submitted"}</dd></div><div><dt>Referred</dt><dd>{careerSelectedJob.referredAt ? formatPracticeTimestamp(Date.parse(careerSelectedJob.referredAt)) : careerSelectedJob.referralOnly ? "Awaiting referral" : "No referral recorded"}</dd></div><div><dt>Last status update</dt><dd>{careerSelectedJob.statusUpdatedAt ? formatPracticeTimestamp(Date.parse(careerSelectedJob.statusUpdatedAt)) : "Not recorded"}</dd></div></dl>
          {careerSelectedJob.jobUrl && <a className="primary-action" href={careerSelectedJob.jobUrl} target="_blank" rel="noreferrer">Open original job ↗</a>}
          <small>Application data is owned by Job Journey and cannot be edited here.</small>
        </aside>
      </div>}

      {renderLifecycleDialog()}
      {uiToast && <div className="ui-toast" role="status" aria-live="polite" key={uiToast.id}><span aria-hidden="true">i</span><strong>{uiToast.message}</strong></div>}

      {integrationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setIntegrationOpen(false)}><section className="composer integration-dialog" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setIntegrationOpen(false)} aria-label="Close">×</button><span className="eyebrow">ONE DURABLE PRACTICE RECORD</span><h2 id="integration-title">Connect Interview Arc tools</h2><p>One personal token connects two separate tools to the same Interview Arc record. Codex specialists save activity transcripts, pinned notes, reviews, and finalization drafts; the coordinator alone turns those drafts into the published journal. The Chrome companion controls LeetCode timers and results. The token is shown once and stored as a secure digest.</p>{integrationToken ? <><label className="token-field"><span>Personal connection token</span><input readOnly value={integrationToken} onFocus={(event) => event.currentTarget.select()} /></label><button className="primary-action full-width" onClick={copyConnectionToken}>Copy token</button><div className="integration-steps"><strong>Connect each tool separately</strong><ol><li><strong>Codex practice bridge:</strong> set <code>INTERVIEW_ARC_MCP_TOKEN</code> before opening Codex in this trusted project. Specialists append only activity-related exchanges to D1; the coordinator creates the Git case files when you say “Publish all pending practice.”</li><li><strong>LeetCode Chrome companion:</strong> paste the same token into the loaded extension. The side panel can control the current coding activity while you work on LeetCode.</li></ol></div></> : <button className="primary-action full-width" disabled={integrationBusy} onClick={createConnectionToken}>{integrationBusy ? "Creating…" : "Create personal connection token"}</button>}<small className="integration-warning">Treat this token like a password. Create a new one if it is ever shared accidentally.</small></section></div>}

      {false && selectedEntry && <div className="letter-backdrop" role="presentation" onMouseDown={() => setSelectedEntry(null)}>
        <article className="reading-letter case-file-shell" role="dialog" aria-modal="true" aria-labelledby="letter-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="letter-close icon-action" onClick={() => setSelectedEntry(null)} aria-label="Close case file" title="Close"><Icon name="close" /></button>
          <aside className="case-toc" aria-label="Case file contents"><span>Contents</span><nav><a href="#case-summary">Overview</a>{Boolean(selectedEntry.personalNote?.trim() || selectedEntry.pinnedNotes?.length) && <a href="#case-notes">Notes</a>}<a href="#case-facts">Timeline</a>{selectedCaseGroups.map((group) => <div className="toc-group" key={group.key}><a className="toc-parent" href={`#case-group-${group.key}`}>{group.title}</a>{group.sections.map((section, index) => <a className="toc-child" key={`${section.title}-${index}`} href={`#case-${slugify(section.title)}-${index}`}>{section.title}</a>)}</div>)}{selectedEntryTurns.length > 0 && <div className="toc-group"><a className="toc-parent" href="#case-transcript">Conversation</a><a className="toc-child" href="#case-transcript-thread">Transcript and recordings</a></div>}{selectedEntryFinalAnswer && <a href="#case-final-answer">Final tailored answer</a>}</nav></aside>
          <div className="case-document" ref={readerDocumentRef} onMouseUp={captureHighlightSelection}>
            <header id="case-summary"><div><span className={`type-chip ${selectedEntry.type}`}>{typeLabel(selectedEntry.type)}</span><time>{readableDate(selectedEntry.date)} · Pacific</time></div><div className="case-title-row"><h2 id="letter-title">{selectedEntry.title}</h2><div className="case-title-actions"><button className={`star-control ${isStarred(selectedEntry.type, selectedEntry.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(selectedEntry.type, selectedEntry.questionId)} disabled={!selectedEntry.questionId} aria-label={`${isStarred(selectedEntry.type, selectedEntry.questionId) ? "Unstar" : "Star"} ${selectedEntry.title}`} title="Star this problem"><Icon name="star" /></button><button className="icon-action note-add" onClick={() => openNoteComposer()} disabled={!selectedEntryActivityId} aria-label="Add a note" title="Add a note"><Icon name="note" /><i><Icon name="plus" /></i></button></div></div>{meaningfulSubtitle(selectedEntry.subtitle) && <p>{meaningfulSubtitle(selectedEntry.subtitle)}</p>}{selectedEntry.questionId && <button className="solution-link-button" onClick={() => { const question = bankFor(selectedEntry.type).find((candidate) => candidate.id === selectedEntry.questionId); if (question) { setSelectedEntry(null); setSelectedProblem({ type: selectedEntry.type, question }); } }}>View solution →</button>}</header>
            {pendingHighlight && <button className="selection-highlight-action" type="button" onClick={() => void saveHighlight()}>Highlight selection</button>}
            <HighlightShelf highlights={contentHighlights} onRemove={(id) => void removeHighlight(id)} />
            {Boolean(selectedEntry.personalNote?.trim() || selectedEntry.pinnedNotes?.length) && <aside className="pinned-notes" id="case-notes" aria-label="Pinned practice notes"><span>NOTES</span>{selectedEntry.personalNote?.trim() && <article><div className="note-actions"><button onClick={() => openNoteComposer("personal")} aria-label="Edit personal note" title="Edit"><Icon name="edit" /></button><button onClick={() => void deleteCaseNote("personal")} aria-label="Delete personal note" title="Delete"><Icon name="trash" /></button></div><MarkdownBody source={selectedEntry.personalNote} /></article>}{selectedEntry.pinnedNotes?.map((note) => <article key={note.id}><header><small>{note.kind}</small><div className="note-actions"><button onClick={() => openNoteComposer(note)} aria-label={`Edit ${note.kind} note`} title="Edit"><Icon name="edit" /></button><button onClick={() => void deleteCaseNote(note.id)} aria-label={`Delete ${note.kind} note`} title="Delete"><Icon name="trash" /></button></div></header><MarkdownBody source={note.body} /></article>)}</aside>}
            {noteComposerOpen && <form className="case-note-composer" onSubmit={(event) => { event.preventDefault(); void saveCaseNote(); }}><label htmlFor="case-note">{editingNoteId ? "Edit note" : "Add a note"}</label><textarea id="case-note" autoFocus value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="A concise reminder, mistake, or pattern to keep visible…" /><div><button type="button" onClick={() => { setNoteComposerOpen(false); setEditingNoteId(""); setNoteDraft(""); }}>Cancel</button><button type="submit" disabled={noteBusy || !noteDraft.trim()}>{noteBusy ? "Saving…" : "Save note"}</button></div></form>}
            <div className="letter-facts" id="case-facts"><div><span>Status</span><strong>{selectedEntry.status}</strong></div><div><span>Time recorded</span><strong>{selectedEntry.elapsedSeconds ? formatClock(selectedEntry.elapsedSeconds) : "Not recorded"}</strong></div>{selectedEntry.startedAt && <div><span>Started</span><strong>{formatPracticeTimestamp(selectedEntry.startedAt)}</strong></div>}{selectedEntry.endedAt && <div><span>Finished</span><strong>{formatPracticeTimestamp(selectedEntry.endedAt)}</strong></div>}{selectedEntry.sessionId && <div><span>Session</span><strong>{selectedEntry.sessionId}</strong></div>}{selectedEntry.outcome && <div><span>Result</span><strong>{resultLabel(selectedEntry.outcome, selectedEntry.type)}</strong></div>}{selectedEntry.review && <div className="review-fact"><span>{selectedEntry.review.status === "due" ? "Review due" : "Next review"}</span><strong>{selectedEntry.review.dueDate}</strong><small>{selectedEntry.review.reason.replaceAll("_", " ")} · {selectedEntry.review.intervalDays} day interval</small></div>}</div>
            {selectedEntry.artifact ? <div className="letter-sections layered-reader">{selectedCaseGroups.map((group) => group.key === "record"
              ? <section className="reader-group record-group" id={`case-group-${group.key}`} key={group.key}><h2>{group.title}</h2><ReaderGroupSections sections={group.sections} idPrefix="case" coding={selectedEntry.type === "leetcode"} /></section>
              : <details className={`reader-group ${group.key}-group`} id={`case-group-${group.key}`} key={group.key}><summary><span>{group.title}</span><small>{group.sections.length} section{group.sections.length === 1 ? "" : "s"}</small></summary><div><ReaderGroupSections sections={group.sections} idPrefix="case" coding={selectedEntry.type === "leetcode"} /></div></details>)}</div> : <div className="unpublished-letter" id="case-draft"><span className="eyebrow">D1 DRAFT · NOT YET IN THE JOURNAL</span><h3>The attempt is saved; its case file is still waiting for finalization.</h3><p>The coordinator will ask the matching specialist to finalize the transcript, review, solution, and consulted references. No unrelated task conversation is included.</p>{selectedEntry.finalization && <p><strong>Specialist bundle:</strong> {selectedEntry.finalization.status}</p>}{selectedEntry.url && <a href={selectedEntry.url} target="_blank" rel="noreferrer">Open original problem ↗</a>}</div>}
            {selectedEntryTurns.length > 0 && <details className="reader-group conversation-group" id="case-transcript"><summary><span>Conversation</span><small>{selectedEntryTurns.length} exchange{selectedEntryTurns.length === 1 ? "" : "s"} · recordings inline</small></summary><div id="case-transcript-thread"><ActivityTranscript turns={selectedEntryTurns} clips={selectedEntryClips} deliveryAnalyses={selectedEntryDeliveryAnalyses} codeAttempts={selectedEntryCodeAttempts} modeTransitions={selectedEntryModeTransitions} /></div></details>}
            {selectedEntryFinalAnswer && <details className="reader-group final-answer-group" id="case-final-answer" open><summary><span>Final tailored answer</span><small>{selectedEntryFinalAnswer.source === "snapshot_v1" ? `Immutable snapshot ${selectedEntryFinalAnswer.snapshotRevision}` : "Legacy fallback"}</small></summary><div><FinalAnswerCard finalAnswer={selectedEntryFinalAnswer} /></div></details>}
            <footer>Interview Arc · {selectedEntry.id}</footer>
          </div>
        </article>
      </div>}
      {false && selectedProblem && <div className="letter-backdrop" role="presentation" onMouseDown={() => setSelectedProblem(null)}>
        <article className="reading-letter case-file-shell solution-profile-letter solution-profile-shell" role="dialog" aria-modal="true" aria-labelledby="solution-profile-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="letter-close icon-action" onClick={() => setSelectedProblem(null)} aria-label="Close solution profile" title="Close"><Icon name="close" /></button>
          <aside className="case-toc solution-toc" aria-label="Solution contents"><span>Contents</span><nav><a href="#solution-profile-summary">Overview</a>{selectedSolutionGroups.map((group) => <div className="toc-group" key={group.key}><a className="toc-parent" href={`#solution-group-${group.key}`}>{group.title}</a>{group.sections.map((section, index) => <a className="toc-child" key={`${section.title}-${index}`} href={`#solution-${slugify(section.title)}-${index}`}>{section.title}</a>)}</div>)}<a href="#solution-attempts">Past attempts</a></nav></aside>
          <div className="case-document solution-profile-document" ref={readerDocumentRef} onMouseUp={captureHighlightSelection}>
          <header id="solution-profile-summary"><div><span className={`type-chip ${selectedProblem.type}`}>{typeLabel(selectedProblem.type)}</span><span className="profile-revision">{selectedProblemProfile ? `Solution revision ${selectedProblemProfile.currentRevision}` : "No solution yet"}</span><button className={`star-control ${isStarred(selectedProblem.type, selectedProblem.question.id) ? "starred" : ""}`} onClick={() => toggleProblemStar(selectedProblem.type, selectedProblem.question.id)} aria-label={`${isStarred(selectedProblem.type, selectedProblem.question.id) ? "Unstar" : "Star"} ${selectedProblem.question.title}`}>★</button></div><h2 id="solution-profile-title">{selectedProblem.question.title}</h2><p>{selectedProblemProfile?.payload.summary ?? selectedProblem.question.prompt ?? "Finish and finalize an attempt to build this reusable Solution Profile."}</p></header>
          <div className="profile-tags">{[...new Set([...selectedProblem.question.topics, ...(selectedProblem.question.tags ?? []), ...(selectedProblemProfile?.tags ?? [])])].map((tag) => <span key={tag}>{tag}</span>)}</div>
          {pendingHighlight && <button className="selection-highlight-action" type="button" onClick={() => void saveHighlight()}>Highlight selection</button>}
          <HighlightShelf highlights={contentHighlights} onRemove={(id) => void removeHighlight(id)} />
          {selectedProblemProfile?.payload.behavioralAnswer && <section className="canonical-answer-card"><span className="eyebrow">YOUR PREFERRED ANSWER</span><h3>{selectedProblemProfile.payload.behavioralAnswer.preferred.label}</h3><MarkdownBody source={selectedProblemProfile.payload.behavioralAnswer.preferred.answer} />{selectedProblemProfile.payload.behavioralAnswer.preferred.evidence.length > 0 && <div className="answer-evidence"><strong>Verified evidence</strong><ul>{selectedProblemProfile.payload.behavioralAnswer.preferred.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selectedProblemProfile.payload.behavioralAnswer.preferred.evidenceGaps.length > 0 && <div className="answer-gaps"><strong>Evidence still needed</strong><ul>{selectedProblemProfile.payload.behavioralAnswer.preferred.evidenceGaps.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selectedProblemProfile.payload.behavioralAnswer.alternatives.length > 0 && <details className="answer-alternatives"><summary>{selectedProblemProfile.payload.behavioralAnswer.alternatives.length} alternative story {selectedProblemProfile.payload.behavioralAnswer.alternatives.length === 1 ? "variant" : "variants"}</summary>{selectedProblemProfile.payload.behavioralAnswer.alternatives.map((variant) => <article key={variant.label}><h4>{variant.label}</h4>{variant.whenToUse && <small>Best when: {variant.whenToUse}</small>}<MarkdownBody source={variant.answer} /></article>)}</details>}</section>}
          {selectedProblemProfile ? <div className="letter-sections solution-sections layered-reader">{selectedSolutionGroups.map((group) => <SolutionReaderGroup group={group} idPrefix="solution" coding={selectedProblem.type === "leetcode"} key={group.key} />)}</div> : <div className="unpublished-letter"><span className="eyebrow">KNOWLEDGE PROFILE</span><h3>This problem has no finalized solution yet.</h3><p>The matching specialist creates it when a completed attempt is finalized. Past will keep the transcript; this bank page will keep the reusable answer.</p></div>}
          <section className="attempt-history" id="solution-attempts"><span className="eyebrow">PAST ATTEMPTS</span>{selectedProblemAttempts.length ? selectedProblemAttempts.map((entry) => <button key={entry.id} onClick={() => { setSelectedProblem(null); setSelectedEntry(entry); }}><span>{readableDate(entry.date, true)}</span><strong>{resultLabel(entry.outcome, entry.type)}</strong><small>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "No timer"} · Read case →</small></button>) : <p>No completed attempt is linked yet.</p>}</section>
          {selectedProblemRevisions.length > 1 && <section className="revision-history"><span className="eyebrow">SOLUTION HISTORY</span><p>{selectedProblemRevisions.length} immutable revisions are linked to past attempts. The profile above is the current revision.</p></section>}
          {selectedProblemProfile?.payload.references.length ? <section className="profile-references"><span className="eyebrow">REFERENCES CONSULTED</span>{selectedProblemProfile.payload.references.map((reference) => <a key={`${reference.url}-${reference.accessedAt}`} href={reference.url} target="_blank" rel="noreferrer">{reference.title} ↗<small>{reference.accessedAt}</small></a>)}</section> : null}
          <footer>Interview Arc · {selectedProblem.type}:{selectedProblem.question.id}</footer>
          </div>
        </article>
      </div>}
    {pipWindow && createPortal(
      <PipNowPanel
        activity={pipActivity}
        activityTimer={pipActivity ? draft.timers[pipActivity.id] : undefined}
        session={pipSession}
        sessionTimer={pipSession ? draft.sessionTimers[pipSession.id] : undefined}
        outcome={pipPracticeActivity ? draft.outcomes[pipPracticeActivity.id] ?? pipPracticeActivity.outcome : undefined}
        starred={pipPracticeActivity ? isStarred(pipPracticeActivity.type, pipPracticeActivity.questionId) : false}
        activityLocked={Boolean(pipSession && draft.sessionTimers[pipSession.id]?.completed)}
        now={now}
        onToggleActivity={toggleTimer}
        onCompleteActivity={(activityId) => currentFocusBlocks.some((block) => block.id === activityId) ? completeFocusBlock(activityId) : completeTimer(activityId)}
        onToggleSession={toggleSessionTimer}
        onCompleteSession={completeSessionTimer}
        onOutcome={setOutcome}
        onToggleStar={toggleProblemStar}
      />,
      pipWindow.document.body,
    )}
    </main>
    <PetalField quiet={arrivalState === "entered"} paused={!petalsEnabled} />
    <ArrivalRitual date={today} state={arrivalState} muted={soundMuted} trackName={trackName} trackArtist={trackArtist} playlist={ambientPlaylist} trackIndex={ambientTrackIndex} volume={musicVolume} onToggleMuted={toggleArrivalSound} onPreviousTrack={previousAmbientTrack} onNextTrack={nextAmbientTrack} onSelectTrack={chooseAmbientTrack} onVolumeChange={setMusicVolume} onEnter={enterArc} />
    </>
  );
}

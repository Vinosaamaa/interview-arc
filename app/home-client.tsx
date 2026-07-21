"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  type LocalSession,
  type Outcome,
  type PracticeNote,
  type PublicationStatus,
  type ReviewSchedule,
  type FinalizationSummary,
  type AudioClip,
  type TimerDraft,
  type TranscriptTurn,
} from "./live-types";
import { useLiveState, useReadOnlyLiveState } from "./live-sync";
import { emptyJournal } from "./current-day";
import { ArrivalRitual, PetalField } from "./arrival-ritual";
import { useAmbientSound } from "./ambient-sound";
import { MusicPlaylist } from "./music-playlist";
import {
  formatPracticeTimerTimestamp,
  formatPracticeTimestamp,
  practiceDateAt,
  practicePeriodAt,
  PRACTICE_TIME_ZONE,
} from "./practice-time";

type View = "today" | "journey" | "library" | "banks";
type ComposerMode = "session" | "activity";
type JourneyRange = 30 | 90 | 365 | "all";
type JourneyMetric = "activities" | "time";
type LibraryAttentionFilter = "due" | "needs_review" | "solved" | "helped" | "failed" | "notes";
type BankAttentionFilter = "due" | "needs_review" | "solved" | "helped" | "failed" | "todo" | "notes";
type ComposerAttentionFilter = "due" | "needs_review" | "solved" | "helped" | "failed";
type DocumentPiP = { requestWindow: (options?: { width?: number; height?: number }) => Promise<Window> };
type ComposerState = {
  open: boolean;
  mode: ComposerMode;
  type: ActivityType;
  query: string;
  selectedId: string;
  minutes: string;
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
};

const EMPTY_COMPOSER: ComposerState = {
  open: false,
  mode: "activity",
  type: "leetcode",
  query: "",
  selectedId: "",
  minutes: "30",
  editingId: "",
  editingSessionId: "",
  sessionCoding: 6,
  sessionSystemDesign: 1,
  sessionBehavioral: 1,
};
const OUTCOME_ORDER: (Outcome | undefined)[] = [undefined, "solved", "solved_after_reviewing_approach", "failed"];

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

function Icon({ name }: { name: "close" | "star" | "book" | "plus" | "filter" | "sort" | "note" | "edit" | "trash" | "chevron" | "flag" }) {
  const paths: Record<typeof name, ReactNode> = {
    close: <><path d="M5 5l14 14M19 5 5 19" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    filter: <path d="M4 6h16l-6.2 7v5l-3.6 2v-7L4 6Z" />,
    sort: <><path d="M8 5v14M5 8l3-3 3 3M16 19V5m-3 11 3 3 3-3" /></>,
    note: <><path d="M5 3h11l3 3v15H5V3Z" /><path d="M15 3v4h4M8 11h8M8 15h8" /></>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" /><path d="m13.5 7 3.5 3.5" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    flag: <><path d="M6 21V4" /><path d="M6 5h9.5l-1.5 3 1.5 3H6" /></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
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
}: {
  activity: JournalActivity;
  timer?: TimerDraft;
  now: number;
  onToggle: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const used = elapsed(timer, now);
  const running = Boolean(timer?.runningSince);
  const complete = Boolean(timer?.completed);
  const started = Boolean(timer?.startedAt);
  return (
    <div className={`activity-timer ${started ? "started" : "unstarted"} ${running ? "running" : ""} ${complete ? "complete" : ""}`}>
      <div className="activity-time-copy">
        <span>{complete ? "Final time" : running ? "Running" : timer?.startedAt ? "Paused" : "Stopwatch"}</span>
        <strong>{formatClock(used)}</strong>
      </div>
      <div className="activity-time-actions">
        <button className="start-timer icon-control" onClick={() => onToggle(activity.id)} disabled={complete} aria-label={running ? `Pause ${activity.title}` : `Start ${activity.title}`} title={running ? "Pause stopwatch" : complete ? "Finished activities cannot be resumed" : "Start stopwatch"}>
          <span aria-hidden="true">{running ? "Ⅱ" : "▶"}</span>
        </button>
        <button className="finish-timer icon-control" onClick={() => onComplete(activity.id)} disabled={complete || !started} aria-label={`Finish ${activity.title}`} title={complete ? "Activity finished" : !started ? "Start the stopwatch before finishing" : "Finish and lock stopwatch"}>
          <span aria-hidden="true">{complete ? "✓" : "■"}</span>
        </button>
      </div>
      <small className={`activity-start-time ${started ? "" : "empty"}`} aria-hidden={!started}>
        {timer?.startedAt ? formatPracticeTimerTimestamp(timer.startedAt) : "\u00A0"}
      </small>
    </div>
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
}: {
  outcome?: Outcome;
  activityType: ActivityType;
  onChange: (outcome?: Outcome) => void;
}) {
  const currentIndex = OUTCOME_ORDER.indexOf(outcome);
  const next = OUTCOME_ORDER[(currentIndex + 1) % OUTCOME_ORDER.length];
  return (
    <div className="result-flag-wrap">
      <button className={`result-flag ${outcome ?? "unset"}`} onClick={() => onChange(next)} aria-label={`Result: ${resultLabel(outcome, activityType)}. Select the next result.`} title="Change result">
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
  now,
  onToggleActivity,
  onCompleteActivity,
  onToggleSession,
  onCompleteSession,
  onOutcome,
}: {
  activity?: JournalActivity | ExtraActivity | null;
  activityTimer?: TimerDraft;
  session?: PracticeSession | null;
  sessionTimer?: TimerDraft;
  outcome?: Outcome;
  now: number;
  onToggleActivity: (id: string) => void;
  onCompleteActivity: (id: string) => void;
  onToggleSession: (id: string) => void;
  onCompleteSession: (id: string) => void;
  onOutcome: (id: string, outcome?: Outcome) => void;
}) {
  const sessionAllocated = session?.allocatedSeconds ?? SESSION_SECONDS;
  const sessionLeft = session ? remaining(sessionTimer, now, sessionAllocated) : 0;
  const sessionRunning = Boolean(session && sessionTimer?.runningSince && sessionLeft > 0);
  const sessionComplete = Boolean(session && (sessionTimer?.completed || sessionLeft === 0));
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
            <span>Session left</span>
            <strong>{formatClock(sessionLeft)}</strong>
            <small>{sessionComplete ? "Finished" : sessionRunning ? session.label : `${session.label} · paused`}</small>
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
            <span className={`type-mark ${activity.type}`}>{typeMark(activity.type)}</span>
            <div>
              <small>{typeLabel(activity.type)} stopwatch</small>
              <strong className="pip-problem-title">{activity.title}</strong>
            </div>
          </div>
          <div className="pip-clock-row">
            <strong className="pip-elapsed">{formatClock(activityUsed)}</strong>
            <div className="pip-clock-actions">
              <button type="button" className="pip-btn primary" onClick={() => onToggleActivity(activity.id)} disabled={activityComplete} aria-label={activityRunning ? `Pause ${activity.title}` : `Start ${activity.title}`}>
                <span aria-hidden="true">{activityRunning ? "Ⅱ" : "▶"}</span>
              </button>
              <button type="button" className="pip-btn" onClick={() => onCompleteActivity(activity.id)} disabled={activityComplete || !activityStarted} aria-label={`Finish ${activity.title}`} title={!activityStarted ? "Start the stopwatch before finishing" : "Finish activity"}>
                <span aria-hidden="true">{activityComplete ? "✓" : "■"}</span>
              </button>
              <ResultFlag activityType={activity.type} outcome={outcome} onChange={(next) => onOutcome(activity.id, next)} />
            </div>
          </div>
          {activity.url ? <a className="pip-open" href={activity.url} target="_blank" rel="noreferrer">Open problem ↗</a> : null}
        </section>
      ) : (
        <p className="pip-empty">No active problem yet. Add or start one on Today.</p>
      )}
    </div>
  );
}

function StandaloneActivityCard({ children, title, onRemove }: { children: ReactNode; title: string; onRemove: () => void }) {
  return (
    <article className="standalone-activity-card">
      {children}
      <button className="icon-action danger" onClick={onRemove} aria-label={`Remove ${title}`} title="Remove activity"><Icon name="close" /></button>
    </article>
  );
}

function MarkdownBody({ source }: { source: string }) {
  return <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown></div>;
}

function ActivityTranscript({
  turns,
  clips,
}: {
  turns: TranscriptTurn[];
  clips: AudioClip[];
}) {
  return (
    <section className="case-transcript" aria-label="Conversation transcript and answer recordings">
      <div className="case-transcript-heading"><span className="eyebrow">CONVERSATION TRANSCRIPT</span><p>Your recording sits between the prompt and the answer it captures.</p></div>
      <div className="transcript-thread">
        {turns.map((turn) => {
          const answerClips = turn.speaker === "user"
            ? clips.filter((clip) => clip.transcriptTurnId === turn.turnId)
            : [];
          return <div className={`transcript-turn ${turn.speaker}`} key={turn.turnId} data-answer-turn-id={turn.speaker === "user" ? turn.turnId : undefined}>
            {turn.speaker === "user" && answerClips.length > 0 && <div className="answer-playback has-audio">
              {answerClips.map((clip) => <div className="answer-take" key={clip.id}>
                <div><strong>{clip.label}</strong><small>{clip.filename}</small></div>
                {clip.status === "available" ? <audio controls preload="metadata" src={`/api/audio/${encodeURIComponent(clip.id)}`} /> : <em>{clip.status.replaceAll("_", " ")}</em>}
              </div>)}
            </div>}
            <article>
              <header><span>{turn.speaker === "specialist" ? "Specialist" : "Your answer"}</span><time>{formatPracticeTimestamp(new Date(turn.occurredAt).toISOString())}</time></header>
              <MarkdownBody source={turn.body} />
            </article>
          </div>;
        })}
      </div>
    </section>
  );
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

export default function HomeClient({ content, today }: { content: ContentIndex; today: string }) {
  const journal = useMemo(
    () => content.journals.find((candidate) => candidate.date === today) ?? emptyJournal(today),
    [content.journals, today],
  );
  const [view, setView] = useState<View>("today");
  const { draft, setDraft, now, setNow, hydrated, enqueue } = useLiveState(journal.date);
  const yesterdayDate = shiftDate(journal.date, -1);
  const yesterdayDraft = useReadOnlyLiveState(yesterdayDate);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [selectedProblem, setSelectedProblem] = useState<{ type: ActivityType; question: QuestionBankItem } | null>(null);
  const [libraryTypeFilters, setLibraryTypeFilters] = useState<ActivityType[]>([]);
  const [libraryAttentionFilters, setLibraryAttentionFilters] = useState<LibraryAttentionFilter[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryStarFilter, setLibraryStarFilter] = useState(false);
  const [bankTypeFilters, setBankTypeFilters] = useState<ActivityType[]>([]);
  const [bankAttentionFilters, setBankAttentionFilters] = useState<BankAttentionFilter[]>([]);
  const [bankLevelFilters, setBankLevelFilters] = useState<Array<"easy" | "medium" | "hard">>([]);
  const [bankSortKey, setBankSortKey] = useState<"frequency" | "recent" | "acceptance">("frequency");
  const [bankSortDir, setBankSortDir] = useState<"asc" | "desc">("asc");
  const [bankSearch, setBankSearch] = useState("");
  const [bankTagFilters, setBankTagFilters] = useState<string[]>([]);
  const [bankStarFilter, setBankStarFilter] = useState<"all" | "starred">("all");
  const [bankTopicsExpanded, setBankTopicsExpanded] = useState(false);
  const [composerAttentionFilters, setComposerAttentionFilters] = useState<ComposerAttentionFilter[]>([]);
  const [composerLevelFilters, setComposerLevelFilters] = useState<Array<"easy" | "medium" | "hard">>([]);
  const [composerStarFilter, setComposerStarFilter] = useState(false);
  const [composerVisibleCount, setComposerVisibleCount] = useState(20);
  const [journeyRange, setJourneyRange] = useState<JourneyRange>(90);
  const [journeyMetric, setJourneyMetric] = useState<JourneyMetric>("activities");
  const [journeyDate, setJourneyDate] = useState("");
  const [journeyTopic, setJourneyTopic] = useState("");
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [arrivalState, setArrivalState] = useState<"show" | "leaving" | "entered">("show");
  const [soundMuted, setSoundMuted] = useState(false);
  const [petalsEnabled, setPetalsEnabled] = useState(true);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [integrationToken, setIntegrationToken] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [loadedPracticeRecordId, setLoadedPracticeRecordId] = useState("");
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSoundMuted(window.localStorage.getItem("interview-arc-sound-muted") === "true");
      setPetalsEnabled(window.localStorage.getItem("interview-arc-petals-paused") !== "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [today]);

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

  useEffect(() => {
    const previous = document.body.style.overflow;
    if (arrivalState !== "entered") document.body.style.overflow = "hidden";
    else document.body.style.overflow = previous;
    return () => { document.body.style.overflow = previous; };
  }, [arrivalState]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPipSupported("documentPictureInPicture" in window));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Close the pop-out if the dashboard unmounts so it never outlives its opener.
  useEffect(() => {
    return () => pipWindow?.close();
  }, [pipWindow]);

  useEffect(() => {
    if (!composer.open && !selectedEntry && !selectedProblem && !integrationOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposer(EMPTY_COMPOSER);
        setSelectedEntry(null);
        setSelectedProblem(null);
        setIntegrationOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [composer.open, selectedEntry, selectedProblem, integrationOpen]);

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

  const allTodayActivities = useMemo(
    () => [...journal.activities, ...draft.extraActivities],
    [journal.activities, draft.extraActivities],
  );
  const allSessions: PracticeSession[] = useMemo(
    () => [...journal.sessions, ...draft.sessions],
    [journal.sessions, draft.sessions],
  );
  const sessionByActivityId = useMemo(() => {
    const membership = new Map<string, PracticeSession>();
    allSessions.forEach((session) => session.activityIds.forEach((activityId) => membership.set(activityId, session)));
    return membership;
  }, [allSessions]);
  const assignedExtraIds = new Set(draft.sessions.flatMap((session) => session.activityIds));
  const looseActivities = draft.extraActivities.filter((activity) => !assignedExtraIds.has(activity.id));

  // Pacific midnight is the journal boundary even when a session continues.
  // Reloading swaps the Today shell while D1 carries the focused unfinished
  // session and its activities into the new calendar day.
  useEffect(() => {
    const checkPracticeDate = () => {
      if (practiceDateAt() !== journal.date) window.location.reload();
    };
    const interval = window.setInterval(checkPracticeDate, 30_000);
    return () => window.clearInterval(interval);
  }, [journal.date]);

  useEffect(() => {
    const finished = allSessions.filter((session) => session.activityIds.length > 0
      && !draft.sessionTimers[session.id]?.completed
      && session.activityIds.every((activityId) => draft.timers[activityId]?.completed));
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
  }, [allSessions, draft.sessionTimers, draft.timers, enqueue, setDraft]);

  const focusedActivity =
    allTodayActivities.find((activity) => activity.id === draft.focusedActivityId) ??
    allTodayActivities.find((activity) => draft.timers[activity.id]?.runningSince) ??
    null;
  const focusedSession =
    allSessions.find((session) => session.id === draft.focusedSessionId) ??
    (focusedActivity ? sessionByActivityId.get(focusedActivity.id) ?? null : null);

  // The pop-out follows durable focus even while the current activity is paused.
  const pipActivity =
    focusedActivity ??
    allTodayActivities.find((activity) => !draft.timers[activity.id]?.completed) ??
    allTodayActivities[0] ??
    null;
  const pipSession =
    focusedSession ?? allSessions.find((session) => draft.sessionTimers[session.id]?.runningSince) ?? allSessions[0] ?? null;

  function bankFor(type: ActivityType) {
    const canonical = type === "leetcode"
      ? content.questionBanks.leetcode
      : type === "system_design"
        ? content.questionBanks.systemDesign
        : content.questionBanks.behavioral;
    const personal = draft.personalQuestions.filter((question) => question.specialty === type).map((question): QuestionBankItem => ({
      id: question.questionId,
      title: question.title,
      prompt: question.prompt ?? undefined,
      url: question.url ?? undefined,
      source: question.source,
      topics: question.tags,
      tags: question.tags,
      priority: question.priority,
      targetMinutes: question.targetMinutes,
      active: question.active,
    }));
    const canonicalIds = new Set(canonical.map((question) => question.id));
    return [...personal.filter((question) => !canonicalIds.has(question.id)), ...canonical];
  }

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

  function toggleTimer(activityId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    const priorTimer = draft.timers[activityId];
    if (priorTimer?.completed) return;
    const session = sessionByActivityId.get(activityId);
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
    const timestamp = Date.now();
    const existing = draft.sessionTimers[sessionId];
    if (!existing?.startedAt || existing.completed) return;
    setNow(timestamp);
    const session = allSessions.find((candidate) => candidate.id === sessionId);
    enqueue({ type: "timer", subjectId: sessionId, kind: "session", action: "finish", activityIds: session?.activityIds ?? [] });
    setDraft((current) => {
      const prior = current.sessionTimers[sessionId];
      if (!prior?.startedAt || prior.completed) return current;
      const timers = { ...current.timers };
      session?.activityIds.forEach((activityId) => {
        const activityTimer = timers[activityId];
        if (activityTimer?.runningSince) {
          timers[activityId] = { ...activityTimer, elapsedSeconds: elapsed(activityTimer, timestamp), runningSince: null };
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

  function setOutcome(activityId: string, outcome?: Outcome) {
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
          body: JSON.stringify({ activityId: selectedEntryActivityId, date: selectedEntry?.date, body: noteDraft.trim(), kind: "remember" }),
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
    setComposerAttentionFilters([]);
    setComposerLevelFilters([]);
    setComposerStarFilter(false);
    setComposerVisibleCount(20);
    setComposer({ ...EMPTY_COMPOSER, open: true, mode: "activity" });
  }

  function openNewSession() {
    setComposer({ ...EMPTY_COMPOSER, open: true, mode: "session" });
  }

  function isSessionEditable(session: LocalSession) {
    const sessionTimer = draft.sessionTimers[session.id];
    if (sessionTimer?.runningSince || sessionTimer?.completed || sessionTimer?.elapsedSeconds) return false;
    return session.activityIds.every((activityId) => {
      const activity = allTodayActivities.find((candidate) => candidate.id === activityId);
      const timer = draft.timers[activityId];
      return !timer?.runningSince && !timer?.completed && !timer?.elapsedSeconds &&
        activity?.status !== "completed" &&
        !activity?.artifactPath && !draft.publicationStatuses[activityId];
    });
  }

  function openEditSession(session: LocalSession) {
    if (!isSessionEditable(session)) return;
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
    const available = bank.filter((question) => question.active
      && !isQuestionBlocked(question, blocked)
      && (!((question.priority ?? 0) > 0 && profileFor(type, question.id)) || dueQuestionIds.has(question.id)));
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
      selectedId: question.id,
      query: question.title,
      minutes: String(question.targetMinutes),
    }));
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
    setComposer(EMPTY_COMPOSER);
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
    setComposer(EMPTY_COMPOSER);
  }

  function removeActivity(activityId: string) {
    enqueue({ type: "extra-remove", id: activityId });
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
    if (!window.confirm(`Remove ${session.label} and its local activities?`)) return;
    const ids = new Set(session.activityIds);
    enqueue({ type: "session-remove", id: session.id, activityIds: session.activityIds });
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
        sessions: current.sessions.filter((item) => item.id !== session.id),
      };
    });
  }

  function exportDraft() {
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
    const payload = {
      schemaVersion: 6,
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
    if (pipWindow) {
      pipWindow.focus();
      return;
    }
    try {
      const win = await dpip.requestWindow({ width: 360, height: 320 });
      for (const node of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
        win.document.head.appendChild(node.cloneNode(true));
      }
      win.document.body.classList.add("pip-body");
      win.addEventListener("pagehide", () => setPipWindow(null), { once: true });
      setPipWindow(win);
    } catch {
      // The request needs a user gesture and can be cancelled; ignore failures.
    }
  }

  const logEntries = useMemo(() => {
    const entries: LogEntry[] = [];
    const artifactByActivity = new Map(content.artifacts.filter((artifact) => artifact.activityId).map((artifact) => [artifact.activityId, artifact]));
    const knownSessionByActivity = new Map<string, string>();
    content.journals.flatMap((daily) => daily.sessions).forEach((session) => session.activityIds.forEach((id) => knownSessionByActivity.set(id, session.id)));
    [...draft.sessions, ...(yesterdayDraft?.sessions ?? [])].forEach((session) => session.activityIds.forEach((id) => knownSessionByActivity.set(id, session.id)));
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
          url: activity.url,
          artifact,
          startedAt,
          endedAt,
          sessionId: activity.sessionId ?? knownSessionByActivity.get(activity.id),
          personalNote: liveDraft?.notes[activity.id] ?? "",
          pinnedNotes: liveDraft?.structuredNotes[activity.id] ?? [],
          review: liveDraft?.reviews[activity.id],
          finalization: liveDraft?.finalizations[activity.id],
          audioClips: draft.audioClips[activity.id] ?? [],
        });
      }
    }
    for (const activity of draft.extraActivities) {
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
        url: activity.url,
        startedAt,
        endedAt,
        sessionId: activity.sessionId ?? knownSessionByActivity.get(activity.id),
        personalNote: draft.notes[activity.id] ?? "",
        pinnedNotes: draft.structuredNotes[activity.id] ?? [],
        review: draft.reviews[activity.id],
        finalization: draft.finalizations[activity.id],
        audioClips: draft.audioClips[activity.id] ?? [],
      });
    }
    for (const activity of yesterdayDraft?.extraActivities ?? []) {
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
        url: activity.url,
        startedAt,
        endedAt,
        sessionId: activity.sessionId ?? knownSessionByActivity.get(activity.id),
        personalNote: yesterdayDraft?.notes[activity.id] ?? "",
        pinnedNotes: yesterdayDraft?.structuredNotes[activity.id] ?? [],
        review: yesterdayDraft?.reviews[activity.id],
        finalization: yesterdayDraft?.finalizations[activity.id],
        audioClips: draft.audioClips[activity.id] ?? yesterdayDraft?.audioClips[activity.id] ?? [],
      });
    }
    for (const artifact of content.artifacts) {
      if (artifact.activityId && entries.some((entry) => entry.id === artifact.activityId)) continue;
      const inferredType: ActivityType = artifact.type === "leetcode" || artifact.type === "behavioral" ? artifact.type : "system_design";
      const preview = artifact.sections.find((section) => /summary|short answer|question/i.test(section.title))?.body ?? "Published interview record";
      const noteSection = artifact.sections.find((section) => /pinned notes?|notes to remember/i.test(section.title));
      entries.push({ id: artifact.path, date: artifact.date, type: inferredType, title: artifact.title, subtitle: plainText(preview).slice(0, 160), status: "published", elapsedSeconds: 0, allocatedSeconds: 0, artifact, personalNote: noteSection?.body ?? "", audioClips: draft.audioClips[artifact.activityId] ?? [] });
    }
    return entries.sort((left, right) => right.date.localeCompare(left.date)
      || (right.endedAt ?? "").localeCompare(left.endedAt ?? "")
      || left.title.localeCompare(right.title));
  }, [content.artifacts, content.journals, draft, journal.date, now, yesterdayDate, yesterdayDraft]);

  const libraryEntries = useMemo(
    () => logEntries.filter((entry) => entry.status === "completed" || entry.status === "published"),
    [logEntries],
  );

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
      groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [draft.problemPreferences, libraryAttentionFilters, libraryEntries, librarySearch, libraryStarFilter, libraryTypeFilters]);

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
      Boolean(question.url && entry.url && question.url.replace(/\/$/, "") === entry.url.replace(/\/$/, "")) ||
      normalizedIdentity(question.title) === normalizedIdentity(entry.title)
    ));
  }, [content.questionBanks.leetcode]);

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
    ? completedEntries.filter((entry) => entry.date === journeyDate)
    : [];
  const selectedTopicEntries = topicStats.find((topic) => topic.topic === journeyTopic)?.entries ?? [];
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
    [...draft.sessions, ...(yesterdayDraft?.sessions ?? [])].forEach((session) => catalog.set(session.id, session));
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
  }, [completedEntries, content.journals, draft.sessions, yesterdayDraft?.sessions]);
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

  function renderSession(session: PracticeSession, index: number) {
    const activities = sessionActivities(session);
    const coding = activities.filter((activity) => activity.type === "leetcode");
    const mockActivities = activities
      .filter((activity) => activity.type !== "leetcode")
      .sort((left, right) => (left.type === right.type ? 0 : left.type === "system_design" ? -1 : 1));
    const complete = activities.filter(isActivityComplete).length;
    const codingSeconds = coding.reduce((sum, activity) => sum + elapsed(draft.timers[activity.id], now), 0);
    const localSession = draft.sessions.find((item) => item.id === session.id);
    return (
      <article className="session-sheet" key={session.id}>
        <header className="session-sheet-header">
          <div className="session-number"><span>{String(index + 1).padStart(2, "0")}</span><small>{session.source === "daily" ? "Required" : "Added"}</small></div>
          <div className="session-heading-copy"><p>Practice session</p><h2>{session.label}</h2><span>{activities.length} activities · {formatDuration(session.allocatedSeconds)} window</span></div>
          <SessionCountdown session={session} timer={draft.sessionTimers[session.id]} now={now} onToggle={toggleSessionTimer} onComplete={completeSessionTimer} />
          <div className="session-progress"><strong>{complete}/{activities.length}</strong><span>finished</span></div>
          {localSession && <div className="session-header-actions"><button className="edit-session" onClick={() => openEditSession(localSession)} disabled={!isSessionEditable(localSession)} title={isSessionEditable(localSession) ? "Change this session recipe" : "A session recipe locks after timing or completion begins"}>Edit recipe</button><button className="icon-action danger" onClick={() => removeSession(localSession)} aria-label={`Remove ${localSession.label}`} title="Remove session"><Icon name="close" /></button></div>}
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
                  <div className="problem-title"><strong>{activity.title}</strong><span>{activity.notes ?? "Coding problem"}</span>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open on LeetCode ↗</a>}</div>
                  <ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                  <ResultFlag activityType={activity.type} outcome={draft.outcomes[activity.id] ?? activity.outcome} onChange={(outcome) => setOutcome(activity.id, outcome)} />
                  <PublicationControl status={publicationStatusFor(activity)} />
                  <button className={`star-control ${isStarred(activity.type, activity.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(activity.type, activity.questionId)} disabled={!activity.questionId} aria-label={`${isStarred(activity.type, activity.questionId) ? "Unstar" : "Star"} ${activity.title}`} title={activity.questionId ? "Keep this problem in your starred review set" : "A stable bank question is required to star this activity"}>★</button>
                  {isExtra && <button className="icon-action danger row-remove" onClick={() => removeActivity(activity.id)} aria-label={`Remove ${activity.title}`} title="Remove activity"><Icon name="close" /></button>}
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
                <div className="mock-topline"><span className={`type-chip ${item.type}`}>{typeLabel(item.type)}</span>{isExtra && <button className="icon-action danger" onClick={() => removeActivity(item.id)} aria-label={`Remove ${item.title}`} title="Remove activity"><Icon name="close" /></button>}</div>
                <h3>{item.title}</h3>
                <p>{item.prompt}</p>
                <div className="mock-controls">
                  <ActivityTimer activity={item} timer={draft.timers[item.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                  <ResultFlag activityType={item.type} outcome={draft.outcomes[item.id] ?? item.outcome} onChange={(outcome) => setOutcome(item.id, outcome)} />
                  <PublicationControl status={publicationStatusFor(item)} />
                  <button className={`star-control ${isStarred(item.type, item.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(item.type, item.questionId)} disabled={!item.questionId} aria-label={`${isStarred(item.type, item.questionId) ? "Unstar" : "Star"} ${item.title}`}>★</button>
                </div>
                <div className="publish-instruction">Finish the activity, then say <strong>“Publish this session”</strong> in the {item.type === "system_design" ? "system-design" : "behavioral"} task. Finished work is ready automatically.</div>
              </section>
            );
          })}
        </div>
      </article>
    );
  }

  function renderToday() {
    const totalToday = allTodayActivities.length;
    const focusTimer = focusedActivity ? draft.timers[focusedActivity.id] : undefined;
    const focusPublication = focusedActivity ? publicationStatusFor(focusedActivity) : "draft";
    const focusPhase = focusTimer?.completed
      ? focusPublication === "published" ? "In journal" : "Ready to publish"
      : focusTimer?.runningSince ? "Running now" : focusTimer?.startedAt ? "Paused, still focused" : "Not started";
    return (
      <>
        <section className="today-masthead">
          <div className="date-poster"><strong>{journal.date.slice(-2)}</strong><span>{new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</span></div>
          <div className="today-thesis"><span className="eyebrow">TODAY · {journal.focus.toUpperCase()}</span><h1>{totalToday ? `${totalToday} activities.` : "A clean page."}<br /><em>One honest record.</em></h1><p>{journal.note}</p></div>
          <div className="today-tally"><span className="yesterday-label">YESTERDAY · {readableDate(yesterdayDate, true)}</span><div><strong>{yesterdayCompleted.length}/{yesterdayEntries.length}</strong><span>activities finished</span></div><div><strong>{formatDuration(yesterdaySeconds)}</strong><span>time recorded</span></div><div><strong>{yesterdaySessions}</strong><span>session{yesterdaySessions === 1 ? "" : "s"} planned</span></div></div>
        </section>

        <section className={`orchestrator-rail ${focusedActivity ? "has-focus" : "empty"}`} aria-label="Current practice activity">
          <div className="orchestrator-signal"><span className={focusTimer?.runningSince ? "live" : ""} /><small>NOW</small></div>
          {focusedActivity ? <>
            <div className="orchestrator-focus"><span className={`type-mark ${focusedActivity.type}`}>{typeMark(focusedActivity.type)}</span><div><small>{focusPhase} · {focusedSession?.label ?? "Standalone practice"}</small><strong>{focusedActivity.title}</strong><span>{focusTimer?.startedAt ? `Started ${formatPracticeTimestamp(focusTimer.startedAt, true)}` : "The first start establishes the Pacific timeline."}</span></div></div>
            <div className="orchestrator-clock"><span>Recorded</span><strong>{formatClock(elapsed(focusTimer, now))}</strong><small>{PRACTICE_TIME_ZONE}</small></div>
            <div className="orchestrator-lifecycle" aria-label={`Lifecycle: ${focusPhase}`}><i className="done">Planned</i><b /><i className={focusTimer?.startedAt ? "done" : ""}>In progress</i><b /><i className={focusTimer?.completed ? "done" : ""}>Ready</i><b /><i className={focusPublication === "published" ? "done" : ""}>Journal</i></div>
            {focusedActivity.url && <a href={focusedActivity.url} target="_blank" rel="noreferrer">Open workspace ↗</a>}
          </> : <div className="orchestrator-empty"><strong>No focused activity.</strong><span>Start any stopwatch. Interview Arc will preserve that focus through pauses, app switches, and Pacific midnight.</span></div>}
        </section>

        <div className="today-actions"><div><h2>Today&apos;s sessions</h2><p>Each session countdown follows its activity recipe; activity stopwatches stay compact and independent.</p></div><div><button className="secondary-action" onClick={openNewActivity}>Add one activity</button><button className="primary-action" onClick={openNewSession}>＋ Add another session</button></div></div>
        <section className="session-stack">{allSessions.length ? allSessions.map(renderSession) : <div className="quiet-empty session-empty"><strong>No session planned yet.</strong><span>Add another session to choose up to six coding questions and one question from each available interview bank.</span></div>}</section>

        <section className="loose-section">
          <div className="section-title"><div><span className="eyebrow">STANDALONE PRACTICE</span><h2>Outside a full session</h2><p>Each card keeps only the controls you need: stopwatch, result, journal state, star, and remove.</p></div></div>
          {looseActivities.length === 0 ? <div className="quiet-empty"><strong>No standalone activities yet.</strong><span>Use “Add one activity” above to search a bank or paste a public LeetCode problem URL.</span></div> : <div className="loose-list">{looseActivities.map((activity) => <StandaloneActivityCard key={activity.id} title={activity.title} onRemove={() => removeActivity(activity.id)}><span className={`type-mark ${activity.type}`}>{typeMark(activity.type)}</span><div className="loose-activity-copy"><small>{typeLabel(activity.type)} · local draft</small><strong>{activity.title}</strong>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open reference ↗</a>}</div><ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} /><ResultFlag activityType={activity.type} outcome={draft.outcomes[activity.id] ?? activity.outcome} onChange={(outcome) => setOutcome(activity.id, outcome)} /><PublicationControl status={publicationStatusFor(activity)} /><button className={`star-control ${isStarred(activity.type, activity.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(activity.type, activity.questionId)} disabled={!activity.questionId} aria-label={`${isStarred(activity.type, activity.questionId) ? "Unstar" : "Star"} ${activity.title}`}>★</button></StandaloneActivityCard>)}</div>}
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
    const effortEntries = completedEntries.filter((entry) => entry.type === "leetcode" && entry.outcome && entry.elapsedSeconds > 0);
    const maxEffortMinutes = Math.max(1, ...effortEntries.map((entry) => entry.elapsedSeconds / 60));
    return (
      <section className="view-page journey-page">
        <header className="view-masthead journey-masthead"><span className="eyebrow">JOURNEY · PUBLISHED + TODAY&apos;S LIVE RECORD</span><h1>Your practice,<br /><em>mapped over time.</em></h1><p>This page counts only recorded work. Explore consistency, outcomes, topic coverage, effort, and the exact days behind every trend.</p></header>
        <div className="stat-ledger">
          <article className="stat-block coding-stat"><span>Coding solved</span><strong>{codingSolved}</strong><small>{codingFailed} failed attempt{codingFailed === 1 ? "" : "s"}</small></article>
          <article className="stat-block system-stat"><span>System designs</span><strong>{systemCompleted}</strong><small>completed or published</small></article>
          <article className="stat-block behavior-stat"><span>Behavioral answers</span><strong>{behaviorCompleted}</strong><small>completed or published</small></article>
          <article className="stat-block time-stat"><span>Recorded time</span><strong>{formatDuration(totalRecordedSeconds)}</strong><small>from completed activity timers</small></article>
        </div>

        <div className="journey-pulse" aria-label="Practice consistency summary">
          <article><span>Current streak</span><strong>{streaks.current}</strong><small>day{streaks.current === 1 ? "" : "s"}</small></article>
          <article><span>Longest streak</span><strong>{streaks.longest}</strong><small>consecutive days</small></article>
          <article><span>Active days</span><strong>{activeDates.length}</strong><small>with completed work</small></article>
          <article><span>Per active day</span><strong>{activeDayAverage.toFixed(1)}</strong><small>activities on average</small></article>
          <article className={momentumDelta >= 0 ? "positive" : "negative"}><span>7-day momentum</span><strong>{momentumDelta > 0 ? "+" : ""}{momentumDelta}%</strong><small>{recentSeven} now · {priorSeven} prior</small></article>
        </div>

        <article className="chart-sheet heatmap-sheet">
          <div className="chart-heading"><div><span className="eyebrow">365-DAY PRACTICE MAP</span><h2>Consistency at a glance</h2><p>Color measures finished coding and mock-interview work. Failed attempts remain visible in each day&apos;s detail without inflating the shade.</p></div><div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>More</span></div></div>
          <div className="heatmap-scroll">
            <div className="heatmap-days"><span>M</span><span>W</span><span>F</span></div>
            <div className="practice-heatmap" role="grid" aria-label="Completed practice during the last 365 days">
              {heatmapDays.map((day) => {
                const level = day.count === 0 ? 0 : Math.min(4, day.count);
                return <button
                  key={day.date}
                  className={`heat-day level-${level} ${journeyDate === day.date ? "selected" : ""}`}
                  onClick={() => setJourneyDate(day.date)}
                  aria-label={`${readableDate(day.date)}: ${day.count} finished activities, ${day.failed} failed attempts`}
                ><span role="tooltip"><strong>{readableDate(day.date, true)}</strong>{day.count} finished · {day.coding} coding · {day.system} system · {day.behavioral} behavioral{day.failed ? ` · ${day.failed} failed` : ""}<small>{formatDuration(day.seconds)} recorded</small></span></button>;
              })}
            </div>
          </div>
          <div className="heatmap-foot"><span>{readableDate(heatmapDays[0].date, true)}</span><span>Select a square to inspect the day</span><span>{readableDate(journal.date, true)}</span></div>
          {journeyDate && <div className="journey-day-inspector">
            <div><span className="eyebrow">SELECTED DAY</span><h3>{readableDate(journeyDate)}</h3><p>{selectedJourneyEntries.length ? `${selectedJourneyEntries.length} completed record${selectedJourneyEntries.length === 1 ? "" : "s"}.` : "No completed work was recorded on this day."}</p></div>
            <div>{selectedJourneyEntries.map((entry) => <button key={entry.id} onClick={() => setSelectedEntry(entry)}><span className={`type-mark ${entry.type}`}>{typeMark(entry.type)}</span><i><strong>{entry.title}</strong><small>{typeLabel(entry.type)} · {entry.elapsedSeconds ? formatDuration(entry.elapsedSeconds) : "time not recorded"}</small></i><b>Read →</b></button>)}</div>
          </div>}
        </article>

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
                {plotPoints.filter((point) => point.value > 0).map((point) => <circle key={point.day.date} cx={point.x} cy={point.y} r={journeyDate === point.day.date ? 5.5 : 3.5} className={journeyDate === point.day.date ? "selected" : ""} tabIndex={0} role="button" onClick={() => setJourneyDate(point.day.date)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setJourneyDate(point.day.date); }} aria-label={`${readableDate(point.day.date)}: ${point.value} ${journeyMetric === "time" ? "minutes" : "activities"}`}><title>{readableDate(point.day.date, true)} · {point.value} {journeyMetric === "time" ? "min" : "finished"}</title></circle>)}
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
            {journeyTopic && <div className="topic-records"><strong>{journeyTopic}</strong>{selectedTopicEntries.map((entry) => <button key={entry.id} onClick={() => setSelectedEntry(entry)}>{entry.title}<span>{readableDate(entry.date, true)} →</span></button>)}</div>}
          </article>

          <article className="chart-sheet effort-sheet">
            <div className="chart-heading"><div><span className="eyebrow">EFFORT MAP</span><h2>Time spent versus outcome</h2><p>Each point is one coding attempt. Select a point to open its record.</p></div></div>
            {effortEntries.length ? <svg className="effort-map" viewBox="0 0 800 245" role="img" aria-label="Coding attempts plotted by elapsed time and outcome">
              {[{ label: "Solved", y: 52 }, { label: "After review", y: 122 }, { label: "Failed", y: 192 }].map((row) => <g key={row.label}><line x1="125" x2="760" y1={row.y} y2={row.y} /><text x="18" y={row.y + 4}>{row.label}</text></g>)}
              {effortEntries.map((entry) => {
                const minutes = entry.elapsedSeconds / 60;
                const y = entry.outcome === "solved" ? 52 : entry.outcome === "solved_after_reviewing_approach" ? 122 : 192;
                const x = 125 + (minutes / maxEffortMinutes) * 635;
                return <circle key={entry.id} cx={x} cy={y} r="7" className={entry.outcome} tabIndex={0} role="button" onClick={() => setSelectedEntry(entry)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedEntry(entry); }} aria-label={`${entry.title}, ${Math.round(minutes)} minutes, ${outcomeLabel(entry.outcome)}`}><title>{entry.title} · {Math.round(minutes)} min · {outcomeLabel(entry.outcome)}</title></circle>;
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
    const activePastFilterCount = libraryAttentionFilters.length;
    const hasPastFilters = libraryTypeFilters.length > 0 || activePastFilterCount > 0;
    const visibleRecordCount = groupedLog.reduce((sum, [, entries]) => sum + entries.length, 0);
    return (
      <section className="view-page library-page">
        <header className="view-masthead"><span className="eyebrow">PAST · COMPLETED WORK</span><h1>Read the journey<br /><em>like a field journal.</em></h1><p>Past contains finished activity timers and published case files—never planned work or result flags by themselves.</p></header>
        <div className="past-control-deck">
          <div className="library-toolbar bank-toolbar compact-toolbar past-toolbar">
            <div className="bank-filter-rail primary-bank-controls past-filter-rail">
              <div className="filter-row type-control" role="group" aria-label="Filter past practice by type">{(["leetcode", "system_design", "behavioral"] as const).map((filter) => <button key={filter} className={libraryTypeFilters.includes(filter) ? "active" : ""} aria-pressed={libraryTypeFilters.includes(filter)} onClick={() => toggleTypeFilter(filter)}>{typeLabel(filter)}</button>)}</div>
              <div className="bank-icon-tools" aria-label="Past tools">
                {hasPastFilters && <button type="button" className="filter-clear" onClick={() => { setLibraryTypeFilters([]); setLibraryAttentionFilters([]); }}>Clear</button>}
                <button className={`collection-toggle icon-tool ${libraryStarFilter ? "active" : ""}`} onClick={() => setLibraryStarFilter((current) => !current)} aria-pressed={libraryStarFilter} aria-label={libraryStarFilter ? "Show all completed practice" : "Show starred completed practice"} title={libraryStarFilter ? "Showing starred practice" : "Show starred practice"}><Icon name="star" /></button>
                <details className={`control-menu icon-menu ${activePastFilterCount > 0 ? "active" : ""}`}>
                  <summary aria-label={`More filters${activePastFilterCount ? `, ${activePastFilterCount} active` : ""}`} title={`${activePastFilterCount || "No"} active filters`}><Icon name="filter" />{activePastFilterCount > 0 && <i>{activePastFilterCount}</i>}</summary>
                  <div className="control-popover compact-filter-popover attention-menu">{attentionGroups.map((group) => <div className={`compact-filter-group ${group.tone}`} role="group" aria-label={group.label} key={group.label}>{group.options.map((option) => <button type="button" key={option.value} className={libraryAttentionFilters.includes(option.value) ? "active" : ""} aria-pressed={libraryAttentionFilters.includes(option.value)} onClick={() => toggleAttentionFilter(option.value)}><span>{option.label}</span><small>{attentionFilterCount(option.value)}</small><i aria-hidden="true">✓</i></button>)}</div>)}</div>
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
          <div className="dated-log">
            {groupedLog.length ? groupedLog.map(([date, entries]) => <section className="log-day" id={`log-date-${date}`} key={date}><header><time>{readableDate(date)}</time><span>{entries.length} record{entries.length === 1 ? "" : "s"} · Pacific day</span></header><div className="log-day-entries">{entries.map((entry) => <article className={`log-entry ${entry.type}`} key={entry.id}><button className="log-entry-open" onClick={() => setSelectedEntry(entry)} aria-label={`Read ${entry.title}`}><span className={`type-mark ${entry.type}`}>{typeMark(entry.type)}</span><div className="log-entry-copy"><small>{typeLabel(entry.type)} · {entry.status}{entry.sessionId ? " · session activity" : " · standalone"}</small><strong>{entry.title}</strong>{meaningfulSubtitle(entry.subtitle) && <span>{meaningfulSubtitle(entry.subtitle)}</span>}<div className="entry-badges">{entry.review?.status === "due" && <i className="review-badge due">Due now</i>}{entry.review?.status === "scheduled" && <i className="review-badge">Review {entry.review.dueDate}</i>}{Boolean(entry.personalNote?.trim() || entry.pinnedNotes?.length) && <i className="note-badge">Pinned note</i>}{entry.outcome === "solved" && <i className="independent-badge">Solved</i>}{entry.outcome === "solved_after_reviewing_approach" && <i className="help-badge">Solved with help</i>}{entry.outcome === "failed" && <i className="failure-badge">Failed attempt</i>}</div>{entry.startedAt && <span className="entry-time-range">{formatPracticeTimestamp(entry.startedAt, true)} → {entry.endedAt ? formatPracticeTimestamp(entry.endedAt, true) : "Paused"}</span>}</div><div className="log-entry-meta"><strong>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "—"}</strong><span>{entry.type === "leetcode" ? outcomeLabel(entry.outcome) : entry.artifact ? "Published record" : entry.status}</span></div></button><div className="log-entry-actions"><StaticResultFlag outcome={entry.outcome} label={resultLabel(entry.outcome, entry.type)} /><button className={`star-control ${isStarred(entry.type, entry.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(entry.type, entry.questionId)} disabled={!entry.questionId} aria-label={`${isStarred(entry.type, entry.questionId) ? "Unstar" : "Star"} ${entry.title}`} title="Star this problem"><Icon name="star" /></button></div></article>)}</div></section>) : <div className="quiet-empty library-empty"><strong>No completed work in this filter yet.</strong><span>Try another filter, or finish an activity to add it to the field journal.</span></div>}
          </div>
          <aside className="log-calendar"><span className="eyebrow">JUMP TO A DAY</span><h2>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</h2><div className="calendar-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div className="calendar-mini">{calendarDays.map((day) => day.hasEntries ? <button key={day.key} onClick={() => scrollToLogDate(day.key)} title={`Jump to ${day.key}`}>{day.day}<i /></button> : <span key={day.key}>{day.day}</span>)}</div><div className="calendar-dates">{groupedLog.map(([date]) => <button key={date} onClick={() => scrollToLogDate(date)}>{readableDate(date, true)} <span>↘</span></button>)}</div></aside>
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
    const finishedCount = bankEntries.filter((entry) => entry.finished).length;
    const finishedPercent = bankEntries.length ? Math.round((finishedCount / bankEntries.length) * 100) : 0;
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
      <section className="view-page banks-page">
        <header className="view-masthead banks-masthead"><span className="eyebrow">PROBLEM BANKS · ALL PRACTICE SOURCES</span><h1>Choose the next thing<br /><em>worth practicing.</em></h1><div className="banks-masthead-meta"><p>Browse every coding, system-design, and behavioral prompt in one place. “Practice today” adds the question to standalone practice and takes you directly to Today.</p><div className="bank-progress-meter" style={{ background: `conic-gradient(var(--signal-dark) ${finishedPercent}%, #e4e9e1 ${finishedPercent}% 100%)` }} aria-label={`${finishedCount} of ${bankEntries.length} problems finished`}><span><strong>{finishedCount}</strong><small>of {bankEntries.length}</small></span></div></div></header>
        <div className="bank-totals" aria-label="Question bank totals">
          <article className="leetcode"><strong>{bankFor("leetcode").length}</strong><span>Coding problems</span></article>
          <article className="system_design"><strong>{bankFor("system_design").length}</strong><span>System designs</span></article>
          <article className="behavioral"><strong>{bankFor("behavioral").length}</strong><span>Behavioral prompts</span></article>
        </div>
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
        <div className="problem-bank-list" tabIndex={0} aria-label="Problem bank results">
          {visibleEntries.map(({ type, question, finished, latestAttempt }) => { const blockedToday = isQuestionBlocked(question, todayBlocked); return <article className={`problem-bank-entry ${type}`} key={`${type}-${question.id}`}>
            <span className={`type-mark ${type}`}>{typeMark(type)}</span>
            <div className="problem-bank-copy"><small>{typeLabel(type)}{question.difficulty ? ` · ${question.difficulty}` : ""}{question.complexity ? ` · ${displayComplexity(question.complexity)}` : ""} · {finished ? "finished" : "to practice"}</small><button className="problem-title-button" onClick={() => setSelectedProblem({ type, question })}>{question.title}</button>{question.prompt && question.prompt !== question.title && <p>{question.prompt}</p>}{question.url && <a href={question.url} target="_blank" rel="noreferrer">{question.solutionReference ? "Open question & solution references ↗" : "Open problem ↗"}</a>}</div>
            <div className="bank-entry-meta"><span>{question.targetMinutes} min estimate</span>{question.problemNumber && <small>#{question.problemNumber}{typeof question.acceptanceRate === "number" ? ` · ${question.acceptanceRate.toFixed(1)}% acceptance` : ""}</small>}{question.companySignals?.[0] && <small>{question.companySignals[0].company} frequency {question.companySignals[0].frequencyScore}/{question.companySignals[0].frequencyScale} · {question.companySignals[0].window}</small>}{question.answerFormat && <small>{question.answerFormat} answer · {question.frequency ?? "medium"} frequency</small>}{question.solutionReference && <small>Reference solution{question.referenceAccess === "may_require_sign_in" ? " may require sign-in" : " available"}</small>}<small className={`content-tags ${type}`}>{tagsForEntry(type, question).slice(0, 4).map((tag) => `#${tag}`).join("  ")}</small></div>
            <div className="bank-entry-actions"><StaticResultFlag outcome={latestAttempt?.outcome} /><button className={`icon-action ${isStarred(type, question.id) ? "active starred" : ""}`} onClick={() => toggleProblemStar(type, question.id)} aria-label={`${isStarred(type, question.id) ? "Unstar" : "Star"} ${question.title}`} title={isStarred(type, question.id) ? "Unstar" : "Star"}><Icon name="star" /></button><button className="icon-action" onClick={() => setSelectedProblem({ type, question })} aria-label={`View solution for ${question.title}`} title="View solution"><Icon name="book" /></button><button className="icon-action practice" onClick={() => addBankQuestionToToday(question, type)} disabled={blockedToday} aria-label={blockedToday ? `${question.title} is already on Today` : `Practice ${question.title} today`} title={blockedToday ? "Already on Today" : "Practice today"}><Icon name="plus" /></button></div>
          </article>; })}
          {!visibleEntries.length && <div className="quiet-empty bank-empty"><strong>No questions match these filters.</strong><span>Change type, progress, level, or search text.</span></div>}
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
    const resultFilters = composerAttentionFilters.filter((filter) => filter === "solved" || filter === "helped" || filter === "failed");
    const matchesReview = (filter: ComposerAttentionFilter) => filter === "due" ? dueNow : needsReview;
    const matchesResult = (filter: ComposerAttentionFilter) => filter === "solved"
      ? latestAttempt?.outcome === "solved"
      : filter === "helped" ? latestAttempt?.outcome === "solved_after_reviewing_approach" : latestAttempt?.outcome === "failed";
    return question.active
      && (!needle || question.title.toLowerCase().includes(needle) || question.topics.some((topic) => topic.toLowerCase().includes(needle)))
      && (reviewFilters.length === 0 || reviewFilters.some(matchesReview))
      && (resultFilters.length === 0 || resultFilters.some(matchesResult))
      && (composerLevelFilters.length === 0 || (questionLevel(question) !== null && composerLevelFilters.includes(questionLevel(question)!)))
      && (!composerStarFilter || isStarred(composer.type, question.id));
  });
  const visibleQuestionEntries = filteredQuestionEntries.slice(0, composerVisibleCount);
  const derivedUrl = deriveQuestionFromUrl(composer.query, composer.type, activeBank);
  const derivedBlocked = Boolean(derivedUrl && isQuestionBlocked({ id: derivedUrl.questionId ?? `personal-${composer.type}-${slugify(derivedUrl.title)}`, title: derivedUrl.title, url: derivedUrl.url, topics: [], targetMinutes: derivedUrl.targetMinutes, active: true }, composerBlocked));
  const canSaveActivity = !derivedBlocked && (composer.type === "leetcode" ? Boolean(composer.selectedId || derivedUrl) : Boolean(composer.selectedId || derivedUrl || composer.query.trim()));
  const activeComposerFilterCount = composerAttentionFilters.length + composerLevelFilters.length;
  const hasComposerFilters = activeComposerFilterCount > 0 || composerStarFilter;
  const composerAttentionCount = (filter: ComposerAttentionFilter) => composerQuestionEntries.filter((entry) => {
    if (filter === "due") return entry.dueNow;
    if (filter === "needs_review") return entry.needsReview;
    if (filter === "solved") return entry.latestAttempt?.outcome === "solved";
    if (filter === "helped") return entry.latestAttempt?.outcome === "solved_after_reviewing_approach";
    return entry.latestAttempt?.outcome === "failed";
  }).length;
  const composerLevelCount = (level: "easy" | "medium" | "hard") => composerQuestionEntries.filter((entry) => questionLevel(entry.question) === level).length;
  const toggleComposerAttentionFilter = (filter: ComposerAttentionFilter) => {
    setComposerVisibleCount(20);
    setComposerAttentionFilters((current) => current.includes(filter) ? current.filter((candidate) => candidate !== filter) : [...current, filter]);
  };
  const toggleComposerLevelFilter = (filter: "easy" | "medium" | "hard") => {
    setComposerVisibleCount(20);
    setComposerLevelFilters((current) => current.includes(filter) ? current.filter((candidate) => candidate !== filter) : [...current, filter]);
  };
  const clearComposerFilters = () => {
    setComposerAttentionFilters([]);
    setComposerLevelFilters([]);
    setComposerStarFilter(false);
    setComposerVisibleCount(20);
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
  const selectedProblemProfile = selectedProblem ? profileFor(selectedProblem.type, selectedProblem.question.id) : undefined;
  const selectedProblemAttempts = selectedProblem
    ? libraryEntries.filter((entry) => entry.type === selectedProblem.type && entry.questionId === selectedProblem.question.id)
    : [];
  const selectedProblemRevisions = selectedProblem
    ? draft.solutionRevisions.filter((revision) => revision.specialty === selectedProblem.type && revision.questionId === selectedProblem.question.id)
    : [];
  const selectedEntryActivityId = selectedEntry?.artifact?.activityId || (selectedEntry && !selectedEntry.id.includes("/") ? selectedEntry.id : "");
  const selectedEntryTurns = selectedEntry?.transcriptTurns ?? [];
  const selectedEntryClips = selectedEntry?.audioClips ?? [];
  const selectedArtifactTranscriptIndex = selectedEntry?.artifact?.sections.findIndex((section) => /conversation transcript|full transcript|raw exchange/i.test(section.title)) ?? -1;
  const practiceRecordLoading = Boolean(selectedEntryActivityId && loadedPracticeRecordId !== selectedEntryActivityId);

  useEffect(() => {
    if (!selectedEntryActivityId) return;
    const controller = new AbortController();
    void fetch(`/api/practice-record?activityId=${encodeURIComponent(selectedEntryActivityId)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ turns: TranscriptTurn[]; notes: PracticeNote[]; audioClips: AudioClip[] }> : null)
      .then((record) => {
        if (!record) {
          setLoadedPracticeRecordId(selectedEntryActivityId);
          return;
        }
        setSelectedEntry((current) => current && (current.artifact?.activityId || current.id) === selectedEntryActivityId
          ? { ...current, transcriptTurns: record.turns, pinnedNotes: record.notes, audioClips: record.audioClips }
          : current);
        setLoadedPracticeRecordId(selectedEntryActivityId);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Unable to load the practice transcript.");
          setLoadedPracticeRecordId(selectedEntryActivityId);
        }
      });
    return () => controller.abort();
  }, [selectedEntryActivityId]);

  return (
    <>
    <main className="app-shell" aria-hidden={arrivalState !== "entered"}>
      <a className="skip-link" href="#practice-content">Skip to practice</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")}><span className="brand-mark">IA</span><span>Interview Arc</span></button>
        <nav className="primary-nav" aria-label="Primary navigation">{([[
          "today", "Today"], ["journey", "Journey"], ["library", "Past"], ["banks", "Problem banks"]] as [View, string][]).map(([id, label], index) => <button key={id} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
        <div className="sidebar-status"><span className={[...Object.values(draft.timers), ...Object.values(draft.sessionTimers)].some((timer) => timer.runningSince) ? "live" : ""} /><div><strong>{[...Object.values(draft.timers), ...Object.values(draft.sessionTimers)].some((timer) => timer.runningSince) ? "Timer running" : hydrated ? "Draft saved locally" : "Loading draft"}</strong><small>Session countdown + one activity stopwatch</small></div></div>
        <div className="profile"><span>WX</span><div><strong>Wenk Xu</strong><small>Interview journey · 2026</small></div></div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div><span>{readableDate(journal.date)}</span><strong>{view === "today" ? "Today’s work" : view === "journey" ? "Statistics" : view === "library" ? "Dated practice log" : "Question sources"}</strong></div>
          <div>
            <div className={`music-dock ${ambientPlaying ? "active" : ""}`}>
              <button onClick={toggleAmbientSound} aria-pressed={ambientPlaying} title={ambientPlaying ? "Pause music" : "Play music"}><span aria-hidden="true">{ambientPlaying ? "Ⅱ" : "▶"}</span><i><small>{ambientPlaying ? "PLAYING" : "PAUSED"}</small><strong>{trackName}</strong></i></button>
              <button className="music-next" onClick={previousAmbientTrack} aria-label="Previous music track" title={`Previous track · ${trackArtist}`}>↞</button>
              <button className="music-next" onClick={nextAmbientTrack} aria-label="Next music track" title={`Next track · ${trackArtist}`}>↠</button>
              <label><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} aria-label="Music volume" /></label>
              <MusicPlaylist playlist={ambientPlaylist} currentIndex={ambientTrackIndex} onSelect={chooseAmbientTrack} />
            </div>
            <button className={`atmosphere-toggle ${petalsEnabled ? "active" : ""}`} onClick={togglePetals} aria-pressed={petalsEnabled} title={petalsEnabled ? "Pause cherry blossoms" : "Resume cherry blossoms"}><span aria-hidden="true">✦</span>{petalsEnabled ? "Petals" : "Still"}</button>
            {view === "today" && pipSupported && <button className="secondary-action" onClick={openNowWindow}>{pipWindow ? "Now window open" : "Pop out timer"}</button>}
            <button className="secondary-action" onClick={() => setIntegrationOpen(true)}>Connect</button>
            <button className="secondary-action" onClick={exportDraft}>Export today</button>
          </div>
        </header>
        <div className="page-content" id="practice-content">{view === "today" && renderToday()}{view === "journey" && renderJourney()}{view === "library" && renderLibrary()}{view === "banks" && renderBanks()}</div>
      </section>

      {composer.open && <div className="modal-backdrop" role="presentation" onMouseDown={() => setComposer(EMPTY_COMPOSER)}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setComposer(EMPTY_COMPOSER)} aria-label="Close">×</button>
          <span className="eyebrow">BUILD TODAY&apos;S WORK</span>
          <h2 id="composer-title">{composer.editingSessionId ? "Edit session recipe" : composer.editingId ? "Edit this activity" : composer.mode === "session" ? "Build another session" : "Add one activity"}</h2>
          {!composer.editingId && !composer.editingSessionId && <div className="composer-mode">
            <button className={composer.mode === "session" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, mode: "session" }))}>Full session</button>
            <button className={composer.mode === "activity" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, mode: "activity" }))}>Single activity</button>
          </div>}
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
          </div> : <form onSubmit={saveActivity}>
            <div className="type-selector" role="group" aria-label="Practice type">{(["leetcode", "system_design", "behavioral"] as const).map((type) => <button type="button" key={type} className={`${type} ${composer.type === type ? "active" : ""}`} onClick={() => { setComposerVisibleCount(20); setComposer((current) => ({ ...current, type, query: "", selectedId: "", minutes: type === "leetcode" ? "30" : "60" })); }}>{typeLabel(type)}</button>)}</div>
            <div className="activity-picker-heading"><span>{composer.type === "leetcode" ? "Search the bank or paste a LeetCode URL" : `Search the ${typeLabel(composer.type).toLowerCase()} bank, paste a URL, or type a new title`}</span>{hasComposerFilters && <button type="button" className="filter-clear" onClick={clearComposerFilters}>Clear</button>}</div>
            <div className="activity-picker-toolbar">
              <label className="bank-search-bar activity-picker-search"><span className="bank-search-icon" aria-hidden="true"><svg viewBox="0 0 20 20" width="16" height="16" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12.8 12.8 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span><input autoFocus type="search" value={composer.query} onChange={(event) => { setComposerVisibleCount(20); setComposer((current) => ({ ...current, query: event.target.value, selectedId: "" })); }} placeholder={composer.type === "leetcode" ? "Search titles and topics, or paste a LeetCode URL" : "Search titles and topics, paste a URL, or enter a title"} aria-label="Search activity questions" />{composer.query ? <button type="button" className="bank-search-clear" onClick={() => { setComposerVisibleCount(20); setComposer((current) => ({ ...current, query: "", selectedId: "" })); }} aria-label="Clear search">×</button> : <span className="bank-search-clear-spacer" aria-hidden="true" />}<span className="bank-result-count" aria-live="polite">{filteredQuestionEntries.length}</span></label>
              <div className="bank-icon-tools activity-picker-tools"><button type="button" className={`collection-toggle icon-tool ${composerStarFilter ? "active" : ""}`} onClick={() => { setComposerVisibleCount(20); setComposerStarFilter((current) => !current); }} aria-pressed={composerStarFilter} aria-label={composerStarFilter ? "Show all questions" : "Show starred questions"} title={composerStarFilter ? "Showing starred questions" : "Show starred questions"}><Icon name="star" /></button><details className={`control-menu icon-menu ${activeComposerFilterCount > 0 ? "active" : ""}`}><summary aria-label={`Activity filters${activeComposerFilterCount ? `, ${activeComposerFilterCount} active` : ""}`} title={`${activeComposerFilterCount || "No"} active filters`}><Icon name="filter" />{activeComposerFilterCount > 0 && <i>{activeComposerFilterCount}</i>}</summary><div className="control-popover compact-filter-popover activity-filter-menu"><div className="compact-filter-group review" role="group" aria-label="Review filters">{([['due', 'Due now'], ['needs_review', 'Needs review']] as const).map(([filter, label]) => <button type="button" key={filter} className={composerAttentionFilters.includes(filter) ? "active" : ""} aria-pressed={composerAttentionFilters.includes(filter)} onClick={() => toggleComposerAttentionFilter(filter)}><span>{label}</span><small>{composerAttentionCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div><div className="compact-filter-group result" role="group" aria-label="Result filters">{([['solved', 'Solved'], ['helped', 'Solved with help'], ['failed', 'Failed']] as const).map(([filter, label]) => <button type="button" key={filter} className={composerAttentionFilters.includes(filter) ? "active" : ""} aria-pressed={composerAttentionFilters.includes(filter)} onClick={() => toggleComposerAttentionFilter(filter)}><span>{label}</span><small>{composerAttentionCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div><div className="compact-filter-group difficulty" role="group" aria-label="Difficulty filters">{(["easy", "medium", "hard"] as const).map((filter) => <button type="button" key={filter} className={composerLevelFilters.includes(filter) ? "active" : ""} aria-pressed={composerLevelFilters.includes(filter)} onClick={() => toggleComposerLevelFilter(filter)}><span>{filter[0].toUpperCase() + filter.slice(1)}</span><small>{composerLevelCount(filter)}</small><i aria-hidden="true">✓</i></button>)}</div></div></details></div>
            </div>
            {derivedUrl && !composer.selectedId && <div className={`derived-question ${derivedBlocked ? "blocked" : ""}`}><span>{derivedUrl.questionId ? "Question matched in the bank" : "New personal bank question"}</span><strong>{derivedUrl.title}</strong><small>{derivedUrl.url}</small>{derivedBlocked && <em>Already on Today</em>}</div>}
            {!derivedUrl && <div className="bank-results" onScroll={(event) => { const list = event.currentTarget; if (list.scrollTop + list.clientHeight >= list.scrollHeight - 72 && composerVisibleCount < filteredQuestionEntries.length) setComposerVisibleCount((current) => Math.min(filteredQuestionEntries.length, current + 20)); }}>{visibleQuestionEntries.length ? visibleQuestionEntries.map(({ question, latestAttempt, blockedToday }) => <button type="button" className={`${composer.selectedId === question.id ? "selected" : ""} ${blockedToday ? "blocked" : ""}`} key={question.id} onClick={() => selectBankQuestion(question)} disabled={blockedToday} aria-label={blockedToday ? `${question.title} is already on Today` : `Select ${question.title}`}><span className={`type-mark ${composer.type}`}>{typeMark(composer.type)}</span><div><strong>{question.title}</strong><small>{question.difficulty ? `${question.difficulty} · ` : ""}{question.topics.join(" · ")}{blockedToday ? `${question.topics.length || question.difficulty ? " · " : ""}Already on Today` : ""}</small></div><StaticResultFlag outcome={latestAttempt?.outcome} /></button>) : <p className="no-results">{composer.type === "leetcode" ? "No bank match. Paste a public LeetCode problem URL to create a personal bank question automatically." : "No bank match. Paste a public URL or enter a custom title to create a personal bank question."}</p>}{visibleQuestionEntries.length < filteredQuestionEntries.length && <span className="picker-load-status">Scroll for more · {filteredQuestionEntries.length - visibleQuestionEntries.length} remaining</span>}</div>}
            <label className="minutes-field"><span>Planning estimate in minutes</span><input type="number" min="1" max="360" value={composer.minutes} onChange={(event) => setComposer((current) => ({ ...current, minutes: event.target.value }))} /></label>
            <button className="primary-action full-width" type="submit" disabled={!canSaveActivity}>{composer.editingId ? "Save changes" : "Add to today"}</button>
          </form>}
        </section>
      </div>}

      {integrationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setIntegrationOpen(false)}><section className="composer integration-dialog" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setIntegrationOpen(false)} aria-label="Close">×</button><span className="eyebrow">ONE DURABLE PRACTICE RECORD</span><h2 id="integration-title">Connect Interview Arc tools</h2><p>One personal token connects two separate tools to the same Interview Arc record. Codex specialists save activity transcripts, pinned notes, reviews, and finalization drafts; the coordinator alone turns those drafts into the published journal. The Chrome companion controls LeetCode timers and results. The token is shown once and stored as a secure digest.</p>{integrationToken ? <><label className="token-field"><span>Personal connection token</span><input readOnly value={integrationToken} onFocus={(event) => event.currentTarget.select()} /></label><button className="primary-action full-width" onClick={copyConnectionToken}>Copy token</button><div className="integration-steps"><strong>Connect each tool separately</strong><ol><li><strong>Codex practice bridge:</strong> set <code>INTERVIEW_ARC_MCP_TOKEN</code> before opening Codex in this trusted project. Specialists append only activity-related exchanges to D1; the coordinator creates the Git case files when you say “Publish all pending practice.”</li><li><strong>LeetCode Chrome companion:</strong> paste the same token into the loaded extension. The side panel can control the current coding activity while you work on LeetCode.</li></ol></div></> : <button className="primary-action full-width" disabled={integrationBusy} onClick={createConnectionToken}>{integrationBusy ? "Creating…" : "Create personal connection token"}</button>}<small className="integration-warning">Treat this token like a password. Create a new one if it is ever shared accidentally.</small></section></div>}

      {selectedEntry && <div className="letter-backdrop" role="presentation" onMouseDown={() => setSelectedEntry(null)}>
        <article className="reading-letter case-file-shell" role="dialog" aria-modal="true" aria-labelledby="letter-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="letter-close icon-action" onClick={() => setSelectedEntry(null)} aria-label="Close case file" title="Close"><Icon name="close" /></button>
          <aside className="case-toc" aria-label="Case file contents"><span>Contents</span><nav><a href="#case-summary">Overview</a>{Boolean(selectedEntry.personalNote?.trim() || selectedEntry.pinnedNotes?.length) && <a href="#case-notes">Notes</a>}<a href="#case-facts">Timeline</a>{selectedEntry.artifact?.sections.map((section, index) => <a key={`${section.title}-${index}`} href={`#case-${slugify(section.title)}-${index}`}>{section.title}</a>)}{selectedEntryTurns.length > 0 && selectedArtifactTranscriptIndex < 0 && <a href="#case-transcript">Conversation transcript</a>}</nav></aside>
          <div className="case-document">
            <header id="case-summary"><div><span className={`type-chip ${selectedEntry.type}`}>{typeLabel(selectedEntry.type)}</span><time>{readableDate(selectedEntry.date)} · Pacific</time></div><div className="case-title-row"><h2 id="letter-title">{selectedEntry.title}</h2><div className="case-title-actions"><button className={`star-control ${isStarred(selectedEntry.type, selectedEntry.questionId) ? "starred" : ""}`} onClick={() => toggleProblemStar(selectedEntry.type, selectedEntry.questionId)} disabled={!selectedEntry.questionId} aria-label={`${isStarred(selectedEntry.type, selectedEntry.questionId) ? "Unstar" : "Star"} ${selectedEntry.title}`} title="Star this problem"><Icon name="star" /></button><button className="icon-action note-add" onClick={() => openNoteComposer()} disabled={!selectedEntryActivityId} aria-label="Add a note" title="Add a note"><Icon name="note" /><i><Icon name="plus" /></i></button></div></div>{meaningfulSubtitle(selectedEntry.subtitle) && <p>{meaningfulSubtitle(selectedEntry.subtitle)}</p>}{selectedEntry.questionId && <button className="solution-link-button" onClick={() => { const question = bankFor(selectedEntry.type).find((candidate) => candidate.id === selectedEntry.questionId); if (question) { setSelectedEntry(null); setSelectedProblem({ type: selectedEntry.type, question }); } }}>View solution →</button>}</header>
            {Boolean(selectedEntry.personalNote?.trim() || selectedEntry.pinnedNotes?.length) && <aside className="pinned-notes" id="case-notes" aria-label="Pinned practice notes"><span>NOTES</span>{selectedEntry.personalNote?.trim() && <article><div className="note-actions"><button onClick={() => openNoteComposer("personal")} aria-label="Edit personal note" title="Edit"><Icon name="edit" /></button><button onClick={() => void deleteCaseNote("personal")} aria-label="Delete personal note" title="Delete"><Icon name="trash" /></button></div><MarkdownBody source={selectedEntry.personalNote} /></article>}{selectedEntry.pinnedNotes?.map((note) => <article key={note.id}><header><small>{note.kind}</small><div className="note-actions"><button onClick={() => openNoteComposer(note)} aria-label={`Edit ${note.kind} note`} title="Edit"><Icon name="edit" /></button><button onClick={() => void deleteCaseNote(note.id)} aria-label={`Delete ${note.kind} note`} title="Delete"><Icon name="trash" /></button></div></header><MarkdownBody source={note.body} /></article>)}</aside>}
            {noteComposerOpen && <form className="case-note-composer" onSubmit={(event) => { event.preventDefault(); void saveCaseNote(); }}><label htmlFor="case-note">{editingNoteId ? "Edit note" : "Add a note"}</label><textarea id="case-note" autoFocus value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="A concise reminder, mistake, or pattern to keep visible…" /><div><button type="button" onClick={() => { setNoteComposerOpen(false); setEditingNoteId(""); setNoteDraft(""); }}>Cancel</button><button type="submit" disabled={noteBusy || !noteDraft.trim()}>{noteBusy ? "Saving…" : "Save note"}</button></div></form>}
            <div className="letter-facts" id="case-facts"><div><span>Status</span><strong>{selectedEntry.status}</strong></div><div><span>Time recorded</span><strong>{selectedEntry.elapsedSeconds ? formatClock(selectedEntry.elapsedSeconds) : "Not recorded"}</strong></div>{selectedEntry.startedAt && <div><span>Started</span><strong>{formatPracticeTimestamp(selectedEntry.startedAt)}</strong></div>}{selectedEntry.endedAt && <div><span>Finished</span><strong>{formatPracticeTimestamp(selectedEntry.endedAt)}</strong></div>}{selectedEntry.sessionId && <div><span>Session</span><strong>{selectedEntry.sessionId}</strong></div>}{selectedEntry.outcome && <div><span>Result</span><strong>{resultLabel(selectedEntry.outcome, selectedEntry.type)}</strong></div>}{selectedEntry.review && <div className="review-fact"><span>{selectedEntry.review.status === "due" ? "Review due" : "Next review"}</span><strong>{selectedEntry.review.dueDate}</strong><small>{selectedEntry.review.reason.replaceAll("_", " ")} · {selectedEntry.review.intervalDays} day interval</small></div>}</div>
            {practiceRecordLoading && <div className="transcript-loading"><span />Loading conversation and recordings…</div>}
            {selectedEntry.artifact ? <div className="letter-sections">{selectedEntry.artifact.sections.map((section, index) => {
              const sectionId = `case-${slugify(section.title)}-${index}`;
              if (selectedEntryTurns.length && index === selectedArtifactTranscriptIndex) return <div id={sectionId} key="structured-transcript"><ActivityTranscript turns={selectedEntryTurns} clips={selectedEntryClips} /></div>;
              if (selectedEntryTurns.length && /conversation transcript|full transcript|raw exchange/i.test(section.title)) return null;
              return /generated code|solution|raw exchange/i.test(section.title) ? <details id={sectionId} key={section.title} open={/solution/i.test(section.title)}><summary>{section.title}</summary><MarkdownBody source={section.body} /></details> : <section id={sectionId} key={section.title}><h3>{section.title}</h3><MarkdownBody source={section.body} /></section>;
            })}</div> : <div className="unpublished-letter" id="case-draft"><span className="eyebrow">D1 DRAFT · NOT YET IN THE JOURNAL</span><h3>The attempt is saved; its case file is still waiting for finalization.</h3><p>The coordinator will ask the matching specialist to finalize the transcript, review, solution, and consulted references. No unrelated task conversation is included.</p>{selectedEntry.finalization && <p><strong>Specialist bundle:</strong> {selectedEntry.finalization.status}</p>}{selectedEntry.url && <a href={selectedEntry.url} target="_blank" rel="noreferrer">Open original problem ↗</a>}</div>}
            {selectedEntryTurns.length > 0 && selectedArtifactTranscriptIndex < 0 && <div id="case-transcript"><ActivityTranscript turns={selectedEntryTurns} clips={selectedEntryClips} /></div>}
            <footer>Interview Arc · {selectedEntry.id}</footer>
          </div>
        </article>
      </div>}
      {selectedProblem && <div className="letter-backdrop" role="presentation" onMouseDown={() => setSelectedProblem(null)}>
        <article className="reading-letter solution-profile-letter" role="dialog" aria-modal="true" aria-labelledby="solution-profile-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="letter-close icon-action" onClick={() => setSelectedProblem(null)} aria-label="Close solution profile" title="Close"><Icon name="close" /></button>
          <header><div><span className={`type-chip ${selectedProblem.type}`}>{typeLabel(selectedProblem.type)}</span><span className="profile-revision">{selectedProblemProfile ? `Solution revision ${selectedProblemProfile.currentRevision}` : "No solution yet"}</span><button className={`star-control ${isStarred(selectedProblem.type, selectedProblem.question.id) ? "starred" : ""}`} onClick={() => toggleProblemStar(selectedProblem.type, selectedProblem.question.id)} aria-label={`${isStarred(selectedProblem.type, selectedProblem.question.id) ? "Unstar" : "Star"} ${selectedProblem.question.title}`}>★</button></div><h2 id="solution-profile-title">{selectedProblem.question.title}</h2><p>{selectedProblemProfile?.payload.summary ?? selectedProblem.question.prompt ?? "Finish and finalize an attempt to build this reusable Solution Profile."}</p></header>
          <div className="profile-tags">{[...new Set([...selectedProblem.question.topics, ...(selectedProblem.question.tags ?? []), ...(selectedProblemProfile?.tags ?? [])])].map((tag) => <span key={tag}>{tag}</span>)}</div>
          {selectedProblemProfile?.payload.behavioralAnswer && <section className="canonical-answer-card"><span className="eyebrow">YOUR PREFERRED ANSWER</span><h3>{selectedProblemProfile.payload.behavioralAnswer.preferred.label}</h3><MarkdownBody source={selectedProblemProfile.payload.behavioralAnswer.preferred.answer} />{selectedProblemProfile.payload.behavioralAnswer.preferred.evidence.length > 0 && <div className="answer-evidence"><strong>Verified evidence</strong><ul>{selectedProblemProfile.payload.behavioralAnswer.preferred.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selectedProblemProfile.payload.behavioralAnswer.preferred.evidenceGaps.length > 0 && <div className="answer-gaps"><strong>Evidence still needed</strong><ul>{selectedProblemProfile.payload.behavioralAnswer.preferred.evidenceGaps.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selectedProblemProfile.payload.behavioralAnswer.alternatives.length > 0 && <details className="answer-alternatives"><summary>{selectedProblemProfile.payload.behavioralAnswer.alternatives.length} alternative story {selectedProblemProfile.payload.behavioralAnswer.alternatives.length === 1 ? "variant" : "variants"}</summary>{selectedProblemProfile.payload.behavioralAnswer.alternatives.map((variant) => <article key={variant.label}><h4>{variant.label}</h4>{variant.whenToUse && <small>Best when: {variant.whenToUse}</small>}<MarkdownBody source={variant.answer} /></article>)}</details>}</section>}
          {selectedProblemProfile ? <div className="letter-sections solution-sections">{selectedProblemProfile.payload.sections.map((section) => <section key={section.title}><h3>{section.title}</h3><MarkdownBody source={section.body} /></section>)}</div> : <div className="unpublished-letter"><span className="eyebrow">KNOWLEDGE PROFILE</span><h3>This problem has no finalized solution yet.</h3><p>The matching specialist creates it when a completed attempt is finalized. Past will keep the transcript; this bank page will keep the reusable answer.</p></div>}
          <section className="attempt-history"><span className="eyebrow">PAST ATTEMPTS</span>{selectedProblemAttempts.length ? selectedProblemAttempts.map((entry) => <button key={entry.id} onClick={() => { setSelectedProblem(null); setSelectedEntry(entry); }}><span>{readableDate(entry.date, true)}</span><strong>{resultLabel(entry.outcome, entry.type)}</strong><small>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "No timer"} · Read case →</small></button>) : <p>No completed attempt is linked yet.</p>}</section>
          {selectedProblemRevisions.length > 1 && <section className="revision-history"><span className="eyebrow">SOLUTION HISTORY</span><p>{selectedProblemRevisions.length} immutable revisions are linked to past attempts. The profile above is the current revision.</p></section>}
          {selectedProblemProfile?.payload.references.length ? <section className="profile-references"><span className="eyebrow">REFERENCES CONSULTED</span>{selectedProblemProfile.payload.references.map((reference) => <a key={`${reference.url}-${reference.accessedAt}`} href={reference.url} target="_blank" rel="noreferrer">{reference.title} ↗<small>{reference.accessedAt}</small></a>)}</section> : null}
          <footer>Interview Arc · {selectedProblem.type}:{selectedProblem.question.id}</footer>
        </article>
      </div>}
    {pipWindow && createPortal(
      <PipNowPanel
        activity={pipActivity}
        activityTimer={pipActivity ? draft.timers[pipActivity.id] : undefined}
        session={pipSession}
        sessionTimer={pipSession ? draft.sessionTimers[pipSession.id] : undefined}
        outcome={pipActivity ? draft.outcomes[pipActivity.id] ?? pipActivity.outcome : undefined}
        now={now}
        onToggleActivity={toggleTimer}
        onCompleteActivity={completeTimer}
        onToggleSession={toggleSessionTimer}
        onCompleteSession={completeSessionTimer}
        onOutcome={setOutcome}
      />,
      pipWindow.document.body,
    )}
    </main>
    <PetalField quiet={arrivalState === "entered"} paused={!petalsEnabled} />
    <ArrivalRitual date={today} state={arrivalState} muted={soundMuted} trackName={trackName} trackArtist={trackArtist} playlist={ambientPlaylist} trackIndex={ambientTrackIndex} volume={musicVolume} onToggleMuted={toggleArrivalSound} onPreviousTrack={previousAmbientTrack} onNextTrack={nextAmbientTrack} onSelectTrack={chooseAmbientTrack} onVolumeChange={setMusicVolume} onEnter={enterArc} />
    </>
  );
}

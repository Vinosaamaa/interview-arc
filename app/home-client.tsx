"use client";

import { type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
  remaining,
  SESSION_SECONDS,
  sessionAllocationSeconds,
  type ActivityType,
  type ExtraActivity,
  type LocalSession,
  type Outcome,
  type PublicationStatus,
  type TimerDraft,
} from "./live-types";
import { useLiveState, useReadOnlyLiveState } from "./live-sync";
import { emptyJournal } from "./current-day";
import { ArrivalRitual, PetalField } from "./arrival-ritual";
import { useAmbientSound } from "./ambient-sound";
import { MusicPlaylist } from "./music-playlist";

type View = "today" | "journey" | "library" | "banks";
type ComposerMode = "session" | "activity";
type JourneyRange = 30 | 90 | 365 | "all";
type JourneyMetric = "activities" | "time";
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
  if (outcome === "solved_after_reviewing_approach") return "Solved after reviewing approach";
  if (outcome === "failed") return "Failed";
  return "No result yet";
}

function resultLabel(outcome: Outcome | undefined, activityType: ActivityType) {
  if (activityType === "leetcode") return outcomeLabel(outcome);
  if (outcome === "solved") return "Finished";
  if (outcome === "solved_after_reviewing_approach") return "Finished after reviewing approach";
  if (outcome === "failed") return "Failed";
  return "No result yet";
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

function blockKeysForQuestion(question: QuestionBankItem) {
  const keys = [`id:${question.id}`, `title:${normalizedIdentity(question.title)}`, `slug:${slugify(question.title)}`];
  if (question.url) keys.push(`url:${question.url.replace(/\/$/, "").toLowerCase()}`);
  return keys;
}

function addActivityToBlocked(blocked: Set<string>, activity: { id: string; title: string; url?: string }) {
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

function deriveLeetCodeFromUrl(value: string, bank: QuestionBankItem[]) {
  try {
    const url = new URL(value.trim());
    if (!/(^|\.)leetcode\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/problems\/([a-z0-9-]+)\/?/i);
    if (!match) return null;
    const normalizedUrl = `https://leetcode.com/problems/${match[1].toLowerCase()}/`;
    const known = bank.find((question) => question.url?.replace(/\/$/, "") === normalizedUrl.replace(/\/$/, ""));
    if (known) return { title: known.title, url: normalizedUrl, targetMinutes: known.targetMinutes };
    const acronyms: Record<string, string> = { lru: "LRU", bfs: "BFS", dfs: "DFS", sql: "SQL", xor: "XOR" };
    const title = match[1].split("-").map((word) => acronyms[word] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
    return { title, url: normalizedUrl, targetMinutes: 30 };
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
  return (
    <div className={`activity-timer ${running ? "running" : ""} ${complete ? "complete" : ""}`}>
      <div className="activity-time-copy">
        <span>{complete ? "Final time" : "Stopwatch"}</span>
        <strong>{formatClock(used)}</strong>
      </div>
      <div className="activity-time-actions">
        <button className="start-timer icon-control" onClick={() => onToggle(activity.id)} disabled={complete} aria-label={running ? `Pause ${activity.title}` : `Start ${activity.title}`} title={running ? "Pause stopwatch" : complete ? "Finished activities cannot be resumed" : "Start stopwatch"}>
          <span aria-hidden="true">{running ? "Ⅱ" : "▶"}</span>
        </button>
        <button className="finish-timer icon-control" onClick={() => onComplete(activity.id)} disabled={complete} aria-label={`Finish ${activity.title}`} title={complete ? "Activity finished" : "Finish and lock stopwatch"}>
          <span aria-hidden="true">{complete ? "✓" : "■"}</span>
        </button>
      </div>
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
  const running = Boolean(timer?.runningSince) && timeLeft > 0;
  const complete = Boolean(timer?.completed) || timeLeft === 0;
  const progress = Math.min(100, (elapsed(timer, now) / allocated) * 100);
  return (
    <div className={`session-countdown ${running ? "running" : ""} ${complete ? "complete" : ""}`}>
      <div className="countdown-copy">
        <span>{formatDuration(allocated)} session countdown</span>
        <strong>{formatClock(timeLeft)}</strong>
        <small>{complete ? "Session finished" : running ? "Session in progress" : timer?.elapsedSeconds ? "Session paused" : "Ready when you are"}</small>
      </div>
      <div className="countdown-controls">
        <button onClick={() => onToggle(session.id)} disabled={complete} aria-label={running ? `Pause ${session.label}` : `Start ${session.label}`} title={running ? "Pause session countdown" : "Start session countdown"}><span aria-hidden="true">{running ? "Ⅱ" : "▶"}</span></button>
        <button onClick={() => onComplete(session.id)} disabled={complete} aria-label={`Finish ${session.label}`} title={complete ? "Session finished" : "Finish session now"}><span aria-hidden="true">{complete ? "✓" : "■"}</span></button>
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
        <div><strong>{label}</strong><small>{minutesEach} min each</small></div>
      </div>
      <div className="count-stepper">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0} aria-label={`Remove one ${label.toLowerCase()}`}>−</button>
        <input
          type="number"
          min="0"
          max={max}
          value={value}
          onChange={(event) => onChange(Math.min(max, Math.max(0, Math.floor(Number(event.target.value) || 0))))}
          aria-label={`${label} count`}
        />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Add one ${label.toLowerCase()}`}>＋</button>
      </div>
      <span className="session-contribution">{value} × {minutesEach}m <strong>{formatDuration(contribution)}</strong></span>
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
  const isCoding = activityType === "leetcode";
  const labels = isCoding
    ? { solved: "Solved", reviewed: "Solved after reviewing approach" }
    : { solved: "Finished", reviewed: "Finished after reviewing approach" };
  return (
    <div className="result-flag-wrap">
      <button className={`result-flag ${outcome ?? "unset"}`} onClick={() => onChange(next)} aria-label={`Result: ${resultLabel(outcome, activityType)}. Select the next result.`} title="Change result">
        <span aria-hidden="true">{outcome ? "⚑" : "⚐"}</span>
      </button>
      <div className="result-legend" role="tooltip">
        <strong>Result flag</strong>
        <span><i className="unset" /> Not set</span>
        <span><i className="solved" /> {labels.solved}</span>
        <span><i className="reviewed" /> {labels.reviewed}</span>
        <span><i className="failed" /> Failed</span>
      </div>
    </div>
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
      data-tooltip={status === "published" ? "A permanent solution or transcript exists in your journal." : status === "ready" ? "This finished activity will be included automatically the next time its specialist publishes." : "Finish the stopwatch or choose a result to include this activity in the specialist journal queue."}
      aria-label={publicationLabel(status)}
      title={status === "published" ? "The specialist task created the permanent journal record" : status === "ready" ? "Automatically included in the next specialist publication" : "Finish this activity to make it ready for publication"}
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
  const sessionProgress = session ? Math.min(100, (elapsed(sessionTimer, now) / sessionAllocated) * 100) : 0;
  const activityUsed = activity ? elapsed(activityTimer, now) : 0;
  const activityRunning = Boolean(activityTimer?.runningSince);
  const activityComplete = Boolean(activityTimer?.completed);
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
            <button type="button" className="pip-btn" onClick={() => onCompleteSession(session.id)} disabled={sessionComplete} aria-label={`Finish ${session.label}`}>
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
              <button type="button" className="pip-btn" onClick={() => onCompleteActivity(activity.id)} disabled={activityComplete} aria-label={`Finish ${activity.title}`}>
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

function SwipeActivityCard({ children, title, onEdit, onRemove }: { children: ReactNode; title: string; onEdit: () => void; onRemove: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [pointerStart, setPointerStart] = useState<number | null>(null);
  function finishGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerStart === null) return;
    const distance = event.clientX - pointerStart;
    if (distance < -42) setRevealed(true);
    if (distance > 42) setRevealed(false);
    setPointerStart(null);
  }
  return (
    <article className={`swipe-activity-card ${revealed ? "revealed" : ""}`}>
      <div className="swipe-actions" aria-hidden={!revealed}>
        <button onClick={onEdit} tabIndex={revealed ? 0 : -1}>Edit</button>
        <button onClick={onRemove} tabIndex={revealed ? 0 : -1}>Remove</button>
      </div>
      <div className="swipe-card-face" onPointerDown={(event) => setPointerStart(event.clientX)} onPointerUp={finishGesture} onPointerCancel={() => setPointerStart(null)}>
        {children}
        <button className="swipe-more" onClick={() => setRevealed((current) => !current)} aria-label={`${revealed ? "Hide" : "Show"} actions for ${title}`} title="Swipe left for actions">•••</button>
      </div>
    </article>
  );
}

function MarkdownBody({ source }: { source: string }) {
  return <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown></div>;
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
  const [libraryFilter, setLibraryFilter] = useState<"all" | ActivityType>("all");
  const [bankFilter, setBankFilter] = useState<"all" | ActivityType>("all");
  const [bankProgressFilter, setBankProgressFilter] = useState<"all" | "todo" | "finished">("all");
  const [bankLevelFilter, setBankLevelFilter] = useState<"all" | "easy" | "medium" | "hard">("all");
  const [bankSortKey, setBankSortKey] = useState<"frequency" | "recent" | "acceptance">("frequency");
  const [bankSortDir, setBankSortDir] = useState<"asc" | "desc">("asc");
  const [bankSearch, setBankSearch] = useState("");
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
    if (!composer.open && !selectedEntry && !integrationOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposer(EMPTY_COMPOSER);
        setSelectedEntry(null);
        setIntegrationOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [composer.open, selectedEntry, integrationOpen]);

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
  const assignedExtraIds = new Set(draft.sessions.flatMap((session) => session.activityIds));
  const looseActivities = draft.extraActivities.filter((activity) => !assignedExtraIds.has(activity.id));

  useEffect(() => {
    const expired = allSessions.filter((session) => {
      const timer = draft.sessionTimers[session.id];
      return Boolean(timer?.runningSince) && elapsed(timer, now) >= session.allocatedSeconds;
    });
    if (!expired.length) return;
    expired.forEach((session) => enqueue({ type: "timer", subjectId: session.id, kind: "session", action: "finish" }));
    const expiredIds = new Set(expired.map((session) => session.id));
    setDraft((current) => ({
      ...current,
      sessionTimers: Object.fromEntries(
        Object.entries(current.sessionTimers).map(([id, timer]) => {
          const session = allSessions.find((candidate) => candidate.id === id);
          return expiredIds.has(id)
            ? [id, { elapsedSeconds: session?.allocatedSeconds ?? SESSION_SECONDS, runningSince: null, completed: true }]
            : [id, timer];
        }),
      ),
    }));
  }, [allSessions, draft.sessionTimers, enqueue, now, setDraft]);

  // The pop-out follows the running activity; when nothing runs it shows the first
  // unfinished problem so the controls are still one click away.
  const pipActivity =
    allTodayActivities.find((activity) => draft.timers[activity.id]?.runningSince) ??
    allTodayActivities.find((activity) => !draft.timers[activity.id]?.completed) ??
    allTodayActivities[0] ??
    null;
  const pipSession =
    allSessions.find((session) => draft.sessionTimers[session.id]?.runningSince) ?? allSessions[0] ?? null;

  function bankFor(type: ActivityType) {
    if (type === "leetcode") return content.questionBanks.leetcode;
    if (type === "system_design") return content.questionBanks.systemDesign;
    return content.questionBanks.behavioral;
  }

  function toggleTimer(activityId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    const priorTimer = draft.timers[activityId];
    if (priorTimer?.completed) return;
    enqueue({
      type: "timer",
      subjectId: activityId,
      kind: "activity",
      action: priorTimer?.runningSince ? "pause" : "start",
    });
    setDraft((current) => {
      const timers = { ...current.timers };
      const prior = timers[activityId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      if (prior.completed) return current;
      if (prior.runningSince) {
        timers[activityId] = { elapsedSeconds: elapsed(prior, timestamp), runningSince: null, completed: prior.completed };
      } else {
        for (const [id, active] of Object.entries(timers)) {
          if (active.runningSince) timers[id] = { ...active, elapsedSeconds: elapsed(active, timestamp), runningSince: null };
        }
        timers[activityId] = { elapsedSeconds: prior.elapsedSeconds, runningSince: timestamp, completed: false };
      }
      return { ...current, timers };
    });
  }

  function toggleSessionTimer(sessionId: string) {
    const timestamp = Date.now();
    const allocatedSeconds = allSessions.find((session) => session.id === sessionId)?.allocatedSeconds ?? SESSION_SECONDS;
    setNow(timestamp);
    const priorSession = draft.sessionTimers[sessionId];
    if (priorSession?.completed || (priorSession && elapsed(priorSession, timestamp) >= allocatedSeconds)) return;
    enqueue({
      type: "timer",
      subjectId: sessionId,
      kind: "session",
      action: priorSession?.runningSince ? "pause" : "start",
    });
    setDraft((current) => {
      const prior = current.sessionTimers[sessionId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      if (prior.completed || elapsed(prior, timestamp) >= allocatedSeconds) return current;
      return {
        ...current,
        sessionTimers: {
          ...current.sessionTimers,
          [sessionId]: prior.runningSince
            ? { elapsedSeconds: elapsed(prior, timestamp), runningSince: null, completed: false }
            : { elapsedSeconds: prior.elapsedSeconds, runningSince: timestamp, completed: false },
        },
      };
    });
  }

  function completeSessionTimer(sessionId: string) {
    const timestamp = Date.now();
    const allocatedSeconds = allSessions.find((session) => session.id === sessionId)?.allocatedSeconds ?? SESSION_SECONDS;
    setNow(timestamp);
    enqueue({ type: "timer", subjectId: sessionId, kind: "session", action: "finish" });
    setDraft((current) => {
      const prior = current.sessionTimers[sessionId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      return {
        ...current,
        sessionTimers: {
          ...current.sessionTimers,
          [sessionId]: { elapsedSeconds: Math.min(allocatedSeconds, elapsed(prior, timestamp)), runningSince: null, completed: true },
        },
      };
    });
  }

  function completeTimer(activityId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    enqueue({ type: "timer", subjectId: activityId, kind: "activity", action: "finish" });
    setDraft((current) => {
      const prior = current.timers[activityId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      return {
        ...current,
        timers: {
          ...current.timers,
          [activityId]: { elapsedSeconds: elapsed(prior, timestamp), runningSince: null, completed: true },
        },
      };
    });
  }

  function setOutcome(activityId: string, outcome?: Outcome) {
    enqueue({ type: "outcome", activityId, outcome: outcome ?? null });
    setDraft((current) => {
      const outcomes = { ...current.outcomes };
      if (outcome) outcomes[activityId] = outcome;
      else delete outcomes[activityId];
      return { ...current, outcomes };
    });
  }

  async function createConnectionToken() {
    setIntegrationBusy(true);
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Codex and Chrome companion" }),
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
    return Boolean(draft.outcomes[activity.id] ?? activity.outcome ?? draft.timers[activity.id]?.completed);
  }

  function publicationStatusFor(activity: JournalActivity): PublicationStatus {
    const stored = draft.publicationStatuses[activity.id];
    if (activity.artifactPath || stored === "published") return "published";
    if (isActivityComplete(activity) || stored === "ready") return "ready";
    return "draft";
  }

  function openNewActivity() {
    setComposer({ ...EMPTY_COMPOSER, open: true, mode: "activity" });
  }

  function openNewSession() {
    setComposer({ ...EMPTY_COMPOSER, open: true, mode: "session" });
  }

  function openEditActivity(activity: ExtraActivity) {
    const bank = bankFor(activity.type);
    const known = bank.find((question) => question.title === activity.title || question.url === activity.url);
    setComposer({
      ...EMPTY_COMPOSER,
      open: true,
      mode: "activity",
      type: activity.type,
      query: activity.type === "leetcode" ? activity.url ?? activity.title : activity.title,
      selectedId: known?.id ?? "",
      minutes: String(Math.round(activity.allocatedSeconds / 60)),
      editingId: activity.id,
    });
  }

  function isSessionEditable(session: LocalSession) {
    const sessionTimer = draft.sessionTimers[session.id];
    if (sessionTimer?.runningSince || sessionTimer?.completed || sessionTimer?.elapsedSeconds) return false;
    return session.activityIds.every((activityId) => {
      const activity = allTodayActivities.find((candidate) => candidate.id === activityId);
      const timer = draft.timers[activityId];
      return !timer?.runningSince && !timer?.completed && !timer?.elapsedSeconds &&
        !draft.outcomes[activityId] && !activity?.outcome && activity?.status !== "completed" &&
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

  function sessionBlockedQuestions(editingSessionId = "") {
    const excludedIds = new Set(
      draft.sessions.find((session) => session.id === editingSessionId)?.activityIds ?? [],
    );
    const blocked = new Set<string>();
    allTodayActivities
      .filter((activity) => !excludedIds.has(activity.id))
      .forEach((activity) => addActivityToBlocked(blocked, activity));
    return blocked;
  }

  function availableSessionQuestions(type: ActivityType, editingSessionId = "") {
    const blocked = sessionBlockedQuestions(editingSessionId);
    return bankFor(type).filter((question) => question.active && !isQuestionBlocked(question, blocked));
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
    const derived = composer.type === "leetcode" && !selected ? deriveLeetCodeFromUrl(composer.query, bank) : null;
    if (composer.type === "leetcode" && !selected && !derived) return;
    const title = selected?.title ?? derived?.title ?? composer.query.trim();
    if (!title) return;
    const minutes = Math.max(1, Number(composer.minutes) || selected?.targetMinutes || derived?.targetMinutes || 30);
    const existing = draft.extraActivities.find((activity) => activity.id === composer.editingId);
    const id = existing?.id ?? `${journal.date}-extra-${slugify(title)}-${event.timeStamp.toString(36)}`;
    const activity: ExtraActivity = {
      schemaVersion: 2,
      id,
      date: journal.date,
      source: "extra",
      type: composer.type,
      ...(composer.type === "leetcode" ? { recordKind: "attempt" as const } : {}),
      title,
      ...(selected?.url || derived?.url ? { url: selected?.url ?? derived?.url } : {}),
      ...(selected?.prompt ? { prompt: selected.prompt } : composer.type !== "leetcode" ? { prompt: title } : {}),
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
    enqueue({ type: "extra-upsert", activity });
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
    const codingQuestions = pickQuestionsByFrequency(content.questionBanks.leetcode, composer.sessionCoding, blocked, sessionId);
    codingQuestions.forEach((question) => blockKeysForQuestion(question).forEach((key) => blocked.add(key)));
    const systemQuestions = pickQuestionsByFrequency(content.questionBanks.systemDesign, composer.sessionSystemDesign, blocked, sessionId);
    systemQuestions.forEach((question) => blockKeysForQuestion(question).forEach((key) => blocked.add(key)));
    const behaviorQuestions = pickQuestionsByFrequency(content.questionBanks.behavioral, composer.sessionBehavioral, blocked, sessionId);
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
      date: journal.date,
      source: "extra",
      type: "leetcode",
      recordKind: "attempt",
      title: question.title,
      url: question.url,
      allocatedSeconds: CODING_SESSION_MINUTES * 60,
      timerGroupId: `${sessionId}-coding`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
    }));
    systemQuestions.forEach((question) => activities.push({
      schemaVersion: 2,
      id: `${sessionId}-${question.id}`,
      date: journal.date,
      source: "extra",
      type: "system_design",
      title: question.title,
      ...(question.url ? { url: question.url } : {}),
      prompt: question.prompt,
      allocatedSeconds: INTERVIEW_SESSION_MINUTES * 60,
      timerGroupId: `${sessionId}-system-design`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
    }));
    behaviorQuestions.forEach((question) => activities.push({
      schemaVersion: 2,
      id: `${sessionId}-${question.id}`,
      date: journal.date,
      source: "extra",
      type: "behavioral",
      title: question.title,
      ...(question.url ? { url: question.url } : {}),
      prompt: question.prompt,
      allocatedSeconds: INTERVIEW_SESSION_MINUTES * 60,
      timerGroupId: `${sessionId}-behavioral`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
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
      timingSource: "website",
    }]));
    const sessionTimers = Object.fromEntries(Object.entries(draft.sessionTimers).map(([id, timer]) => {
      const allocatedSeconds = allSessions.find((session) => session.id === id)?.allocatedSeconds ?? SESSION_SECONDS;
      return [id, {
        elapsedSeconds: Math.min(allocatedSeconds, elapsed(timer, timestamp)),
        remainingSeconds: remaining(timer, timestamp, allocatedSeconds),
        running: Boolean(timer.runningSince),
        completed: timer.completed,
        timingSource: "website",
      }];
    }));
    const effectivePublicationStatuses = Object.fromEntries(
      allTodayActivities.map((activity) => [activity.id, publicationStatusFor(activity)]),
    );
    const publishQueueActivityIds = allTodayActivities
      .filter((activity) => publicationStatusFor(activity) === "ready")
      .map((activity) => activity.id);
    const payload = {
      schemaVersion: 4,
      date: journal.date,
      exportedAt: new Date(timestamp).toISOString(),
      localDraft: true,
      sessionTimers,
      timers,
      outcomes: draft.outcomes,
      publicationStatuses: effectivePublicationStatuses,
      notes: draft.notes,
      publishQueueActivityIds,
      sessions: draft.sessions,
      extraActivities: draft.extraActivities,
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
    for (const daily of content.journals) {
      for (const activity of daily.activities) {
        const liveDraft = daily.date === journal.date ? draft : daily.date === yesterdayDate ? yesterdayDraft : null;
        const localTimer = liveDraft?.timers[activity.id];
        const localOutcome = liveDraft?.outcomes[activity.id];
        const artifact = artifactByActivity.get(activity.id);
        const running = Boolean(localTimer?.runningSince);
        const complete = activity.status === "completed" || Boolean(localOutcome) || Boolean(localTimer?.completed) || Boolean(artifact);
        entries.push({
          id: activity.id,
          date: activity.date,
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
        });
      }
    }
    for (const activity of draft.extraActivities) {
      const timer = draft.timers[activity.id];
      const outcome = draft.outcomes[activity.id];
      entries.push({
        id: activity.id,
        date: activity.date,
        type: activity.type,
        title: activity.title,
        subtitle: activity.notes ?? activity.prompt ?? "Locally added activity",
        status: outcome || timer?.completed ? "completed" : timer?.runningSince ? "running" : "planned",
        outcome,
        elapsedSeconds: elapsed(timer, now),
        allocatedSeconds: activity.allocatedSeconds,
        reviewDates: activity.reviewDates,
        url: activity.url,
      });
    }
    for (const activity of yesterdayDraft?.extraActivities ?? []) {
      if (entries.some((entry) => entry.id === activity.id)) continue;
      const timer = yesterdayDraft?.timers[activity.id];
      const outcome = yesterdayDraft?.outcomes[activity.id];
      entries.push({
        id: activity.id,
        date: activity.date,
        type: activity.type,
        title: activity.title,
        subtitle: activity.notes ?? activity.prompt ?? "Website-created activity",
        status: outcome || timer?.completed ? "completed" : timer?.runningSince ? "running" : "planned",
        outcome,
        elapsedSeconds: elapsed(timer, now),
        allocatedSeconds: activity.allocatedSeconds,
        reviewDates: activity.reviewDates,
        url: activity.url,
      });
    }
    for (const artifact of content.artifacts) {
      if (artifact.activityId && entries.some((entry) => entry.id === artifact.activityId)) continue;
      const inferredType: ActivityType = artifact.type === "leetcode" || artifact.type === "behavioral" ? artifact.type : "system_design";
      const preview = artifact.sections.find((section) => /summary|short answer|question/i.test(section.title))?.body ?? "Published interview record";
      entries.push({ id: artifact.path, date: artifact.date, type: inferredType, title: artifact.title, subtitle: plainText(preview).slice(0, 160), status: "published", elapsedSeconds: 0, allocatedSeconds: 0, artifact });
    }
    return entries.sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title));
  }, [content.artifacts, content.journals, draft, journal.date, now, yesterdayDate, yesterdayDraft]);

  const libraryEntries = useMemo(() => logEntries.filter((entry) => {
    if (entry.outcome) return entry.outcome === "solved" || entry.outcome === "solved_after_reviewing_approach";
    if (entry.type === "leetcode") return false;
    return entry.status === "completed" || entry.status === "published";
  }), [logEntries]);

  const groupedLog = useMemo(() => {
    const groups = new Map<string, LogEntry[]>();
    for (const entry of libraryEntries) {
      if (libraryFilter !== "all" && entry.type !== libraryFilter) continue;
      groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [libraryEntries, libraryFilter]);

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
    const mockActivities = activities.filter((activity) => activity.type !== "leetcode");
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
          {localSession && <div className="session-header-actions"><button className="edit-session" onClick={() => openEditSession(localSession)} disabled={!isSessionEditable(localSession)} title={isSessionEditable(localSession) ? "Change this session recipe" : "A session recipe locks after timing or results begin"}>Edit recipe</button><button className="remove-session" onClick={() => removeSession(localSession)}>Remove</button></div>}
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
                  {isExtra && <div className="row-edit-actions"><button onClick={() => openEditActivity(activity as ExtraActivity)}>Edit</button><button onClick={() => removeActivity(activity.id)}>Remove</button></div>}
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
                <div className="mock-topline"><span className={`type-chip ${item.type}`}>{typeLabel(item.type)}</span>{isExtra && <div className="row-edit-actions"><button onClick={() => openEditActivity(item as ExtraActivity)}>Edit</button><button onClick={() => removeActivity(item.id)}>Remove</button></div>}</div>
                <h3>{item.title}</h3>
                <p>{item.prompt}</p>
                <div className="mock-controls">
                  <ActivityTimer activity={item} timer={draft.timers[item.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                  <ResultFlag activityType={item.type} outcome={draft.outcomes[item.id] ?? item.outcome} onChange={(outcome) => setOutcome(item.id, outcome)} />
                  <PublicationControl status={publicationStatusFor(item)} />
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
    return (
      <>
        <section className="today-masthead">
          <div className="date-poster"><strong>{journal.date.slice(-2)}</strong><span>{new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</span></div>
          <div className="today-thesis"><span className="eyebrow">TODAY · {journal.focus.toUpperCase()}</span><h1>{totalToday ? `${totalToday} activities.` : "A clean page."}<br /><em>One honest record.</em></h1><p>{journal.note}</p></div>
          <div className="today-tally"><span className="yesterday-label">YESTERDAY · {readableDate(yesterdayDate, true)}</span><div><strong>{yesterdayCompleted.length}/{yesterdayEntries.length}</strong><span>activities finished</span></div><div><strong>{formatDuration(yesterdaySeconds)}</strong><span>time recorded</span></div><div><strong>{yesterdaySessions}</strong><span>session{yesterdaySessions === 1 ? "" : "s"} planned</span></div></div>
        </section>

        <div className="today-actions"><div><h2>Today&apos;s sessions</h2><p>Each session countdown follows its activity recipe; activity stopwatches stay compact and independent.</p></div><div><button className="secondary-action" onClick={openNewActivity}>Add one activity</button><button className="primary-action" onClick={openNewSession}>＋ Add another session</button></div></div>
        <section className="session-stack">{allSessions.length ? allSessions.map(renderSession) : <div className="quiet-empty session-empty"><strong>No session planned yet.</strong><span>Add another session to choose up to six coding questions and one question from each available interview bank.</span></div>}</section>

        <section className="loose-section">
          <div className="section-title"><div><span className="eyebrow">STANDALONE PRACTICE</span><h2>Outside a full session</h2><p>Swipe a card left, or use its ••• control, to edit or remove it.</p></div></div>
          {looseActivities.length === 0 ? <div className="quiet-empty"><strong>No standalone activities yet.</strong><span>Use “Add one activity” above to search a bank or paste a public LeetCode problem URL.</span></div> : <div className="loose-list">{looseActivities.map((activity) => <SwipeActivityCard key={activity.id} title={activity.title} onEdit={() => openEditActivity(activity)} onRemove={() => removeActivity(activity.id)}><span className={`type-mark ${activity.type}`}>{typeMark(activity.type)}</span><div className="loose-activity-copy"><small>{typeLabel(activity.type)} · local draft</small><strong>{activity.title}</strong>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open reference ↗</a>}</div><ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} /><ResultFlag activityType={activity.type} outcome={draft.outcomes[activity.id] ?? activity.outcome} onChange={(outcome) => setOutcome(activity.id, outcome)} /><PublicationControl status={publicationStatusFor(activity)} /></SwipeActivityCard>)}</div>}
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
          <MetricRing label="Independent" value={codingAttemptCount ? (outcomeCounts.solved / codingAttemptCount) * 100 : 0} detail={`${outcomeCounts.solved} coding attempt${outcomeCounts.solved === 1 ? "" : "s"} solved without an approach review.`} color="#91a72f" />
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

          <article className="chart-sheet topic-sheet">
            <div className="chart-heading"><div><span className="eyebrow">SKILL COVERAGE</span><h2>Topics practiced</h2><p>Select a topic to see the records behind it.</p></div></div>
            {topicStats.length ? <div className="topic-bars">{topicStats.map((topic) => <button key={topic.topic} className={journeyTopic === topic.topic ? "active" : ""} onClick={() => setJourneyTopic((current) => current === topic.topic ? "" : topic.topic)}><span>{topic.topic}</span><i><b style={{ width: `${(topic.count / maxTopicCount) * 100}%` }} /></i><strong>{topic.count}</strong></button>)}</div> : <div className="chart-empty rich-empty"><strong>No topic coverage yet.</strong><span>Finish bank-linked coding problems to build this map.</span></div>}
            {journeyTopic && <div className="topic-records"><strong>{journeyTopic}</strong>{selectedTopicEntries.map((entry) => <button key={entry.id} onClick={() => setSelectedEntry(entry)}>{entry.title}<span>{readableDate(entry.date, true)} →</span></button>)}</div>}
          </article>
        </div>
      </section>
    );
  }

  function scrollToLogDate(date: string) {
    document.getElementById(`log-date-${date}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderLibrary() {
    return (
      <section className="view-page library-page">
        <header className="view-masthead"><span className="eyebrow">PAST · COMPLETED WORK ONLY</span><h1>Read the journey<br /><em>like a field journal.</em></h1><p>Solved coding problems and finished interview mocks appear here immediately. Planned, running, and failed activities stay out of this reading log.</p></header>
        <div className="library-toolbar"><div className="filter-row" role="group" aria-label="Filter past practice">{(["all", "leetcode", "system_design", "behavioral"] as const).map((filter) => <button key={filter} className={libraryFilter === filter ? "active" : ""} onClick={() => setLibraryFilter(filter)}>{filter === "all" ? "All" : typeLabel(filter)}</button>)}</div><span>{groupedLog.reduce((sum, [, entries]) => sum + entries.length, 0)} records shown</span></div>
        <div className="log-layout">
          <div className="dated-log">
            {groupedLog.length ? groupedLog.map(([date, entries]) => <section className="log-day" id={`log-date-${date}`} key={date}><header><time>{readableDate(date)}</time><span>{entries.length} record{entries.length === 1 ? "" : "s"}</span></header><div className="log-day-entries">{entries.map((entry) => <button className={`log-entry ${entry.type}`} key={entry.id} onClick={() => setSelectedEntry(entry)}><span className={`type-mark ${entry.type}`}>{typeMark(entry.type)}</span><div className="log-entry-copy"><small>{typeLabel(entry.type)} · {entry.status}</small><strong>{entry.title}</strong><span>{entry.subtitle}</span></div><div className="log-entry-meta"><strong>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "—"}</strong><span>{entry.type === "leetcode" ? outcomeLabel(entry.outcome) : entry.artifact ? "Published record" : entry.status}</span></div><span className="open-letter">Read →</span></button>)}</div></section>) : <div className="quiet-empty library-empty"><strong>No finished work in this filter yet.</strong><span>Mark a coding result as solved, or finish a system-design or behavioral stopwatch, and it will appear here.</span></div>}
          </div>
          <aside className="log-calendar"><span className="eyebrow">JUMP TO A DAY</span><h2>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</h2><div className="calendar-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div className="calendar-mini">{calendarDays.map((day) => day.hasEntries ? <button key={day.key} onClick={() => scrollToLogDate(day.key)} title={`Jump to ${day.key}`}>{day.day}<i /></button> : <span key={day.key}>{day.day}</span>)}</div><div className="calendar-dates">{groupedLog.map(([date]) => <button key={date} onClick={() => scrollToLogDate(date)}>{readableDate(date, true)} <span>↘</span></button>)}</div></aside>
        </div>
      </section>
    );
  }

  function renderBanks() {
    const bankEntries: { type: ActivityType; question: QuestionBankItem; finished: boolean }[] = [
      ...content.questionBanks.leetcode.map((question) => ({ type: "leetcode" as const, question })),
      ...content.questionBanks.systemDesign.map((question) => ({ type: "system_design" as const, question })),
      ...content.questionBanks.behavioral.map((question) => ({ type: "behavioral" as const, question })),
    ].map((entry) => ({
      ...entry,
      finished: libraryEntries.some((record) => record.type === entry.type && (
        Boolean(entry.question.url && record.url && entry.question.url.replace(/\/$/, "") === record.url.replace(/\/$/, "")) ||
        normalizedIdentity(entry.question.title) === normalizedIdentity(record.title)
      )),
    }));
    const searchNeedle = bankSearch.toLowerCase().trim();
    const filteredEntries = bankEntries.filter((entry) => {
      const level = questionLevel(entry.question);
      return (bankFilter === "all" || entry.type === bankFilter)
        && (bankProgressFilter === "all" || (bankProgressFilter === "finished" ? entry.finished : !entry.finished))
        && (bankLevelFilter === "all" || level === bankLevelFilter)
        && (!searchNeedle
          || entry.question.title.toLowerCase().includes(searchNeedle)
          || (entry.question.prompt?.toLowerCase().includes(searchNeedle) ?? false)
          || entry.question.topics.some((topic) => topic.toLowerCase().includes(searchNeedle))
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
    return (
      <section className="view-page banks-page">
        <header className="view-masthead"><span className="eyebrow">PROBLEM BANKS · ALL PRACTICE SOURCES</span><h1>Choose the next thing<br /><em>worth practicing.</em></h1><p>Browse every coding, system-design, and behavioral prompt in one place. “Practice today” adds the question to standalone practice and takes you directly to Today.</p></header>
        <div className="bank-totals" aria-label="Question bank totals">
          <article className="leetcode"><strong>{content.questionBanks.leetcode.length}</strong><span>Coding problems</span></article>
          <article className="system_design"><strong>{content.questionBanks.systemDesign.length}</strong><span>System designs</span></article>
          <article className="behavioral"><strong>{content.questionBanks.behavioral.length}</strong><span>Behavioral prompts</span></article>
        </div>
        <div className="bank-control-deck">
          <label className="bank-search-bar">
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
          </label>
          <div className="library-toolbar bank-toolbar">
            <div className="bank-filter-rail">
              <div className="bank-filter-group">
                <span>Type</span>
                <div className="filter-row" role="group" aria-label="Filter problem banks by question type">
                  {(["all", "leetcode", "system_design", "behavioral"] as const).map((filter) => (
                    <button key={filter} className={bankFilter === filter ? "active" : ""} onClick={() => setBankFilter(filter)}>
                      {filter === "all" ? "All" : typeLabel(filter)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bank-filter-group">
                <span>Progress</span>
                <div className="filter-row" role="group" aria-label="Filter problem banks by progress">
                  {(["all", "todo", "finished"] as const).map((filter) => (
                    <button key={filter} className={bankProgressFilter === filter ? "active" : ""} onClick={() => setBankProgressFilter(filter)}>
                      {filter === "all" ? "All" : filter === "todo" ? "To practice" : "Finished"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bank-filter-group">
                <span>Level</span>
                <div className="filter-row" role="group" aria-label="Filter problem banks by level">
                  {(["all", "easy", "medium", "hard"] as const).map((filter) => (
                    <button key={filter} className={bankLevelFilter === filter ? "active" : ""} onClick={() => setBankLevelFilter(filter)}>
                      {filter === "all" ? "All" : filter[0].toUpperCase() + filter.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bank-filter-group">
                <span>Order</span>
                <div className="filter-row bank-sort-row" role="group" aria-label="Order problem banks">
                  {sortOptions.map((option) => {
                    const active = bankSortKey === option.key;
                    const direction = active ? bankSortDir : null;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={`bank-sort-pill ${active ? "active" : ""}`}
                        onClick={() => toggleSort(option.key)}
                        aria-pressed={active}
                        aria-label={`${option.label}: ${active ? (direction === "asc" ? "low to high, click to reverse" : "high to low, click to reverse") : "sort low to high"}`}
                        title={`${option.label} · ${active ? (direction === "asc" ? "↑ low→high" : "↓ high→low") : "click to sort"}`}
                      >
                        <span className={`bank-sort-glyph ${option.icon}`} aria-hidden="true" />
                        <span className="bank-sort-dir" aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "·"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="problem-bank-list" tabIndex={0} aria-label="Problem bank results">
          {visibleEntries.map(({ type, question, finished }) => <article className={`problem-bank-entry ${type}`} key={`${type}-${question.id}`}>
            <span className={`type-mark ${type}`}>{typeMark(type)}</span>
            <div className="problem-bank-copy"><small>{typeLabel(type)}{question.difficulty ? ` · ${question.difficulty}` : ""}{question.complexity ? ` · ${displayComplexity(question.complexity)}` : ""} · {finished ? "finished" : "to practice"}</small><strong>{question.title}</strong>{question.prompt && question.prompt !== question.title && <p>{question.prompt}</p>}{question.url && <a href={question.url} target="_blank" rel="noreferrer">{question.solutionReference ? "Open question & solution references ↗" : "Open problem ↗"}</a>}</div>
            <div className="bank-entry-meta"><span>{question.targetMinutes} min estimate</span>{question.problemNumber && <small>#{question.problemNumber}{typeof question.acceptanceRate === "number" ? ` · ${question.acceptanceRate.toFixed(1)}% acceptance` : ""}</small>}{question.companySignals?.[0] && <small>{question.companySignals[0].company} frequency {question.companySignals[0].frequencyScore}/{question.companySignals[0].frequencyScale} · {question.companySignals[0].window}</small>}{question.answerFormat && <small>{question.answerFormat} answer · {question.frequency ?? "medium"} frequency</small>}{question.solutionReference && <small>Reference solution{question.referenceAccess === "may_require_sign_in" ? " may require sign-in" : " available"}</small>}{question.topics.length > 0 && <small>{question.topics.slice(0, 3).join(" · ")}</small>}</div>
            <button onClick={() => addBankQuestionToToday(question, type)}>Practice today</button>
          </article>)}
          {!visibleEntries.length && <div className="quiet-empty bank-empty"><strong>No questions match these filters.</strong><span>Change type, progress, level, or search text.</span></div>}
        </div>
      </section>
    );
  }

  const activeBank = bankFor(composer.type);
  const filteredQuestions = activeBank.filter((question) => {
    const needle = composer.query.toLowerCase().trim();
    return !needle || question.title.toLowerCase().includes(needle) || question.topics.some((topic) => topic.toLowerCase().includes(needle));
  }).slice(0, 7);
  const derivedUrl = composer.type === "leetcode" ? deriveLeetCodeFromUrl(composer.query, activeBank) : null;
  const canSaveActivity = composer.type === "leetcode" ? Boolean(composer.selectedId || derivedUrl) : Boolean(composer.selectedId || composer.query.trim());
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

  return (
    <>
    <main className="app-shell" aria-hidden={arrivalState !== "entered"}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")}><span className="brand-mark">IA</span><span>Interview Arc</span></button>
        <nav className="primary-nav" aria-label="Primary navigation">{([[
          "today", "Today"], ["journey", "Journey"], ["library", "Past"], ["banks", "Problem banks"]] as [View, string][]).map(([id, label], index) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
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
        <div className="page-content">{view === "today" && renderToday()}{view === "journey" && renderJourney()}{view === "library" && renderLibrary()}{view === "banks" && renderBanks()}</div>
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
            <p>Shape the session you need. The default is six coding problems, one system-design mock, and one behavioral mock. Interview Arc draws unique questions from the banks and builds one countdown from the time equation below.</p>
            <div className="session-recipe" aria-label="Session recipe">
              <SessionCountControl label="Coding" mark="C" value={composer.sessionCoding} minutesEach={CODING_SESSION_MINUTES} max={sessionAvailability.coding} onChange={(value) => setComposer((current) => ({ ...current, sessionCoding: value }))} />
              <SessionCountControl label="System design" mark="S" value={composer.sessionSystemDesign} minutesEach={INTERVIEW_SESSION_MINUTES} max={sessionAvailability.systemDesign} onChange={(value) => setComposer((current) => ({ ...current, sessionSystemDesign: value }))} />
              <SessionCountControl label="Behavioral" mark="B" value={composer.sessionBehavioral} minutesEach={INTERVIEW_SESSION_MINUTES} max={sessionAvailability.behavioral} onChange={(value) => setComposer((current) => ({ ...current, sessionBehavioral: value }))} />
            </div>
            <div className="session-total-strip">
              <div><span>SESSION COUNTDOWN</span><small>{composer.sessionCoding * CODING_SESSION_MINUTES}m coding + {composer.sessionSystemDesign * INTERVIEW_SESSION_MINUTES}m system design + {composer.sessionBehavioral * INTERVIEW_SESSION_MINUTES}m behavioral</small></div>
              <strong>{formatDuration(sessionTotalSeconds)}</strong>
            </div>
            <small>{sessionAvailability.coding} coding, {sessionAvailability.systemDesign} system-design, and {sessionAvailability.behavioral} behavioral questions are available after today&apos;s other picks. A recipe locks once its timer, activity work, or results begin.</small>
            <button className="primary-action full-width" onClick={saveFullSession} disabled={!canSaveSession}>{composer.editingSessionId ? "Save session recipe" : `Add session ${allSessions.length + 1}`}</button>
          </div> : <form onSubmit={saveActivity}>
            <div className="type-selector" role="group" aria-label="Practice type">{(["leetcode", "system_design", "behavioral"] as const).map((type) => <button type="button" key={type} className={`${type} ${composer.type === type ? "active" : ""}`} onClick={() => setComposer((current) => ({ ...current, type, query: "", selectedId: "", minutes: type === "leetcode" ? "30" : type === "system_design" ? "90" : "60" }))}>{typeLabel(type)}</button>)}</div>
            <label className="search-field"><span>{composer.type === "leetcode" ? "Search the bank or paste a LeetCode URL" : `Search the ${typeLabel(composer.type).toLowerCase()} bank or type a new title`}</span><input autoFocus value={composer.query} onChange={(event) => setComposer((current) => ({ ...current, query: event.target.value, selectedId: "" }))} placeholder={composer.type === "leetcode" ? "Search titles and topics, or https://leetcode.com/problems/…" : "Search or enter a custom question"} /></label>
            {derivedUrl && !composer.selectedId && <div className="derived-question"><span>Title extracted from URL</span><strong>{derivedUrl.title}</strong><small>{derivedUrl.url}</small></div>}
            {!derivedUrl && <div className="bank-results">{filteredQuestions.length ? filteredQuestions.map((question) => <button type="button" className={composer.selectedId === question.id ? "selected" : ""} key={question.id} onClick={() => selectBankQuestion(question)}><span className={`type-mark ${composer.type}`}>{typeMark(composer.type)}</span><div><strong>{question.title}</strong><small>{question.difficulty ? `${question.difficulty} · ` : ""}{question.topics.join(" · ")}</small></div><span>{composer.selectedId === question.id ? "Selected" : "Choose"}</span></button>) : <p className="no-results">{composer.type === "leetcode" ? "No bank match. Paste the public LeetCode problem URL and the title will be extracted automatically." : "No bank match. Your typed title will become a custom question."}</p>}</div>}
            <label className="minutes-field"><span>Planning estimate in minutes</span><input type="number" min="1" max="360" value={composer.minutes} onChange={(event) => setComposer((current) => ({ ...current, minutes: event.target.value }))} /></label>
            <button className="primary-action full-width" type="submit" disabled={!canSaveActivity}>{composer.editingId ? "Save changes" : "Add to today"}</button>
          </form>}
        </section>
      </div>}

      {integrationOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setIntegrationOpen(false)}><section className="composer integration-dialog" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setIntegrationOpen(false)} aria-label="Close">×</button><span className="eyebrow">ONE LIVE PRACTICE RECORD</span><h2 id="integration-title">Connect Codex and the LeetCode companion</h2><p>Create one personal token so both tools can read today&apos;s D1 state, control timers, and process every finished activity automatically. The token is shown once and stored as a secure digest.</p>{integrationToken ? <><label className="token-field"><span>Personal connection token</span><input readOnly value={integrationToken} onFocus={(event) => event.currentTarget.select()} /></label><button className="primary-action full-width" onClick={copyConnectionToken}>Copy token</button><div className="integration-steps"><strong>Use it in two places</strong><ol><li>Set <code>INTERVIEW_ARC_MCP_TOKEN</code> before opening Codex in this project.</li><li>Paste the same token into the Interview Arc Chrome companion after loading the extension.</li></ol></div></> : <button className="primary-action full-width" disabled={integrationBusy} onClick={createConnectionToken}>{integrationBusy ? "Creating…" : "Create personal connection token"}</button>}<small className="integration-warning">Treat this token like a password. Create a new one if it is ever shared accidentally.</small></section></div>}

      {selectedEntry && <div className="letter-backdrop" role="presentation" onMouseDown={() => setSelectedEntry(null)}><article className="reading-letter" role="dialog" aria-modal="true" aria-labelledby="letter-title" onMouseDown={(event) => event.stopPropagation()}><button className="letter-close" onClick={() => setSelectedEntry(null)} aria-label="Close letter">Close ×</button><header><div><span className={`type-chip ${selectedEntry.type}`}>{typeLabel(selectedEntry.type)}</span><time>{readableDate(selectedEntry.date)}</time></div><h2 id="letter-title">{selectedEntry.title}</h2><p>{selectedEntry.subtitle}</p></header><div className="letter-facts"><div><span>Status</span><strong>{selectedEntry.status}</strong></div><div><span>Time recorded</span><strong>{selectedEntry.elapsedSeconds ? formatClock(selectedEntry.elapsedSeconds) : "Not recorded"}</strong></div>{selectedEntry.type === "leetcode" && <div><span>Outcome</span><strong>{outcomeLabel(selectedEntry.outcome)}</strong></div>}</div>{selectedEntry.artifact ? <div className="letter-sections">{selectedEntry.artifact.sections.map((section) => /conversation transcript|generated code|solution/i.test(section.title) ? <details key={section.title} open={/solution/i.test(section.title)}><summary>{section.title}</summary><MarkdownBody source={section.body} /></details> : <section key={section.title}><h3>{section.title}</h3><MarkdownBody source={section.body} /></section>)}</div> : <div className="unpublished-letter"><span className="eyebrow">LOCAL COMPLETION · NOT PUBLISHED YET</span><h3>The result is saved on this device, but its review is not in the repository yet.</h3><p>Export today&apos;s draft and ask the matching specialist task to publish. Coding records will show the generated solution and complexity; system-design and behavioral records will show the formatted conversation transcript and review.</p>{selectedEntry.url && <a href={selectedEntry.url} target="_blank" rel="noreferrer">Open original problem ↗</a>}</div>}<footer>Interview Arc · {selectedEntry.id}</footer></article></div>}
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

"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  contentIndex,
  type ContentArtifact,
  type JournalActivity,
  type PracticeSession,
  type QuestionBankItem,
} from "./generated/content-index";

type View = "today" | "journey" | "library" | "stories";
type ActivityType = JournalActivity["type"];
type Outcome = "solved" | "solved_after_reviewing_approach" | "failed";
type TimerDraft = { elapsedSeconds: number; runningSince: number | null; completed: boolean };
type ExtraActivity = JournalActivity & { timerGroupId: string };
type LocalSession = PracticeSession & { source: "extra" };
type LocalDraft = {
  timers: Record<string, TimerDraft>;
  outcomes: Record<string, Outcome>;
  extraActivities: ExtraActivity[];
  sessions: LocalSession[];
};
type ComposerMode = "session" | "activity";
type ComposerState = {
  open: boolean;
  mode: ComposerMode;
  type: ActivityType;
  query: string;
  selectedId: string;
  minutes: string;
  editingId: string;
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
  url?: string;
  artifact?: ContentArtifact;
};

const EMPTY_DRAFT: LocalDraft = { timers: {}, outcomes: {}, extraActivities: [], sessions: [] };
const EMPTY_COMPOSER: ComposerState = {
  open: false,
  mode: "activity",
  type: "leetcode",
  query: "",
  selectedId: "",
  minutes: "30",
  editingId: "",
};
const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "solved", label: "Solved" },
  { value: "solved_after_reviewing_approach", label: "Solved after reviewing approach" },
  { value: "failed", label: "Failed" },
];

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
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

function elapsed(timer: TimerDraft | undefined, now: number) {
  if (!timer) return 0;
  return timer.elapsedSeconds +
    (timer.runningSince ? Math.max(0, Math.floor((now - timer.runningSince) / 1000)) : 0);
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
  if (outcome === "solved_after_reviewing_approach") return "Solved after review";
  if (outcome === "failed") return "Failed";
  return "No result yet";
}

function plainText(markdown: string) {
  return markdown.replace(/```[\s\S]*?```/g, "Code example").replace(/[*_`>#-]/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "practice";
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
    <div className={`activity-timer ${running ? "running" : ""}`}>
      <div className="activity-time-copy">
        <span>Time spent</span>
        <strong>{formatClock(used)}</strong>
        <small>{formatDuration(activity.allocatedSeconds)} target</small>
      </div>
      <div className="activity-time-actions">
        <button className="start-timer" onClick={() => onToggle(activity.id)}>
          {running ? "Pause" : used ? "Resume" : "Start"}
        </button>
        <button className="finish-timer" onClick={() => onComplete(activity.id)} disabled={complete}>
          {complete ? "Finished" : "Finish"}
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const journal = contentIndex.journals[0];
  const [view, setView] = useState<View>("today");
  const [draft, setDraft] = useState<LocalDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<"all" | ActivityType>("all");
  const storageKey = `interview-arc-draft-${journal.date}`;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<LocalDraft>;
          setDraft({
            timers: parsed.timers ?? {},
            outcomes: parsed.outcomes ?? {},
            extraActivities: parsed.extraActivities ?? [],
            sessions: parsed.sessions ?? [],
          });
        }
      } catch {
        setDraft(EMPTY_DRAFT);
      } finally {
        setHydrated(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, hydrated, storageKey]);

  useEffect(() => {
    if (!Object.values(draft.timers).some((timer) => timer.runningSince)) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [draft.timers]);

  useEffect(() => {
    if (!composer.open && !selectedEntry) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposer(EMPTY_COMPOSER);
        setSelectedEntry(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [composer.open, selectedEntry]);

  const allTodayActivities = [...journal.activities, ...draft.extraActivities];
  const versionedSessions = journal.sessions.length ? journal.sessions : [{
    id: `${journal.date}-session-1`,
    label: "Required session",
    source: "daily" as const,
    activityIds: journal.activities.map((activity) => activity.id),
  }];
  const allSessions: PracticeSession[] = [...versionedSessions, ...draft.sessions];
  const assignedExtraIds = new Set(draft.sessions.flatMap((session) => session.activityIds));
  const looseActivities = draft.extraActivities.filter((activity) => !assignedExtraIds.has(activity.id));

  function bankFor(type: ActivityType) {
    if (type === "leetcode") return contentIndex.questionBanks.leetcode;
    if (type === "system_design") return contentIndex.questionBanks.systemDesign;
    return contentIndex.questionBanks.behavioral;
  }

  function toggleTimer(activityId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    setDraft((current) => {
      const timers = { ...current.timers };
      const prior = timers[activityId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      if (prior.runningSince) {
        timers[activityId] = { elapsedSeconds: elapsed(prior, timestamp), runningSince: null, completed: false };
      } else {
        for (const [id, active] of Object.entries(timers)) {
          if (active.runningSince) timers[id] = { ...active, elapsedSeconds: elapsed(active, timestamp), runningSince: null };
        }
        timers[activityId] = { elapsedSeconds: prior.elapsedSeconds, runningSince: timestamp, completed: false };
      }
      return { ...current, timers };
    });
  }

  function completeTimer(activityId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
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

  function setOutcome(activityId: string, outcome: Outcome | "") {
    setDraft((current) => {
      const outcomes = { ...current.outcomes };
      if (outcome) outcomes[activityId] = outcome;
      else delete outcomes[activityId];
      return { ...current, outcomes };
    });
  }

  function isActivityComplete(activity: JournalActivity) {
    if (activity.status === "completed") return true;
    if (activity.type === "leetcode") return Boolean(draft.outcomes[activity.id] ?? activity.outcome);
    return Boolean(draft.timers[activity.id]?.completed);
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
      open: true,
      mode: "activity",
      type: activity.type,
      query: activity.type === "leetcode" ? activity.url ?? activity.title : activity.title,
      selectedId: known?.id ?? "",
      minutes: String(Math.round(activity.allocatedSeconds / 60)),
      editingId: activity.id,
    });
  }

  function selectBankQuestion(question: QuestionBankItem) {
    setComposer((current) => ({
      ...current,
      selectedId: question.id,
      query: question.title,
      minutes: String(question.targetMinutes),
    }));
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
    const id = existing?.id ?? `${journal.date}-extra-${slugify(title)}-${Date.now().toString(36)}`;
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
    setComposer(EMPTY_COMPOSER);
  }

  function addFullSession() {
    const stamp = Date.now().toString(36);
    const sessionNumber = allSessions.length + 1;
    const sessionId = `${journal.date}-session-${sessionNumber}-${stamp}`;
    const codingQuestions = contentIndex.questionBanks.leetcode.filter((question) => question.active).slice(0, 6);
    const systemQuestions = contentIndex.questionBanks.systemDesign.filter((question) => question.active);
    const behaviorQuestions = contentIndex.questionBanks.behavioral.filter((question) => question.active);
    const systemQuestion = systemQuestions[(sessionNumber - 1) % Math.max(1, systemQuestions.length)];
    const behaviorQuestion = behaviorQuestions[(sessionNumber - 1) % Math.max(1, behaviorQuestions.length)];
    const activities: ExtraActivity[] = codingQuestions.map((question) => ({
      schemaVersion: 2,
      id: `${sessionId}-${question.id}`,
      date: journal.date,
      source: "extra",
      type: "leetcode",
      recordKind: "attempt",
      title: question.title,
      url: question.url,
      allocatedSeconds: question.targetMinutes * 60,
      timerGroupId: `${sessionId}-coding`,
      timingSource: "website",
      status: "planned",
      notes: question.topics.join(", "),
    }));
    if (systemQuestion) activities.push({
      schemaVersion: 2,
      id: `${sessionId}-${systemQuestion.id}`,
      date: journal.date,
      source: "extra",
      type: "system_design",
      title: systemQuestion.title,
      prompt: systemQuestion.prompt,
      allocatedSeconds: systemQuestion.targetMinutes * 60,
      timerGroupId: `${sessionId}-system-design`,
      timingSource: "website",
      status: "planned",
      notes: systemQuestion.topics.join(", "),
    });
    if (behaviorQuestion) activities.push({
      schemaVersion: 2,
      id: `${sessionId}-${behaviorQuestion.id}`,
      date: journal.date,
      source: "extra",
      type: "behavioral",
      title: behaviorQuestion.title,
      prompt: behaviorQuestion.prompt,
      allocatedSeconds: behaviorQuestion.targetMinutes * 60,
      timerGroupId: `${sessionId}-behavioral`,
      timingSource: "website",
      status: "planned",
      notes: behaviorQuestion.topics.join(", "),
    });
    const session: LocalSession = { id: sessionId, label: `Session ${sessionNumber}`, source: "extra", activityIds: activities.map((activity) => activity.id) };
    setDraft((current) => ({ ...current, extraActivities: [...current.extraActivities, ...activities], sessions: [...current.sessions, session] }));
    setComposer(EMPTY_COMPOSER);
  }

  function removeActivity(activityId: string) {
    setDraft((current) => {
      const timers = { ...current.timers };
      const outcomes = { ...current.outcomes };
      delete timers[activityId];
      delete outcomes[activityId];
      return {
        ...current,
        timers,
        outcomes,
        extraActivities: current.extraActivities.filter((activity) => activity.id !== activityId),
        sessions: current.sessions.map((session) => ({ ...session, activityIds: session.activityIds.filter((id) => id !== activityId) })),
      };
    });
  }

  function removeSession(session: LocalSession) {
    if (!window.confirm(`Remove ${session.label} and its local activities?`)) return;
    const ids = new Set(session.activityIds);
    setDraft((current) => {
      const timers = { ...current.timers };
      const outcomes = { ...current.outcomes };
      ids.forEach((id) => { delete timers[id]; delete outcomes[id]; });
      return {
        ...current,
        timers,
        outcomes,
        extraActivities: current.extraActivities.filter((activity) => !ids.has(activity.id)),
        sessions: current.sessions.filter((item) => item.id !== session.id),
      };
    });
  }

  function exportDraft() {
    const timestamp = Date.now();
    const timers = Object.fromEntries(Object.entries(draft.timers).map(([id, timer]) => [id, {
      elapsedSeconds: elapsed(timer, timestamp),
      running: Boolean(timer.runningSince),
      completed: timer.completed,
      timingSource: "website",
    }]));
    const payload = { schemaVersion: 2, date: journal.date, exportedAt: new Date(timestamp).toISOString(), localDraft: true, timers, outcomes: draft.outcomes, sessions: draft.sessions, extraActivities: draft.extraActivities };
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal-${journal.date}-draft.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  const logEntries = useMemo(() => {
    const entries: LogEntry[] = [];
    const artifactByActivity = new Map(contentIndex.artifacts.filter((artifact) => artifact.activityId).map((artifact) => [artifact.activityId, artifact]));
    for (const daily of contentIndex.journals) {
      for (const activity of daily.activities) {
        const localTimer = daily.date === journal.date ? draft.timers[activity.id] : undefined;
        const localOutcome = daily.date === journal.date ? draft.outcomes[activity.id] : undefined;
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
        url: activity.url,
      });
    }
    for (const artifact of contentIndex.artifacts) {
      if (artifact.activityId && entries.some((entry) => entry.id === artifact.activityId)) continue;
      const inferredType: ActivityType = artifact.type === "leetcode" || artifact.type === "behavioral" ? artifact.type : "system_design";
      const preview = artifact.sections.find((section) => /summary|short answer|question/i.test(section.title))?.body ?? "Published interview record";
      entries.push({ id: artifact.path, date: artifact.date, type: inferredType, title: artifact.title, subtitle: plainText(preview).slice(0, 160), status: "published", elapsedSeconds: 0, artifact });
    }
    return entries.sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title));
  }, [draft, journal.date, now]);

  const groupedLog = useMemo(() => {
    const groups = new Map<string, LogEntry[]>();
    for (const entry of logEntries) {
      if (libraryFilter !== "all" && entry.type !== libraryFilter) continue;
      groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [libraryFilter, logEntries]);

  const completedEntries = logEntries.filter((entry) => entry.status === "completed" || entry.status === "published");
  const codingSolved = completedEntries.filter((entry) => entry.type === "leetcode" && (entry.outcome === "solved" || entry.outcome === "solved_after_reviewing_approach")).length;
  const codingFailed = completedEntries.filter((entry) => entry.type === "leetcode" && entry.outcome === "failed").length;
  const systemCompleted = completedEntries.filter((entry) => entry.type === "system_design").length;
  const behaviorCompleted = completedEntries.filter((entry) => entry.type === "behavioral").length;
  const totalRecordedSeconds = completedEntries.reduce((sum, entry) => sum + entry.elapsedSeconds, 0);

  const dailyStats = useMemo(() => {
    const dates = [...new Set(logEntries.map((entry) => entry.date))].sort().slice(-14);
    return dates.map((date) => {
      const complete = logEntries.filter((entry) => entry.date === date && (entry.status === "completed" || entry.status === "published"));
      return {
        date,
        coding: complete.filter((entry) => entry.type === "leetcode").length,
        system: complete.filter((entry) => entry.type === "system_design").length,
        behavioral: complete.filter((entry) => entry.type === "behavioral").length,
        seconds: complete.reduce((sum, entry) => sum + entry.elapsedSeconds, 0),
      };
    });
  }, [logEntries]);

  const maxDailyCount = Math.max(1, ...dailyStats.map((day) => day.coding + day.system + day.behavioral));
  const maxDailySeconds = Math.max(1, ...dailyStats.map((day) => day.seconds));
  const calendarDays = useMemo(() => {
    const anchor = new Date(`${journal.date}T12:00:00Z`);
    return Array.from({ length: 35 }, (_, index) => {
      const date = new Date(anchor);
      date.setUTCDate(anchor.getUTCDate() - (34 - index));
      const key = date.toISOString().slice(0, 10);
      return { key, day: date.getUTCDate(), hasEntries: logEntries.some((entry) => entry.date === key) };
    });
  }, [journal.date, logEntries]);

  function sessionActivities(session: PracticeSession) {
    return allTodayActivities.filter((activity) => session.activityIds.includes(activity.id));
  }

  function renderSession(session: PracticeSession, index: number) {
    const activities = sessionActivities(session);
    const coding = activities.filter((activity) => activity.type === "leetcode");
    const system = activities.find((activity) => activity.type === "system_design");
    const behavioral = activities.find((activity) => activity.type === "behavioral");
    const complete = activities.filter(isActivityComplete).length;
    const codingSeconds = coding.reduce((sum, activity) => sum + elapsed(draft.timers[activity.id], now), 0);
    const targetSeconds = activities.reduce((sum, activity) => sum + activity.allocatedSeconds, 0);
    const localSession = draft.sessions.find((item) => item.id === session.id);
    return (
      <article className="session-sheet" key={session.id}>
        <header className="session-sheet-header">
          <div className="session-number"><span>{String(index + 1).padStart(2, "0")}</span><small>{session.source === "daily" ? "Required" : "Added"}</small></div>
          <div className="session-heading-copy"><p>Practice session</p><h2>{session.label}</h2><span>{activities.length} activities · {formatDuration(targetSeconds)} planned</span></div>
          <div className="session-progress"><strong>{complete}/{activities.length}</strong><span>finished</span></div>
          {localSession && <button className="remove-session" onClick={() => removeSession(localSession)}>Remove session</button>}
        </header>

        <section className="coding-ledger">
          <div className="ledger-heading">
            <div><span className="type-chip leetcode">Coding</span><h3>Six individually timed problems</h3><p>Only one timer runs at a time. The session total is the sum of these problem timers.</p></div>
            <div className="coding-total"><span>Coding total</span><strong>{formatClock(codingSeconds)}</strong><small>of 03:00:00 budget</small></div>
          </div>
          <div className="problem-ledger">
            {coding.map((activity, problemIndex) => {
              const isExtra = activity.source === "extra";
              return (
                <div className="problem-ledger-row" key={activity.id}>
                  <span className={`row-count ${isActivityComplete(activity) ? "complete" : ""}`}>{isActivityComplete(activity) ? "✓" : problemIndex + 1}</span>
                  <div className="problem-title"><strong>{activity.title}</strong><span>{activity.notes ?? "Coding problem"}</span>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open on LeetCode ↗</a>}</div>
                  <ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                  <label className="outcome-field"><span>Result</span><select value={draft.outcomes[activity.id] ?? activity.outcome ?? ""} onChange={(event) => setOutcome(activity.id, event.target.value as Outcome | "")}><option value="">Choose result</option>{OUTCOMES.map((outcome) => <option key={outcome.value} value={outcome.value}>{outcome.label}</option>)}</select></label>
                  {isExtra && <div className="row-edit-actions"><button onClick={() => openEditActivity(activity as ExtraActivity)}>Edit</button><button onClick={() => removeActivity(activity.id)}>Remove</button></div>}
                </div>
              );
            })}
          </div>
          <p className="ledger-note">Solve and submit on LeetCode. Interview Arc records the time and result you choose; it does not execute or inspect your submission.</p>
        </section>

        <div className="mock-grid">
          {[system, behavioral].filter(Boolean).map((activity) => {
            const item = activity!;
            const isExtra = item.source === "extra";
            return (
              <section className={`mock-sheet ${item.type}`} key={item.id}>
                <div className="mock-topline"><span className={`type-chip ${item.type}`}>{typeLabel(item.type)}</span>{isExtra && <div className="row-edit-actions"><button onClick={() => openEditActivity(item as ExtraActivity)}>Edit</button><button onClick={() => removeActivity(item.id)}>Remove</button></div>}</div>
                <h3>{item.title}</h3>
                <p>{item.prompt}</p>
                <ActivityTimer activity={item} timer={draft.timers[item.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                <div className="publish-instruction">After the mock, say <strong>“Publish this session”</strong> in the {item.type === "system_design" ? "system-design" : "behavioral"} task.</div>
              </section>
            );
          })}
        </div>
      </article>
    );
  }

  function renderToday() {
    const completeToday = allTodayActivities.filter(isActivityComplete).length;
    const totalToday = allTodayActivities.length;
    const todaySeconds = Object.entries(draft.timers).reduce((sum, [, timer]) => sum + elapsed(timer, now), 0);
    return (
      <>
        <section className="today-masthead">
          <div className="date-poster"><strong>{journal.date.slice(-2)}</strong><span>{new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</span></div>
          <div className="today-thesis"><span className="eyebrow">TODAY · {journal.focus.toUpperCase()}</span><h1>One timer. One problem.<br /><em>One honest record.</em></h1><p>{journal.note}</p></div>
          <div className="today-tally"><div><strong>{completeToday}/{totalToday}</strong><span>activities finished</span></div><div><strong>{formatDuration(todaySeconds)}</strong><span>time recorded locally</span></div><div><strong>{allSessions.length}</strong><span>session{allSessions.length === 1 ? "" : "s"} today</span></div></div>
        </section>

        <div className="today-actions"><div><h2>Today&apos;s sessions</h2><p>Every coding problem now keeps its own elapsed time.</p></div><div><button className="secondary-action" onClick={openNewActivity}>Add one activity</button><button className="primary-action" onClick={openNewSession}>＋ Add another session</button></div></div>
        <section className="session-stack">{allSessions.map(renderSession)}</section>

        <section className="loose-section">
          <div className="section-title"><div><span className="eyebrow">STANDALONE PRACTICE</span><h2>Outside a full session</h2></div><button className="text-action" onClick={openNewActivity}>＋ Add activity</button></div>
          {looseActivities.length === 0 ? <div className="quiet-empty"><strong>No standalone activities yet.</strong><span>Search any question bank or paste a public LeetCode problem URL.</span></div> : <div className="loose-list">{looseActivities.map((activity) => <article key={activity.id}><span className={`type-mark ${activity.type}`}>{typeMark(activity.type)}</span><div><small>{typeLabel(activity.type)} · local draft</small><strong>{activity.title}</strong>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open reference ↗</a>}</div><ActivityTimer activity={activity} timer={draft.timers[activity.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} /><div className="row-edit-actions"><button onClick={() => openEditActivity(activity)}>Edit</button><button onClick={() => removeActivity(activity.id)}>Remove</button></div></article>)}</div>}
        </section>
      </>
    );
  }

  function renderJourney() {
    return (
      <section className="view-page journey-page">
        <header className="view-masthead"><span className="eyebrow">JOURNEY · PUBLISHED + TODAY&apos;S LOCAL DRAFT</span><h1>Progress you can<br /><em>actually count.</em></h1><p>Completed artifacts are permanent. Today&apos;s device-local work is included here so you can see the day taking shape before publication.</p></header>
        <div className="stat-ledger">
          <article className="stat-block coding-stat"><span>Coding solved</span><strong>{codingSolved}</strong><small>{codingFailed} failed attempt{codingFailed === 1 ? "" : "s"}</small></article>
          <article className="stat-block system-stat"><span>System designs</span><strong>{systemCompleted}</strong><small>completed or published</small></article>
          <article className="stat-block behavior-stat"><span>Behavioral answers</span><strong>{behaviorCompleted}</strong><small>completed or published</small></article>
          <article className="stat-block time-stat"><span>Recorded time</span><strong>{formatDuration(totalRecordedSeconds)}</strong><small>from completed activity timers</small></article>
        </div>

        <div className="analytics-grid">
          <article className="chart-sheet activity-chart">
            <div className="chart-heading"><div><span className="eyebrow">DAILY OUTPUT</span><h2>Completed activities by day</h2></div><div className="chart-legend"><span className="leetcode">Coding</span><span className="system_design">System</span><span className="behavioral">Behavioral</span></div></div>
            <div className="bar-plot">{dailyStats.map((day) => {
              const total = day.coding + day.system + day.behavioral;
              return <div className="bar-row" key={day.date}><time>{readableDate(day.date, true)}</time><div className="bar-track" aria-label={`${total} completed activities`}><span className="leetcode" style={{ width: `${(day.coding / maxDailyCount) * 100}%` }} /><span className="system_design" style={{ width: `${(day.system / maxDailyCount) * 100}%` }} /><span className="behavioral" style={{ width: `${(day.behavioral / maxDailyCount) * 100}%` }} /></div><strong>{total}</strong></div>;
            })}</div>
            {dailyStats.every((day) => day.coding + day.system + day.behavioral === 0) && <p className="chart-empty">No completed activity has been recorded yet. Planned questions are not counted as solved.</p>}
          </article>

          <article className="chart-sheet outcome-chart">
            <div className="chart-heading"><div><span className="eyebrow">CODING OUTCOMES</span><h2>How problems ended</h2></div></div>
            <div className="outcome-numbers"><div><strong>{completedEntries.filter((entry) => entry.outcome === "solved").length}</strong><span>Solved</span></div><div><strong>{completedEntries.filter((entry) => entry.outcome === "solved_after_reviewing_approach").length}</strong><span>After review</span></div><div><strong>{codingFailed}</strong><span>Failed</span></div></div>
            <div className="outcome-rule"><span className="solved" style={{ flex: completedEntries.filter((entry) => entry.outcome === "solved").length || .2 }} /><span className="reviewed" style={{ flex: completedEntries.filter((entry) => entry.outcome === "solved_after_reviewing_approach").length || .2 }} /><span className="failed" style={{ flex: codingFailed || .2 }} /></div>
            <p>Walkthroughs without a real attempt are intentionally excluded from solved totals.</p>
          </article>

          <article className="chart-sheet time-chart">
            <div className="chart-heading"><div><span className="eyebrow">TIME TREND</span><h2>Recorded practice by day</h2></div></div>
            <div className="time-plot">{dailyStats.map((day) => <div key={day.date}><time>{readableDate(day.date, true)}</time><span><i style={{ width: `${(day.seconds / maxDailySeconds) * 100}%` }} /></span><strong>{formatDuration(day.seconds)}</strong></div>)}</div>
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
        <header className="view-masthead"><span className="eyebrow">PRACTICE LIBRARY · DATE-ORDERED LOG</span><h1>Read the journey<br /><em>like a field journal.</em></h1><p>Every day stays together. Filter by practice type, jump from the calendar, and open any record as a centered reading letter.</p></header>
        <div className="library-toolbar"><div className="filter-row" role="group" aria-label="Filter practice log">{(["all", "leetcode", "system_design", "behavioral"] as const).map((filter) => <button key={filter} className={libraryFilter === filter ? "active" : ""} onClick={() => setLibraryFilter(filter)}>{filter === "all" ? "All records" : typeLabel(filter)}</button>)}</div><span>{groupedLog.reduce((sum, [, entries]) => sum + entries.length, 0)} records shown</span></div>
        <div className="log-layout">
          <div className="dated-log">
            {groupedLog.map(([date, entries]) => <section className="log-day" id={`log-date-${date}`} key={date}><header><time>{readableDate(date)}</time><span>{entries.length} record{entries.length === 1 ? "" : "s"}</span></header><div className="log-day-entries">{entries.map((entry) => <button className={`log-entry ${entry.type}`} key={entry.id} onClick={() => setSelectedEntry(entry)}><span className={`type-mark ${entry.type}`}>{typeMark(entry.type)}</span><div className="log-entry-copy"><small>{typeLabel(entry.type)} · {entry.status}</small><strong>{entry.title}</strong><span>{entry.subtitle}</span></div><div className="log-entry-meta"><strong>{entry.elapsedSeconds ? formatClock(entry.elapsedSeconds) : "—"}</strong><span>{entry.type === "leetcode" ? outcomeLabel(entry.outcome) : entry.artifact ? "Published record" : entry.status}</span></div><span className="open-letter">Read →</span></button>)}</div></section>)}
          </div>
          <aside className="log-calendar"><span className="eyebrow">JUMP TO A DAY</span><h2>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${journal.date}T12:00:00Z`))}</h2><div className="calendar-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div className="calendar-mini">{calendarDays.map((day) => day.hasEntries ? <button key={day.key} onClick={() => scrollToLogDate(day.key)} title={`Jump to ${day.key}`}>{day.day}<i /></button> : <span key={day.key}>{day.day}</span>)}</div><div className="calendar-dates">{groupedLog.map(([date]) => <button key={date} onClick={() => scrollToLogDate(date)}>{readableDate(date, true)} <span>↘</span></button>)}</div></aside>
        </div>
      </section>
    );
  }

  function renderStories() {
    return (
      <section className="view-page story-page">
        <header className="view-masthead"><span className="eyebrow">STORY BANK · PROJECT EVIDENCE</span><h1>Begin with what<br /><em>actually happened.</em></h1><p>Projects hold the facts. Interview answers borrow those facts without inventing ownership, metrics, or impact.</p></header>
        {contentIndex.stories.length ? <div className="project-shelf">{contentIndex.stories.map((story, index) => <button key={story.path} onClick={() => setSelectedEntry({ id: story.path, date: story.date, type: "behavioral", title: story.title, subtitle: `${story.sections.length} evidence sections`, status: "published", elapsedSeconds: 0, artifact: story })}><span>{String(index + 1).padStart(2, "0")}</span><div><small>Project source</small><h2>{story.title}</h2><p>{story.sections.length} evidence sections</p></div><strong>Open project letter →</strong></button>)}</div> : <div className="story-workbench"><div className="story-sequence"><span>Project</span><i /><span>Decision</span><i /><span>Result</span><i /><span>Story</span></div><div><span className="eyebrow">THE BANK IS READY</span><h2>Discover the evidence before polishing the answer.</h2><p>Use the behavioral task to walk through one real project. Publishing will create the first project source here and link future answers back to it.</p><button className="primary-action" onClick={() => { setView("today"); openNewActivity(); setComposer((current) => ({ ...current, type: "behavioral", minutes: "60" })); }}>Add a behavioral question</button></div></div>}
        <section className="question-bank-preview"><div className="section-title"><div><span className="eyebrow">BEHAVIORAL QUESTION BANK</span><h2>Questions ready for a mock</h2></div></div>{contentIndex.questionBanks.behavioral.map((question) => <article key={question.id}><span className="type-mark behavioral">B</span><div><strong>{question.title}</strong><p>{question.prompt}</p></div><button onClick={() => { setView("today"); setComposer({ ...EMPTY_COMPOSER, open: true, mode: "activity", type: "behavioral", query: question.title, selectedId: question.id, minutes: String(question.targetMinutes) }); }}>Add to today</button></article>)}</section>
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")}><span className="brand-mark">IA</span><span>Interview Arc</span></button>
        <nav className="primary-nav" aria-label="Primary navigation">{([[
          "today", "Today"], ["journey", "Journey"], ["library", "Practice library"], ["stories", "Story bank"]] as [View, string][]).map(([id, label], index) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
        <div className="sidebar-status"><span className={Object.values(draft.timers).some((timer) => timer.runningSince) ? "live" : ""} /><div><strong>{Object.values(draft.timers).some((timer) => timer.runningSince) ? "Timer running" : hydrated ? "Draft saved locally" : "Loading draft"}</strong><small>One activity timer at a time</small></div></div>
        <div className="profile"><span>WX</span><div><strong>Wenk Xu</strong><small>Interview journey · 2026</small></div></div>
      </aside>

      <section className="main-column">
        <header className="topbar"><div><span>{readableDate(journal.date)}</span><strong>{view === "today" ? "Today’s work" : view === "journey" ? "Statistics" : view === "library" ? "Dated practice log" : "Project story sources"}</strong></div><div><button className="secondary-action" onClick={exportDraft}>Export today</button><button className="primary-action" onClick={openNewActivity}>＋ Add</button></div></header>
        <div className="page-content">{view === "today" && renderToday()}{view === "journey" && renderJourney()}{view === "library" && renderLibrary()}{view === "stories" && renderStories()}</div>
      </section>

      {composer.open && <div className="modal-backdrop" role="presentation" onMouseDown={() => setComposer(EMPTY_COMPOSER)}><section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setComposer(EMPTY_COMPOSER)} aria-label="Close">×</button><span className="eyebrow">BUILD TODAY&apos;S WORK</span><h2 id="composer-title">{composer.editingId ? "Edit this activity" : composer.mode === "session" ? "Add another full session" : "Add one activity"}</h2>
        {!composer.editingId && <div className="composer-mode"><button className={composer.mode === "session" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, mode: "session" }))}>Full session</button><button className={composer.mode === "activity" ? "active" : ""} onClick={() => setComposer((current) => ({ ...current, mode: "activity" }))}>Single activity</button></div>}
        {composer.mode === "session" && !composer.editingId ? <div className="session-composer"><p>A full session adds six questions from your LeetCode bank, one system-design question, and one behavioral question. Every activity receives its own timer.</p><div className="session-recipe"><div><strong>6</strong><span>Coding problems</span></div><div><strong>1</strong><span>System design</span></div><div><strong>1</strong><span>Behavioral</span></div></div><small>Questions come from the three versioned banks. As you add your TikTok lists, new sessions will use that data.</small><button className="primary-action full-width" onClick={addFullSession}>Add {allSessions.length + 1 === 2 ? "second" : `session ${allSessions.length + 1}`}</button></div> : <form onSubmit={saveActivity}><div className="type-selector" role="group" aria-label="Practice type">{(["leetcode", "system_design", "behavioral"] as const).map((type) => <button type="button" key={type} className={`${type} ${composer.type === type ? "active" : ""}`} onClick={() => setComposer((current) => ({ ...current, type, query: "", selectedId: "", minutes: type === "leetcode" ? "30" : type === "system_design" ? "90" : "60" }))}>{typeLabel(type)}</button>)}</div><label className="search-field"><span>{composer.type === "leetcode" ? "Search the bank or paste a LeetCode URL" : `Search the ${typeLabel(composer.type).toLowerCase()} bank or type a new title`}</span><input autoFocus value={composer.query} onChange={(event) => setComposer((current) => ({ ...current, query: event.target.value, selectedId: "" }))} placeholder={composer.type === "leetcode" ? "Search titles and topics, or https://leetcode.com/problems/…" : "Search or enter a custom question"} /></label>
        {derivedUrl && !composer.selectedId && <div className="derived-question"><span>Title extracted from URL</span><strong>{derivedUrl.title}</strong><small>{derivedUrl.url}</small></div>}
        {!derivedUrl && <div className="bank-results">{filteredQuestions.length ? filteredQuestions.map((question) => <button type="button" className={composer.selectedId === question.id ? "selected" : ""} key={question.id} onClick={() => selectBankQuestion(question)}><span className={`type-mark ${composer.type}`}>{typeMark(composer.type)}</span><div><strong>{question.title}</strong><small>{question.difficulty ? `${question.difficulty} · ` : ""}{question.topics.join(" · ")}</small></div><span>{composer.selectedId === question.id ? "Selected" : "Choose"}</span></button>) : <p className="no-results">{composer.type === "leetcode" ? "No bank match. Paste the public LeetCode problem URL and the title will be extracted automatically." : "No bank match. Your typed title will become a custom question."}</p>}</div>}
        <label className="minutes-field"><span>Timer in minutes</span><input type="number" min="1" max="360" value={composer.minutes} onChange={(event) => setComposer((current) => ({ ...current, minutes: event.target.value }))} /></label><button className="primary-action full-width" type="submit" disabled={!canSaveActivity}>{composer.editingId ? "Save changes" : "Add to today"}</button></form>}
      </section></div>}

      {selectedEntry && <div className="letter-backdrop" role="presentation" onMouseDown={() => setSelectedEntry(null)}><article className="reading-letter" role="dialog" aria-modal="true" aria-labelledby="letter-title" onMouseDown={(event) => event.stopPropagation()}><button className="letter-close" onClick={() => setSelectedEntry(null)} aria-label="Close letter">Close ×</button><header><div><span className={`type-chip ${selectedEntry.type}`}>{typeLabel(selectedEntry.type)}</span><time>{readableDate(selectedEntry.date)}</time></div><h2 id="letter-title">{selectedEntry.title}</h2><p>{selectedEntry.subtitle}</p></header><div className="letter-facts"><div><span>Status</span><strong>{selectedEntry.status}</strong></div><div><span>Time recorded</span><strong>{selectedEntry.elapsedSeconds ? formatClock(selectedEntry.elapsedSeconds) : "Not recorded"}</strong></div>{selectedEntry.type === "leetcode" && <div><span>Outcome</span><strong>{outcomeLabel(selectedEntry.outcome)}</strong></div>}</div>{selectedEntry.artifact ? <div className="letter-sections">{selectedEntry.artifact.sections.map((section) => /conversation transcript|generated code/i.test(section.title) ? <details key={section.title}><summary>{section.title}</summary><pre>{section.body}</pre></details> : <section key={section.title}><h3>{section.title}</h3><pre>{section.body}</pre></section>)}</div> : <div className="unpublished-letter"><span className="eyebrow">LOCAL OR PLANNED RECORD</span><h3>This entry does not have a published review yet.</h3><p>Complete the activity, export today&apos;s draft when needed, and say “Publish this session” in the matching specialist task. The finished artifact will appear inside this letter after the next site build.</p>{selectedEntry.url && <a href={selectedEntry.url} target="_blank" rel="noreferrer">Open original problem ↗</a>}</div>}<footer>Interview Arc · {selectedEntry.id}</footer></article></div>}
    </main>
  );
}

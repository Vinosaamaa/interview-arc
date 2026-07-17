"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  contentIndex,
  type ContentArtifact,
  type JournalActivity,
  type TimerGroup,
} from "./generated/content-index";

type View = "today" | "journey" | "library" | "stories";
type Outcome = "solved" | "solved_after_reviewing_approach" | "failed";
type TimerDraft = {
  elapsedSeconds: number;
  runningSince: number | null;
  completed: boolean;
};
type ExtraActivity = JournalActivity & { timerGroupId: string };
type LocalDraft = {
  timers: Record<string, TimerDraft>;
  outcomes: Record<string, Outcome>;
  extraActivities: ExtraActivity[];
};

const EMPTY_DRAFT: LocalDraft = { timers: {}, outcomes: {}, extraActivities: [] };
const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "solved", label: "Solved" },
  { value: "solved_after_reviewing_approach", label: "Solved after review" },
  { value: "failed", label: "Failed" },
];

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function readableDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function elapsed(timer: TimerDraft | undefined, now: number) {
  if (!timer) return 0;
  return timer.elapsedSeconds +
    (timer.runningSince ? Math.max(0, Math.floor((now - timer.runningSince) / 1000)) : 0);
}

function activityLabel(type: JournalActivity["type"] | "audio_review") {
  if (type === "leetcode") return "Coding";
  if (type === "system_design") return "System design";
  if (type === "behavioral") return "Behavioral";
  return "Audio review";
}

function activityGlyph(type: JournalActivity["type"]) {
  if (type === "leetcode") return "⌘";
  if (type === "system_design") return "△";
  return "◎";
}

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "Code example")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function TimerControl({
  timerId,
  allocatedSeconds,
  timer,
  now,
  onToggle,
  onComplete,
}: {
  timerId: string;
  allocatedSeconds: number;
  timer?: TimerDraft;
  now: number;
  onToggle: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const used = elapsed(timer, now);
  const remaining = allocatedSeconds - used;
  const isRunning = Boolean(timer?.runningSince);
  const isComplete = Boolean(timer?.completed);
  const primaryLabel = isComplete ? "Resume" : isRunning ? "Pause" : used > 0 ? "Resume" : "Start";

  return (
    <div className={`timer-control ${isRunning ? "is-running" : ""}`}>
      <div className="timer-readout">
        <span>{remaining >= 0 ? "Remaining" : "Over target"}</span>
        <strong>{formatClock(Math.abs(remaining))}</strong>
        <small>{formatClock(used)} elapsed</small>
      </div>
      <div className="timer-actions">
        <button className="timer-primary" onClick={() => onToggle(timerId)}>
          {isRunning ? "Ⅱ" : "▶"} {primaryLabel}
        </button>
        <button className="timer-complete" onClick={() => onComplete(timerId)} disabled={isComplete}>
          {isComplete ? "Logged" : "Complete"}
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
  const [extraOpen, setExtraOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<ContentArtifact | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<"all" | JournalActivity["type"]>("all");
  const [extraForm, setExtraForm] = useState({
    type: "leetcode" as JournalActivity["type"],
    title: "",
    url: "",
    minutes: "30",
  });

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
    if (!extraOpen && !selectedArtifact) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExtraOpen(false);
        setSelectedArtifact(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [extraOpen, selectedArtifact]);

  const codingActivities = journal.activities.filter((activity) => activity.type === "leetcode");
  const systemActivity = journal.activities.find((activity) => activity.type === "system_design");
  const behavioralActivity = journal.activities.find((activity) => activity.type === "behavioral");
  const groupById = useMemo(
    () => Object.fromEntries(journal.timerGroups.map((group) => [group.id, group])) as Record<string, TimerGroup>,
    [journal.timerGroups],
  );

  function toggleTimer(timerId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    setDraft((current) => {
      const prior = current.timers[timerId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      const next: TimerDraft = prior.runningSince
        ? {
            elapsedSeconds: elapsed(prior, timestamp),
            runningSince: null,
            completed: false,
          }
        : {
            elapsedSeconds: prior.elapsedSeconds,
            runningSince: timestamp,
            completed: false,
          };
      return { ...current, timers: { ...current.timers, [timerId]: next } };
    });
  }

  function completeTimer(timerId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    setDraft((current) => {
      const prior = current.timers[timerId] ?? { elapsedSeconds: 0, runningSince: null, completed: false };
      return {
        ...current,
        timers: {
          ...current.timers,
          [timerId]: { elapsedSeconds: elapsed(prior, timestamp), runningSince: null, completed: true },
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

  function addExtra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = extraForm.title.trim();
    if (!title) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "practice";
    const id = `${journal.date}-extra-${slug}-${Date.now().toString(36)}`;
    const minutes = Math.max(1, Number(extraForm.minutes) || 30);
    const extra: ExtraActivity = {
      schemaVersion: 2,
      id,
      date: journal.date,
      source: "extra",
      type: extraForm.type,
      ...(extraForm.type === "leetcode" ? { recordKind: "attempt" as const } : {}),
      title,
      ...(extraForm.url.trim() ? { url: extraForm.url.trim() } : {}),
      allocatedSeconds: minutes * 60,
      timerGroupId: id,
      timingSource: "website",
      status: "planned",
    };
    setDraft((current) => ({ ...current, extraActivities: [...current.extraActivities, extra] }));
    setExtraForm({ type: "leetcode", title: "", url: "", minutes: "30" });
    setExtraOpen(false);
  }

  function exportDraft() {
    const timestamp = Date.now();
    const timers = Object.fromEntries(
      Object.entries(draft.timers).map(([id, timer]) => [
        id,
        {
          elapsedSeconds: elapsed(timer, timestamp),
          running: Boolean(timer.runningSince),
          completed: timer.completed,
          timingSource: "website",
        },
      ]),
    );
    const payload = {
      schemaVersion: 1,
      date: journal.date,
      exportedAt: new Date(timestamp).toISOString(),
      localDraft: true,
      timers,
      outcomes: draft.outcomes,
      extraActivities: draft.extraActivities,
    };
    const url = window.URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal-${journal.date}-draft.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  function isComplete(activity: JournalActivity) {
    if (activity.type === "leetcode") return Boolean(draft.outcomes[activity.id] ?? activity.outcome);
    return Boolean(draft.timers[activity.timerGroupId ?? ""]?.completed || activity.status === "completed");
  }

  const completedRequired = journal.activities.filter(isComplete).length;
  const progress = Math.round((completedRequired / journal.activities.length) * 100);
  const totalElapsed = Object.values(draft.timers).reduce((sum, timer) => sum + elapsed(timer, now), 0);
  const publishedToday = contentIndex.artifacts.filter((artifact) => artifact.date === journal.date).length;

  const filteredArtifacts = contentIndex.artifacts.filter(
    (artifact) => libraryFilter === "all" || artifact.type === libraryFilter,
  );

  const calendarDays = useMemo(() => {
    const anchor = new Date(`${journal.date}T12:00:00Z`);
    return Array.from({ length: 35 }, (_, index) => {
      const date = new Date(anchor);
      date.setUTCDate(anchor.getUTCDate() - (34 - index));
      const key = date.toISOString().slice(0, 10);
      return { key, day: date.getUTCDate(), journal: contentIndex.journals.find((item) => item.date === key) };
    });
  }, [journal.date]);

  const publishedActivities = contentIndex.journals.flatMap((item) => item.activities);
  const publishedCompleted = publishedActivities.filter((activity) => activity.status === "completed");
  const publishedSeconds = publishedCompleted.reduce((sum, activity) => sum + (activity.elapsedSeconds ?? 0), 0);

  function renderToday() {
    const codingGroup = journal.timerGroups.find((group) =>
      codingActivities.some((activity) => group.activityIds.includes(activity.id)),
    ) ?? journal.timerGroups[0];
    return (
      <>
        <section className="day-hero">
          <div className="hero-copy">
            <span className="kicker">DAY {String(contentIndex.journals.length).padStart(2, "0")} · TODAY&apos;S FIELD NOTE</span>
            <h1>Make the work<br /><em>visible.</em></h1>
            <p>{journal.focus}. Timers stay local until you publish the session; finalized files become the journey.</p>
          </div>
          <div className="arc-board" aria-label={`${completedRequired} of ${journal.activities.length} required activities logged`}>
            <div className="arc-caption"><span>Today&apos;s arc</span><strong>{completedRequired}/{journal.activities.length}</strong></div>
            <div className="arc-line" aria-hidden="true" />
            <div className="arc-points">
              {journal.activities.map((activity, index) => (
                <div key={activity.id} className={`arc-point ${activity.type} ${isComplete(activity) ? "complete" : ""}`}>
                  <span>{isComplete(activity) ? "✓" : index + 1}</span>
                  <small>{activity.type === "leetcode" ? `LC ${index + 1}` : activity.type === "system_design" ? "SD" : "BQ"}</small>
                </div>
              ))}
            </div>
            <div className="arc-stats">
              <div><strong>{progress}%</strong><span>logged</span></div>
              <div><strong>{formatDuration(totalElapsed)}</strong><span>local time</span></div>
              <div><strong>{publishedToday}</strong><span>published files</span></div>
            </div>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div><span className="kicker">REQUIRED CIRCUIT</span><h2>Eight pieces of honest practice</h2></div>
            <span className="section-note">{formatDuration(journal.timerGroups.reduce((sum, group) => sum + group.allocatedSeconds, 0))} planned</span>
          </div>

          <article className="practice-card coding-card">
            <div className="practice-card-head">
              <div className="category-lockup"><span className="category-glyph coding">⌘</span><div><span className="kicker">01 / CODING</span><h3>Six-problem sprint</h3><p>One shared clock. Each problem gets its own honest result.</p></div></div>
              <TimerControl timerId={codingGroup.id} allocatedSeconds={codingGroup.allocatedSeconds} timer={draft.timers[codingGroup.id]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
            </div>
            <div className="problem-table">
              {codingActivities.map((activity, index) => (
                <div className="problem-row" key={activity.id}>
                  <span className={`problem-index ${isComplete(activity) ? "done" : ""}`}>{isComplete(activity) ? "✓" : String(index + 1).padStart(2, "0")}</span>
                  <div className="problem-copy"><strong>{activity.title}</strong><small>{activity.notes} · {formatDuration(activity.allocatedSeconds)} target</small></div>
                  <select aria-label={`Result for ${activity.title}`} value={draft.outcomes[activity.id] ?? activity.outcome ?? ""} onChange={(event) => setOutcome(activity.id, event.target.value as Outcome | "")}>
                    <option value="">Result not logged</option>
                    {OUTCOMES.map((outcome) => <option key={outcome.value} value={outcome.value}>{outcome.label}</option>)}
                  </select>
                  <a href={activity.url} target="_blank" rel="noreferrer">Open ↗</a>
                </div>
              ))}
            </div>
            <p className="card-footnote">Solve and submit on LeetCode. The result menu records your attempt; it never claims code was run here.</p>
          </article>

          <div className="coach-grid">
            {systemActivity && (
              <article className="practice-card coach-card system-card">
                <div className="category-lockup"><span className="category-glyph system">△</span><div><span className="kicker">02 / SYSTEM DESIGN</span><h3>{systemActivity.title}</h3></div></div>
                <p className="session-prompt">{systemActivity.prompt}</p>
                <div className="session-route"><span>Scope</span><i /><span>Architecture</span><i /><span>Tradeoffs</span><i /><span>Review</span></div>
                <TimerControl timerId={systemActivity.timerGroupId!} allocatedSeconds={groupById[systemActivity.timerGroupId!].allocatedSeconds} timer={draft.timers[systemActivity.timerGroupId!]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                <small className="publish-hint">Run the mock in your system-design task, then say “Publish this session.”</small>
              </article>
            )}
            {behavioralActivity && (
              <article className="practice-card coach-card behavior-card">
                <div className="category-lockup"><span className="category-glyph behavior">◎</span><div><span className="kicker">03 / BEHAVIORAL</span><h3>{behavioralActivity.title}</h3></div></div>
                <p className="session-prompt">{behavioralActivity.prompt}</p>
                <div className="story-cue"><span>Speak aloud</span><strong>Situation → Action → Result → Learning</strong></div>
                <TimerControl timerId={behavioralActivity.timerGroupId!} allocatedSeconds={groupById[behavioralActivity.timerGroupId!].allocatedSeconds} timer={draft.timers[behavioralActivity.timerGroupId!]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                <small className="publish-hint">Run the mock in your behavioral task, then say “Publish this session.”</small>
              </article>
            )}
          </div>
        </section>

        <section className="section-block extras-block">
          <div className="section-heading">
            <div><span className="kicker">EXTRA MILES</span><h2>Anything beyond today&apos;s plan</h2></div>
            <button className="add-button" onClick={() => setExtraOpen(true)}>＋ Add an activity</button>
          </div>
          {draft.extraActivities.length === 0 ? (
            <div className="empty-strip"><span>＋</span><p>No extras yet. Add a coding problem, design prompt, or behavioral question with its own timer.</p></div>
          ) : (
            <div className="extra-list">
              {draft.extraActivities.map((activity) => (
                <article className="extra-row" key={activity.id}>
                  <span className={`category-glyph ${activity.type}`}>{activityGlyph(activity.type)}</span>
                  <div><small>{activityLabel(activity.type)} · Local draft</small><strong>{activity.title}</strong>{activity.url && <a href={activity.url} target="_blank" rel="noreferrer">Open reference ↗</a>}</div>
                  <TimerControl timerId={activity.timerGroupId} allocatedSeconds={activity.allocatedSeconds} timer={draft.timers[activity.timerGroupId]} now={now} onToggle={toggleTimer} onComplete={completeTimer} />
                </article>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  function renderJourney() {
    return (
      <section className="view-page">
        <div className="view-intro"><span className="kicker">JOURNEY</span><h1>The archive grows<br /><em>one honest day at a time.</em></h1><p>Only records published to files count here. Local timer drafts stay on Today until a specialist task publishes them.</p></div>
        <div className="journey-layout">
          <article className="calendar-card">
            <div className="card-heading"><div><span className="kicker">LAST 35 DAYS</span><h2>Practice field</h2></div><span>{contentIndex.journals.length} journal day{contentIndex.journals.length === 1 ? "" : "s"}</span></div>
            <div className="calendar-weekdays"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
            <div className="calendar-grid">
              {calendarDays.map((day) => {
                const completed = day.journal?.activities.filter((activity) => activity.status === "completed").length ?? 0;
                return <div key={day.key} className={`calendar-day ${day.journal ? "has-journal" : ""} ${completed ? "has-work" : ""}`} title={`${day.key}: ${completed} completed`}><span>{day.day}</span>{day.journal && <i />}</div>;
              })}
            </div>
          </article>
          <aside className="journey-summary">
            <span className="kicker">PUBLISHED TOTALS</span>
            <div><strong>{publishedCompleted.length}</strong><span>completed activities</span></div>
            <div><strong>{formatDuration(publishedSeconds)}</strong><span>recorded practice</span></div>
            <div><strong>{contentIndex.artifacts.length}</strong><span>review artifacts</span></div>
          </aside>
        </div>
        <div className="section-heading"><div><span className="kicker">DAILY LOG</span><h2>Versioned journal entries</h2></div></div>
        <div className="journal-list">
          {contentIndex.journals.map((item) => {
            const complete = item.activities.filter((activity) => activity.status === "completed").length;
            return <article key={item.date}><time>{readableDate(item.date)}</time><div><strong>{item.focus}</strong><small>{item.activities.length} planned · {complete} published complete</small></div><span>{complete}/{item.activities.length}</span></article>;
          })}
        </div>
        {publishedCompleted.length === 0 && <div className="truth-note">The archive has a plan, but no completed session has been published yet. That is accurate—not an empty-state failure.</div>}
      </section>
    );
  }

  function renderLibrary() {
    return (
      <section className="view-page">
        <div className="view-intro"><span className="kicker">PRACTICE LIBRARY</span><h1>Review the lesson,<br /><em>then reveal the raw log.</em></h1><p>Summaries and feedback stay scannable. Full transcripts and generated code remain available inside each record.</p></div>
        <div className="filter-row" role="group" aria-label="Filter practice artifacts">
          {(["all", "leetcode", "system_design", "behavioral"] as const).map((filter) => <button key={filter} className={libraryFilter === filter ? "active" : ""} onClick={() => setLibraryFilter(filter)}>{filter === "all" ? "All records" : activityLabel(filter)}</button>)}
        </div>
        {filteredArtifacts.length ? (
          <div className="library-grid">
            {filteredArtifacts.map((artifact) => {
              const preview = artifact.sections.find((section) => /summary|short answer|what went well/i.test(section.title))?.body ?? artifact.sections[0]?.body ?? "Open the record to review its details.";
              return <button className="artifact-card" key={artifact.path} onClick={() => setSelectedArtifact(artifact)}><span className={`artifact-type ${artifact.type}`}>{activityLabel(artifact.type as JournalActivity["type"] | "audio_review")}</span><time>{artifact.date}</time><h2>{artifact.title}</h2><p>{plainText(preview).slice(0, 180)}</p><span className="artifact-open">Open record →</span></button>;
            })}
          </div>
        ) : (
          <div className="empty-library"><span>□</span><h2>No published {libraryFilter === "all" ? "practice" : activityLabel(libraryFilter).toLowerCase()} records yet</h2><p>Say “Publish this session” in the matching specialist task. The next build will place the artifact here automatically.</p></div>
        )}
      </section>
    );
  }

  function renderStories() {
    return (
      <section className="view-page">
        <div className="view-intro"><span className="kicker">STORY BANK</span><h1>Your experience,<br /><em>without invented polish.</em></h1><p>Project evidence stays separate from interview wording, so one truthful experience can support several behavioral questions.</p></div>
        {contentIndex.stories.length ? (
          <div className="story-grid">{contentIndex.stories.map((story) => <button key={story.path} className="story-card" onClick={() => setSelectedArtifact(story)}><span>{story.projectId}</span><h2>{story.title}</h2><p>{story.sections.length} evidence sections</p><strong>Review project →</strong></button>)}</div>
        ) : (
          <div className="story-empty"><div className="story-map" aria-hidden="true"><span>PROJECT</span><i /><span>DECISION</span><i /><span>STORY</span></div><div><span className="kicker">READY FOR DISCOVERY</span><h2>Start with a project, not a canned answer.</h2><p>In the behavioral task, describe one project and let the coach explore your responsibilities, decisions, conflict, failure, leadership, results, and lessons. Publishing creates the first source file here.</p></div></div>
        )}
      </section>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")}><span className="brand-mark">IA</span><span>Interview Arc</span></button>
        <nav className="primary-nav" aria-label="Primary navigation">
          {([
            ["today", "⌂", "Today"],
            ["journey", "⌁", "Journey"],
            ["library", "◇", "Practice library"],
            ["stories", "◎", "Story bank"],
          ] as [View, string, string][]).map(([id, icon, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
        <div className="sidebar-note"><span className="pulse-dot" /><div><strong>{hydrated ? "Local draft ready" : "Loading today"}</strong><small>Files are durable after publish</small></div></div>
        <div className="profile"><span>WX</span><div><strong>Wenk Xu</strong><small>Interview journey · 2026</small></div></div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div><span className="date-label">{readableDate(journal.date).toUpperCase()}</span><strong>{view === "today" ? "Today’s practice log" : view === "journey" ? "Published journey" : view === "library" ? "Practice library" : "Behavioral story bank"}</strong></div>
          <div><button className="quiet-button" onClick={exportDraft}>Export draft</button><button className="ink-button" onClick={() => setExtraOpen(true)}>＋ Add practice</button></div>
        </header>
        <div className="page-content">
          {view === "today" && renderToday()}
          {view === "journey" && renderJourney()}
          {view === "library" && renderLibrary()}
          {view === "stories" && renderStories()}
        </div>
      </section>

      {extraOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setExtraOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="extra-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setExtraOpen(false)} aria-label="Close">×</button>
            <span className="kicker">EXTRA PRACTICE</span><h2 id="extra-title">Add one more rep.</h2><p>This starts as a device-local draft with an independent timer. Publish it through the matching specialist task when you want it in the permanent journey.</p>
            <form onSubmit={addExtra}>
              <label>Practice type<select value={extraForm.type} onChange={(event) => setExtraForm((current) => ({ ...current, type: event.target.value as JournalActivity["type"] }))}><option value="leetcode">LeetCode</option><option value="system_design">System design</option><option value="behavioral">Behavioral</option></select></label>
              <label>Question or title<input autoFocus required value={extraForm.title} onChange={(event) => setExtraForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Reimplement LRU Cache" /></label>
              <div className="form-split"><label>Timer (minutes)<input type="number" min="1" max="360" required value={extraForm.minutes} onChange={(event) => setExtraForm((current) => ({ ...current, minutes: event.target.value }))} /></label><label>Reference URL <small>optional</small><input type="url" value={extraForm.url} onChange={(event) => setExtraForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" /></label></div>
              <button className="ink-button" type="submit">Add to today</button>
            </form>
          </section>
        </div>
      )}

      {selectedArtifact && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setSelectedArtifact(null)}>
          <aside className="artifact-drawer" role="dialog" aria-modal="true" aria-labelledby="artifact-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedArtifact(null)} aria-label="Close">×</button>
            <span className={`artifact-type ${selectedArtifact.type}`}>{activityLabel(selectedArtifact.type as JournalActivity["type"] | "audio_review")}</span><time>{selectedArtifact.date}</time><h2 id="artifact-title">{selectedArtifact.title}</h2>
            {selectedArtifact.audioFile && <div className="audio-note"><strong>{selectedArtifact.audioFile}</strong><span>{selectedArtifact.audioAvailability || "local-only"}</span></div>}
            <div className="artifact-sections">
              {selectedArtifact.sections.map((section) => /conversation transcript|generated code/i.test(section.title) ? <details key={section.title}><summary>{section.title}</summary><pre>{section.body}</pre></details> : <section key={section.title}><h3>{section.title}</h3><pre>{section.body}</pre></section>)}
            </div>
            <small className="source-path">Source · {selectedArtifact.path}</small>
          </aside>
        </div>
      )}
    </main>
  );
}

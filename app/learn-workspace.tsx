"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  courseModulePath,
  learningHistory,
  selectActiveLearningSession,
  selectCurrentLesson,
  selectLearningCourse,
  selectQuickStudy,
  type LearnDestination,
  type LearnPayload,
  type LearningCourseProjection,
  type LearningLessonSnapshot,
  type LearningQuickStudyProjection,
  type LearningSessionProjection,
} from "./learn-workspace-model";

import "./learn-workspace.css";

type CourseSection = "overview" | "lessons" | "homework" | "analytics";
type MobileCoursePane = "path" | "lesson";

const LEARN_DESTINATION_COPY: Record<LearnDestination, { eyebrow: string; title: string; emphasis: string; description: string }> = {
  today: {
    eyebrow: "LEARN · TODAY",
    title: "Pick up the thread,",
    emphasis: "not the whole textbook.",
    description: "Open the exact Current lesson, keep the Module path in view, and continue one evidence-backed Learning Session.",
  },
  courses: {
    eyebrow: "LEARN · COURSES",
    title: "A syllabus that grows",
    emphasis: "one lesson at a time.",
    description: "Blueprints preserve the path. Current lesson revisions preserve the material you actually learned from.",
  },
  history: {
    eyebrow: "LEARN · HISTORY",
    title: "The conversation stays",
    emphasis: "exact and private.",
    description: "Completed Sessions keep their timer, transcript, artifacts, and factual recap without turning raw conversation into a textbook.",
  },
  analytics: {
    eyebrow: "LEARN · STATISTICS",
    title: "Count the work,",
    emphasis: "never invent mastery.",
    description: "Duration, Sessions, Lessons, homework, and checkpoint coverage come directly from recorded Learning events.",
  },
};

function formatDuration(seconds: number) {
  const roundedMinutes = Math.round(seconds / 60);
  if (roundedMinutes < 60) return `${roundedMinutes} min`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function formatTimer(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatDate(value: number | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function factualCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sessionSeconds(session: LearningSessionProjection, now: number) {
  const running = session.session.runningSince ? Math.max(0, Math.floor((now - session.session.runningSince) / 1000)) : 0;
  return session.session.accumulatedSeconds + running;
}

function operationId(prefix: string, identity: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${identity}-${suffix}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function LearnHero({ destination, payload }: { destination: LearnDestination; payload: LearnPayload | null }) {
  const copy = LEARN_DESTINATION_COPY[destination];
  const facts = payload?.workspace.facts ?? {};
  const metrics = destination === "analytics"
    ? [
      ["Recorded", formatDuration(factualCount(payload?.analytics.overall.recordedSeconds))],
      ["Learning days", factualCount(payload?.analytics.overall.activeLearningDays)],
      ["Sessions", factualCount(payload?.analytics.overall.completedSessionCount)],
    ]
    : [
      ["Active courses", factualCount(facts.activeCourseCount)],
      ["Lessons complete", factualCount(facts.completedLessonCount)],
      ["Checkpoint evidence", factualCount(facts.demonstratedCheckpointCount)],
    ];
  return <header className={`learn-hero learn-hero-${destination}`}>
    <div className="learn-hero-copy">
      <span className="learn-eyebrow">{copy.eyebrow}</span>
      <h1>{copy.title}<br /><em>{copy.emphasis}</em></h1>
      <p>{copy.description}</p>
    </div>
    <div className="learn-orbit" aria-hidden="true"><span /><span /><span /><i>LEARN</i></div>
    <dl className="learn-hero-metrics">{metrics.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </header>;
}

function EmptyLearn({ destination }: { destination: LearnDestination }) {
  return <section className="learn-empty" aria-labelledby="learn-empty-title">
    <span className="learn-eyebrow">LEARNING SPECIALIST REQUIRED</span>
    <h2 id="learn-empty-title">{destination === "history" ? "No completed Learning Sessions yet." : "Your first Course starts in the specialist."}</h2>
    <p>The website is the durable Course and reading surface. Ask the Learning Specialist to propose a Blueprint or create a Quick Study; it will appear here after the exact owner-private revision is saved.</p>
    <code>Initialize Interview Arc — Learning Specialist</code>
  </section>;
}

function SessionInstrument({
  session,
  now,
  busy,
  onControl,
}: {
  session: LearningSessionProjection;
  now: number;
  busy: boolean;
  onControl: (action: "start" | "pause" | "resume") => void;
}) {
  const state = session.session.state;
  const action = state === "planned" ? "start" : state === "running" ? "pause" : "resume";
  return <section className="learn-session-instrument" aria-label="Current Learning Session">
    <div><span className={`learn-live-dot ${state}`} aria-hidden="true" /><small>{state === "running" ? "SESSION LIVE" : `SESSION ${state.toUpperCase()}`}</small><strong>{formatTimer(sessionSeconds(session, now))}</strong></div>
    <p>Transcript-only Voice · Lesson revision {session.session.lessonRevision} · {session.session.transcriptRevision} transcript revision{session.session.transcriptRevision === 1 ? "" : "s"}</p>
    <div className="learn-session-actions">
      <button type="button" onClick={() => onControl(action)} disabled={busy}>{busy ? "Saving…" : action === "start" ? "Start session" : action === "pause" ? "Pause" : "Resume"}</button>
      <button type="button" className="quiet" onClick={() => window.dispatchEvent(new CustomEvent("interview-arc-learn-finish-help"))}>Finish with specialist</button>
    </div>
  </section>;
}

function ModulePath({ payload, course }: { payload: LearnPayload; course: LearningCourseProjection }) {
  const modules = courseModulePath(payload, course);
  return <section className="learn-module-path" aria-labelledby="learn-module-path-title">
    <header><div><span className="learn-eyebrow">MODULE PATH</span><h2 id="learn-module-path-title">{course.course.title}</h2></div><small>Blueprint r{course.enrollment?.blueprintRevision ?? course.blueprint?.revision ?? course.course.currentBlueprintRevision}</small></header>
    {modules.map((module, moduleIndex) => <article className="learn-module" key={module.moduleId}>
      <div className="learn-module-heading"><span>{String(moduleIndex + 1).padStart(2, "0")}</span><div><strong>{module.title}</strong><small>{module.completedLessons} / {module.lessons.length} lessons</small></div></div>
      <ol>{module.lessons.map((lesson) => <li className={lesson.state} key={lesson.lessonId} aria-current={lesson.state === "current" ? "step" : undefined}>
        <span aria-hidden="true">{lesson.state === "completed" ? "✓" : lesson.state === "current" ? "●" : "○"}</span>
        <div><strong>{lesson.title}</strong><small>{lesson.kind === "lab" ? "Lab" : "Lesson"}{lesson.requiredCheckpoints ? ` · ${lesson.demonstratedCheckpoints}/${lesson.requiredCheckpoints} checkpoints` : ""}</small></div>
      </li>)}</ol>
    </article>)}
  </section>;
}

function CheckpointList({ payload, lesson }: { payload: LearnPayload; lesson: LearningLessonSnapshot }) {
  const states = new Map(payload.evidence.checkpointStates.filter((item) => item.lessonId === lesson.lessonId).map((item) => [item.checkpointId, item.status]));
  return <section className="learn-lesson-block"><span className="learn-eyebrow">CHECKPOINTS</span><div className="learn-checkpoints">{lesson.checkpoints.map((checkpoint) => {
    const status = states.get(checkpoint.checkpointId) ?? "not_attempted";
    return <article key={checkpoint.checkpointId} className={status}><span aria-hidden="true" /> <div><strong>{checkpoint.label}</strong><p>{checkpoint.description}</p></div><small>{statusLabel(status)}</small></article>;
  })}</div></section>;
}

function CurrentLesson({ payload, lesson }: { payload: LearnPayload; lesson: LearningLessonSnapshot | null }) {
  if (!lesson) return <section className="learn-current-lesson learn-current-lesson-empty"><span className="learn-eyebrow">CURRENT LESSON</span><h2>This Lesson has not been generated yet.</h2><p>The Learning Specialist creates the exact reusable Lesson revision immediately before the Session starts.</p></section>;
  return <article className="learn-current-lesson" aria-labelledby="learn-current-lesson-title">
    <header><div><span className="learn-eyebrow">CURRENT LESSON · REVISION {lesson.revision}</span><h2 id="learn-current-lesson-title">{lesson.title}</h2><p>{lesson.objective}</p></div><span className={`learn-state ${lesson.state}`}>{lesson.state}</span></header>
    {lesson.prerequisites.length > 0 && <section className="learn-prerequisites"><strong>Before this lesson</strong><p>{lesson.prerequisites.join(" · ")}</p></section>}
    {lesson.sections.map((section) => <section className="learn-lesson-block" key={section.sectionId}><h3>{section.heading}</h3><p className="learn-prose">{section.body}</p></section>)}
    {lesson.examples.map((example) => <section className="learn-example" key={example.exampleId}><span className="learn-eyebrow">EXAMPLE · {example.title}</span>{example.language ? <pre><code>{example.body}</code></pre> : <p>{example.body}</p>}</section>)}
    {lesson.exercises.length > 0 && <section className="learn-lesson-block"><span className="learn-eyebrow">EXERCISES</span><ol className="learn-exercises">{lesson.exercises.map((exercise) => <li key={exercise.exerciseId}>{exercise.prompt}</li>)}</ol></section>}
    <CheckpointList payload={payload} lesson={lesson} />
    {lesson.sourcePins.length > 0 && <section className="learn-sources"><span className="learn-eyebrow">EXACT SOURCES</span>{lesson.sourcePins.map((source, index) => <div key={`${source.title}-${index}`}><strong>{source.title}</strong><small>{source.repository && source.commit ? `${source.repository} · ${source.commit.slice(0, 12)}` : source.kind.replaceAll("_", " ")}{source.path ? ` · ${source.path}` : ""}</small>{source.url && <a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a>}</div>)}</section>}
  </article>;
}

function QuickStudyWorkspace({
  payload,
  study,
  now,
  busy,
  onControl,
  onHomework,
}: {
  payload: LearnPayload;
  study: LearningQuickStudyProjection;
  now: number;
  busy: boolean;
  onControl: (session: LearningSessionProjection, action: "start" | "pause" | "resume") => void;
  onHomework: (homework: LearnPayload["evidence"]["homework"][number]) => void;
}) {
  const activeSession = selectActiveLearningSession(payload, study.lesson.lessonId);
  const homework = payload.evidence.homework.filter((item) => item.lessonId === study.lesson.lessonId);
  return <div className="learn-course-workspace learn-quick-study-workspace">
    <header className="learn-quick-study-header"><div><span className="learn-eyebrow">QUICK STUDY</span><h2>{study.lesson.title}</h2><p>A standalone Current lesson with no Course or Enrollment overhead.</p></div><span className={`learn-state ${study.lesson.state}`}>{study.lesson.state}</span></header>
    {activeSession && <SessionInstrument session={activeSession} now={now} busy={busy} onControl={(action) => onControl(activeSession, action)} />}
    <CurrentLesson payload={payload} lesson={study.current} />
    {homework.length > 0 && <section className="learn-homework-panel"><header><span className="learn-eyebrow">HOMEWORK</span><h2>Follow-up, recorded plainly.</h2><p>Completion is a fact. It does not automatically demonstrate a checkpoint.</p></header>{homework.map((item) => <article key={item.homeworkId}><div><strong>{item.prompt}</strong><small>Revision {item.revision} · {item.state}</small></div><button type="button" onClick={() => onHomework(item)} disabled={busy}>{item.state === "completed" ? "Mark open" : "Mark completed"}</button></article>)}</section>}
  </div>;
}

function CourseWorkspace({
  payload,
  course,
  section,
  onSection,
  mobilePane,
  onMobilePane,
  now,
  busy,
  onControl,
  onHomework,
}: {
  payload: LearnPayload;
  course: LearningCourseProjection;
  section: CourseSection;
  onSection: (section: CourseSection) => void;
  mobilePane: MobileCoursePane;
  onMobilePane: (pane: MobileCoursePane) => void;
  now: number;
  busy: boolean;
  onControl: (session: LearningSessionProjection, action: "start" | "pause" | "resume") => void;
  onHomework: (homework: LearnPayload["evidence"]["homework"][number]) => void;
}) {
  const current = selectCurrentLesson(course);
  const currentLesson = current?.current ?? null;
  const activeSession = selectActiveLearningSession(payload, current?.lessonId);
  const homework = payload.evidence.homework.filter((item) => course.lessons.some((lesson) => lesson.lessonId === item.lessonId));
  const analytics = payload.analytics.courses.find((item) => item.courseId === course.course.courseId);
  return <div className="learn-course-workspace">
    <nav className="learn-course-nav" aria-label={`${course.course.title} navigation`}>{(["overview", "lessons", "homework", "analytics"] as CourseSection[]).map((item) => <button type="button" key={item} className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined} onClick={() => onSection(item)}>{item === "analytics" ? "statistics" : item}</button>)}</nav>
    {activeSession && <SessionInstrument session={activeSession} now={now} busy={busy} onControl={(action) => onControl(activeSession, action)} />}
    {(section === "overview" || section === "lessons") && <>
      <div className="learn-mobile-pane-switcher" aria-label="Course reading surface"><button type="button" className={mobilePane === "path" ? "active" : ""} aria-pressed={mobilePane === "path"} onClick={() => onMobilePane("path")}>Module path</button><button type="button" className={mobilePane === "lesson" ? "active" : ""} aria-pressed={mobilePane === "lesson"} onClick={() => onMobilePane("lesson")}>Current lesson</button></div>
      <div className={`learn-course-spread mobile-${mobilePane}`}><ModulePath payload={payload} course={course} /><CurrentLesson payload={payload} lesson={currentLesson} /></div>
    </>}
    {section === "homework" && <section className="learn-homework-panel"><header><span className="learn-eyebrow">HOMEWORK</span><h2>Assigned work, recorded plainly.</h2><p>Completion is a fact. It does not automatically demonstrate a checkpoint.</p></header>{homework.length ? homework.map((item) => <article key={item.homeworkId}><div><strong>{item.prompt}</strong><small>Revision {item.revision} · {item.state}</small></div><button type="button" onClick={() => onHomework(item)} disabled={busy}>{item.state === "completed" ? "Mark open" : "Mark completed"}</button></article>) : <p className="learn-inline-empty">No homework is attached to this Course yet.</p>}</section>}
    {section === "analytics" && <CourseAnalytics course={course} analytics={analytics} />}
  </div>;
}

function CourseAnalytics({ course, analytics }: { course: LearningCourseProjection; analytics?: LearnPayload["analytics"]["courses"][number] }) {
  const cells = [
    ["Recorded", formatDuration(factualCount(analytics?.recordedSeconds))],
    ["Sessions", factualCount(analytics?.completedSessionCount)],
    ["Lessons", `${factualCount(analytics?.completedLessonCount)} / ${factualCount(analytics?.lessonCount)}`],
    ["Checkpoints", `${factualCount(analytics?.demonstratedCheckpointCount)} / ${factualCount(analytics?.requiredCheckpointCount)}`],
    ["Homework open", factualCount(analytics?.openHomeworkCount)],
    ["Last activity", analytics?.lastActivityAt ? formatDate(analytics.lastActivityAt as number) : "None"],
  ];
  return <section className="learn-course-analytics"><header><span className="learn-eyebrow">COURSE STATISTICS</span><h2>{course.course.title}</h2><p>Only observed Learning records are counted.</p></header><dl>{cells.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function HistoryView({ payload }: { payload: LearnPayload }) {
  const history = learningHistory(payload);
  const [selectedId, setSelectedId] = useState(history[0]?.session.sessionId ?? "");
  const selected = history.find((item) => item.session.sessionId === selectedId) ?? history[0] ?? null;
  if (!history.length) return <EmptyLearn destination="history" />;
  return <section className="learn-history"><div className="learn-history-index"><header><span className="learn-eyebrow">COMPLETED SESSIONS</span><h2>{history.length} exact record{history.length === 1 ? "" : "s"}</h2></header>{history.map((item) => <button type="button" key={item.session.sessionId} className={selected?.session.sessionId === item.session.sessionId ? "active" : ""} onClick={() => setSelectedId(item.session.sessionId)}><span>{formatDate(item.session.completedAt)}</span><strong>{item.session.lessonId}</strong><small>{formatDuration(item.session.accumulatedSeconds)} · {item.turns.length} turns</small></button>)}</div>{selected && <article className="learn-history-record"><header><span className="learn-eyebrow">TRANSCRIPT-ONLY SESSION</span><h2>{selected.session.lessonId}</h2><p>{formatDate(selected.session.completedAt)} · {formatDuration(selected.session.accumulatedSeconds)} · Lesson revision {selected.session.lessonRevision}</p></header>{selected.turns.length ? <ol className="learn-transcript">{selected.turns.map((turn) => <li className={turn.speaker} key={turn.turnId}><small>{turn.speaker} · {turn.source.replaceAll("_", " ")}</small><p>{turn.body}</p></li>)}</ol> : <p className="learn-inline-empty">No transcript turns were recorded for this Session.</p>}</article>}</section>;
}

function AnalyticsView({ payload }: { payload: LearnPayload }) {
  const overall = payload.analytics.overall;
  const byCourse = payload.analytics.time.byCourse ?? [];
  const maxSeconds = Math.max(1, ...byCourse.map((item) => item.recordedSeconds));
  const coverage = overall.checkpointCoverage;
  const facts = [
    ["Recorded learning", formatDuration(factualCount(overall.recordedSeconds))],
    ["Active days", factualCount(overall.activeLearningDays)],
    ["Completed Sessions", factualCount(overall.completedSessionCount)],
    ["Lessons completed", factualCount(overall.completedLessonCount)],
    ["Quick Studies", factualCount(overall.quickStudySessionCount)],
    ["Checkpoint coverage", typeof coverage === "number" ? `${Math.round(coverage * 100)}%` : "No required checkpoints"],
  ];
  return <div className="learn-analytics"><dl className="learn-fact-grid">{facts.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><section className="learn-time-chart"><header><span className="learn-eyebrow">TIME BY COURSE</span><h2>Recorded Session time</h2></header>{byCourse.length ? byCourse.map((item) => <div key={item.key}><span>{item.title}</span><i><b style={{ width: `${Math.max(3, (item.recordedSeconds / maxSeconds) * 100)}%` }} /></i><strong>{formatDuration(item.recordedSeconds)}</strong></div>) : <p className="learn-inline-empty">Finish a Learning Session to begin this factual timeline.</p>}</section><section className="learn-recent-topics"><header><span className="learn-eyebrow">RECENT TOPICS</span><h2>What the record actually contains</h2></header>{payload.analytics.recentTopics.length ? payload.analytics.recentTopics.map((topic) => <article key={topic.lessonId}><strong>{topic.title}</strong><small>{formatDate(topic.lastActivityAt)}</small></article>) : <p className="learn-inline-empty">No completed topics yet.</p>}</section></div>;
}

export default function LearnWorkspace({ destination }: { destination: LearnDestination }) {
  const [payload, setPayload] = useState<LearnPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedQuickStudyId, setSelectedQuickStudyId] = useState("");
  const [courseSection, setCourseSection] = useState<CourseSection>("overview");
  const [mobilePane, setMobilePane] = useState<MobileCoursePane>("lesson");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const operationIds = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/learn", { cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json() as LearnPayload | { error?: string };
      if (!response.ok || !("workspace" in body)) throw new Error("error" in body && body.error ? body.error : "Learn could not be loaded.");
      setPayload(body);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Learn could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const finishHelp = () => setNotice("Finish in the Learning Specialist so the exact recap, unresolved questions, next action, and checkpoint evidence are saved together. The website will refresh the completed Session afterward.");
    window.addEventListener("interview-arc-learn-finish-help", finishHelp);
    return () => window.removeEventListener("interview-arc-learn-finish-help", finishHelp);
  }, []);

  const selectedCourse = useMemo(() => (
    payload && !selectedQuickStudyId ? selectLearningCourse(payload, selectedCourseId || undefined) : null
  ), [payload, selectedCourseId, selectedQuickStudyId]);
  const selectedQuickStudy = useMemo(() => (
    payload
      ? selectedQuickStudyId
        ? selectQuickStudy(payload, selectedQuickStudyId)
        : selectedCourse
          ? null
          : selectQuickStudy(payload)
      : null
  ), [payload, selectedCourse, selectedQuickStudyId]);

  async function mutate(key: string, body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    const stableOperationId = operationIds.current.get(key) ?? operationId(key, String(body.sessionId ?? body.homeworkId ?? "learn"));
    operationIds.current.set(key, stableOperationId);
    try {
      const response = await fetch("/api/learn", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...body, operationId: stableOperationId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) operationIds.current.delete(key);
        throw new Error(result.error ?? "The Learn change could not be saved.");
      }
      operationIds.current.delete(key);
      await refresh();
    } catch (mutationError) {
      setNotice(mutationError instanceof Error ? mutationError.message : "The Learn change could not be saved.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function controlSessionExact(session: LearningSessionProjection, action: "start" | "pause" | "resume") {
    const key = `session-${session.session.sessionId}-${action}`;
    setBusy(true);
    const stableOperationId = operationIds.current.get(key) ?? operationId("learning-session", session.session.sessionId);
    operationIds.current.set(key, stableOperationId);
    try {
      const response = await fetch("/api/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "control_session", operationId: stableOperationId, sessionId: session.session.sessionId, expectedRevision: session.session.revision, sessionAction: action }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) operationIds.current.delete(key);
        throw new Error(result.error ?? "The Session control could not be saved.");
      }
      operationIds.current.delete(key);
      await refresh();
    } catch (controlError) {
      setNotice(controlError instanceof Error ? controlError.message : "The Session control could not be saved.");
      await refresh();
    } finally { setBusy(false); }
  }

  async function setHomework(homework: LearnPayload["evidence"]["homework"][number]) {
    await mutate(`homework-${homework.homeworkId}`, { action: "set_homework_state", lessonId: homework.lessonId, homeworkId: homework.homeworkId, expectedRevision: homework.revision, state: homework.state === "completed" ? "open" : "completed" });
  }

  if (loading) return <div className="learn-workspace"><LearnHero destination={destination} payload={null} /><section className="learn-loading" aria-live="polite"><span /><p>Opening the private Learn workspace…</p></section></div>;
  if (error || !payload) return <div className="learn-workspace"><LearnHero destination={destination} payload={null} /><section className="learn-error" role="alert"><span className="learn-eyebrow">LEARN UNAVAILABLE</span><h2>The private Learning record could not be read.</h2><p>{error}</p><button type="button" onClick={() => { setLoading(true); void refresh(); }}>Try again</button></section></div>;

  const courses = payload.workspace.courses;
  const quickStudies = payload.workspace.quickStudies;
  const activeSession = selectActiveLearningSession(payload);
  const todayQuickStudy = activeSession?.session.scopeType === "quick_study"
    ? selectQuickStudy(payload, activeSession.session.lessonId)
    : selectedQuickStudy;
  return <div className="learn-workspace">
    <LearnHero destination={destination} payload={payload} />
    {notice && <div className="learn-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss Learn message">×</button></div>}
    {destination === "today" && (todayQuickStudy ? <QuickStudyWorkspace payload={payload} study={todayQuickStudy} now={now} busy={busy} onControl={(session, action) => void controlSessionExact(session, action)} onHomework={(item) => void setHomework(item)} /> : selectedCourse ? <CourseWorkspace payload={payload} course={selectedCourse} section="overview" onSection={setCourseSection} mobilePane={mobilePane} onMobilePane={setMobilePane} now={now} busy={busy} onControl={(session, action) => void controlSessionExact(session, action)} onHomework={(item) => void setHomework(item)} /> : <EmptyLearn destination="today" />)}
    {destination === "courses" && (courses.length || quickStudies.length ? <div className="learn-courses-layout"><nav className="learn-course-index" aria-label="Courses and Quick Studies"><header><span className="learn-eyebrow">COURSES</span><h2>{courses.length} Blueprint{courses.length === 1 ? "" : "s"}</h2></header>{courses.map((course) => <button type="button" key={course.course.courseId} className={selectedCourse?.course.courseId === course.course.courseId ? "active" : ""} onClick={() => { setSelectedQuickStudyId(""); setSelectedCourseId(course.course.courseId); setCourseSection("overview"); }}><span>{course.course.state}</span><strong>{course.course.title}</strong><small>{course.lessons.filter((lesson) => lesson.state === "completed").length} / {course.blueprint?.modules.flatMap((module) => module.lessons).length ?? course.lessons.length} lessons</small></button>)}{quickStudies.length > 0 && <div className="learn-course-index-divider"><span className="learn-eyebrow">QUICK STUDIES</span><small>{quickStudies.length} standalone</small></div>}{quickStudies.map((study) => <button type="button" key={study.lesson.lessonId} className={selectedQuickStudy?.lesson.lessonId === study.lesson.lessonId ? "active" : ""} onClick={() => setSelectedQuickStudyId(study.lesson.lessonId)}><span>{study.lesson.state}</span><strong>{study.lesson.title}</strong><small>Current lesson r{study.current?.revision ?? study.lesson.currentRevision}</small></button>)}</nav>{selectedQuickStudy ? <QuickStudyWorkspace payload={payload} study={selectedQuickStudy} now={now} busy={busy} onControl={(session, action) => void controlSessionExact(session, action)} onHomework={(item) => void setHomework(item)} /> : selectedCourse && <CourseWorkspace payload={payload} course={selectedCourse} section={courseSection} onSection={setCourseSection} mobilePane={mobilePane} onMobilePane={setMobilePane} now={now} busy={busy} onControl={(session, action) => void controlSessionExact(session, action)} onHomework={(item) => void setHomework(item)} />}</div> : <EmptyLearn destination="courses" />)}
    {destination === "history" && <HistoryView payload={payload} />}
    {destination === "analytics" && <AnalyticsView payload={payload} />}
  </div>;
}

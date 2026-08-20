"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  adjacentCourseLessons,
  courseModulePath,
  courseProgress,
  defaultCourseLessonId,
  flattenCourseLessons,
  learningHistory,
  lessonContentItems,
  locateCourseLesson,
  nextCourseAction,
  parseCourseSection,
  selectActiveLearningSession,
  selectCurrentLesson,
  selectLearningCourse,
  selectQuickStudy,
  type CoursePathLesson,
  type CoursePathLessonState,
  type CourseSection,
  type LearnDestination,
  type LearnPayload,
  type LearningCourseProjection,
  type LearningLessonSnapshot,
  type LearningQuickStudyProjection,
  type LearningSessionProjection,
} from "./learn-workspace-model";

import HeroQuote from "./hero-quote";

import "./learn-workspace.css";

type MobileCoursePane = "path" | "lesson";
type MobileTodayPane = "thread" | "session";
type CourseFocus = { courseId: string; lessonId: string; section: CourseSection };
export type LearnCourseFocus = { courseId?: string; lessonId?: string; quickStudyId?: string; section?: CourseSection };

const FOCUS_STORAGE_KEY = "interview-arc-learn-course-focus-v1";

const LEARN_DESTINATION_COPY: Record<LearnDestination, { eyebrow: string; title: string; quote: string; description: string }> = {
  today: {
    eyebrow: "LEARN · TODAY",
    title: "Pick up the thread.",
    quote: "Not the whole textbook.",
    description: "Today is the Session workbench: the timer, the exact Lesson in play, and the next honest action. The syllabus lives in Courses.",
  },
  courses: {
    eyebrow: "LEARN · COURSES",
    title: "A syllabus that grows",
    quote: "One lesson at a time.",
    description: "Overview, Lessons, Homework, and Statistics are four different rooms. The Module path is the Course spine; Planned stops stay outlines until they are written.",
  },
  history: {
    eyebrow: "LEARN · HISTORY",
    title: "The conversation stays.",
    quote: "Exact and private.",
    description: "Completed Sessions keep their timer, transcript, artifacts, and factual recap without turning raw conversation into a textbook.",
  },
  analytics: {
    eyebrow: "LEARN · STATISTICS",
    title: "Count the work.",
    quote: "Never invent mastery.",
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

function pathStateLabel(state: CoursePathLessonState) {
  if (state === "current") return "Current";
  if (state === "completed") return "Completed";
  if (state === "available") return "Available";
  return "Planned";
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readStoredFocus(): Partial<CourseFocus> & { lessonByCourse?: Record<string, string> } {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.sessionStorage.getItem(FOCUS_STORAGE_KEY);
    return stored ? JSON.parse(stored) as Partial<CourseFocus> & { lessonByCourse?: Record<string, string> } : {};
  } catch {
    return {};
  }
}

function readUrlFocus(): Partial<CourseFocus> {
  if (typeof window === "undefined") return {};
  const params = new URL(window.location.href).searchParams;
  return {
    courseId: params.get("course") ?? undefined,
    lessonId: params.get("lesson") ?? undefined,
    section: parseCourseSection(params.get("section")) ?? undefined,
  };
}

function syncCourseFocusToUrl(focus: CourseFocus, destination: LearnDestination) {
  if (typeof window === "undefined" || destination !== "courses") return;
  const route = new URL(window.location.href);
  route.searchParams.set("learn", "courses");
  if (focus.courseId) route.searchParams.set("course", focus.courseId);
  else route.searchParams.delete("course");
  if (focus.lessonId) route.searchParams.set("lesson", focus.lessonId);
  else route.searchParams.delete("lesson");
  route.searchParams.set("section", focus.section);
  const next = `${route.pathname}${route.search}${route.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
    window.history.replaceState(window.history.state, "", next);
  }
}

function LearnAnimalSketch({ destination }: { destination: LearnDestination }) {
  if (destination === "courses") return <svg viewBox="0 0 260 210" role="img" aria-label="An owl watching over an evolving syllabus"><path d="M72 72c8-34 31-51 58-37 28-14 51 3 59 37 13 53-8 99-59 111-51-12-72-58-58-111Z" /><path d="M86 54 69 30l38 16M174 54l17-24-38 16M94 89a22 22 0 1 0 44 0 22 22 0 0 0-44 0Zm28 0h16m28 0a22 22 0 1 1-44 0M122 113l8 11 8-11M106 147c15 8 33 8 49 0M92 181h76" /></svg>;
  if (destination === "history") return <svg viewBox="0 0 260 210" role="img" aria-label="An elephant carrying a private learning history"><path d="M66 83c7-36 35-56 75-50 36 5 59 31 57 68-1 28-16 48-40 58H91c-30-13-38-44-25-76Z" /><path d="M189 78c23 10 31 31 23 62-5 21-18 30-39 27M173 167c15 8 27 6 36-7M88 154v33M154 158v29M70 82 48 64l8 38M112 71a5 5 0 1 0 0 .1M137 32c-8 21-6 39 8 55" /></svg>;
  if (destination === "analytics") return <svg viewBox="0 0 260 210" role="img" aria-label="A honeybee tracing measured learning signals"><path d="M86 105c0-31 20-52 48-52s48 21 48 52-20 51-48 51-48-20-48-51Z" /><path d="M103 66c-24-25-51-23-62 5 17 21 38 27 63 18M164 67c23-26 50-24 62 4-17 21-39 27-64 18M97 86h73M88 109h92M100 135h69M134 53V29M122 29l12-13 12 13M87 154l-24 23M180 153l23 24" /></svg>;
  return <svg viewBox="0 0 260 210" role="img" aria-label="A fox picking up the current learning thread"><path d="M68 88 52 35l48 25c18-13 42-13 60 0l48-25-16 53c12 20 10 45-7 65-15 18-34 27-55 27s-40-9-55-27c-17-20-19-45-7-65Z" /><path d="M83 65 63 49l12 35M177 65l20-16-12 35M94 108a6 6 0 1 0 0 .1M166 108a6 6 0 1 0 0 .1M113 132c11 8 23 8 34 0M130 128v17M94 147c24 12 48 12 72 0" /></svg>;
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
  return <header key={destination} className={`learn-hero learn-hero-${destination}`}>
    <div className="learn-hero-copy">
      <span className="learn-eyebrow">{copy.eyebrow}</span>
      <h1>{copy.title}</h1>
      <HeroQuote className="learn-hero-quote">{copy.quote}</HeroQuote>
      <p className="learn-hero-lede">{copy.description}</p>
    </div>
    <div className="learn-animal-sketch"><LearnAnimalSketch destination={destination} /></div>
    <span className="learn-hero-pulse" aria-hidden="true" />
    <span className="learn-hero-light-band" aria-hidden="true" />
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
  courseTitle,
  moduleTitle,
  lessonTitle,
}: {
  session: LearningSessionProjection;
  now: number;
  busy: boolean;
  onControl: (action: "start" | "pause" | "resume") => void;
  courseTitle?: string;
  moduleTitle?: string;
  lessonTitle?: string;
}) {
  const state = session.session.state;
  const action = state === "planned" ? "start" : state === "running" ? "pause" : "resume";
  const place = [courseTitle, moduleTitle, lessonTitle].filter(Boolean).join(" · ");
  return <section className="learn-session-instrument" aria-label="Current Learning Session">
    <div><span className={`learn-live-dot ${state}`} aria-hidden="true" /><small>{state === "running" ? "SESSION LIVE" : `SESSION ${state.toUpperCase()}`}</small><strong>{formatTimer(sessionSeconds(session, now))}</strong></div>
    <p>{place ? `${place} · ` : ""}Transcript-only Voice · Lesson revision {session.session.lessonRevision} · {session.session.transcriptRevision} transcript revision{session.session.transcriptRevision === 1 ? "" : "s"}</p>
    <div className="learn-session-actions">
      <button type="button" onClick={() => onControl(action)} disabled={busy}>{busy ? "Saving…" : action === "start" ? "Start session" : action === "pause" ? "Pause" : "Resume"}</button>
      <button type="button" className="quiet" onClick={() => window.dispatchEvent(new CustomEvent("interview-arc-learn-finish-help"))}>Finish with specialist</button>
    </div>
  </section>;
}

function enrollmentCopy(course: LearningCourseProjection) {
  if (course.enrollment?.state === "active") return `Enrolled · Blueprint r${course.enrollment.blueprintRevision}`;
  if (course.enrollment?.state === "completed") return `Enrollment complete · Blueprint r${course.enrollment.blueprintRevision}`;
  if (course.enrollment?.state === "archived") return `Enrollment archived · Blueprint r${course.enrollment.blueprintRevision}`;
  return "Not enrolled";
}

function ModulePath({
  payload,
  course,
  selectedLessonId,
  onSelect,
}: {
  payload: LearnPayload;
  course: LearningCourseProjection;
  selectedLessonId: string;
  onSelect: (lessonId: string) => void;
}) {
  const modules = courseModulePath(payload, course);
  return <section className="learn-module-path" aria-labelledby="learn-module-path-title">
    <header>
      <div>
        <span className="learn-eyebrow">MODULE PATH</span>
        <h2 id="learn-module-path-title">{course.course.title}</h2>
        <p className="learn-enrollment">{enrollmentCopy(course)}</p>
      </div>
      <small>Course {course.course.state}</small>
    </header>
    {modules.map((module, moduleIndex) => <article className="learn-module" key={module.moduleId}>
      <div className="learn-module-heading"><span>{String(moduleIndex + 1).padStart(2, "0")}</span><div><strong>{module.title}</strong><small>{module.completedLessons} / {module.lessons.length} lessons</small></div></div>
      <ol>{module.lessons.map((lesson, lessonIndex) => {
        const selected = lesson.lessonId === selectedLessonId;
        return <li className={`${lesson.state}${selected ? " selected" : ""}`} key={lesson.lessonId}>
          <button
            type="button"
            aria-current={selected ? "true" : undefined}
            aria-label={`${lesson.title}, ${pathStateLabel(lesson.state)}, module ${module.title}, stop ${lessonIndex + 1} of ${module.lessons.length}`}
            onClick={() => onSelect(lesson.lessonId)}
          >
            <span aria-hidden="true">{lesson.state === "completed" ? "✓" : lesson.state === "current" ? "●" : lesson.state === "available" ? "◐" : "○"}</span>
            <div>
              <strong>{lesson.title}</strong>
              <small>{lesson.kind === "lab" ? "Lab" : "Lesson"} · {pathStateLabel(lesson.state)}{lesson.requiredCheckpoints ? ` · ${lesson.demonstratedCheckpoints}/${lesson.requiredCheckpoints} checkpoints` : ""}</small>
            </div>
          </button>
        </li>;
      })}</ol>
    </article>)}
  </section>;
}

function CheckpointList({ payload, lesson }: { payload: LearnPayload; lesson: LearningLessonSnapshot }) {
  const states = new Map(payload.evidence.checkpointStates.filter((item) => item.lessonId === lesson.lessonId).map((item) => [item.checkpointId, item.status]));
  return <section className="learn-lesson-block" id="checkpoints"><span className="learn-eyebrow">CHECKPOINTS</span><div className="learn-checkpoints">{lesson.checkpoints.map((checkpoint) => {
    const status = states.get(checkpoint.checkpointId) ?? "not_attempted";
    return <article key={checkpoint.checkpointId} className={status}><span aria-hidden="true" /> <div><strong>{checkpoint.label}</strong><p>{checkpoint.description}</p></div><small>{statusLabel(status)}</small></article>;
  })}</div></section>;
}

function LessonContents({ lesson, activeId, onJump }: { lesson: LearningLessonSnapshot; activeId: string; onJump: (id: string) => void }) {
  const items = lessonContentItems(lesson);
  if (!items.length) return null;
  return <details className="learn-lesson-contents">
    <summary aria-label="Open Lesson contents">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9" /></svg>
      <span>Contents</span>
    </summary>
    <nav aria-label="On this Lesson">
      {items.map((item) => (
        <a
          href={`#learn-${item.id}`}
          key={item.id}
          className={activeId === item.id ? "active" : ""}
          aria-current={activeId === item.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onJump(item.id);
            event.currentTarget.closest("details")?.removeAttribute("open");
          }}
        >
          {item.label}
        </a>
      ))}
    </nav>
  </details>;
}

function PlannedLessonCard({ course, lesson, moduleTitle }: { course: LearningCourseProjection; lesson: CoursePathLesson; moduleTitle: string }) {
  const modules = course.blueprint?.modules ?? [];
  const currentModule = modules.find((item) => item.lessons.some((entry) => entry.lessonId === lesson.lessonId));
  const siblings = currentModule?.lessons.length ?? 0;
  const position = (currentModule?.lessons.findIndex((entry) => entry.lessonId === lesson.lessonId) ?? 0) + 1;
  return <article className="learn-current-lesson learn-planned-lesson" aria-labelledby="learn-current-lesson-title">
    <header>
      <div>
        <span className="learn-eyebrow">BLUEPRINT CARD · NOT WRITTEN YET</span>
        <h2 id="learn-current-lesson-title">{lesson.title}</h2>
        <p>{lesson.objective}</p>
      </div>
      <span className="learn-state planned">Planned</span>
    </header>
    <section className="learn-prerequisites"><strong>Module and position</strong><p>{moduleTitle} · {lesson.kind === "lab" ? "Lab" : "Lesson"} {position} of {siblings}</p></section>
    {lesson.prerequisites.length > 0 && <section className="learn-prerequisites"><strong>Before this lesson</strong><p>{lesson.prerequisites.join(" · ")}</p></section>}
    <p className="learn-planned-copy">The Course Blueprint already named this stop. The reusable Current lesson does not exist until the Learning Specialist writes it from the sources in front of them. Selecting it here does not create a Lesson, start a Session, or change Enrollment.</p>
  </article>;
}

function WrittenLesson({ payload, lesson }: { payload: LearnPayload; lesson: LearningLessonSnapshot }) {
  const items = useMemo(() => lessonContentItems(lesson), [lesson]);
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const headings = items.map((item) => document.getElementById(`learn-${item.id}`)).filter((node): node is HTMLElement => Boolean(node));
    if (!headings.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (visible?.target.id) setActiveId(visible.target.id.replace(/^learn-/, ""));
    }, { rootMargin: "-20% 0px -55% 0px", threshold: [0.15, 0.4, 0.7] });
    headings.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items]);

  function jump(id: string) {
    const node = document.getElementById(`learn-${id}`);
    node?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    setActiveId(id);
  }

  return <div className="learn-lesson-reader">
    <article className="learn-current-lesson learn-written-lesson" aria-labelledby="learn-current-lesson-title">
      <LessonContents lesson={lesson} activeId={activeId} onJump={jump} />
      <header>
        <div>
          <span className="learn-eyebrow">CURRENT LESSON · REVISION {lesson.revision}</span>
          <h2 id="learn-current-lesson-title">{lesson.title}</h2>
          <p>{lesson.objective}</p>
        </div>
        <span className={`learn-state ${lesson.state}`}>{lesson.state}</span>
      </header>
      {lesson.prerequisites.length > 0 && <section className="learn-prerequisites"><strong>Before this lesson</strong><p>{lesson.prerequisites.join(" · ")}</p></section>}
      {lesson.sections.map((section) => <section className="learn-lesson-block" id={`learn-section-${section.sectionId}`} key={section.sectionId}><h3>{section.heading}</h3><p className="learn-prose">{section.body}</p></section>)}
      {lesson.examples.map((example) => <section className="learn-example" id={`learn-example-${example.exampleId}`} key={example.exampleId}><span className="learn-eyebrow">EXAMPLE · {example.title}</span>{example.language ? <pre><code>{example.body}</code></pre> : <p>{example.body}</p>}</section>)}
      {lesson.exercises.length > 0 && <section className="learn-lesson-block" id="learn-exercises"><span className="learn-eyebrow">EXERCISES</span><ol className="learn-exercises">{lesson.exercises.map((exercise) => <li key={exercise.exerciseId}>{exercise.prompt}</li>)}</ol></section>}
      <div id="learn-checkpoints"><CheckpointList payload={payload} lesson={lesson} /></div>
      {lesson.homework.length > 0 && <section className="learn-lesson-block" id="learn-homework"><span className="learn-eyebrow">HOMEWORK</span><ol className="learn-exercises">{lesson.homework.map((item) => <li key={item.homeworkId}>{item.prompt}</li>)}</ol></section>}
      {lesson.sourcePins.length > 0 && <section className="learn-sources" id="learn-sources"><span className="learn-eyebrow">EXACT SOURCES</span>{lesson.sourcePins.map((source, index) => <div key={`${source.title}-${index}`}><strong>{source.title}</strong><small>{source.repository && source.commit ? `${source.repository} · ${source.commit.slice(0, 12)}` : source.kind.replaceAll("_", " ")}{source.path ? ` · ${source.path}` : ""}</small>{source.url && <a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a>}</div>)}</section>}
    </article>
  </div>;
}

function LessonNavigator({
  payload,
  course,
  selectedLessonId,
  onSelect,
}: {
  payload: LearnPayload;
  course: LearningCourseProjection;
  selectedLessonId: string;
  onSelect: (lessonId: string) => void;
}) {
  const path = courseModulePath(payload, course);
  const currentId = course.enrollment?.currentLessonId;
  const { previous, next } = adjacentCourseLessons(path, selectedLessonId);
  return <nav className="learn-lesson-nav" aria-label="Adjacent lessons">
    {currentId && currentId !== selectedLessonId && <button type="button" onClick={() => onSelect(currentId)}>Return to current lesson</button>}
    <button type="button" disabled={!previous} onClick={() => previous && onSelect(previous.lessonId)}>
      Previous{previous ? ` · ${previous.title}` : ""}
    </button>
    <button type="button" disabled={!next} onClick={() => next && onSelect(next.lessonId)}>
      Next{next ? ` · ${next.title}` : ""}
    </button>
  </nav>;
}

function LessonReader({
  payload,
  course,
  selectedLessonId,
  onSelect,
}: {
  payload: LearnPayload;
  course: LearningCourseProjection;
  selectedLessonId: string;
  onSelect: (lessonId: string) => void;
}) {
  const located = locateCourseLesson(payload, course, selectedLessonId);
  if (!located) {
    return <section className="learn-current-lesson learn-current-lesson-empty">
      <span className="learn-eyebrow">CURRENT LESSON</span>
      <h2>Select a Lesson from the Module path.</h2>
      <p>The Enrollment Current lesson stays put. Browsing only changes what you are reading.</p>
    </section>;
  }
  return <div className="learn-lesson-stage">
    {located.snapshot
      ? <WrittenLesson payload={payload} lesson={located.snapshot} />
      : <PlannedLessonCard course={course} lesson={located.lesson} moduleTitle={located.module.title} />}
    <LessonNavigator payload={payload} course={course} selectedLessonId={selectedLessonId} onSelect={onSelect} />
  </div>;
}

function QuickStudyWorkspace({
  payload,
  study,
  busy,
  onHomework,
}: {
  payload: LearnPayload;
  study: LearningQuickStudyProjection;
  busy: boolean;
  onHomework: (homework: LearnPayload["evidence"]["homework"][number]) => void;
}) {
  const activeSession = selectActiveLearningSession(payload, study.lesson.lessonId);
  const homework = payload.evidence.homework.filter((item) => item.lessonId === study.lesson.lessonId);
  return <div className="learn-course-workspace learn-quick-study-workspace">
    <header className="learn-quick-study-header"><div><span className="learn-eyebrow">QUICK STUDY</span><h2>{study.lesson.title}</h2><p>A standalone Current lesson with no Course or Enrollment overhead.</p></div><span className={`learn-state ${study.lesson.state}`}>{study.lesson.state}</span></header>
    {activeSession && <aside className="learn-session-chip"><p>A {activeSession.session.state} Session is attached to this Quick Study. Open Today to control its timer.</p></aside>}
    {study.current ? <WrittenLesson payload={payload} lesson={study.current} /> : <section className="learn-current-lesson learn-current-lesson-empty"><span className="learn-eyebrow">CURRENT LESSON</span><h2>This Lesson has not been generated yet.</h2><p>The Learning Specialist creates the exact reusable Lesson revision immediately before the Session starts.</p></section>}
    {homework.length > 0 && <section className="learn-homework-panel"><header><span className="learn-eyebrow">HOMEWORK</span><h2>Follow-up, recorded plainly.</h2><p>Completion is a fact. It does not automatically demonstrate a checkpoint.</p></header>{homework.map((item) => <article key={item.homeworkId}><div><strong>{item.prompt}</strong><small>Revision {item.revision} · {item.state}</small></div><button type="button" onClick={() => onHomework(item)} disabled={busy}>{item.state === "completed" ? "Mark open" : "Mark completed"}</button></article>)}</section>}
  </div>;
}

function CourseIndex({
  payload,
  courses,
  quickStudies,
  selectedCourse,
  selectedQuickStudy,
  onSelectCourse,
  onSelectQuickStudy,
}: {
  payload: LearnPayload;
  courses: LearningCourseProjection[];
  quickStudies: LearningQuickStudyProjection[];
  selectedCourse: LearningCourseProjection | null;
  selectedQuickStudy: LearningQuickStudyProjection | null;
  onSelectCourse: (courseId: string) => void;
  onSelectQuickStudy: (lessonId: string) => void;
}) {
  return <nav className="learn-course-index" aria-label="Courses and Quick Studies">
    <header><span className="learn-eyebrow">COURSES</span><h2>{courses.length} Blueprint{courses.length === 1 ? "" : "s"}</h2><p>Select a Course to change the reader.</p></header>
    {courses.map((course) => <button type="button" key={course.course.courseId} className={selectedCourse?.course.courseId === course.course.courseId ? "active" : ""} aria-current={selectedCourse?.course.courseId === course.course.courseId ? "true" : undefined} onClick={() => onSelectCourse(course.course.courseId)}><span>{enrollmentCopy(course)}</span><strong>{course.course.title}</strong><small>{course.lessons.filter((lesson) => lesson.state === "completed").length} / {flattenCourseLessons(courseModulePath(payload, course)).length} lessons · Course {course.course.state}</small></button>)}
    {quickStudies.length > 0 && <div className="learn-course-index-divider"><span className="learn-eyebrow">QUICK STUDIES</span><small>{quickStudies.length} standalone</small></div>}
    {quickStudies.map((study) => <button type="button" key={study.lesson.lessonId} className={selectedQuickStudy?.lesson.lessonId === study.lesson.lessonId ? "active" : ""} aria-current={selectedQuickStudy?.lesson.lessonId === study.lesson.lessonId ? "true" : undefined} onClick={() => onSelectQuickStudy(study.lesson.lessonId)}><span>{study.lesson.state}</span><strong>{study.lesson.title}</strong><small>Current lesson r{study.current?.revision ?? study.lesson.currentRevision}</small></button>)}
  </nav>;
}

function homeworkDomId(homeworkId: string) {
  return `learn-homework-${homeworkId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
}

function HomeworkIndex({ homework }: { homework: LearnPayload["evidence"]["homework"] }) {
  return <nav className="learn-context-rail learn-homework-index" aria-label="Course assignments">
    <header><span className="learn-eyebrow">ASSIGNMENTS</span><h2>{homework.length} current</h2><p>Open and completed states from exact Lesson revisions.</p></header>
    {homework.length ? homework.map((item) => <a href={`#${homeworkDomId(item.homeworkId)}`} key={item.homeworkId}><strong>{item.prompt}</strong><small>Revision {item.revision} · {item.state}</small></a>) : <p className="learn-context-empty">No homework is attached to this Course yet.</p>}
  </nav>;
}

function CourseScope({ course, analytics }: { course: LearningCourseProjection; analytics?: LearnPayload["analytics"]["courses"][number] }) {
  return <aside className="learn-context-rail learn-course-scope" aria-labelledby="learn-course-scope-title">
    <header><span className="learn-eyebrow">STATISTICS SCOPE</span><h2 id="learn-course-scope-title">This Course</h2><p>{course.course.title}</p></header>
    <dl>
      <div><dt>Enrollment</dt><dd>{enrollmentCopy(course)}</dd></div>
      <div><dt>Recorded</dt><dd>{formatDuration(factualCount(analytics?.recordedSeconds))}</dd></div>
      <div><dt>Sessions</dt><dd>{factualCount(analytics?.completedSessionCount)}</dd></div>
      <div><dt>Evidence policy</dt><dd>Factual records only</dd></div>
    </dl>
  </aside>;
}

function CourseOverview({ payload, course, onOpenLessons }: { payload: LearnPayload; course: LearningCourseProjection; onOpenLessons: () => void }) {
  const progress = courseProgress(payload, course);
  const current = locateCourseLesson(payload, course, course.enrollment?.currentLessonId);
  return <section className="learn-course-overview" aria-labelledby="learn-overview-title">
    <header>
      <span className="learn-eyebrow">COURSE OVERVIEW</span>
      <h2 id="learn-overview-title">{course.course.title}</h2>
      <p className="learn-enrollment">{enrollmentCopy(course)}</p>
    </header>
    <p className="learn-overview-goal">{course.blueprint?.goal || "This Blueprint does not yet record a goal."}</p>
    <p className="learn-overview-outcome">{course.blueprint?.intendedOutcome || "Intended outcome is not recorded yet."}</p>
    <dl className="learn-overview-facts">
      <div><dt>Course state</dt><dd>{statusLabel(course.course.state)}</dd></div>
      <div><dt>Approved Blueprint</dt><dd>r{course.enrollment?.blueprintRevision ?? course.blueprint?.revision ?? course.course.currentBlueprintRevision}</dd></div>
      <div><dt>Current module</dt><dd>{current?.module.title ?? "None"}</dd></div>
      <div><dt>Current lesson</dt><dd>{current?.lesson.title ?? "None"}</dd></div>
      <div><dt>Lessons written</dt><dd>{progress.writtenLessons} / {progress.totalLessons}</dd></div>
      <div><dt>Checkpoints</dt><dd>{progress.demonstratedCheckpoints} / {progress.requiredCheckpoints || 0}</dd></div>
    </dl>
    <p className="learn-overview-next">{nextCourseAction(payload, course)}</p>
    <button type="button" className="learn-open-lesson" onClick={onOpenLessons}>Open Lessons</button>
  </section>;
}

function HomeworkPanel({
  homework,
  busy,
  onHomework,
}: {
  homework: LearnPayload["evidence"]["homework"];
  busy: boolean;
  onHomework: (homework: LearnPayload["evidence"]["homework"][number]) => void;
}) {
  return <section className="learn-homework-panel" aria-labelledby="learn-homework-title">
    <header><span className="learn-eyebrow">HOMEWORK</span><h2 id="learn-homework-title">Assigned work, recorded plainly.</h2><p>Completion is a fact. It does not automatically demonstrate a checkpoint.</p></header>
    {homework.length ? homework.map((item) => <article id={homeworkDomId(item.homeworkId)} key={item.homeworkId}><div><strong>{item.prompt}</strong><small>Revision {item.revision} · {item.state}</small></div><button type="button" onClick={() => onHomework(item)} disabled={busy}>{item.state === "completed" ? "Mark open" : "Mark completed"}</button></article>) : <p className="learn-inline-empty">No homework is attached to this Course yet.</p>}
  </section>;
}

function CourseWorkspace({
  payload,
  course,
  courseIndex,
  section,
  onSection,
  selectedLessonId,
  onSelectLesson,
  mobilePane,
  onMobilePane,
  busy,
  onHomework,
}: {
  payload: LearnPayload;
  course: LearningCourseProjection;
  courseIndex: ReactNode;
  section: CourseSection;
  onSection: (section: CourseSection) => void;
  selectedLessonId: string;
  onSelectLesson: (lessonId: string) => void;
  mobilePane: MobileCoursePane;
  onMobilePane: (pane: MobileCoursePane) => void;
  busy: boolean;
  onHomework: (homework: LearnPayload["evidence"]["homework"][number]) => void;
}) {
  const current = selectCurrentLesson(course);
  const sessionForSelected = selectActiveLearningSession(payload, selectedLessonId);
  const activeSession = selectActiveLearningSession(payload, current?.lessonId) ?? selectActiveLearningSession(payload);
  const inspectingOther = Boolean(activeSession && activeSession.session.lessonId !== selectedLessonId);
  const homework = payload.evidence.homework.filter((item) => course.lessons.some((lesson) => lesson.lessonId === item.lessonId));
  const analytics = payload.analytics.courses.find((item) => item.courseId === course.course.courseId);
  return <div className="learn-course-workspace learn-courses-surface">
    <nav className="learn-course-nav" aria-label={`${course.course.title} navigation`}>{(["overview", "lessons", "homework", "analytics"] as CourseSection[]).map((item) => <button type="button" key={item} className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined} onClick={() => onSection(item)}>{item === "analytics" ? "statistics" : item}</button>)}</nav>
    {section === "overview" && <div className="learn-courses-layout learn-course-section-overview">{courseIndex}<CourseOverview payload={payload} course={course} onOpenLessons={() => onSection("lessons")} /></div>}
    {section === "lessons" && <>
      <div className="learn-mobile-pane-switcher" aria-label="Course reading surface"><button type="button" className={mobilePane === "path" ? "active" : ""} aria-pressed={mobilePane === "path"} onClick={() => onMobilePane("path")}>Module path</button><button type="button" className={mobilePane === "lesson" ? "active" : ""} aria-pressed={mobilePane === "lesson"} onClick={() => onMobilePane("lesson")}>Current lesson</button></div>
      <div className={`learn-courses-layout learn-course-section-lessons mobile-${mobilePane}`}>
        <ModulePath payload={payload} course={course} selectedLessonId={selectedLessonId} onSelect={onSelectLesson} />
        <div className="learn-course-reader-pane">
          {inspectingOther && activeSession && <aside className="learn-session-chip"><p>A Session is {activeSession.session.state} on another Lesson.</p><button type="button" onClick={() => onSelectLesson(activeSession.session.lessonId)}>Return to the Session lesson</button></aside>}
          {sessionForSelected && !inspectingOther && <aside className="learn-session-chip"><p>A Session is {sessionForSelected.session.state} on this Lesson. Open Today to control its timer.</p></aside>}
          <LessonReader payload={payload} course={course} selectedLessonId={selectedLessonId} onSelect={onSelectLesson} />
        </div>
      </div>
    </>}
    {section === "homework" && <div className="learn-courses-layout learn-course-section-homework"><HomeworkIndex homework={homework} /><HomeworkPanel homework={homework} busy={busy} onHomework={onHomework} /></div>}
    {section === "analytics" && <div className="learn-courses-layout learn-course-section-analytics"><CourseScope course={course} analytics={analytics} /><CourseAnalytics course={course} analytics={analytics} /></div>}
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
  return <section className="learn-course-analytics" aria-labelledby="learn-course-statistics-title"><header><span className="learn-eyebrow">COURSE STATISTICS</span><h2 id="learn-course-statistics-title">{course.course.title}</h2><p>Only observed Learning records are counted.</p></header><dl>{cells.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function CurrentLearningThread({
  payload,
  course,
  located,
  quickStudy,
  session,
}: {
  payload: LearnPayload;
  course: LearningCourseProjection | null;
  located: ReturnType<typeof locateCourseLesson>;
  quickStudy: LearningQuickStudyProjection | null;
  session: LearningSessionProjection;
}) {
  const next = course && located ? adjacentCourseLessons(courseModulePath(payload, course), located.lesson.lessonId).next : null;
  return <aside className="learn-today-context" aria-labelledby="learn-today-thread-title">
    <header><h2 id="learn-today-thread-title">Current thread</h2><p>Exact Course, Module, Lesson, and checkpoint scope.</p></header>
    <div className="learn-today-context-body">
      <dl>
        <div><dt>{quickStudy ? "Scope" : "Course"}</dt><dd>{quickStudy ? "Quick Study" : course?.course.title ?? "Course unavailable"}</dd></div>
        <div><dt>{quickStudy ? "Lesson revision" : "Enrollment"}</dt><dd>{quickStudy ? `r${quickStudy.current?.revision ?? quickStudy.lesson.currentRevision}` : course ? enrollmentCopy(course) : "Not available"}</dd></div>
      </dl>
      <ol className="learn-thread-path">
        {located?.module && <li><span aria-hidden="true" /><div><strong>{located.module.title}</strong><small>MODULE · {located.module.lessons.length} LESSONS</small></div></li>}
        <li className="current"><span aria-hidden="true" /><div><strong>{located?.lesson.title ?? quickStudy?.lesson.title ?? session.session.lessonId}</strong><small>CURRENT · LESSON R{session.session.lessonRevision}</small></div></li>
        {next && <li><span aria-hidden="true" /><div><strong>{next.title}</strong><small>{pathStateLabel(next.state).toUpperCase()} · NEXT LESSON</small></div></li>}
      </ol>
    </div>
  </aside>;
}

function TodayWorkbench({
  payload,
  session,
  quickStudy,
  now,
  busy,
  onControl,
  onOpenCourses,
}: {
  payload: LearnPayload;
  session: LearningSessionProjection | null;
  quickStudy: LearningQuickStudyProjection | null;
  now: number;
  busy: boolean;
  onControl: (session: LearningSessionProjection, action: "start" | "pause" | "resume") => void;
  onOpenCourses: (focus?: LearnCourseFocus) => void;
}) {
  const [mobilePane, setMobilePane] = useState<MobileTodayPane>("session");
  const course = session?.session.courseId ? selectLearningCourse(payload, session.session.courseId) : null;
  const located = course ? locateCourseLesson(payload, course, session?.session.lessonId) : null;
  const todayQuickStudy = session?.session.scopeType === "quick_study" ? quickStudy : null;
  if (!session) {
    return <div className="learn-today-body learn-today-empty-body">
      <aside className="learn-today-context"><header><h2>Current thread</h2><p>No Session is planned.</p></header><div className="learn-today-context-body"><p>Courses remain available for reading without starting time.</p></div></aside>
      <section className="learn-empty learn-today-empty" aria-labelledby="learn-today-empty-title"><span className="learn-eyebrow">TODAY · SESSION WORKBENCH</span><h2 id="learn-today-empty-title">No Learning Session is planned.</h2><p>Today holds the Session you are in. Open Courses to inspect the syllabus, written lessons, homework, and counts without starting time.</p><button type="button" className="learn-open-lesson" onClick={() => onOpenCourses({ section: "lessons" })}>Open Courses</button></section>
    </div>;
  }
  const snapshot = todayQuickStudy?.current ?? located?.snapshot;
  const lessonTitle = located?.lesson.title ?? todayQuickStudy?.lesson.title ?? session.session.lessonId;
  const checkpoints = snapshot?.checkpoints.filter((item) => item.required) ?? [];
  const demonstrated = checkpoints.filter((checkpoint) => payload.evidence.checkpointStates.some((state) => state.lessonId === snapshot?.lessonId && state.checkpointId === checkpoint.checkpointId && state.status === "demonstrated")).length;
  return <div className="learn-today-workbench">
    <SessionInstrument
      session={session}
      now={now}
      busy={busy}
      courseTitle={course?.course.title}
      moduleTitle={located?.module.title}
      lessonTitle={lessonTitle}
      onControl={(action) => onControl(session, action)}
    />
    <nav className="learn-mobile-today-switcher" aria-label="Today reading surface"><button type="button" className={mobilePane === "thread" ? "active" : ""} aria-pressed={mobilePane === "thread"} onClick={() => setMobilePane("thread")}>Thread</button><button type="button" className={mobilePane === "session" ? "active" : ""} aria-pressed={mobilePane === "session"} onClick={() => setMobilePane("session")}>Session</button></nav>
    <div className={`learn-today-body mobile-${mobilePane}`}>
      <CurrentLearningThread payload={payload} course={course} located={located} quickStudy={todayQuickStudy} session={session} />
      <section className="learn-today-summary" aria-labelledby="learn-today-lesson-title">
        <span className="learn-eyebrow">IN PLAY</span>
        <h2 id="learn-today-lesson-title">{lessonTitle}</h2>
        <p>{snapshot?.objective ?? located?.lesson.objective ?? "The specialist has not written this Lesson yet."}</p>
        <p className="learn-enrollment">{course ? enrollmentCopy(course) : `Quick Study · Lesson r${snapshot?.revision ?? session.session.lessonRevision}`}</p>
        {checkpoints.length > 0 && <p>Required checkpoints {demonstrated} / {checkpoints.length}.</p>}
        <button type="button" className="learn-open-lesson" onClick={() => onOpenCourses({ courseId: course?.course.courseId, lessonId: session.session.lessonId, quickStudyId: todayQuickStudy?.lesson.lessonId, section: "lessons" })}>Open full lesson</button>
      </section>
    </div>
  </div>;
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

export default function LearnWorkspace({
  destination,
  openedFocus,
  onOpenCourses,
}: {
  destination: LearnDestination;
  openedFocus?: LearnCourseFocus;
  onOpenCourses?: (focus?: LearnCourseFocus) => void;
}) {
  const storedFocus = readStoredFocus();
  const urlFocus = readUrlFocus();
  const [payload, setPayload] = useState<LearnPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(urlFocus.courseId || storedFocus.courseId || "");
  const [selectedQuickStudyId, setSelectedQuickStudyId] = useState("");
  const [courseSection, setCourseSection] = useState<CourseSection>(urlFocus.section || storedFocus.section || "overview");
  const [lessonByCourse, setLessonByCourse] = useState<Record<string, string>>(storedFocus.lessonByCourse ?? {});
  const [mobilePane, setMobilePane] = useState<MobileCoursePane>("lesson");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [appliedFocusSignature, setAppliedFocusSignature] = useState("");
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
  const selectedLessonId = selectedCourse
    ? lessonByCourse[selectedCourse.course.courseId] || defaultCourseLessonId(payload!, selectedCourse) || ""
    : "";
  const openedSignature = `${openedFocus?.courseId ?? ""}|${openedFocus?.lessonId ?? ""}|${openedFocus?.quickStudyId ?? ""}|${openedFocus?.section ?? ""}`;
  if (openedSignature && openedSignature !== appliedFocusSignature) {
    setAppliedFocusSignature(openedSignature);
    if (openedFocus?.courseId) {
      setSelectedCourseId(openedFocus.courseId);
      setSelectedQuickStudyId("");
    }
    if (openedFocus?.quickStudyId) setSelectedQuickStudyId(openedFocus.quickStudyId);
    if (openedFocus?.section) setCourseSection(openedFocus.section);
    if (openedFocus?.courseId && openedFocus?.lessonId) {
      setLessonByCourse((current) => ({ ...current, [openedFocus.courseId!]: openedFocus.lessonId! }));
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !selectedCourse) return;
    const focus = { courseId: selectedCourse.course.courseId, lessonId: selectedLessonId, section: courseSection, lessonByCourse };
    window.sessionStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focus));
    syncCourseFocusToUrl({ courseId: selectedCourse.course.courseId, lessonId: selectedLessonId, section: courseSection }, destination);
  }, [selectedCourse, selectedLessonId, courseSection, destination, lessonByCourse]);

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

  function selectLessonWithoutMutatingEnrollment(courseId: string, lessonId: string) {
    setLessonByCourse((current) => ({ ...current, [courseId]: lessonId }));
  }

  if (loading) return <div className="learn-workspace"><LearnHero destination={destination} payload={null} /><section className="learn-loading" aria-live="polite"><span /><p>Opening the private Learn workspace…</p></section></div>;
  if (error || !payload) return <div className="learn-workspace"><LearnHero destination={destination} payload={null} /><section className="learn-error" role="alert"><span className="learn-eyebrow">LEARN UNAVAILABLE</span><h2>The private Learning record could not be read.</h2><p>{error}</p><button type="button" onClick={() => { setLoading(true); void refresh(); }}>Try again</button></section></div>;

  const courses = payload.workspace.courses;
  const quickStudies = payload.workspace.quickStudies;
  const activeSession = selectActiveLearningSession(payload);
  const todayQuickStudy = activeSession?.session.scopeType === "quick_study"
    ? selectQuickStudy(payload, activeSession.session.lessonId)
    : selectedQuickStudy;
  const courseIndex = <CourseIndex
    payload={payload}
    courses={courses}
    quickStudies={quickStudies}
    selectedCourse={selectedCourse}
    selectedQuickStudy={selectedQuickStudy}
    onSelectCourse={(courseId) => {
      setSelectedQuickStudyId("");
      setSelectedCourseId(courseId);
      setCourseSection("overview");
    }}
    onSelectQuickStudy={(lessonId) => {
      setSelectedQuickStudyId(lessonId);
      setCourseSection("overview");
    }}
  />;

  return <div className="learn-workspace">
    <LearnHero destination={destination} payload={payload} />
    {notice && <div className="learn-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss Learn message">×</button></div>}
    {destination === "today" && (
      <TodayWorkbench
        payload={payload}
        session={activeSession}
        quickStudy={todayQuickStudy}
        now={now}
        busy={busy}
        onControl={(session, action) => void controlSessionExact(session, action)}
        onOpenCourses={(focus) => onOpenCourses?.(focus)}
      />
    )}
    {destination === "courses" && (courses.length || quickStudies.length ? selectedQuickStudy
      ? <div className="learn-courses-layout learn-quick-study-layout">{courseIndex}<QuickStudyWorkspace payload={payload} study={selectedQuickStudy} busy={busy} onHomework={(item) => void setHomework(item)} /></div>
      : selectedCourse && <CourseWorkspace payload={payload} course={selectedCourse} courseIndex={courseIndex} section={courseSection} onSection={setCourseSection} selectedLessonId={selectedLessonId} onSelectLesson={(lessonId) => selectLessonWithoutMutatingEnrollment(selectedCourse.course.courseId, lessonId)} mobilePane={mobilePane} onMobilePane={setMobilePane} busy={busy} onHomework={(item) => void setHomework(item)} />
      : <EmptyLearn destination="courses" />)}
    {destination === "history" && <HistoryView payload={payload} />}
    {destination === "analytics" && <AnalyticsView payload={payload} />}
  </div>;
}

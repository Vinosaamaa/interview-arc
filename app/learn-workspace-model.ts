export type LearnDestination = "today" | "courses" | "history" | "analytics";
export type LearningSessionState = "planned" | "running" | "paused" | "completed";
export type LearningCheckpointStatus = "not_attempted" | "needs_another_pass" | "demonstrated";

export type LearningBlueprintLesson = {
  lessonId: string;
  title: string;
  order: number;
  kind: "lesson" | "lab";
  objective: string;
  prerequisites: string[];
};

export type LearningBlueprintModule = {
  moduleId: string;
  title: string;
  order: number;
  objective: string;
  lessons: LearningBlueprintLesson[];
};

export type LearningLessonSnapshot = {
  lessonId: string;
  state: "active" | "completed" | "archived";
  title: string;
  objective: string;
  prerequisites: string[];
  sections: Array<{ sectionId: string; heading: string; body: string }>;
  examples: Array<{ exampleId: string; title: string; body: string; language?: string }>;
  exercises: Array<{ exerciseId: string; prompt: string }>;
  homework: Array<{ homeworkId: string; prompt: string }>;
  checkpoints: Array<{ checkpointId: string; label: string; description: string; required: boolean }>;
  sourcePins: Array<{
    kind: "web" | "repository" | "engineering_journal" | "owner_provided";
    title: string;
    url?: string;
    repository?: string;
    commit?: string;
    path?: string;
    recordId?: string;
    recordRevision?: number;
    symbols: string[];
  }>;
  revision: number;
  createdAt: number;
};

export type LearningCourseProjection = {
  course: {
    courseId: string;
    currentBlueprintRevision: number;
    state: "draft" | "active" | "completed" | "archived";
    title: string;
    createdAt: number;
    updatedAt: number;
  };
  blueprint: {
    courseId: string;
    state: "draft" | "active" | "completed" | "archived";
    title: string;
    goal: string;
    priorKnowledge: string[];
    intendedOutcome: string;
    sourcePins: LearningLessonSnapshot["sourcePins"];
    modules: LearningBlueprintModule[];
    revision: number;
    createdAt: number;
  } | null;
  enrollment: {
    enrollmentId: string;
    blueprintRevision: number;
    state: "active" | "completed" | "archived";
    currentModuleId: string | null;
    currentLessonId: string | null;
    revision: number;
    enrolledAt: number;
    completedAt: number | null;
  } | null;
  lessons: Array<{
    lessonId: string;
    moduleId: string | null;
    currentRevision: number;
    state: "active" | "completed" | "archived";
    title: string;
    updatedAt: number;
    current: LearningLessonSnapshot | null;
  }>;
};

export type LearningQuickStudyProjection = {
  lesson: {
    lessonId: string;
    scopeType: "quick_study";
    courseId: null;
    enrollmentId: null;
    moduleId: null;
    currentRevision: number;
    state: "active" | "completed" | "archived";
    title: string;
    createdAt: number;
    updatedAt: number;
  };
  current: LearningLessonSnapshot | null;
};

export type LearningSessionProjection = {
  session: {
    sessionId: string;
    scopeType: "course" | "quick_study";
    courseId: string | null;
    lessonId: string;
    lessonRevision: number;
    state: LearningSessionState;
    accumulatedSeconds: number;
    runningSince: number | null;
    completedAt: number | null;
    revision: number;
    transcriptRevision: number;
    finalizationRevision: number;
    updatedAt: number;
  };
  intervals: Array<{ startedAt: number; endedAt: number | null }>;
  turns: Array<{
    turnId: string;
    sequence: number;
    speaker: "learner" | "specialist";
    source: "typed" | "dictation" | "voice_transcript";
    body: string;
    occurredAt: number;
  }>;
  evidencePolicy: "transcript_only";
};

export type LearnPayload = {
  workspace: {
    courses: LearningCourseProjection[];
    quickStudies: LearningQuickStudyProjection[];
    facts: Record<string, number>;
    truncated: boolean;
  };
  sessions: LearningSessionProjection[];
  evidence: {
    checkpointStates: Array<{
      lessonId: string;
      checkpointId: string;
      currentRevision: number;
      status: LearningCheckpointStatus;
      updatedAt: number;
    }>;
    checkpointHistory: unknown[];
    homework: Array<{
      lessonId: string;
      homeworkId: string;
      prompt: string;
      state: "open" | "completed";
      revision: number;
      completedAt: number | null;
    }>;
    homeworkHistory: unknown[];
    artifacts: unknown[];
    finalizations: unknown[];
  };
  journey: { events: unknown[]; truncated: boolean; evidencePolicy: "factual_events_only" };
  analytics: {
    courses: Array<Record<string, unknown> & { courseId: string }>;
    overall: Record<string, number | null>;
    time: {
      byDay: Array<{ key: string; sessionCount: number; recordedSeconds: number }>;
      byWeek: Array<{ key: string; sessionCount: number; recordedSeconds: number }>;
      byMonth: Array<{ key: string; sessionCount: number; recordedSeconds: number }>;
      byCourse: Array<{ key: string; title: string; sessionCount: number; recordedSeconds: number }>;
    };
    recentTopics: Array<{ lessonId: string; courseId: string | null; title: string; lastActivityAt: number }>;
    sessionDurationTrend: Array<{
      sessionId: string;
      courseId: string | null;
      lessonId: string;
      completedAt: number;
      recordedSeconds: number;
    }>;
    evidencePolicy: "factual_analytics_only";
  };
};

export type CourseSection = "overview" | "lessons" | "homework" | "analytics";
export type CoursePathLessonState = "completed" | "current" | "available" | "planned";

export type CoursePathLesson = LearningBlueprintLesson & {
  state: CoursePathLessonState;
  lessonRevision: number | null;
  demonstratedCheckpoints: number;
  requiredCheckpoints: number;
};

export type LessonContentItem = {
  id: string;
  label: string;
  kind: "section" | "example" | "exercises" | "checkpoints" | "homework" | "sources";
};

export type LocatedCourseLesson = {
  module: CoursePathModule;
  lesson: CoursePathLesson;
  snapshot: LearningLessonSnapshot | null;
};

export type CoursePathModule = Omit<LearningBlueprintModule, "lessons"> & {
  lessons: CoursePathLesson[];
  completedLessons: number;
};

export function selectLearningCourse(payload: LearnPayload, courseId?: string) {
  if (courseId) return payload.workspace.courses.find((course) => course.course.courseId === courseId) ?? null;
  return payload.workspace.courses.find((course) => course.course.state === "active")
    ?? payload.workspace.courses[0]
    ?? null;
}

export function selectQuickStudy(payload: LearnPayload, lessonId?: string) {
  if (lessonId) {
    return payload.workspace.quickStudies.find((study) => study.lesson.lessonId === lessonId) ?? null;
  }
  return payload.workspace.quickStudies.find((study) => study.lesson.state === "active")
    ?? payload.workspace.quickStudies[0]
    ?? null;
}

export function courseModulePath(payload: LearnPayload, course: LearningCourseProjection): CoursePathModule[] {
  const lessonById = new Map(course.lessons.map((lesson) => [lesson.lessonId, lesson]));
  const checkpointById = new Map(payload.evidence.checkpointStates.map((checkpoint) => (
    [`${checkpoint.lessonId}:${checkpoint.checkpointId}`, checkpoint]
  )));
  return [...(course.blueprint?.modules ?? [])].sort((left, right) => left.order - right.order).map((pathModule) => {
    const lessons = [...pathModule.lessons].sort((left, right) => left.order - right.order).map((outline) => {
      const lesson = lessonById.get(outline.lessonId);
      const checkpoints = lesson?.current?.checkpoints.filter((checkpoint) => checkpoint.required) ?? [];
      const demonstratedCheckpoints = checkpoints.filter((checkpoint) => (
        checkpointById.get(`${outline.lessonId}:${checkpoint.checkpointId}`)?.status === "demonstrated"
      )).length;
      const state = lesson?.state === "completed"
        ? "completed" as const
        : course.enrollment?.currentLessonId === outline.lessonId
          ? "current" as const
            : lesson
            ? "available" as const
            : "planned" as const;
      return {
        ...outline,
        state,
        lessonRevision: lesson?.current?.revision ?? null,
        demonstratedCheckpoints,
        requiredCheckpoints: checkpoints.length,
      };
    });
    return {
      ...pathModule,
      lessons,
      completedLessons: lessons.filter((lesson) => lesson.state === "completed").length,
    };
  });
}

export function selectCurrentLesson(course: LearningCourseProjection) {
  const currentId = course.enrollment?.currentLessonId;
  return currentId ? course.lessons.find((lesson) => lesson.lessonId === currentId) ?? null : null;
}

export function selectActiveLearningSession(payload: LearnPayload, lessonId?: string) {
  const candidates = payload.sessions.filter((projection) => (
    projection.session.state !== "completed" && (!lessonId || projection.session.lessonId === lessonId)
  ));
  return candidates.find((projection) => projection.session.state === "running")
    ?? candidates.find((projection) => projection.session.state === "paused")
    ?? candidates.find((projection) => projection.session.state === "planned")
    ?? null;
}

export function learningHistory(payload: LearnPayload) {
  return payload.sessions.filter((projection) => projection.session.state === "completed")
    .sort((left, right) => (right.session.completedAt ?? 0) - (left.session.completedAt ?? 0));
}

export function flattenCourseLessons(path: CoursePathModule[]) {
  return path.flatMap((pathModule) => pathModule.lessons);
}

export function locateCourseLesson(payload: LearnPayload, course: LearningCourseProjection, lessonId?: string | null): LocatedCourseLesson | null {
  if (!lessonId) return null;
  const snapshot = course.lessons.find((lesson) => lesson.lessonId === lessonId)?.current ?? null;
  for (const pathModule of courseModulePath(payload, course)) {
    const lesson = pathModule.lessons.find((item) => item.lessonId === lessonId);
    if (lesson) return { module: pathModule, lesson, snapshot };
  }
  return null;
}

export function adjacentCourseLessons(path: CoursePathModule[], lessonId?: string | null) {
  const lessons = flattenCourseLessons(path);
  const index = lessons.findIndex((lesson) => lesson.lessonId === lessonId);
  return {
    previous: index > 0 ? lessons[index - 1] : null,
    next: index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : null,
  };
}

export function defaultCourseLessonId(payload: LearnPayload, course: LearningCourseProjection) {
  return course.enrollment?.currentLessonId
    ?? flattenCourseLessons(courseModulePath(payload, course))[0]?.lessonId
    ?? null;
}

export function parseCourseSection(value: string | null | undefined): CourseSection | null {
  return value === "overview" || value === "lessons" || value === "homework" || value === "analytics" ? value : null;
}

export function lessonContentItems(lesson: LearningLessonSnapshot): LessonContentItem[] {
  return [
    ...lesson.sections.map((section) => ({ id: `section-${section.sectionId}`, label: section.heading, kind: "section" as const })),
    ...lesson.examples.map((example) => ({ id: `example-${example.exampleId}`, label: example.title, kind: "example" as const })),
    ...(lesson.exercises.length ? [{ id: "exercises", label: "Exercises", kind: "exercises" as const }] : []),
    ...(lesson.checkpoints.length ? [{ id: "checkpoints", label: "Checkpoints", kind: "checkpoints" as const }] : []),
    ...(lesson.homework.length ? [{ id: "homework", label: "Homework", kind: "homework" as const }] : []),
    ...(lesson.sourcePins.length ? [{ id: "sources", label: "Exact sources", kind: "sources" as const }] : []),
  ];
}

export function courseProgress(payload: LearnPayload, course: LearningCourseProjection) {
  const path = flattenCourseLessons(courseModulePath(payload, course));
  const required = path.reduce((sum, lesson) => sum + lesson.requiredCheckpoints, 0);
  const demonstrated = path.reduce((sum, lesson) => sum + lesson.demonstratedCheckpoints, 0);
  return {
    writtenLessons: course.lessons.length,
    totalLessons: path.length,
    completedLessons: path.filter((lesson) => lesson.state === "completed").length,
    requiredCheckpoints: required,
    demonstratedCheckpoints: demonstrated,
  };
}

export function nextCourseAction(payload: LearnPayload, course: LearningCourseProjection) {
  const current = locateCourseLesson(payload, course, course.enrollment?.currentLessonId);
  if (!course.enrollment) return "Review the Blueprint, then enroll from the Learning Specialist.";
  if (!current) return "Open Lessons and pick up the Module path.";
  if (!current.snapshot) return `Ask the Learning Specialist to write ${current.lesson.title}.`;
  return `Continue ${current.lesson.title}.`;
}

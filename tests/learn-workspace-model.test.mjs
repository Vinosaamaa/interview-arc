import assert from "node:assert/strict";
import test from "node:test";

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
} from "../app/learn-workspace-model.ts";

const lessonSnapshot = (lessonId, title, revision = 1) => ({
  lessonId,
  state: "active",
  title,
  objective: `Understand ${title}.`,
  prerequisites: [],
  sections: [{ sectionId: `${lessonId}-section`, heading: "Boundary", body: "Public-safe fixture." }],
  examples: [],
  exercises: [],
  homework: [],
  checkpoints: [{ checkpointId: `${lessonId}-checkpoint`, label: "Explain it", description: "Explain the boundary.", required: true }],
  sourcePins: [],
  revision,
  createdAt: 1,
});

const payload = {
  workspace: {
    courses: [{
      course: { courseId: "course-architecture", currentBlueprintRevision: 2, state: "active", title: "Architecture", createdAt: 1, updatedAt: 2 },
      blueprint: {
        courseId: "course-architecture",
        state: "active",
        title: "Architecture",
        goal: "Trace one request.",
        priorKnowledge: [],
        intendedOutcome: "Explain ownership.",
        sourcePins: [],
        revision: 1,
        createdAt: 1,
        modules: [{
          moduleId: "runtime",
          title: "Runtime",
          order: 0,
          objective: "Trace runtime boundaries.",
          lessons: [
            { lessonId: "request-path", title: "Request path", order: 0, kind: "lesson", objective: "Trace it.", prerequisites: [] },
            { lessonId: "retry-boundary", title: "Retry boundary", order: 1, kind: "lab", objective: "Retry it.", prerequisites: ["request-path"] },
            { lessonId: "release-readback", title: "Release readback", order: 2, kind: "lab", objective: "Verify it.", prerequisites: ["retry-boundary"] },
          ],
        }],
      },
      enrollment: { enrollmentId: "enrollment-architecture", blueprintRevision: 1, state: "active", currentModuleId: "runtime", currentLessonId: "retry-boundary", revision: 2, enrolledAt: 1, completedAt: null },
      lessons: [
        { lessonId: "request-path", moduleId: "runtime", currentRevision: 2, state: "completed", title: "Request path", updatedAt: 2, current: { ...lessonSnapshot("request-path", "Request path", 2), state: "completed" } },
        { lessonId: "retry-boundary", moduleId: "runtime", currentRevision: 1, state: "active", title: "Retry boundary", updatedAt: 3, current: lessonSnapshot("retry-boundary", "Retry boundary") },
      ],
    }],
    quickStudies: [],
    facts: {},
    truncated: false,
  },
  sessions: [
    { session: { sessionId: "session-complete", scopeType: "course", courseId: "course-architecture", lessonId: "request-path", lessonRevision: 1, state: "completed", accumulatedSeconds: 120, runningSince: null, completedAt: 20, revision: 2, transcriptRevision: 1, finalizationRevision: 1, updatedAt: 20 }, intervals: [], turns: [], evidencePolicy: "transcript_only" },
    { session: { sessionId: "session-current", scopeType: "course", courseId: "course-architecture", lessonId: "retry-boundary", lessonRevision: 1, state: "paused", accumulatedSeconds: 60, runningSince: null, completedAt: null, revision: 2, transcriptRevision: 0, finalizationRevision: 0, updatedAt: 30 }, intervals: [], turns: [], evidencePolicy: "transcript_only" },
  ],
  evidence: {
    checkpointStates: [
      { lessonId: "request-path", checkpointId: "request-path-checkpoint", currentRevision: 1, status: "demonstrated", updatedAt: 20 },
      { lessonId: "retry-boundary", checkpointId: "retry-boundary-checkpoint", currentRevision: 1, status: "needs_another_pass", updatedAt: 30 },
    ],
    checkpointHistory: [], homework: [], homeworkHistory: [], artifacts: [], finalizations: [],
  },
  journey: { events: [], truncated: false, evidencePolicy: "factual_events_only" },
  analytics: { courses: [], overall: {}, time: {}, recentTopics: [], sessionDurationTrend: [], evidencePolicy: "factual_analytics_only" },
};

test("the Learn workspace model preserves pinned curriculum order and factual progress", () => {
  const course = selectLearningCourse(payload);
  assert.equal(course.blueprint.revision, 1);
  assert.equal(course.course.currentBlueprintRevision, 2);
  assert.equal(selectCurrentLesson(course).lessonId, "retry-boundary");
  const path = courseModulePath(payload, course);
  assert.deepEqual(path[0].lessons.map((lesson) => lesson.state), ["completed", "current", "planned"]);
  assert.equal(path[0].completedLessons, 1);
  assert.equal(path[0].lessons[0].demonstratedCheckpoints, 1);
  assert.equal(path[0].lessons[1].demonstratedCheckpoints, 0);
});

test("the Learn workspace model selects active and completed Session history without inference", () => {
  assert.equal(selectActiveLearningSession(payload, "retry-boundary").session.sessionId, "session-current");
  assert.deepEqual(learningHistory(payload).map((entry) => entry.session.sessionId), ["session-complete"]);
});

test("Quick Study remains a revisitable Current lesson without fabricating a Course", () => {
  const quickStudy = {
    lesson: {
      lessonId: "quick-study-retries",
      scopeType: "quick_study",
      courseId: null,
      enrollmentId: null,
      moduleId: null,
      currentRevision: 1,
      state: "active",
      title: "Retry boundaries",
      createdAt: 4,
      updatedAt: 5,
    },
    current: lessonSnapshot("quick-study-retries", "Retry boundaries"),
  };
  const quickPayload = {
    ...payload,
    workspace: { ...payload.workspace, quickStudies: [quickStudy] },
  };

  assert.equal(selectQuickStudy(quickPayload).lesson.lessonId, "quick-study-retries");
  assert.equal(selectQuickStudy(quickPayload, "missing"), null);
  assert.equal(selectQuickStudy(quickPayload).lesson.courseId, null);
});

test("Lesson selection helpers preserve Enrollment current while browsing Planned and written Lessons", () => {
  const course = selectLearningCourse(payload);
  const path = courseModulePath(payload, course);
  const currentId = defaultCourseLessonId(payload, course);
  assert.equal(currentId, "retry-boundary");
  assert.equal(selectCurrentLesson(course).lessonId, "retry-boundary");
  assert.deepEqual(flattenCourseLessons(path).map((lesson) => lesson.lessonId), ["request-path", "retry-boundary", "release-readback"]);
  const planned = locateCourseLesson(payload, course, "release-readback");
  assert.equal(planned.lesson.state, "planned");
  assert.equal(planned.snapshot, null);
  assert.equal(selectCurrentLesson(course).lessonId, "retry-boundary");
  const neighbors = adjacentCourseLessons(path, "retry-boundary");
  assert.equal(neighbors.previous.lessonId, "request-path");
  assert.equal(neighbors.next.state, "planned");
  const progress = courseProgress(payload, course);
  assert.equal(progress.writtenLessons, 2);
  assert.equal(progress.totalLessons, 3);
  assert.match(nextCourseAction(payload, course), /Continue Retry boundary/);
});

test("two Courses keep independent current Lessons and contents come from real structure", () => {
  const second = {
    ...payload.workspace.courses[0],
    course: { ...payload.workspace.courses[0].course, courseId: "course-spring", title: "Spring" },
    enrollment: { ...payload.workspace.courses[0].enrollment, enrollmentId: "enrollment-spring", currentLessonId: "request-path" },
  };
  const multi = { ...payload, workspace: { ...payload.workspace, courses: [...payload.workspace.courses, second] } };
  assert.equal(selectLearningCourse(multi, "course-architecture").enrollment.currentLessonId, "retry-boundary");
  assert.equal(selectLearningCourse(multi, "course-spring").enrollment.currentLessonId, "request-path");
  assert.equal(parseCourseSection("lessons"), "lessons");
  assert.equal(parseCourseSection("overview"), "overview");
  assert.equal(parseCourseSection("bogus"), null);
  const snapshot = selectCurrentLesson(selectLearningCourse(payload)).current;
  assert.deepEqual(lessonContentItems(snapshot).map((item) => item.kind), ["section", "checkpoints"]);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeUrl = new URL("../app/home-client.tsx", import.meta.url);
const workspaceUrl = new URL("../app/learn-workspace.tsx", import.meta.url);
const stylesUrl = new URL("../app/learn-workspace.css", import.meta.url);

test("Learn is an enabled workspace with the contracted local navigation", async () => {
  const home = await readFile(homeUrl, "utf8");

  assert.match(
    home,
    /<button type="button" className=\{activeWorkspace === "learn" \? "active" : ""\} aria-current=\{activeWorkspace === "learn" \? "page" : undefined\} onClick=\{\(\) => selectWorkspace\("learn"\)\}>Learn<\/button>/,
  );
  assert.doesNotMatch(home, /disabled title="Learn workspace/);
  assert.match(home, /\["today", "Today"\]/);
  assert.match(home, /\["courses", "Courses"\]/);
  assert.match(home, /\["history", "History"\]/);
  assert.match(home, /\["analytics", "Statistics"\]/);
  assert.match(home, /aria-label="Learn navigation"/);
  assert.match(home, /<LearnWorkspace destination=\{learnDestination\} openedFocus=\{learnCourseFocus\} onOpenCourses=\{\(focus\) => navigateToLearn\("courses", focus\)\}/);
});

test("the website remains a durable reading surface rather than a second tutor", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");

  assert.match(workspace, /MODULE PATH/);
  assert.match(workspace, /CURRENT LESSON/);
  assert.match(workspace, /Transcript-only Voice/);
  assert.match(workspace, /Finish with specialist/);
  assert.match(workspace, /Only observed Learning records are counted/);
  assert.match(workspace, /COURSE STATISTICS/);
  assert.match(workspace, /QUICK STUDY/);
  assert.match(workspace, /A standalone Current lesson with no Course or Enrollment overhead/);
  assert.match(workspace, /todayQuickStudy/);
  assert.match(workspace, /No required checkpoints/);
  assert.match(workspace, /operationIds\.current\.get/);
  assert.match(workspace, /response\.status >= 400 && response\.status < 500/);
  assert.match(workspace, /sessionAction: action/);
  assert.doesNotMatch(workspace, /<textarea|contentEditable|Send message|Ask the tutor/);
});

test("Today is a Session workbench and Courses keeps four distinct rooms", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");

  assert.match(workspace, /TODAY · SESSION WORKBENCH/);
  assert.match(workspace, /Open full lesson/);
  assert.match(workspace, /COURSE OVERVIEW/);
  assert.match(workspace, /id="learn-overview-title"/);
  assert.match(workspace, /id="learn-homework-title"/);
  assert.match(workspace, /id="learn-course-statistics-title"/);
  assert.doesNotMatch(workspace, /Return to current lesson/);
  assert.match(workspace, /BLUEPRINT CARD · NOT WRITTEN YET/);
  assert.match(workspace, /Enrolled · Blueprint r/);
  assert.match(workspace, /Open Lesson contents/);
  assert.match(workspace, /aria-label="On this Lesson"/);
  assert.match(workspace, /selectLessonWithoutMutatingEnrollment/);
  assert.match(workspace, /onOpenCourses/);
  assert.doesNotMatch(workspace, /learn-lesson-toc/);
  assert.doesNotMatch(workspace, /section="overview"/);
  assert.doesNotMatch(workspace, /pre-generate|generate every Lesson|generate all/i);
});

test("Learn preserves an explicit mobile reading switcher and accessibility safeguards", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(workspace, /aria-label="Course reading surface"/);
  assert.match(workspace, /aria-pressed=\{mobilePane === "path"\}/);
  assert.match(workspace, /aria-pressed=\{mobilePane === "lesson"\}/);
  assert.match(workspace, /aria-label="Today reading surface"/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.learn-mobile-pane-switcher,\s*\.learn-mobile-today-switcher \{[^}]*display: grid/s);
  assert.match(styles, /\.learn-course-section-lessons\.mobile-path \.learn-course-reader-pane/);
  assert.match(styles, /\.learn-today-body\.mobile-thread \.learn-today-summary/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Learn uses the approved 316 plus 1200 two-panel frame", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");
  const stageIndex = workspace.indexOf("className=\"learn-lesson-stage\"");
  const cardIndex = workspace.indexOf("<PlannedLessonCard");

  assert.match(styles, /\.active-workspace-learn \.page-content \{[^}]*max-width:\s*none[^}]*padding:\s*0 24px 80px/s);
  assert.match(styles, /\.learn-frame \{[^}]*max-width:\s*1536px[^}]*width:\s*100%/s);
  assert.match(workspace, /className=\{`learn-frame learn-hero learn-hero-\$\{destination\}`\}/);
  assert.match(styles, /\.learn-courses-layout \{[^}]*grid-template-columns:\s*minmax\(290px, 316px\) minmax\(0, 1200px\)/s);
  assert.match(styles, /\.learn-today-body \{[^}]*grid-template-columns:\s*minmax\(290px, 316px\) minmax\(0, 1200px\)/s);
  assert.match(styles, /\.learn-empty-layout,[\s\S]*?\.learn-history \{[^}]*grid-template-columns:\s*minmax\(290px, 316px\) minmax\(0, 1200px\)/s);
  assert.match(styles, /\.learn-analytics \{[^}]*grid-template-columns:\s*minmax\(290px, 316px\) minmax\(0, 1200px\)/s);
  assert.match(styles, /\.learn-course-nav \{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)[^}]*width:\s*100%/s);
  assert.match(workspace, /learn-courses-surface learn-frame/);
  assert.match(workspace, /learn-history learn-frame/);
  assert.match(workspace, /learn-analytics learn-frame/);
  assert.match(styles, /\.learn-today-summary \{[^}]*min-height:\s*540px/s);
  assert.doesNotMatch(styles, /\.learn-today-summary \{[^}]*100vh/s);
  assert.match(styles, /\.learn-lesson-stage \{[^}]*align-content:\s*start/s);
  assert.match(styles, /\.learn-lesson-stage \{[^}]*grid-auto-rows:\s*max-content/s);
  assert.doesNotMatch(workspace, /LessonNavigator|aria-label="Adjacent lessons"/);
  assert.doesNotMatch(styles, /\.learn-lesson-nav/);
  assert.ok(stageIndex >= 0 && cardIndex > stageIndex);
});

test("only Today renders the live Session timer", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const quickStudy = workspace.slice(workspace.indexOf("function QuickStudyWorkspace"), workspace.indexOf("function CourseIndex"));
  const courses = workspace.slice(workspace.indexOf("function CourseWorkspace"), workspace.indexOf("function CourseAnalytics"));
  const today = workspace.slice(workspace.indexOf("function TodayWorkbench"), workspace.indexOf("function HistoryView"));

  assert.doesNotMatch(quickStudy, /<SessionInstrument/);
  assert.doesNotMatch(courses, /<SessionInstrument/);
  assert.match(today, /<SessionInstrument/);
  assert.match(courses, /selectStartedLearningSession/);
  assert.doesNotMatch(courses, /selectActiveLearningSession/);
  assert.match(today, /learn-today-workbench learn-frame/);
  assert.match(workspace, /Elapsed time/);
  assert.match(workspace, /MODULE PLAN/);
  assert.match(workspace, /CURRENT LESSON · REVISION/);
});

test("Current thread keeps the Module outside the Lesson timeline", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const thread = workspace.slice(workspace.indexOf("function CurrentLearningThread"), workspace.indexOf("function TodayWorkbench"));
  const moduleIndex = thread.indexOf('className="learn-thread-module"');
  const pathIndex = thread.indexOf("<ol className={`learn-thread-path");

  assert.ok(moduleIndex >= 0 && pathIndex > moduleIndex);
  assert.doesNotMatch(thread.slice(pathIndex), /located\?\.module && <li/);
  assert.match(thread, /aria-label="Current and next Lessons"/);
});

test("each Course room supplies one contextual rail and Lessons uses a disclosure", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(workspace, /learn-course-section-overview[^\n]*\{courseIndex\}<CourseOverview/);
  assert.match(workspace, /learn-course-section-lessons[\s\S]*?<ModulePath/);
  assert.match(workspace, /learn-course-section-homework[^\n]*<HomeworkIndex/);
  assert.match(workspace, /learn-course-section-analytics[^\n]*<CourseScope/);
  assert.match(workspace, /<details className="learn-lesson-contents">/);
  assert.match(styles, /\.learn-lesson-reader \{\s*display:\s*block/s);
  assert.doesNotMatch(styles, /learn-lesson-toc/);
});

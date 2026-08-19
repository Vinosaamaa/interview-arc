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
  assert.match(workspace, /Return to current lesson/);
  assert.match(workspace, /BLUEPRINT CARD · NOT WRITTEN YET/);
  assert.match(workspace, /Enrolled · Blueprint r/);
  assert.match(workspace, /ON THIS LESSON/);
  assert.match(workspace, /selectLessonWithoutMutatingEnrollment/);
  assert.match(workspace, /onOpenCourses/);
  assert.doesNotMatch(workspace, /section="overview"/);
  assert.doesNotMatch(workspace, /pre-generate|generate every Lesson|generate all/i);
});

test("Learn preserves an explicit mobile reading switcher and accessibility safeguards", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(workspace, /aria-label="Course reading surface"/);
  assert.match(workspace, /aria-pressed=\{mobilePane === "path"\}/);
  assert.match(workspace, /aria-pressed=\{mobilePane === "lesson"\}/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.learn-mobile-pane-switcher \{[^}]*display: grid/s);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the Courses lesson pager stays a compact bar instead of stretching with the Module path", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");
  const stageIndex = workspace.indexOf("className=\"learn-lesson-stage\"");
  const cardIndex = workspace.indexOf("<PlannedLessonCard");
  const navIndex = workspace.indexOf("<LessonNavigator");

  assert.match(styles, /\.learn-course-spread \{[^}]*align-items:\s*start/s);
  assert.match(styles, /\.learn-lesson-stage \{[^}]*align-content:\s*start/s);
  assert.match(styles, /\.learn-lesson-stage \{[^}]*grid-auto-rows:\s*max-content/s);
  assert.match(styles, /\.learn-lesson-nav \{[^}]*align-items:\s*center/s);
  assert.match(styles, /\.learn-lesson-nav button \{[^}]*flex:\s*0 0 auto/s);
  assert.match(styles, /\.learn-lesson-nav button \{[^}]*height:\s*auto/s);
  assert.doesNotMatch(styles, /\.learn-lesson-nav button \{[^}]*flex:\s*1/s);
  assert.ok(stageIndex >= 0 && cardIndex > stageIndex && navIndex > cardIndex);
});

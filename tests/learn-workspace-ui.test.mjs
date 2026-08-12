import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeUrl = new URL("../app/home-client.tsx", import.meta.url);
const workspaceUrl = new URL("../app/learn-workspace.tsx", import.meta.url);
const stylesUrl = new URL("../app/learn-workspace.css", import.meta.url);

test("Learn is an enabled workspace with the contracted local navigation", async () => {
  const home = await readFile(homeUrl, "utf8");

  assert.match(home, /<strong>Learn<\/strong><\/button>/);
  assert.doesNotMatch(home, /disabled title="Learn workspace/);
  assert.match(home, /\["today", "Today"\]/);
  assert.match(home, /\["courses", "Courses"\]/);
  assert.match(home, /\["history", "History"\]/);
  assert.match(home, /\["analytics", "Analytics"\]/);
  assert.match(home, /aria-label="Learn navigation"/);
  assert.match(home, /<LearnWorkspace destination=\{learnDestination\}/);
});

test("the website remains a durable reading surface rather than a second tutor", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");

  assert.match(workspace, /MODULE PATH/);
  assert.match(workspace, /CURRENT LESSON/);
  assert.match(workspace, /Transcript-only Voice/);
  assert.match(workspace, /Finish with specialist/);
  assert.match(workspace, /Only observed Learning records are counted/);
  assert.match(workspace, /No required checkpoints/);
  assert.match(workspace, /operationIds\.current\.get/);
  assert.match(workspace, /sessionAction: action/);
  assert.doesNotMatch(workspace, /<textarea|contentEditable|Send message|Ask the tutor/);
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

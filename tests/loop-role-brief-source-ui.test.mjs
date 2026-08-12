import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the Loops UI opens one authenticated immutable job-description revision on demand", async () => {
  const [route, workspace, styles, publicRoute] = await Promise.all([
    readProjectFile("app/api/loops/role-brief-source/route.ts"),
    readProjectFile("app/loops-workspace.tsx"),
    readProjectFile("app/globals.css"),
    readProjectFile("app/api/loops/route.ts"),
  ]);

  assert.match(route, /resolveOwnerId\(request\)/);
  assert.match(route, /readLoopRoleBriefSource\(ownerId/);
  assert.match(route, /private, no-store/);
  assert.match(route, /x-content-type-options/);
  assert.doesNotMatch(publicRoute, /readLoopRoleBriefSource|privateSnapshot|jdText/);

  assert.match(workspace, /View full job description/);
  assert.match(workspace, /aria-expanded=\{showSource\}/);
  assert.match(workspace, /aria-controls=\{sourceRegionId\}/);
  assert.match(workspace, /Opening the immutable job description/);
  assert.match(workspace, /Open original posting/);
  assert.match(workspace, /controller\.abort\(\)/);
  assert.doesNotMatch(workspace, /dangerouslySetInnerHTML/);

  assert.match(styles, /\.loop-jd-document \{[^}]*overflow: auto/s);
  assert.match(styles, /\.loop-jd-access button:focus-visible/);
  assert.match(styles, /@media[^}]+[\s\S]*\.loop-jd-access, \.loop-jd-source > header/s);
});

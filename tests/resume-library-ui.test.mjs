import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Career Materials owns the authenticated Resume Library outside Behavioral Foundation", async () => {
  const [foundation, materials, home, css, route, importRoute, detailRoute, compareRoute] = await Promise.all([
    load("../app/behavioral-foundation.tsx"),
    load("../app/career-materials-workspace.tsx"),
    load("../app/home-client.tsx"),
    load("../app/globals.css"),
    load("../app/api/resume-library/route.ts"),
    load("../app/api/resume-imports/route.ts"),
    load("../app/api/resume-revisions/[resumeId]/[revisionId]/route.ts"),
    load("../app/api/resume-revisions/[resumeId]/compare/route.ts"),
  ]);
  assert.doesNotMatch(foundation, /ResumeLibrary|resume-library/);
  assert.match(home, /CareerMaterialsWorkspace/);
  assert.match(home, /Interview · Career Materials/);
  assert.match(home, /view === "materials"/);
  assert.match(materials, /\/api\/resume-library/);
  assert.match(materials, /\/api\/resume-revisions/);
  assert.match(materials, /\/api\/resume-imports/);
  assert.match(materials, /The exact import can be retried/);
  assert.match(materials, /href=\{file\.downloadPath\}/);
  assert.match(materials, /No résumé revision is stored yet/);
  assert.match(materials, /No newer or neighboring revision was substituted/);
  assert.match(route, /resumeLibrarySchema\.parse\(await getResumeLibrary\(ownerId\)\)/);
  assert.match(route, /private, no-store/);
  assert.match(importRoute, /getRecentResumeImports\(ownerId\)/);
  assert.match(importRoute, /private, no-store/);
  assert.match(detailRoute, /resolveOwnerId\(request\)/);
  assert.match(detailRoute, /resumeRevisionResponseSchema\.parse\(result\)/);
  assert.match(compareRoute, /compareResumeRevisions/);
  assert.match(compareRoute, /resumeRevisionComparisonSchema\.parse\(result\)/);
  assert.match(css, /\.materials-library-layout \{[^}]*grid-template-columns:/s);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.materials-library-layout \{[^}]*grid-template-columns: 1fr/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("private resume downloads resolve owner identity and never accept a storage locator", async () => {
  const [route, download] = await Promise.all([
    load("../app/api/resume-library/[resumeId]/[revisionId]/[format]/route.ts"),
    load("../mcp-worker/resume-library-download.ts"),
  ]);
  assert.match(route, /resolveOwnerId\(request\)/);
  assert.match(download, /readResumeRevisionFile\(ownerId, resumeId, revisionId, typedFormat\)/);
  assert.match(download, /privateResumeObjectKey/);
  assert.match(download, /cache-control": "private, no-store/);
  assert.doesNotMatch(download, /searchParams|get\("objectKey"\)|request\.json/);
});

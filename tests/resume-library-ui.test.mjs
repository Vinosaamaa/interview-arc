import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Behavioral Foundation exposes a lazy default-collapsed Resume Library", async () => {
  const [foundation, library, css, route] = await Promise.all([
    load("../app/behavioral-foundation.tsx"),
    load("../app/resume-library.tsx"),
    load("../app/globals.css"),
    load("../app/api/resume-library/route.ts"),
  ]);
  assert.match(foundation, /<ResumeLibrary enabled=\{enabled\}/);
  assert.match(library, /useState\(false\)/);
  assert.match(library, /aria-expanded=\{open\}/);
  assert.match(library, /inert=\{open \? undefined : true\}/);
  assert.match(library, /if \(!enabled \|\| !open/);
  assert.match(library, /href=\{file\.downloadPath\}/);
  assert.match(route, /resumeLibrarySchema\.parse\(await getResumeLibrary\(ownerId\)\)/);
  assert.match(route, /private, no-store/);
  assert.match(css, /\.resume-library-panel \{[^}]*grid-template-rows: 0fr/s);
  assert.match(css, /\.resume-library\.open \.resume-library-panel \{[^}]*grid-template-rows: 1fr/s);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.resume-file-actions a \{[^}]*min-height: 44px/);
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

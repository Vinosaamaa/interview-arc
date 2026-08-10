import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Bank reader close clears only the top-level remembered reader", async () => {
  const source = await load("../app/home-client.tsx");
  assert.match(source, /if \(routeView === "banks"\) \{\s*window\.sessionStorage\.removeItem\("interview-arc-selected-bank"\)/);
  assert.match(source, /setListRestoring\("banks"\);\s*window\.sessionStorage\.removeItem\("interview-arc-selected-bank"\);\s*setSelectedProblem\(null\)/);
  assert.match(source, /if \(bankState\?\.attemptId\) \{\s*setBankNestedEntry\(null\)/);
  assert.match(source, /window\.sessionStorage\.getItem\("interview-arc-selected-bank"\)/);
});

test("Bank specialty desks are collapsed, lazy, animated, and reader-safe", async () => {
  const [source, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/interview-arc-v2.css"),
  ]);
  assert.match(source, /useState<ActivityType \| null>\(null\)/);
  assert.match(source, /aria-expanded=\{expandedBankDesk === type\}/);
  assert.match(source, /enabled=\{open\}/);
  assert.match(source, /inert=\{open \? undefined : true\}/);
  assert.match(css, /\.bank-domain-desk-shell \{[^}]*grid-template-rows: 0fr/);
  assert.match(css, /\.bank-domain-desk-shell\.open \{[^}]*grid-template-rows: 1fr/);
  assert.match(css, /\.banks-page\.has-open-solution > \.bank-domain-desks \{ display: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.bank-domain-desk-shell \{ transition: none; \}/);
});

test("Journey heatmap uses a balanced command rail and elastic 53-week grid", async () => {
  const [source, globals] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/globals.css"),
  ]);
  assert.match(source, /className="heatmap-command-bar"/);
  assert.match(globals, /\.practice-heatmap \{[^}]*width: 100%;[^}]*grid-template-columns: repeat\(53, minmax\(12px, 1fr\)\)/);
  assert.match(globals, /\.heat-day \{[^}]*width: 100%;[^}]*aspect-ratio: 1/);
  assert.match(globals, /\.heatmap-command-bar \{[^}]*justify-content: space-between/);
  assert.doesNotMatch(globals, /\.practice-heatmap \{[^}]*width: max-content/);
});

test("Review Queue keeps filters in the menu, branches each row, and joins its folio", async () => {
  const [source, css] = await Promise.all([
    load("../app/review-queue-view.tsx"),
    load("../app/review-queue.css"),
  ]);
  assert.doesNotMatch(source, /review-specialty-rail/);
  assert.match(source, />All<\/button>\{SPECIALTIES/);
  assert.match(css, /\.review-row::before/);
  assert.match(css, /\.review-row::after/);
  assert.match(css, /\.review-selection-folio \{[^}]*position: relative;[^}]*bottom: auto/);
  assert.doesNotMatch(css, /\.review-selection-folio \{[^}]*position: sticky/);
  assert.doesNotMatch(css, /\.review-selection-folio \{[^}]*bottom: 78px/);
});

test("responsive shell switches directly to the mobile dock and keeps one topbar row", async () => {
  const [source, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/interview-arc-v2.css"),
  ]);
  assert.match(source, /<div><span>\{readableDate\(journal\.date\)\}<\/span><\/div>/);
  assert.doesNotMatch(source, /"Statistics" : view === "reviews"/);
  assert.match(css, /\.brand-mark \{[^}]*url\("\/favicon\.svg"\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.sidebar \{ position: fixed; inset: auto 10px 10px/);
  assert.match(css, /\.topbar > div:last-child \{[^}]*flex-wrap: nowrap/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.topbar \.secondary-action \{[^}]*display: inline-flex/);
});

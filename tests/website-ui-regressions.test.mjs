import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

function parseTsx(source) {
  return ts.createSourceFile("subject.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function visit(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node);
  node.forEachChild((child) => {
    visit(child, predicate, matches);
  });
  return matches;
}

function functionNamed(file, name) {
  return visit(file, (node) => (
    ts.isFunctionDeclaration(node) && node.name?.text === name
  ) || (
    ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
      && node.initializer !== undefined
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  )).map((node) => ts.isVariableDeclaration(node) ? node.initializer : node)[0];
}

function storageCalls(node, method, key) {
  return visit(node, (candidate) => {
    if (!ts.isCallExpression(candidate) || !ts.isPropertyAccessExpression(candidate.expression)) return false;
    const argument = candidate.arguments[0];
    return candidate.expression.name.text === method && Boolean(argument && ts.isStringLiteral(argument) && argument.text === key);
  });
}

function hasJsxAttribute(file, attributeName, valueIncludes) {
  return visit(file, (node) => ts.isJsxAttribute(node)
    && node.name.getText(file) === attributeName
    && node.initializer?.getText(file).includes(valueIncludes)).length > 0;
}

function hasJsxClass(file, token) {
  return hasJsxAttribute(file, "className", token);
}

function stringLiterals(file) {
  return new Set(visit(file, (node) => ts.isStringLiteralLike(node)).map((node) => node.text));
}

function parseCss(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const walk = (start, end, ancestors) => {
    let cursor = start;
    while (cursor < end) {
      const open = source.indexOf("{", cursor);
      if (open < 0 || open >= end) return;
      const prelude = source.slice(cursor, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < end && depth > 0) {
        if (source[close] === "{") depth += 1;
        if (source[close] === "}") depth -= 1;
        close += 1;
      }
      const bodyStart = open + 1;
      const bodyEnd = close - 1;
      if (prelude.startsWith("@")) walk(bodyStart, bodyEnd, [...ancestors, prelude]);
      else {
        const declarations = Object.fromEntries(source.slice(bodyStart, bodyEnd).split(";").flatMap((entry) => {
          const colon = entry.indexOf(":");
          return colon < 0 ? [] : [[entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()]];
        }));
        rules.push({ selectors: prelude.split(",").map((selector) => selector.trim()), declarations, ancestors });
      }
      cursor = close;
    }
  };
  walk(0, source.length, []);
  return rules;
}

function cssRules(rules, selector, media = "") {
  return rules.filter((rule) => rule.selectors.includes(selector)
    && (!media || rule.ancestors.some((ancestor) => ancestor.includes(media))));
}

function selectorHasClass(selector, className) {
  return new RegExp(`(^|[\\s>+~])\\.${className}(?:$|[^a-zA-Z0-9_-])`).test(` ${selector.trim()}`);
}

function parsePx(value) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value ?? "").trim());
  return match ? Number(match[1]) : null;
}

function spacingFromShorthand(value, side) {
  if (!value) return null;
  const lengths = String(value).trim().split(/\s+/).map(parsePx);
  if (lengths.some((entry) => entry == null)) return null;
  if (lengths.length === 1) return lengths[0];
  if (lengths.length === 2) return side === "top" || side === "bottom" ? lengths[0] : lengths[1];
  if (lengths.length === 3) return side === "top" ? lengths[0] : side === "bottom" ? lengths[2] : lengths[1];
  return { top: lengths[0], right: lengths[1], bottom: lengths[2], left: lengths[3] }[side];
}

function horizontalPadding(declarations) {
  return (parsePx(declarations["padding-left"]) ?? spacingFromShorthand(declarations.padding, "left") ?? 0)
    + (parsePx(declarations["padding-right"]) ?? spacingFromShorthand(declarations.padding, "right") ?? 0);
}

function usedBorderBoxWidth(declarations, intrinsicContentPx) {
  const width = parsePx(declarations.width);
  if (width != null) return width;
  const minWidth = parsePx(declarations["min-width"]) ?? 0;
  return Math.max(minWidth, intrinsicContentPx + horizontalPadding(declarations));
}

function cascadeAtmosphere(rules, mode, mediaQuery = null) {
  const declarations = {};
  for (const rule of rules) {
    const queryAncestors = rule.ancestors.filter((ancestor) => ancestor.startsWith("@media") || ancestor.startsWith("@container"));
    if (mediaQuery) {
      if (queryAncestors.length && !queryAncestors.some((ancestor) => ancestor.includes(mediaQuery))) continue;
    } else if (queryAncestors.length) {
      continue;
    }
    for (const selector of rule.selectors) {
      if (!selectorHasClass(selector, "atmosphere-toggle") || selectorHasClass(selector, "atmosphere-toggle-label")) continue;
      const isActive = /\.atmosphere-toggle\.active(?:$|[^a-zA-Z0-9_-])/.test(selector);
      const isInactive = selector.includes(":not(.active)");
      if (isActive && mode === "off") continue;
      if (isInactive && mode !== "off") continue;
      Object.assign(declarations, rule.declarations);
    }
  }
  return declarations;
}

async function loadResponsiveShell() {
  const [source, globals, css, atmosphere] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/globals.css"),
    load("../app/interview-arc-v2.css"),
    load("../app/workspace-atmosphere.css"),
  ]);
  return {
    source,
    file: parseTsx(source),
    rules: parseCss(`${globals}\n${css}\n${atmosphere}`),
  };
}

test("Bank reader close clears only the top-level remembered reader", async () => {
  const file = parseTsx(await load("../app/home-client.tsx"));
  const close = functionNamed(file, "closeReaderPanel");
  const restore = functionNamed(file, "restoreWorkspaceLocation");
  assert.ok(close);
  assert.ok(restore);
  assert.equal(storageCalls(close, "removeItem", "interview-arc-selected-bank").length, 2);
  assert.equal(storageCalls(restore, "removeItem", "interview-arc-selected-bank").length, 2);
  assert.equal(storageCalls(file, "getItem", "interview-arc-selected-bank").length, 1);
  const bankClose = visit(close, (node) => ts.isIfStatement(node) && node.expression.getText(file).includes('view === "banks"'))[0];
  const statements = ts.isBlock(bankClose?.thenStatement) ? bankClose.thenStatement.statements : [];
  const nestedReturn = statements.findIndex((statement) => statement.getText(file).includes("bankState?.attemptId"));
  const memoryClear = statements.findIndex((statement) => storageCalls(statement, "removeItem", "interview-arc-selected-bank").length > 0);
  assert.ok(nestedReturn >= 0 && memoryClear > nestedReturn);
});

test("Bank specialty desks are collapsed, lazy, animated, and reader-safe", async () => {
  const [source, css] = await Promise.all([load("../app/home-client.tsx"), load("../app/interview-arc-v2.css")]);
  const file = parseTsx(source);
  const rules = parseCss(css);
  assert.ok(hasJsxClass(file, "bank-domain-desks"));
  assert.ok(hasJsxAttribute(file, "aria-expanded", "expandedBankDesk === type"));
  assert.ok(hasJsxAttribute(file, "enabled", "open"));
  assert.ok(hasJsxAttribute(file, "key", 'open ? "open" : "closed"'));
  assert.ok(hasJsxAttribute(file, "inert", "open ? undefined : true"));
  assert.equal(cssRules(rules, ".bank-domain-desk-shell")[0].declarations["grid-template-rows"], "0fr");
  assert.equal(cssRules(rules, ".bank-domain-desk-shell.open")[0].declarations["grid-template-rows"], "1fr");
  assert.equal(cssRules(rules, ".banks-page.has-open-solution > .bank-domain-desks")[0].declarations.display, "none");
  assert.equal(cssRules(rules, ".bank-domain-desk-shell", "prefers-reduced-motion")[0].declarations.transition, "none");
});

test("Journey heatmap uses a balanced command rail and elastic 53-week grid", async () => {
  const [source, css] = await Promise.all([load("../app/home-client.tsx"), load("../app/globals.css")]);
  const file = parseTsx(source);
  const rules = parseCss(css);
  assert.ok(hasJsxClass(file, "heatmap-command-bar"));
  const heatmap = cssRules(rules, ".practice-heatmap")[0].declarations;
  assert.equal(heatmap.width, "100%");
  assert.equal(heatmap["grid-template-columns"], "repeat(53, minmax(12px, 1fr))");
  assert.notEqual(heatmap.width, "max-content");
  assert.equal(cssRules(rules, ".heat-day")[0].declarations["aspect-ratio"], "1");
  assert.equal(cssRules(rules, ".heatmap-command-bar")[0].declarations["justify-content"], "space-between");
});

test("Journey Loop facts reserve their final geometry while D1 is loading", async () => {
  const css = await load("../app/loops-redesign.css");
  const rules = parseCss(css);
  const loading = cssRules(rules, ".loop-journey-facts.loading")[0]?.declarations ?? {};
  assert.equal(loading["min-height"], "294px");
  assert.equal(loading.padding, "26px");
  assert.equal(loading.display, "block");
});

test("Loop preparation opens a listless Loop-owned modal reader", async () => {
  const [source, loopsSource, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/loops-workspace.tsx"),
    load("../app/interview-arc-v2.css"),
  ]);
  const file = parseTsx(source);
  const rules = parseCss(css);
  const openLoopActivity = functionNamed(file, "openLoopActivity");
  const renderLoops = functionNamed(file, "renderLoops");
  assert.ok(openLoopActivity);
  assert.ok(renderLoops);
  assert.match(openLoopActivity.getText(file), /loopReaderHref/);
  assert.doesNotMatch(openLoopActivity.getText(file), /openPastEntry|transitionToView\("library"\)/);
  assert.match(renderLoops.getText(file), /ModalReaderPane/);
  assert.match(renderLoops.getText(file), /loops-reader-base/);
  assert.match(renderLoops.getText(file), /inert/);
  assert.match(renderLoops.getText(file), /readerVisible/);
  assert.match(renderLoops.getText(file), /arrivalState === "entered" && readerOpen/);
  assert.match(source, /className="interview-loops-surface"/);
  assert.match(source, /hidden=\{view !== "loops"\}/);
  assert.match(source, /loopsSurfaceReady/);
  assert.doesNotMatch(source, /view === "loops" && renderLoops\(\)/);
  assert.match(loopsSource, /requestedLoopMissing/);
  assert.match(loopsSource, /That Loop is unavailable\./);
  assert.match(loopsSource, /response\.text\(\)/);
  assert.match(loopsSource, /parseLoopPayloadResponse/);
  assert.match(loopsSource, /LOOP_PAYLOAD_TIMEOUT_MS = 12_000/);
  assert.match(loopsSource, /error && !payload/);
  assert.doesNotMatch(loopsSource, /loops\.find\(\(loop\) => loop\.loop\.loopId === selectedLoopId\) \?\? loops\[0\]/);
  assert.equal(cssRules(rules, ".interview-loops-surface[hidden]")[0]?.declarations.display, "none !important");
  assert.equal(cssRules(rules, ".loops-reader-workspace.has-open-reader::before")[0]?.declarations.position, "fixed");
  assert.equal(cssRules(rules, ".loops-reader-workspace.has-open-reader::before")[0]?.declarations.background, "var(--canvas)");
});

test("Loop job-description dossier has one continuous opaque scroll surface", async () => {
  const css = await load("../app/loops-redesign.css");
  const rules = parseCss(css);
  assert.equal(cssRules(rules, ".loop-jd-dialog")[0]?.declarations.isolation, "isolate");
  assert.equal(cssRules(rules, ".loop-jd-dialog-header")[0]?.declarations.position, "relative");
  assert.equal(cssRules(rules, ".loop-jd-dialog-body")[0]?.declarations.padding, "0 18px 18px");
  assert.equal(cssRules(rules, ".loop-jd-dialog-body")[0]?.declarations["overscroll-behavior"], "contain");
});

test("closed Problem Banks dedicate the remaining desktop viewport to their internal list", async () => {
  const [source, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/interview-arc-v2.css"),
  ]);
  const rules = parseCss(css);
  const page = ".banks-page.bounded-list";
  const pane = `${page} .bank-master-pane`;
  const list = `${page} .problem-bank-list`;
  assert.equal(cssRules(rules, page, "min-width: 901px")[0]?.declarations.height, "calc(100dvh - 117px)");
  assert.equal(cssRules(rules, pane, "min-width: 901px")[0]?.declarations["grid-template-rows"], "auto minmax(0, 1fr)");
  assert.equal(cssRules(rules, list, "min-width: 901px")[0]?.declarations.height, "auto");
  assert.equal(cssRules(rules, list, "min-width: 901px")[0]?.declarations["max-height"], "none");
  assert.match(source, /!selectedProblem && !expandedBankDesk \? "bounded-list"/);
});

test("each released Interview workspace carries its accent into major body surfaces", async () => {
  const css = await load("../app/interview-page-hero.css");
  const rules = parseCss(css);
  const expected = [
    ".app-shell.active-view-today .orchestrator-rail",
    ".app-shell.active-view-library .past-master-pane",
    ".app-shell.active-view-banks .problem-bank-list",
    ".app-shell.active-view-journey .chart-sheet",
    ".app-shell.active-view-materials .materials-revision",
  ];
  expected.forEach((selector) => {
    const declarations = cssRules(rules, selector)[0]?.declarations ?? {};
    assert.match(declarations["border-color"] ?? "", /--page-accent/);
    assert.match(declarations.background ?? "", /--page-accent-soft/);
  });
});

test("workspace atmospheres keep shared geometry while destinations own distinct accents", async () => {
  const [homeSource, pageSource, layoutSource, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/page.tsx"),
    load("../app/layout.tsx"),
    load("../app/workspace-atmosphere.css"),
  ]);
  const rules = parseCss(css);
  assert.match(homeSource, /active-destination-/);
  assert.match(homeSource, /ENGINEERING_NAV_ITEMS\.map\(\(\[id, label\], index\)/);
  assert.match(homeSource, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(pageSource, /initialLocation/);
  assert.match(layoutSource, /workspace-atmosphere\.css/);

  [
    ".app-shell",
    ".app-shell.active-workspace-learn",
    ".app-shell.active-workspace-engineering",
  ].forEach((selector) => {
    const declarations = cssRules(rules, selector)[0]?.declarations ?? {};
    assert.ok(declarations["--workspace-sidebar-surface"]);
    assert.ok(declarations["--workspace-sidebar-ink"]);
    assert.ok(declarations["--workspace-focus"]);
  });

  const sharedTokens = cssRules(rules, ".app-shell")[0]?.declarations ?? {};
  assert.doesNotMatch(sharedTokens["--destination-accent"] ?? "", /--page-accent/);
  assert.equal(
    cssRules(rules, ".app-shell.active-workspace-learn")[0]?.declarations["--page-accent"],
    undefined,
  );

  [
    ".app-shell.active-workspace-learn.active-destination-today",
    ".app-shell.active-workspace-learn.active-destination-courses",
    ".app-shell.active-workspace-learn.active-destination-history",
    ".app-shell.active-workspace-learn.active-destination-analytics",
    ".app-shell.active-workspace-engineering.active-destination-journal",
    ".app-shell.active-workspace-engineering.active-destination-capabilities",
    ".app-shell.active-workspace-engineering.active-destination-decisions",
    ".app-shell.active-workspace-engineering.active-destination-incidents",
    ".app-shell.active-workspace-engineering.active-destination-case-studies",
    ".app-shell.active-workspace-engineering.active-destination-statistics",
  ].forEach((selector) => {
    const declarations = cssRules(rules, selector)[0]?.declarations ?? {};
    assert.ok(declarations["--destination-accent"]);
    assert.ok(declarations["--destination-accent-soft"]);
  });

  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Review Queue keeps filters in the menu, branches each row, and joins its folio", async () => {
  const [source, css] = await Promise.all([load("../app/review-queue-view.tsx"), load("../app/review-queue.css")]);
  const file = parseTsx(source);
  const literals = stringLiterals(file);
  const rules = parseCss(css);
  assert.equal(literals.has("review-specialty-rail"), false);
  assert.equal(visit(file, (node) => ts.isJsxText(node) && node.text.trim() === "All").length, 0);
  assert.ok(hasJsxClass(file, "review-filter-rail"));
  assert.ok(cssRules(rules, ".review-row::before").length >= 1);
  assert.ok(cssRules(rules, ".review-row::after").length >= 1);
  assert.equal(hasJsxClass(file, "review-column-headings"), false);
  assert.equal(cssRules(rules, ".review-row")[0].declarations["grid-template-columns"], "44px minmax(0, 1fr) 360px 144px");
  const folioRules = cssRules(rules, ".review-selection-folio");
  assert.equal(folioRules[0].declarations.position, "relative");
  assert.equal(folioRules.some((rule) => rule.declarations.position === "sticky"), false);
  assert.equal(folioRules.some((rule) => rule.declarations.bottom === "78px"), false);
});

test("Review Queue keeps specialty filters reachable in the mobile menu and unavailable routes inside its grid", async () => {
  const [source, homeSource, css] = await Promise.all([
    load("../app/review-queue-view.tsx"),
    load("../app/home-client.tsx"),
    load("../app/review-queue.css"),
  ]);
  const file = parseTsx(source);
  const home = parseTsx(homeSource);
  const rules = parseCss(css);
  assert.ok(hasJsxClass(file, "review-filter-rail"));
  assert.equal(source.includes("Specialty</legend>"), false);
  assert.ok(hasJsxClass(file, "review-reader-unavailable"));
  assert.equal(hasJsxClass(home, "journey-reader-not-found review-reader-not-found"), false);
  assert.equal(cssRules(rules, ".review-expanded-controls > div", "@container").some((rule) => rule.declarations.position === "fixed"), true);
  assert.ok(cssRules(rules, ".review-expanded-controls fieldset", "@container").some((rule) => rule.declarations["grid-template-columns"] === "repeat(2, minmax(0, 1fr))"));
  assert.ok(cssRules(rules, ".review-reader-unavailable").length >= 1);
});

test("Review Queue cards select from the whole surface and reserve navigation for its action", async () => {
  const [source, css] = await Promise.all([load("../app/review-queue-view.tsx"), load("../app/review-queue.css")]);
  const file = parseTsx(source);
  const rules = parseCss(css);
  assert.equal(hasJsxClass(file, "review-row-select-surface"), false);
  assert.ok(hasJsxClass(file, "review-select"));
  assert.ok(hasJsxAttribute(file, "aria-label", "Select"));
  const cardTarget = cssRules(rules, ".review-select")[0].declarations;
  assert.equal(cardTarget.position, "absolute");
  assert.equal(cardTarget.inset, "0");
  assert.equal(cardTarget.cursor, "pointer");
  assert.ok(cssRules(rules, ".review-row:hover").length >= 1);
  assert.ok(cssRules(rules, ".review-row:focus-within").length >= 1);
  const action = cssRules(rules, ".review-icon-actions button")[0].declarations;
  assert.notEqual(action.border, "0");
  assert.equal(action.cursor, "pointer");
  assert.ok(cssRules(rules, ".review-row-static").some((rule) => rule.declarations["pointer-events"] === "none"));
});

test("Review Queue uses the Bank visual language without redundant row prose", async () => {
  const [source, css] = await Promise.all([load("../app/review-queue-view.tsx"), load("../app/review-queue.css")]);
  const file = parseTsx(source);
  const rules = parseCss(css);

  assert.match(source, /<InterviewPageHero tone="reviews"/);
  assert.ok(hasJsxClass(file, "review-filter-rail"));
  assert.ok(hasJsxClass(file, "review-search-bar"));
  assert.ok(hasJsxClass(file, "review-row-copy"));
  assert.ok(hasJsxClass(file, "review-row-meta"));
  assert.ok(hasJsxClass(file, "review-icon-actions"));
  assert.equal(hasJsxClass(file, "review-column-headings"), false);
  assert.equal(hasJsxClass(file, "review-result"), false);
  assert.equal(hasJsxClass(file, "review-date"), false);
  assert.equal(hasJsxClass(file, "review-reason"), false);
  assert.ok(visit(file, (node) => ts.isJsxAttribute(node) && node.name.text === "title" && /previous attempt/i.test(node.initializer?.getText(file) ?? "")).length >= 1);
  assert.equal(cssRules(rules, ".review-icon-actions")[0]?.declarations["grid-template-columns"], "repeat(3, 44px)");
  assert.equal(cssRules(rules, ".review-row")[0]?.declarations["grid-template-columns"], "44px minmax(0, 1fr) 360px 144px");
  assert.equal(cssRules(rules, ".review-row-meta")[0]?.declarations["justify-items"], "center");
  assert.equal(cssRules(rules, ".review-row-meta")[0]?.declarations["grid-template-columns"], "160px 110px 72px");
  assert.equal(cssRules(rules, ".review-row-meta > span")[0]?.declarations["place-items"], "center");
  assert.equal(cssRules(rules, ".review-outcome-chip")[0]?.declarations.width, "140px !important");
  const openReviewAttempt = functionNamed(parseTsx(await load("../app/home-client.tsx")), "openReviewAttempt");
  assert.match(openReviewAttempt.getText(), /openReviewEntry/);
  assert.doesNotMatch(openReviewAttempt.getText(), /openPastEntry/);
  assert.match(source, /event\.stopPropagation\(\); onOpenAttempt\(item\)/);
});

test("Reader contents replace their hash and modal readers own keyboard focus", async () => {
  const source = await load("../app/home-client.tsx");
  const file = parseTsx(source);
  const outline = functionNamed(file, "ReaderOutline");
  const reveal = functionNamed(file, "revealReaderOutlineTarget");
  const modal = functionNamed(file, "ModalReaderPane");
  assert.ok(outline);
  assert.ok(reveal);
  assert.match(outline.getText(file), /preventDefault/);
  assert.match(reveal.getText(file), /history\.replaceState/);
  assert.match(reveal.getText(file), /scrollIntoView/);
  assert.ok(modal);
  assert.match(modal.getText(file), /Tab/);
  assert.match(modal.getText(file), /\.focus\(/);
  assert.ok(hasJsxClass(file, "review-queue-base"));
  assert.ok(hasJsxAttribute(file, "inert", "reviewNestedEntry"));
  assert.match(source, /focusKey=\{reviewNestedProblem \?/);
  assert.match(source, /restoreFocusRef=\{reviewReaderOpenerRef\}/);
  assert.match(source, /arrivalState === "entered" && \(reviewNestedEntry \|\| reviewNestedProblem\)/);
});

test("Review Queue responds to its panel width and never outgrows the owning sheet", async () => {
  const rules = parseCss(await load("../app/review-queue.css"));
  const container = cssRules(rules, ".review-queue-container")[0].declarations;
  const page = cssRules(rules, ".review-queue-page")[0].declarations;
  assert.equal(container["container-type"], "inline-size");
  assert.equal(page["max-width"], "100%");
  for (const selector of [".review-queue-sheet", ".recall-spine", ".recall-group", ".recall-rows", ".review-row"]) {
    assert.ok(cssRules(rules, selector).some((rule) => rule.declarations["min-width"] === "0"));
    assert.ok(cssRules(rules, selector).some((rule) => rule.declarations["max-width"] === "100%"));
  }
  assert.ok(cssRules(rules, ".review-queue-page", "@container").length >= 2);
});

test("Review Queue owns its nested reader and keeps only the recall list scrollable", async () => {
  const [homeSource, reviewCss, shellCss] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/review-queue.css"),
    load("../app/interview-arc-v2.css"),
  ]);
  const file = parseTsx(homeSource);
  const rules = parseCss(`${reviewCss}\n${shellCss}`);
  const openReviewAttempt = functionNamed(file, "openReviewAttempt");
  assert.ok(openReviewAttempt);
  assert.match(openReviewAttempt.getText(file), /openReviewEntry/);
  assert.doesNotMatch(openReviewAttempt.getText(file), /openPastEntry/);
  assert.ok(hasJsxClass(file, "review-reader-detail reader-workspace focused-attempt-workspace"));

  assert.ok(cssRules(rules, ".app-shell:has(.review-queue-workspace)").some((rule) => rule.declarations.height === "100dvh"));
  assert.ok(cssRules(rules, ".app-shell:has(.review-queue-workspace)", "max-width: 900px").some((rule) => rule.declarations.height === "auto"));
  assert.ok(cssRules(rules, ".app-shell:has(.review-queue-workspace)").some((rule) => rule.declarations.overflow === "hidden"));
  assert.ok(cssRules(rules, ".main-column:has(.review-queue-workspace)").some((rule) => rule.declarations["grid-template-rows"] === "auto minmax(0, 1fr)"));
  assert.ok(cssRules(rules, ".page-content:has(> .review-queue-workspace)").some((rule) => rule.declarations.overflow === "hidden"));

  const workspace = cssRules(rules, ".review-queue-workspace")[0]?.declarations;
  const container = cssRules(rules, ".review-queue-container")[0]?.declarations;
  const page = cssRules(rules, ".review-queue-page")[0]?.declarations;
  const sheet = cssRules(rules, ".review-queue-sheet")[0]?.declarations;
  assert.equal(workspace?.height, "100%");
  assert.equal(container?.height, "100%");
  assert.equal(page?.display, "grid");
  assert.match(page?.["grid-template-rows"] ?? "", /minmax\(0, 1fr\)/);
  assert.equal(sheet?.["min-height"], "0");
  assert.equal(sheet?.["overflow-y"], "auto");
  assert.equal(cssRules(rules, ".review-queue-sheet")[0]?.declarations["overflow-y"], "auto");

  const backdrop = cssRules(rules, ".review-queue-workspace.has-open-reader::before")[0]?.declarations;
  assert.equal(backdrop?.position, "fixed");
  assert.equal(backdrop?.background, "var(--canvas)");
});

test("Review Queue retries hydrated reader routes and compacts its folio at high zoom", async () => {
  const [homeSource, reviewCss, workspaceCss, globalCss] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/review-queue.css"),
    load("../app/interview-arc-v2.css"),
    load("../app/globals.css"),
  ]);
  const home = parseTsx(homeSource);
  const restoreEffects = visit(home, (node) => ts.isCallExpression(node) && node.expression.getText(home) === "useEffect" && node.getText(home).includes("restoreWorkspaceLocation"));
  assert.equal(restoreEffects.length, 2);
  const hasIdentifier = (node, name) => visit(node, (candidate) => ts.isIdentifier(candidate) && candidate.text === name).length > 0;
  const hasPopstateSubscription = (node) => visit(node, (candidate) => (
    ts.isCallExpression(candidate)
    && ts.isPropertyAccessExpression(candidate.expression)
    && candidate.expression.name.text === "addEventListener"
    && candidate.arguments[0]?.getText(home) === '"popstate"'
  )).length > 0;
  const stableSubscription = restoreEffects.find(hasPopstateSubscription);
  const hydratedRestore = restoreEffects.find((effect) => hasIdentifier(effect, "readerRouteUnavailable"));
  assert.ok(stableSubscription);
  const stableDependencies = stableSubscription.arguments[1];
  assert.ok(stableDependencies && ts.isArrayLiteralExpression(stableDependencies));
  assert.equal(stableDependencies.elements.length, 0);
  assert.ok(hydratedRestore);
  for (const identifier of ["hydrated", "restoreWorkspaceLocationRef", "restoreWorkspaceLocation", "readerNotFound"]) {
    assert.equal(hasIdentifier(hydratedRestore, identifier), true);
  }
  const rules = parseCss(reviewCss);
  assert.ok(cssRules(rules, ".review-selection-folio", "@media").some((rule) => rule.declarations["grid-template-rows"] === "48px"));
  assert.ok(cssRules(rules, ".folio-bookmarks", "@media").some((rule) => rule.declarations.display === "none"));
  assert.ok(cssRules(rules, ".review-expanded-controls > div")[0].declarations["max-height"]);
  const workspaceRules = parseCss(workspaceCss);
  assert.ok(cssRules(workspaceRules, ".page-content:has(> .review-queue-workspace)", "@media").some((rule) => rule.declarations.height === "auto" && rule.declarations["padding-bottom"] === "76px"));
  assert.ok(cssRules(workspaceRules, ".page-content:has(> .review-queue-workspace)", "@media").some((rule) => rule.declarations["padding-bottom"] === "122px"));
  assert.ok(cssRules(workspaceRules, ".page-content > .review-queue-workspace", "@media").some((rule) => rule.declarations.height === "calc(100% - 68px)"));
  const globalRules = parseCss(globalCss);
  assert.equal(cssRules(globalRules, ".mobile-interview-nav", "@media").some((rule) => rule.declarations["grid-template-columns"] === "repeat(3, minmax(0, 1fr))"), false);
});

test("Past, Banks, and Journey share a centered bounded scrollable reader shell", async () => {
  const [source, css] = await Promise.all([load("../app/home-client.tsx"), load("../app/interview-arc-v2.css")]);
  const file = parseTsx(source);
  const rules = parseCss(css);
  assert.ok(hasJsxClass(file, "journey-reader-detail reader-workspace focused-attempt-workspace"));
  assert.ok(hasJsxAttribute(file, "aria-modal", "true"));
  for (const backdrop of [
    ".library-page.has-open-entry::before",
    ".banks-page.has-open-solution::before",
    ".journey-page.has-open-reader::before",
  ]) {
    const declarations = cssRules(rules, backdrop)[0]?.declarations;
    assert.ok(declarations, `${backdrop} must cover its owning workspace`);
    assert.equal(declarations.background, "var(--canvas)");
  }

  const pastShell = cssRules(rules, ".library-page.has-open-entry .past-master-detail")
    .find((rule) => rule.declarations.width === "min(var(--reader-pane-width), calc(100vw - var(--sidebar-size) - 32px))")?.declarations;
  const bankShell = cssRules(rules, ".banks-page.has-open-solution .bank-master-detail")
    .find((rule) => rule.declarations.width === "min(var(--reader-pane-width), calc(100vw - var(--sidebar-size) - 32px))")?.declarations;
  for (const shell of [pastShell, bankShell]) {
    assert.ok(shell);
    assert.equal(shell.width, "min(var(--reader-pane-width), calc(100vw - var(--sidebar-size) - 32px))");
    assert.equal(shell.left, "calc(var(--sidebar-size) + (100vw - var(--sidebar-size)) / 2)");
    assert.equal(shell.transform, "translateX(-50%)");
  }
  const multiPaneShell = cssRules(rules, ".library-page.has-open-entry .past-master-detail")
    .find((rule) => rule.declarations.background === "transparent")?.declarations;
  const multiPaneBankShell = cssRules(rules, ".banks-page.has-open-solution .bank-master-detail")
    .find((rule) => rule.declarations.background === "transparent")?.declarations;
  for (const shell of [multiPaneShell, multiPaneBankShell]) {
    assert.ok(shell, "the outer multi-pane frame must not paint through its rounded child corners");
    assert.equal(shell.background, "transparent");
    assert.equal(shell["border-radius"], "0");
    assert.equal(shell.overflow, "visible");
  }
  for (const frame of ["from", "to"]) {
    const declarations = cssRules(rules, frame, "@keyframes master-detail-in")[0]?.declarations;
    assert.ok(declarations, `master-detail-in ${frame} frame is required`);
    assert.equal(declarations.transform, undefined, "entry motion must not replace horizontal centering");
    assert.match(declarations.translate, /^0 /);
  }
  const widePast = cssRules(rules, ".library-page.has-open-entry .past-master-detail.master-pane-open", "min-width: 1977px")[0].declarations;
  assert.equal(widePast.left, undefined);
  assert.equal(widePast.transform, undefined);

  const mobilePast = cssRules(rules, ".library-page.has-open-entry .past-master-detail", "max-width: 760px").at(-1).declarations;
  const mobileBank = cssRules(rules, ".banks-page.has-open-solution .bank-master-detail", "max-width: 760px").at(-1).declarations;
  for (const shell of [mobilePast, mobileBank]) {
    assert.equal(shell.width, "100%");
    assert.equal(shell.inset, "66px 0 72px");
    assert.equal(shell.transform, "none");
  }

  const scroller = cssRules(rules, ".workspace-reader-scroll.case-document")
    .find((rule) => rule.declarations["min-height"])?.declarations;
  assert.ok(scroller);
  assert.equal(scroller["min-height"], "0");
  assert.equal(scroller["overflow-y"], "auto");
});

test("Past hides unknown practice mode and keeps recorded mode in the case header", async () => {
  const source = await load("../app/home-client.tsx");
  const file = parseTsx(source);
  const reader = functionNamed(file, "renderCaseReader");
  assert.ok(reader);
  const readerSource = reader.getText(file);
  assert.doesNotMatch(readerSource, /PracticeModeCard|case-practice-mode/);
  assert.match(readerSource, /CaseModeTags/);
});

test("Reader contents reveal collapsed sections before navigating", async () => {
  const file = parseTsx(await load("../app/home-client.tsx"));
  const reveal = functionNamed(file, "revealReaderOutlineTarget");
  assert.ok(reveal);
  assert.match(reveal.getText(file), /closest<.*HTMLDetailsElement.*>\("details\.reader-group"\)/s);
  assert.match(reveal.getText(file), /group\.open = true/);
});

test("the fixed header owns the only workspace selector", async () => {
  const { file, rules } = await loadResponsiveShell();
  const atmosphereRules = parseCss(await load("../app/workspace-atmosphere.css"));
  const literals = stringLiterals(file);
  const workspaceNav = visit(file, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(file) === "className"
      && attribute.initializer?.getText(file) === '"topbar-workspace-switch"'))[0];
  assert.ok(workspaceNav);
  const workspaceLabels = visit(workspaceNav, (node) => ts.isJsxText(node))
    .map((node) => node.text.trim())
    .filter((value) => ["Interview", "Learn", "Engineering", "Journey"].includes(value));
  assert.deepEqual(workspaceLabels, ["Interview", "Learn", "Engineering"]);
  assert.equal(literals.has("Statistics"), true);
  const engineeringNav = visit(file, (node) => ts.isIdentifier(node)
    && node.text === "ENGINEERING_NAV_ITEMS");
  assert.ok(engineeringNav.length > 0);
  assert.equal(literals.has("Recall schedule"), false);
  const identityNav = visit(file, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(file) === "className"
      && attribute.initializer?.getText(file) === '"workspace-nav"'))[0];
  assert.equal(identityNav, undefined);
  assert.doesNotMatch(file.getText(), /WorkspaceIdentityBadge/);
  assert.doesNotMatch(file.getText(), /<small>Workspace<\/small>/);
  assert.doesNotMatch(file.getText(), /<span>\{activeWorkspace === "engineering" \? "Engineering"/);
  const fixedHeader = cssRules(rules, ".topbar")
    .filter((rule) => rule.ancestors.length === 0 && rule.declarations["grid-template-areas"])
    .at(-1).declarations;
  assert.equal(fixedHeader["grid-template-areas"], '"context switch actions"');
  assert.equal(fixedHeader["grid-template-rows"], "40px");
  assert.equal(fixedHeader["min-height"], "54px");
  const canonicalBrandRule = cssRules(atmosphereRules, ".app-shell .brand-mark")
    .find((rule) => rule.declarations.background?.includes('/favicon.svg')
      && rule.declarations.border === "0"
      && rule.declarations["border-radius"] === "0"
      && rule.declarations["box-shadow"] === "none");
  assert.ok(canonicalBrandRule, "the favicon must not inherit a second bordered tile");
});

test("sidebar destination rail has no second workspace switch", async () => {
  const home = await load("../app/home-client.tsx");
  const identity = await load("../app/workspace-identity.tsx");
  const identityCss = await load("../app/workspace-identity.css");
  const homeFile = parseTsx(home);
  assert.doesNotMatch(home, /<nav className="workspace-nav"/);
  assert.doesNotMatch(home, /WorkspaceIdentityBadge/);
  assert.match(home, /className="sidebar-masthead"/);
  assert.match(home, /<WorkspaceNameplate workspace=\{activeWorkspace\} \/>/);
  assert.match(identity, /export function WorkspaceNameplate/);
  assert.doesNotMatch(identity, /export function WorkspaceIdentityBadge/);
  assert.doesNotMatch(identity, /onSelect/);
  assert.match(identityCss, /\.app-shell \.sidebar-masthead \{/);
  assert.match(identityCss, /margin: -22px -14px 0/);
  assert.match(identityCss, /background: var\(--workspace-nameplate-pigment\)/);
  assert.match(identityCss, /\.app-shell \.workspace-nameplate \{[^}]*background: transparent/s);
  assert.doesNotMatch(identityCss, /linear-gradient/);
  assert.doesNotMatch(identityCss, /inset 0 1px 0/);
  assert.doesNotMatch(home, /Interview · Today/);
  assert.doesNotMatch(home, /topbar-context-copy/);
  assert.doesNotMatch(home, /workspace-tabs/);
  assert.match(home, /<nav className="topbar-workspace-switch" aria-label="Workspaces">/);
  assert.match(home, /<nav className="primary-nav" aria-label="Interview navigation">/);
  assert.doesNotMatch(home, /<small>Workspace<\/small>/);
  assert.doesNotMatch(home, /local-nav-label"><span>/);
  const localNav = visit(homeFile, (node) => ts.isJsxSelfClosingElement(node)
    && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(homeFile) === "className"
      && attribute.initializer?.getText(homeFile) === '"local-nav-label"'))[0];
  assert.ok(localNav);
  assert.match(localNav.getText(homeFile), /aria-hidden="true"/);
  const interviewNav = visit(homeFile, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(homeFile) === "aria-label"
      && attribute.initializer?.getText(homeFile) === '"Interview navigation"'))[0];
  assert.ok(interviewNav);
  const interviewNavText = interviewNav.getText(homeFile);
  assert.doesNotMatch(interviewNavText, />Learn</);
  assert.doesNotMatch(interviewNavText, />Engineering</);
  assert.match(interviewNavText, /padStart\(2,/);
});

test("Engineering uses its exact local navigation and keeps Statistics out of Interview", async () => {
  const file = parseTsx(await load("../app/engineering-workspace.tsx"));
  const engineeringNav = visit(file, (node) => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "ENGINEERING_NAV_ITEMS")[0];
  assert.ok(engineeringNav?.initializer && ts.isArrayLiteralExpression(engineeringNav.initializer));
  const items = engineeringNav.initializer.elements.map((element) => {
    assert.ok(ts.isArrayLiteralExpression(element));
    return element.elements.map((item) => {
      assert.ok(ts.isStringLiteral(item));
      return item.text;
    });
  });
  assert.deepEqual(items, [
    ["journal", "Journal"],
    ["capabilities", "Capabilities"],
    ["decisions", "Decisions"],
    ["incidents", "Incidents"],
    ["case-studies", "Case Studies"],
    ["statistics", "Statistics"],
  ]);

  const interviewFile = parseTsx(await load("../app/home-client.tsx"));
  const interviewNav = visit(interviewFile, (node) => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "INTERVIEW_NAV_ITEMS")[0];
  assert.doesNotMatch(interviewNav.getText(interviewFile), /Statistics/);
});

test("Engineering reader keys selection by immutable ref and keeps unreleased Learn state unavailable", async () => {
  const source = await load("../app/engineering-workspace.tsx");
  assert.match(source, /record\.ref === selectedRef/);
  assert.match(source, /key=\{record\.ref\}/);
  assert.match(source, /disabled aria-disabled="true"/);
  assert.match(source, /Pending the released Learn revision, commit, and symbol contract/);
  assert.match(source, /record\.source\.permalink/);
  assert.match(source, /record\.effectiveStatus/);
  assert.match(source, /view === "capabilities"\) return record\.type === "capability-dossier"/);
  assert.doesNotMatch(source, /view === "capabilities"\) return record\.capabilityIds\.length/);
});

test("Engineering exposes exact provenance, durable navigation memory, and complete factual Statistics", async () => {
  const source = await load("../app/engineering-workspace.tsx");
  assert.match(source, /record\.source\.commit/);
  assert.match(source, /record\.source\.path/);
  assert.match(source, /CopyControl/);
  assert.match(source, /Immutable lineage/);
  assert.match(source, /ENGINEERING_MEMORY_KEY/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /statistics\.earliestCreatedAt/);
  assert.match(source, /statistics\.latestCreatedAt/);
  assert.match(source, /statistics\.byRepository/);
  assert.match(source, /statistics\.byCapability/);
  assert.match(source, /onNavigateView\("journal"\)/);
});

test("Engineering Journal is a persistent three-panel evidence workbench", async () => {
  const source = await load("../app/engineering-workspace.tsx");
  const styles = await load("../app/engineering-workspace.css");
  const rules = parseCss(styles);
  assert.match(source, /engineering-index-panel/);
  assert.match(source, /engineering-record-panel/);
  assert.match(source, /engineering-evidence-panel/);
  assert.match(source, /engineering-contents-nav/);
  assert.doesNotMatch(source, />Contents<\/span>/);
  assert.match(source, /evidenceOpen/);
  assert.match(source, /indexScrollTop/);
  assert.match(source, /onToggleEvidence/);
  assert.match(source, /aria-pressed=\{evidenceOpen\}/);
  assert.match(source, /aria-label="Close evidence"/);
  assert.doesNotMatch(source, /aria-label="Return to Engineering record"/);
  assert.match(source, /const displayEvidence = narrowWorkbench \? evidenceOpen : true/);
  assert.match(styles, /grid-template-columns:\s*minmax\(290px, 316px\) minmax\(0, 1120px\) minmax\(260px, 288px\)/);
  assert.match(styles, /gap:\s*20px/);
  assert.match(styles, /height:\s*calc\(100dvh - 90px\)/);
  assert.match(styles, /\.engineering-destination \.engineering-record-panel,[\s\S]*?\.engineering-destination \.engineering-evidence-panel \{ overflow-y: auto;/);
  assert.match(source, /matchMedia\("\(max-width: 1320px\)"\)/);
  assert.match(source, /addEventListener\("change", syncEvidenceLayout\)/);
  assert.match(source, /typeof parsed\.evidenceOpen === "boolean" \? parsed\.evidenceOpen : undefined/);
  assert.match(styles, /\.engineering-search \.sr-only/);
  assert.match(styles, /\.engineering-record-panel \.engineering-facts \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.doesNotMatch(source, /indexCollapsed/);
  assert.doesNotMatch(source, /aria-label="Collapse Journal index"/);
  assert.match(styles, /@media \(max-width: 1320px\)[\s\S]*position:\s*absolute;/);
  assert.match(styles, /@media \(max-width: 1320px\)[\s\S]*\.engineering-panel-close \{ display: inline-flex/);
  assert.doesNotMatch(styles, /position:\s*fixed;[\s\S]*engineering-evidence-panel|engineering-evidence-panel \{ position: fixed/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.equal((styles.match(/^\.engineering-workspace \{/gm) ?? []).length, 1, "the Engineering workbench must have one authoritative base rule");
  assert.equal((styles.match(/^@media \(max-width: 760px\) \{/gm) ?? []).length, 1, "mobile workbench behavior must stay in one breakpoint block");
  assert.equal(cssRules(rules, ".engineering-contents-nav")[0]?.declarations["backdrop-filter"], undefined);
  assert.equal(cssRules(rules, ".engineering-evidence-panel > header")[0]?.declarations["backdrop-filter"], undefined);
  assert.match(source, /const receiptByRef = useMemo/);
  assert.match(source, /\.map\(\(ref\) => receiptByRef\.get\(ref\)\)/);
  assert.match(source, /const indexScrollTopRef = useRef\(0\)/);
  assert.match(source, /scrollPersistTimerRef/);
  assert.doesNotMatch(source, /setIndexScrollTop/);
});

test("Engineering Case Studies preserves the three-panel workbench before selection", async () => {
  const source = await load("../app/engineering-workspace.tsx");
  const styles = await load("../app/engineering-workspace.css");
  assert.match(source, /EngineeringEmptyEvidencePanel/);
  assert.match(source, /displayEvidence = narrowWorkbench \? evidenceOpen : true/);
  assert.match(source, /No eligible record selected\./);
  assert.match(styles, /\.engineering-evidence-empty/);
});

test("workspace gutters stay transparent and Learn removes its underpanel", async () => {
  const [atmosphere, learn] = await Promise.all([
    load("../app/workspace-atmosphere.css"),
    load("../app/learn-workspace.css"),
  ]);
  assert.match(atmosphere, /active-view-library[\s\S]*\.past-master-detail/);
  assert.match(atmosphere, /active-view-banks[\s\S]*\.bank-master-detail/);
  assert.match(atmosphere, /active-view-library \.main-column[\s\S]*background:\s*var\(--workspace-paper\)/);
  assert.match(atmosphere, /active-view-banks \.main-column[\s\S]*background:\s*var\(--workspace-paper\)/);
  assert.match(atmosphere, /\.past-master-pane, \.past-entry-pane[\s\S]*?background:\s*var\(--workspace-paper\)/);
  assert.match(atmosphere, /\.bank-master-pane, \.bank-solution-pane[\s\S]*?background:\s*var\(--workspace-paper\)/);
  assert.doesNotMatch(atmosphere, /past-entry-pane\) \{\s*background: transparent !important/);
  assert.match(atmosphere, /active-workspace-engineering[\s\S]*\.engineering-workspace[\s\S]*background:\s*transparent/);
  assert.match(learn, /\.learn-course-workspace\s*\{[\s\S]*background:\s*transparent;[\s\S]*border:\s*0;[\s\S]*padding:\s*0;/);
  assert.match(learn, /\.learn-hero-metrics\s*\{[\s\S]*border-top:\s*0;/);
});

test("workspace atmosphere is persistent, bounded, and reader-safe", async () => {
  const home = await load("../app/home-client.tsx");
  const atmosphere = await load("../app/arrival-ritual.tsx");
  const globalStyles = await load("../app/globals.css");
  const globalRules = parseCss(globalStyles);
  const readerStyles = await load("../app/interview-arc-v2.css");
  assert.match(home, /interview-arc-atmosphere-v1/);
  assert.match(home, /interview-arc-petals-paused/);
  assert.match(home, /!atmosphereReady \? "off"/);
  assert.match(home, /activeWorkspace === "engineering" \? "rain" : "petals"/);
  assert.match(home, /<AtmosphereField[^>]*mode=\{atmosphereMode\}/);
  assert.match(atmosphere, /Array\.from\(\{ length: 64 \}/);
  assert.match(atmosphere, /ambient-rain-drop/);
  assert.match(atmosphere, /visibilitychange/);
  assert.match(globalStyles, /\.ambient-rain-drop/);
  assert.match(globalStyles, /prefers-reduced-motion: reduce/);
  assert.equal(cssRules(globalRules, ".ambient-rain-drop")[0]?.declarations.width, "2px");
  assert.equal(cssRules(globalRules, ".ambient-rain-drop")[0]?.declarations["will-change"], undefined);
  assert.match(readerStyles, /body:has\(\.reader-workspace\) \.ambient-rain-drop/);
});

test("Engineering keeps the complete PR timeline separate from rich records", async () => {
  const source = await load("../app/engineering-workspace.tsx");
  const styles = await load("../app/engineering-workspace.css");
  assert.match(source, /type EngineeringJournalLayer = "records" \| "receipts"/);
  assert.match(source, /All merged PRs/);
  assert.match(source, /index\.pullRequestReceipts/);
  assert.match(source, /index\.receiptSearch/);
  assert.match(source, /index\.receiptBacklinks/);
  assert.match(source, /index\.receiptStatistics/);
  assert.match(source, /<details>/);
  assert.match(source, /Exact receipt source/);
  assert.match(source, /receipt\.source\.path/);
  assert.match(source, /receipt\.source\.commit/);
  assert.match(source, /receipt\.timelineBasis/);
  assert.match(source, /receipt\.missingFacts/);
  assert.match(source, /receipt\.sources\.map/);
  assert.match(source, /Compact receipt only; no rich record was required/);
  assert.match(source, /Complete receipt chronology/);
  assert.match(source, /receiptStatistics\.byClassification/);
  assert.match(source, /receiptStatistics\.byRepository/);
  assert.match(source, /record\.diagrams\.length/);
  assert.match(source, /diagram\.renderedUrl/);
  assert.match(source, /Editable draw\.io source/);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com/);
  assert.match(source, /function OriginalPullRequestLink/);
  assert.match(source, /href=\{receipt\.originalPullRequestUrl\}/);
  assert.match(source, /href=\{entry\.originalPullRequestUrl\}/);
  assert.match(source, /className="engineering-receipt-permalink"/);
  assert.doesNotMatch(source, /\{receipt\.repository\} · PR #\{receipt\.pr\}/);
  assert.match(styles, /\.engineering-receipt-pr \{[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.engineering-receipt-list::before/);
  assert.match(styles, /@media \(pointer: coarse\)/);
  assert.match(source, /className="engineering-receipt-kicker"/);
  assert.match(source, /<i>\{receipt\.repository\}<\/i><OriginalPullRequestLink href=\{receipt\.originalPullRequestUrl\} pr=\{receipt\.pr\} \/>/);
  assert.doesNotMatch(source, /<b>PR #\{receipt\.pr\}<\/b>/);
  const rules = parseCss(styles);
  const number = cssRules(rules, ".engineering-receipt-kicker .engineering-receipt-pr")[0]?.declarations;
  const pill = cssRules(rules, ".engineering-receipt-flags em")[0]?.declarations;
  const basis = cssRules(rules, ".engineering-receipt-flags small")[0]?.declarations;
  assert.equal(number?.["white-space"], "nowrap");
  assert.equal(number?.flex, "0 0 auto");
  assert.equal(pill?.["white-space"], "nowrap");
  assert.equal(basis?.["white-space"], "nowrap");
  assert.match(number?.font ?? "", /\.88rem/);
  assert.equal(pill?.["font-size"], ".78rem");
  assert.equal(basis?.["font-size"], ".62rem");
});

test("Interview navigation uses one shared local model with Journey last", async () => {
  const { source, file } = await loadResponsiveShell();
  const interviewNav = visit(file, (node) => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "INTERVIEW_NAV_ITEMS")[0];
  assert.ok(interviewNav?.initializer && ts.isArrayLiteralExpression(interviewNav.initializer));
  const interviewNavItems = interviewNav.initializer.elements.map((element) => {
    assert.ok(ts.isArrayLiteralExpression(element));
    return element.elements.map((item) => {
      assert.ok(ts.isStringLiteral(item));
      return item.text;
    });
  });
  assert.deepEqual(interviewNavItems, [
    ["today", "Today"],
    ["loops", "Loops"],
    ["reviews", "Reviews"],
    ["library", "Past"],
    ["banks", "Banks"],
    ["journey", "Journey"],
  ]);
  assert.doesNotMatch(source, /view !== "journey" && <nav className="mobile-interview-nav"/);
});

test("responsive shell keeps the workspace selector above the seven-item Interview dock", async () => {
  const { rules } = await loadResponsiveShell();
  const mobileSidebar = cssRules(rules, ".sidebar", "max-width: 980px").at(-1).declarations;
  assert.equal(mobileSidebar.display, "none");
  assert.equal(cssRules(rules, ".app-shell .sidebar", "max-width: 980px").at(-1).declarations.display, "none");
  const interviewDock = cssRules(rules, ".mobile-interview-nav", "max-width: 980px").at(-1).declarations;
  assert.equal(interviewDock.position, "fixed");
  assert.equal(interviewDock.display, "grid");
  assert.equal(interviewDock["grid-template-columns"], "repeat(7, minmax(0, 1fr))");
  assert.equal(cssRules(rules, ".mobile-learn-nav", "max-width: 980px").at(-1).declarations["grid-template-columns"], "repeat(4, minmax(0, 1fr))");
  assert.equal(cssRules(rules, ".mobile-engineering-nav", "max-width: 980px").at(-1).declarations["grid-template-columns"], "repeat(6, minmax(0, 1fr))");
  const compactDock = cssRules(rules, ".mobile-interview-nav", "max-width: 360px").at(-1).declarations;
  assert.equal(compactDock["grid-template-columns"], "repeat(4, minmax(0, 1fr))");
  assert.equal(cssRules(rules, ".mobile-interview-nav button", "max-width: 420px").at(-1).declarations["min-height"], "44px");
  assert.ok(cssRules(rules, ".topbar > div:last-child").some((rule) => rule.declarations["flex-wrap"] === "nowrap"));
  assert.equal(cssRules(rules, ".topbar .secondary-action", "max-width: 980px").at(-1).declarations.display, "none");
  assert.equal(cssRules(rules, ".app-shell", "max-width: 980px").at(-1).declarations["--sidebar-size"], "0px");
  assert.equal(
    cssRules(rules, ".topbar > div:first-child span", "max-width: 760px")
      .some((rule) => rule.declarations.display === "none"),
    false,
  );
});

test("workspace header keeps the home mark and never shows destination title or date", async () => {
  const { file, source, rules } = await loadResponsiveShell();
  const context = visit(file, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(file) === "className"
      && attribute.initializer?.getText(file) === '"topbar-context"'))[0];
  assert.ok(context);
  assert.doesNotMatch(source, /topbar-context-copy/);
  assert.doesNotMatch(context.getText(file), /readableDate/);
  assert.doesNotMatch(context.getText(file), /INTERVIEW_VIEW_TITLES|LEARN_VIEW_TITLES|ENGINEERING_VIEW_TITLES/);
  const copy = context.children.filter(ts.isJsxElement)
    .find((element) => element.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(file) === "className"
      && attribute.initializer?.getText(file) === '"topbar-context-copy"'));
  assert.equal(copy, undefined);
  assert.equal(cssRules(rules, ".topbar", "max-width: 760px").at(-1).declarations["grid-template-areas"], '"context switch actions"');
  assert.equal(cssRules(rules, ".topbar-brand", "max-width: 980px").at(-1).declarations.display, "grid");
});

test("Loops source dialog keeps a stable close callback for its focus and scroll-lock lifecycle", async () => {
  const file = parseTsx(await load("../app/loops-workspace.tsx"));
  const callback = visit(file, (node) => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "closeSourceDialog")[0];
  assert.ok(callback?.initializer && ts.isCallExpression(callback.initializer));
  assert.equal(callback.initializer.expression.getText(file), "useCallback");

  const dialog = visit(file, (node) => ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(file) === "JobDescriptionDialog")[0];
  assert.ok(dialog);
  const onClose = dialog.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute)
    && attribute.name.getText(file) === "onClose");
  assert.ok(onClose && ts.isJsxExpression(onClose.initializer));
  assert.equal(onClose.initializer.expression?.getText(file), "closeSourceDialog");
});

test("Loops presents one chronological record without the detached dashboard", async () => {
  const [source, css, redesignCss] = await Promise.all([
    load("../app/loops-workspace.tsx"),
    load("../app/globals.css"),
    load("../app/loops-redesign.css"),
  ]);
  const file = parseTsx(source);
  const rules = parseCss(`${css}\n${redesignCss}`);
  assert.ok(hasJsxClass(file, "loop-support-band"));
  assert.ok(hasJsxClass(file, "loop-preparation-columns"));
  assert.ok(hasJsxClass(file, "loop-stage-chronology"));
  assert.ok(hasJsxClass(file, "loop-stage-record"));
  assert.ok(hasJsxClass(file, "loop-question-card"));
  assert.ok(hasJsxClass(file, "loop-stage-material"));
  assert.ok(hasJsxClass(file, "loop-stage-result"));
  assert.equal(hasJsxClass(file, "loop-stage-track"), false);
  assert.equal(hasJsxClass(file, "loop-detail-grid"), false);
  assert.equal(hasJsxClass(file, "loop-history"), false);
  assert.equal(hasJsxClass(file, "loop-debrief"), false);
  assert.equal(stringLiterals(file).has("Reconstructed answer"), false);
  assert.equal(stringLiterals(file).has("Activity history"), false);
  assert.doesNotMatch(functionNamed(file, "QuestionCard").getText(file), /answerMemory/);
  assert.doesNotMatch(functionNamed(file, "StageRecord").getText(file), /selfAssessment|interviewerFeedback|nextStep/);

  assert.ok(cssRules(rules, ".loop-support-band").some((rule) => rule.declarations["grid-template-columns"] === "minmax(250px, .7fr) minmax(0, 1.3fr)"));
  assert.equal(cssRules(rules, ".loop-preparation-columns")[0]?.declarations["grid-template-columns"], "repeat(3, minmax(0, 1fr))");
  assert.equal(cssRules(rules, ".loop-stage-chronology")[0]?.declarations.display, "grid");
  assert.equal(cssRules(rules, ".loop-stage-chronology::before")[0]?.declarations.width, "1px");
  assert.equal(cssRules(rules, ".loop-preparation-list")[0]?.declarations["overflow-y"], "auto");
  assert.equal(cssRules(rules, ".loop-stage-record-header > div")[0]?.declarations["min-width"], "0");
  assert.equal(cssRules(rules, ".loop-stage-record-header h2")[0]?.declarations["overflow-wrap"], "anywhere");
  assert.equal(cssRules(rules, ".loop-stage-record-body")[0]?.declarations["font-size"], "max(14px, .84rem)");
  assert.equal(cssRules(rules, ".loop-support-band", "max-width: 900px").at(-1)?.declarations["grid-template-columns"], "1fr");
  assert.equal(cssRules(rules, ".loop-preparation-columns", "max-width: 680px").at(-1)?.declarations["grid-template-columns"], "1fr");
});

test("all seven Interview pages use the exact shared hero geometry and semantic accents", async () => {
  const [heroSource, homeSource, materialsSource, loopsSource, css] = await Promise.all([
    load("../app/interview-page-hero.tsx"),
    load("../app/home-client.tsx"),
    load("../app/career-materials-workspace.tsx"),
    load("../app/loops-workspace.tsx"),
    load("../app/interview-page-hero.css"),
  ]);
  const rules = parseCss(css);
  const hero = cssRules(rules, ".interview-page-hero")[0]?.declarations;
  assert.equal(hero?.height, "350px");
  assert.equal(hero?.["min-height"], "350px");
  assert.equal(hero?.["max-height"], "350px");
  assert.equal(hero?.["container-type"], "inline-size");
  const narrative = cssRules(rules, ".page-hero-narrative")[0]?.declarations;
  const summary = cssRules(rules, ".page-hero-summary")[0]?.declarations;
  const art = cssRules(rules, ".page-hero-art").find((rule) => rule.ancestors.length === 0)?.declarations;
  assert.equal(narrative?.display, "block");
  assert.equal(narrative?.padding, "0");
  assert.equal(summary?.height, "50px");
  assert.equal(summary?.position, "absolute");
  assert.equal(summary?.bottom, "0");
  assert.equal(summary?.["z-index"], "3");
  assert.match(summary?.background ?? "", /255,\s*255,\s*255/);
  assert.equal(art?.position, "absolute");
  assert.equal(art?.height, "225px");
  assert.equal(art?.top, "27px");
  const heroCopy = cssRules(rules, ".page-hero-copy").find((rule) => rule.ancestors.length === 0)?.declarations;
  const heroTitle = cssRules(rules, ".page-hero-copy h1").find((rule) => rule.ancestors.length === 0)?.declarations;
  const heroLede = cssRules(rules, ".page-hero-lede").find((rule) => rule.ancestors.length === 0)?.declarations;
  assert.equal(heroCopy?.position, "absolute");
  assert.equal(heroCopy?.top, "24px");
  assert.equal(heroCopy?.bottom, "88px");
  assert.equal(heroCopy?.overflow, "visible");
  assert.equal(heroTitle?.overflow, "visible");
  assert.equal(heroLede?.overflow, "visible");
  assert.equal(heroLede?.["line-height"], "1.55");
  assert.equal(heroLede?.["-webkit-line-clamp"], undefined);
  assert.doesNotMatch(css, /\.page-hero-lede[^{]*\{[^}]*-webkit-line-clamp/);
  assert.equal(heroTitle?.["line-height"], "1.28");
  assert.equal(heroTitle?.["letter-spacing"], "-.015em");
  assert.match(heroTitle?.["font-size"] ?? "", /3\.65rem/);
  assert.doesNotMatch(css, /line-height:\s*\.88/);
  assert.doesNotMatch(css, /letter-spacing:\s*-\.055em/);
  assert.equal(cssRules(rules, ".page-content")[0]?.declarations["padding-top"], "25px");
  const allPageSources = `${homeSource}\n${materialsSource}\n${loopsSource}\n${await load("../app/review-queue-view.tsx")}`;
  for (const tone of ["today", "loops", "reviews", "past", "banks", "journey", "materials"]) {
    assert.match(allPageSources, new RegExp(`tone=["']${tone}["']`));
  }
  assert.equal((heroSource.match(/viewBox="0 0 620 250"/g) ?? []).length >= 7, true);
  assert.equal((heroSource.match(/aria-hidden="true"/g) ?? []).length >= 7, true);
  assert.match(css, /active-view-loops/);
  assert.match(css, /active-view-reviews/);
  assert.match(css, /active-view-library/);
  assert.match(css, /active-view-banks/);
  assert.match(css, /active-view-journey/);
  assert.match(css, /active-view-materials/);
});

test("every workspace hero uses one localized draw pulse and sweep with a static reduced-motion frame", async () => {
  const [interviewSource, interviewCss, learnSource, learnCss, engineeringSource, engineeringCss] = await Promise.all([
    load("../app/interview-page-hero.tsx"),
    load("../app/interview-page-hero.css"),
    load("../app/learn-workspace.tsx"),
    load("../app/learn-workspace.css"),
    load("../app/engineering-workspace.tsx"),
    load("../app/engineering-workspace.css"),
  ]);
  assert.match(interviewSource, /page-hero-pulse/);
  assert.match(interviewSource, /page-hero-light-band/);
  assert.match(interviewCss, /interview-hero-draw \.56s/);
  assert.match(interviewCss, /prefers-reduced-motion: reduce/);

  assert.equal((learnSource.match(/aria-label="[^"]+"/g) ?? []).filter((value) => /owl|elephant|honeybee|fox/i.test(value)).length, 4);
  assert.match(learnSource, /learn-hero-pulse/);
  assert.match(learnSource, /learn-hero-light-band/);
  assert.match(learnCss, /learn-hero-draw \.56s/);
  assert.match(learnCss, /stroke-dashoffset: 0/);

  assert.equal((engineeringSource.match(/aria-label="[^"]+"/g) ?? []).filter((value) => /cedar|tributaries|storm|canyon|sun transect|alpine route/i.test(value)).length, 6);
  assert.match(engineeringSource, /engineering-hero-pulse/);
  assert.match(engineeringSource, /engineering-hero-light-band/);
  assert.match(engineeringCss, /engineering-hero-draw \.56s/);
  assert.match(engineeringCss, /prefers-reduced-motion: reduce/);
});

test("Learn and Engineering hero type stays inside the 350px panel", async () => {
  const [learnCss, engineeringCss] = await Promise.all([
    load("../app/learn-workspace.css"),
    load("../app/engineering-workspace.css"),
  ]);
  const learnRules = parseCss(learnCss);
  const engineeringRules = parseCss(engineeringCss);
  const learnCopy = cssRules(learnRules, ".learn-hero-copy").find((rule) => rule.ancestors.length === 0)?.declarations;
  const learnTitle = cssRules(learnRules, ".learn-hero h1").find((rule) => rule.ancestors.length === 0)?.declarations;
  const engineeringCopy = cssRules(engineeringRules, ".engineering-hero-copy").find((rule) => rule.ancestors.length === 0)?.declarations;
  const engineeringTitle = cssRules(engineeringRules, ".engineering-hero-copy h1").find((rule) => rule.ancestors.length === 0)?.declarations;
  const readerTitle = cssRules(engineeringRules, ".engineering-reader-header h1").find((rule) => rule.ancestors.length === 0)?.declarations;

  assert.equal(learnCopy?.position, "absolute");
  assert.equal(learnCopy?.top, "24px");
  assert.equal(learnCopy?.bottom, "88px");
  assert.equal(learnCopy?.overflow, "visible");
  assert.equal(learnCopy?.["max-height"], "none");
  const learnBlurb = cssRules(learnRules, ".learn-hero-lede").find((rule) => rule.ancestors.length === 0)?.declarations;
  assert.equal(learnBlurb?.overflow, "visible");
  assert.equal(learnBlurb?.["line-height"], "1.55");
  assert.equal(learnBlurb?.["-webkit-line-clamp"], undefined);
  assert.doesNotMatch(learnCss, /-webkit-line-clamp/);
  assert.equal(learnTitle?.overflow, "visible");
  assert.equal(learnTitle?.["line-height"], "1.28");
  assert.equal(learnTitle?.["letter-spacing"], "-0.015em");
  assert.match(learnTitle?.["font-size"] ?? "", /3\.85rem/);
  assert.equal(engineeringCopy?.bottom, "88px");
  assert.equal(engineeringTitle?.["line-height"], "1.28");
  assert.equal(engineeringTitle?.["letter-spacing"], ".012em");
  assert.match(engineeringTitle?.["font-family"] ?? "", /font-editorial/);
  assert.match(engineeringTitle?.["font-size"] ?? "", /3\.65rem/);
  assert.equal(readerTitle?.["line-height"], "1.28");
  assert.match(readerTitle?.["font-family"] ?? "", /font-editorial/);
  assert.doesNotMatch(learnCss, /letter-spacing:\s*-0\.052em/);
  assert.doesNotMatch(engineeringCss, /max-width:\s*18ch/);
  assert.match(engineeringCss, /\.engineering-search input \{[^}]*min-width:\s*0/s);
  assert.match(engineeringCss, /\.engineering-search input::placeholder \{[^}]*opacity:\s*1/s);
  assert.doesNotMatch(engineeringCss, /line-height:\s*\.86/);
});

test("every workspace top panel has a quote and a display statement", async () => {
  const [learn, engineering, hero, home, materials, loops, reviews, learnCss, interviewCss, engineeringCss] = await Promise.all([
    load("../app/learn-workspace.tsx"),
    load("../app/engineering-workspace.tsx"),
    load("../app/interview-page-hero.tsx"),
    load("../app/home-client.tsx"),
    load("../app/career-materials-workspace.tsx"),
    load("../app/loops-workspace.tsx"),
    load("../app/review-queue-view.tsx"),
    load("../app/learn-workspace.css"),
    load("../app/interview-page-hero.css"),
    load("../app/engineering-workspace.css"),
  ]);

  assert.match(learn, /title: "The conversation stays\."/);
  assert.match(learn, /quote: "Exact and private\."/);
  assert.match(learn, /className="learn-hero-quote"/);
  assert.match(learn, /<HeroQuote className="learn-hero-quote">\{copy\.quote\}<\/HeroQuote>/);
  assert.match(learn, /className="learn-hero-lede">\{copy\.description\}/);
  assert.doesNotMatch(learn, /<h1>\{copy\.title\}<br/);
  assert.equal((learn.match(/quote:\s*"[^"]+"/g) ?? []).length, 4);

  assert.match(engineering, /<HeroQuote className="engineering-hero-quote">\{copy\.quote\}<\/HeroQuote>/);
  assert.equal((engineering.match(/quote:\s*"[^"]+"/g) ?? []).length, 6);

  const quoteHelper = await load("../app/hero-quote.tsx");
  assert.match(quoteHelper, /\\u201C/);
  assert.match(quoteHelper, /\\u201D/);
  assert.match(hero, /page-hero-quote/);
  assert.match(hero, /<HeroQuote className="page-hero-quote">\{quote\}<\/HeroQuote>/);
  const pages = `${home}\n${materials}\n${loops}\n${reviews}`;
  for (const tone of ["today", "loops", "reviews", "past", "banks", "journey", "materials"]) {
    const start = pages.indexOf(`<InterviewPageHero tone="${tone}"`);
    assert.ok(start >= 0, `missing Interview hero for ${tone}`);
    const slice = pages.slice(start, start + 900);
    assert.match(slice, /\btitle=/);
    assert.match(slice, /\bquote=/);
  }

  assert.match(learnCss, /\.learn-hero-quote \{[^}]*font-style:\s*italic/s);
  assert.match(learnCss, /\.learn-hero-quote \{[^}]*flex:\s*0 0 auto/s);
  assert.match(interviewCss, /\.page-hero-quote \{[^}]*font-style:\s*italic/s);
  assert.doesNotMatch(interviewCss, /open-quote/);
  assert.doesNotMatch(learnCss, /open-quote/);
  assert.doesNotMatch(engineeringCss, /open-quote/);
  assert.match(engineeringCss, /\.engineering-hero-quote \{[^}]*font-style:\s*italic/s);
  assert.doesNotMatch(learnCss, /\.learn-hero h1 em/);
  assert.doesNotMatch(interviewCss, /\.page-hero-copy h1 em/);
});

test("Learn hero metrics stay in the 50px summary band", async () => {
  const [learnCss, atmosphereCss] = await Promise.all([
    load("../app/learn-workspace.css"),
    load("../app/workspace-atmosphere.css"),
  ]);
  const learnRules = parseCss(learnCss);
  const atmosphereRules = parseCss(atmosphereCss);
  const hero = cssRules(learnRules, ".learn-hero").find((rule) => rule.ancestors.length === 0)?.declarations;
  const metrics = cssRules(learnRules, ".learn-hero-metrics").find((rule) => rule.ancestors.length === 0)?.declarations;
  const cells = cssRules(learnRules, ".learn-hero-metrics > div").find((rule) => rule.ancestors.length === 0)?.declarations;
  const values = cssRules(learnRules, ".learn-hero-metrics dd").find((rule) => rule.ancestors.length === 0)?.declarations;
  const stacked = cssRules(learnRules, ".learn-hero-metrics > div", "max-width: 680px").at(-1)?.declarations;

  assert.equal(hero?.display, "block");
  assert.equal(metrics?.position, "absolute");
  assert.equal(metrics?.bottom, "0");
  assert.equal(metrics?.height, "50px");
  assert.equal(metrics?.["min-height"], "50px");
  assert.equal(metrics?.["max-height"], "50px");
  assert.equal(metrics?.["z-index"], "3");
  assert.match(metrics?.background ?? "", /255,\s*255,\s*255/);
  assert.equal(cells?.["grid-template-columns"], "auto minmax(0, 1fr)");
  assert.equal(values?.order, "-1");
  assert.equal(values?.["white-space"], "nowrap");
  assert.equal(stacked?.["grid-template-columns"], "1fr");
  const stackedLabel = cssRules(learnRules, ".learn-hero-metrics dt", "max-width: 680px").at(-1)?.declarations;
  assert.equal(stackedLabel?.["white-space"], "normal");
  for (const rule of cssRules(atmosphereRules, ".app-shell.active-workspace-learn .learn-hero-metrics")) {
    if (rule.declarations.height) assert.equal(rule.declarations.height, "50px");
  }
  assert.doesNotMatch(learnCss, /learn-hero-metrics[^{]*\{[^}]*height:\s*64px/);
});

test("Career Materials stays readable at narrow widths", async () => {
  const css = await load("../app/globals.css");
  const rules = parseCss(css);
  const workspace = cssRules(rules, ".career-materials-workspace")[0]?.declarations;
  const trust = cssRules(rules, ".materials-trust-strip")[0]?.declarations;
  const handoff = cssRules(rules, ".materials-specialist-handoff")[0]?.declarations;

  assert.equal(workspace?.gap, "20px");
  assert.equal(trust?.["flex-wrap"], "wrap");
  assert.match(handoff?.["grid-template-columns"] ?? "", /minmax\(0, 1\.3fr\)/);
  assert.equal(cssRules(rules, ".materials-library-empty", "max-width: 900px").at(-1)?.declarations["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(cssRules(rules, ".materials-trust-strip", "max-width: 680px").at(-1)?.declarations["flex-direction"], "column");
});

test("Banks hero selector spans the full summary band and keeps one major-panel gap", async () => {
  const [heroCss, workspaceCss] = await Promise.all([
    load("../app/interview-page-hero.css"),
    load("../app/interview-arc-v2.css"),
  ]);
  const heroRules = parseCss(heroCss);
  const workspaceRules = parseCss(workspaceCss);
  const footer = cssRules(heroRules, ".page-hero-summary.interactive > .hero-bank-totals")[0]?.declarations;
  const totals = cssRules(heroRules, ".hero-bank-totals")[0]?.declarations;
  const closedRail = cssRules(workspaceRules, ".bank-domain-desks")[0]?.declarations;
  const openRail = cssRules(workspaceRules, ".bank-domain-desks:has(> .bank-domain-desk-shell.open)")[0]?.declarations;

  assert.equal(footer?.["grid-column"], "1 / -1");
  assert.equal(footer?.width, "100%");
  assert.equal(totals?.["grid-template-columns"], "repeat(3, minmax(0, 1fr))");
  assert.equal(closedRail?.margin, "0");
  assert.equal(openRail?.["margin-bottom"], "20px");
});

test("Loop archive disclosure remains one continuous surface without a horizontal rule", async () => {
  const rules = parseCss(await load("../app/loops-redesign.css"));
  const archiveControl = cssRules(rules, ".loop-switcher-list > label")[0]?.declarations;
  assert.equal(archiveControl?.border, "0");
  const spine = cssRules(rules, ".loops-workspace::before")[0]?.declarations;
  assert.equal(spine?.width, "1px");
  assert.equal(spine?.top, "350px");
  assert.equal(spine?.bottom, "44px");
  assert.equal(cssRules(rules, ".loop-identity-switcher::before")[0]?.declarations.content, "none");
  assert.equal(cssRules(rules, ".loop-support-band::before")[0]?.declarations.content, "none");
  assert.equal(cssRules(rules, ".loop-stage-chronology::before")[0]?.declarations.content, "none");
  const terminal = cssRules(rules, ".loop-stage-terminal > span")[0]?.declarations;
  assert.equal(terminal?.top, "50%");
  assert.equal(terminal?.transform, "translateY(-50%)");
});

test("Today and the private Loop source use the shared page rhythm and Loop accent", async () => {
  const [heroRules, loopRules] = await Promise.all([
    load("../app/interview-page-hero.css").then(parseCss),
    load("../app/loops-redesign.css").then(parseCss),
  ]);
  assert.equal(cssRules(heroRules, ".page-content > .interview-page-hero + .orchestrator-rail")[0]?.declarations["margin-top"], "20px");
  assert.match(cssRules(loopRules, ".loop-jd-dialog-header")[0]?.declarations["box-shadow"] ?? "", /var\(--page-accent\)/);
  assert.equal(cssRules(loopRules, ".loop-jd-overlay")[0]?.declarations["--page-accent"], "#a8415c");
  assert.equal(cssRules(loopRules, ".loop-jd-overlay")[0]?.declarations["--page-accent-soft"], "#fbe8ee");
  assert.equal(cssRules(loopRules, ".loop-jd-provenance")[0]?.declarations["border-radius"], "13px 13px 0 0");
  assert.equal(cssRules(loopRules, ".loop-jd-document")[0]?.declarations["border-radius"], "0 0 13px 13px");
});

test("Loop interview materials animate open and closed without a fixed content height", async () => {
  const [source, css] = await Promise.all([load("../app/loops-workspace.tsx"), load("../app/loops-redesign.css")]);
  const rules = parseCss(css);
  assert.match(source, /loop-material-body-shell \$\{open \? "open" : "closed"\}/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.equal(cssRules(rules, ".loop-material-body-shell")[0]?.declarations.display, "grid");
  assert.match(cssRules(rules, ".loop-material-body-shell")[0]?.declarations.transition ?? "", /grid-template-rows/);
  assert.equal(cssRules(rules, ".loop-material-body-shell.open")[0]?.declarations["grid-template-rows"], "1fr");
  assert.equal(cssRules(rules, ".loop-material-body-shell.closed")[0]?.declarations["grid-template-rows"], "0fr");
  assert.equal(cssRules(rules, ".loop-stage-material > .loop-material-body-shell")[0]?.declarations.padding, "0");
  assert.equal(cssRules(rules, ".loop-material-body")[0]?.declarations["min-height"], "0");
  assert.equal(cssRules(rules, ".loop-material-body-shell.closed > .loop-material-body")[0]?.declarations["padding-block"], "0");
});

test("an open reader owns an opaque paint layer and suspends ambient petals", async () => {
  const rules = parseCss(await load("../app/interview-arc-v2.css"));
  const petalField = cssRules(rules, "body:has(.reader-workspace) .petal-field")[0]?.declarations;
  const petals = cssRules(rules, "body:has(.reader-workspace) .ambient-petal")[0]?.declarations;
  const reader = cssRules(rules, ".reader-workspace")[0]?.declarations;

  assert.deepEqual(
    {
      opacity: petalField?.opacity,
      visibility: petalField?.visibility,
      transition: petalField?.transition,
    },
    { opacity: "0", visibility: "hidden", transition: "none" },
  );
  assert.equal(petals?.["animation-play-state"], "paused !important");
  assert.equal(reader?.isolation, "isolate");
  assert.equal(reader?.background, "#fffefb");
  assert.equal(reader?.["border-radius"], "14px");
  assert.equal(reader?.overflow, "hidden");
  assert.equal(cssRules(rules, ".reader-outline .toc-parent")[0]?.declarations["font-weight"], "inherit");
});

test("every workspace keeps timer, export, and connect in one tools menu", async () => {
  const source = await load("../app/home-client.tsx");
  assert.match(source, /<details className=\{`topbar-tools/);
  assert.match(source, /aria-label="Timer, export, and connect"/);
  assert.match(source, /className="topbar-tools-menu"/);
  assert.match(source, /<Icon name="link" \/>/);
  assert.match(source, /"Close timer" : "Pop out timer"/);
  assert.match(source, />Connect</);
  assert.match(source, />Export today</);
  assert.doesNotMatch(source, /topbar-tool-group/);
  assert.doesNotMatch(source, /<Icon name="clock"/);
  assert.doesNotMatch(source, /view === "today" && pipSupported/);
  assert.doesNotMatch(source, /activeWorkspace === "learn" \?\s*\(/);
  assert.doesNotMatch(source, /activeWorkspace === "engineering" \? null/);
});

test("narrow chrome hides the destination sidebar instead of squeezing it", async () => {
  const v2 = await load("../app/interview-arc-v2.css");
  const atmosphere = await load("../app/workspace-atmosphere.css");
  const source = await load("../app/home-client.tsx");
  assert.doesNotMatch(v2, /--sidebar-size:\s*82px/);
  assert.doesNotMatch(v2, /grid-template-columns:\s*82px minmax\(0, 1fr\)/);
  assert.doesNotMatch(v2, /grid-template-columns:\s*190px minmax\(0, 1fr\)/);
  assert.doesNotMatch(v2, /\.topbar > div:first-child span \{ display: none; \}/);
  assert.match(atmosphere, /@media \(max-width: 980px\)[\s\S]*\.app-shell \.sidebar \{ display: none;/);
  assert.match(atmosphere, /@media \(max-width: 980px\)[\s\S]*\.app-shell \.topbar-brand \{ display: grid;/);
  assert.doesNotMatch(source, /Show Journal index/);
  assert.doesNotMatch(source, /[》《]/);
  assert.doesNotMatch(source, /journalUserSet/);
  assert.match(source, /<details className=\{`topbar-tools/);
});

test("Engineering stepwise shell keeps compact contents, collapsing evidence, and a 50px music dock", async () => {
  const source = await load("../app/engineering-workspace.tsx");
  const styles = await load("../app/engineering-workspace.css");
  const atmosphere = await load("../app/workspace-atmosphere.css");
  assert.match(styles, /\.engineering-contents-nav button \{[\s\S]*border-radius:\s*999px/);
  assert.match(styles, /@media \(max-width: 1320px\)[\s\S]*evidence-closed \.engineering-evidence-panel \{ display: none;/);
  assert.match(styles, /\.engineering-panel-toggle/);
  assert.doesNotMatch(source, /Show Journal index/);
  assert.doesNotMatch(source, /journalUserSet/);
  assert.match(atmosphere, /\.music-dock \{[\s\S]*max-height:\s*40px/);
  assert.match(atmosphere, /\.topbar \{[\s\S]*height:\s*50px/);
  assert.match(atmosphere, /\.app-shell \.music-dock label,\s*\.app-shell \.music-dock i \{ display: none;/);
  assert.match(atmosphere, /flex: 0 0 auto/);
  assert.match(atmosphere, /\.app-shell \.atmosphere-toggle \{[\s\S]*width:\s*40px/);
  assert.match(atmosphere, /\.app-shell \.music-playlist > summary \{[\s\S]*width:\s*40px/);
  assert.match(atmosphere, /@media \(max-width: 1320px\)[\s\S]*\.music-playlist \{ display: none;/);
  assert.doesNotMatch(atmosphere, /@container topbar \(max-width: 1100px\)[\s\S]*\.topbar-context \{ visibility: hidden;/);
  assert.doesNotMatch(atmosphere, /\.app-shell \.topbar-context \{ display: none;/);
});

test("atmosphere toggle keeps one computed width in petals, rain, and off", async () => {
  const { source, rules } = await loadResponsiveShell();
  const atmosphereButton = source.match(/<button className=\{`atmosphere-toggle[\s\S]*?<\/button>/)?.[0];
  assert.ok(atmosphereButton);
  assert.match(atmosphereButton, /aria-label=\{`Atmosphere: \$\{atmosphereMode\}\. Switch atmosphere`\}/);
  assert.match(atmosphereButton, /title=\{`Atmosphere: \$\{atmosphereMode\}\. Switch atmosphere`\}/);
  assert.doesNotMatch(atmosphereButton, /atmosphere-toggle-label/);
  assert.doesNotMatch(atmosphereButton, />Petals</);
  assert.doesNotMatch(atmosphereButton, />Rain</);
  assert.doesNotMatch(atmosphereButton, /Atmosphere off/);

  const intrinsicByMode = { petals: 64, rain: 42, off: 118 };
  const desktop = Object.fromEntries(Object.entries(intrinsicByMode).map(([mode, intrinsic]) => [
    mode,
    usedBorderBoxWidth(cascadeAtmosphere(rules, mode), intrinsic),
  ]));
  assert.equal(desktop.petals, desktop.rain);
  assert.equal(desktop.rain, desktop.off);
  assert.equal(desktop.petals, 40);

  const compact = Object.fromEntries(Object.entries(intrinsicByMode).map(([mode, intrinsic]) => [
    mode,
    usedBorderBoxWidth(cascadeAtmosphere(rules, mode, "max-width: 480px"), intrinsic),
  ]));
  assert.equal(compact.petals, compact.rain);
  assert.equal(compact.rain, compact.off);
  assert.equal(compact.petals, 36);
});

test("playlist collapsed control is icon-only without Playlist text", async () => {
  const source = await load("../app/music-playlist.tsx");
  const summary = source.match(/<summary[\s\S]*?<\/summary>/)?.[0];
  assert.ok(summary);
  const dashboardSummary = summary.replace(/\{variant === "arrival" \? \([\s\S]*?\) : null\}/, "");
  assert.match(summary, /aria-label="Open today’s music playlist"/);
  assert.match(summary, /title="Open today’s music playlist"/);
  assert.doesNotMatch(dashboardSummary, />Playlist</);
  assert.doesNotMatch(dashboardSummary, /music-playlist-label/);
  assert.doesNotMatch(dashboardSummary, /<small>\{playlist\.length\}<\/small>/);
  assert.match(source, /\{playlist\.length\} tracks/);
});

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

async function loadResponsiveShell() {
  const [source, globals, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/globals.css"),
    load("../app/interview-arc-v2.css"),
  ]);
  return {
    source,
    file: parseTsx(source),
    rules: parseCss(`${globals}\n${css}`),
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

test("Review Queue keeps filters in the menu, branches each row, and joins its folio", async () => {
  const [source, css] = await Promise.all([load("../app/review-queue-view.tsx"), load("../app/review-queue.css")]);
  const file = parseTsx(source);
  const literals = stringLiterals(file);
  const rules = parseCss(css);
  assert.equal(literals.has("review-specialty-rail"), false);
  assert.ok(visit(file, (node) => ts.isJsxText(node) && node.text.trim() === "All").length >= 1);
  assert.ok(hasJsxClass(file, "review-specialty-menu"));
  assert.ok(cssRules(rules, ".review-row::before").length >= 1);
  assert.ok(cssRules(rules, ".review-row::after").length >= 1);
  assert.equal(hasJsxClass(file, "review-column-headings"), false);
  assert.equal(cssRules(rules, ".review-row")[0].declarations["grid-template-columns"], "44px minmax(0, 1fr) minmax(120px, auto) 96px");
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
  assert.ok(hasJsxClass(file, "review-specialty-menu"));
  assert.ok(hasJsxClass(file, "review-reader-unavailable"));
  assert.equal(hasJsxClass(home, "journey-reader-not-found review-reader-not-found"), false);
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

  assert.ok(hasJsxClass(file, "review-hero-copy"));
  assert.ok(hasJsxClass(file, "review-summary-strip"));
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
  assert.ok(cssRules(rules, ".review-icon-actions")[0]?.declarations.display);
  assert.equal(cssRules(rules, ".review-row")[0]?.declarations["grid-template-columns"], "44px minmax(0, 1fr) minmax(120px, auto) 96px");
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

  const appShell = cssRules(rules, ".app-shell:has(.review-queue-workspace)")[0]?.declarations;
  const mainColumn = cssRules(rules, ".main-column:has(.review-queue-workspace)")[0]?.declarations;
  const pageContent = cssRules(rules, ".page-content:has(> .review-queue-workspace)")[0]?.declarations;
  assert.equal(appShell?.height, "100dvh");
  assert.equal(appShell?.overflow, "hidden");
  assert.equal(mainColumn?.["grid-template-rows"], "auto minmax(0, 1fr)");
  assert.equal(pageContent?.overflow, "hidden");

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
  const stableSubscription = restoreEffects.find((effect) => effect.getText(home).includes('addEventListener("popstate"'));
  const hydratedRestore = restoreEffects.find((effect) => effect.getText(home).includes("readerRouteUnavailable"));
  assert.ok(stableSubscription);
  assert.match(stableSubscription.getText(home), /\}, \[\]\)/);
  assert.ok(hydratedRestore);
  assert.match(hydratedRestore.getText(home), /if \(!hydrated\) return/);
  assert.match(hydratedRestore.getText(home), /restoreWorkspaceLocationRef\.current = restoreWorkspaceLocation/);
  assert.match(hydratedRestore.getText(home), /readerNotFound/);
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

test("workspace selector contains exactly Interview, Learn, and Engineering", async () => {
  const { file, rules } = await loadResponsiveShell();
  const literals = stringLiterals(file);
  const workspaceNav = visit(file, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(file) === "className"
      && attribute.initializer?.getText(file) === '"workspace-nav"'))[0];
  assert.ok(workspaceNav);
  const workspaceLabels = visit(workspaceNav, (node) => ts.isJsxText(node))
    .map((node) => node.text.trim())
    .filter((value) => ["Interview", "Learn", "Engineering", "Journey"].includes(value));
  assert.deepEqual(workspaceLabels, ["Interview", "Learn", "Engineering"]);
  assert.equal(literals.has("Statistics"), false);
  assert.equal(literals.has("Recall schedule"), false);
  assert.ok(cssRules(rules, ".brand-mark").some((rule) => rule.declarations.background?.includes('/favicon.svg')));
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
  assert.match(source, /journey: "Interview · Journey"/);
  assert.doesNotMatch(source, /view !== "journey" && <nav className="mobile-interview-nav"/);
});

test("responsive shell keeps the workspace selector above the seven-item Interview dock", async () => {
  const { rules } = await loadResponsiveShell();
  const mobileSidebar = cssRules(rules, ".sidebar", "max-width: 900px").at(-1).declarations;
  assert.equal(mobileSidebar.position, "sticky");
  assert.equal(mobileSidebar.inset, "auto");
  assert.equal(mobileSidebar.top, "0");
  assert.equal(mobileSidebar.width, "100%");
  const interviewDock = cssRules(rules, ".mobile-interview-nav", "max-width: 900px").at(-1).declarations;
  assert.equal(interviewDock.position, "fixed");
  assert.equal(interviewDock.display, "grid");
  assert.equal(interviewDock["grid-template-columns"], "repeat(7, 1fr)");
  const compactDock = cssRules(rules, ".mobile-interview-nav", "max-width: 360px").at(-1).declarations;
  assert.equal(compactDock["grid-template-columns"], "repeat(4, minmax(0, 1fr))");
  assert.equal(cssRules(rules, ".mobile-interview-nav button", "max-width: 420px").at(-1).declarations["min-height"], "44px");
  assert.ok(cssRules(rules, ".topbar > div:last-child").some((rule) => rule.declarations["flex-wrap"] === "nowrap"));
  assert.equal(cssRules(rules, ".topbar .secondary-action", "max-width: 900px").at(-1).declarations.display, "none");
});

test("workspace header stacks the active tab above the Pacific date at every width", async () => {
  const { file, rules } = await loadResponsiveShell();
  const context = visit(file, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(file) === "className"
      && attribute.initializer?.getText(file) === '"topbar-context"'))[0];
  assert.ok(context);
  const elements = context.children.filter(ts.isJsxElement);
  assert.deepEqual(elements.map((element) => element.openingElement.tagName.getText(file)), ["strong", "span"]);
  assert.equal(elements[0].children[0]?.getText(file), "{INTERVIEW_VIEW_TITLES[view]}");
  assert.equal(elements[1].children[0]?.getText(file), "{readableDate(journal.date)}");

  const contextStyle = cssRules(rules, ".topbar > div:first-child")
    .find((rule) => rule.declarations["align-content"] === "center")?.declarations;
  assert.ok(contextStyle);
  assert.equal(contextStyle.display, "grid");
  assert.equal(contextStyle["align-content"], "center");

  const narrowDate = cssRules(rules, ".topbar > div:first-child span", "max-width: 680px").at(-1).declarations;
  assert.notEqual(narrowDate.display, "none");
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

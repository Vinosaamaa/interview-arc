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
  assert.ok(cssRules(rules, ".review-row::before").length >= 1);
  assert.ok(cssRules(rules, ".review-row::after").length >= 1);
  assert.equal(cssRules(rules, ".review-column-headings")[0].declarations["grid-template-columns"], "var(--review-columns)");
  assert.equal(cssRules(rules, ".review-row")[0].declarations["grid-template-columns"], "var(--review-columns)");
  const folioRules = cssRules(rules, ".review-selection-folio");
  assert.equal(folioRules[0].declarations.position, "relative");
  assert.equal(folioRules.some((rule) => rule.declarations.position === "sticky"), false);
  assert.equal(folioRules.some((rule) => rule.declarations.bottom === "78px"), false);
});

test("responsive shell switches directly to the mobile dock and keeps one topbar row", async () => {
  const [source, css] = await Promise.all([load("../app/home-client.tsx"), load("../app/interview-arc-v2.css")]);
  const file = parseTsx(source);
  const literals = stringLiterals(file);
  const rules = parseCss(css);
  assert.equal(literals.has("Statistics"), false);
  assert.equal(literals.has("Recall schedule"), false);
  assert.ok(cssRules(rules, ".brand-mark").some((rule) => rule.declarations.background?.includes('/favicon.svg')));
  const mobileSidebar = cssRules(rules, ".sidebar", "max-width: 900px").at(-1).declarations;
  assert.equal(mobileSidebar.position, "fixed");
  assert.equal(mobileSidebar.inset, "auto 10px 10px");
  assert.equal(mobileSidebar["backdrop-filter"], "none");
  assert.ok(cssRules(rules, ".topbar > div:last-child").some((rule) => rule.declarations["flex-wrap"] === "nowrap"));
  assert.equal(cssRules(rules, ".topbar .secondary-action", "max-width: 900px").at(-1).declarations.display, "inline-flex");
});

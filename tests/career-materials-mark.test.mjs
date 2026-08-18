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

function jsxChildTag(file, node) {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(file);
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(file);
  if (ts.isJsxText(node)) return node.getText(file).trim();
  return node.getText(file);
}

test("Career Materials rail uses a folio mark instead of CM letters", async () => {
  const [homeSource, markSource, markCss, globals, atmosphere] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/career-materials-mark.tsx"),
    load("../app/career-materials-mark.css"),
    load("../app/globals.css"),
    load("../app/workspace-atmosphere.css"),
  ]);
  const home = parseTsx(homeSource);
  const mark = parseTsx(markSource);

  const materialsNav = visit(home, (node) => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(home) === "nav"
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(home) === "className"
      && attribute.initializer?.getText(home) === '"materials-nav"'))[0];
  assert.ok(materialsNav);
  const button = materialsNav.children.find((child) => ts.isJsxElement(child)
    && child.openingElement.tagName.getText(home) === "button");
  assert.ok(button);
  const children = button.children.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
  assert.deepEqual(children.map((child) => jsxChildTag(home, child)), [
    "CareerMaterialsMark",
    "span",
  ]);
  const copy = children[1];
  assert.ok(ts.isJsxElement(copy));
  assert.ok(copy.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
    && attribute.name.getText(home) === "className"
    && attribute.initializer?.getText(home) === '"materials-copy"'));
  const copyChildren = copy.children.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
  assert.deepEqual(copyChildren.map((child) => jsxChildTag(home, child)), [
    "strong",
    "small",
  ]);
  assert.equal(copyChildren[0].children[0]?.getText(home), "Career Materials");
  assert.equal(copyChildren[1].children[0]?.getText(home), "Private");
  assert.doesNotMatch(homeSource, /materials-head/);

  const markRoot = visit(mark, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(mark) === "className"
      && attribute.initializer?.getText(mark) === '"career-materials-mark"'))[0];
  assert.ok(markRoot);
  const svg = markRoot.children.find((child) => ts.isJsxElement(child)
    && child.openingElement.tagName.getText(mark) === "svg");
  assert.ok(svg);
  const markText = visit(mark, (node) => ts.isJsxText(node) && node.getText(mark).trim() !== "")
    .map((node) => node.getText(mark).trim());
  assert.deepEqual(markText, []);
  assert.equal(markText.includes("CM"), false);

  const rules = parseCss(globals);
  const materialsButton = cssRules(rules, ".materials-nav button")[0]?.declarations;
  assert.equal(materialsButton?.["grid-template-columns"], "28px minmax(0, 1fr)");
  assert.equal(materialsButton?.["align-items"], "center");
  const materialsMark = cssRules(rules, ".materials-nav .career-materials-mark")[0]?.declarations;
  assert.equal(materialsMark?.width, "28px");
  assert.equal(materialsMark?.height, "28px");
  assert.equal(materialsMark?.["align-self"], "center");
  assert.doesNotMatch(globals, /\.materials-nav button small \{[^}]*width: 100%/s);

  assert.doesNotMatch(homeSource, /aria-hidden="true">CM</);
  assert.doesNotMatch(markSource, />CM</);
  assert.doesNotMatch(markSource, /["']CM["']/);
  assert.doesNotMatch(markCss, /content:\s*["']CM["']/);
  assert.doesNotMatch(globals, /\.materials-nav button > span \{[^}]*content:\s*["']CM["']/s);
  assert.match(markCss, /\.materials-nav \.career-materials-mark-stitch/);
  assert.match(globals, /\.materials-nav \.career-materials-mark \{[^}]*place-items: center/s);
  assert.match(atmosphere, /\.app-shell \.materials-nav button \{\s*grid-template-columns: 28px minmax\(0, 1fr\);/);
  assert.doesNotMatch(globals, /\.materials-nav button > span \{[^}]*font-family: var\(--font-geist-mono\)/s);
});

test("980px Interview dock still hides the sidebar and keeps seven items", async () => {
  const [homeSource, globals, atmosphere] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/globals.css"),
    load("../app/workspace-atmosphere.css"),
  ]);
  const rules = parseCss(`${globals}\n${atmosphere}`);
  assert.equal(cssRules(rules, ".app-shell .sidebar", "max-width: 980px").at(-1).declarations.display, "none");
  const interviewDock = cssRules(rules, ".mobile-interview-nav", "max-width: 980px").at(-1).declarations;
  assert.equal(interviewDock.display, "grid");
  assert.equal(interviewDock["grid-template-columns"], "repeat(7, minmax(0, 1fr))");
  assert.match(homeSource, /className=\{view === "materials" \? "active materials" : "materials"\}/);
  assert.match(homeSource, />Materials<\/button>/);
  assert.doesNotMatch(homeSource, /"materials"[^>]*>CM</);
});

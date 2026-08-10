import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = ["app", "db", "mcp-worker", "worker"];
const sourceExtensions = [".ts", ".tsx"];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.includes(extname(path)) ? [path] : [];
  }));
  return nested.flat();
}

async function resolveSourceImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(importer), specifier);
  for (const path of [
    candidate,
    ...sourceExtensions.map((extension) => `${candidate}${extension}`),
    ...sourceExtensions.map((extension) => join(candidate, `index${extension}`)),
  ]) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  return null;
}

test("website command imports remain acyclic and the HTTP adapter stays behind the command Module", async () => {
  const files = (await Promise.all(sourceRoots.map((root) => sourceFiles(join(project, root))))).flat();
  const graph = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const specifiers = [...source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)]
      .map((match) => match[1]);
    const dependencies = await Promise.all(specifiers.map((specifier) => resolveSourceImport(file, specifier)));
    graph.set(file, dependencies.filter(Boolean));
  }

  const visiting = new Set();
  const visited = new Set();
  const path = [];
  function visit(file) {
    if (visiting.has(file)) {
      const cycleStart = path.indexOf(file);
      assert.fail(`Import cycle: ${[...path.slice(cycleStart), file].map((item) => relative(project, item)).join(" -> ")}`);
    }
    if (visited.has(file)) return;
    visiting.add(file);
    path.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    path.pop();
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of files) visit(file);

  const route = await readFile(join(project, "app/api/mutations/route.ts"), "utf8");
  assert.match(route, /executePracticeStateCommand/);
  for (const forbidden of ["durable-practice", "practice-snapshot", "today-planning-policy"]) {
    assert.doesNotMatch(route, new RegExp(`from ["'][^"']*${forbidden}`));
  }
});

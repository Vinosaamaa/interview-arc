import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEngineeringJournal } from "../engineering-journal/index.ts";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(REPOSITORY_ROOT, "engineering-journal", "trusted-sources.json");
const OUTPUTS = {
  normalizedJson: join(REPOSITORY_ROOT, "engineering-journal", "generated", "index.json"),
  standaloneHtml: join(REPOSITORY_ROOT, "engineering-journal", "generated", "standalone.html"),
};
const check = process.argv.includes("--check");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function portablePath(root, path) {
  return relative(root, path).split(sep).join("/");
}

async function markdownPaths(root, canonicalPath) {
  const directory = join(root, canonicalPath);
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownPaths(root, portablePath(root, path)));
    if (entry.isFile() && entry.name.endsWith(".md")) paths.push(portablePath(root, path));
  }
  return paths.sort();
}

async function sourceDocuments(repository) {
  const root = resolve(REPOSITORY_ROOT, repository.localRoot);
  const commitPin = repository.commit ?? null;
  const paths = commitPin
    ? git(root, ["ls-tree", "-r", "--name-only", commitPin, "--", repository.canonicalPath]).split("\n").filter((path) => path.endsWith(".md"))
    : await markdownPaths(root, repository.canonicalPath);
  const documents = [];
  for (const path of paths) {
    const commit = commitPin ?? git(root, ["log", "-1", "--format=%H", "--", path]);
    if (!commit) throw new Error(`No committed source revision exists for ${repository.repository}:${path}.`);
    const markdown = git(root, ["show", `${commit}:${path}`]);
    if (!commitPin) {
      const authored = await readFile(join(root, path), "utf8");
      if (authored.replace(/\n$/, "") !== markdown) {
        throw new Error(`Canonical record ${repository.repository}:${path} differs from its latest committed revision.`);
      }
    }
    documents.push({ repository: repository.repository, commit, path, markdown: `${markdown}\n` });
  }
  return documents;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (config.schemaVersion !== 1 || !Array.isArray(config.repositories)) {
    throw new Error("Engineering Journal trusted source configuration is invalid.");
  }
  const documents = (await Promise.all(config.repositories.map(sourceDocuments))).flat();
  const build = buildEngineeringJournal({
    trustedRepositories: config.repositories.map(({ repository, owner, canonicalPath, commit }) => ({ repository, owner, canonicalPath, commit })),
    documents,
  });
  for (const [key, outputPath] of Object.entries(OUTPUTS)) {
    const expected = build[key];
    if (check) {
      let actual = null;
      try { actual = await readFile(outputPath, "utf8"); } catch {}
      if (actual !== expected) throw new Error(`Generated Engineering Journal output is stale: ${portablePath(REPOSITORY_ROOT, outputPath)}.`);
    } else {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, expected, "utf8");
    }
  }
  process.stdout.write(`Engineering Journal: ${build.index.records.length} record(s), ${check ? "outputs current" : "outputs written"}.\n`);
}

await main();

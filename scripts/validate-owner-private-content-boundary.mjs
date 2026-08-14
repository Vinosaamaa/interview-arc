import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseContentMarkdownDocument } from "./content-source.mjs";

const manifestPath = "docs/contracts/legacy-owner-private-content-manifest.json";
const privateDirectories = [
  ["data/daily", ".json"],
  ["audio-answers", ".md"],
  ["practice/behavioral/sessions", ".md"],
  ["practice/behavioral/story-bank/projects", ".md"],
  ["practice/leetcode/attempts", ".md"],
  ["practice/system-design/sessions", ".md"],
];
const solutionDirectories = [
  "practice/behavioral/solutions",
  "practice/leetcode/solutions",
  "practice/system-design/solutions",
];

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function filesBelow(root, relativeDirectory) {
  const files = [];
  const pending = [relativeDirectory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(path.join(root, current), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = normalize(path.join(current, entry.name));
      if (entry.isDirectory()) pending.push(relativePath);
      else if (entry.isFile() && entry.name !== ".gitkeep" && entry.name !== "README.md") files.push(relativePath);
    }
  }
  return files.sort();
}

async function detectedPrivatePaths(root) {
  const paths = (await Promise.all(privateDirectories.map(async ([directory, extension]) =>
    (await filesBelow(root, directory)).filter((relativePath) => path.extname(relativePath) === extension)
  ))).flat();
  const solutions = (await Promise.all(solutionDirectories.map((directory) => filesBelow(root, directory)))).flat();
  for (const relativePath of solutions.filter((candidate) => path.extname(candidate) === ".md")) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    const { frontmatter } = parseContentMarkdownDocument(source);
    if (/profile-revision/i.test(path.basename(relativePath)) || frontmatter.solution_profile_revision !== undefined) {
      paths.push(relativePath);
    }
  }
  return [...new Set(paths)].sort();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateOwnerPrivateContentBoundary(root) {
  const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error("Legacy owner-private content manifest must use schemaVersion 1 and an entries array.");
  }

  const entries = [...manifest.entries].sort((left, right) => left.path.localeCompare(right.path));
  if (entries.some((entry, index) => entry.path !== manifest.entries[index]?.path)) {
    throw new Error("Legacy owner-private content manifest entries must be sorted by path.");
  }
  const expected = new Map();
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || path.isAbsolute(entry.path) || entry.path.includes("..")) {
      throw new Error("Legacy owner-private content manifest contains an invalid entry.");
    }
    if (expected.has(entry.path)) throw new Error("Legacy owner-private content manifest contains a duplicate path.");
    expected.set(entry.path, entry.sha256);
  }

  const actualPaths = await detectedPrivatePaths(root);
  const actualPathSet = new Set(actualPaths);
  for (const relativePath of actualPaths) {
    const expectedHash = expected.get(relativePath);
    if (!expectedHash) {
      throw new Error("New owner-private Git content is forbidden under a protected content root.");
    }
    const actualHash = sha256(await readFile(path.join(root, relativePath)));
    if (actualHash !== expectedHash) {
      throw new Error("Legacy owner-private Git content is immutable; a frozen file changed.");
    }
  }
  for (const relativePath of expected.keys()) {
    if (!actualPathSet.has(relativePath)) {
      throw new Error("Legacy owner-private content manifest contains a missing frozen file.");
    }
  }

  return { checked: actualPaths.length, frozenAtCommit: manifest.frozenAtCommit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const receipt = await validateOwnerPrivateContentBoundary(root);
  console.log(`Owner-private Git boundary verified for ${receipt.checked} frozen legacy file(s).`);
}

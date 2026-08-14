import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = "docs/contracts/legacy-owner-private-content-manifest.json";
const privateDirectories = [
  "data/daily",
  "audio-answers",
  "practice/behavioral/sessions",
  "practice/behavioral/story-bank/projects",
  "practice/leetcode/attempts",
  "practice/system-design/sessions",
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
  const directory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = normalize(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) return filesBelow(root, relativePath);
    if (!entry.isFile() || entry.name === ".gitkeep" || entry.name === "README.md") return [];
    return [relativePath];
  }));
  return nested.flat();
}

async function detectedPrivatePaths(root) {
  const paths = (await Promise.all(privateDirectories.map((directory) => filesBelow(root, directory)))).flat();
  const solutions = (await Promise.all(solutionDirectories.map((directory) => filesBelow(root, directory)))).flat();
  paths.push(...solutions.filter((relativePath) => /profile-revision/i.test(path.basename(relativePath))));
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
    if (!actualPaths.includes(relativePath)) {
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

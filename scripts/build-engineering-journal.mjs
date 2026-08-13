import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEngineeringJournal } from "../engineering-journal/index.ts";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(REPOSITORY_ROOT, "engineering-journal", "trusted-sources.json");
const OUTPUTS = {
  normalizedJson: join(REPOSITORY_ROOT, "engineering-journal", "generated", "index.json"),
  standaloneHtml: join(REPOSITORY_ROOT, "engineering-journal", "generated", "standalone.html"),
};
const DIAGRAM_ASSET_ROOT = join(REPOSITORY_ROOT, "public", "engineering-journal", "assets");
const SOURCE_CACHE_ROOT = join(REPOSITORY_ROOT, ".cache", "engineering-journal", "git");
const check = process.argv.includes("--check");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitBlob(root, commit, path) {
  return execFileSync("git", ["-C", root, "show", `${commit}:${path}`], { encoding: null, stdio: ["ignore", "pipe", "pipe"] });
}

function portablePath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function inlineDiagramDescriptors(markdown) {
  const closing = markdown.indexOf("\n---\n", 4);
  if (!markdown.startsWith("---\n") || closing < 0) return [];
  const line = markdown.slice(4, closing).split("\n").find((entry) => entry.startsWith("diagrams:"));
  if (!line) return [];
  try {
    const value = JSON.parse(line.slice(line.indexOf(":") + 1).trim());
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function committedDiagramAssets(root, documents) {
  const assets = [];
  for (const [documentIndex, document] of documents.entries()) {
    for (const [diagramIndex, diagram] of inlineDiagramDescriptors(document.markdown).entries()) {
      let renderedBytes = null;
      let renderedPath = null;
      for (const key of ["sourcePath", "renderedPath"]) {
        const path = diagram && typeof diagram === "object" ? diagram[key] : null;
        if (typeof path !== "string" || !path.startsWith("docs/design/")) continue;
        try {
          if (git(root, ["cat-file", "-t", `${document.commit}:${path}`]) !== "blob") throw new Error("not-blob");
        } catch {
          throw new Error(`Engineering Journal diagram asset ${documentIndex + 1}.${diagramIndex + 1} is not a committed Git blob at the record revision.`);
        }
        if (key === "renderedPath") {
          renderedPath = path;
          renderedBytes = gitBlob(root, document.commit, path);
        }
      }
      if (renderedPath && renderedBytes) {
        assets.push({ repository: document.repository, commit: document.commit, renderedPath, bytes: renderedBytes });
      }
    }
  }
  return assets;
}

function diagramAssetPath(asset) {
  return join(DIAGRAM_ASSET_ROOT, asset.repository, asset.commit, asset.renderedPath);
}

async function allFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const paths = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await allFiles(path));
    if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

async function projectDiagramAssets(assets) {
  const byPath = new Map();
  for (const asset of assets) {
    const path = diagramAssetPath(asset);
    const prior = byPath.get(path);
    if (prior && !prior.equals(asset.bytes)) throw new Error("Engineering Journal diagram asset collision.");
    byPath.set(path, asset.bytes);
  }
  const expectedPaths = [...byPath.keys()].sort();
  if (check) {
    const actualPaths = await allFiles(DIAGRAM_ASSET_ROOT);
    if (actualPaths.length !== expectedPaths.length || actualPaths.some((path, index) => path !== expectedPaths[index])) {
      throw new Error("Generated Engineering Journal diagram asset set is stale.");
    }
    for (const path of expectedPaths) {
      if (!(await readFile(path)).equals(byPath.get(path))) {
        throw new Error(`Generated Engineering Journal diagram asset is stale: ${portablePath(REPOSITORY_ROOT, path)}.`);
      }
    }
    return;
  }
  await rm(DIAGRAM_ASSET_ROOT, { recursive: true, force: true });
  for (const path of expectedPaths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, byPath.get(path));
  }
}

async function markdownPaths(root, canonicalPath) {
  const directory = join(root, canonicalPath);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownPaths(root, portablePath(root, path)));
    if (entry.isFile() && entry.name.endsWith(".md")) paths.push(portablePath(root, path));
  }
  return paths.sort();
}

async function sourceDocuments(repository) {
  if (Boolean(repository.localRoot) === Boolean(repository.remoteUrl)) {
    throw new Error(`Engineering Journal source ${repository.repository} must declare exactly one portable source.`);
  }
  if (repository.remoteUrl && (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository.remoteUrl) || !repository.commit)) {
    throw new Error(`Engineering Journal remote source ${repository.repository} requires a trusted GitHub URL and exact commit.`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(repository.repository)) {
    throw new Error("Engineering Journal source repository identity is invalid.");
  }
  const root = repository.remoteUrl
    ? join(SOURCE_CACHE_ROOT, repository.repository)
    : resolve(REPOSITORY_ROOT, repository.localRoot);
  const commitPin = repository.commit ?? null;
  if (repository.remoteUrl) {
    await mkdir(root, { recursive: true });
    const repositoryRoot = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (repositoryRoot.status !== 0 || resolve(repositoryRoot.stdout.trim()) !== root) {
      git(root, ["init", "--quiet"]);
    }
    const remote = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (remote.status === 0 && remote.stdout.trim() !== repository.remoteUrl) {
      throw new Error(`Engineering Journal cache remote mismatch for ${repository.repository}.`);
    }
    if (remote.status !== 0) {
      git(root, ["remote", "add", "origin", repository.remoteUrl]);
    }
    if (spawnSync("git", ["-C", root, "cat-file", "-e", `${commitPin}^{commit}`], { stdio: "ignore" }).status !== 0) {
      const fetch = spawnSync("git", ["-C", root, "fetch", "--quiet", "--no-tags", "origin", commitPin], {
        stdio: "ignore",
      });
      if (fetch.status !== 0) {
        throw new Error(`Engineering Journal remote source ${repository.repository} exact commit is unavailable and not cached.`);
      }
      if (git(root, ["rev-parse", "FETCH_HEAD"]) !== commitPin) {
        throw new Error(`Engineering Journal remote source ${repository.repository} did not resolve to its exact commit.`);
      }
    }
    if (git(root, ["rev-parse", commitPin]) !== commitPin) {
      throw new Error(`Engineering Journal remote source ${repository.repository} cache does not contain its exact commit.`);
    }
  }
  const trustedCommit = commitPin ?? git(root, ["rev-parse", "HEAD"]);
  const pathsAt = async (canonicalPath) => commitPin
    ? git(root, ["ls-tree", "-r", "--name-only", commitPin, "--", canonicalPath]).split("\n").filter((path) => path.endsWith(".md"))
    : await markdownPaths(root, canonicalPath);
  const documentsAt = async (canonicalPath, kind) => {
    const paths = await pathsAt(canonicalPath);
    const documents = [];
    for (const path of paths) {
      const commit = git(root, ["log", "-1", "--format=%H", trustedCommit, "--", path]);
      if (!commit) throw new Error(`No committed ${kind} source revision exists for ${repository.repository}:${path}.`);
      const markdown = git(root, ["show", `${commit}:${path}`]);
      if (git(root, ["rev-parse", `${commit}:${path}`]) !== git(root, ["rev-parse", `${trustedCommit}:${path}`]) ||
          spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", commit, trustedCommit]).status !== 0) {
        throw new Error(`Canonical ${kind} provenance is not reachable from the trusted repository snapshot.`);
      }
      if (!commitPin) {
        const authored = await readFile(join(root, path), "utf8");
        if (authored.replace(/\n$/, "") !== markdown) {
          throw new Error(`Canonical ${kind} ${repository.repository}:${path} differs from its latest committed revision.`);
        }
      }
      const committedAt = new Date(git(root, ["show", "-s", "--format=%cI", commit])).toISOString().replace(".000Z", "Z");
      documents.push({ repository: repository.repository, trustedCommit: commitPin ?? undefined, commit, committedAt, path, markdown: `${markdown}\n` });
    }
    return documents;
  };
  const documents = await documentsAt(repository.canonicalPath, "Engineering record");
  if (documents.length === 0) throw new Error(`Engineering Journal source ${repository.repository} contains no canonical records.`);
  const diagramAssets = committedDiagramAssets(root, documents);
  const receiptDocuments = repository.receiptPath
    ? await documentsAt(repository.receiptPath, "pull request receipt")
    : [];
  return { documents, receiptDocuments, diagramAssets };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (config.schemaVersion !== 1 || !Array.isArray(config.repositories)) {
    throw new Error("Engineering Journal trusted source configuration is invalid.");
  }
  const sources = await Promise.all(config.repositories.map(sourceDocuments));
  const documents = sources.flatMap((source) => source.documents);
  const receiptDocuments = sources.flatMap((source) => source.receiptDocuments);
  const diagramAssets = sources.flatMap((source) => source.diagramAssets);
  const build = buildEngineeringJournal({
    trustedRepositories: config.repositories.map(({ repository, owner, canonicalPath, receiptPath, commit }) => ({ repository, owner, canonicalPath, receiptPath, commit })),
    documents,
    receiptDocuments,
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
  await projectDiagramAssets(diagramAssets);
  process.stdout.write(`Engineering Journal: ${build.index.records.length} rich record(s), ${build.index.pullRequestReceipts.length} PR receipt(s), ${check ? "outputs current" : "outputs written"}.\n`);
}

await main();

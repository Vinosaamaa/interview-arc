#!/usr/bin/env node

import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.env.INTERVIEW_ARC_REPO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? (result.stderr || result.stdout).trim() : "";
    throw new Error(detail || `git ${args.join(" ")} failed`);
  }
  return options.capture ? result.stdout.trimEnd() : result.status === 0;
}

export function journalBranch(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use an ISO date: YYYY-MM-DD.");
  return `journal/${date}`;
}

export function isJournalPath(file, date) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized === `data/daily/${date}.json`) return true;
  if (normalized.startsWith(`practice/leetcode/attempts/${date}-`) && normalized.endsWith(".md")) return true;
  if (normalized.startsWith(`practice/system-design/sessions/${date}-`) && normalized.endsWith(".md")) return true;
  if (normalized.startsWith(`practice/behavioral/sessions/${date}-`) && normalized.endsWith(".md")) return true;
  if (normalized.startsWith("practice/behavioral/story-bank/") && normalized.endsWith(".md")) return true;
  if (normalized.startsWith("audio-answers/") && normalized.endsWith(".md")) return true;
  return false;
}

export function parsePorcelain(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1));
}

function hasRef(ref) {
  return spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: ROOT }).status === 0;
}

function switchToJournalBranch(branch) {
  const localRef = `refs/heads/${branch}`;
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (hasRef(localRef)) {
    git(["switch", branch]);
    return;
  }
  if (hasRef(remoteRef)) {
    git(["switch", "--track", "-c", branch, `origin/${branch}`]);
    return;
  }
  const base = hasRef("refs/remotes/origin/main") ? "origin/main" : "main";
  git(["switch", "-c", branch, base]);
}

function checkpoint({ date, area }) {
  const branch = journalBranch(date);
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], { capture: true });
  const changedPaths = parsePorcelain(status);
  const unrelated = changedPaths.filter((file) => !isJournalPath(file, date));
  if (unrelated.length) {
    throw new Error(
      `Refusing to move journal files while unrelated work is uncommitted:\n${unrelated.map((file) => `- ${file}`).join("\n")}\nAsk the coordinator to finish or commit that work first.`,
    );
  }

  const journalPaths = changedPaths.filter((file) => isJournalPath(file, date));
  if (!journalPaths.length) {
    console.log(`No new ${date} journal files to checkpoint; branch unchanged.`);
    return;
  }

  switchToJournalBranch(branch);
  git(["add", "--", ...journalPaths]);
  const staged = git(["diff", "--cached", "--name-only"], { capture: true });
  if (!staged) {
    console.log(`No staged journal changes on ${branch}.`);
    return;
  }
  git(["commit", "-m", `journal(${date}): checkpoint ${area}`]);
  console.log(`Checkpointed ${area} publication on ${branch}.`);
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function main() {
  const command = process.argv[2];
  if (command !== "checkpoint") {
    throw new Error("Usage: pnpm journal:checkpoint -- --date YYYY-MM-DD --area leetcode|system-design|behavioral");
  }
  const date = argument("date");
  const area = argument("area", "practice");
  if (!date) throw new Error("Missing --date YYYY-MM-DD.");
  if (!["leetcode", "system-design", "behavioral", "practice"].includes(area)) throw new Error("Invalid --area value.");

  const gitDir = git(["rev-parse", "--git-dir"], { capture: true });
  const lock = path.resolve(ROOT, gitDir, "interview-arc-journal.lock");
  try {
    mkdirSync(lock);
  } catch {
    throw new Error("Another journal checkpoint is already running. Wait for it to finish and retry.");
  }
  try {
    checkpoint({ date, area });
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

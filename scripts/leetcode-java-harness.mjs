#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_QUICK_CASES = 64;
const MAX_FULL_CASES = 256;
const MAX_CASE_NAME_LENGTH = 160;
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;
const ACTIVITY_LOCK_TIMEOUT_MS = 70_000;
const STALE_ACTIVITY_LOCK_MS = 120_000;

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new CliError(message, exitCode);
}

function argsFrom(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    if (token === "--full") {
      options.set("full", true);
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${token}`);
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  const value = options.get(name);
  if (!value) fail(`Missing required --${name}.`);
  return value;
}

function safeActivityId(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(value)) {
    fail("Activity ID must be a lowercase stable ID containing only letters, numbers, and hyphens.");
  }
  return value;
}

function stateRoot() {
  return process.env.INTERVIEW_ARC_HARNESS_ROOT
    ? path.resolve(process.env.INTERVIEW_ARC_HARNESS_ROOT)
    : path.join(os.homedir(), "Library", "Caches", "InterviewArc", "leetcode-java-harnesses");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function generationPaths(activityId, generationId) {
  const activityDirectory = path.join(stateRoot(), activityId);
  const generationDirectory = path.join(activityDirectory, "generations", generationId);
  return {
    activityDirectory,
    activeFile: path.join(activityDirectory, "active.json"),
    generationDirectory,
    statusFile: path.join(generationDirectory, "status.json"),
    stagingDirectory: path.join(generationDirectory, "staging"),
    publishedDirectory: path.join(generationDirectory, "published"),
  };
}

async function activityLock(activityId) {
  const activityDirectory = path.join(stateRoot(), activityId);
  const lockDirectory = path.join(activityDirectory, ".state-lock");
  const deadline = Date.now() + ACTIVITY_LOCK_TIMEOUT_MS;
  await mkdir(activityDirectory, { recursive: true, mode: 0o700 });
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      try {
        await atomicJson(path.join(lockDirectory, "owner.json"), {
          schemaVersion: 1,
          pid: process.pid,
          createdAt: Date.now(),
        });
      } catch (error) {
        await rm(lockDirectory, { recursive: true, force: true });
        throw error;
      }
      return async () => rm(lockDirectory, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockStat = await stat(lockDirectory).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs >= STALE_ACTIVITY_LOCK_MS) {
        await rm(lockDirectory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        fail("Timed out waiting for another harness operation on this activity to finish.", 75);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function withActivityLock(activityId, operation) {
  const release = await activityLock(activityId);
  try {
    return await operation();
  } finally {
    await release();
  }
}

function runCommand(activityId, generationId, full = false) {
  const command = `node ${JSON.stringify(SCRIPT_PATH)} run --activity-id ${activityId} --generation-id ${generationId}`;
  return full ? `${command} --full` : command;
}

function stateCommand(command, activityId, generationId) {
  return `node ${JSON.stringify(SCRIPT_PATH)} ${command} --activity-id ${activityId} --generation-id ${generationId}`;
}

async function prepare(options) {
  const activityId = safeActivityId(required(options, "activity-id"));
  const problemSignature = required(options, "signature").trim();
  const sourceFile = path.resolve(required(options, "source"));
  const preparationTimeoutMs = options.has("preparation-timeout-ms")
    ? Number(options.get("preparation-timeout-ms"))
    : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(preparationTimeoutMs) || preparationTimeoutMs < 50 || preparationTimeoutMs > 30 * 60 * 1000) {
    fail("Preparation timeout must be an integer from 50 through 1800000 milliseconds.");
  }
  if (!problemSignature) fail("Problem signature cannot be empty.");
  const sourceStat = await stat(sourceFile).catch(() => null);
  if (!sourceStat?.isFile()) fail(`Java source file does not exist: ${sourceFile}`);

  return withActivityLock(activityId, async () => {
    const signatureHash = sha256(problemSignature);
    const generationId = signatureHash.slice(0, 20);
    const paths = generationPaths(activityId, generationId);
    await mkdir(paths.generationDirectory, { recursive: true, mode: 0o700 });

    let created = false;
    let status;
    try {
      const handle = await open(paths.statusFile, "wx", 0o600);
      const createdAt = Date.now();
      status = {
        schemaVersion: 1,
        activityId,
        generationId,
        problemSignature,
        signatureHash,
        sourceFile,
        status: "preparing",
        createdAt,
        deadlineAt: createdAt + preparationTimeoutMs,
        updatedAt: createdAt,
      };
      await handle.writeFile(`${JSON.stringify(status, null, 2)}\n`);
      await handle.close();
      await mkdir(paths.stagingDirectory, { recursive: true, mode: 0o700 });
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      status = await readJson(paths.statusFile);
    }

    const previousActive = await readJson(paths.activeFile).catch(() => null);
    if (previousActive?.generationId && previousActive.generationId !== generationId) {
      const previousPaths = generationPaths(activityId, previousActive.generationId);
      const previousStatus = await readJson(previousPaths.statusFile).catch(() => null);
      if (previousStatus && previousStatus.status !== "stale") {
        await atomicJson(previousPaths.statusFile, {
          ...previousStatus,
          previousStatus: previousStatus.status,
          status: "stale",
          staleReason: "The verified problem starter signature changed.",
          updatedAt: Date.now(),
        });
      }
    }
    await atomicJson(paths.activeFile, {
      schemaVersion: 1,
      activityId,
      generationId,
      signatureHash,
      updatedAt: Date.now(),
    });

    process.stdout.write(`${JSON.stringify({
      activityId,
      generationId,
      signatureHash,
      status: status.status,
      created,
      statusFile: paths.statusFile,
      stagingDirectory: paths.stagingDirectory,
      deadlineAt: status.deadlineAt,
      quickCommand: runCommand(activityId, generationId),
      fullCommand: runCommand(activityId, generationId, true),
      publishCommand: stateCommand("publish", activityId, generationId),
      failureCommand: `${stateCommand("fail", activityId, generationId)} --reason ${JSON.stringify("<actionable reason>")}`,
    })}\n`);
  });
}

function textList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function safeJavaFile(value) {
  return typeof value === "string"
    && /^[A-Za-z_$][A-Za-z0-9_$]*\.java$/.test(value)
    && path.basename(value) === value;
}

function validateManifest(value, status) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Harness manifest must be a JSON object.");
  const manifest = value;
  if (manifest.schemaVersion !== 1) fail("Harness manifest schemaVersion must be 1.");
  if (manifest.activityId !== status.activityId || manifest.generationId !== status.generationId) {
    fail("Harness manifest identity does not match its reserved activity generation.");
  }
  if (manifest.signatureHash !== status.signatureHash) fail("Harness manifest has a stale problem signature.");
  if (!safeJavaFile(manifest.sourceFileName)) fail("Harness sourceFileName must be one safe Java filename.");
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(manifest.mainClass ?? "")) fail("Harness mainClass must be one Java class name.");
  if (!textList(manifest.harnessFiles) || !manifest.harnessFiles.every(safeJavaFile)) {
    fail("Harness files must be a nonempty list of safe Java filenames.");
  }
  if (new Set(manifest.harnessFiles).size !== manifest.harnessFiles.length) fail("Harness filenames must be unique.");
  if (manifest.harnessFiles.includes(manifest.sourceFileName)) fail("Harness files cannot replace the user source compilation copy.");
  if (!textList(manifest.quickCases) || !textList(manifest.fullCases)) fail("Quick and full case lists must be nonempty.");
  if (manifest.quickCases.length > MAX_QUICK_CASES) fail(`Quick may contain at most ${MAX_QUICK_CASES} cases.`);
  if (manifest.fullCases.length > MAX_FULL_CASES) fail(`Full local may contain at most ${MAX_FULL_CASES} cases.`);
  if ([...manifest.quickCases, ...manifest.fullCases].some((name) => name.length > MAX_CASE_NAME_LENGTH)) {
    fail(`Harness case names may contain at most ${MAX_CASE_NAME_LENGTH} characters.`);
  }
  if (new Set(manifest.quickCases).size !== manifest.quickCases.length || new Set(manifest.fullCases).size !== manifest.fullCases.length) {
    fail("Harness case names must be unique within each suite.");
  }
  if (
    !manifest.quickCases.every((name, index) => manifest.fullCases[index] === name)
    || manifest.fullCases.length <= manifest.quickCases.length
  ) {
    fail("The Full local suite must preserve Quick case order and be a strict superset of Quick.");
  }
  if (!Number.isInteger(manifest.runTimeoutMs) || manifest.runTimeoutMs < 100 || manifest.runTimeoutMs > 30_000) {
    fail("Harness runTimeoutMs must be an integer from 100 through 30000.");
  }
  return manifest;
}

async function bundleHash(directory, manifest) {
  const digest = createHash("sha256");
  for (const file of ["manifest.json", ...manifest.harnessFiles]) {
    digest.update(file);
    digest.update(await readFile(path.join(directory, file)));
  }
  return digest.digest("hex");
}

async function publish(options) {
  const activityId = safeActivityId(required(options, "activity-id"));
  const generationId = required(options, "generation-id");
  return withActivityLock(activityId, async () => {
    const paths = generationPaths(activityId, generationId);
    const status = await readJson(paths.statusFile).catch(() => null);
    if (!status) fail("No reserved harness generation exists to publish.");
    const active = await readJson(paths.activeFile).catch(() => null);
    if (active?.generationId !== generationId) fail("This harness generation is stale; prepare the verified current signature instead.");
    if (status.status === "ready") {
      process.stdout.write(`${JSON.stringify({ status: "ready", duplicate: true, generationId })}\n`);
      return;
    }
    if (!["preparing", "failed", "timed_out"].includes(status.status)) {
      fail(`Harness generation cannot publish from status: ${status.status}.`);
    }
    const manifest = validateManifest(await readJson(path.join(paths.stagingDirectory, "manifest.json")), status);
    for (const file of manifest.harnessFiles) {
      const fileStat = await lstat(path.join(paths.stagingDirectory, file)).catch(() => null);
      if (!fileStat?.isFile() || fileStat.isSymbolicLink()) fail(`Harness file is missing or unsafe: ${file}`);
    }
    const contentHash = await bundleHash(paths.stagingDirectory, manifest);
    await rename(paths.stagingDirectory, paths.publishedDirectory);
    const ready = { ...status, status: "ready", contentHash, updatedAt: Date.now() };
    await atomicJson(paths.statusFile, ready);
    process.stdout.write(`${JSON.stringify({ status: "ready", duplicate: false, generationId, contentHash })}\n`);
  });
}

async function markFailed(options) {
  const activityId = safeActivityId(required(options, "activity-id"));
  const generationId = required(options, "generation-id");
  const reason = required(options, "reason").trim();
  if (!reason) fail("Harness failure reason cannot be empty.");
  return withActivityLock(activityId, async () => {
    const paths = generationPaths(activityId, generationId);
    const status = await readJson(paths.statusFile).catch(() => null);
    if (!status) fail("No reserved harness generation exists to mark failed.");
    const active = await readJson(paths.activeFile).catch(() => null);
    if (active?.generationId !== generationId) fail("This harness generation is stale and cannot replace current status.");
    if (status.status === "failed") {
      if (status.reason !== reason) fail("This harness generation already has a different terminal failure reason.");
      process.stdout.write(`${JSON.stringify({ status: "failed", duplicate: true, generationId, reason })}\n`);
      return;
    }
    if (status.status !== "preparing") fail(`Harness generation cannot fail from status: ${status.status}.`);
    await atomicJson(paths.statusFile, { ...status, status: "failed", reason, updatedAt: Date.now() });
    process.stdout.write(`${JSON.stringify({ status: "failed", duplicate: false, generationId, reason })}\n`);
  });
}

function renderCase(testCase) {
  const state = testCase.passed ? "PASS" : "FAIL";
  return `${state} ${testCase.name} | input=${testCase.input} | expected=${testCase.expected} | actual=${testCase.actual}`;
}

function parseCaseEvents(stdout, expectedNames) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events = lines.map((line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      fail(`Harness emitted non-protocol output: ${line}`, 70);
    }
    if (
      event?.type !== "case"
      || typeof event.name !== "string"
      || typeof event.input !== "string"
      || typeof event.expected !== "string"
      || typeof event.actual !== "string"
      || typeof event.passed !== "boolean"
    ) {
      fail(`Harness emitted an invalid case event: ${line}`, 70);
    }
    return event;
  });
  assertExactCaseSet(events.map((event) => event.name), expectedNames);
  return events;
}

function assertExactCaseSet(actual, expected) {
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    fail(`Harness case protocol mismatch. Expected [${expected.join(", ")}], received [${actual.join(", ")}].`, 70);
  }
}

async function readReadyHarness(activityId, generationId) {
  const paths = generationPaths(activityId, generationId);
  const status = await readJson(paths.statusFile).catch(() => null);
  if (!status) fail("No harness state exists for this activity generation. Start the activity again to prepare tests.");
  const active = await readJson(paths.activeFile).catch(() => null);
  if (active?.generationId !== generationId) fail("This test command is stale because the verified problem signature changed. Use the commands from the current activity handoff.");
  if (status.status === "preparing") {
    if (Date.now() >= status.deadlineAt) {
      await atomicJson(paths.statusFile, {
        ...status,
        status: "timed_out",
        reason: "The harness sub-agent did not publish before its preparation deadline.",
        updatedAt: Date.now(),
      });
      fail("Harness preparation timed out. Ask the specialist to repair this activity's harness preparation.", 75);
    }
    fail("Test harness is still preparing; run this command again shortly.", 75);
  }
  if (status.status === "timed_out") {
    fail("Harness preparation timed out. Ask the specialist to repair this activity's harness preparation.", 75);
  }
  if (status.status === "failed") {
    fail(`Harness preparation failed: ${status.reason}\nAsk the specialist to repair this activity's harness preparation.`, 69);
  }
  if (status.status !== "ready") fail(`Test harness cannot run from status: ${status.status}.`);
  const manifest = validateManifest(await readJson(path.join(paths.publishedDirectory, "manifest.json")), status);
  const currentHash = await bundleHash(paths.publishedDirectory, manifest);
  if (currentHash !== status.contentHash) fail("Published harness integrity changed; prepare this activity harness again.");
  const sourceStat = await stat(status.sourceFile).catch(() => null);
  if (!sourceStat?.isFile()) fail(`The evolving Java source file is unavailable: ${status.sourceFile}`);
  return { paths, status, manifest };
}

async function prepareCompilationWorkspace(paths, status, manifest) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "interview-arc-java-compile-"));
  try {
    await copyFile(status.sourceFile, path.join(workspace, manifest.sourceFileName));
    for (const file of manifest.harnessFiles) {
      await copyFile(path.join(paths.publishedDirectory, file), path.join(workspace, file));
    }
    const classes = path.join(workspace, "classes");
    await mkdir(classes);
    return { workspace, classes };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

function compileHarness(workspace, classes, manifest) {
  const compile = spawnSync("javac", ["-encoding", "UTF-8", "-d", classes, manifest.sourceFileName, ...manifest.harnessFiles], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
  });
  if (compile.error?.code === "ETIMEDOUT") fail("Compilation timed out after 30000ms.", 124);
  if (compile.error?.code === "ENOBUFS") fail(`Compilation output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes.`, 65);
  if (compile.error) fail(`Compilation could not start: ${compile.error.message}`, 70);
  if (compile.status !== 0) fail(`Compilation failed:\n${compile.stderr.trim()}`, 65);
}

function executeHarness(workspace, classes, manifest, full) {
  const execute = spawnSync("java", ["-cp", classes, manifest.mainClass, full ? "full" : "quick"], {
    cwd: workspace,
    encoding: "utf8",
    timeout: manifest.runTimeoutMs,
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
  });
  if (execute.error?.code === "ETIMEDOUT") {
    fail(`Runtime timed out after ${manifest.runTimeoutMs}ms. Check for a runaway loop or reduce the failing case.`, 124);
  }
  if (execute.error?.code === "ENOBUFS") fail(`Harness output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes.`, 70);
  if (execute.error) fail(`Runtime could not start: ${execute.error.message}`, 70);
  if (execute.status !== 0) fail(`Runtime failed with exit ${execute.status}:\n${execute.stderr.trim()}`, 70);
  return parseCaseEvents(execute.stdout, full ? manifest.fullCases : manifest.quickCases);
}

function reportSuite(suite, events) {
  for (const event of events) process.stdout.write(`${renderCase(event)}\n`);
  const passed = events.filter((event) => event.passed).length;
  if (passed !== events.length) {
    process.stdout.write(`Local verification failed: ${suite} suite passed ${passed}/${events.length} tests.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Locally verified: ${suite} suite passed ${passed}/${events.length} tests. This is not a LeetCode Accepted verdict.\n`);
}

async function run(options) {
  const activityId = safeActivityId(required(options, "activity-id"));
  const generationId = required(options, "generation-id");
  const full = options.get("full") === true;
  const suite = full ? "Full local" : "Quick";
  return withActivityLock(activityId, async () => {
    const { paths, status, manifest } = await readReadyHarness(activityId, generationId);
    const { workspace, classes } = await prepareCompilationWorkspace(paths, status, manifest);
    try {
      process.stdout.write(`Suite: ${suite}\n`);
      compileHarness(workspace, classes, manifest);
      reportSuite(suite, executeHarness(workspace, classes, manifest, full));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

const { command, options } = argsFrom(process.argv.slice(2));
try {
  if (command === "prepare") await prepare(options);
  else if (command === "publish") await publish(options);
  else if (command === "fail") await markFailed(options);
  else if (command === "run") await run(options);
  else fail("Usage: leetcode-java-harness.mjs prepare --activity-id <id> --signature <verified-signature> --source <java-file>");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof CliError ? error.exitCode : 2;
}

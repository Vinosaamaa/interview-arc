#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SYSTEM_DESIGN_CANVAS_URL = "http://127.0.0.1:3032";
export const PREFLIGHT_LEASE_MS = 5 * 60 * 1_000;
const BROWSER_CONTROL_URL = "http://127.0.0.1:3033";
const DEFAULT_WORKER_URL = "https://limitless-mcp.vinosama.workers.dev";
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const outerRoot = process.env.INTERVIEW_PREP_ROOT ?? resolve(repositoryRoot, "..");
const wrapperPath = join(outerRoot, ".agents", "skills", "excalidraw-skill", "scripts", "excalidraw-v2.sh");
const browserStateRoot = join(outerRoot, "browser-profiles", "system-design-canvas");
const leasePath = join(browserStateRoot, "preflight-lease.json");

function assertStableActivityId(activityId) {
  if (typeof activityId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(activityId)) {
    throw new Error("System Design preflight requires one stable activity ID.");
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkpointSystemDesignDrawing(input, dependencies) {
  assertStableActivityId(input.activityId);
  const current = await dependencies.readCurrentCheckpoint(input.activityId);
  const expectedRevision = current?.checkpoint?.revision ?? current?.revision ?? 0;
  const scene = await dependencies.exportScene();
  const operationId = `checkpoint-${await sha256Hex(`${input.activityId}\u0000${expectedRevision}\u0000${scene}\u0000${input.altText}`)}`;
  const saved = await dependencies.saveCheckpoint({
    activityId: input.activityId,
    operationId,
    expectedRevision,
    altText: input.altText,
    scene,
  });
  return { ...saved, scene };
}

export async function finalizeSystemDesignDrawingAssets(input, dependencies) {
  assertStableActivityId(input.activityId);
  assertStableActivityId(input.questionId);
  const checkpoint = await dependencies.checkpoint(input);
  const svg = await dependencies.exportSvg();
  const operationId = `asset-set-${await sha256Hex(`${input.activityId}\u0000${input.questionId}\u0000${checkpoint.checkpoint.revision}\u0000${checkpoint.scene}\u0000${svg}`)}`;
  return dependencies.stageAssetSet({
    activityId: input.activityId,
    questionId: input.questionId,
    operationId,
    checkpointRevision: checkpoint.checkpoint.revision,
    assets: [
      {
        role: "attempt_original_excalidraw",
        mimeType: "application/vnd.excalidraw+json",
        altText: `${input.altText} (editable original)`,
        body: checkpoint.scene,
      },
      {
        role: "attempt_original_svg",
        mimeType: "image/svg+xml",
        altText: `${input.altText} (preview)`,
        body: svg,
      },
    ],
  });
}

function reusableLease(lease, activityId, nowMs, server, browser) {
  return Boolean(
    lease
    && lease.activityId === activityId
    && lease.serverUrl === SYSTEM_DESIGN_CANVAS_URL
    && typeof lease.browserId === "string"
    && typeof lease.pageId === "string"
    && typeof lease.expiresAt === "number"
    && lease.expiresAt >= nowMs
    && server?.healthy === true
    && server.browserClients === 1
    && browser?.healthy === true
    && browser.browserId === lease.browserId
    && browser.pageId === lease.pageId
    && browser.pageCount === 1,
  );
}

export async function runSystemDesignDrawingPreflight(input, dependencies) {
  assertStableActivityId(input.activityId);
  const lease = await dependencies.readLease(input.activityId);
  const server = await dependencies.probeServer();
  const browser = lease ? await dependencies.probeOwnedBrowser() : null;
  if (reusableLease(lease, input.activityId, input.nowMs, server, browser)) {
    return { ...lease, reused: true };
  }

  if (!server?.healthy) await dependencies.startServer();
  const page = await dependencies.ensureSingleCanvasPage(SYSTEM_DESIGN_CANVAS_URL);
  if (page?.pageCount !== 1) {
    throw new Error("System Design preflight requires exactly one Playwright Chromium tab.");
  }
  const exclusive = await dependencies.probeExclusiveCanvas();
  if (!exclusive?.healthy || exclusive.browserClients !== 1) {
    throw new Error("System Design preflight requires the Playwright Chromium canvas to be the only connected browser client.");
  }
  await dependencies.verifyRoundTrip();
  const checkpoint = await dependencies.readCurrentCheckpoint(input.activityId);
  if (checkpoint) await dependencies.restoreCheckpoint(checkpoint);
  const nextLease = {
    activityId: input.activityId,
    serverUrl: SYSTEM_DESIGN_CANVAS_URL,
    browserId: page.browserId,
    pageId: page.pageId,
    checkpointRevision: checkpoint?.revision ?? null,
    checkpointSha256: checkpoint?.sha256 ?? null,
    expiresAt: input.nowMs + PREFLIGHT_LEASE_MS,
    reused: false,
  };
  await dependencies.writeLease(nextLease);
  return nextLease;
}

async function runPinnedCli(args, stdin = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("sh", [wrapperPath, ...args], {
      cwd: outerRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(stderr.trim() || stdout.trim() || `Excalidraw v2 CLI exited with code ${code}.`));
    });
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

async function cliJson(args, stdin = null) {
  const output = await runPinnedCli(args, stdin);
  return JSON.parse(output);
}

async function readLease() {
  try {
    return JSON.parse(await readFile(leasePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeLease(lease) {
  await mkdir(browserStateRoot, { recursive: true });
  await writeFile(leasePath, `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600 });
}

async function browserControl(pathname, init) {
  const response = await fetch(`${BROWSER_CONTROL_URL}${pathname}`, init);
  if (!response.ok) throw new Error(`Playwright Chromium controller returned ${response.status}.`);
  return response.json();
}

async function ensureBrowserDaemon() {
  try {
    return await browserControl("/status");
  } catch {
    await mkdir(browserStateRoot, { recursive: true });
    const child = spawn(process.execPath, [scriptPath, "browser-daemon"], {
      detached: true,
      stdio: "ignore",
      cwd: outerRoot,
      env: { ...process.env, INTERVIEW_PREP_ROOT: outerRoot },
    });
    child.unref();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        return await browserControl("/status");
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      }
    }
    throw new Error("The dedicated Playwright Chromium canvas did not become ready within 15 seconds.");
  }
}

async function probeOwnedBrowser() {
  try {
    return await browserControl("/status");
  } catch {
    return { healthy: false };
  }
}

async function ensureSingleCanvasPage() {
  await ensureBrowserDaemon();
  return browserControl("/ensure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: SYSTEM_DESIGN_CANVAS_URL }),
  });
}

async function probeServer() {
  try {
    const status = await cliJson(["status"]);
    return { healthy: status.running === true, browserClients: status.browserClients ?? 0 };
  } catch {
    return { healthy: false, browserClients: 0 };
  }
}

async function verifyRoundTrip() {
  const before = await runPinnedCli(["export"]);
  const parsedBefore = JSON.parse(before);
  await runPinnedCli(["import", "-", "--replace"], before);
  const after = JSON.parse(await runPinnedCli(["export"]));
  if (parsedBefore.type !== after.type || parsedBefore.elements?.length !== after.elements?.length) {
    throw new Error("The Excalidraw v2 scene failed its preflight round trip.");
  }
}

function workerBaseUrl() {
  const configured = process.env.INTERVIEW_ARC_MCP_URL ?? DEFAULT_WORKER_URL;
  return configured.replace(/\/mcp\/?$/, "").replace(/\/$/, "");
}

function workerToken() {
  const token = process.env.INTERVIEW_ARC_MCP_TOKEN;
  if (!token) throw new Error("INTERVIEW_ARC_MCP_TOKEN is required for private System Design checkpoints.");
  return token;
}

async function privateAssetRequest(pathname, init = {}) {
  const response = await fetch(`${workerBaseUrl()}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${workerToken()}`, ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404 && init.allowMissing) return null;
    throw new Error(body.error ?? `Private Practice asset request returned ${response.status}.`);
  }
  return body;
}

async function readCurrentCheckpoint(activityId) {
  return privateAssetRequest(`/practice-assets/checkpoints/${encodeURIComponent(activityId)}`, { allowMissing: true });
}

async function saveCheckpoint(input) {
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    operationId: input.operationId,
    expectedRevision: input.expectedRevision,
    altText: input.altText,
  }));
  form.set("scene", new Blob([input.scene], { type: "application/vnd.excalidraw+json" }), "attempt.excalidraw");
  return privateAssetRequest(`/practice-assets/checkpoints/${encodeURIComponent(input.activityId)}`, {
    method: "PUT",
    body: form,
  });
}

async function stageAssetSet(input) {
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    operationId: input.operationId,
    questionId: input.questionId,
    checkpointRevision: input.checkpointRevision,
    assets: input.assets.map(({ role, altText }) => ({ role, altText })),
  }));
  for (const asset of input.assets) {
    form.set(asset.role, new Blob([asset.body], { type: asset.mimeType }), asset.role.endsWith("svg") ? "attempt.svg" : "attempt.excalidraw");
  }
  return privateAssetRequest(`/practice-assets/sets/${encodeURIComponent(input.activityId)}`, {
    method: "POST",
    body: form,
  });
}

async function runConcretePreflight(activityId) {
  return runSystemDesignDrawingPreflight({ activityId, nowMs: Date.now() }, {
    readLease,
    probeServer,
    probeOwnedBrowser,
    startServer: () => cliJson(["start"]),
    ensureSingleCanvasPage,
    probeExclusiveCanvas: probeServer,
    verifyRoundTrip,
    readCurrentCheckpoint,
    restoreCheckpoint: (checkpoint) => runPinnedCli(["import", "-", "--replace"], checkpoint.scene),
    writeLease,
  });
}

async function runConcreteCheckpoint(activityId, altText) {
  return checkpointSystemDesignDrawing({ activityId, altText }, {
    readCurrentCheckpoint,
    exportScene: () => runPinnedCli(["export"]),
    saveCheckpoint,
  });
}

async function runConcreteFinish(activityId, questionId, altText) {
  return finalizeSystemDesignDrawingAssets({ activityId, questionId, altText }, {
    checkpoint: (input) => runConcreteCheckpoint(input.activityId, input.altText),
    exportSvg: () => runPinnedCli(["screenshot", "--format", "svg"]),
    stageAssetSet,
  });
}

async function runBrowserDaemon() {
  const { chromium } = await import("playwright-core");
  await mkdir(browserStateRoot, { recursive: true });
  const context = await chromium.launchPersistentContext(browserStateRoot, {
    headless: false,
    viewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const ensurePage = async (url = SYSTEM_DESIGN_CANVAS_URL) => {
    let pages = context.pages().filter((page) => !page.isClosed());
    const page = pages[0] ?? await context.newPage();
    for (const extra of pages.slice(1)) await extra.close();
    if (page.url() !== url) await page.goto(url, { waitUntil: "domcontentloaded" });
    pages = context.pages().filter((candidate) => !candidate.isClosed());
    return {
      browserId: "playwright-chromium-system-design",
      pageId: "excalidraw-canvas",
      pageCount: pages.length,
    };
  };
  await ensurePage();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/status") {
        const state = await ensurePage();
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ healthy: true, ...state }));
        return;
      }
      if (request.method === "POST" && request.url === "/ensure") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body || "{}");
        if (input.url !== SYSTEM_DESIGN_CANVAS_URL) throw new Error("Only the fixed loopback Excalidraw canvas is allowed.");
        const state = await ensurePage(input.url);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(3033, "127.0.0.1");
  const close = async () => {
    server.close();
    await context.close();
    process.exit(0);
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function main(args) {
  const [command, activityId, questionId] = args;
  if (command === "browser-daemon") return runBrowserDaemon();
  if (command === "preflight" && activityId) console.log(JSON.stringify(await runConcretePreflight(activityId), null, 2));
  else if (command === "checkpoint" && activityId) console.log(JSON.stringify(await runConcreteCheckpoint(activityId, option(args, "--alt", "Owner-authored System Design canvas")), null, 2));
  else if (command === "finish-assets" && activityId && questionId) console.log(JSON.stringify(await runConcreteFinish(activityId, questionId, option(args, "--alt", "Owner-authored System Design canvas")), null, 2));
  else throw new Error("Usage: system-design-excalidraw-controller.mjs preflight <activityId> | checkpoint <activityId> [--alt text] | finish-assets <activityId> <questionId> [--alt text]");
}

if (process.argv[1] === scriptPath) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const repositoryParent = path.dirname(repositoryRoot);
const outerWorkspace = path.basename(repositoryParent) === ".worktrees"
  ? path.dirname(repositoryParent)
  : repositoryParent;
const localStateDirectory = path.join(
  os.homedir(),
  "Library",
  "Caches",
  "InterviewArc",
  "leetcode-playwright-controller",
);
const preflightReceiptPath = path.join(localStateDirectory, "preflight.json");
const controllerLockPath = path.join(localStateDirectory, "controller.lock");

export const PLAYWRIGHT_BOOTSTRAP_COMMAND =
  "npm exec --yes pnpm@9.15.9 -- install --frozen-lockfile";

export class ControllerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControllerError";
    this.code = code;
    this.details = details;
  }
}

export const FIXED_CONFIG = Object.freeze({
  chromeApplication: "/Applications/Google Chrome.app",
  profilePath: path.join(outerWorkspace, "browser-profiles", "leetcode-submitter"),
  cdpAddress: "127.0.0.1",
  cdpPort: 9223,
  cdpEndpoint: "http://127.0.0.1:9223",
  versionEndpoint: "http://127.0.0.1:9223/json/version",
  defaultLanguage: "Java",
  localBudgetMs: 5_000,
  verdictTimeoutMs: 60_000,
});

export function canonicalProblemIdentity(url, title) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ControllerError("invalid_problem_identity", "A canonical problem URL is required.");
  }

  const match = parsed.pathname.match(/^\/problems\/([a-z0-9-]+)\/$/);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "leetcode.com"
    || parsed.search
    || parsed.hash
    || !match
  ) {
    throw new ControllerError("invalid_problem_identity", "A canonical problem URL is required.");
  }
  if (typeof title !== "string" || title.trim() === "") {
    throw new ControllerError("invalid_problem_identity", "A verified problem title is required.");
  }

  return Object.freeze({
    url: parsed.href,
    slug: match[1],
    title: title.trim(),
  });
}

export function parseCli(argv) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, url, possibleFile, possibleFlag, possibleTitle] = normalizedArgv;
  if (command === "ensure" && normalizedArgv.length === 1) {
    return { command, identity: null, javaFile: null };
  }
  if (command === "navigate" && normalizedArgv.length === 4 && possibleFile === "--title") {
    return {
      command,
      identity: canonicalProblemIdentity(url, possibleFlag),
      javaFile: null,
    };
  }
  if (
    (command === "submit" || command === "retry")
    && normalizedArgv.length === 5
    && possibleFlag === "--title"
  ) {
    return {
      command,
      identity: canonicalProblemIdentity(url, possibleTitle),
      javaFile: possibleFile,
    };
  }
  if (["navigate", "submit", "retry"].includes(command) && !normalizedArgv.includes("--title")) {
    throw new ControllerError("cli_usage", `${command} requires --title with the verified problem title.`);
  }
  throw new ControllerError(
    "cli_usage",
    "Supported commands are ensure, navigate, submit, and retry.",
  );
}

export function firstUtf8Difference(expected, actual) {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  const sharedLength = Math.min(expectedBytes.length, actualBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (expectedBytes[index] !== actualBytes[index]) return index;
  }
  return expectedBytes.length === actualBytes.length ? -1 : sharedLength;
}

const TARGET_SELECTORS = Object.freeze({
  language: [
    '[data-e2e-locator="lang-select"]',
    '[data-cy="lang-select"]',
    'button[aria-label*="language" i]',
    'button[id^="headlessui-listbox-button"]',
  ],
  editorInput: [
    ".monaco-editor textarea.inputarea",
    ".monaco-editor textarea",
  ],
  resultRoot: [
    '[data-e2e-locator="submission-result"]',
    '[data-cy="submission-result"]',
    '[data-testid="submission-result"]',
    '[data-e2e-locator="console-result"]',
  ],
  failingInput: [
    '[data-e2e-locator="testcase-input"]',
    '[data-cy="testcase-input"]',
    '[data-testid="testcase-input"]',
  ],
});

const TARGET_ROUTES = Object.freeze({
  problemEditor: "^/problems/([a-z0-9-]+)/(?:description/)?$",
  problemTab: "^/problems/([a-z0-9-]+)/(?:description/|editorial/|solutions/|submissions/)?$",
  resultAttempt: "^(?:/submissions/(?:detail/)?|/problems/[a-z0-9-]+/submissions/)([^/]+)/?$",
});

export function leetcodeAttemptKeyFromPath(pathname) {
  return pathname.match(new RegExp(TARGET_ROUTES.resultAttempt))?.[1] ?? null;
}

export function leetcodeProblemSlugFromPath(pathname) {
  return pathname.match(new RegExp(TARGET_ROUTES.problemTab))?.[1] ?? null;
}

export function leetcodeEditorSlugFromPath(pathname) {
  return pathname.match(new RegExp(TARGET_ROUTES.problemEditor))?.[1] ?? null;
}

export function isAutomationOwnedLeetCodeUrl(value) {
  try {
    const candidate = new URL(value);
    return candidate.hostname === "leetcode.com"
      && (
        leetcodeProblemSlugFromPath(candidate.pathname) !== null
        || leetcodeAttemptKeyFromPath(candidate.pathname) !== null
        || /^\/problemset(?:\/all)?\/?$/.test(candidate.pathname)
      );
  } catch {
    return false;
  }
}

export function createPlaywrightPageAdapter(page) {
  const evaluate = (operation, source, expectedAttemptKey = null) => page.evaluate(({
    operation: selectedOperation,
    selectors,
    routes,
    source: exactSource,
    expectedAttemptKey: selectedAttemptKey,
  }) => {
    if (selectedOperation === "visible-language") {
      for (const selector of selectors.language) {
        const element = document.querySelector(selector);
        const label = element?.textContent?.trim();
        if (label) return label;
      }
      let exactJavaButton = null;
      for (const button of document.querySelectorAll("button")) {
        if (button.textContent?.trim() !== "Java" || button.getClientRects().length === 0) continue;
        if (exactJavaButton) return "";
        exactJavaButton = button;
      }
      return exactJavaButton ? "Java" : "";
    }

    const models = globalThis.monaco?.editor?.getModels?.() ?? [];
    if (selectedOperation === "monaco-models") {
      return models.map((model) => ({
        uri: model.uri?.toString?.() ?? "",
        languageId: model.getLanguageId?.() ?? "",
      }));
    }
    if (selectedOperation === "replace-exact") {
      const javaModels = models.filter((model) => (
        model.getLanguageId?.().toLowerCase() === "java"
        && model.uri?.toString?.().toLowerCase().endsWith(".java")
      ));
      if (javaModels.length !== 1) {
        throw new Error(`Expected one Java Monaco model, found ${javaModels.length}.`);
      }
      javaModels[0].setValue(exactSource);
      return javaModels[0].getValue();
    }
    if (selectedOperation === "focus-editor") {
      for (const selector of selectors.editorInput) {
        const input = document.querySelector(selector);
        if (input instanceof HTMLElement) {
          input.focus({ preventScroll: true });
          return document.activeElement === input;
        }
      }
      return false;
    }
    if (["submission-snapshot", "attempt-key", "attempt-result"].includes(selectedOperation)) {
      let root = null;
      for (const selector of selectors.resultRoot) {
        root = document.querySelector(selector);
        if (root) break;
      }
      const pathMatch = location.pathname.match(new RegExp(routes.resultAttempt));
      const linkedAttempt = root?.querySelector?.('a[href*="/submissions/"]')?.getAttribute("href")
        ?.match(/\/submissions\/(?:detail\/)?([^/]+)/)?.[1];
      const attemptKey = pathMatch?.[1]
        ?? root?.getAttribute?.("data-submission-id")
        ?? linkedAttempt
        ?? null;
      if (selectedOperation === "attempt-key") return attemptKey;
      const text = root?.textContent?.trim() ?? "";
      if (selectedOperation === "submission-snapshot") return { attemptKey, text };
      if (!root || attemptKey !== selectedAttemptKey) return null;
      const verdicts = [
        "Accepted",
        "Wrong Answer",
        "Time Limit Exceeded",
        "Memory Limit Exceeded",
        "Runtime Error",
        "Compile Error",
        "Output Limit Exceeded",
      ];
      const verdict = verdicts.find((candidate) => text.includes(candidate)) ?? null;
      let failingInput = null;
      for (const selector of selectors.failingInput) {
        const element = root.querySelector(selector);
        if (element?.textContent?.trim()) {
          failingInput = element.textContent.trim();
          break;
        }
      }
      return { verdict, failingInput };
    }
    throw new Error(`Unsupported page operation: ${selectedOperation}`);
  }, {
    operation,
    selectors: TARGET_SELECTORS,
    routes: TARGET_ROUTES,
    source,
    expectedAttemptKey,
  });

  const abortableDelay = (delayMs, signal) => new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  return {
    url: () => page.url(),
    title: () => page.title(),
    navigate: (url) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    goBack: () => page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }),
    async waitForEditableProblem(identity) {
      const handle = await page.waitForFunction(
        ({ kind, expectedSlug, expectedTitle, routes }) => {
          const visibleSlug = location.pathname.match(new RegExp(routes.problemEditor))?.[1] ?? null;
          if (kind !== "editor" || visibleSlug !== expectedSlug) return false;
          if (document.title !== expectedTitle && document.title !== `${expectedTitle} - LeetCode`) {
            return false;
          }
          const javaModels = (globalThis.monaco?.editor?.getModels?.() ?? []).filter((model) => (
            model.getLanguageId?.().toLowerCase() === "java"
            && model.uri?.toString?.().toLowerCase().endsWith(".java")
          ));
          return javaModels.length === 1;
        },
        {
          kind: "editor",
          expectedSlug: identity.slug,
          expectedTitle: identity.title,
          routes: TARGET_ROUTES,
        },
        { timeout: 30_000, polling: 100 },
      );
      await handle.dispose?.();
    },
    visibleLanguage: () => evaluate("visible-language"),
    monacoModels: () => evaluate("monaco-models"),
    replaceExactSource: (source) => evaluate("replace-exact", source),
    async focusEditor() {
      const focused = await evaluate("focus-editor");
      if (!focused) {
        throw new ControllerError("editor_focus_failed", "The Java editor could not be focused through DOM state.");
      }
    },
    submissionSnapshot: () => evaluate("submission-snapshot"),
    pressSubmit: () => page.keyboard.press("Meta+Enter"),
    async waitForNewAttemptVerdict(baseline, timeoutMs, signal) {
      const deadline = Date.now() + timeoutMs;
      let attemptKey = null;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;
        attemptKey = await evaluate("attempt-key");
        if (attemptKey && attemptKey !== baseline?.attemptKey) break;
        await abortableDelay(100, signal);
      }
      if (!attemptKey || attemptKey === baseline?.attemptKey) {
        throw new ControllerError(
          "submission_transition_missing",
          "No new attempt-specific submission transition appeared before timeout.",
          { timeoutMs },
        );
      }
      let result = null;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;
        result = await evaluate("attempt-result", undefined, attemptKey);
        if (result?.verdict) break;
        await abortableDelay(100, signal);
      }
      if (!result?.verdict) {
        throw new ControllerError(
          "submission_verdict_missing",
          "The new attempt did not expose a scoped terminal verdict before timeout.",
          { attemptKey, timeoutMs },
        );
      }
      return { transitioned: true, attemptKey, ...result };
    },
  };
}

export async function ensureBrowserController(dependencies, { allowLaunch = true } = {}) {
  const cdp = await dependencies.probeCdp(FIXED_CONFIG.versionEndpoint);

  if (cdp.live && cdp.valid === false) {
    throw new ControllerError(
      "cdp_identity_mismatch",
      "Port 9223 responded, but it was not the fixed dedicated Chrome endpoint.",
      { product: cdp.product ?? null },
    );
  }
  if (!cdp.live && !allowLaunch) {
    throw new ControllerError(
      "preflight_required",
      "The fixed CDP endpoint is not live; run ensure before interactive submission.",
    );
  }

  let playwright;
  try {
    playwright = await dependencies.loadPlaywright();
  } catch (cause) {
    throw new ControllerError(
      "playwright_import_failed",
      "The local controller dependencies could not be loaded. Synchronize the canonical checkout, then run ensure once more.",
      {
        cdpLive: cdp.live === true,
        cause: cause.message,
        recoveryCommand: PLAYWRIGHT_BOOTSTRAP_COMMAND,
        recoveryWorkingDirectory: "<interview-arc-repository-root>",
      },
    );
  }

  let endpoint = cdp;
  if (!cdp.live) {
    const launchContext = await dependencies.launchChrome(FIXED_CONFIG);
    try {
      endpoint = await dependencies.waitForCdp(FIXED_CONFIG.versionEndpoint);
      if (!endpoint.live || endpoint.valid === false) {
        throw new ControllerError(
          "cdp_launch_failed",
          "The fixed Chrome process did not expose its expected loopback CDP endpoint.",
        );
      }
    } finally {
      await dependencies.restoreActiveApp?.(launchContext);
    }
  }

  let browser;
  try {
    browser = await dependencies.connectOverCdp(playwright.chromium, FIXED_CONFIG.cdpEndpoint);
  } catch (cause) {
    throw new ControllerError(
      "playwright_connect_failed",
      "Playwright could not attach to the fixed CDP endpoint.",
      { cdpLive: endpoint.live === true, cause: cause.message },
    );
  }

  const cleanup = dependencies.cleanupController ?? (async () => {});
  try {
    const identityCheck = await dependencies.validateBrowserIdentity?.(browser, endpoint);
    const problemPages = browser.contexts()
      .flatMap((context) => context.pages())
      .filter((page) => isAutomationOwnedLeetCodeUrl(page.url()));
    if (problemPages.length !== 1) {
      throw new ControllerError(
        "problem_tab_ambiguous",
        "Exactly one automation-owned LeetCode problem tab is required.",
        { problemTabCount: problemPages.length },
      );
    }
    const pageAdapterFactory = dependencies.pageAdapterFactory ?? ((page) => page);
    return {
      browser,
      page: pageAdapterFactory(problemPages[0]),
      cleanup: () => cleanup(browser),
      browserId: endpoint.browserId ?? null,
      identityCheck: identityCheck ?? { profileVerification: "unavailable" },
    };
  } catch (error) {
    await cleanup(browser);
    throw error;
  }
}

export class LeetCodeController {
  constructor({ page, readFileUtf8, now = (() => performance.now()), signal = null }) {
    this.page = page;
    this.readFileUtf8 = readFileUtf8;
    this.now = now;
    this.signal = signal;
  }

  assertActive() {
    if (this.signal?.aborted) throw this.signal.reason;
  }

  async verifyEditableProblem(identity) {
    this.assertActive();
    const currentUrl = new URL(this.page.url());
    if (leetcodeEditorSlugFromPath(currentUrl.pathname) !== identity.slug) {
      throw new ControllerError(
        "problem_slug_mismatch",
        "The persistent tab does not show the focused problem.",
        { expectedSlug: identity.slug, actualUrl: currentUrl.href },
      );
    }

    const currentTitle = await this.page.title();
    if (currentTitle !== identity.title && currentTitle !== `${identity.title} - LeetCode`) {
      throw new ControllerError(
        "problem_title_mismatch",
        "The visible problem title does not match the focused problem.",
        { expectedTitle: identity.title, actualTitle: currentTitle },
      );
    }

    const language = await this.page.visibleLanguage();
    if (language.trim().toLowerCase() !== FIXED_CONFIG.defaultLanguage.toLowerCase()) {
      throw new ControllerError(
        "language_mismatch",
        "The visible LeetCode editor is not set to Java.",
        { expectedLanguage: FIXED_CONFIG.defaultLanguage, actualLanguage: language },
      );
    }

    const javaModels = (await this.page.monacoModels()).filter((model) => (
      model.languageId.toLowerCase() === "java" && model.uri.toLowerCase().endsWith(".java")
    ));
    if (javaModels.length !== 1) {
      throw new ControllerError(
        "java_model_ambiguous",
        "Exactly one editable Java Monaco model is required.",
        { javaModelCount: javaModels.length },
      );
    }
    this.assertActive();
    return javaModels[0];
  }

  ensureLocalBudget(stage, startedAt) {
    const elapsedMs = this.now() - startedAt;
    if (elapsedMs > FIXED_CONFIG.localBudgetMs) {
      throw new ControllerError(
        "local_stage_timeout",
        `The warm submission path exceeded its budget during ${stage}.`,
        { stage, elapsedMs, budgetMs: FIXED_CONFIG.localBudgetMs },
      );
    }
    return elapsedMs;
  }

  async submitVerified(identity, javaFile) {
    const commandStartedAt = this.now();
    const progress = [];
    progress.push({ stage: "identity_verified", atMs: this.now() - commandStartedAt });

    const localStartedAt = this.now();
    this.assertActive();
    const source = await this.readFileUtf8(javaFile);
    this.assertActive();
    this.ensureLocalBudget("source_read", localStartedAt);
    progress.push({ stage: "source_read", atMs: this.now() - commandStartedAt });

    const readBack = await this.page.replaceExactSource(source);
    this.assertActive();
    this.ensureLocalBudget("source_replaced", localStartedAt);
    progress.push({ stage: "source_replaced", atMs: this.now() - commandStartedAt });

    if (readBack !== source) {
      throw new ControllerError(
        "source_mismatch",
        "The Monaco model did not exactly match the Java source file.",
        {
          expectedUtf8Bytes: Buffer.byteLength(source),
          actualUtf8Bytes: Buffer.byteLength(readBack),
          firstDifferingByteOffset: firstUtf8Difference(source, readBack),
        },
      );
    }
    this.ensureLocalBudget("equality_verified", localStartedAt);
    progress.push({ stage: "equality_verified", atMs: this.now() - commandStartedAt });

    const baseline = await this.page.submissionSnapshot();
    this.assertActive();
    await this.page.focusEditor();
    this.assertActive();
    this.ensureLocalBudget("editor_focused", localStartedAt);
    await this.page.pressSubmit();
    const localAutomationMs = this.now() - localStartedAt;
    progress.push({ stage: "submission_sent", atMs: this.now() - commandStartedAt });

    const verdictStartedAt = this.now();
    const result = await this.page.waitForNewAttemptVerdict(
      baseline,
      FIXED_CONFIG.verdictTimeoutMs,
      this.signal,
    );
    if (
      !result.transitioned
      || !result.attemptKey
      || result.attemptKey === baseline?.attemptKey
    ) {
      throw new ControllerError(
        "submission_transition_missing",
        "No new attempt-specific submission transition appeared.",
      );
    }
    progress.push({ stage: "verdict_received", atMs: this.now() - commandStartedAt });

    return {
      verdict: result.verdict,
      failingInput: result.failingInput ?? null,
      progress,
      diagnostics: {
        sourceUtf8Bytes: Buffer.byteLength(source),
        localAutomationMs,
        serverWaitMs: this.now() - verdictStartedAt,
        warmSubmitMs: this.now() - localStartedAt,
        totalUserVisibleMs: this.now() - commandStartedAt,
      },
    };
  }

  async submit(identity, javaFile) {
    await this.verifyEditableProblem(identity);
    return this.submitVerified(identity, javaFile);
  }

  async retry(identity, javaFile) {
    const currentPath = new URL(this.page.url()).pathname;
    if (leetcodeAttemptKeyFromPath(currentPath) !== null) {
      let backFailure;
      try {
        await this.page.goBack();
        await this.page.waitForEditableProblem(identity);
        await this.verifyEditableProblem(identity);
      } catch (error) {
        backFailure = error;
        try {
          await this.page.navigate(identity.url);
          await this.page.waitForEditableProblem(identity);
          await this.verifyEditableProblem(identity);
        } catch (navigationFailure) {
          throw new ControllerError(
            "retry_recovery_failed",
            "Neither Back nor canonical same-tab navigation restored the verified Java editor.",
            {
              backFailure: backFailure.message,
              navigationFailure: navigationFailure.message,
            },
          );
        }
      }
    } else {
      await this.verifyEditableProblem(identity);
    }

    const result = await this.submitVerified(identity, javaFile);
    return {
      ...result,
      progress: [
        { stage: "retry_recovered", atMs: 0 },
        ...result.progress,
      ],
    };
  }

  async navigate(identity) {
    await this.page.navigate(identity.url);
    await this.page.waitForEditableProblem(identity);
    await this.verifyEditableProblem(identity);
    return { url: identity.url, slug: identity.slug, language: FIXED_CONFIG.defaultLanguage };
  }
}

export async function runControllerCommand(request, dependencies) {
  if (["submit", "retry"].includes(request.command)) {
    await dependencies.verifyPreflight(request.identity);
  }

  const lease = await dependencies.acquireController({ allowLaunch: request.command === "ensure" });
  const abortController = new AbortController();
  let cleanedUp = false;
  let operation;
  try {
    let timer;
    const timeoutMs = dependencies.commandTimeoutMs ?? (FIXED_CONFIG.verdictTimeoutMs + 10_000);
    const timeoutError = new ControllerError(
      "controller_timeout",
      "The controller command timed out and its connection was released.",
      { timeoutMs },
    );
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    operation = (async () => {
      if (request.command === "ensure") {
        return { status: "ready", pageUrl: lease.page.url() };
      }
      const controller = new LeetCodeController({
        page: lease.page,
        readFileUtf8: dependencies.readFileUtf8,
        now: dependencies.now,
        signal: abortController.signal,
      });
      if (request.command === "navigate") return controller.navigate(request.identity);
      if (request.command === "submit") return controller.submit(request.identity, request.javaFile);
      if (request.command === "retry") return controller.retry(request.identity, request.javaFile);
      throw new ControllerError("cli_usage", "Unsupported controller command.");
    })();
    try {
      return await Promise.race([operation, timeout]);
    } catch (error) {
      if (error === timeoutError) {
        await lease.cleanup();
        cleanedUp = true;
        await operation.catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (!cleanedUp) await lease.cleanup();
  }
}

async function probeFixedCdp(versionEndpoint = FIXED_CONFIG.versionEndpoint) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 1_000);
  try {
    const response = await fetch(versionEndpoint, { signal: abortController.signal });
    if (!response.ok) {
      return { live: true, valid: false, status: response.status };
    }
    const payload = await response.json();
    const browserId = typeof payload.webSocketDebuggerUrl === "string"
      ? payload.webSocketDebuggerUrl.match(/\/devtools\/browser\/([^/?]+)/)?.[1] ?? null
      : null;
    return {
      live: true,
      valid: typeof payload.Browser === "string" && payload.Browser.startsWith("Chrome/"),
      product: payload.Browser ?? null,
      browserId,
    };
  } catch (error) {
    return { live: false, valid: false, cause: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForFixedCdp(versionEndpoint) {
  const deadline = performance.now() + 10_000;
  let lastProbe = { live: false };
  while (performance.now() < deadline) {
    lastProbe = await probeFixedCdp(versionEndpoint);
    if (lastProbe.live) return lastProbe;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return lastProbe;
}

async function launchFixedChrome(configuration) {
  await mkdir(configuration.profilePath, { recursive: true });
  let frontmostBundleId = null;
  try {
    const result = await execFile("osascript", [
      "-e",
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
    ]);
    frontmostBundleId = result.stdout.trim() || null;
  } catch {
    frontmostBundleId = null;
  }

  await execFile("open", [
    "-g",
    "-na",
    configuration.chromeApplication,
    "--args",
    `--remote-debugging-address=${configuration.cdpAddress}`,
    `--remote-debugging-port=${configuration.cdpPort}`,
    `--user-data-dir=${configuration.profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://leetcode.com/problemset/",
  ]);
  return { frontmostBundleId };
}

async function restoreActiveApp(launchContext) {
  const bundleId = launchContext?.frontmostBundleId;
  if (bundleId) await execFile("open", ["-b", bundleId]);
}

async function loadFixedPlaywright() {
  const playwright = await import("playwright-core");
  if (typeof playwright.chromium?.connectOverCDP !== "function") {
    throw new Error("playwright-core does not expose chromium.connectOverCDP");
  }
  return playwright;
}

async function validateFixedBrowserIdentity(browser) {
  let session;
  try {
    session = await browser.newBrowserCDPSession();
    const result = await session.send("Browser.getBrowserCommandLine");
    const argumentsList = result.arguments ?? [];
    const expectedProfile = `--user-data-dir=${FIXED_CONFIG.profilePath}`;
    const expectedPort = `--remote-debugging-port=${FIXED_CONFIG.cdpPort}`;
    if (!argumentsList.includes(expectedProfile) || !argumentsList.includes(expectedPort)) {
      throw new ControllerError(
        "browser_identity_mismatch",
        "The live Chrome command line does not match the fixed profile and port.",
      );
    }
    return { profileVerification: "verified" };
  } catch (error) {
    if (error instanceof ControllerError) throw error;
    return { profileVerification: "unavailable", reason: error.message };
  } finally {
    await session?.detach?.();
  }
}

async function disconnectFixedController(browser) {
  // For a browser returned by connectOverCDP, Playwright's public close method
  // closes the client transport created for that connection. It does not send
  // Browser.close to the independently launched persistent Chrome process.
  await browser.close({ reason: "Interview Arc controller command complete" });
}

export function createRuntimeDependencies() {
  return {
    probeCdp: probeFixedCdp,
    waitForCdp: waitForFixedCdp,
    launchChrome: launchFixedChrome,
    restoreActiveApp,
    loadPlaywright: loadFixedPlaywright,
    connectOverCdp: (chromium, endpoint) => chromium.connectOverCDP(endpoint, { timeout: 5_000 }),
    validateBrowserIdentity: validateFixedBrowserIdentity,
    pageAdapterFactory: createPlaywrightPageAdapter,
    cleanupController: disconnectFixedController,
  };
}

async function writePreflightReceipt(receipt) {
  await mkdir(localStateDirectory, { recursive: true });
  const temporaryPath = `${preflightReceiptPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, preflightReceiptPath);
}

export function preflightReceiptForRequest(request, current, recordedAt = new Date().toISOString()) {
  if (request.command !== "navigate") return null;
  return {
    version: 1,
    browserId: current.browserId,
    identity: request.identity,
    recordedAt,
  };
}

async function verifyPreflightReceipt(identity) {
  let receipt;
  try {
    receipt = JSON.parse(await readFile(preflightReceiptPath, "utf8"));
  } catch {
    throw new ControllerError(
      "preflight_required",
      "Run ensure and navigate before interactive submission.",
    );
  }
  const current = await probeFixedCdp();
  if (
    !current.live
    || !current.browserId
    || current.browserId !== receipt.browserId
    || receipt.identity?.slug !== identity.slug
  ) {
    throw new ControllerError(
      "preflight_stale",
      "The controller preflight no longer matches this browser and problem; run ensure and navigate again.",
    );
  }
}

async function withControllerLock(operation) {
  await mkdir(localStateDirectory, { recursive: true });
  const deadline = Date.now() + 15_000;
  let lockHandle;
  while (!lockHandle) {
    try {
      lockHandle = await open(controllerLockPath, "wx", 0o600);
      await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const lockAgeMs = Date.now() - (await stat(controllerLockPath)).mtimeMs;
        if (lockAgeMs > 120_000) {
          await unlink(controllerLockPath);
          continue;
        }
      } catch (inspectionError) {
        if (inspectionError.code !== "ENOENT") throw inspectionError;
        continue;
      }
      if (Date.now() >= deadline) {
        throw new ControllerError(
          "controller_busy",
          "Another command still owns the one-tab LeetCode controller.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    return await operation();
  } finally {
    await lockHandle.close();
    await unlink(controllerLockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function runCli(argv) {
  const commandStartedAt = performance.now();
  return withControllerLock(async () => {
    const request = parseCli(argv);
    const runtime = createRuntimeDependencies();
    const result = await runControllerCommand(request, {
      acquireController: (options) => ensureBrowserController(runtime, options),
      readFileUtf8: (javaFile) => readFile(javaFile, "utf8"),
      verifyPreflight: verifyPreflightReceipt,
    });
    if (request.command === "navigate") {
      const current = await probeFixedCdp();
      await writePreflightReceipt(preflightReceiptForRequest(request, current));
    }
    return {
      ...result,
      diagnostics: {
        ...(result.diagnostics ?? {}),
        totalUserVisibleCommandMs: performance.now() - commandStartedAt,
      },
    };
  });
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  } catch (error) {
    const failure = error instanceof ControllerError
      ? error
      : new ControllerError("controller_failed", error.message);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: failure.code, message: failure.message, details: failure.details },
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

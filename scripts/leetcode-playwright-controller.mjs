#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const repositoryParent = path.dirname(repositoryRoot);
const outerWorkspace = path.basename(repositoryParent) === ".worktrees"
  ? path.dirname(repositoryParent)
  : repositoryParent;
const fixedProfilePath = path.join(outerWorkspace, "browser-profiles", "leetcode-submitter");

export function controllerStatePathsForProfile(profilePath) {
  const stateDirectory = path.join(profilePath, ".interview-arc-controller");
  return Object.freeze({
    stateDirectory,
    preflightReceiptPath: path.join(stateDirectory, "preflight.json"),
    controllerLockPath: path.join(stateDirectory, "controller.lock"),
    receiptDirectory: path.join(stateDirectory, "receipts"),
  });
}

const controllerState = controllerStatePathsForProfile(fixedProfilePath);
const localStateDirectory = controllerState.stateDirectory;
const preflightReceiptPath = controllerState.preflightReceiptPath;
const controllerLockPath = controllerState.controllerLockPath;

export const PLAYWRIGHT_BOOTSTRAP_COMMAND =
  "npm exec --yes pnpm@9.15.9 -- install --frozen-lockfile";

export const CONTROLLER_RECEIPT_POLICY = Object.freeze({
  terminalRetentionMs: 30 * 24 * 60 * 60 * 1_000,
  maxTerminalReceipts: 200,
});

export class ControllerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControllerError";
    this.code = code;
    this.details = details;
  }
}

export function toControllerStateError(error, stateDirectory = localStateDirectory) {
  if (!["EACCES", "EPERM", "EROFS"].includes(error?.code)) return error;
  return new ControllerError(
    "controller_state_unwritable",
    "The controller cannot write state inside the dedicated Chrome profile. Verify that the Interview Prep workspace is writable, then run ensure again.",
    { stateDirectory, cause: error.message },
  );
}

export function validateInvocationId(invocationId) {
  if (
    typeof invocationId !== "string"
    || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(invocationId)
  ) {
    throw new ControllerError(
      "invalid_invocation_id",
      "The invocation ID must use 1–128 lowercase letters, digits, dots, underscores, or hyphens.",
    );
  }
  return invocationId;
}

function controllerFailureEnvelope(error, invocationId = null) {
  const failure = error instanceof ControllerError
    ? error
    : new ControllerError("controller_failed", error?.message ?? String(error));
  return {
    ok: false,
    ...(invocationId ? { invocationId } : {}),
    error: { code: failure.code, message: failure.message, details: failure.details },
  };
}

function receiptPathForInvocationId(invocationId, statePaths) {
  return path.join(statePaths.receiptDirectory, `${validateInvocationId(invocationId)}.json`);
}

export async function pruneTerminalControllerReceipts(
  statePaths = controllerState,
  {
    nowMs = Date.now(),
    terminalRetentionMs = CONTROLLER_RECEIPT_POLICY.terminalRetentionMs,
    maxTerminalReceipts = CONTROLLER_RECEIPT_POLICY.maxTerminalReceipts,
    protectedInvocationId = null,
  } = {},
) {
  try {
    await mkdir(statePaths.receiptDirectory, { recursive: true });
    const entries = await readdir(statePaths.receiptDirectory, { withFileTypes: true });
    const terminalReceipts = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const receiptPath = path.join(statePaths.receiptDirectory, entry.name);
      try {
        const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
        const recordedAtMs = Date.parse(receipt?.recordedAt);
        if (
          receipt?.version === 1
          && receipt?.status === "terminal"
          && Number.isFinite(recordedAtMs)
        ) {
          terminalReceipts.push({
            invocationId: receipt.invocationId,
            receiptPath,
            recordedAtMs,
          });
        }
      } catch {
        // Pending or malformed evidence is never removed automatically.
      }
    }

    terminalReceipts.sort((left, right) => right.recordedAtMs - left.recordedAtMs);
    const retained = new Set(
      terminalReceipts
        .filter((receipt) => (
          receipt.invocationId === protectedInvocationId
          || nowMs - receipt.recordedAtMs <= terminalRetentionMs
        ))
        .slice(0, Math.max(0, maxTerminalReceipts))
        .map((receipt) => receipt.receiptPath),
    );
    let pruned = 0;
    for (const receipt of terminalReceipts) {
      if (receipt.invocationId === protectedInvocationId || retained.has(receipt.receiptPath)) {
        continue;
      }
      await unlink(receipt.receiptPath);
      pruned += 1;
    }
    return { pruned, retained: terminalReceipts.length - pruned };
  } catch (error) {
    const stateFailure = toControllerStateError(error, statePaths.stateDirectory);
    if (stateFailure !== error) throw stateFailure;
    throw new ControllerError(
      "controller_receipt_cleanup_failed",
      "The controller could not enforce its terminal receipt retention policy before browser action.",
      { cause: error.message },
    );
  }
}

async function reserveControllerReceipt(request, statePaths, recordedAt) {
  const receiptPath = receiptPathForInvocationId(request.invocationId, statePaths);
  try {
    await mkdir(statePaths.receiptDirectory, { recursive: true });
    const handle = await open(receiptPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({
        version: 1,
        status: "pending",
        invocationId: request.invocationId,
        command: request.command,
        recordedAt,
      }, null, 2)}\n`);
      await handle.datasync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ControllerError(
        "invocation_id_reused",
        "This controller invocation ID has already been used. Recover its receipt instead of submitting again.",
        { invocationId: request.invocationId },
      );
    }
    const stateFailure = toControllerStateError(error, statePaths.stateDirectory);
    if (stateFailure !== error) throw stateFailure;
    throw new ControllerError(
      "controller_receipt_write_failed",
      "The controller could not reserve a durable receipt before browser action.",
      { invocationId: request.invocationId, cause: error.message },
    );
  }
}

async function writeTerminalControllerReceipt(request, envelope, statePaths, recordedAt) {
  const receiptPath = receiptPathForInvocationId(request.invocationId, statePaths);
  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({
        version: 1,
        status: "terminal",
        invocationId: request.invocationId,
        command: request.command,
        recordedAt,
        envelope,
      }, null, 2)}\n`);
      await handle.datasync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, receiptPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    const stateFailure = toControllerStateError(error, statePaths.stateDirectory);
    if (stateFailure !== error) throw stateFailure;
    throw new ControllerError(
      "controller_receipt_write_failed",
      "The controller completed but could not persist its terminal receipt.",
      {
        invocationId: request.invocationId,
        cause: error.message,
        originalEnvelope: envelope,
      },
    );
  }
}

export async function recoverControllerReceipt(invocationId, statePaths = controllerState) {
  const receiptPath = receiptPathForInvocationId(invocationId, statePaths);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ControllerError(
        "controller_receipt_missing",
        "No controller receipt exists for this exact invocation ID.",
        { invocationId },
      );
    }
    throw new ControllerError(
      "controller_receipt_corrupt",
      "The controller receipt exists but cannot be read safely.",
      { invocationId, cause: error.message },
    );
  }
  if (
    receipt?.version !== 1
    || receipt?.invocationId !== invocationId
    || !["pending", "terminal"].includes(receipt?.status)
  ) {
    throw new ControllerError(
      "controller_receipt_corrupt",
      "The controller receipt does not match the requested invocation.",
      { invocationId },
    );
  }
  if (receipt.status === "pending") {
    throw new ControllerError(
      "controller_receipt_pending",
      "The invocation was reserved but no terminal receipt is available. Do not submit again.",
      { invocationId, command: receipt.command, recordedAt: receipt.recordedAt },
    );
  }
  if (!receipt.envelope || typeof receipt.envelope.ok !== "boolean") {
    throw new ControllerError(
      "controller_receipt_corrupt",
      "The terminal controller receipt has no structured result envelope.",
      { invocationId },
    );
  }
  return {
    ...receipt.envelope,
    receipt: {
      invocationId,
      recovered: true,
      recordedAt: receipt.recordedAt,
    },
  };
}

export async function executeWithDurableReceipt(
  request,
  operation,
  {
    statePaths = controllerState,
    now = () => new Date().toISOString(),
    receiptPolicy = CONTROLLER_RECEIPT_POLICY,
  } = {},
) {
  const invocationId = request.invocationId ?? null;
  if (invocationId) {
    try {
      const reservedAt = now();
      await pruneTerminalControllerReceipts(statePaths, {
        nowMs: Date.parse(reservedAt),
        terminalRetentionMs: receiptPolicy.terminalRetentionMs,
        maxTerminalReceipts: Math.max(0, receiptPolicy.maxTerminalReceipts - 1),
        protectedInvocationId: invocationId,
      });
      await reserveControllerReceipt(request, statePaths, reservedAt);
    } catch (error) {
      return controllerFailureEnvelope(error, invocationId);
    }
  }

  let envelope;
  try {
    const result = await operation();
    envelope = {
      ok: true,
      ...(invocationId ? { invocationId } : {}),
      result,
    };
  } catch (error) {
    envelope = controllerFailureEnvelope(error, invocationId);
  }

  if (invocationId) {
    try {
      await writeTerminalControllerReceipt(request, envelope, statePaths, now());
    } catch (error) {
      return controllerFailureEnvelope(error, invocationId);
    }
  }
  return envelope;
}

export const FIXED_CONFIG = Object.freeze({
  chromeApplication: "/Applications/Google Chrome.app",
  profilePath: fixedProfilePath,
  stateDirectory: localStateDirectory,
  cdpAddress: "127.0.0.1",
  cdpPort: 9223,
  cdpEndpoint: "http://127.0.0.1:9223",
  versionEndpoint: "http://127.0.0.1:9223/json/version",
  defaultLanguage: "Java",
  localBudgetMs: 5_000,
  verdictTimeoutMs: 60_000,
  editorialTimeoutMs: 30_000,
  editorialCommandTimeoutMs: 65_000,
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

export function canonicalEditorialUrl(identity) {
  return `https://leetcode.com/problems/${identity.slug}/editorial/`;
}

export function editorialResearchFingerprint(researchMaterial) {
  const hash = createHash("sha256");
  const updateText = (label, value) => {
    const text = String(value ?? "");
    hash.update(`${label}:${Buffer.byteLength(text, "utf8")}:`, "utf8");
    hash.update(text, "utf8");
  };
  updateText("renderedText", researchMaterial.renderedText);
  for (const [index, heading] of (researchMaterial.headings ?? []).entries()) {
    updateText(`heading.${index}`, heading);
  }
  for (const [index, block] of (researchMaterial.codeBlocks ?? []).entries()) {
    updateText(`codeBlock.${index}.index`, block.index);
    updateText(`codeBlock.${index}.language`, block.language);
    updateText(`codeBlock.${index}.code`, block.code);
  }
  return hash.digest("hex");
}

export function parseCli(argv) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [
    command,
    url,
    possibleFile,
    possibleFlag,
    possibleTitle,
    invocationFlag,
    possibleInvocationId,
  ] = normalizedArgv;
  if (command === "ensure" && normalizedArgv.length === 1) {
    return { command, identity: null, javaFile: null };
  }
  if (
    (command === "navigate" || command === "editorial")
    && normalizedArgv.length === 4
    && possibleFile === "--title"
  ) {
    return {
      command,
      identity: canonicalProblemIdentity(url, possibleFlag),
      javaFile: null,
    };
  }
  if (
    (command === "submit" || command === "retry")
    && normalizedArgv.length === 7
    && possibleFlag === "--title"
    && invocationFlag === "--invocation-id"
  ) {
    return {
      command,
      identity: canonicalProblemIdentity(url, possibleTitle),
      javaFile: possibleFile,
      invocationId: validateInvocationId(possibleInvocationId),
    };
  }
  if (command === "receipt" && normalizedArgv.length === 3 && url === "--invocation-id") {
    return {
      command,
      identity: null,
      javaFile: null,
      invocationId: validateInvocationId(possibleFile),
    };
  }
  if (["navigate", "editorial", "submit", "retry"].includes(command) && !normalizedArgv.includes("--title")) {
    throw new ControllerError("cli_usage", `${command} requires --title with the verified problem title.`);
  }
  if (["submit", "retry"].includes(command) && !normalizedArgv.includes("--invocation-id")) {
    throw new ControllerError(
      "cli_usage",
      `${command} requires --invocation-id with a unique controller invocation ID.`,
    );
  }
  throw new ControllerError(
    "cli_usage",
    "Supported commands are ensure, navigate, editorial, submit, retry, and receipt.",
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
  editorialContent: [
    '[data-e2e-locator="editorial-content"]',
    '[data-testid="editorial-content"]',
    '[data-track-load="editorial_content"]',
    '[class*="solution-markdown" i]',
    'main [role="tabpanel"]',
    'main article',
    'main [class*="markdown" i]',
  ],
  editorialLock: [
    '[data-e2e-locator*="premium" i]',
    '[data-testid*="premium" i]',
    '[data-e2e-locator*="subscribe" i]',
    '[data-testid*="subscribe" i]',
  ],
});

const TARGET_ROUTES = Object.freeze({
  problemEditor: "^/problems/([a-z0-9-]+)/(?:description/)?$",
  problemTab: "^/problems/([a-z0-9-]+)/(?:description/|editorial/|solutions/|submissions/)?$",
  resultAttempt: "^(?:/submissions/(?:detail/)?|/problems/[a-z0-9-]+/submissions/)([^/]+)/?$",
  editorial: "^/problems/([a-z0-9-]+)/editorial/?$",
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

export function leetcodeEditorialSlugFromPath(pathname) {
  return pathname.match(new RegExp(TARGET_ROUTES.editorial))?.[1] ?? null;
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

function abortablePageOperation(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, aborted]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
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
    navigate: (url, signal) => abortablePageOperation(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
      signal,
    ),
    goBack: (signal) => abortablePageOperation(
      page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }),
      signal,
    ),
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
    async waitForEditorialContent(identity, signal) {
      let handle;
      try {
        handle = await abortablePageOperation(page.waitForFunction(
          ({ expectedSlug, expectedTitle, routes, selectors }) => {
            const visible = (element) => element?.getClientRects?.().length > 0;
            const editorialSlug = location.pathname.match(new RegExp(routes.editorial))?.[1] ?? null;
            const problemSlug = location.pathname.match(new RegExp(routes.problemTab))?.[1] ?? null;
            if (problemSlug && problemSlug !== expectedSlug) {
              return {
                state: "identity_ambiguous",
                reason: "editorial_slug_mismatch",
                actualSlug: problemSlug,
                actualPathname: location.pathname,
              };
            }
            if (editorialSlug !== expectedSlug) return false;

            const pageTitle = document.title.trim();
            if (!pageTitle || pageTitle === "LeetCode") return false;
            if (!pageTitle.toLowerCase().includes(expectedTitle.toLowerCase())) {
              return {
                state: "identity_ambiguous",
                reason: "editorial_title_mismatch",
                actualTitle: pageTitle,
              };
            }

            const lockRoots = selectors.editorialLock
              .flatMap((selector) => [...document.querySelectorAll(selector)])
              .filter(visible);
            const lockText = lockRoots
              .map((root) => root.innerText?.trim() ?? "")
              .find((text) => /\b(?:premium|subscribe|unlock)\b/i.test(text));
            if (lockText) {
              return {
                state: "premium_locked",
                reason: "The canonical Editorial article is present, but its rendered content is premium locked.",
              };
            }

            for (let selectorIndex = 0; selectorIndex < selectors.editorialContent.length; selectorIndex += 1) {
              const roots = [...document.querySelectorAll(selectors.editorialContent[selectorIndex])]
                .filter(visible);
              for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
                const root = roots[rootIndex];
                const text = root.innerText?.trim() ?? "";
                const blocks = root.querySelectorAll("h1,h2,h3,p,pre,ul,ol").length;
                if (text.length >= 120 && blocks >= 2) {
                  return { state: "available", rootLocator: { selectorIndex, rootIndex } };
                }
              }
            }
            return false;
          },
          {
            expectedSlug: identity.slug,
            expectedTitle: identity.title,
            routes: TARGET_ROUTES,
            selectors: TARGET_SELECTORS,
          },
          { timeout: FIXED_CONFIG.editorialTimeoutMs, polling: 250 },
        ), signal);
        if (typeof handle?.jsonValue === "function") return await handle.jsonValue();
        return handle;
      } catch (error) {
        if (error?.name !== "TimeoutError") throw error;
        const actualUrl = typeof page.url === "function" ? page.url() : null;
        const recognitionDiagnostics = await page.evaluate(() => {
          const visible = (element) => element?.getClientRects?.().length > 0;
          return [...document.querySelectorAll(
            'main,article,[role="tabpanel"],[data-track-load],[class*="markdown" i],[class*="content" i]',
          )]
            .filter(visible)
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              className: typeof element.className === "string" ? element.className.slice(0, 200) : null,
              trackLoad: element.getAttribute("data-track-load"),
              textLength: (element.innerText ?? "").trim().length,
              blockCount: element.querySelectorAll("h1,h2,h3,p,pre,ul,ol").length,
            }))
            .filter((candidate) => candidate.textLength >= 120)
            .sort((left, right) => right.textLength - left.textLength)
            .slice(0, 12);
        }).catch(() => []);
        let actualPathname = null;
        let actualSlug = null;
        try {
          actualPathname = actualUrl ? new URL(actualUrl).pathname : null;
          actualSlug = actualPathname
            ? actualPathname.match(new RegExp(TARGET_ROUTES.problemTab))?.[1] ?? null
            : null;
        } catch {}
        if (actualSlug && actualSlug !== identity.slug) {
          return { state: "identity_ambiguous", reason: "editorial_slug_mismatch", actualSlug, actualPathname };
        }
        return {
          state: "unavailable",
          reason: "The canonical Editorial page rendered no usable article content before the controller timeout.",
          actualUrl,
          actualPathname,
          recognitionDiagnostics,
        };
      } finally {
        await handle?.dispose?.();
      }
    },
    async readEditorialResearchMaterial(identity, rootLocator, signal) {
      return abortablePageOperation(page.evaluate(async ({ expectedSlug, expectedTitle, rootLocator, routes, selectors }) => {
        const editorialSlug = location.pathname.match(new RegExp(routes.editorial))?.[1] ?? null;
        if (editorialSlug !== expectedSlug || !rootLocator) return null;
        const pageTitle = document.title.trim();
        if (!pageTitle.toLowerCase().includes(expectedTitle.toLowerCase())) return null;

        const visible = (element) => element?.getClientRects?.().length > 0;
        const root = [...document.querySelectorAll(
          selectors.editorialContent[rootLocator.selectorIndex],
        )].filter(visible)[rootLocator.rootIndex] ?? null;
        if (!root) return null;

        const originalX = window.scrollX ?? 0;
        const originalY = window.scrollY ?? 0;
        let scrollContainer = root;
        while (scrollContainer) {
          if ((scrollContainer.scrollHeight ?? 0) > (scrollContainer.clientHeight ?? 0) + 1) break;
          scrollContainer = scrollContainer.parentElement;
        }
        const originalScrollTop = scrollContainer?.scrollTop ?? null;
        try {
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            await new Promise((resolve) => setTimeout(resolve, 100));
          } else {
            const viewportHeight = Math.max(window.innerHeight ?? 800, 400);
            const scrollHeight = document.scrollingElement?.scrollHeight
              ?? document.documentElement?.scrollHeight
              ?? viewportHeight;
            const maximumScroll = Math.max(0, scrollHeight - viewportHeight);
            if (maximumScroll > 0) {
              window.scrollTo?.(0, maximumScroll);
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          const renderedText = root.innerText?.trim() ?? "";
          const headings = [...root.querySelectorAll("h1,h2,h3")]
            .map((heading) => heading.innerText?.trim() ?? "")
            .filter(Boolean);
          const codeSelector = [
            "pre",
            "code",
            '[data-track-load*="code" i]',
            '[data-testid*="code" i]',
            '[class*="codeblock" i]',
            '[class*="code-block" i]',
            ".view-lines",
          ].join(",");
          // LeetCode portals the visible implementation editor outside the
          // markdown root. The route/title fence above scopes this document to
          // the verified Editorial while still allowing that official code pane.
          const rawCodeCandidates = [...document.querySelectorAll(codeSelector)]
            .filter((block) => visible(block) && (block.innerText ?? "").trim().length >= 20);
          const candidateSet = new Set(rawCodeCandidates);
          const codeCandidates = rawCodeCandidates.filter((block) => {
            for (let ancestor = block.parentElement; ancestor; ancestor = ancestor.parentElement) {
              if (candidateSet.has(ancestor)) return false;
            }
            return true;
          });
          const codeBlocks = codeCandidates.map((block, index) => {
            const code = block.matches?.("code") ? block : block.querySelector?.("code");
            const className = typeof code?.className === "string" ? code.className : "";
            const language = block.getAttribute?.("data-language")
              ?? code?.getAttribute?.("data-language")
              ?? className.match(/(?:^|\s)language-([^\s]+)/)?.[1]
              ?? null;
            return {
              index,
              language,
              code: (block.innerText ?? "").trim(),
            };
          });
          return { renderedText, headings, codeBlocks };
        } finally {
          if (scrollContainer && originalScrollTop !== null) scrollContainer.scrollTop = originalScrollTop;
          else window.scrollTo?.(originalX, originalY);
        }
      }, {
        expectedSlug: identity.slug,
        expectedTitle: identity.title,
        rootLocator,
        routes: TARGET_ROUTES,
        selectors: TARGET_SELECTORS,
      }), signal);
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
    let launchContext;
    try {
      launchContext = await dependencies.launchChrome(FIXED_CONFIG);
    } catch (cause) {
      throw new ControllerError(
        "chrome_launch_failed",
        "The fixed Chrome process could not be launched. Run the controller with macOS GUI and loopback permission, then run ensure once more.",
        {
          cause: cause.message,
          requiredSandboxPermission: "require_escalated",
        },
      );
    }
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
    await this.restoreVerifiedEditor(identity);

    const result = await this.submitVerified(identity, javaFile);
    return {
      ...result,
      progress: [
        { stage: "retry_recovered", atMs: 0 },
        ...result.progress,
      ],
    };
  }

  async restoreVerifiedEditor(identity) {
    const currentPath = new URL(this.page.url()).pathname;
    if (leetcodeAttemptKeyFromPath(currentPath) !== null) {
      let backFailure;
      try {
        await this.page.goBack(this.signal);
        await this.page.waitForEditableProblem(identity, this.signal);
        await this.verifyEditableProblem(identity);
      } catch (error) {
        backFailure = error;
        try {
          await this.page.navigate(identity.url, this.signal);
          await this.page.waitForEditableProblem(identity, this.signal);
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
    } else if (
      leetcodeProblemSlugFromPath(currentPath) === identity.slug
      && leetcodeEditorSlugFromPath(currentPath) !== identity.slug
    ) {
      await this.page.navigate(identity.url, this.signal);
      await this.page.waitForEditableProblem(identity, this.signal);
      await this.verifyEditableProblem(identity);
    } else {
      await this.verifyEditableProblem(identity);
    }
  }

  async verifyEditorialOrigin(identity) {
    const currentUrl = new URL(this.page.url());
    const currentSlug = leetcodeProblemSlugFromPath(currentUrl.pathname);
    if (currentSlug && currentSlug !== identity.slug) {
      throw new ControllerError(
        "problem_slug_mismatch",
        "The persistent tab does not show the requested problem.",
        { expectedSlug: identity.slug, actualUrl: currentUrl.href },
      );
    }

    const currentAttemptKey = leetcodeAttemptKeyFromPath(currentUrl.pathname);
    if (currentSlug !== identity.slug && currentAttemptKey === null) {
      throw new ControllerError(
        "problem_tab_stale",
        "The persistent tab is not on a verified problem route for Editorial research.",
        { expectedSlug: identity.slug, actualUrl: currentUrl.href },
      );
    }
  }

  async editorial(identity) {
    const commandStartedAt = this.now();
    await this.verifyEditorialOrigin(identity);
    const problemVerifiedAt = this.now();
    const editorialUrl = canonicalEditorialUrl(identity);
    const navigationStartedAt = this.now();
    await this.page.navigate(editorialUrl, this.signal);
    const navigationCompletedAt = this.now();
    const state = await this.page.waitForEditorialContent(identity, this.signal);
    const contentVerifiedAt = this.now();
    if (state?.state === "identity_ambiguous") {
      throw new ControllerError(
        "editorial_identity_ambiguous",
        "The visible Editorial page identity could not be verified.",
        state,
      );
    }
    const availability = ["available", "premium_locked", "unavailable"].includes(state?.state)
      ? state.state
      : "unavailable";
    const researchMaterial = availability === "available"
      ? await this.page.readEditorialResearchMaterial(identity, state.rootLocator ?? null, this.signal)
      : null;
    if (availability === "available" && !researchMaterial) {
      throw new ControllerError(
        "editorial_research_material_missing",
        "The Editorial rendered, but its research material could not be extracted.",
      );
    }
    const researchExtractedAt = this.now();
    return {
      editorialUrl,
      availability,
      contentAvailable: availability === "available",
      progress: [
        { stage: "problem_identity_verified", atMs: problemVerifiedAt - commandStartedAt },
        { stage: "editorial_navigation_completed", atMs: navigationCompletedAt - commandStartedAt },
        { stage: "editorial_content_verified", atMs: contentVerifiedAt - commandStartedAt },
        { stage: "editorial_research_extracted", atMs: researchExtractedAt - commandStartedAt },
      ],
      diagnostics: {
        problemPreparationMs: problemVerifiedAt - commandStartedAt,
        externalPageLatencyMs: navigationCompletedAt - navigationStartedAt,
        localContentVerificationMs: contentVerifiedAt - navigationCompletedAt,
        localResearchExtractionMs: researchExtractedAt - contentVerifiedAt,
        totalUserVisibleMs: researchExtractedAt - commandStartedAt,
      },
      ...(state?.reason ? { reason: state.reason } : {}),
      ...(researchMaterial
        ? { researchMaterial, contentSha256: editorialResearchFingerprint(researchMaterial) }
        : {}),
      ...(state?.recognitionDiagnostics
        ? { recognitionDiagnostics: state.recognitionDiagnostics }
        : {}),
    };
  }

  async navigate(identity) {
    await this.page.navigate(identity.url, this.signal);
    await this.page.waitForEditableProblem(identity, this.signal);
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
    const timeoutMs = dependencies.commandTimeoutMs ?? (
      request.command === "editorial"
        ? FIXED_CONFIG.editorialCommandTimeoutMs
        : FIXED_CONFIG.verdictTimeoutMs + 10_000
    );
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
      if (request.command === "editorial") return controller.editorial(request.identity);
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
  let playwright;
  try {
    playwright = await import("playwright-core");
  } catch (error) {
    let sharedRoot;
    try {
      const { stdout } = await execFile(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: repositoryRoot },
      );
      sharedRoot = path.dirname(stdout.trim());
    } catch {
      throw error;
    }
    playwright = createRequire(path.join(sharedRoot, "package.json"))("playwright-core");
  }
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
  try {
    await mkdir(localStateDirectory, { recursive: true });
    const temporaryPath = `${preflightReceiptPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, preflightReceiptPath);
  } catch (error) {
    throw toControllerStateError(error);
  }
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
  } catch (error) {
    const stateFailure = toControllerStateError(error);
    if (stateFailure !== error) throw stateFailure;
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
  try {
    await mkdir(localStateDirectory, { recursive: true });
  } catch (error) {
    throw toControllerStateError(error);
  }
  const deadline = Date.now() + 15_000;
  let lockHandle;
  while (!lockHandle) {
    try {
      lockHandle = await open(controllerLockPath, "wx", 0o600);
      await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
    } catch (error) {
      if (error.code !== "EEXIST") throw toControllerStateError(error);
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

export async function runCli(argv, dependencies = {}) {
  const commandStartedAt = performance.now();
  let request;
  try {
    request = parseCli(argv);
  } catch (error) {
    return controllerFailureEnvelope(error);
  }
  const statePaths = dependencies.statePaths ?? controllerState;
  if (request.command === "receipt") {
    try {
      return await recoverControllerReceipt(request.invocationId, statePaths);
    } catch (error) {
      return controllerFailureEnvelope(error, request.invocationId);
    }
  }

  const withLock = dependencies.withLock ?? withControllerLock;
  try {
    return await withLock(() => executeWithDurableReceipt(request, async () => {
      const runtime = dependencies.runtime ?? createRuntimeDependencies();
      const result = await runControllerCommand(request, {
        acquireController: dependencies.acquireController
          ?? ((options) => ensureBrowserController(runtime, options)),
        readFileUtf8: dependencies.readFileUtf8
          ?? ((javaFile) => readFile(javaFile, "utf8")),
        verifyPreflight: dependencies.verifyPreflight ?? verifyPreflightReceipt,
        commandTimeoutMs: dependencies.commandTimeoutMs,
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
    }, {
      statePaths,
      now: dependencies.now,
      receiptPolicy: dependencies.receiptPolicy,
    }));
  } catch (error) {
    return controllerFailureEnvelope(error, request.invocationId ?? null);
  }
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const envelope = await runCli(process.argv.slice(2));
  const output = `${JSON.stringify(envelope, null, 2)}\n`;
  if (envelope.ok) {
    process.stdout.write(output);
  } else {
    process.stderr.write(output);
    process.exitCode = 1;
  }
}

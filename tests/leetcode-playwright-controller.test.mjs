import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONTROLLER_RECEIPT_POLICY,
  ControllerError,
  FIXED_CONFIG,
  LeetCodeController,
  PLAYWRIGHT_BOOTSTRAP_COMMAND,
  canonicalEditorialUrl,
  canonicalProblemIdentity,
  controllerStatePathsForProfile,
  createPlaywrightPageAdapter,
  createRuntimeDependencies,
  ensureBrowserController,
  executeWithDurableReceipt,
  firstUtf8Difference,
  isAutomationOwnedLeetCodeUrl,
  leetcodeAttemptKeyFromPath,
  parseCli,
  preflightReceiptForRequest,
  recoverControllerReceipt,
  runCli,
  runControllerCommand,
  toControllerStateError,
} from "../scripts/leetcode-playwright-controller.mjs";

const identity = Object.freeze({
  url: "https://leetcode.com/problems/serialize-and-deserialize-binary-tree/",
  slug: "serialize-and-deserialize-binary-tree",
  title: "Serialize and Deserialize Binary Tree",
});
const controllerSourcePath = path.resolve(
  import.meta.dirname,
  "..",
  "scripts",
  "leetcode-playwright-controller.mjs",
);

function pageAdapter(overrides = {}) {
  const calls = [];
  let value = "";
  return {
    calls,
    url: () => identity.url,
    navigate: async (url) => { calls.push(["navigate", url]); },
    goBack: async () => { calls.push(["back"]); },
    waitForEditableProblem: async () => {},
    title: async () => `${identity.title} - LeetCode`,
    visibleLanguage: async () => "Java",
    monacoModels: async () => [{ uri: "inmemory://model/Solution.java", languageId: "java" }],
    replaceExactSource: async (source) => {
      calls.push(["setValue", source]);
      value = source;
      return value;
    },
    focusEditor: async () => { calls.push(["focus"]); },
    submissionSnapshot: async () => ({ attemptKey: "old", text: "Accepted" }),
    pressSubmit: async () => { calls.push(["press", "Meta+Enter"]); },
    waitForNewAttemptVerdict: async (baseline, timeoutMs) => {
      calls.push(["wait", baseline, timeoutMs]);
      return {
        transitioned: true,
        attemptKey: "new",
        verdict: "Wrong Answer",
        failingInput: "root = [1,2,3]",
      };
    },
    waitForEditorialContent: async () => ({ state: "available" }),
    readEditorialResearchMaterial: async () => ({
      renderedText: "Editorial explanation.",
      headings: ["Approach 1"],
      codeBlocks: [],
    }),
    ...overrides,
  };
}

function controllerWith(adapter, source, now = (() => performance.now())) {
  return new LeetCodeController({
    page: adapter,
    readFileUtf8: async () => source,
    now,
  });
}

test("the controller exposes one immutable Chrome, profile, CDP, and Java identity", () => {
  assert.equal(
    PLAYWRIGHT_BOOTSTRAP_COMMAND,
    "npm exec --yes pnpm@9.15.9 -- install --frozen-lockfile",
  );
  assert.equal(FIXED_CONFIG.chromeApplication, "/Applications/Google Chrome.app");
  assert.equal(FIXED_CONFIG.cdpAddress, "127.0.0.1");
  assert.equal(FIXED_CONFIG.cdpPort, 9223);
  assert.equal(FIXED_CONFIG.cdpEndpoint, "http://127.0.0.1:9223");
  assert.match(FIXED_CONFIG.profilePath, /browser-profiles\/leetcode-submitter$/);
  assert.equal(
    FIXED_CONFIG.stateDirectory,
    path.join(FIXED_CONFIG.profilePath, ".interview-arc-controller"),
  );
  assert.equal(FIXED_CONFIG.defaultLanguage, "Java");
  assert.equal(FIXED_CONFIG.localBudgetMs, 5_000);
  assert.equal(FIXED_CONFIG.verdictTimeoutMs, 60_000);
  assert.equal(FIXED_CONFIG.editorialTimeoutMs, 30_000);
  assert.equal(FIXED_CONFIG.editorialCommandTimeoutMs, 65_000);
  assert.equal(Object.isFrozen(FIXED_CONFIG), true);
  assert.equal(
    canonicalEditorialUrl(identity),
    "https://leetcode.com/problems/serialize-and-deserialize-binary-tree/editorial/",
  );

  assert.deepEqual(
    canonicalProblemIdentity(
      "https://leetcode.com/problems/serialize-and-deserialize-binary-tree/",
      "Serialize and Deserialize Binary Tree",
    ),
    {
      url: "https://leetcode.com/problems/serialize-and-deserialize-binary-tree/",
      slug: "serialize-and-deserialize-binary-tree",
      title: "Serialize and Deserialize Binary Tree",
    },
  );
  assert.throws(
    () => canonicalProblemIdentity("https://leetcode.com/problems/two-sum/description/", "Two Sum"),
    /canonical problem URL/i,
  );
  assert.throws(
    () => canonicalProblemIdentity("https://example.com/problems/two-sum/", "Two Sum"),
    /canonical problem URL/i,
  );
});

test("controller state stays under the authorized profile and reports permission denial precisely", () => {
  assert.deepEqual(controllerStatePathsForProfile("/workspace/browser-profile"), {
    stateDirectory: "/workspace/browser-profile/.interview-arc-controller",
    preflightReceiptPath: "/workspace/browser-profile/.interview-arc-controller/preflight.json",
    controllerLockPath: "/workspace/browser-profile/.interview-arc-controller/controller.lock",
    receiptDirectory: "/workspace/browser-profile/.interview-arc-controller/receipts",
  });

  const failure = toControllerStateError(
    Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    "/workspace/browser-profile/.interview-arc-controller",
  );
  assert.equal(failure.code, "controller_state_unwritable");
  assert.equal(failure.details.stateDirectory, "/workspace/browser-profile/.interview-arc-controller");
  assert.match(failure.message, /dedicated Chrome profile/i);
});

test("a live CDP endpoint never triggers Chrome launch when Playwright cannot attach", async () => {
  for (const failingStage of ["import", "connect"]) {
    let launches = 0;
    const dependencies = {
      probeCdp: async () => ({ live: true, product: "Chrome/140" }),
      loadPlaywright: async () => {
        if (failingStage === "import") throw new Error("module unavailable");
        return { chromium: {} };
      },
      launchChrome: async () => { launches += 1; },
      connectOverCdp: async () => {
        if (failingStage === "connect") throw new Error("sandbox denied");
        return { contexts: () => [] };
      },
    };

    await assert.rejects(
      () => ensureBrowserController(dependencies),
      (error) => error.code === `playwright_${failingStage}_failed`
        && error.details.cdpLive === true
        && (
          failingStage !== "import"
          || (
            error.details.recoveryCommand === PLAYWRIGHT_BOOTSTRAP_COMMAND
            && /local controller dependencies/i.test(error.message)
          )
        ),
    );
    assert.equal(launches, 0);
  }
});

test("the checked-in runtime dependency loader imports real Playwright", async () => {
  const playwright = await createRuntimeDependencies().loadPlaywright();
  assert.equal(typeof playwright.chromium?.connectOverCDP, "function");
});

test("an absent endpoint launches only the fixed Chrome after Playwright resolves", async () => {
  const events = [];
  const browser = {
    contexts: () => [{ pages: () => [{ url: () => "https://leetcode.com/problems/two-sum/" }] }],
  };
  const result = await ensureBrowserController({
    probeCdp: async () => ({ live: false }),
    loadPlaywright: async () => {
      events.push("playwright-ready");
      return { chromium: {} };
    },
    launchChrome: async (configuration) => {
      events.push(["chrome-launched", configuration]);
    },
    waitForCdp: async () => {
      events.push("cdp-ready");
      return { live: true, product: "Chrome/140" };
    },
    connectOverCdp: async () => browser,
    pageAdapterFactory: (page) => page,
  });

  assert.equal(result.browser, browser);
  assert.equal(events[0], "playwright-ready");
  assert.equal(events[1][0], "chrome-launched");
  assert.equal(events[1][1], FIXED_CONFIG);
  assert.equal(events[2], "cdp-ready");
});

test("a denied fixed-Chrome launch reports the required GUI and loopback authority", async () => {
  await assert.rejects(
    () => ensureBrowserController({
      probeCdp: async () => ({ live: false, cause: "fetch failed" }),
      loadPlaywright: async () => ({ chromium: {} }),
      launchChrome: async () => {
        throw new Error("LaunchServices denied");
      },
    }),
    (error) => error.code === "chrome_launch_failed"
      && error.details.requiredSandboxPermission === "require_escalated"
      && error.details.cause === "LaunchServices denied",
  );
});

test("ensure reacquires exactly one existing LeetCode problem tab and cleans up ambiguity", async () => {
  const problemPage = { url: () => "https://leetcode.com/problems/two-sum/" };
  const unrelatedPage = { url: () => "https://example.com/" };
  const browser = { contexts: () => [{ pages: () => [unrelatedPage, problemPage] }] };
  const result = await ensureBrowserController({
    probeCdp: async () => ({ live: true }),
    loadPlaywright: async () => ({ chromium: {} }),
    launchChrome: async () => assert.fail("must not launch"),
    connectOverCdp: async () => browser,
    pageAdapterFactory: (page) => ({ rawPage: page }),
    cleanupController: async () => assert.fail("successful lease remains available"),
  });
  assert.equal(result.page.rawPage, problemPage);

  for (const pages of [[], [problemPage, { url: () => "https://leetcode.com/problems/three-sum/" }]]) {
    let cleaned = 0;
    await assert.rejects(
      () => ensureBrowserController({
        probeCdp: async () => ({ live: true }),
        loadPlaywright: async () => ({ chromium: {} }),
        launchChrome: async () => assert.fail("must not launch"),
        connectOverCdp: async () => ({ contexts: () => [{ pages: () => pages }] }),
        pageAdapterFactory: (page) => page,
        cleanupController: async () => { cleaned += 1; },
      }),
      (error) => error.code === "problem_tab_ambiguous"
        && error.details.problemTabCount === pages.length,
    );
    assert.equal(cleaned, 1);
  }
});

test("tab discovery and retry recognize LeetCode's nested result route", async () => {
  const nestedResultUrl = `${identity.url}submissions/2092298572/`;
  assert.equal(isAutomationOwnedLeetCodeUrl(nestedResultUrl), true);
  assert.equal(
    leetcodeAttemptKeyFromPath(new URL(nestedResultUrl).pathname),
    "2092298572",
  );

  const nestedPage = { url: () => nestedResultUrl };
  const browser = { contexts: () => [{ pages: () => [nestedPage] }] };
  const lease = await ensureBrowserController({
    probeCdp: async () => ({ live: true }),
    loadPlaywright: async () => ({ chromium: {} }),
    launchChrome: async () => assert.fail("must not launch"),
    connectOverCdp: async () => browser,
    pageAdapterFactory: (page) => page,
  });
  assert.equal(lease.page, nestedPage);

  let currentUrl = nestedResultUrl;
  const adapter = pageAdapter({
    url: () => currentUrl,
    goBack: async () => {
      adapter.calls.push(["back"]);
      currentUrl = identity.url;
    },
  });
  await controllerWith(adapter, "class Codec {}\n").retry(identity, "/tmp/0297.java");
  assert.deepEqual(adapter.calls[0], ["back"]);
  assert.equal(adapter.calls.filter(([name]) => name === "press").length, 1);
});

test("tab discovery and identity verification recognize LeetCode's redirected description route", async () => {
  const descriptionUrl = `${identity.url}description/`;
  assert.equal(isAutomationOwnedLeetCodeUrl(descriptionUrl), true);

  const descriptionPage = { url: () => descriptionUrl };
  const browser = { contexts: () => [{ pages: () => [descriptionPage] }] };
  const lease = await ensureBrowserController({
    probeCdp: async () => ({ live: true }),
    loadPlaywright: async () => ({ chromium: {} }),
    launchChrome: async () => assert.fail("must not launch"),
    connectOverCdp: async () => browser,
    pageAdapterFactory: (page) => page,
  });
  assert.equal(lease.page, descriptionPage);

  const adapter = pageAdapter({ url: () => descriptionUrl });
  await controllerWith(adapter).verifyEditableProblem(identity);
});

test("tab discovery can reacquire a known non-editor problem section without accepting it for submission", async () => {
  const editorialUrl = `${identity.url}editorial/`;
  assert.equal(isAutomationOwnedLeetCodeUrl(editorialUrl), true);

  const editorialPage = { url: () => editorialUrl };
  const browser = { contexts: () => [{ pages: () => [editorialPage] }] };
  const lease = await ensureBrowserController({
    probeCdp: async () => ({ live: true }),
    loadPlaywright: async () => ({ chromium: {} }),
    launchChrome: async () => assert.fail("must not launch"),
    connectOverCdp: async () => browser,
    pageAdapterFactory: (page) => page,
  });
  assert.equal(lease.page, editorialPage);

  await assert.rejects(
    () => controllerWith(pageAdapter({ url: () => editorialUrl })).verifyEditableProblem(identity),
    (error) => error.code === "problem_slug_mismatch",
  );
});

test("submit fails closed before mutation when URL, title, language, or Java model identity drifts", async () => {
  const variants = [
    { url: () => "https://leetcode.com/problems/two-sum/", code: "problem_slug_mismatch" },
    { title: async () => "Two Sum - LeetCode", code: "problem_title_mismatch" },
    { visibleLanguage: async () => "Python3", code: "language_mismatch" },
    { monacoModels: async () => [], code: "java_model_ambiguous" },
    {
      monacoModels: async () => [
        { uri: "inmemory://one.java", languageId: "java" },
        { uri: "inmemory://two.java", languageId: "java" },
      ],
      code: "java_model_ambiguous",
    },
  ];

  for (const variant of variants) {
    const { code, ...override } = variant;
    const adapter = pageAdapter(override);
    await assert.rejects(
      () => controllerWith(adapter, "class Codec {}\n").submit(identity, "/tmp/0297.java"),
      (error) => error.code === code,
    );
    assert.equal(adapter.calls.some(([name]) => name === "setValue"), false);
    assert.equal(adapter.calls.some(([name]) => name === "press"), false);
  }
});

test("submit preserves nested multiline Java byte-for-byte and sends exactly one Meta-Enter", async () => {
  const source = [
    "public class Codec {",
    "  public String serialize(TreeNode root) {",
    "    if (root == null) {",
    "      return \"#\";",
    "    }",
    "    return root.val + \",\" + serialize(root.left) + \",\" + serialize(root.right);",
    "  }",
    "}",
    "",
  ].join("\n");
  const adapter = pageAdapter();
  let reads = 0;
  const controller = new LeetCodeController({
    page: adapter,
    readFileUtf8: async () => { reads += 1; return source; },
    now: () => performance.now(),
  });

  const result = await controller.submit(identity, "/tmp/0297.java");

  assert.equal(reads, 1);
  assert.deepEqual(adapter.calls.filter(([name]) => name === "setValue"), [["setValue", source]]);
  assert.deepEqual(adapter.calls.filter(([name]) => name === "press"), [["press", "Meta+Enter"]]);
  assert.equal(result.verdict, "Wrong Answer");
  assert.equal(result.failingInput, "root = [1,2,3]");
  assert.equal(result.diagnostics.sourceUtf8Bytes, Buffer.byteLength(source));
  assert.equal(result.diagnostics.localAutomationMs <= FIXED_CONFIG.localBudgetMs, true);
  assert.deepEqual(result.progress.map(({ stage }) => stage), [
    "identity_verified",
    "source_read",
    "source_replaced",
    "equality_verified",
    "submission_sent",
    "verdict_received",
  ]);
});

test("a source mismatch reports UTF-8 byte counts and the first differing byte and never submits", async () => {
  const source = "class Solution {\n  String answer() { return \"😀 yes\"; }\n}\n";
  const changed = source.replace("yes", "no");
  const adapter = pageAdapter({
    replaceExactSource: async (value) => {
      adapter.calls.push(["setValue", value]);
      return changed;
    },
  });

  assert.equal(firstUtf8Difference(source, changed), Buffer.byteLength(source.slice(0, source.indexOf("yes"))));
  await assert.rejects(
    () => controllerWith(adapter, source).submit(identity, "/tmp/source.java"),
    (error) => error.code === "source_mismatch"
      && error.details.expectedUtf8Bytes === Buffer.byteLength(source)
      && error.details.actualUtf8Bytes === Buffer.byteLength(changed)
      && error.details.firstDifferingByteOffset === firstUtf8Difference(source, changed),
  );
  assert.equal(adapter.calls.some(([name]) => name === "press"), false);
});

test("an already visible verdict cannot satisfy the new attempt-specific verdict wait", async () => {
  const adapter = pageAdapter({
    waitForNewAttemptVerdict: async (baseline) => ({
      transitioned: true,
      attemptKey: baseline.attemptKey,
      verdict: "Accepted",
      failingInput: null,
    }),
  });
  await assert.rejects(
    () => controllerWith(adapter, "class Solution {}\n").submit(identity, "/tmp/source.java"),
    (error) => error.code === "submission_transition_missing",
  );
  assert.equal(adapter.calls.filter(([name]) => name === "press").length, 1);
});

test("retry uses Back first, falls back to canonical same-tab navigation, and never submits failed recovery", async () => {
  for (const backWorks of [true, false]) {
    let currentUrl = "https://leetcode.com/submissions/detail/123456789/";
    let languageChecks = 0;
    const adapter = pageAdapter({
      url: () => currentUrl,
      visibleLanguage: async () => {
        languageChecks += 1;
        return "Java";
      },
      goBack: async () => {
        adapter.calls.push(["back"]);
        if (backWorks) currentUrl = identity.url;
      },
      navigate: async (url) => {
        adapter.calls.push(["navigate", url]);
        currentUrl = url;
      },
    });

    await controllerWith(adapter, "class Codec {}\n").retry(identity, "/tmp/0297.java");
    assert.deepEqual(adapter.calls[0], ["back"]);
    assert.equal(adapter.calls.some(([name]) => name === "navigate"), !backWorks);
    assert.equal(adapter.calls.filter(([name]) => name === "press").length, 1);
    assert.equal(languageChecks, 1, "retry recovery should not repeat verified editor checks");
  }

  const failed = pageAdapter({
    url: () => "https://leetcode.com/submissions/detail/123456789/",
    goBack: async () => { failed.calls.push(["back"]); },
    navigate: async (url) => { failed.calls.push(["navigate", url]); },
  });
  await assert.rejects(
    () => controllerWith(failed, "class Codec {}\n").retry(identity, "/tmp/0297.java"),
    (error) => error.code === "retry_recovery_failed",
  );
  assert.equal(failed.calls.some(([name]) => name === "press"), false);
});

test("retry restores the editor when Editorial research left the persistent tab on Editorial", async () => {
  let currentUrl = `${identity.url}editorial/`;
  const adapter = pageAdapter({
    url: () => currentUrl,
    navigate: async (url) => {
      adapter.calls.push(["navigate", url]);
      currentUrl = url;
    },
  });

  await controllerWith(adapter, "class Codec {}\n").retry(identity, "/tmp/0297.java");
  assert.deepEqual(adapter.calls[0], ["navigate", identity.url]);
  assert.equal(adapter.calls.filter(([name]) => name === "press").length, 1);
});

test("navigate reuses the existing page and verifies the editable Java problem", async () => {
  let currentUrl = "https://leetcode.com/problems/two-sum/";
  const adapter = pageAdapter({
    url: () => currentUrl,
    navigate: async (url) => {
      adapter.calls.push(["navigate", url]);
      currentUrl = url;
    },
    waitForEditableProblem: async (expected) => {
      adapter.calls.push(["wait-editor", expected.url]);
    },
  });
  await controllerWith(adapter, "").navigate(identity);
  assert.deepEqual(adapter.calls, [
    ["navigate", identity.url],
    ["wait-editor", identity.url],
  ]);
});

test("editorial research reuses the verified tab, navigates same-tab, and never submits", async () => {
  let currentUrl = identity.url;
  const researchMaterial = {
    renderedText: "Approach 1\nUse a recursive traversal.\nclass Solution {}",
    headings: ["Approach 1"],
    codeBlocks: [{ index: 0, language: "java", code: "class Solution {}" }],
  };
  const adapter = pageAdapter({
    url: () => currentUrl,
    navigate: async (url) => {
      adapter.calls.push(["navigate", url]);
      currentUrl = url;
    },
    waitForEditorialContent: async () => {
      adapter.calls.push(["editorial-content"]);
      return { state: "available" };
    },
    readEditorialResearchMaterial: async () => researchMaterial,
  });

  const result = await controllerWith(adapter).editorial(identity);
  assert.equal(result.editorialUrl, canonicalEditorialUrl(identity));
  assert.equal(result.availability, "available");
  assert.equal(result.contentAvailable, true);
  assert.deepEqual(result.researchMaterial, researchMaterial);
  assert.deepEqual(adapter.calls, [
    ["navigate", canonicalEditorialUrl(identity)],
    ["editorial-content"],
  ]);
  assert.equal(adapter.calls.some(([name]) => name === "press"), false);
});

test("editorial research reports locked and shell-only content without citing it", async () => {
  for (const state of ["premium_locked", "unavailable"]) {
    const adapter = pageAdapter({
      waitForEditorialContent: async () => ({
        state,
        ...(state === "unavailable" ? { reason: "editorial_content_not_rendered" } : {}),
      }),
    });
    const result = await controllerWith(adapter).editorial(identity);
    assert.equal(result.availability, state);
    assert.equal(result.contentAvailable, false);
    assert.equal(result.editorialUrl, canonicalEditorialUrl(identity));
    assert.equal(
      result.reason,
      state === "unavailable" ? "editorial_content_not_rendered" : undefined,
    );
  }
});

test("editorial research navigates directly from a submission result without an editor recovery hop", async () => {
  let currentUrl = `${identity.url}submissions/123456789/`;
  const adapter = pageAdapter({
    url: () => currentUrl,
    waitForEditorialContent: async () => ({ state: "available" }),
  });
  const result = await controllerWith(adapter).editorial(identity);
  assert.equal(result.availability, "available");
  assert.deepEqual(adapter.calls, [["navigate", canonicalEditorialUrl(identity)]]);
  assert.equal(adapter.calls.some(([name]) => name === "press"), false);
});

test("editorial research navigates directly from every same-problem content route", async () => {
  for (const suffix of ["description/", "editorial/", "solutions/"]) {
    let currentUrl = `${identity.url}${suffix}`;
    const adapter = pageAdapter({
      url: () => currentUrl,
      navigate: async (url) => {
        adapter.calls.push(["navigate", url]);
        currentUrl = url;
      },
      waitForEditorialContent: async () => ({ state: "available" }),
    });

    const result = await controllerWith(adapter).editorial(identity);
    assert.equal(result.availability, "available");
    assert.deepEqual(adapter.calls, [["navigate", canonicalEditorialUrl(identity)]], suffix);
    assert.equal(adapter.calls.some(([name]) => name === "press"), false, suffix);
  }
});

test("the Playwright adapter uses scoped inspection, one Monaco setValue, DOM focus, and one gesture", async () => {
  const operations = [];
  const gestures = [];
  let resultReads = 0;
  const page = {
    url: () => identity.url,
    title: async () => `${identity.title} - LeetCode`,
    goto: async (url) => { operations.push(["goto", url]); },
    goBack: async () => { operations.push(["goBack"]); },
    evaluate: async (browserOperation, payload) => {
      operations.push([payload.operation, payload.source]);
      if (payload.operation === "visible-language") {
        const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
        Object.defineProperty(globalThis, "document", { configurable: true, value: {
          querySelector: () => null,
          querySelectorAll: () => [{ textContent: "Java", getClientRects: () => [{}] }],
        } });
        try {
          return browserOperation(payload);
        } finally {
          if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
          else delete globalThis.document;
        }
      }
      if (payload.operation === "monaco-models") {
        return [{ uri: "file:///Solution.java", languageId: "java" }];
      }
      if (payload.operation === "replace-exact") return payload.source;
      if (payload.operation === "focus-editor") return true;
      if (payload.operation === "submission-snapshot") {
        return { attemptKey: "old", text: "Accepted" };
      }
      if (payload.operation === "attempt-key") return "new";
      if (payload.operation === "attempt-result") {
        resultReads += 1;
        if (resultReads === 1) return { verdict: null, failingInput: null };
        return { verdict: "Accepted", failingInput: null };
      }
      throw new Error(`unexpected operation ${payload.operation}`);
    },
    waitForFunction: async (predicate, payload, options) => {
      operations.push(["waitForFunction", payload.kind, options.timeout]);
      assert.equal(payload.expectedSlug, identity.slug);
      const previous = {
        document: Object.getOwnPropertyDescriptor(globalThis, "document"),
        location: Object.getOwnPropertyDescriptor(globalThis, "location"),
        monaco: Object.getOwnPropertyDescriptor(globalThis, "monaco"),
      };
      Object.defineProperties(globalThis, {
        document: { configurable: true, value: {
          title: `${identity.title} - LeetCode`,
        } },
        location: { configurable: true, value: {
          pathname: `/problems/${identity.slug}/description/`,
        } },
        monaco: { configurable: true, value: { editor: { getModels: () => [{
          getLanguageId: () => "java",
          uri: { toString: () => "file:///Solution.java" },
        }] } } },
      });
      try {
        assert.equal(predicate(payload), true);
      } finally {
        for (const [name, descriptor] of Object.entries(previous)) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
      }
      return { dispose: async () => {} };
    },
    keyboard: { press: async (gesture) => { gestures.push(gesture); } },
  };

  const adapter = createPlaywrightPageAdapter(page);
  await adapter.waitForEditableProblem(identity);
  assert.equal(await adapter.visibleLanguage(), "Java");
  assert.equal((await adapter.monacoModels()).length, 1);
  assert.equal(await adapter.replaceExactSource("class Codec {}\n"), "class Codec {}\n");
  await adapter.focusEditor();
  const snapshot = await adapter.submissionSnapshot();
  await adapter.pressSubmit();
  const verdict = await adapter.waitForNewAttemptVerdict(snapshot, 60_000);
  await adapter.goBack();
  await adapter.navigate(identity.url);

  assert.deepEqual(gestures, ["Meta+Enter"]);
  assert.equal(verdict.attemptKey, "new");
  assert.equal(operations.some(([, kind]) => kind === "editor"), true);
  assert.equal(operations.some(([operation]) => operation === "attempt-key"), true);
  assert.equal(operations.filter(([operation]) => operation === "attempt-result").length, 2);
  assert.equal(operations.some(([operation]) => operation === "body-text"), false);
  assert.equal(operations.filter(([operation]) => operation === "replace-exact").length, 1);
});

test("the Playwright adapter returns rendered Editorial research material", async () => {
  const operations = [];
  const heading = { innerText: "Approach 1" };
  const code = {
    className: "language-java",
    getAttribute: () => null,
  };
  const pre = {
    innerText: "class Solution { void solve() {} }",
    getClientRects: () => [{}],
    getAttribute: () => null,
    querySelector: (selector) => selector === "code" ? code : null,
  };
  const root = {
    getClientRects: () => [{}],
    innerText: "Editorial explanation with multiple rendered blocks and enough visible text to prove that the article itself rendered instead of only the surrounding navigation shell.",
    querySelectorAll: (selector) => {
      if (selector === "h1,h2,h3,p,pre,ul,ol") return [heading, pre];
      if (selector === "h1,h2,h3") return [heading];
      if (selector === "pre" || selector.startsWith("pre,")) return [pre];
      return [];
    },
  };
  const testLocation = { pathname: `/problems/${identity.slug}/description/` };
  const testWindow = {
    scrollX: 0,
    scrollY: 0,
    innerHeight: 800,
    scrollTo: () => {},
  };
  const testDocument = {
    title: `${identity.title} - LeetCode`,
    scrollingElement: { scrollHeight: 800 },
    documentElement: { scrollHeight: 800 },
    querySelectorAll: (selector) => {
      if (selector.includes('data-e2e-locator="editorial-content"')) return [root];
      if (selector.startsWith("pre,")) return [pre];
      return [];
    },
  };
  const page = {
    waitForFunction: async (predicate, payload, options) => {
      operations.push(["waitForFunction", options.timeout]);
      const previous = {
        document: Object.getOwnPropertyDescriptor(globalThis, "document"),
        location: Object.getOwnPropertyDescriptor(globalThis, "location"),
      };
      Object.defineProperties(globalThis, {
        document: { configurable: true, value: testDocument },
        location: { configurable: true, value: testLocation },
      });
      try {
        assert.equal(predicate(payload), false, "same-problem SPA transition must keep waiting");
        testLocation.pathname = `/problems/${identity.slug}/editorial/`;
        const state = predicate(payload);
        assert.deepEqual(state, { state: "available" });
        return {
          jsonValue: async () => state,
          dispose: async () => {},
        };
      } finally {
        for (const [name, descriptor] of Object.entries(previous)) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
      }
    },
    evaluate: async (browserOperation, payload) => {
      const previous = {
        document: Object.getOwnPropertyDescriptor(globalThis, "document"),
        location: Object.getOwnPropertyDescriptor(globalThis, "location"),
        window: Object.getOwnPropertyDescriptor(globalThis, "window"),
      };
      Object.defineProperties(globalThis, {
        document: { configurable: true, value: testDocument },
        location: { configurable: true, value: testLocation },
        window: { configurable: true, value: testWindow },
      });
      try {
        return await browserOperation(payload);
      } finally {
        for (const [name, descriptor] of Object.entries(previous)) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
      }
    },
  };

  const adapter = createPlaywrightPageAdapter(page);
  const state = await adapter.waitForEditorialContent(identity);
  assert.equal(state.state, "available");
  const researchMaterial = await adapter.readEditorialResearchMaterial(identity);
  assert.equal(researchMaterial.renderedText, root.innerText);
  assert.deepEqual(researchMaterial.headings, ["Approach 1"]);
  assert.deepEqual(researchMaterial.codeBlocks, [
    { index: 0, language: "java", code: "class Solution { void solve() {} }" },
  ]);
  assert.deepEqual(operations, [["waitForFunction", FIXED_CONFIG.editorialTimeoutMs]]);
});

test("the CLI exposes controller commands and requires an invocation ID for submit or retry", () => {
  assert.deepEqual(parseCli(["ensure"]), { command: "ensure", identity: null, javaFile: null });
  assert.deepEqual(
    parseCli(["--", "ensure"]),
    { command: "ensure", identity: null, javaFile: null },
    "pnpm forwards its documented separator to the script",
  );
  assert.deepEqual(
    parseCli(["--", "navigate", identity.url, "--title", identity.title]),
    { command: "navigate", identity, javaFile: null },
  );
  assert.deepEqual(parseCli(["navigate", identity.url, "--title", identity.title]), {
    command: "navigate",
    identity,
    javaFile: null,
  });
  assert.deepEqual(parseCli(["editorial", identity.url, "--title", identity.title]), {
    command: "editorial",
    identity,
    javaFile: null,
  });
  assert.deepEqual(
    parseCli([
      "submit",
      identity.url,
      "/tmp/0297.java",
      "--title",
      identity.title,
      "--invocation-id",
      "submit-0297-20260804-01",
    ]),
    {
      command: "submit",
      identity,
      javaFile: "/tmp/0297.java",
      invocationId: "submit-0297-20260804-01",
    },
  );
  assert.deepEqual(
    parseCli([
      "retry",
      identity.url,
      "/tmp/0297.java",
      "--title",
      identity.title,
      "--invocation-id",
      "retry-0297-20260804-01",
    ]).command,
    "retry",
  );
  assert.deepEqual(
    parseCli(["receipt", "--invocation-id", "submit-0297-20260804-01"]),
    {
      command: "receipt",
      identity: null,
      javaFile: null,
      invocationId: "submit-0297-20260804-01",
    },
  );
  assert.throws(() => parseCli(["submit", identity.url, "/tmp/0297.java"]), /--title/);
  assert.throws(
    () => parseCli(["submit", identity.url, "/tmp/0297.java", "--title", identity.title]),
    /--invocation-id/,
  );
  assert.throws(
    () => parseCli(["receipt", "--invocation-id", "../other-receipt"]),
    /invocation ID/i,
  );
  assert.throws(() => parseCli(["launch"]), /supported command/i);
});

test("a terminal receipt recovers a successful submit after stdout is lost without another gesture", async () => {
  const profilePath = await mkdtemp(path.join(tmpdir(), "interview-arc-controller-receipt-"));
  const statePaths = controllerStatePathsForProfile(profilePath);
  const request = {
    command: "submit",
    invocationId: "submit-0297-20260804-stdout-loss",
  };
  let submitGestures = 0;
  try {
    const originalEnvelope = await executeWithDurableReceipt(
      request,
      async () => {
        submitGestures += 1;
        return { verdict: "Accepted", failingInput: null };
      },
      { statePaths, now: () => "2026-08-04T08:00:00.000Z" },
    );
    assert.equal(originalEnvelope.ok, true);

    // Simulate the command transport dropping stdout by discarding the returned envelope.
    const recovered = await recoverControllerReceipt(
      request.invocationId,
      statePaths,
    );
    assert.deepEqual(recovered, {
      ...originalEnvelope,
      receipt: {
        invocationId: request.invocationId,
        recovered: true,
        recordedAt: "2026-08-04T08:00:00.000Z",
      },
    });
    assert.equal(submitGestures, 1);

    const duplicate = await executeWithDurableReceipt(
      request,
      async () => {
        submitGestures += 1;
        return { verdict: "Accepted" };
      },
      { statePaths, now: () => "2026-08-04T08:00:01.000Z" },
    );
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error.code, "invocation_id_reused");
    assert.equal(submitGestures, 1, "a reused ID must fail before browser action");

    const receiptFiles = await readdir(statePaths.receiptDirectory);
    assert.deepEqual(receiptFiles, [`${request.invocationId}.json`]);
  } finally {
    await rm(profilePath, { recursive: true, force: true });
  }
});

test("durable receipts preserve structured failures and isolate exact invocation IDs", async () => {
  const profilePath = await mkdtemp(path.join(tmpdir(), "interview-arc-controller-receipt-"));
  const statePaths = controllerStatePathsForProfile(profilePath);
  const request = {
    command: "retry",
    invocationId: "retry-0297-20260804-failure",
  };
  try {
    const originalEnvelope = await executeWithDurableReceipt(
      request,
      async () => {
        throw new ControllerError("submission_verdict_missing", "No terminal verdict.", {
          attemptKey: "attempt-123",
        });
      },
      { statePaths, now: () => "2026-08-04T08:01:00.000Z" },
    );
    assert.equal(originalEnvelope.ok, false);
    assert.equal(originalEnvelope.error.code, "submission_verdict_missing");

    const recovered = await recoverControllerReceipt(request.invocationId, statePaths);
    assert.equal(recovered.ok, false);
    assert.equal(recovered.error.code, "submission_verdict_missing");
    assert.equal(recovered.receipt.invocationId, request.invocationId);

    await assert.rejects(
      () => recoverControllerReceipt("retry-0297-20260804-other", statePaths),
      (error) => error.code === "controller_receipt_missing",
    );
  } finally {
    await rm(profilePath, { recursive: true, force: true });
  }
});

test("terminal receipt retention is bounded while pending or malformed evidence is preserved", async () => {
  const profilePath = await mkdtemp(path.join(tmpdir(), "interview-arc-controller-receipt-"));
  const statePaths = controllerStatePathsForProfile(profilePath);
  const receiptPolicy = { terminalRetentionMs: 60_000, maxTerminalReceipts: 2 };
  try {
    for (const [index, invocationId] of ["first", "second", "third"].entries()) {
      const envelope = await executeWithDurableReceipt(
        { command: "submit", invocationId: `submit-retention-${invocationId}` },
        async () => ({ verdict: "Accepted" }),
        {
          statePaths,
          receiptPolicy,
          now: () => new Date(1785830400000 + index * 1_000).toISOString(),
        },
      );
      assert.equal(envelope.ok, true);
    }

    const receiptFiles = (await readdir(statePaths.receiptDirectory)).sort();
    assert.deepEqual(receiptFiles, [
      "submit-retention-second.json",
      "submit-retention-third.json",
    ]);
    await assert.rejects(
      () => recoverControllerReceipt("submit-retention-first", statePaths),
      (error) => error.code === "controller_receipt_missing",
    );
    assert.equal(CONTROLLER_RECEIPT_POLICY.maxTerminalReceipts, 200);
    assert.equal(CONTROLLER_RECEIPT_POLICY.terminalRetentionMs, 30 * 24 * 60 * 60 * 1_000);
  } finally {
    await rm(profilePath, { recursive: true, force: true });
  }
});

test("receipt CLI recovery reads durable state without acquiring or connecting to the browser", async () => {
  const profilePath = await mkdtemp(path.join(tmpdir(), "interview-arc-controller-receipt-"));
  const statePaths = controllerStatePathsForProfile(profilePath);
  const request = {
    command: "submit",
    invocationId: "submit-0297-20260804-read-only",
  };
  try {
    await executeWithDurableReceipt(
      request,
      async () => ({ verdict: "Wrong Answer", failingInput: "root = []" }),
      { statePaths, now: () => "2026-08-04T08:02:00.000Z" },
    );
    const recovered = await runCli(
      ["receipt", "--invocation-id", request.invocationId],
      {
        statePaths,
        acquireController: async () => assert.fail("receipt must not acquire the browser"),
        withLock: async () => assert.fail("receipt must not acquire the controller lock"),
      },
    );
    assert.equal(recovered.ok, true);
    assert.equal(recovered.result.verdict, "Wrong Answer");
    assert.equal(recovered.receipt.recovered, true);
  } finally {
    await rm(profilePath, { recursive: true, force: true });
  }
});

test("command execution always disconnects the controller without closing Chrome or its tab", async () => {
  let disconnects = 0;
  let browserCloses = 0;
  const adapter = pageAdapter({
    url: () => "https://leetcode.com/submissions/detail/123456789/",
    goBack: async () => { throw new Error("no history"); },
    navigate: async () => { throw new Error("navigation failed"); },
  });
  const browser = { close: async () => { browserCloses += 1; } };

  await assert.rejects(
    () => runControllerCommand(
      { command: "retry", identity, javaFile: "/tmp/0297.java" },
      {
        acquireController: async () => ({
          browser,
          page: adapter,
          cleanup: async () => { disconnects += 1; },
        }),
        readFileUtf8: async () => "class Codec {}\n",
        verifyPreflight: async () => {},
      },
    ),
    (error) => error.code === "retry_recovery_failed",
  );

  assert.equal(disconnects, 1);
  assert.equal(browserCloses, 0);
  assert.equal(adapter.calls.some(([name]) => name === "press"), false);
});

test("a controller timeout clears its timer, disconnects promptly, and never auto-retries", async () => {
  let disconnects = 0;
  let operationSettled = false;
  const adapter = pageAdapter({
    waitForNewAttemptVerdict: async (_baseline, _timeoutMs, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        operationSettled = true;
        reject(signal.reason);
      }, { once: true });
    }),
  });
  const startedAt = performance.now();

  await assert.rejects(
    () => runControllerCommand(
      { command: "submit", identity, javaFile: "/tmp/0297.java" },
      {
        acquireController: async () => ({
          page: adapter,
          cleanup: async () => { disconnects += 1; },
        }),
        readFileUtf8: async () => "class Codec {}\n",
        verifyPreflight: async () => {},
        commandTimeoutMs: 25,
      },
    ),
    (error) => error.code === "controller_timeout",
  );

  assert.equal(performance.now() - startedAt < 500, true);
  assert.equal(disconnects, 1);
  assert.equal(operationSettled, true, "cleanup must wait for the aborted operation to terminate");
  assert.equal(adapter.calls.filter(([name]) => name === "press").length, 1);
});

test("ensure preserves problem preflight while navigate records the verified identity", () => {
  const current = { browserId: "browser-123" };
  assert.equal(
    preflightReceiptForRequest({ command: "ensure", identity: null }, current),
    null,
  );
  assert.deepEqual(
    preflightReceiptForRequest({ command: "navigate", identity }, current, "2026-08-03T00:00:00.000Z"),
    {
      version: 1,
      browserId: "browser-123",
      identity,
      recordedAt: "2026-08-03T00:00:00.000Z",
    },
  );
});

test("the warm submit path fails closed instead of launching Chrome when preflight state is absent", async () => {
  let launches = 0;
  await assert.rejects(
    () => ensureBrowserController({
      probeCdp: async () => ({ live: false }),
      loadPlaywright: async () => ({ chromium: {} }),
      launchChrome: async () => { launches += 1; },
      connectOverCdp: async () => assert.fail("must not connect"),
    }, { allowLaunch: false }),
    (error) => error.code === "preflight_required",
  );
  assert.equal(launches, 0);
});

test("Editorial research needs no stale preflight hop from problem or submission routes", async () => {
  let preflightChecks = 0;
  for (const currentUrl of [
    canonicalEditorialUrl(identity),
    "https://leetcode.com/submissions/detail/attempt-1/",
  ]) {
    const adapter = pageAdapter({ url: () => currentUrl });
    adapter.navigate = async () => {};
    adapter.waitForEditorialContent = async () => ({ state: "available" });
    const result = await runControllerCommand(
      { command: "editorial", identity },
      {
        verifyPreflight: async () => { preflightChecks += 1; },
        acquireController: async () => ({ page: adapter, cleanup: async () => {} }),
      },
    );
    assert.equal(result.availability, "available");
  }
  assert.equal(preflightChecks, 0);
});

test("a warm local-stage budget overrun names the stalled stage and stops before mutation", async () => {
  const ticks = [0, 0, 0, 5_001];
  const adapter = pageAdapter();
  await assert.rejects(
    () => controllerWith(adapter, "class Solution {}\n", () => ticks.shift() ?? 5_001)
      .submit(identity, "/tmp/source.java"),
    (error) => error.code === "local_stage_timeout"
      && error.details.stage === "source_read"
      && error.details.budgetMs === 5_000,
  );
  assert.equal(adapter.calls.some(([name]) => name === "setValue"), false);
  assert.equal(adapter.calls.some(([name]) => name === "press"), false);
});

test("the checked-in hot path contains no alternate controller, typing, tab, focus, or self-edit fallback", async () => {
  const source = await readFile(controllerSourcePath, "utf8");
  assert.doesNotMatch(source, /\.newPage\s*\(/);
  assert.doesNotMatch(source, /\.bringToFront\s*\(/);
  assert.doesNotMatch(source, /Input\.insertText\s*\(/);
  assert.doesNotMatch(source, /keyboard\.(?:type|insertText)\s*\(/);
  assert.doesNotMatch(source, /launchPersistentContext\s*\(/);
  assert.doesNotMatch(source, /new WebSocket\s*\(/);
  assert.doesNotMatch(source, /document\.body/);
  assert.doesNotMatch(source, /process\.env\.(?:PORT|CDP|CHROME|PROFILE)/);
  assert.doesNotMatch(source, /Library["',/\\\s]+Caches["',/\\\s]+InterviewArc/);
  assert.doesNotMatch(source, /writeFile\([^,]*import\.meta\.url/);
  assert.equal(source.match(/"Meta\+Enter"/g)?.length, 1);
  assert.equal(
    source.match(/new RegExp\(routes\.resultAttempt\)/g)?.length,
    1,
    "browser-side attempt route parsing should have one implementation",
  );
  assert.match(source, /chromium\.connectOverCDP\(endpoint/);
  assert.match(source, /\.datasync\(\)/);
});

test("the specialist guide and owning contract name the checked-in helper as the only submission path", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const [guide, contract, lifecycle] = await Promise.all([
    readFile(path.join(repoRoot, "practice", "leetcode", "AGENTS.md"), "utf8"),
    readFile(path.join(repoRoot, "docs", "contracts", "leetcode-playwright-controller.md"), "utf8"),
    readFile(path.join(repoRoot, "docs", "agents", "issue-lifecycle.md"), "utf8"),
  ]);
  for (const content of [guide, contract]) {
    assert.match(content, /scripts\/leetcode-playwright-controller\.mjs/);
    assert.match(content, /only\s+supported/i);
    assert.match(content, /ensure/);
    assert.match(content, /navigate/);
    assert.match(content, /editorial/);
    assert.match(content, /submit/);
    assert.match(content, /retry/);
    assert.match(content, /receipt/);
    assert.match(content, /--invocation-id/);
  }
  assert.match(contract, /warm(?:-|\s+)submit/i);
  assert.match(contract, /five-second/i);
  assert.match(contract, /60-second/i);
  for (const content of [guide, contract]) {
    assert.match(content, /mandatory specialist route/i);
    assert.match(content, /no side diagnostics/i);
    assert.match(content, /lost or ambiguous/i);
    assert.match(content, /never (?:re)?send .*submit.*retry/is);
    assert.match(content, /same invocation ID/i);
    assert.match(content, /GUI.*loopback/is);
    assert.match(content, /require_escalated/);
  }
  assert.doesNotMatch(guide, /LEETCODE_REPO_ROOT=/);
  assert.doesNotMatch(guide, /curl .*127\.0\.0\.1:9223/is);
  assert.match(guide, /node scripts\/leetcode-playwright-controller\.mjs (?:ensure|navigate)/);
  assert.doesNotMatch(guide, /pnpm leetcode:browser/);
  for (const content of [guide, contract, lifecycle]) {
    assert.ok(content.includes(PLAYWRIGHT_BOOTSTRAP_COMMAND));
  }
  assert.match(guide, /real local.*ensure/is);
  assert.match(lifecycle, /package\.json.*pnpm-lock\.yaml.*canonical\s+checkout.*real.*ensure/is);
});

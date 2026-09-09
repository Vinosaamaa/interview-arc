import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertControllerProfileReady,
  controllerStatePathsForProfile,
  createRuntimeDependencies,
  ensureBrowserController,
  FIXED_CONFIG,
  resolveControllerRepository,
  runCli,
} from "../scripts/leetcode-playwright-controller.mjs";

const source = path.resolve(import.meta.dirname, "../scripts/leetcode-playwright-controller.mjs");
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "arc-profile-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "interview-arc");
  await mkdir(path.join(checkout, "scripts"), { recursive: true });
  await copyFile(source, path.join(checkout, "scripts/leetcode-playwright-controller.mjs"));
  git(checkout, "init");
  git(checkout, "add", ".");
  git(checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  return { root, checkout, location: resolveControllerRepository(checkout) };
}

test("real primary and linked Git checkouts import one canonical controller identity regardless of cwd", async (t) => {
  const { root, checkout, location } = await fixture(t);
  const linked = path.join(root, "arbitrary", "issue-checkout");
  git(checkout, "worktree", "add", "--detach", linked, "HEAD");
  const alias = path.join(root, "alias");
  await symlink(checkout, alias, "dir");
  assert.equal(resolveControllerRepository(linked).profilePath, location.profilePath);
  assert.equal(resolveControllerRepository(alias).profilePath, location.profilePath);
  assert.equal(location.profilePath, path.join(location.canonicalRoot, "browser-profiles/leetcode-submitter"));
  for (const cwd of [checkout, linked, alias]) {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e",
      `import { FIXED_CONFIG } from ${JSON.stringify(pathToFileURL(path.join(cwd, "scripts/leetcode-playwright-controller.mjs")).href)}; console.log(JSON.stringify(FIXED_CONFIG));`,
    ], { cwd: root, encoding: "utf8" });
    const imported = JSON.parse(result);
    assert.equal(imported.profilePath, location.profilePath);
    assert.equal(imported.stateDirectory, controllerStatePathsForProfile(location.profilePath).stateDirectory);
  }
  const stdinImport = execFileSync(process.execPath, ["--input-type=module", "-"], {
    cwd: checkout, encoding: "utf8",
    input: "import { FIXED_CONFIG } from './scripts/leetcode-playwright-controller.mjs'; console.log(Boolean(FIXED_CONFIG.profilePath));",
  });
  assert.equal(stdinImport.trim(), "true");
  try {
    execFileSync(process.execPath, [path.join(alias, "scripts/leetcode-playwright-controller.mjs"), "receipt", "--invocation-id", "missing"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("symlink invocation must execute the receipt command");
  } catch (error) {
    assert.equal(JSON.parse(error.stderr).error.code, "controller_receipt_missing");
  }
  assert.deepEqual(await readdir(checkout), [".git", "scripts"]);
});

test("missing Git metadata produces a structured CLI failure without guessing or writing a profile", async (t) => {
  const { root, checkout } = await fixture(t);
  await rename(path.join(checkout, ".git"), path.join(root, "saved-git"));
  assert.throws(() => resolveControllerRepository(checkout), { code: "controller_repository_unresolved" });
  try {
    execFileSync(process.execPath, [path.join(checkout, "scripts/leetcode-playwright-controller.mjs"), "ensure"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("missing metadata must fail");
  } catch (error) {
    assert.equal(JSON.parse(error.stderr).error.code, "controller_repository_unresolved");
  }
  assert.deepEqual(await readdir(checkout), ["scripts"]);
});

test("legacy profile and coexistence gates preserve pending and terminal receipts before every CLI action", async (t) => {
  const { checkout, location } = await fixture(t);
  const legacy = location.legacyProfilePaths[0];
  const oldState = controllerStatePathsForProfile(legacy);
  await mkdir(oldState.receiptDirectory, { recursive: true });
  const evidence = '{"version":1,"status":"pending","invocationId":"original"}\n';
  const terminal = '{"version":1,"status":"terminal","invocationId":"finished","envelope":{"ok":true,"result":{"verdict":"Accepted"}}}\n';
  await writeFile(path.join(oldState.receiptDirectory, "original.json"), evidence);
  await writeFile(path.join(oldState.receiptDirectory, "finished.json"), terminal);
  for (const args of [
    ["ensure"], ["navigate", "https://leetcode.com/problems/two-sum/", "--title", "Two Sum"],
    ["editorial", "https://leetcode.com/problems/two-sum/", "--title", "Two Sum"],
    ...["submit", "retry"].map((command) => [command, "https://leetcode.com/problems/two-sum/", "source.java", "--title", "Two Sum", "--invocation-id", "new-attempt"]),
    ["receipt", "--invocation-id", "original"],
  ]) {
    const result = await runCli(args, {
      assertProfileReady: () => assertControllerProfileReady(location),
      statePaths: controllerStatePathsForProfile(location.profilePath),
      withLock: () => assert.fail("must not acquire a lock or write state"),
      acquireController: () => assert.fail("must not connect or launch"),
    });
    assert.equal(result.error.code, "controller_profile_migration_required");
  }
  assert.deepEqual(await readdir(checkout), [".git", "scripts"]);
  await mkdir(location.profilePath, { recursive: true });
  assert.throws(() => assertControllerProfileReady(location), { code: "controller_profile_migration_required" });
  assert.equal(await readFile(path.join(oldState.receiptDirectory, "original.json"), "utf8"), evidence);
  assert.equal(await readFile(path.join(oldState.receiptDirectory, "finished.json"), "utf8"), terminal);
  assert.deepEqual(await readdir(location.profilePath), []);
  // Simulate authorized offline adoption only in this disposable fixture.
  await rm(location.profilePath, { recursive: true });
  await rename(legacy, location.profilePath);
  const newState = controllerStatePathsForProfile(location.profilePath);
  assert.doesNotThrow(() => assertControllerProfileReady(location));
  for (const invocationId of ["original", "finished"]) {
    const result = await runCli(["receipt", "--invocation-id", invocationId], {
      assertProfileReady: () => assertControllerProfileReady(location),
      statePaths: newState,
      withLock: () => assert.fail("receipt recovery remains read-only"),
      acquireController: () => assert.fail("receipt recovery cannot connect"),
    });
    if (invocationId === "original") assert.equal(result.error.code, "controller_receipt_pending");
    else assert.equal(result.result.verdict, "Accepted");
  }
  assert.equal(await readFile(path.join(newState.receiptDirectory, "original.json"), "utf8"), evidence);
  assert.equal(await readFile(path.join(newState.receiptDirectory, "finished.json"), "utf8"), terminal);
});

test("old arbitrary linked-worktree profile is detected without scanning unrelated profiles", async (t) => {
  const { root, checkout } = await fixture(t);
  const linked = path.join(root, "support", "worktrees", "issue");
  git(checkout, "worktree", "add", "--detach", linked, "HEAD");
  const location = resolveControllerRepository(linked);
  const oldProfile = path.join(path.dirname(linked), "browser-profiles/leetcode-submitter");
  await mkdir(oldProfile, { recursive: true });
  assert.throws(() => assertControllerProfileReady(location), (error) =>
    error.code === "controller_profile_migration_required" && error.details.legacyProfilePaths.includes(oldProfile));
});

test("profile and controller directory symlinks cannot redirect state outside the repository", async (t) => {
  const { root, location } = await fixture(t);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  for (const candidate of [path.dirname(location.profilePath), location.profilePath,
    controllerStatePathsForProfile(location.profilePath).stateDirectory,
    controllerStatePathsForProfile(location.profilePath).receiptDirectory]) {
    await mkdir(path.dirname(candidate), { recursive: true });
    await symlink(outside, candidate, "dir");
    assert.throws(() => assertControllerProfileReady(location), { code: "controller_profile_path_invalid" });
    await rm(candidate);
  }
  assert.deepEqual(await readdir(outside), []);
  assert.doesNotThrow(() => assertControllerProfileReady(location));
});

test("real identity validator rejects unverified or foreign fixed-port browsers before page access and cleans up", async () => {
  const runtime = createRuntimeDependencies();
  for (const outcome of ["unavailable", "legacy", "wrong-port", "valid"]) {
    let detached = 0;
    let cleaned = 0;
    const browser = {
      newBrowserCDPSession: async () => ({
        send: async () => {
          if (outcome === "unavailable") throw new Error("command unavailable");
          return { arguments: [
            `--user-data-dir=${outcome === "legacy" ? "/legacy/profile" : FIXED_CONFIG.profilePath}`,
            `--remote-debugging-port=${outcome === "wrong-port" ? 9224 : FIXED_CONFIG.cdpPort}`,
          ] };
        },
        detach: async () => { detached += 1; },
      }),
      contexts: () => {
        assert.equal(outcome, "valid", "unverified browser must not inspect pages");
        return [{ pages: () => [{ url: () => "https://leetcode.com/problemset/" }] }];
      },
    };
    const operation = () => ensureBrowserController({
      probeCdp: async () => ({ live: true, valid: true }),
      loadPlaywright: async () => ({ chromium: {} }),
      connectOverCdp: async () => browser,
      launchChrome: () => assert.fail("live endpoint cannot launch another browser"),
      validateBrowserIdentity: runtime.validateBrowserIdentity,
      cleanupController: async () => { cleaned += 1; },
    });
    if (outcome === "valid") {
      const lease = await operation();
      assert.equal(lease.identityCheck.profileVerification, "verified");
      await lease.cleanup();
    } else {
      await assert.rejects(operation, { code: outcome === "unavailable" ? "browser_identity_unverified" : "browser_identity_mismatch" });
    }
    assert.equal(detached, 1);
    assert.equal(cleaned, 1);
  }
});

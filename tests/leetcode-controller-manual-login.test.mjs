import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ControllerError, FIXED_CONFIG, MANUAL_LOGIN_URL, controllerStatePathsForProfile,
  dedicatedProfileProcesses, manualLoginLaunchArguments, parseCli, runCli, withControllerLock,
} from "../scripts/leetcode-playwright-controller.mjs";

const browser = { pid: 1234, parentPid: 1, role: "main", startedAt: "Wed Sep  9 05:00:00 2026", automated: false };
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "arc-manual-login-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePaths = controllerStatePathsForProfile(path.join(root, "profile"));
  const events = [];
  let owners = [];
  const dependencies = {
    statePaths, assertProfileReady: () => {},
    withLock: async (operation) => { events.push("locked"); return operation(); },
    acquireController: () => { assert.fail("manual phase must not acquire a browser"); },
    manualLogin: {
      inspectProcesses: async () => owners,
      assertPortClosed: async () => {},
      launchManual: async () => { events.push("launch"); owners = [browser]; },
      wait: async () => {},
    },
  };
  return { root, statePaths, events, dependencies, setOwners: (value) => { owners = value; } };
}

test("manual launch uses only the fixed profile and official sign-in page, with no debugging or automation", () => {
  const args = manualLoginLaunchArguments();
  assert.deepEqual(args, ["-na", FIXED_CONFIG.chromeApplication, "--args",
    `--user-data-dir=${FIXED_CONFIG.profilePath}`, "--no-first-run", "--no-default-browser-check", MANUAL_LOGIN_URL]);
  for (const command of ["login", "login-complete"]) {
    assert.equal(parseCli([command]).command, command);
    assert.throws(() => parseCli([command, "--profile", "other"]), { code: "cli_usage" });
  }
});

test("process inspection handles spaced paths and equal/separate flags; ambiguous owners fail privately", () => {
  const config = { chromeApplication: "/Applications/Google Chrome.app", profilePath: "/repo with spaces/browser-profiles/leetcode-submitter" };
  const prefix = `1234 1 Wed Sep  9 05:00:00 2026 ${config.chromeApplication}/Contents/MacOS/Google Chrome`;
  for (const separator of ["=", " "]) {
    assert.deepEqual(dedicatedProfileProcesses(`${prefix} --user-data-dir${separator}${config.profilePath} --no-first-run`, config), [browser]);
    assert.equal(dedicatedProfileProcesses(`${prefix} --user-data-dir${separator}${config.profilePath} --remote-debugging-port=9223`, config)[0].automated, true);
  }
  assert.deepEqual(dedicatedProfileProcesses("77 1 Wed Sep  9 05:00:00 2026 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --profile-directory=Default", config), []);
  const helper = `1235 1234 Wed Sep  9 05:00:01 2026 ${config.chromeApplication}/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --user-data-dir=${config.profilePath} --lang=en-US`;
  const main = `${prefix} --user-data-dir=${config.profilePath} --no-first-run`;
  const processes = dedicatedProfileProcesses(`${main}\n${helper}`, config);
  assert.equal(processes.length, 2);
  assert.equal(processes[1].role, "helper");
  assert.throws(() => dedicatedProfileProcesses(helper, config), { code: "browser_process_unverified" });
  for (const command of [
    `${prefix} --user-data-dir=${config.profilePath}-other --no-first-run`,
    `${prefix} --user-data-dir=${config.profilePath} --user-data-dir=/other --no-first-run`,
    `${prefix} --user-data-dir=${config.profilePath} https://accounts.google.com/private-token`,
    `1234 1 Wed Sep  9 05:00:00 2026 /unverified --user-data-dir=${config.profilePath} --no-first-run`,
    "unparseable",
  ]) {
    assert.throws(() => dedicatedProfileProcesses(command, config), (error) => {
      assert.equal(error.code, "browser_process_unverified");
      assert.ok(!error.message.includes("private-token"));
      return true;
    });
  }
});

test("manual phase blocks every browser command before receipt reservation and preserves exact recovery", async (t) => {
  const { statePaths, dependencies, events, setOwners } = await fixture(t);
  await mkdir(statePaths.receiptDirectory, { recursive: true });
  const pending = '{"version":1,"status":"pending","invocationId":"pending"}\n';
  const terminal = '{"version":1,"status":"terminal","invocationId":"done","envelope":{"ok":true,"result":{"verdict":"Accepted"}}}\n';
  await writeFile(path.join(statePaths.receiptDirectory, "pending.json"), pending);
  await writeFile(path.join(statePaths.receiptDirectory, "done.json"), terminal);
  await writeFile(statePaths.preflightReceiptPath, "old preflight");
  assert.equal((await runCli(["login"], dependencies)).mode, "manual");
  assert.deepEqual(events, ["locked", "launch"]);
  const marker = JSON.parse(await readFile(statePaths.manualLoginPath, "utf8"));
  assert.deepEqual(marker.browser, browser);
  for (const args of [
    ["ensure"],
    ...["navigate", "editorial"].map((command) => [command, "https://leetcode.com/problems/two-sum/", "--title", "Two Sum"]),
    ...["submit", "retry"].map((command) => [command, "https://leetcode.com/problems/two-sum/", "source.java", "--title", "Two Sum", "--invocation-id", "new-id"]),
  ]) assert.equal((await runCli(args, dependencies)).error.code, "manual_login_active");
  assert.deepEqual(await readdir(statePaths.receiptDirectory), ["done.json", "pending.json"]);
  assert.equal((await runCli(["receipt", "--invocation-id", "done"], dependencies)).result.verdict, "Accepted");
  assert.equal((await runCli(["login-complete"], dependencies)).error.code, "dedicated_browser_running");
  setOwners([]);
  const completion = await runCli(["login-complete"], dependencies);
  assert.equal(completion.mode, "automation-allowed");
  assert.equal(completion.authenticated, "unverified");
  await assert.rejects(readFile(statePaths.preflightReceiptPath), { code: "ENOENT" });
  await assert.rejects(readFile(statePaths.manualLoginPath), { code: "ENOENT" });
  assert.equal(await readFile(path.join(statePaths.receiptDirectory, "pending.json"), "utf8"), pending);
  assert.equal(await readFile(path.join(statePaths.receiptDirectory, "done.json"), "utf8"), terminal);
});

test("existing owners, a live debugging port, or inspection failure prevent any launch or marker", async (t) => {
  for (const reason of ["owner", "port", "inspection"]) {
    const { statePaths, dependencies, setOwners, events } = await fixture(t);
    if (reason === "owner") setOwners([browser]);
    if (reason === "port") dependencies.manualLogin.assertPortClosed = () => { throw new ControllerError("debugging_port_in_use", "busy"); };
    if (reason === "inspection") dependencies.manualLogin.inspectProcesses = () => { throw new ControllerError("browser_process_unverified", "unknown"); };
    assert.equal((await runCli(["login"], dependencies)).ok, false);
    assert.deepEqual(events, ["locked"]);
    await assert.rejects(readFile(statePaths.manualLoginPath), { code: "ENOENT" });
  }
});

test("failed launch, debugging flags, PID reuse and late port conflicts retain fail-closed manual reservation", async (t) => {
  for (const reason of ["launch", "automated", "pid-reuse", "port"]) {
    const { statePaths, dependencies, setOwners } = await fixture(t);
    if (reason === "launch") dependencies.manualLogin.launchManual = () => { throw new Error("private command line"); };
    if (reason === "automated") dependencies.manualLogin.launchManual = async () => setOwners([{ ...browser, automated: true }]);
    if (reason === "pid-reuse") {
      let calls = 0;
      dependencies.manualLogin.inspectProcesses = async () => ++calls === 1 ? [] : [{ ...browser, startedAt: String(calls) }];
    }
    if (reason === "port") {
      let calls = 0;
      dependencies.manualLogin.assertPortClosed = () => { if (++calls > 1) throw new ControllerError("debugging_port_in_use", "busy"); };
    }
    assert.equal((await runCli(["login"], dependencies)).ok, false);
    assert.equal(JSON.parse(await readFile(statePaths.manualLoginPath)).phase, "starting");
    assert.equal((await runCli(["ensure"], dependencies)).error.code, "manual_login_active");
  }
});

test("corrupt and linked markers block automation and completion without touching evidence", async (t) => {
  for (const linked of [false, true]) {
    const { root, statePaths, dependencies } = await fixture(t);
    await mkdir(statePaths.stateDirectory, { recursive: true });
    const evidence = "preserve invalid evidence";
    const target = linked ? path.join(root, "original") : statePaths.manualLoginPath;
    await writeFile(target, evidence);
    if (linked) await symlink(target, statePaths.manualLoginPath);
    for (const command of ["ensure", "login-complete"]) {
      assert.equal((await runCli([command], dependencies)).error.code, "manual_login_state_invalid");
    }
    assert.equal(await readFile(target, "utf8"), evidence);
  }
});

test("old lock age cannot steal ownership; concurrent mode changes remain excluded", async (t) => {
  const { statePaths } = await fixture(t);
  await mkdir(statePaths.stateDirectory, { recursive: true });
  const evidence = '{"pid":1234,"acquiredAt":"2000-01-01T00:00:00Z"}\n';
  await writeFile(statePaths.controllerLockPath, evidence);
  await utimes(statePaths.controllerLockPath, new Date(0), new Date(0));
  await assert.rejects(withControllerLock(() => assert.fail("must not steal old lock"), { statePaths, waitTimeoutMs: 0 }), { code: "controller_busy" });
  assert.equal(await readFile(statePaths.controllerLockPath, "utf8"), evidence);
  await rm(statePaths.controllerLockPath);
  await withControllerLock(async () => {
    await assert.rejects(withControllerLock(() => assert.fail("must not enter concurrently"), { statePaths, waitTimeoutMs: 0 }), { code: "controller_busy" });
  }, { statePaths });
  await assert.rejects(readFile(statePaths.controllerLockPath), { code: "ENOENT" });
});

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";

// Integrations own temporary D1/R2 stores and ephemeral HTTP/inspector ports.
// Bound Worker concurrency independently of the number of CPU cores.
const concurrency = Math.min(4, availableParallelism());
const fast = process.argv.includes("--fast");
const explicit = process.argv.slice(2).filter((arg) => arg !== "--fast");
const files = explicit.length ? explicit : (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => name.endsWith(".test.mjs"))
  .filter((name) => !fast || (!name.endsWith(".integration.test.mjs") && name !== "rendered-html.test.mjs"))
  .sort()
  .map((name) => `tests/${name}`);
if (!files.length) throw new Error("No test files selected.");
const child = spawn(process.execPath, [
  "--experimental-strip-types", "--test", `--test-concurrency=${concurrency}`, ...files,
], { stdio: "inherit" });
child.once("error", (error) => { throw error; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });

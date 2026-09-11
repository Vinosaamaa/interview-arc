import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  sanitizeMcpWorkerDiagnostic,
  runMcpCommand,
  stopMcpWorker,
  waitForMcpWorker,
} from "./helpers/mcp-worker-harness.mjs";
import { wranglerCommand } from "../scripts/wrangler-command.mjs";

test("Wrangler launches through Node on Windows and Unix without a command shell", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = ["d1", "execute", "DB", "--command", "SELECT 'space & | $value' AS exact;", "--persist-to", "path with spaces"];
  const invocation = wranglerCommand(args, root);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(1), args);
  const result = await runMcpCommand(join(root, "node_modules", ".bin", "wrangler"), ["--version"], root);
  assert.match(result.stdout, /4\.92\.0/);
});

test("MCP Worker startup failures preserve actionable sanitized diagnostics", async () => {
  await assert.rejects(
    waitForMcpWorker(
      "http://127.0.0.1:1",
      { exitCode: 1 },
      () => "Wrangler failed to bind <local-path>/wrangler.jsonc",
    ),
    (error) => {
      assert.match(error.message, /Local MCP Worker exited 1 before startup\./);
      assert.match(error.message, /Wrangler failed to bind <local-path>\/wrangler\.jsonc/);
      return true;
    },
  );
});

test("MCP Worker shutdown waits for process exit before the integration lock can be released", async () => {
  const child = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  await once(child.stdout, "data");
  await stopMcpWorker(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("MCP Worker diagnostics redact local paths and credential-shaped values", () => {
  const diagnostic = sanitizeMcpWorkerDiagnostic(
    "Config /private/example/wrangler.jsonc\nAuthorization: Bearer owner-private-token\ntoken=secret-value",
    ["/private/example"],
  );

  assert.equal(
    diagnostic,
    "Config <local-path>/wrangler.jsonc\nAuthorization=<redacted>\ntoken=<redacted>",
  );
});

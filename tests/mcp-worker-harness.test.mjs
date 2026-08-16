import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  sanitizeMcpWorkerDiagnostic,
  stopMcpWorker,
  waitForMcpWorker,
} from "./helpers/mcp-worker-harness.mjs";

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
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    assert.equal(signal, "SIGTERM");
    setImmediate(() => {
      child.signalCode = signal;
      child.emit("exit", null, signal);
    });
    return true;
  };

  await stopMcpWorker(child);
  assert.equal(child.signalCode, "SIGTERM");
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

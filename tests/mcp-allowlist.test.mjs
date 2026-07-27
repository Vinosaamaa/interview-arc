import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseEnabledTools,
  parseRegisteredTools,
  validateMcpToolAllowlists,
} from "../scripts/validate-mcp-tool-allowlist.mjs";

const repositoryRoot = new URL("../", import.meta.url);

test("the repository MCP allowlist matches the Worker registration catalog in order", async () => {
  const [workerSource, repositoryConfig] = await Promise.all([
    readFile(new URL("mcp-worker/index.ts", repositoryRoot), "utf8"),
    readFile(new URL(".codex/config.toml", repositoryRoot), "utf8"),
  ]);

  assert.deepEqual(parseEnabledTools(repositoryConfig), parseRegisteredTools(workerSource));
});

test("the optional outer workspace shim stays aligned without making CI depend on it", async () => {
  const result = await validateMcpToolAllowlists({
    repositoryRoot: new URL("../", import.meta.url),
    outerConfigPath: new URL("../../.codex/config.toml", import.meta.url),
  });

  assert.equal(result.repository.matches, true);
  if (result.outer.present) {
    assert.equal(result.outer.matches, true);
  }
});

test("specialist contract requirements are registered and exposed", async () => {
  const result = await validateMcpToolAllowlists({
    repositoryRoot: new URL("../", import.meta.url),
    outerConfigPath: null,
  });

  assert.deepEqual(result.contracts.missingFromWorker, []);
  assert.deepEqual(result.contracts.missingFromAllowlist, []);
  assert.ok(result.contracts.required.includes("save_leetcode_code_attempt"));
  assert.ok(result.contracts.required.includes("save_provisional_solution_profile"));
  assert.ok(result.contracts.required.includes("resolve_voice_capture"));
  assert.ok(result.contracts.required.includes("save_delivery_analysis"));
});

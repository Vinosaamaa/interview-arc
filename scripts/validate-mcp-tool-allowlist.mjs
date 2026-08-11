import { access, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT_FILES = [
  "AGENTS.md",
  "practice/leetcode/AGENTS.md",
  "practice/system-design/AGENTS.md",
  "practice/behavioral/AGENTS.md",
  "docs/contracts/durable-practice-publishing.md",
  "docs/contracts/learning-workspace.md",
  "docs/contracts/practice-interaction-modes.md",
  "docs/contracts/behavioral-evidence-domain.md",
  "docs/contracts/behavioral-target-profiles.md",
  "docs/contracts/resume-revision-ingest.md",
];

export function parseRegisteredTools(source) {
  return [...source.matchAll(/\bserver\.registerTool\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

export function parseEnabledTools(source) {
  const block = source.match(/\benabled_tools\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error("Missing enabled_tools in Codex MCP configuration.");
  return [...block[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function difference(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((name) => !actualSet.has(name));
}

function duplicateValues(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

function replaceEnabledTools(source, tools) {
  const formatted = tools.map((name) => `  "${name}",`).join("\n");
  return source.replace(
    /\benabled_tools\s*=\s*\[[\s\S]*?\]/,
    `enabled_tools = [\n${formatted}\n]`,
  );
}

export async function validateMcpToolAllowlists({
  repositoryRoot = new URL("../", import.meta.url),
  outerConfigPath = new URL("../.codex/config.toml", repositoryRoot),
  syncOuter = false,
} = {}) {
  const [workerSource, repositoryConfig, ...contracts] = await Promise.all([
    readFile(new URL("mcp-worker/index.ts", repositoryRoot), "utf8"),
    readFile(new URL(".codex/config.toml", repositoryRoot), "utf8"),
    ...CONTRACT_FILES.map((path) => readFile(new URL(path, repositoryRoot), "utf8")),
  ]);
  const registered = parseRegisteredTools(workerSource);
  const repositoryEnabled = parseEnabledTools(repositoryConfig);
  const registeredSet = new Set(registered);
  const required = registered.filter((tool) => contracts.some((contract) => contract.includes(`\`${tool}\``)));

  if (syncOuter && outerConfigPath && await exists(outerConfigPath)) {
    const outerSource = await readFile(outerConfigPath, "utf8");
    await writeFile(outerConfigPath, replaceEnabledTools(outerSource, registered), "utf8");
  }

  let outer = { present: false, matches: true, enabled: [] };
  if (outerConfigPath && await exists(outerConfigPath)) {
    const enabled = parseEnabledTools(await readFile(outerConfigPath, "utf8"));
    outer = {
      present: true,
      matches: JSON.stringify(enabled) === JSON.stringify(registered),
      enabled,
      missing: difference(registered, enabled),
      extra: difference(enabled, registered),
    };
  }

  return {
    registered,
    repository: {
      enabled: repositoryEnabled,
      matches: JSON.stringify(repositoryEnabled) === JSON.stringify(registered),
      missing: difference(registered, repositoryEnabled),
      extra: difference(repositoryEnabled, registered),
      duplicates: duplicateValues(repositoryEnabled),
    },
    outer,
    contracts: {
      required,
      missingFromWorker: required.filter((tool) => !registeredSet.has(tool)),
      missingFromAllowlist: difference(required, repositoryEnabled),
    },
  };
}

function formatFailures(result) {
  const failures = [];
  if (!result.repository.matches) {
    failures.push(`repository allowlist drift (missing: ${result.repository.missing.join(", ") || "none"}; extra: ${result.repository.extra.join(", ") || "none"})`);
  }
  if (result.repository.duplicates.length > 0) {
    failures.push(`repository allowlist duplicates: ${result.repository.duplicates.join(", ")}`);
  }
  if (result.outer.present && !result.outer.matches) {
    failures.push(`outer workspace shim drift (missing: ${result.outer.missing.join(", ") || "none"}; extra: ${result.outer.extra.join(", ") || "none"})`);
  }
  if (result.contracts.missingFromWorker.length > 0) {
    failures.push(`contract tools missing from Worker: ${result.contracts.missingFromWorker.join(", ")}`);
  }
  if (result.contracts.missingFromAllowlist.length > 0) {
    failures.push(`contract tools missing from allowlist: ${result.contracts.missingFromAllowlist.join(", ")}`);
  }
  return failures;
}

async function main() {
  const syncOuter = process.argv.includes("--sync-outer");
  const repositoryRoot = new URL("../", import.meta.url);
  const result = await validateMcpToolAllowlists({ repositoryRoot, syncOuter });
  const failures = formatFailures(result);
  if (failures.length > 0) {
    console.error(`Interview Arc MCP configuration validation failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Interview Arc MCP configuration is aligned (${result.registered.length} tools).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href) {
  await main();
}

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLASSIFICATIONS = new Map([
  ["none", "none"],
  ["change note", "change-note"],
  ["adr", "adr"],
  ["architecture review", "architecture-review"],
  ["feature retrospective", "feature-retrospective"],
  ["postmortem", "postmortem"],
  ["capability dossier", "capability-dossier"],
]);

const PLACEHOLDER_REASONS = new Set([
  "todo",
  "n/a",
  "na",
  "none",
  "replace with a concrete reason",
]);
const RECORD_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\d*$/;

function selectedClassifications(body) {
  const selected = [];
  let inEngineeringImpact = false;
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      inEngineeringImpact = heading[1].trim().toLowerCase() === "engineering impact";
      continue;
    }
    if (!inEngineeringImpact) continue;
    const match = line.match(/^\s*-\s*\[[xX]\]\s*(None|Change Note|ADR|Architecture Review|Feature Retrospective|Postmortem|Capability Dossier)(?:\s*[—-]\s*reason:\s*(.*))?\s*$/i);
    if (!match) continue;
    selected.push({ classification: CLASSIFICATIONS.get(match[1].toLowerCase()), reason: match[2]?.trim() ?? "" });
  }
  return selected;
}

export function validateEngineeringImpact({
  body,
  changedFiles,
  recordTypes,
  recordRefs = [],
  deletedRecordCount = 0,
  pullRequestNumber,
  receipt,
}) {
  const selected = selectedClassifications(body ?? "");
  if (selected.length !== 1) throw new Error("Select exactly one Engineering impact classification in the pull request body.");
  const choice = selected[0];
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("A positive pull request number is required for the canonical Pull Request Receipt.");
  }
  const expectedReceiptPath = `docs/engineering/changes/pr-${pullRequestNumber}.md`;
  const changedReceiptPaths = changedFiles.filter((path) => path.startsWith("docs/engineering/changes/") && path.endsWith(".md"));
  if (changedReceiptPaths.length !== 1 || changedReceiptPaths[0] !== expectedReceiptPath || !receipt) {
    throw new Error("Every pull request must change exactly one canonical Pull Request Receipt at its numbered path.");
  }
  if (receipt.path !== expectedReceiptPath || receipt.pr !== pullRequestNumber) {
    throw new Error("The canonical Pull Request Receipt path and `pr` field must match the pull request number.");
  }
  if (receipt.classification !== choice.classification) {
    throw new Error("The canonical Pull Request Receipt classification must match the pull request body.");
  }
  if (!Array.isArray(receipt.richRecordRefs)) {
    throw new Error("The canonical Pull Request Receipt has invalid rich Engineering record references.");
  }
  if (deletedRecordCount > 0) {
    throw new Error("Every changed canonical Engineering record must exist at the pull request head.");
  }
  if (choice.classification === "none") {
    const normalizedReason = choice.reason.trim().replace(/[.!]+$/, "").toLowerCase();
    if (!choice.reason || choice.reason.length < 12 || PLACEHOLDER_REASONS.has(normalizedReason)) {
      throw new Error("Engineering impact `None` requires a concrete reason.");
    }
    if (recordTypes.length > 0) throw new Error("A canonical Engineering record changed, so Engineering impact cannot be `None`.");
    if (receipt.richRecordRefs.length > 0) {
      throw new Error("Engineering impact `None` must not link rich Engineering records.");
    }
    return { classification: "none", changedFiles };
  }
  if (recordTypes.length === 0) {
    throw new Error(`Engineering impact \`${choice.classification}\` requires a matching canonical record in this pull request.`);
  }
  const uniqueTypes = [...new Set(recordTypes)];
  if (uniqueTypes.length !== 1 || uniqueTypes[0] !== choice.classification) {
    throw new Error("The pull request Engineering impact classification does not match its changed canonical records.");
  }
  const expectedRefs = [...new Set(recordRefs)].sort();
  const receiptRefs = [...new Set(receipt.richRecordRefs)].sort();
  if (expectedRefs.length !== recordRefs.length || receiptRefs.length !== receipt.richRecordRefs.length ||
      expectedRefs.length === 0 || expectedRefs.length !== receiptRefs.length ||
      expectedRefs.some((ref, index) => ref !== receiptRefs[index])) {
    throw new Error("A material Pull Request Receipt must link every exact rich Engineering record reference changed by this pull request.");
  }
  return { classification: choice.classification, changedFiles };
}

function changedFilesBetween(base, head) {
  const result = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", base, head], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("Unable to inspect the pull request file set.");
  return result.stdout.split("\0").filter(Boolean);
}

function hasCommit(revision) {
  return spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).status === 0;
}

function ensureCommit(revision) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Pull request revisions must be full commit identifiers.");
  if (hasCommit(revision)) return;
  const fetch = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", revision], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (fetch.status !== 0 || !hasCommit(revision)) {
    throw new Error("Unable to load a required pull request revision from the trusted Git remote.");
  }
}

function leadingFrontmatter(markdown, documentKind) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") throw new Error(`The canonical ${documentKind} must begin with frontmatter.`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`The canonical ${documentKind} frontmatter is not closed.`);
  const fields = new Map();
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):(?:[ \t]*(.*))?$/);
    if (!match || fields.has(match[1])) throw new Error(`The canonical ${documentKind} frontmatter is invalid.`);
    fields.set(match[1], match[2] ?? "");
  }
  return fields;
}

function parseReceipt(markdown, path) {
  const fields = leadingFrontmatter(markdown, "Pull Request Receipt");
  const prValue = fields.get("pr") ?? "";
  if (!/^[1-9]\d*$/.test(prValue)) throw new Error("The canonical Pull Request Receipt has an invalid `pr` field.");
  const classification = fields.get("classification") ?? "";
  if (![...CLASSIFICATIONS.values()].includes(classification)) {
    throw new Error("The canonical Pull Request Receipt has an invalid classification.");
  }
  let richRecordRefs;
  try {
    richRecordRefs = JSON.parse(fields.get("richRecordRefs") ?? "");
  } catch {
    throw new Error("The canonical Pull Request Receipt has invalid rich Engineering record references.");
  }
  if (!Array.isArray(richRecordRefs) || new Set(richRecordRefs).size !== richRecordRefs.length ||
      richRecordRefs.some((ref) => typeof ref !== "string" || !RECORD_REF_PATTERN.test(ref))) {
    throw new Error("The canonical Pull Request Receipt has invalid rich Engineering record references.");
  }
  return { path, pr: Number(prValue), classification, richRecordRefs };
}

function parseRecord(markdown) {
  const fields = leadingFrontmatter(markdown, "Engineering record");
  const id = fields.get("id") ?? "";
  const revisionValue = fields.get("revision") ?? "";
  const type = fields.get("type") ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !/^[1-9]\d*$/.test(revisionValue) ||
      ![...CLASSIFICATIONS.values()].filter((classification) => classification !== "none").includes(type)) {
    throw new Error("A changed canonical Engineering record has invalid identity frontmatter.");
  }
  return { type, ref: `${id}@${revisionValue}` };
}

function blobsAt(revision, paths) {
  if (paths.length === 0) return [];
  const requests = paths.map((path) => `${revision}:${path}`);
  const result = spawnSync("git", ["cat-file", "--batch"], {
    input: `${requests.join("\n")}\n`,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Unable to inspect canonical Engineering documents.");
  const output = result.stdout;
  const documents = [];
  let offset = 0;
  for (const request of requests) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error("Git returned an invalid canonical Engineering document response.");
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    if (header === `${request} missing`) {
      documents.push(null);
      continue;
    }
    const match = header.match(/^[0-9a-f]{40} blob (0|[1-9]\d*)$/);
    if (!match) {
      throw new Error("Git returned an invalid canonical Engineering document response.");
    }
    const size = Number(match[1]);
    const end = offset + size;
    if (!Number.isSafeInteger(size) || end >= output.length || output[end] !== 0x0a) {
      throw new Error("Git returned an invalid canonical Engineering document response.");
    }
    documents.push(output.subarray(offset, end).toString("utf8"));
    offset = end + 1;
  }
  if (offset !== output.length) throw new Error("Git returned an invalid canonical Engineering document response.");
  return documents;
}

function recordsAt(paths, head, base) {
  const headDocuments = blobsAt(head, paths);
  const missingPaths = paths.filter((_, index) => headDocuments[index] === null);
  const baseDocuments = blobsAt(base, missingPaths);
  let missingIndex = 0;
  return paths.map((path, index) => {
    const headMarkdown = headDocuments[index];
    if (headMarkdown !== null) return { ...parseRecord(headMarkdown), existsAtHead: true };
    const baseMarkdown = baseDocuments[missingIndex++];
    if (baseMarkdown !== null) return { ...parseRecord(baseMarkdown), existsAtHead: false };
    throw new Error("Unable to inspect a changed canonical Engineering record.");
  });
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required.");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pullRequest = event.pull_request;
  if (!pullRequest?.base?.sha || !pullRequest?.head?.sha || !Number.isInteger(pullRequest.number) || pullRequest.number < 1) {
    throw new Error("Pull request base, head, and number are required.");
  }
  ensureCommit(pullRequest.base.sha);
  ensureCommit(pullRequest.head.sha);
  const changedFiles = changedFilesBetween(pullRequest.base.sha, pullRequest.head.sha);
  const changedRecordMarkdown = changedFiles.filter((path) => path.startsWith("docs/engineering/records/") && path.endsWith(".md"));
  if (changedRecordMarkdown.some((path) => !/^docs\/engineering\/records\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path))) {
    throw new Error("Changed canonical Engineering records must use a lowercase repository-root filename.");
  }
  const recordPaths = changedRecordMarkdown;
  const records = recordsAt(recordPaths, pullRequest.head.sha, pullRequest.base.sha);
  const expectedReceiptPath = `docs/engineering/changes/pr-${pullRequest.number}.md`;
  const receiptPaths = changedFiles.filter((path) => path.startsWith("docs/engineering/changes/") && path.endsWith(".md"));
  const receipt = receiptPaths.length === 1 && receiptPaths[0] === expectedReceiptPath
    ? (() => {
        const [markdown] = blobsAt(pullRequest.head.sha, [expectedReceiptPath]);
        return markdown === null ? null : parseReceipt(markdown, expectedReceiptPath);
      })()
    : null;
  const result = validateEngineeringImpact({
    body: pullRequest.body ?? "",
    changedFiles,
    recordTypes: records.map((record) => record.type),
    recordRefs: records.map((record) => record.ref),
    deletedRecordCount: records.filter((record) => !record.existsAtHead).length,
    pullRequestNumber: pullRequest.number,
    receipt,
  });
  process.stdout.write(`Engineering impact: ${result.classification}; ${result.changedFiles.length} changed file(s).\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();

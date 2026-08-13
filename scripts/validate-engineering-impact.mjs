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
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const TRUSTED_GITHUB_REMOTE_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
const HISTORICAL_BATCH_SCHEMA = JSON.parse(readFileSync(new URL(
  "../docs/contracts/engineering-historical-backfill-batch.schema.json",
  import.meta.url,
), "utf8"));
const HISTORICAL_BATCH_RECEIPT_LIMIT = HISTORICAL_BATCH_SCHEMA.properties.receiptPaths.maxItems;
const HISTORICAL_BATCH_RECORD_LIMIT = HISTORICAL_BATCH_SCHEMA.properties.recordRefs.maxItems;
const HISTORICAL_BATCH_AUTHORIZATION_PATTERN = new RegExp(
  HISTORICAL_BATCH_SCHEMA.properties.privacyAuthorizationUrl.pattern,
);
const HISTORICAL_BATCH_RECEIPT_PATH_PATTERN = new RegExp(
  HISTORICAL_BATCH_SCHEMA.properties.receiptPaths.items.pattern,
);
const HISTORICAL_BATCH_RECORD_REF_PATTERN = new RegExp(
  HISTORICAL_BATCH_SCHEMA.properties.recordRefs.items.pattern,
);

function selectedClassifications(body) {
  const selected = [];
  let inEngineeringImpact = false;
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      if (fence === null) fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      else if (fence.marker === fenceMatch[1][0] && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
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
  linkedRecordTypes,
  linkedRecordRefs,
  deletedRecordCount = 0,
  pullRequestNumber,
  pullRequestTitle,
  repository,
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
  if (!REPOSITORY_PATTERN.test(repository ?? "") || receipt.repository !== repository) {
    throw new Error("The canonical Pull Request Receipt repository must match the pull request repository.");
  }
  if (typeof pullRequestTitle !== "string" || !pullRequestTitle || receipt.title !== pullRequestTitle) {
    throw new Error("The canonical Pull Request Receipt title must match the pull request title.");
  }
  if (receipt.reconstructed !== false) {
    throw new Error("A forward-authored Pull Request Receipt must declare `reconstructed: false`.");
  }
  if (receipt.classification !== choice.classification) {
    throw new Error("The canonical Pull Request Receipt classification must match the pull request body.");
  }
  if (!Array.isArray(receipt.richRecordRefs)) {
    throw new Error("The canonical Pull Request Receipt has invalid rich Engineering record references.");
  }
  if (deletedRecordCount > 0) {
    throw new Error("Every referenced or changed canonical Engineering record must exist at the pull request head.");
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
  const resolvedRecordTypes = linkedRecordTypes ?? recordTypes;
  const resolvedRecordRefs = linkedRecordRefs ?? recordRefs;
  if (resolvedRecordTypes.length === 0) {
    throw new Error(`Engineering impact \`${choice.classification}\` requires a matching canonical record in this pull request.`);
  }
  if (resolvedRecordTypes.some((type) => type !== choice.classification) ||
      recordTypes.some((type) => type !== choice.classification)) {
    throw new Error("The pull request Engineering impact classification does not match its linked or changed canonical records.");
  }
  const resolvedRefs = [...new Set(resolvedRecordRefs)].sort();
  const receiptRefs = [...new Set(receipt.richRecordRefs)].sort();
  if (resolvedRefs.length !== resolvedRecordRefs.length || receiptRefs.length !== receipt.richRecordRefs.length ||
      resolvedRefs.length === 0 || resolvedRefs.length !== receiptRefs.length ||
      resolvedRefs.some((ref, index) => ref !== receiptRefs[index])) {
    throw new Error("A material Pull Request Receipt must link exact rich Engineering record revisions at the pull request head.");
  }
  const changedRefs = new Set(recordRefs);
  if (changedRefs.size !== recordRefs.length || [...changedRefs].some((ref) => !receiptRefs.includes(ref))) {
    throw new Error("A material Pull Request Receipt must link every exact rich Engineering record revision changed by the pull request.");
  }
  return { classification: choice.classification, changedFiles };
}

function equalStringSets(left, right) {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === left.length && normalizedRight.length === right.length &&
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function validateHistoricalBatch({
  manifest,
  manifestPath,
  changedFiles,
  changedRecords,
  historicalReceipts,
  linkedRecords,
  baseExistingPaths = [],
  pullRequestNumber,
  repository,
  repositoryFullName,
}) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.repository !== repository ||
      manifest.pullRequest !== pullRequestNumber) {
    throw new Error("A historical batch manifest must match the current repository and pull request.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryFullName ?? "") ||
      !HISTORICAL_BATCH_AUTHORIZATION_PATTERN.test(manifest.privacyAuthorizationUrl ?? "") ||
      !manifest.privacyAuthorizationUrl.startsWith(`https://github.com/${repositoryFullName}/`)) {
    throw new Error("A historical batch requires an explicit privacy authorization comment URL in the owning GitHub repository.");
  }
  if (!Array.isArray(manifest.receiptPaths) || manifest.receiptPaths.length < 1 ||
      manifest.receiptPaths.length > HISTORICAL_BATCH_RECEIPT_LIMIT ||
      manifest.receiptPaths.some((path) => !HISTORICAL_BATCH_RECEIPT_PATH_PATTERN.test(path))) {
    throw new Error(`A historical batch must declare between 1 and ${HISTORICAL_BATCH_RECEIPT_LIMIT} canonical receipt paths.`);
  }
  if (!Array.isArray(manifest.recordRefs) || manifest.recordRefs.length > HISTORICAL_BATCH_RECORD_LIMIT ||
      manifest.recordRefs.some((ref) => typeof ref !== "string" || !HISTORICAL_BATCH_RECORD_REF_PATTERN.test(ref))) {
    throw new Error(`A historical batch may declare at most ${HISTORICAL_BATCH_RECORD_LIMIT} exact rich record revisions.`);
  }
  const expectedManifestPath = `docs/engineering/backfill/pr-${pullRequestNumber}.json`;
  if (manifestPath !== expectedManifestPath) {
    throw new Error("The historical batch manifest path must match the current pull request number.");
  }
  const forwardReceiptPath = `docs/engineering/changes/pr-${pullRequestNumber}.md`;
  if (manifest.receiptPaths.includes(forwardReceiptPath)) {
    throw new Error("A historical batch manifest must not claim the current pull request's forward receipt.");
  }
  if (!equalStringSets(manifest.receiptPaths, historicalReceipts.map((receipt) => receipt.path)) ||
      !equalStringSets(manifest.recordRefs, changedRecords.map((record) => record.ref))) {
    throw new Error("The historical batch manifest must enumerate the changed reconstructed receipts and rich records exactly.");
  }
  const allowedChangedFiles = [forwardReceiptPath, expectedManifestPath, ...manifest.receiptPaths,
    ...manifest.recordRefs.map((ref) => `docs/engineering/records/${ref.slice(0, ref.lastIndexOf("@"))}.md`)];
  if (!equalStringSets(allowedChangedFiles, changedFiles)) {
    throw new Error("A historical publication pull request may contain only its forward receipt, batch manifest, and declared historical documents.");
  }
  if (baseExistingPaths.length > 0) {
    throw new Error("Historical batch documents are add-only; accepted receipts and records cannot be modified or deleted.");
  }
  const linkedByRef = new Map(linkedRecords.map((record) => [record.ref, record]));
  for (const receipt of historicalReceipts) {
    const pathMatch = receipt.path.match(/^docs\/engineering\/changes\/pr-([1-9]\d*)\.md$/);
    if (!pathMatch || receipt.pr !== Number(pathMatch[1]) || receipt.pr === pullRequestNumber ||
        receipt.repository !== repository || receipt.reconstructed !== true) {
      throw new Error("Every historical receipt must be reconstructed, repository-owned, and match its numbered path.");
    }
    if (receipt.classification === "none") {
      if (receipt.richRecordRefs.length > 0) {
        throw new Error("A historical `none` receipt must not link rich Engineering records.");
      }
      continue;
    }
    if (receipt.richRecordRefs.length === 0 || receipt.richRecordRefs.some((ref) => {
      const record = linkedByRef.get(ref);
      return !record || !record.existsAtHead || record.type !== receipt.classification;
    })) {
      throw new Error("Every material historical receipt must link exact matching rich record revisions at the pull request head.");
    }
  }
  const referenced = new Set(historicalReceipts.flatMap((receipt) => receipt.richRecordRefs));
  if (changedRecords.some((record) => !record.existsAtHead || !referenced.has(record.ref))) {
    throw new Error("Every rich record added by a historical batch must exist at head and be linked by a reconstructed receipt.");
  }
  return {
    historicalReceiptCount: historicalReceipts.length,
    historicalRecordCount: changedRecords.length,
  };
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

export function trustedHeadRemote(value) {
  if (value === undefined || value === null || value === "origin") return "origin";
  if (typeof value !== "string" || !TRUSTED_GITHUB_REMOTE_PATTERN.test(value)) {
    throw new Error("The pull request head repository must be a trusted GitHub HTTPS remote.");
  }
  return value;
}

function ensureCommit(revision, remote = "origin") {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Pull request revisions must be full commit identifiers.");
  if (hasCommit(revision)) return;
  const fetch = spawnSync("git", ["fetch", "--no-tags", "--depth=1", remote, revision], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (fetch.status !== 0 || !hasCommit(revision)) {
    throw new Error("Unable to load a required pull request revision from the trusted Git remote.");
  }
}

function frontmatterString(fields, key) {
  const raw = fields.get(key);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const decoded = JSON.parse(value);
      return typeof decoded === "string" ? decoded : null;
    } catch {
      return null;
    }
  }
  if (/^['|>&*!]/.test(value)) return null;
  return value;
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
  if (fields.get("schemaVersion") !== "1") {
    throw new Error("The canonical Pull Request Receipt has an unsupported schema version.");
  }
  const repository = frontmatterString(fields, "repository");
  if (!repository || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error("The canonical Pull Request Receipt has an invalid repository.");
  }
  const prValue = fields.get("pr") ?? "";
  if (!/^[1-9]\d*$/.test(prValue)) throw new Error("The canonical Pull Request Receipt has an invalid `pr` field.");
  const title = frontmatterString(fields, "title");
  if (!title || title.length > 160) throw new Error("The canonical Pull Request Receipt has an invalid title.");
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
  if (!Array.isArray(richRecordRefs) || richRecordRefs.length > 16 ||
      new Set(richRecordRefs).size !== richRecordRefs.length ||
      richRecordRefs.some((ref) => typeof ref !== "string" || ref.length > 180 || !RECORD_REF_PATTERN.test(ref))) {
    throw new Error("The canonical Pull Request Receipt has invalid rich Engineering record references.");
  }
  const reconstructedValue = fields.get("reconstructed");
  if (reconstructedValue !== "true" && reconstructedValue !== "false") {
    throw new Error("The canonical Pull Request Receipt has an invalid `reconstructed` field.");
  }
  return {
    path,
    repository,
    pr: Number(prValue),
    title,
    classification,
    richRecordRefs,
    reconstructed: reconstructedValue === "true",
  };
}

function parseHistoricalBatchManifest(markdown) {
  let manifest;
  try {
    manifest = JSON.parse(markdown);
  } catch {
    throw new Error("The historical batch manifest must be valid JSON.");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The historical batch manifest must be a JSON object.");
  }
  const expectedKeys = HISTORICAL_BATCH_SCHEMA.required;
  if (!equalStringSets(Object.keys(manifest), expectedKeys)) {
    throw new Error("The historical batch manifest has unsupported or missing fields.");
  }
  const properties = HISTORICAL_BATCH_SCHEMA.properties;
  if (manifest.schemaVersion !== properties.schemaVersion.const || typeof manifest.repository !== "string" ||
      !(new RegExp(properties.repository.pattern)).test(manifest.repository) || !Number.isInteger(manifest.pullRequest) ||
      manifest.pullRequest < properties.pullRequest.minimum || typeof manifest.privacyAuthorizationUrl !== "string" ||
      manifest.privacyAuthorizationUrl.length > properties.privacyAuthorizationUrl.maxLength ||
      !HISTORICAL_BATCH_AUTHORIZATION_PATTERN.test(manifest.privacyAuthorizationUrl) ||
      !Array.isArray(manifest.receiptPaths) || manifest.receiptPaths.length < properties.receiptPaths.minItems ||
      manifest.receiptPaths.length > HISTORICAL_BATCH_RECEIPT_LIMIT ||
      new Set(manifest.receiptPaths).size !== manifest.receiptPaths.length ||
      manifest.receiptPaths.some((receiptPath) => typeof receiptPath !== "string" ||
        receiptPath.length > properties.receiptPaths.items.maxLength ||
        !HISTORICAL_BATCH_RECEIPT_PATH_PATTERN.test(receiptPath)) ||
      !Array.isArray(manifest.recordRefs) || manifest.recordRefs.length > HISTORICAL_BATCH_RECORD_LIMIT ||
      new Set(manifest.recordRefs).size !== manifest.recordRefs.length ||
      manifest.recordRefs.some((ref) => typeof ref !== "string" ||
        ref.length > properties.recordRefs.items.maxLength || !HISTORICAL_BATCH_RECORD_REF_PATTERN.test(ref))) {
    throw new Error("The historical batch manifest has invalid bounded fields.");
  }
  return manifest;
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
  const repository = event.repository?.name ?? pullRequest?.base?.repo?.name;
  const repositoryFullName = event.repository?.full_name ?? pullRequest?.base?.repo?.full_name;
  if (!pullRequest?.base?.sha || !pullRequest?.head?.sha || !Number.isInteger(pullRequest.number) ||
      pullRequest.number < 1 || typeof pullRequest.title !== "string" || !pullRequest.title ||
      typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Pull request base, head, number, title, and repository are required.");
  }
  ensureCommit(pullRequest.base.sha, "origin");
  ensureCommit(pullRequest.head.sha, trustedHeadRemote(pullRequest.head.repo?.clone_url));
  const changedFiles = changedFilesBetween(pullRequest.base.sha, pullRequest.head.sha);
  const changedRecordMarkdown = changedFiles.filter((path) => path.startsWith("docs/engineering/records/") && path.endsWith(".md"));
  if (changedRecordMarkdown.some((path) => !/^docs\/engineering\/records\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path))) {
    throw new Error("Changed canonical Engineering records must use a lowercase repository-root filename.");
  }
  const expectedReceiptPath = `docs/engineering/changes/pr-${pullRequest.number}.md`;
  const receiptPaths = changedFiles.filter((path) => path.startsWith("docs/engineering/changes/") && path.endsWith(".md"));
  const manifestPaths = changedFiles.filter((path) => path.startsWith("docs/engineering/backfill/") && path.endsWith(".json"));
  const expectedManifestPath = `docs/engineering/backfill/pr-${pullRequest.number}.json`;
  const historicalMode = receiptPaths.length > 1 || manifestPaths.length > 0;
  const [receiptMarkdown] = blobsAt(pullRequest.head.sha, [expectedReceiptPath]);
  const receipt = receiptMarkdown === null ? null : parseReceipt(receiptMarkdown, expectedReceiptPath);
  let manifest = null;
  let historicalReceipts = [];
  if (historicalMode) {
    if (manifestPaths.length !== 1 || manifestPaths[0] !== expectedManifestPath) {
      throw new Error("A historical publication pull request must change its one numbered batch manifest.");
    }
    const [manifestMarkdown] = blobsAt(pullRequest.head.sha, [expectedManifestPath]);
    if (manifestMarkdown === null) throw new Error("The historical batch manifest must exist at the pull request head.");
    manifest = parseHistoricalBatchManifest(manifestMarkdown);
    const historicalReceiptMarkdown = blobsAt(pullRequest.head.sha, manifest.receiptPaths);
    historicalReceipts = historicalReceiptMarkdown.map((markdown, index) => {
      if (markdown === null) throw new Error("Every declared historical receipt must exist at the pull request head.");
      return parseReceipt(markdown, manifest.receiptPaths[index]);
    });
  }
  const allReceiptRefs = [...(receipt?.richRecordRefs ?? []), ...historicalReceipts.flatMap((entry) => entry.richRecordRefs)];
  const linkedRecordPaths = allReceiptRefs.map((ref) =>
    `docs/engineering/records/${ref.slice(0, ref.lastIndexOf("@"))}.md`);
  const recordPaths = [...new Set([...changedRecordMarkdown, ...linkedRecordPaths])];
  const records = recordsAt(recordPaths, pullRequest.head.sha, pullRequest.base.sha);
  const recordsByPath = new Map(recordPaths.map((path, index) => [path, records[index]]));
  const changedRecords = changedRecordMarkdown.map((path) => recordsByPath.get(path));
  const linkedRecords = allReceiptRefs.map((ref, index) => {
    const record = recordsByPath.get(linkedRecordPaths[index]);
    if (!record || record.ref !== ref) {
      throw new Error("A material Pull Request Receipt must link exact rich Engineering record revisions at the pull request head.");
    }
    return record;
  }) ?? [];
  const historicalPaths = historicalMode
    ? [expectedManifestPath, ...manifest.receiptPaths, ...changedRecordMarkdown]
    : [];
  const forwardChangedFiles = changedFiles.filter((path) => !historicalPaths.includes(path));
  const result = validateEngineeringImpact({
    body: pullRequest.body ?? "",
    changedFiles: forwardChangedFiles,
    recordTypes: historicalMode ? [] : changedRecords.map((record) => record.type),
    recordRefs: historicalMode ? [] : changedRecords.map((record) => record.ref),
    linkedRecordTypes: historicalMode ? [] : linkedRecords.map((record) => record.type),
    linkedRecordRefs: historicalMode ? [] : linkedRecords.map((record) => record.ref),
    deletedRecordCount: historicalMode ? 0 : records.filter((record) => !record.existsAtHead).length,
    pullRequestNumber: pullRequest.number,
    pullRequestTitle: pullRequest.title,
    repository,
    receipt,
  });
  if (historicalMode) {
    const historicalDocumentPaths = [...manifest.receiptPaths, ...changedRecordMarkdown];
    const baseDocuments = blobsAt(pullRequest.base.sha, historicalDocumentPaths);
    const baseExistingPaths = historicalDocumentPaths.filter((_, index) => baseDocuments[index] !== null);
    const historicalResult = validateHistoricalBatch({
      manifest,
      manifestPath: expectedManifestPath,
      changedFiles,
      changedRecords,
      historicalReceipts,
      linkedRecords,
      baseExistingPaths,
      pullRequestNumber: pullRequest.number,
      repository,
      repositoryFullName,
    });
    process.stdout.write(`Engineering impact: ${result.classification}; historical batch: ${historicalResult.historicalReceiptCount} receipt(s), ${historicalResult.historicalRecordCount} rich record(s).\n`);
    return;
  }
  process.stdout.write(`Engineering impact: ${result.classification}; ${result.changedFiles.length} changed file(s).\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();

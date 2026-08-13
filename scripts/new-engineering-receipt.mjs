#!/usr/bin/env node

import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = "interview-arc";
const OWNER = "Vinosaamaa";
const REQUIRED_FLAGS = ["--pr", "--title", "--summary", "--classification"];
const CLASSIFICATIONS = new Set([
  "none",
  "change-note",
  "adr",
  "architecture-review",
  "feature-retrospective",
  "postmortem",
  "capability-dossier",
]);
const RECORD_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\d*$/u;
const PUBLIC_UNSAFE_PATTERNS = [
  /(?:^|[\s("'`])\/(?:Users|home|root)\/[^\s)"'`]+/m,
  /(?:^|[\s("'`])\/(?:private\/tmp|tmp|var|opt|srv|workspace|mnt|Volumes)\/[^\s)"'`]+/m,
  /(?:^|[\s("'`])~\/[^\s)"'`]+/m,
  /\b[A-Za-z]:\\[^\s"'`]+/,
  /\\\\[^\s\\]+\\[^\s"'`]+/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:password|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s]{8,}/i,
  /\b(?:thread|task)_[A-Za-z0-9_-]{8,}\b/,
  /\bgit@[A-Za-z0-9.-]+:[^\s]+/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/,
  /\b[A-Z0-9._%+-]+@(?!example\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];
const HELP = `Create the canonical compact Engineering receipt for a pull request.

Authoring order:
  1. Decide the Engineering impact before opening the pull request.
  2. For material work, author or select the exact rich record first.
  3. Open a draft pull request to obtain its repository-local number.
  4. Run this command and commit the generated pr-<number>.md file.
  5. Select the matching Engineering-impact checkbox in the pull-request body.

Non-material example:
  pnpm engineering:receipt:new -- \\
    --pr <number> \\
    --title "Correct Engineering navigation labels" \\
    --summary "Renamed one local label without changing a Module or Interface." \\
    --classification none

Material example:
  pnpm engineering:receipt:new -- \\
    --pr <number> \\
    --title "Adopt the Engineering Journal boundary" \\
    --summary "Adopted the reviewed Journal contract and deterministic projection." \\
    --classification architecture-review \\
    --rich-record-ref <id>@<revision>

This scaffold creates canonical Markdown only. CI validates it, and the build derives
JSON, search, backlinks, Statistics, and standalone HTML. It does not author prose or diagrams.
`;

function fail(message) {
  const error = new Error(message);
  error.name = "EngineeringReceiptScaffoldError";
  throw error;
}

function parseArguments(argv) {
  const values = new Map();
  const richRecordRefs = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (![...REQUIRED_FLAGS, "--rich-record-ref"].includes(flag) || value === undefined || value.startsWith("--")) {
      fail("Use explicit --pr, --title, --summary, and --classification values.");
    }
    if (flag === "--rich-record-ref") {
      richRecordRefs.push(value);
      continue;
    }
    if (values.has(flag)) fail(`Provide ${flag} exactly once.`);
    values.set(flag, value);
  }
  if (REQUIRED_FLAGS.some((flag) => !values.has(flag))) {
    fail("Use explicit --pr, --title, --summary, and --classification values.");
  }
  return { ...Object.fromEntries(values), richRecordRefs };
}

function validateSingleLine(value, label, maximumLength) {
  if (!value || value !== value.trim() || /[\p{Cc}\p{Cs}\u2028\u2029]/u.test(value)) {
    fail(`${label} must be one non-empty line without surrounding whitespace.`);
  }
  if ([...value].length > maximumLength) fail(`${label} exceeds ${maximumLength} characters.`);
  return value;
}

function assertPublicSafe(...values) {
  if (values.some((value) => PUBLIC_UNSAFE_PATTERNS.some((pattern) => pattern.test(value)))) {
    fail("Receipt text is not public-safe.");
  }
}

async function assertRepositoryRoot(root) {
  let packageDocument;
  try {
    packageDocument = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    fail("Run this command from the Interview Arc repository root.");
  }
  if (packageDocument?.name !== REPOSITORY) fail("Run this command from the Interview Arc repository root.");

  const segments = ["docs", "engineering", "changes"];
  let receiptDirectory = root;
  for (const [index, segment] of segments.entries()) {
    receiptDirectory = path.join(receiptDirectory, segment);
    let metadata;
    try {
      metadata = await lstat(receiptDirectory);
    } catch (error) {
      const isMissingReceiptDirectory = error?.code === "ENOENT" && index === segments.length - 1;
      if (!isMissingReceiptDirectory) fail("The canonical Engineering receipt directory is missing.");
      try {
        await mkdir(receiptDirectory, { mode: 0o755 });
        metadata = await lstat(receiptDirectory);
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") fail("Unable to create the canonical Engineering receipt directory.");
        try {
          metadata = await lstat(receiptDirectory);
        } catch {
          fail("Unable to create the canonical Engineering receipt directory.");
        }
      }
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail("The canonical Engineering receipt directory is unsafe.");
    }
  }
  try {
    const [canonicalRoot, canonicalDirectory] = await Promise.all([realpath(root), realpath(receiptDirectory)]);
    if (path.relative(canonicalRoot, canonicalDirectory) !== path.join(...segments)) {
      fail("The canonical Engineering receipt directory is unsafe.");
    }
  } catch (error) {
    if (error?.name === "EngineeringReceiptScaffoldError") throw error;
    fail("The canonical Engineering receipt directory is unsafe.");
  }
  return receiptDirectory;
}

function receiptMarkdown({ pr, title, summary, classification, richRecordRefs }) {
  const pullRequestRef = `pull-request:${pr}`;
  const pullRequestUrl = `https://github.com/${OWNER}/${REPOSITORY}/pull/${pr}`;
  return `---
schemaVersion: 1
repository: ${REPOSITORY}
pr: ${pr}
title: ${JSON.stringify(title)}
classification: ${classification}
richRecordRefs: ${JSON.stringify(richRecordRefs)}
reconstructed: false
confidence: verified
unknowns: []
headCommit: null
mergeCommit: null
mergedAt: null
sources: ${JSON.stringify([{ label: `Pull request #${pr}`, url: pullRequestUrl, kind: "pull-request" }])}
verification: ${JSON.stringify({ state: "verified", evidenceRefs: [pullRequestRef] })}
visibility: public-safe
publicationEligibility: eligible
---
# ${title}

${summary}
`;
}

async function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(HELP);
    return;
  }
  const arguments_ = parseArguments(argv);
  if (!/^[1-9]\d*$/u.test(arguments_["--pr"]) || !Number.isSafeInteger(Number(arguments_["--pr"]))) {
    fail("PR number must be a positive safe integer.");
  }
  const pr = Number(arguments_["--pr"]);
  const title = validateSingleLine(arguments_["--title"], "Title", 160);
  const summary = validateSingleLine(arguments_["--summary"], "Summary", 280);
  if (/^#{1,6}\s/u.test(summary)) fail("Summary must be a factual paragraph, not a Markdown heading.");
  assertPublicSafe(title, summary);
  const classification = arguments_["--classification"];
  if (!CLASSIFICATIONS.has(classification)) fail("Classification is not part of the Engineering receipt contract.");
  if (arguments_.richRecordRefs.length > 16) {
    fail("A receipt cannot link more than 16 rich Engineering records.");
  }
  if (arguments_.richRecordRefs.some((reference) => reference.length > 180 || !RECORD_REF_PATTERN.test(reference))) {
    fail("Every rich-record reference must use the exact id@revision format.");
  }
  if (new Set(arguments_.richRecordRefs).size !== arguments_.richRecordRefs.length) {
    fail("Rich-record references must be unique.");
  }
  const richRecordRefs = [...arguments_.richRecordRefs].sort();
  if (classification === "none" && richRecordRefs.length > 0) {
    fail("Classification none cannot link a rich Engineering record.");
  }
  if (classification !== "none" && richRecordRefs.length === 0) {
    fail("A material classification requires at least one exact rich-record reference.");
  }

  const receiptDirectory = await assertRepositoryRoot(root);
  const relativePath = `docs/engineering/changes/pr-${pr}.md`;
  try {
    await writeFile(
      path.join(receiptDirectory, `pr-${pr}.md`),
      receiptMarkdown({ pr, title, summary, classification, richRecordRefs }),
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      },
    );
  } catch (error) {
    if (error?.code === "EEXIST") fail(`Refusing to overwrite ${relativePath}.`);
    fail("Unable to create the canonical Engineering receipt.");
  }
  process.stdout.write(`Created ${relativePath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error?.message ?? "Unable to create the Engineering receipt."}\n`);
  process.exitCode = 1;
});

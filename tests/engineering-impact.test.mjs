import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  trustedHeadRemote,
  validateEngineeringImpact,
  validateHistoricalBatch,
  verifyHistoricalAuthorization,
} from "../scripts/validate-engineering-impact.mjs";

const validatorPath = fileURLToPath(new URL("../scripts/validate-engineering-impact.mjs", import.meta.url));

test("the shared receipt contract has one immutable v1 identity and bounded collections", () => {
  const schema = JSON.parse(readFileSync(new URL(
    "../docs/contracts/engineering-pull-request-receipt.schema.json",
    import.meta.url,
  ), "utf8"));
  assert.equal(schema.$id, "urn:interview-arc:contracts:engineering-pull-request-receipt:1");
  assert.equal(schema.properties.sources.maxItems, 32);
  assert.equal(schema.properties.sources.items.properties.label.maxLength, 160);
  assert.equal(schema.properties.sources.items.properties.url.maxLength, 2048);
  assert.equal(schema.$defs.stringList.maxItems, 32);
  assert.equal(schema.$defs.stringList.items.maxLength, 512);
  assert.equal(schema.$defs.recordRefs.maxItems, 16);
  assert.equal(schema.$defs.recordRefs.items.maxLength, 180);

  const batchSchema = JSON.parse(readFileSync(new URL(
    "../docs/contracts/engineering-historical-backfill-batch.schema.json",
    import.meta.url,
  ), "utf8"));
  assert.equal(batchSchema.$id, "urn:interview-arc:contracts:engineering-historical-backfill-batch:1");
  assert.equal(batchSchema.properties.receiptPaths.maxItems, 20);
  assert.equal(batchSchema.properties.recordRefs.maxItems, 32);
  assert.equal(batchSchema.properties.addedRecordRefs.maxItems, 8);
  assert.equal(batchSchema.additionalProperties, false);
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(cwd, path, contents) {
  const destination = join(cwd, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function createRepository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "engineering-impact-"));
  t.after(() => rmSync(cwd, { force: true, recursive: true }));
  git(cwd, ["init", "--quiet", "--initial-branch=main"]);
  git(cwd, ["config", "user.name", "Engineering Impact Test"]);
  git(cwd, ["config", "user.email", "engineering-impact@example.com"]);
  write(cwd, "bin/gh", `#!/bin/sh
printf '%s\\n' '{"html_url":"https://github.com/example/interview-arc/issues/313#issuecomment-123456","author_association":"OWNER","body":"I authorize publication of this bounded historical Engineering backfill batch under the residual-link policy."}'
`);
  chmodSync(join(cwd, "bin/gh"), 0o755);
  write(cwd, "README.md", "# Fixture\n");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "--quiet", "-m", "base"]);
  return cwd;
}

function runValidator(cwd, event) {
  const eventPath = join(cwd, "event.json");
  const normalizedEvent = {
    repository: { name: "interview-arc", full_name: "example/interview-arc", ...(event.repository ?? {}) },
    ...event,
    pull_request: { title: "Fixture receipt", ...event.pull_request },
  };
  writeFileSync(eventPath, `${JSON.stringify(normalizedEvent)}\n`);
  return spawnSync(process.execPath, [validatorPath], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, PATH: `${join(cwd, "bin")}:${process.env.PATH}` },
  });
}

const checks = {
  none: "## Engineering impact\n\n- [x] None — reason: This change only corrects non-engineering copy.",
  review: "## Engineering impact\n\n- [x] Architecture Review",
};

const noneReceipt = {
  path: "docs/engineering/changes/pr-312.md",
  repository: "interview-arc",
  pr: 312,
  title: "Fixture receipt",
  classification: "none",
  richRecordRefs: [],
  reconstructed: false,
};

function validate(input) {
  const changedFiles = [...new Set([...(input.changedFiles ?? []), noneReceipt.path])];
  return validateEngineeringImpact({
    pullRequestNumber: 312,
    pullRequestTitle: "Fixture receipt",
    repository: "interview-arc",
    receipt: noneReceipt,
    ...input,
    changedFiles,
  });
}

test("every pull request changes its one canonical receipt", () => {
  assert.throws(
    () => validate({
      body: checks.none,
      changedFiles: ["README.md"],
      recordTypes: [],
      receipt: null,
    }),
    /canonical Pull Request Receipt/,
  );
  assert.equal(
    validate({
      body: checks.none,
      changedFiles: ["README.md", noneReceipt.path],
      recordTypes: [],
    }).classification,
    "none",
  );
  assert.throws(
    () => validate({
      body: checks.none,
      changedFiles: [noneReceipt.path, "docs/engineering/changes/pr-311.md"],
      recordTypes: [],
    }),
    /exactly one canonical Pull Request Receipt/,
  );
  assert.throws(
    () => validate({
      body: checks.none,
      changedFiles: [noneReceipt.path],
      recordTypes: [],
      receipt: { ...noneReceipt, pr: 311 },
    }),
    /must match the pull request number/,
  );
  assert.throws(
    () => validate({
      body: checks.none,
      changedFiles: [noneReceipt.path],
      recordTypes: [],
      receipt: { ...noneReceipt, classification: "architecture-review" },
    }),
    /classification must match/,
  );
});

test("the required validation CLI reads the numbered receipt from the pull request head", (t) => {
  const cwd = createRepository(t);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Fixture receipt
classification: none
richRecordRefs: []
reconstructed: false
---
# Fixture receipt

Records one small fixture change.
`);
  git(cwd, ["add", "docs/engineering/changes/pr-312.md"]);
  git(cwd, ["commit", "--quiet", "-m", "add receipt"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: checks.none,
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Engineering impact: none/);
});

test("a bounded historical batch keeps the current PR receipt separate from reconstructed history", (t) => {
  const cwd = createRepository(t);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Fixture receipt
classification: none
richRecordRefs: []
reconstructed: false
---
# Fixture receipt

Publishes one bounded historical evidence batch without changing current product behavior.
`);
  write(cwd, "docs/engineering/changes/pr-1.md", `---
schemaVersion: 1
repository: interview-arc
pr: 1
title: Historical small change
classification: none
richRecordRefs: []
reconstructed: true
---
# Historical small change

Records one verified historical change.
`);
  write(cwd, "docs/engineering/changes/pr-2.md", `---
schemaVersion: 1
repository: interview-arc
pr: 2
title: Historical architecture review
classification: architecture-review
richRecordRefs: ["review@1"]
reconstructed: true
---
# Historical architecture review

Links the exact reviewed architecture evidence.
`);
  write(cwd, "docs/engineering/records/review.md", `---
id: review
revision: 1
type: architecture-review
---
# Review
`);
  write(cwd, "docs/engineering/backfill/pr-312.json", `${JSON.stringify({
    schemaVersion: 1,
    repository: "interview-arc",
    pullRequest: 312,
    privacyAuthorizationUrl: "https://github.com/example/interview-arc/issues/313#issuecomment-123456",
    receiptPaths: ["docs/engineering/changes/pr-1.md", "docs/engineering/changes/pr-2.md"],
    recordRefs: ["review@1"],
    addedRecordRefs: ["review@1"],
  }, null, 2)}\n`);
  git(cwd, ["add", "docs/engineering"]);
  git(cwd, ["commit", "--quiet", "-m", "add historical batch"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: "## Engineering impact\n\n- [x] None — reason: This PR publishes reviewed historical evidence without changing current behavior.",
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /historical batch: 2 receipt\(s\), 1 rich record\(s\)/);
});

test("historical receipt deletion fails with an explicit add-only diagnostic", (t) => {
  const cwd = createRepository(t);
  write(cwd, "docs/engineering/changes/pr-1.md", `---
schemaVersion: 1
repository: interview-arc
pr: 1
title: Accepted historical receipt
classification: none
richRecordRefs: []
reconstructed: true
---
# Accepted historical receipt

Already accepted history.
`);
  git(cwd, ["add", "docs/engineering/changes/pr-1.md"]);
  git(cwd, ["commit", "--quiet", "-m", "accepted history"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  git(cwd, ["rm", "--quiet", "docs/engineering/changes/pr-1.md"]);
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Fixture receipt
classification: none
richRecordRefs: []
reconstructed: false
---
# Fixture receipt

Attempts an invalid historical deletion.
`);
  write(cwd, "docs/engineering/backfill/pr-312.json", `${JSON.stringify({
    schemaVersion: 1,
    repository: "interview-arc",
    pullRequest: 312,
    privacyAuthorizationUrl: "https://github.com/example/interview-arc/issues/313#issuecomment-123456",
    receiptPaths: ["docs/engineering/changes/pr-1.md"],
    recordRefs: [],
    addedRecordRefs: [],
  }, null, 2)}\n`);
  git(cwd, ["add", "docs/engineering"]);
  git(cwd, ["commit", "--quiet", "-m", "attempt deletion"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: "## Engineering impact\n\n- [x] None — reason: This PR attempts to publish one historical evidence batch.",
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /add-only; changed canonical receipts and records must exist/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test("historical receipt size is rejected before the batch body is loaded", (t) => {
  const cwd = createRepository(t);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Fixture receipt
classification: none
richRecordRefs: []
reconstructed: false
---
# Fixture receipt

Attempts an oversized historical publication batch.
`);
  write(cwd, "docs/engineering/changes/pr-1.md", `---
schemaVersion: 1
repository: interview-arc
pr: 1
title: Oversized historical receipt
classification: none
richRecordRefs: []
reconstructed: true
---
# Oversized historical receipt

${"x".repeat(270_000)}
`);
  write(cwd, "docs/engineering/backfill/pr-312.json", `${JSON.stringify({
    schemaVersion: 1,
    repository: "interview-arc",
    pullRequest: 312,
    privacyAuthorizationUrl: "https://github.com/example/interview-arc/issues/313#issuecomment-123456",
    receiptPaths: ["docs/engineering/changes/pr-1.md"],
    recordRefs: [],
    addedRecordRefs: [],
  }, null, 2)}\n`);
  git(cwd, ["add", "docs/engineering"]);
  git(cwd, ["commit", "--quiet", "-m", "oversized history"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: "## Engineering impact\n\n- [x] None — reason: This PR attempts to publish one historical evidence batch.",
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds the 262144-byte safety limit/);
});

test("historical batch validation is exact, bounded, add-only, and privacy-authorized", () => {
  const manifest = {
    schemaVersion: 1,
    repository: "interview-arc",
    pullRequest: 312,
    privacyAuthorizationUrl: "https://github.com/example/interview-arc/issues/313#issuecomment-123456",
    receiptPaths: ["docs/engineering/changes/pr-1.md"],
    recordRefs: ["review@1"],
    addedRecordRefs: ["review@1"],
  };
  const receipt = {
    path: "docs/engineering/changes/pr-1.md",
    repository: "interview-arc",
    pr: 1,
    classification: "architecture-review",
    richRecordRefs: ["review@1"],
    reconstructed: true,
  };
  const record = { ref: "review@1", type: "architecture-review", existsAtHead: true };
  const input = {
    manifest,
    manifestPath: "docs/engineering/backfill/pr-312.json",
    changedFiles: [
      "docs/engineering/changes/pr-312.md",
      "docs/engineering/backfill/pr-312.json",
      receipt.path,
      "docs/engineering/records/review.md",
    ],
    changedRecords: [record],
    historicalReceipts: [receipt],
    linkedRecords: [record],
    pullRequestNumber: 312,
    repository: "interview-arc",
    repositoryFullName: "example/interview-arc",
  };

  assert.deepEqual(validateHistoricalBatch(input), {
    historicalReceiptCount: 1,
    historicalRecordCount: 1,
  });
  assert.throws(
    () => validateHistoricalBatch({ ...input, manifest: { ...manifest, privacyAuthorizationUrl: "" } }),
    /invalid bounded fields/,
  );
  assert.throws(
    () => validateHistoricalBatch({ ...input, repositoryFullName: "another/interview-arc" }),
    /owning GitHub repository/,
  );
  assert.throws(
    () => validateHistoricalBatch({ ...input, baseExistingPaths: [receipt.path] }),
    /add-only/,
  );
  assert.throws(
    () => validateHistoricalBatch({
      ...input,
      changedRecords: [{ ...record, existsAtHead: false }],
      baseExistingPaths: ["docs/engineering/records/review.md"],
    }),
    /add-only/,
  );
  assert.throws(
    () => validateHistoricalBatch({ ...input, changedFiles: [...input.changedFiles, "README.md"] }),
    /may contain only/,
  );
  assert.throws(
    () => validateHistoricalBatch({
      ...input,
      manifest: {
        ...manifest,
        receiptPaths: Array.from({ length: 21 }, (_, index) => `docs/engineering/changes/pr-${index + 1}.md`),
      },
    }),
    /invalid bounded fields/,
  );
  assert.throws(
    () => validateHistoricalBatch({
      ...input,
      manifest: { ...manifest, unsupported: true },
    }),
    /unsupported or missing fields/,
  );
  assert.throws(
    () => validateHistoricalBatch({
      ...input,
      manifest: { ...manifest, recordRefs: ["review@1", "review@1"] },
    }),
    /invalid bounded fields/,
  );
  assert.throws(
    () => validateHistoricalBatch({
      ...input,
      historicalReceipts: [{ ...receipt, reconstructed: false }],
    }),
    /must be reconstructed/,
  );
  assert.throws(
    () => validateHistoricalBatch({
      ...input,
      linkedRecords: [{ ...record, type: "postmortem" }],
    }),
    /exact matching rich record revisions/,
  );
});

test("historical privacy authorization must be an exact owner comment", () => {
  const manifest = {
    privacyAuthorizationUrl: "https://github.com/example/interview-arc/issues/313#issuecomment-123456",
  };
  assert.doesNotThrow(() => verifyHistoricalAuthorization(manifest, "example/interview-arc", () => ({
    html_url: manifest.privacyAuthorizationUrl,
    author_association: "OWNER",
    body: "I authorize publication of this bounded historical Engineering backfill batch under the residual-link policy.",
  })));
  assert.throws(() => verifyHistoricalAuthorization(manifest, "example/interview-arc", () => ({
    html_url: manifest.privacyAuthorizationUrl,
    author_association: "CONTRIBUTOR",
    body: "I authorize publication of this bounded historical Engineering backfill batch under the residual-link policy.",
  })), /repository-owner privacy authorization/);
  assert.throws(() => verifyHistoricalAuthorization(manifest, "example/interview-arc", () => ({
    html_url: manifest.privacyAuthorizationUrl,
    author_association: "OWNER",
    body: "Looks good",
  })), /repository-owner privacy authorization/);
});

test("the required validation CLI accepts a modified receipt and rejects its deletion", (t) => {
  const cwd = createRepository(t);
  const receiptPath = "docs/engineering/changes/pr-312.md";
  const receipt = (summary) => `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Fixture receipt
classification: none
richRecordRefs: []
reconstructed: false
---
# Fixture receipt

${summary}
`;
  write(cwd, receiptPath, receipt("Records the original fixture change."));
  git(cwd, ["add", receiptPath]);
  git(cwd, ["commit", "--quiet", "-m", "add original receipt"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(cwd, receiptPath, receipt("Records the corrected fixture change."));
  git(cwd, ["add", receiptPath]);
  git(cwd, ["commit", "--quiet", "-m", "modify receipt"]);
  const modifiedHead = git(cwd, ["rev-parse", "HEAD"]);

  const modified = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: checks.none,
      base: { sha: base },
      head: { sha: modifiedHead },
    },
  });
  assert.equal(modified.status, 0, modified.stderr);

  rmSync(join(cwd, receiptPath));
  git(cwd, ["add", "--all"]);
  git(cwd, ["commit", "--quiet", "-m", "delete receipt"]);
  const deletedHead = git(cwd, ["rev-parse", "HEAD"]);
  const deleted = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: checks.none,
      base: { sha: modifiedHead },
      head: { sha: deletedHead },
    },
  });
  assert.notEqual(deleted.status, 0);
  assert.match(deleted.stderr, /canonical Pull Request Receipt/);
});

test("the required validation CLI verifies exact rich record revisions", (t) => {
  const cwd = createRepository(t);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(cwd, "docs/engineering/records/review.md", `---
schemaVersion: 1
id: review
revision: 2
type: architecture-review
---
# Review

Records the reviewed boundary.
`);
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Fixture receipt
classification: architecture-review
richRecordRefs: ["review@2"]
reconstructed: false
---
# Fixture receipt

Records one material fixture change.
`);
  git(cwd, ["add", "docs/engineering"]);
  git(cwd, ["commit", "--quiet", "-m", "add material receipt"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      body: checks.review,
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Engineering impact: architecture-review/);
});

test("a material receipt can reuse one exact existing rich record for a PR cluster", (t) => {
  const cwd = createRepository(t);
  write(cwd, "docs/engineering/records/review.md", `---
schemaVersion: 1
id: review
revision: 1
type: architecture-review
---
# Review

Records the shared multi-PR architecture boundary.
`);
  git(cwd, ["add", "docs/engineering/records/review.md"]);
  git(cwd, ["commit", "--quiet", "-m", "accept shared review"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  const receipt = (ref) => `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Reuse shared architecture review
classification: architecture-review
richRecordRefs: ["${ref}"]
reconstructed: false
---
# Reuse shared architecture review

Links this material slice to the already reviewed multi-PR architecture boundary.
`;
  write(cwd, "docs/engineering/changes/pr-312.md", receipt("review@1"));
  git(cwd, ["add", "docs/engineering/changes/pr-312.md"]);
  git(cwd, ["commit", "--quiet", "-m", "link shared review"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const accepted = runValidator(cwd, {
    pull_request: {
      number: 312,
      title: "Reuse shared architecture review",
      body: checks.review,
      base: { sha: base },
      head: { sha: head },
    },
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  write(cwd, "docs/engineering/changes/pr-312.md", receipt("review@2"));
  git(cwd, ["add", "docs/engineering/changes/pr-312.md"]);
  git(cwd, ["commit", "--quiet", "-m", "link missing revision"]);
  const invalidHead = git(cwd, ["rev-parse", "HEAD"]);
  const rejected = runValidator(cwd, {
    pull_request: {
      number: 312,
      title: "Reuse shared architecture review",
      body: checks.review,
      base: { sha: base },
      head: { sha: invalidHead },
    },
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /exact rich Engineering record revisions/);
});

test("the required validation CLI rejects deletion of a canonical rich record", (t) => {
  const cwd = createRepository(t);
  write(cwd, "docs/engineering/records/review.md", `---
schemaVersion: 1
id: review
revision: 1
type: architecture-review
---
# Review
`);
  git(cwd, ["add", "docs/engineering/records/review.md"]);
  git(cwd, ["commit", "--quiet", "-m", "add accepted record"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  rmSync(join(cwd, "docs/engineering/records/review.md"));
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Invalid deletion receipt
classification: architecture-review
richRecordRefs: ["review@1"]
reconstructed: false
---
# Invalid deletion receipt

Attempts to link a deleted record.
`);
  git(cwd, ["add", "--all"]);
  git(cwd, ["commit", "--quiet", "-m", "delete accepted record"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      title: "Invalid deletion receipt",
      body: checks.review,
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must exist at the pull request head/);
});

test("the required validation CLI fetches missing event revisions in a shallow checkout", (t) => {
  const root = mkdtempSync(join(tmpdir(), "engineering-impact-shallow-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const shallow = join(root, "shallow");
  mkdirSync(source);
  git(source, ["init", "--quiet", "--initial-branch=main"]);
  git(source, ["config", "user.name", "Engineering Impact Test"]);
  git(source, ["config", "user.email", "engineering-impact@example.com"]);
  write(source, "README.md", "# Fixture\n");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "--quiet", "-m", "base"]);
  const base = git(source, ["rev-parse", "HEAD"]);
  write(source, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Shallow fixture receipt
classification: none
richRecordRefs: []
reconstructed: false
---
# Shallow fixture receipt

Records one small fixture change.
`);
  git(source, ["add", "docs/engineering/changes/pr-312.md"]);
  git(source, ["commit", "--quiet", "-m", "add receipt"]);
  const head = git(source, ["rev-parse", "HEAD"]);
  execFileSync("git", ["clone", "--quiet", "--bare", source, remote]);
  execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${remote}`, shallow]);
  assert.notEqual(spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: shallow }).status, 0);

  const result = runValidator(shallow, {
    pull_request: {
      number: 312,
      title: "Shallow fixture receipt",
      body: checks.none,
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Engineering impact: none/);
});

test("the required validation CLI never falls back to stale base metadata for an invalid head record", (t) => {
  const cwd = createRepository(t);
  write(cwd, "docs/engineering/records/review.md", `---
schemaVersion: 1
id: review
revision: 1
type: architecture-review
---
# Review
`);
  git(cwd, ["add", "docs/engineering/records/review.md"]);
  git(cwd, ["commit", "--quiet", "-m", "add valid record"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  write(cwd, "docs/engineering/records/review.md", `---
schemaVersion: 1
id: review
id: injected-private-value
revision: 1
---
# Invalid review

type: architecture-review
`);
  write(cwd, "docs/engineering/changes/pr-312.md", `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Invalid metadata receipt
classification: architecture-review
richRecordRefs: ["review@1"]
reconstructed: false
---
# Invalid metadata receipt

Attempts to rely on stale base metadata.
`);
  git(cwd, ["add", "docs/engineering"]);
  git(cwd, ["commit", "--quiet", "-m", "invalidate record"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runValidator(cwd, {
    pull_request: {
      number: 312,
      title: "Invalid metadata receipt",
      body: checks.review,
      base: { sha: base },
      head: { sha: head },
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontmatter is invalid/);
  assert.doesNotMatch(result.stderr, /injected-private-value|type: architecture-review/);
});

test("forward changes require exactly one PR impact classification", () => {
  assert.throws(
    () => validate({ body: "", changedFiles: ["README.md"], recordTypes: [] }),
    /exactly one/,
  );
  assert.throws(
    () => validate({ body: `${checks.none}\n${checks.review}`, changedFiles: ["README.md"], recordTypes: [] }),
    /exactly one/,
  );
  assert.throws(
    () => validate({
      body: `## Summary\n\n- [x] None — reason: This text is outside the Engineering impact section.\n\n## Engineering impact\n\n- [ ] None`,
      changedFiles: ["README.md"],
      recordTypes: [],
    }),
    /exactly one/,
  );
  const nestedFenceBody = `\`\`\`\`markdown
## Engineering impact
- [x] ADR
\`\`\`
- [x] Postmortem
\`\`\`\`

${checks.none}`;
  assert.equal(
    validate({ body: nestedFenceBody, changedFiles: ["README.md"], recordTypes: [] }).classification,
    "none",
  );
});

test("PR title and body edits rerun the required validation workflow", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request:\n\s+types: \[opened, synchronize, reopened, edited\]/);
});

test("forward receipts bind to the exact repository, title, and authorship mode", () => {
  assert.throws(
    () => validate({
      body: checks.none,
      recordTypes: [],
      receipt: { ...noneReceipt, repository: "interview-arc-live" },
    }),
    /repository must match/,
  );
  assert.throws(
    () => validate({
      body: checks.none,
      recordTypes: [],
      receipt: { ...noneReceipt, title: "A copied receipt" },
    }),
    /title must match/,
  );
  assert.throws(
    () => validate({
      body: checks.none,
      recordTypes: [],
      receipt: { ...noneReceipt, reconstructed: true },
    }),
    /reconstructed: false/,
  );
});

test("fork head fetches accept only exact GitHub HTTPS remotes", () => {
  assert.equal(trustedHeadRemote(undefined), "origin");
  assert.equal(
    trustedHeadRemote("https://github.com/example/contributor-fork.git"),
    "https://github.com/example/contributor-fork.git",
  );
  assert.throws(() => trustedHeadRemote("git@github.com:example/contributor-fork.git"), /trusted GitHub HTTPS/);
  assert.throws(() => trustedHeadRemote("https://example.com/untrusted.git"), /trusted GitHub HTTPS/);
});

test("None requires a concrete reason and cannot hide a canonical record", () => {
  assert.throws(
    () => validate({ body: "## Engineering impact\n\n- [x] None — reason: TODO", changedFiles: ["README.md"], recordTypes: [] }),
    /concrete reason/,
  );
  assert.throws(
    () => validate({ body: "## Engineering impact\n\n- [x] None — reason: REPLACE WITH A CONCRETE REASON", changedFiles: ["README.md"], recordTypes: [] }),
    /concrete reason/,
  );
  assert.equal(
    validate({ body: checks.none, changedFiles: ["README.md"], recordTypes: [] }).classification,
    "none",
  );
  assert.equal(
    validate({
      body: "## Engineering impact\n\n- [x] None — reason: This change replaces an obsolete workflow without changing runtime behavior.",
      changedFiles: ["README.md"],
      recordTypes: [],
    }).classification,
    "none",
  );
  assert.throws(
    () => validate({ body: checks.none, changedFiles: ["docs/engineering/records/review.md"], recordTypes: ["architecture-review"] }),
    /cannot be `None`/,
  );
  assert.throws(
    () => validate({
      body: checks.none,
      changedFiles: ["README.md"],
      recordTypes: [],
      recordRefs: [],
      receipt: { ...noneReceipt, richRecordRefs: ["review@1"] },
    }),
    /must not link rich Engineering records/,
  );
});

test("rich classifications require one matching canonical record type", () => {
  assert.equal(
    validate({
      body: checks.review,
      changedFiles: ["docs/engineering/records/review.md"],
      recordTypes: ["architecture-review"],
      recordRefs: ["review@1"],
      receipt: { ...noneReceipt, classification: "architecture-review", richRecordRefs: ["review@1"] },
    }).classification,
    "architecture-review",
  );
  assert.throws(
    () => validate({
      body: checks.review,
      changedFiles: ["app/page.tsx"],
      recordTypes: [],
      recordRefs: [],
      receipt: { ...noneReceipt, classification: "architecture-review", richRecordRefs: ["review@1"] },
    }),
    /requires a matching/,
  );
  assert.throws(
    () => validate({
      body: checks.review,
      changedFiles: ["docs/engineering/records/postmortem.md"],
      recordTypes: ["postmortem"],
      recordRefs: ["postmortem@1"],
      receipt: { ...noneReceipt, classification: "architecture-review", richRecordRefs: ["review@1"] },
    }),
    /does not match/,
  );
  assert.throws(
    () => validate({
      body: checks.review,
      changedFiles: ["docs/engineering/records/review.md"],
      recordTypes: ["architecture-review"],
      recordRefs: ["review@2"],
      receipt: { ...noneReceipt, classification: "architecture-review", richRecordRefs: ["review@1"] },
    }),
    /exact rich Engineering record revisions/,
  );
});

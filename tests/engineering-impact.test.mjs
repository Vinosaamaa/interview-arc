import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { trustedHeadRemote, validateEngineeringImpact } from "../scripts/validate-engineering-impact.mjs";

const validatorPath = fileURLToPath(new URL("../scripts/validate-engineering-impact.mjs", import.meta.url));

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
  write(cwd, "README.md", "# Fixture\n");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "--quiet", "-m", "base"]);
  return cwd;
}

function runValidator(cwd, event) {
  const eventPath = join(cwd, "event.json");
  const normalizedEvent = {
    repository: { name: "interview-arc", ...(event.repository ?? {}) },
    ...event,
    pull_request: { title: "Fixture receipt", ...event.pull_request },
  };
  writeFileSync(eventPath, `${JSON.stringify(normalizedEvent)}\n`);
  return spawnSync(process.execPath, [validatorPath], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
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
    /exact rich Engineering record reference/,
  );
});

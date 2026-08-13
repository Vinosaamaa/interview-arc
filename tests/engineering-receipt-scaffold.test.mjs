import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEngineeringJournal } from "../engineering-journal/index.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/new-engineering-receipt.mjs", import.meta.url));

async function repositoryFixture(t, { receiptDirectory = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "engineering-receipt-scaffold-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(
    path.join(root, "docs", "engineering", ...(receiptDirectory ? ["changes"] : [])),
    { recursive: true },
  );
  await writeFile(path.join(root, "package.json"), '{"name":"interview-arc","private":true}\n');
  return root;
}

test("a fresh clone creates its first canonical receipt directory", async (t) => {
  const root = await repositoryFixture(t, { receiptDirectory: false });
  const result = scaffold(root, [
    "--pr", "311",
    "--title", "Adopt the first Engineering receipt",
    "--summary", "Created the first canonical receipt in a fresh repository clone.",
    "--classification", "none",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await readFile(path.join(root, "docs", "engineering", "changes", "pr-311.md"), "utf8"),
    /^pr: 311$/m,
  );
});

function scaffold(root, arguments_) {
  return spawnSync(process.execPath, [SCRIPT, ...arguments_], {
    cwd: root,
    encoding: "utf8",
  });
}

test("a small forward PR gets one compact receipt with null historical facts", async (t) => {
  const root = await repositoryFixture(t);
  const result = scaffold(root, [
    "--pr", "312",
    "--title", "Correct Engineering navigation labels",
    "--summary", "Renamed one local navigation label without changing a Module or Interface.",
    "--classification", "none",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const markdown = await readFile(path.join(root, "docs", "engineering", "changes", "pr-312.md"), "utf8");
  assert.equal(result.stdout, "Created docs/engineering/changes/pr-312.md\n");
  assert.equal(
    markdown,
    `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: "Correct Engineering navigation labels"
classification: none
richRecordRefs: []
reconstructed: false
confidence: verified
unknowns: []
headCommit: null
mergeCommit: null
mergedAt: null
sources: [{"label":"Pull request #312","url":"https://github.com/Vinosaamaa/interview-arc/pull/312","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:312"]}
visibility: public-safe
publicationEligibility: eligible
---
# Correct Engineering navigation labels

Renamed one local navigation label without changing a Module or Interface.
`,
  );
  const projection = buildEngineeringJournal({
    trustedRepositories: [{
      repository: "interview-arc",
      owner: "Vinosaamaa",
      canonicalPath: "docs/engineering/records",
      receiptPath: "docs/engineering/changes",
    }],
    documents: [],
    receiptDocuments: [{
      repository: "interview-arc",
      commit: "a".repeat(40),
      committedAt: "2026-08-12T12:00:00Z",
      path: "docs/engineering/changes/pr-312.md",
      markdown,
    }],
  });
  assert.equal(projection.index.pullRequestReceipts[0].ref, "pr:interview-arc:312");
});

test("titles with apostrophes and colons remain valid canonical frontmatter", async (t) => {
  const root = await repositoryFixture(t);
  const title = "Don't regress: preserve \"receipt\" titles";
  const result = scaffold(root, [
    "--pr", "314",
    "--title", title,
    "--summary", "Preserved punctuation in the exact public pull-request title.",
    "--classification", "none",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const markdown = await readFile(path.join(root, "docs", "engineering", "changes", "pr-314.md"), "utf8");
  assert.match(markdown, /^title: "Don't regress: preserve \\"receipt\\" titles"$/m);
  const projection = buildEngineeringJournal({
    trustedRepositories: [{
      repository: "interview-arc",
      owner: "Vinosaamaa",
      canonicalPath: "docs/engineering/records",
      receiptPath: "docs/engineering/changes",
    }],
    documents: [],
    receiptDocuments: [{
      repository: "interview-arc",
      commit: "b".repeat(40),
      committedAt: "2026-08-12T12:05:00Z",
      path: "docs/engineering/changes/pr-314.md",
      markdown,
    }],
  });
  assert.equal(projection.index.pullRequestReceipts[0].title, title);
});

test("a material PR links its sorted exact rich-record revisions", async (t) => {
  const root = await repositoryFixture(t);
  const result = scaffold(root, [
    "--pr", "313",
    "--title", "Adopt the Engineering Journal boundary",
    "--summary", "Adopted the reviewed Journal contract and deterministic projection in the website repository.",
    "--classification", "architecture-review",
    "--rich-record-ref", "journal-source-pinning@2",
    "--rich-record-ref", "architecture-review-engineering-journal-module@1",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const markdown = await readFile(path.join(root, "docs", "engineering", "changes", "pr-313.md"), "utf8");
  assert.match(markdown, /^classification: architecture-review$/m);
  assert.match(
    markdown,
    /^richRecordRefs: \["architecture-review-engineering-journal-module@1","journal-source-pinning@2"\]$/m,
  );
  assert.match(markdown, /https:\/\/github\.com\/Vinosaamaa\/interview-arc\/pull\/313/);
  assert.match(markdown, /"evidenceRefs":\["pull-request:313"\]/);
});

test("public-unsafe title or summary values are rejected without echoing them", async (t) => {
  const unsafeValues = [
    "/Users/person/Projects/private/notes.txt",
    "access_token=privatevalue12345",
  ];

  for (const [index, unsafe] of unsafeValues.entries()) {
    const root = await repositoryFixture(t);
    const pr = 320 + index;
    const result = scaffold(root, [
      "--pr", String(pr),
      "--title", "Document the Engineering change",
      "--summary", unsafe,
      "--classification", "none",
    ]);

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, new RegExp(unsafe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await assert.rejects(
      readFile(path.join(root, "docs", "engineering", "changes", `pr-${pr}.md`), "utf8"),
      { code: "ENOENT" },
    );
  }
});

test("invalid identities, classifications, compact prose, and record references fail before writing", async (t) => {
  const valid = [
    "--pr", "330",
    "--title", "Document the Engineering change",
    "--summary", "Recorded one compact and public-safe implementation fact.",
    "--classification", "none",
  ];
  const cases = [
    valid.with(1, "0"),
    valid.with(3, "x".repeat(161)),
    valid.with(5, "x".repeat(281)),
    valid.with(7, "story"),
    [...valid, "--rich-record-ref", "review@1"],
    valid.with(7, "architecture-review"),
    [...valid.with(7, "architecture-review"), "--rich-record-ref", "Bad@0"],
    [...valid.with(7, "architecture-review"), "--rich-record-ref", "review@1", "--rich-record-ref", "review@1"],
    [...valid.with(7, "architecture-review"), "--rich-record-ref", `${"a".repeat(179)}@1`],
    [
      ...valid.with(7, "architecture-review"),
      ...Array.from({ length: 17 }, (_, index) => ["--rich-record-ref", `review-${index + 1}@1`]).flat(),
    ],
    valid.with(5, "## Decision"),
    [...valid, "--unexpected", "value"],
  ];

  for (const arguments_ of cases) {
    const root = await repositoryFixture(t);
    const result = scaffold(root, arguments_);
    assert.equal(result.status, 1, result.stdout);
    assert.deepEqual(await readdir(path.join(root, "docs", "engineering", "changes")), []);
  }
});

test("an existing numbered receipt is never overwritten", async (t) => {
  const root = await repositoryFixture(t);
  const target = path.join(root, "docs", "engineering", "changes", "pr-340.md");
  await writeFile(target, "existing reviewed receipt\n");

  const result = scaffold(root, [
    "--pr", "340",
    "--title", "Replace an existing receipt",
    "--summary", "This request must fail without changing the reviewed file.",
    "--classification", "none",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to overwrite docs\/engineering\/changes\/pr-340\.md/);
  assert.equal(await readFile(target, "utf8"), "existing reviewed receipt\n");
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildEngineeringJournal } from "../engineering-journal/index.ts";

const SOURCE_COMMIT = "a".repeat(40);
const TRUSTED_REPOSITORIES = [{
  repository: "interview-arc",
  owner: "Vinosaamaa",
  canonicalPath: "docs/engineering/records",
}];

const TRACER = `---
schemaVersion: 1
id: architecture-review-engineering-journal-module
revision: 1
type: architecture-review
status: accepted
title: Deep Engineering Journal Module
repository: interview-arc
capabilityIds: ["engineering-journal"]
createdAt: 2026-08-12
reconstructed: false
confidence: verified
unknowns: []
modules: ["engineering-journal"]
interfaces: ["engineering-journal-record"]
seams: ["canonical-record-ingestion", "journal-rendering"]
adapters: ["website", "standalone-html"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["engineering-journal"]
amends: []
supersedes: []
learningRefs: []
diagrams: [{"title":"Commit-pinned publication flow","sourcePath":"docs/design/engineering-workspace/journal-module-architecture.drawio","renderedPath":"docs/design/engineering-workspace/journal-module-architecture.png","summary":"Verified records cross one deterministic build boundary before reaching both readers.","evidenceRefs":["issue:278"]}]
sources: [{"label":"Arc issue #278","url":"https://github.com/Vinosaamaa/interview-arc/issues/278","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:278"]}
visibility: public-safe
publicationEligibility: eligible
issue: 278
pr: null
release: null
run: null
---
# Deep Engineering Journal Module

Engineering records need one public Interface with exact provenance.

## Problem

Canonical evidence must project without duplicating validation logic.

## Decision

Compile canonical Markdown through one deterministic Journal Module.

## Interview view

The implementation boundary is one public Interface backed by immutable revisions.
`;

const RECEIPT = `---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Correct Engineering navigation labels
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
`;

function input() {
  return {
    trustedRepositories: structuredClone(TRUSTED_REPOSITORIES),
    documents: [{
      repository: "interview-arc",
      commit: SOURCE_COMMIT,
      path: "docs/engineering/records/architecture-review-engineering-journal-module.md",
      markdown: TRACER,
    }],
  };
}

function inputWithReceipt(markdown = RECEIPT) {
  const buildInput = input();
  buildInput.trustedRepositories[0].receiptPath = "docs/engineering/changes";
  buildInput.receiptDocuments = [{
    repository: "interview-arc",
    commit: "b".repeat(40),
    committedAt: "2026-08-12T18:42:11Z",
    path: "docs/engineering/changes/pr-312.md",
    markdown,
  }];
  return buildInput;
}

test("the Journal Module deterministically projects one commit-pinned canonical record", () => {
  const first = buildEngineeringJournal(input());
  const second = buildEngineeringJournal(input());

  assert.deepEqual(second, first);
  assert.equal(first.index.records[0].source.commit, SOURCE_COMMIT);
  assert.equal(first.index.records[0].body.startsWith("# "), false);
  assert.equal(first.index.records[0].summary, "Engineering records need one public Interface with exact provenance.");
  assert.equal(first.index.records[0].interviewView.id, "interview-view");
  assert.deepEqual(first.index.records[0].diagrams[0], {
    title: "Commit-pinned publication flow",
    sourcePath: "docs/design/engineering-workspace/journal-module-architecture.drawio",
    renderedPath: "docs/design/engineering-workspace/journal-module-architecture.png",
    summary: "Verified records cross one deterministic build boundary before reaching both readers.",
    evidenceRefs: ["issue:278"],
    sourcePermalink: `https://github.com/Vinosaamaa/interview-arc/blob/${SOURCE_COMMIT}/docs/design/engineering-workspace/journal-module-architecture.drawio`,
    renderedPermalink: `https://github.com/Vinosaamaa/interview-arc/blob/${SOURCE_COMMIT}/docs/design/engineering-workspace/journal-module-architecture.png`,
    renderedUrl: `https://raw.githubusercontent.com/Vinosaamaa/interview-arc/${SOURCE_COMMIT}/docs/design/engineering-workspace/journal-module-architecture.png`,
  });
  assert.equal(
    first.index.records[0].source.permalink,
    `https://github.com/Vinosaamaa/interview-arc/blob/${SOURCE_COMMIT}/docs/engineering/records/architecture-review-engineering-journal-module.md`,
  );
});

test("rich-record diagrams require repository-native paths and recorded evidence", () => {
  const unsafePath = input();
  unsafePath.documents[0].markdown = unsafePath.documents[0].markdown.replace(
    "docs/design/engineering-workspace/journal-module-architecture.drawio",
    "../private/journal-module-architecture.drawio",
  );
  assert.throws(() => buildEngineeringJournal(unsafePath), (error) => error.code === "field_diagrams_invalid");

  const unsupportedAsset = input();
  unsupportedAsset.documents[0].markdown = unsupportedAsset.documents[0].markdown.replace(
    "journal-module-architecture.png",
    "journal-module-architecture.html",
  );
  assert.throws(() => buildEngineeringJournal(unsupportedAsset), (error) => error.code === "field_diagrams_invalid");

  const unevidenced = input();
  unevidenced.documents[0].markdown = unevidenced.documents[0].markdown.replace(
    '"evidenceRefs":["issue:278"]',
    '"evidenceRefs":["unrecorded:claim"]',
  );
  assert.throws(() => buildEngineeringJournal(unevidenced), (error) => error.code === "field_diagrams_invalid");
});

test("every PR can project one compact receipt without entering the rich-record collection", () => {
  const result = buildEngineeringJournal(inputWithReceipt());

  assert.equal(result.index.records.length, 1);
  assert.equal(result.index.pullRequestReceipts.length, 1);
  assert.equal(result.index.pullRequestReceipts[0].ref, "pr:interview-arc:312");
  assert.equal(result.index.pullRequestReceipts[0].timelineBasis, "source-commit");
  assert.deepEqual(result.index.pullRequestReceipts[0].richRecordRefs, []);
  assert.equal(result.index.receiptStatistics.totalReceipts, 1);
  assert.equal(result.index.statistics.totalRecords, 1);
  assert.match(result.index.receiptSearch[0].text, /navigation labels/);
  assert.doesNotMatch(result.index.search[0].text, /navigation labels/);

  const duplicate = inputWithReceipt();
  duplicate.receiptDocuments.push({ ...duplicate.receiptDocuments[0], commit: "c".repeat(40) });
  assert.throws(() => buildEngineeringJournal(duplicate), (error) => error.code === "receipt_duplicate");
});

test("a material PR receipt links an exact rich-record revision of its declared type", () => {
  const materialReceipt = RECEIPT
    .replace("classification: none", "classification: architecture-review")
    .replace("richRecordRefs: []", 'richRecordRefs: ["architecture-review-engineering-journal-module@1"]');
  const result = buildEngineeringJournal(inputWithReceipt(materialReceipt));

  assert.deepEqual(
    result.index.receiptBacklinks["architecture-review-engineering-journal-module@1"],
    ["pr:interview-arc:312"],
  );

  const missing = inputWithReceipt(materialReceipt.replace("@1", "@2"));
  assert.throws(() => buildEngineeringJournal(missing), (error) => error.code === "receipt_record_target_missing");

  const mismatched = inputWithReceipt(materialReceipt.replace("classification: architecture-review", "classification: change-note"));
  assert.throws(() => buildEngineeringJournal(mismatched), (error) => error.code === "receipt_record_type_mismatch");
});

test("a lightweight PR receipt cannot become a second rich-prose format", () => {
  const proseReceipt = RECEIPT.replace(
    "Renamed one local navigation label without changing a Module or Interface.",
    "Renamed one local navigation label.\n\n## Decision\n\nThis duplicate narrative belongs in a rich record, not the receipt timeline.",
  );

  assert.throws(
    () => buildEngineeringJournal(inputWithReceipt(proseReceipt)),
    (error) => error.code === "receipt_not_compact",
  );
});

test("receipt provenance labels Git-derived fallbacks and externally verified backfill facts", () => {
  const current = buildEngineeringJournal(inputWithReceipt()).index.pullRequestReceipts[0];
  assert.equal(current.source.commit, "b".repeat(40));
  assert.equal(current.source.committedAt, "2026-08-12T18:42:11Z");
  assert.equal(current.timelineCommit, current.source.commit);
  assert.equal(current.timelineCommitBasis, "source-commit");
  assert.deepEqual(current.missingFacts, ["head-commit", "merge-commit", "merged-at"]);

  const reconstructed = RECEIPT
    .replace("reconstructed: false", "reconstructed: true")
    .replace("headCommit: null", `headCommit: ${"c".repeat(40)}`)
    .replace("mergeCommit: null", `mergeCommit: ${"d".repeat(40)}`)
    .replace("mergedAt: null", "mergedAt: 2026-08-13T01:02:03Z");
  const verified = buildEngineeringJournal(inputWithReceipt(reconstructed)).index.pullRequestReceipts[0];
  assert.equal(verified.reconstructed, true);
  assert.equal(verified.timelineAt, "2026-08-13T01:02:03Z");
  assert.equal(verified.timelineBasis, "verified-merge");
  assert.equal(verified.timelineCommit, "d".repeat(40));
  assert.equal(verified.timelineCommitBasis, "verified-merge");
  assert.deepEqual(verified.missingFacts, []);

  const unverified = inputWithReceipt(reconstructed.replace(
    'verification: {"state":"verified","evidenceRefs":["pull-request:312"]}',
    'verification: {"state":"not-recorded","evidenceRefs":[]}',
  ));
  assert.throws(() => buildEngineeringJournal(unverified), (error) => error.code === "receipt_supplied_fact_unverified");

  const impossibleDate = inputWithReceipt();
  impossibleDate.receiptDocuments[0].committedAt = "2026-02-30T18:42:11Z";
  assert.throws(() => buildEngineeringJournal(impossibleDate), (error) => error.code === "source_committedAt_invalid");
});

test("receipt ingestion is deterministic, path-allowlisted, and public-safe without echoing rejected values", () => {
  assert.deepEqual(buildEngineeringJournal(inputWithReceipt()), buildEngineeringJournal(inputWithReceipt()));

  const unsafePath = inputWithReceipt();
  unsafePath.receiptDocuments[0].path = "/Users/example/private/pr-312.md";
  assert.throws(
    () => buildEngineeringJournal(unsafePath),
    (error) => error.code === "receipt_source_path_untrusted" && !error.message.includes("example"),
  );

  const nestedPath = inputWithReceipt();
  nestedPath.receiptDocuments[0].path = "docs/engineering/changes/archive/pr-312.md";
  assert.throws(() => buildEngineeringJournal(nestedPath), (error) => error.code === "receipt_filename_mismatch");

  const unsafeBody = inputWithReceipt(`${RECEIPT}\n\naccess_token=privatevalue12345`);
  assert.throws(
    () => buildEngineeringJournal(unsafeBody),
    (error) => error.code === "privacy_violation" && !error.message.includes("privatevalue12345"),
  );
});

test("receipt timeline JSON, search, Statistics, and standalone HTML remain one separate projection", () => {
  const result = buildEngineeringJournal(inputWithReceipt());
  const embedded = result.standaloneHtml.match(/<script id="engineering-journal-index" type="application\/json">([\s\S]+)<\/script>/);

  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded[1]), result.index);
  assert.match(result.standaloneHtml, /Pull request timeline/);
  assert.match(result.standaloneHtml, /Exact receipt source/);
  assert.match(result.standaloneHtml, /Commit-pinned publication flow/);
  assert.match(result.standaloneHtml, /journal-module-architecture\.drawio/);
  assert.deepEqual(result.index.receiptStatistics.byClassification, {
    none: 1,
    "change-note": 0,
    adr: 0,
    "architecture-review": 0,
    "feature-retrospective": 0,
    postmortem: 0,
    "capability-dossier": 0,
  });
  assert.equal(result.index.receiptStatistics.withMissingFacts, 1);
  assert.equal(result.index.receiptStatistics.earliestTimelineAt, "2026-08-12T18:42:11Z");
  assert.equal(result.index.statistics.totalRecords, 1);
});

test("public-safe records reject private paths and secret-like values without echoing them", () => {
  const privateValues = [
    "/Users/example/Projects/private/trace.log",
    "/home/example/private/trace.log",
    String.raw`C:\Users\example\private\trace.log`,
    "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
  ];

  for (const privateValue of privateValues) {
    const document = input();
    document.documents[0].markdown = `${TRACER}\n\n${privateValue}`;
    assert.throws(
      () => buildEngineeringJournal(document),
      (error) => {
        assert.equal(error.code, "privacy_violation");
        assert.doesNotMatch(error.message, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
  }
});

test("amendments and superseding records preserve the accepted source revision while deriving correction history", () => {
  const buildInput = input();
  const amendment = TRACER
    .replaceAll("architecture-review-engineering-journal-module", "change-note-engineering-journal-amendment")
    .replaceAll("architecture-review", "change-note")
    .replaceAll("Deep Engineering Journal Module", "Clarify Engineering Journal provenance")
    .replace("status: accepted", "status: released")
    .replace("createdAt: 2026-08-12", "createdAt: 2026-08-13")
    .replace("amends: []", 'amends: ["architecture-review-engineering-journal-module@1"]');
  const superseding = TRACER
    .replaceAll("architecture-review-engineering-journal-module", "adr-engineering-journal-source-pinning")
    .replaceAll("architecture-review", "adr")
    .replaceAll("Deep Engineering Journal Module", "Pin every Journal source revision")
    .replace("createdAt: 2026-08-12", "createdAt: 2026-08-14")
    .replace("supersedes: []", 'supersedes: ["architecture-review-engineering-journal-module@1"]');
  buildInput.documents.push(
    {
      repository: "interview-arc",
      commit: "b".repeat(40),
      path: "docs/engineering/records/change-note-engineering-journal-amendment.md",
      markdown: amendment,
    },
    {
      repository: "interview-arc",
      commit: "c".repeat(40),
      path: "docs/engineering/records/adr-engineering-journal-source-pinning.md",
      markdown: superseding,
    },
  );

  const result = buildEngineeringJournal(buildInput);
  const original = result.index.records.find((record) => record.id === "architecture-review-engineering-journal-module");

  assert.equal(original.status, "accepted");
  assert.equal(original.effectiveStatus, "superseded");
  assert.deepEqual(original.amendedBy, ["change-note-engineering-journal-amendment@1"]);
  assert.deepEqual(original.supersededBy, ["adr-engineering-journal-source-pinning@1"]);
});

test("the versioned record Interface rejects unknown frontmatter fields", () => {
  const buildInput = input();
  buildInput.documents[0].markdown = TRACER.replace("schemaVersion: 1", "schemaVersion: 1\nprivateNote: should-not-exist");

  assert.throws(
    () => buildEngineeringJournal(buildInput),
    (error) => error.code === "frontmatter_unknown_field",
  );
});

test("all six record types accept only their explicit lifecycle statuses", () => {
  const cases = [
    ["change-note", "released"],
    ["adr", "accepted"],
    ["architecture-review", "closed"],
    ["feature-retrospective", "released"],
    ["postmortem", "closed"],
    ["capability-dossier", "accepted"],
  ];

  for (const [type, status] of cases) {
    const buildInput = input();
    buildInput.documents[0].markdown = TRACER
      .replace("type: architecture-review", `type: ${type}`)
      .replace("status: accepted", `status: ${status}`);
    assert.equal(buildEngineeringJournal(buildInput).index.records[0].type, type);
  }

  const invalid = input();
  invalid.documents[0].markdown = TRACER.replace("type: architecture-review", "type: postmortem");
  assert.throws(() => buildEngineeringJournal(invalid), (error) => error.code === "type_status_invalid");
});

test("owner-private records cannot enter the eligible public projection", () => {
  const buildInput = input();
  buildInput.documents[0].markdown = TRACER.replace("visibility: public-safe", "visibility: owner-private");
  assert.throws(() => buildEngineeringJournal(buildInput), (error) => error.code === "owner_private_publication");
});

test("untrusted repository, path, and config values fail with fixed non-echoing locators", () => {
  const unsafeRepository = input();
  unsafeRepository.documents[0].repository = "/home/person/private-repository";
  assert.throws(
    () => buildEngineeringJournal(unsafeRepository),
    (error) => error.code === "repository_untrusted" && error.source === "document-1" && !error.message.includes("private-repository"),
  );

  const unsafePath = input();
  unsafePath.documents[0].path = "/Users/person/private.md";
  assert.throws(
    () => buildEngineeringJournal(unsafePath),
    (error) => error.code === "source_path_untrusted" && error.source === "document-1" && !error.message.includes("person"),
  );

  const unsafeConfig = input();
  unsafeConfig.trustedRepositories[0].canonicalPath = "~/private-records";
  assert.throws(
    () => buildEngineeringJournal(unsafeConfig),
    (error) => error.code === "repository_config_invalid" && error.source === "trusted-repository-1",
  );
});

test("commit-pinned repositories reject mismatched document revisions", () => {
  const buildInput = input();
  buildInput.trustedRepositories[0].commit = "b".repeat(40);
  assert.throws(() => buildEngineeringJournal(buildInput), (error) => error.code === "commit_pin_mismatch");
});

test("relations must pin an exact existing record revision", () => {
  for (const relation of ["missing-record", "missing-record@1", "architecture-review-engineering-journal-module@2"]) {
    const buildInput = input();
    buildInput.documents[0].markdown = TRACER.replace("relatedRecords: []", `relatedRecords: ["${relation}"]`);
    assert.throws(
      () => buildEngineeringJournal(buildInput),
      (error) => error.code === (relation.includes("@") ? "relation_target_missing" : "relation_ref_invalid"),
    );
  }
});

test("normalized JSON, standalone HTML, search, backlinks, and Statistics share one factual projection", () => {
  const result = buildEngineeringJournal(input());
  const match = result.standaloneHtml.match(/<script id="engineering-journal-index" type="application\/json">([\s\S]+)<\/script>/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), result.index);
  assert.equal(result.normalizedJson, `${JSON.stringify(result.index, null, 2)}\n`);
  assert.equal(result.index.statistics.totalRecords, 1);
  assert.equal(result.index.statistics.byType["architecture-review"], 1);
  assert.equal(result.index.statistics.byStatus.accepted, 1);
  assert.equal(result.index.statistics.verification.verified, 1);
  assert.equal(result.index.statistics.recordsWithReleaseRefs, 0);
  assert.equal(result.index.statistics.recordsWithRunRefs, 0);
  assert.match(result.index.search[0].text, /issue 278/);
  assert.match(result.index.search[0].text, /immutable revisions/);
  assert.deepEqual(result.index.backlinks["architecture-review-engineering-journal-module@1"], []);
});

test("verification is explicit and never inferred from release or run references", () => {
  const buildInput = input();
  buildInput.documents[0].markdown = TRACER
    .replace(/^diagrams: .*\n/m, "")
    .replace('verification: {"state":"verified","evidenceRefs":["issue:278"]}', 'verification: {"state":"not-recorded","evidenceRefs":[]}')
    .replace("release: null", "release: v1.0.0")
    .replace("run: null", 'run: "31586541242"');
  const statistics = buildEngineeringJournal(buildInput).index.statistics;
  assert.deepEqual(statistics.verification, { verified: 0, notRecorded: 1 });
  assert.equal(statistics.recordsWithReleaseRefs, 1);
  assert.equal(statistics.recordsWithRunRefs, 1);
});

test("Learn references remain fail-closed until the released Learn contract exists", () => {
  const buildInput = input();
  buildInput.documents[0].markdown = TRACER.replace("learningRefs: []", 'learningRefs: ["lesson@1"]');
  assert.throws(() => buildEngineeringJournal(buildInput), (error) => error.code === "learn_contract_unreleased");
});

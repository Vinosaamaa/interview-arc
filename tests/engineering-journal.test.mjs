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

test("the Journal Module deterministically projects one commit-pinned canonical record", () => {
  const first = buildEngineeringJournal(input());
  const second = buildEngineeringJournal(input());

  assert.deepEqual(second, first);
  assert.equal(first.index.records[0].source.commit, SOURCE_COMMIT);
  assert.equal(first.index.records[0].body.startsWith("# "), false);
  assert.equal(first.index.records[0].summary, "Engineering records need one public Interface with exact provenance.");
  assert.equal(first.index.records[0].interviewView.id, "interview-view");
  assert.equal(
    first.index.records[0].source.permalink,
    `https://github.com/Vinosaamaa/interview-arc/blob/${SOURCE_COMMIT}/docs/engineering/records/architecture-review-engineering-journal-module.md`,
  );
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

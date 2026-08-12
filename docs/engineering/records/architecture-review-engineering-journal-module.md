---
schemaVersion: 1
id: architecture-review-engineering-journal-module
revision: 1
type: architecture-review
status: accepted
title: Deep Engineering Journal Module
repository: interview-arc
capabilityIds: ["engineering-journal", "engineering-workspace"]
createdAt: 2026-08-12
reconstructed: false
confidence: verified
unknowns: ["The Learn workspace action remains unavailable until its runtime contract is released."]
modules: ["engineering-journal"]
interfaces: ["canonical-record-ingestion", "normalized-journal-index"]
seams: ["repository-records-to-journal-module", "journal-module-to-website", "journal-module-to-standalone-html"]
adapters: ["git-object-reader", "website-reader", "standalone-html-reader"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #278","url":"https://github.com/Vinosaamaa/interview-arc/issues/278","kind":"issue"},{"label":"Parent product issue #249","url":"https://github.com/Vinosaamaa/interview-arc/issues/249","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/engineering-journal.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 278
pr: null
release: null
run: null
---
# Deep Engineering Journal Module

Engineering history needs one small, versioned Interface that preserves exact evidence while allowing multiple readers to evolve independently.

## Context

Interview Arc spans the website, the native Voice companion, and the Live practice surface. Each repository may author public-safe engineering evidence, but none of the readers should reimplement provenance, correction, privacy, or indexing rules.

Mutable database state is intentionally outside this capability. Canonical records remain Markdown in Git, and every accepted input is read from an immutable Git object.

## Module boundary

The Engineering Journal Module accepts trusted repository descriptors and commit-pinned canonical records. It validates the record Interface, rejects unsafe content, derives correction history and backlinks, and emits one deterministic normalized index.

Website and standalone HTML are adapters over that index. They do not independently infer status, verification, release state, relationships, or Statistics.

## Record Interface

Each record is identified by an immutable `id@revision` reference. The six supported types are Change Note, ADR, Architecture Review, Feature Retrospective, Postmortem, and Capability Dossier. Type-specific lifecycle rules prevent a reader from presenting an impossible state.

Corrections append a new record that names exact prior revisions through `amends` or `supersedes`. Accepted source revisions remain unchanged. Effective status and reverse links are projections, never edits to history.

## Privacy and provenance

Only allowlisted repositories and canonical paths are accepted. The module fails closed on absolute machine paths, private task identifiers, credentials, private remotes, non-example email addresses, and owner-private records marked eligible for publication. Diagnostics use fixed locators so a rejected value is not echoed into a workflow log.

Every normalized record exposes its repository, source path, exact commit, and immutable source permalink. Cross-repository sources must declare a commit pin; a checkout mismatch fails the build.

## Statistics

Statistics are a deterministic Journal projection: factual counts by type, effective status, repository, and capability plus chronology and explicit verification state. A release or run reference is counted as a reference only; it is never presented as verified evidence unless the record declares a verification receipt.

## Consequences

The build is intentionally strict. Unknown fields, stale relation pins, unsafe content, missing verification evidence, or adapter drift stop publication. That strictness keeps the reader simple and makes failures actionable at the authoring boundary.

The Learn action remains visibly unavailable until the released Learn runtime contract defines a stable revision, commit, and symbol reference. The Engineering workspace does not duplicate Learn state.

## Interview view

The key design choice is the deep module boundary: one cohesive component owns the hard invariants, while thin adapters consume a public normalized Interface. This prevents privacy scans, correction semantics, and provenance rules from diverging across surfaces.

The design favors append-only history over in-place edits. A correction produces a new immutable revision and derived effective status, preserving what reviewers originally accepted while making current truth explicit.

---
schemaVersion: 1
id: change-note-immutable-behavioral-evidence-provenance
revision: 1
type: change-note
status: released
title: Pin immutable Behavioral evidence provenance before synchronization
repository: interview-arc
capabilityIds: ["behavioral-evidence-foundation", "durable-specialist-persistence"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["behavioral-evidence-controller", "behavioral-evidence-domain"]
interfaces: ["behavioral-evidence-bundle", "behavioral-evidence-candidate-query"]
seams: ["local-source-refresh-to-d1-evidence", "mcp-candidate-pagination"]
adapters: ["behavioral-evidence-controller", "d1", "mcp-worker"]
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["immutable-evidence-provenance", "bounded-candidate-pagination", "explicit-evidence-supersession"]
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #266","url":"https://github.com/Vinosaamaa/interview-arc/issues/266","kind":"issue"},{"label":"Pull request #334","url":"https://github.com/Vinosaamaa/interview-arc/pull/334","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:266","pull-request:334","tests/behavioral-evidence-bundle.test.mjs","tests/behavioral-evidence-review.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 266
pr: 334
release: null
run: null
---
# Pin immutable Behavioral evidence provenance before synchronization

The local Behavioral Evidence controller previously recalculated an existing observation's D1 `sourceRevision` from the source registry at every synchronization. A routine source refresh could therefore change immutable remote content under the same evidence ID even when the observation itself was unchanged. D1 correctly rejected that write, but the conflict arrived after preparation and could not distinguish an unchanged observation from a material re-audit.

## Provenance boundary

Each canonical evidence observation now pins the opaque source-set revision it was inspected against and a fingerprint of every field that contributes to its remote immutable identity. Source refreshes continue to revise source-registry metadata, while an existing evidence payload and operation identity remain byte-identical. Editing a pinned observation's statement, grades, source references, support, limitations, or tags fails locally and requires a replacement evidence ID followed by the existing explicit owner-reviewed supersession operation.

Legacy migration accepts an ignored owner-private snapshot containing only remote evidence IDs and their authoritative source revisions. Existing D1 identities reuse those revisions; identities not yet synchronized may pin the current authorized source set. The migration rejects incomplete, conflicting, and out-of-bundle snapshots before writing canonical files, remains idempotent on exact replay, and never carries statements, source text, locators, or review-site content in the snapshot.

## Bounded readback

Candidate reads retain the 50-record limit and now return a descending composite cursor. Reusing both cursor fields with the same owner-scoped state and project filters retrieves the next page without duplication when rows share an update timestamp. Supplying only half of the cursor fails validation. This makes a complete authoritative migration possible without unbounded reads or direct private-database access.

The D1 schema includes additive composite indexes for both owner/state cursor reads and owner/state/project cursor reads. Provenance format and owner-statement restrictions are defined once for the local controller and review-site validator, while source availability and refresh-state checks share one controller path. Project-file updates use bounded concurrency before the manifest timestamp is committed.

## Verification

Focused bundle tests reproduce the source-refresh conflict, prove stable prepared payload and operation identity after refresh, reject in-place material edits, verify authoritative legacy migration, and verify idempotent replay. The local D1/MCP integration verifies cursor pagination, incomplete-cursor rejection, owner isolation, exact retries, and explicit supersession behavior.

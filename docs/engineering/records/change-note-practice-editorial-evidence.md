---
schemaVersion: 1
id: change-note-practice-editorial-evidence
revision: 1
type: change-note
status: released
title: Add editorial research after imported practice and retain behavioral corrections
repository: interview-arc
capabilityIds: ["practice-records", "problem-banks"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Consumer Voice access to hidden tool results is not established"]
modules: ["practice-records", "problem-banks"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["architecture-review-chatgpt-oauth-practice@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/chatgpt-practice-import.test.mjs","tests/chatgpt-connector.integration.test.mjs","tests/behavioral-evidence-review.integration.test.mjs","tests/mcp-allowlist.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Add editorial research after imported practice and retain behavioral corrections

A completed ChatGPT practice can be saved before official editorial research is
available. Both MCP clients can now append an attributed editorial explanation
later and read its exact revision. The private reader shows the latest addition
as a separate section, including when viewing an older practice revision.
Original transcripts, timing, result flags and import revisions are preserved.
This does not generate missing research, change native finalization rules, or
promote a reusable Solution Profile. It applies to completed imported LeetCode
records; native practice continues to use its existing finalization contract.

## Persistence and provenance

An additive D1 table stores immutable, owner-scoped editorial revisions. Writes
require the matching completed activity, question and official problem URL.
Atomic expected-revision guards reject conflicting writers. Operation identity
and canonical fingerprints allow unchanged retries to recover a committed write
after a lost response. An exact readback is required before reporting success.
The supplied source URL, observed time, content fingerprint and approach titles
describe the caller's research; the service does not independently retrieve or
verify an editorial. Community solutions and generated explanations must not be
represented as official editorial evidence.

## Behavioral knowledge

ChatGPT now exposes the existing evidence save, candidate query, acceptance and
claim-status handlers already available to Codex. These keep owner isolation,
source attribution, revision checks and supersession rules. Acceptance does not
upgrade a user report into independently verified evidence. Corrections create a
new evidence identity and supersede the old one with an attributable decision.

The guide reuses existing project overview Solution Profiles as briefs. Routine
questions reuse loaded summaries and retrieve needed supporting details. Whole
project evidence is reserved for deep preparation or an explicit refresh, with
pagination and revision checks. A separate project discussion page is deferred.

## Verification and rollout

Focused tests exercise real SQLite migrations, unchanged practice revisions,
owner/problem mismatch, stale revisions, retries and uncertain-write recovery.
The bundled authenticated ChatGPT route exercises evidence persistence and
acceptance plus imported-practice editorial save/readback. Existing evidence
integration tests cover correction and owner boundaries. Local migration and
content import validation pass. Hosted validation and deployment remain separate
release gates; this record's released classification describes the change note.

Deploy migration 0052 before the website and MCP Worker, then refresh the ChatGPT
connector's tool list. Rollback restores the previous Workers while retaining
the additive table and any saved editorial additions. Do not delete private
records as part of rollback.

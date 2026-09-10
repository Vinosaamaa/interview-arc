---
schemaVersion: 1
id: change-note-native-deferred-references
revision: 1
type: change-note
status: released
title: Save completed practice before references are ready
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Production acceptance is recorded on the owning issue"]
modules: ["practice-records"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["change-note-excalidraw-export-repair@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/practice-record-finalization.integration.test.mjs","tests/practice-native-additions.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Save completed practice before references are ready

An actual ChatGPT practice test saved answers, reviews and finished timers but
could not publish coding or system-design records without a complete reusable
reference. An original coding question had no official editorial; a text-only
design attempt had no reference drawing. Behavioral completion succeeded after
correcting its required evidence and transcript-parity fields.

Coding and design finalization can now explicitly defer an unavailable reference
with a reason. Existing owner or canonical profiles must still be reused or
revised. Finished timing, explicit outcomes, exact transcripts, completed code
reviews and immutable-record readback remain required. Behavioral finalization
keeps its existing complete-profile and evidence checks.

The completion snapshot stores a nullable solution pointer and a visible pending
reason. A migration preserves existing rows while allowing that explicit state.
Editorials and Excalidraw snapshots can be added to exactly promoted native
records as well as imported records. Additions remain owner-scoped and separately
revisioned; they do not rewrite the completion snapshot or claim that a reusable
Solution Profile exists. Editorial URLs must match the original problem.

Regression coverage exercises real Worker finalization, missing-field rejection,
idempotency, ownership, draft rejection, addition revision conflicts, encrypted
drawing bytes and preservation of existing rows during migration. The agent guide
also distinguishes independent timer/result/mode revisions and documents exact
behavioral review parity to reduce avoidable authoring retries.

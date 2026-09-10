---
schemaVersion: 1
id: change-note-batch-practice-solutions
revision: 1
type: change-note
status: released
title: Publish reusable solutions after saved practice
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Actual connected ChatGPT and deployed reader acceptance remain release gates"]
modules: ["practice-records"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["change-note-native-deferred-references@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/practice-solution-publication.test.mjs","tests/chatgpt-import-store.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Publish reusable solutions after saved practice

Saved practice and its reusable Solution have different lifecycles. A user may
finish several conversations before asking connected text to publish the full
answers. Previously, an imported record could receive an editorial addition
or a provisional reference, but could not independently publish the finalized
Solution without attempting to repeat native completion.

The new operation publishes full specialty-quality profiles against exact
completed native or imported records. A separately revisioned addition pins
the original Practice Record fingerprint and the published Solution revision.
It leaves historical transcripts, final answers, results, timers and completion
links intact. Past shows the addition with the existing typography and Solution
reader action; the bank continues to own the latest reusable profile.

A stable batch manifest enters the existing specialist-write outbox. The
parent only enqueues deterministic children. Each child independently validates
and atomically saves its profile, immutable revision and publication receipt.
An invalid item cannot roll back saved siblings. Existing scheduled recovery
handles interrupted work, while stable operation receipts prevent repeated
commits after an acknowledgement is lost.

Compare-and-swap checks bind the exact original record, current profile and
project binding through the transaction. Reusing a profile requires that owner
profile to exist. Equivalent normalized content preserves its prior bytes and
revision. Stale work is rejected rather than overwriting a newer answer.

Shared validation remains the quality boundary. Official coding references may
come from the browser controller or authenticated hosted reader, with the actual
source recorded. Neither transport implies a judge run. The connected agent
must author the full answer and obtain required references before enqueue;
the worker has no hidden model author. Day-end practice capture still uses the
existing multi-attempt import or native completion before solution publication.

The rollout adds one table and two additive tool operations. Rolling back the
application leaves its append-only receipts intact; reverting a deployed
migration is unnecessary and would discard evidence. Queued operations must
be drained or accounted for before removing support for the new job types.

Focused SQLite tests verify imported and native publication, owner isolation,
stale and concurrent guards, semantic reuse, immutable history, independent
receipts and behavioral binding preservation. Transport and deployed browser
acceptance are separate gates, not inferred from those domain tests.

---
schemaVersion: 1
id: postmortem-stale-workbench-cache
revision: 1
type: postmortem
status: closed
title: Stop stale display caches from recreating archived workbench rows
repository: interview-arc
capabilityIds: ["website-navigation"]
createdAt: "2026-09-11T04:12:00Z"
reconstructed: false
confidence: verified
unknowns: []
modules: ["today-workbench"]
interfaces: ["practice-state-mutations"]
seams: ["Display cache versus pending mutation queue", "Current workbench versus archived row ownership"]
adapters: ["app/live-sync.ts", "db/live-state.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #467","url":"https://github.com/Vinosaamaa/interview-arc/issues/467","kind":"issue"}]
visibility: public-safe
publicationEligibility: eligible
issue: 467
pr: null
release: null
run: null
verification: {"state":"verified","evidenceRefs":["tests/workbench-reconciliation.test.mjs", "tests/review-queue.integration.test.mjs"]}
---
# Stop stale display caches from recreating archived workbench rows

An owner-authorized reset left the server empty, but an old browser cache
reintroduced archived activities. The initial cleanup readback checked server
state without checking a stale second client. Completed history was preserved.

The browser inferred upserts from every cached row absent from the current
server snapshot. Upserts then reassigned existing IDs to the current workbench.
Cleared authoritative focus also fell back to a cached activity, producing
irrelevant role-context reads. These mechanisms were confirmed in source and
the persistence boundary was reproduced with local D1.

Reconciliation now preserves only explicit queued edits scoped to the current
workbench. The server checks existing row ownership within the same transaction
as the upsert, so old clients cannot move archived activities, sessions or
career focus blocks. New browser upserts carry their workbench ID.

Regression coverage includes a stale cache after reset, missing same-workbench
rows, legacy queued payloads, null focus, legitimate offline creation, and
transactional rejection of all three archived row types. Reset verification
must include a second populated client and a positive offline-recovery check.
The detailed incident is in
`docs/postmortems/2026-09-10-stale-workbench-cache.md`; release and final
owner-state verification are separate issue receipts.

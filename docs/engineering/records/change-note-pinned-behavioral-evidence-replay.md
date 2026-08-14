---
schemaVersion: 1
id: change-note-pinned-behavioral-evidence-replay
revision: 1
type: change-note
status: released
title: Replay pinned Behavioral evidence independently of current connector state
repository: interview-arc
capabilityIds: ["behavioral-evidence-foundation", "durable-specialist-persistence"]
createdAt: 2026-08-14T22:53:34Z
reconstructed: false
confidence: verified
unknowns: []
modules: ["behavioral-evidence-controller", "behavioral-evidence-domain"]
interfaces: ["behavioral-evidence-bundle", "behavioral-evidence-source-snapshot"]
seams: ["local-source-refresh-to-d1-evidence"]
adapters: ["behavioral-evidence-controller", "d1", "mcp-worker"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["immutable-evidence-replay", "fail-closed-source-projection"]
amends: ["change-note-immutable-behavioral-evidence-provenance@1"]
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #266","url":"https://github.com/Vinosaamaa/interview-arc/issues/266","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:266","tests/behavioral-evidence-bundle.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 266
pr: null
release: null
run: null
---
# Replay pinned Behavioral evidence independently of current connector state

The immutable-provenance migration correctly pinned each existing evidence
identity to its authoritative D1 source-set revision. Its required post-release
reconciliation then exposed a second boundary error: sync preparation still
validated every historical observation against the source's current
availability. A source becoming unavailable could therefore block an exact
replay even though the pinned evidence content and historical source revision
had not changed.

## Separate historical evidence from current source state

Sync preparation now validates that each pinned observation still references a
known source identity, then verifies its immutable content fingerprint against
the pinned historical revision. It does not recalculate that revision or require
the source to remain inspectable. Current source availability remains mandatory
when deriving a new source-set revision for an unpinned observation.

The source registry remains a current-state projection. A connector-owned source
whose local availability still says `available` while its connector refresh
state says `not_checked` is projected as `not_checked`. The display-safe snapshot
omits stale content revision, fingerprint, and inspection metadata. Other
inconsistent available states still fail closed.

## Verification

Focused bundle tests prove that a pinned payload remains byte-identical after
its source becomes unavailable, that a stale connector state is projected as
`not_checked` without stale metadata, and that new pins still require a currently
available source. The repaired controller regenerated the ignored canonical
plan with all 58 source snapshots and all 168 typed evidence writes; it performed
no D1 evidence mutation.

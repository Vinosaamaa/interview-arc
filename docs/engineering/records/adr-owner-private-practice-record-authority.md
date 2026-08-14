---
schemaVersion: 1
id: adr-owner-private-practice-record-authority
revision: 1
type: adr
status: accepted
title: Owner-Private Practice Record Authority
repository: interview-arc
capabilityIds: ["practice-records", "practice-readers", "solution-profiles", "system-design-diagrams"]
createdAt: 2026-08-13
reconstructed: false
confidence: verified
unknowns: ["The exact private R2 drawing namespace and retention policy remain implementation details.", "Automatic website Finish orchestration depends on the application-owned durable hook tracked by issue 93.", "Legacy Git files remain until authenticated D1 and R2 parity is verified."]
modules: ["practice-records", "practice-assets", "practice-readers"]
interfaces: ["practice-finalization-packet", "immutable-practice-record", "immutable-practice-asset", "current-solution-pointer"]
seams: ["specialist-to-persistence-child", "d1-to-private-r2", "practice-record-to-past-reader", "solution-profile-to-solution-reader"]
adapters: ["mcp-worker", "website-reader", "excalidraw-live", "drawio-export"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #319","url":"https://github.com/Vinosaamaa/interview-arc/issues/319","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:319","tests/owner-private-content-boundary.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 319
pr: null
release: null
run: null
---
# Owner-Private Practice Record Authority

## Context

Interview Arc previously required a coordinator to copy completed personal
practice from owner-scoped D1 into Git narrative artifacts before Past became
complete. That made durable completion depend on a later release workflow and
put private attempts, profiles, and diagrams on a public source path.

System Design also lacked one owner/activity-scoped drawing lifecycle. Browser
scene synchronization alone could not prove crash recovery, immutable
completion evidence, or original-versus-model attribution.

## Decision

Owner-scoped D1 is authoritative for immutable Practice Record and Solution
Profile revisions. Private R2 stores recording and drawing bytes; D1 stores
their checksum-bound metadata and exact record links. Git retains public-safe
product and Engineering sources but accepts no new personal practice content.

Finish queues one complete semantic packet from the visible specialist. A
mechanical persistence child performs idempotent D1/R2 writes and readback. The
product reports pending state until all immutable revisions and links are
verified. A separately bounded authoring child may prepare exhaustive profile
content from a parent-verified source packet but cannot write durable state.

Past and Solution remain separate readers. Past preserves the exact completed
activity and its completion-time profile link; its primary action resolves the
latest reusable profile. A profile revision never creates a Past row.

System Design practice uses a single Playwright Chromium tab connected to the
pinned loopback Excalidraw v2 runtime. Draft checkpoints are durable owner
state. Finish stores the exact owner scene and preview. A polished draw.io/SVG
model is separate specialist-authored Solution material.

## Consequences

The migration is forward-only. Existing Git practice artifacts are frozen by
path and SHA-256 until production D1/R2 read parity permits ordinary deletion
from current `main`; history is not rewritten. Past, Journey, and Pacific date
grouping must cut over before that cleanup.

Routine private completion no longer needs a journal branch, pull request,
deployment, or publication receipt. The coordinator remains responsible for
reconciliation, recovery, optional local exports, and separately authorized
public releases.

This boundary adds explicit pending and failure states, immutable asset
revisions, owner-isolation tests, and partial-failure recovery. It forbids
claiming completion from queued work or WebSocket state alone.

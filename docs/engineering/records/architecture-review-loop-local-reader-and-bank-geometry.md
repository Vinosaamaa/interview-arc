---
schemaVersion: 1
id: architecture-review-loop-local-reader-and-bank-geometry
revision: 1
type: architecture-review
status: proposed
title: Keep Loop preparation local and bound Interview geometry
repository: interview-arc
capabilityIds: ["practice-readers", "problem-banks", "website-navigation"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["interview-loops", "practice-readers", "problem-banks"]
interfaces: ["loop-preparation-reader", "job-description-reader", "problem-bank-list"]
seams: ["loop-preparation-to-practice-record", "role-brief-to-private-source", "viewport-to-bank-list"]
adapters: ["loops-workspace", "shared-reader-shell", "banks-workspace"]
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["loop-owned-reader-history", "bounded-private-source-reader", "adaptive-bank-list"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #301","url":"https://github.com/Vinosaamaa/interview-arc/issues/301","kind":"issue"},{"label":"Pull request #332","url":"https://github.com/Vinosaamaa/interview-arc/pull/332","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:301","tests/website-ui-regressions.test.mjs","tests/document-scroll-policy.test.mjs","tests/journey-insights.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 301
pr: 332
release: null
run: null
---
# Keep Loop preparation local and bound Interview geometry

Linked preparation in a Hiring Loop previously reused the Past route. Opening an exact completed attempt therefore changed the active destination and made Close restore Past rather than the Loop that owned the preparation context. The private Job Description and closed Problem Banks also used content-driven geometry that could clip the source header or leave the catalog short of the viewport.

## Decision

Loops now owns a nested reader URL and history state. Selecting completed preparation opens the shared Practice Record reader as a listless modal over the current Loop, makes the covered Loop inert, and restores the exact Loop and opener on Close, Escape, or browser history. Opening a nested reusable solution remains inside that same Loop-owned history chain.

The route requires an explicit owner-scoped Loop identity. Stage identity remains optional because linked preparation may be Loop-wide; when present it is preserved exactly. A missing or unavailable Loop never falls back to the first returned Loop, so stale direct links fail closed instead of displaying an attempt over an unrelated workspace.

The Job Description uses one opaque, viewport-bounded dialog with a fixed document header and independently scrolling body. Closed Problem Banks reserves the remaining desktop viewport for its internally scrolling result list and keeps a twenty-pixel edge gap.

Reusing the Past route was rejected because it made a preparation action change workspace ownership. Duplicating the Practice Record reader inside Loops was also rejected because it would fork one authoritative presentation contract. The selected boundary reuses the shared reader component while giving Loops its own URL and history adapter.

## Verification

Focused navigation, scroll-policy, geometry, and visual-system regressions passed alongside the complete serialized test suite. An isolated Chrome-for-Testing profile exercised the compiled local Worker: a completed preparation attempt stayed on `view=loops`, opened without a problem list, made the Loop base inert, and closed back to the same Loop; the Job Description header and body remained non-overlapping inside the viewport; and the closed Banks list ended twenty pixels above the desktop viewport without horizontal overflow.

## Consequences

Loop preparation is now context-preserving without duplicating the Practice Record reader. Existing immutable attempts, Role Brief revisions, and Problem Bank data are unchanged. The repair adds no migration, durable-state mutation, or MCP contract; its behavioral boundary is URL/history ownership and responsive presentation.

---
schemaVersion: 1
id: feature-retrospective-website-loop-creation
revision: 1
type: feature-retrospective
status: accepted
title: Create Interview Loops deterministically from the website
repository: interview-arc
capabilityIds: ["arc-interview-loops"]
createdAt: 2026-08-21
reconstructed: false
confidence: verified
unknowns: ["Production release evidence is pending the merged-main workflow and will be recorded in the issue resolution ledger."]
modules: ["HTTP:loops", "D1:loop-command", "web:loops-workspace"]
interfaces: ["app/api/loops/route.ts", "db/loop-policy.ts", "docs/contracts/interview-loops.md"]
seams: ["authenticated website to owner-scoped Loop command", "Loop command to atomic D1 Loop and Role Brief creation"]
adapters: ["app/loop-create-dialog.tsx", "db/loop-website.ts", "db/loops.ts"]
relatedRecords: ["architecture-review-interview-capability-separation@1"]
decisions: []
incidents: []
features: ["feature-retrospective-interview-loops@1"]
capabilities: ["website-native-loop-operations"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Website Loop creation issue #417","url":"https://github.com/Vinosaamaa/interview-arc/issues/417","kind":"issue"},{"label":"Pull request #420","url":"https://github.com/Vinosaamaa/interview-arc/pull/420","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:417","pull-request:420","tests/loop-website.test.mjs","docs/design/website-loop-creation/add-loop-desktop.png","docs/design/website-loop-creation/add-loop-mobile.png"]}
visibility: public-safe
publicationEligibility: eligible
issue: 417
pr: 420
release: null
run: null
---
# Create Interview Loops deterministically from the website

The Loops workspace now provides a complete, provider-independent Add Loop flow. The owner can record company and role identity, optional location and opening date, a pasted job description or an HTTPS source reference, and known interview stages. Missing information is stored as an explicit unknown instead of being inferred.

## Boundary and command ownership

The website is an authorization adapter over the same versioned Loop creation command used by the separately registered Loop Recorder task. Domain validation, normalized owner-scoped duplicate protection, atomic Loop and Role Brief creation, initial stage provenance, idempotency, and stable receipts remain server-owned. The HTTP adapter requires authenticated owner identity, same-origin browser requests, a bounded body, and a matching idempotency key in both the header and request body.

A source URL is preserved as a reference only. This change does not crawl the URL, fabricate a job-description body, invoke an AI provider, or make the site-wide assistant a dependency of ordinary Loop creation.

## Experience

The responsive three-step folio follows the Loop dossier's existing visual language: Role basics, Known stages, and Review. It supports keyboard focus containment and restoration, Escape dismissal, visible focus, reduced motion, mobile layouts, explicit validation recovery, and a success receipt with a direct transition into the new Loop.

## Data integrity

Each Loop receives a normalized identity key scoped to its verified owner. The migration backfills existing rows before creating the unique index, while all current write paths populate the key. The command creates revision-one Loop, Role Brief, stages, and receipt in one D1 batch, so partial creation cannot become visible.

## Verification

The final branch is covered by policy, adapter, source-boundary, and interface tests; local D1 migration and content import; existing Loop Recorder D1/MCP regression coverage; production build; and desktop, mobile, reduced-motion, 200-percent-text, overflow, keyboard, validation, idempotency, receipt, and navigation browser checks against local D1. Synthetic data was used throughout, and screenshots contain no owner-private source material.

## Follow-up boundary

Interview Package ingestion remains issue #415, and site-wide AI assistance remains issue #418. Neither is required for this deterministic workflow.

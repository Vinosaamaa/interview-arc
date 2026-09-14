---
schemaVersion: 1
id: architecture-review-chatgpt-learning
revision: 1
type: architecture-review
status: accepted
title: Share the complete Learning Specialist workflow with ChatGPT
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-13
reconstructed: false
confidence: verified
unknowns: ["Tool and transcript availability in native ChatGPT Live surfaces"]
modules: ["learning-workspace"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["connected-learning-specialist"]
adapters: ["scoped-mcp-server"]
relatedRecords: ["architecture-review-learning-materials@1"]
decisions: []
incidents: []
features: []
capabilities: ["learning-workspace"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #488","url":"https://github.com/Vinosaamaa/interview-arc/issues/488","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/helpers/learning-chatgpt-flow.mjs","tests/chatgpt-connector.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 488
pr: null
release: null
run: null
---
# Share the complete Learning Specialist workflow with ChatGPT

ChatGPT could save a standalone Lesson and create a planned Session, but its
reviewed tool allowlist omitted course proposals, enrollment, timer control,
transcripts, artifacts, homework, finalization and progress queries. The website
already had the corresponding domain and reading surfaces.

## Decision

Expose the existing owner-scoped Learning handlers through the authenticated
ChatGPT connection. Keep one Course, Blueprint, Enrollment, Lesson and evidence
model across Codex and ChatGPT rather than introducing a second curriculum store
or encoding broad subjects as interview questions. No database migration is
needed. Source Materials remain a separate preserved-source library.

A read-only coaching tool serves the exact repository Learning Specialist and
contract documents, plus the ChatGPT handoff instructions, with hash-pinned
paging. This removes dependency on local skill files being available to ChatGPT.
The catalog adds a subject prompt entry point and distinguishes draft outlines
from approved enrollment. It does not turn the website into a second tutor.

## Boundaries

Existing explicit outline approval, session commands, homework commands,
revision fences, exact retry receipts, private artifact verification and
evidence requirements remain unchanged. Expanding the explicit tool allowlist
does not expose registration, shell, infrastructure or other unreviewed tools.
Learning transcript writes never use Interview activity or audio semantics.
The guide states the actual text/Live handoff limitations rather than claiming
that a hidden tool result or every spoken turn reaches a native Voice model.

## Verification and rollout

The authenticated bundled connector test reads all guide documents, rejects a
wrong guide hash, creates and revises an outline, approves its exact revision,
saves a lesson, controls a session, preserves exact two-sided teaching turns,
attaches a homework artifact, completes homework, finishes with transcript-backed
checkpoint evidence, and reads workspace/history/analytics. Existing Learn
owner/revision/retry and UI tests cover the underlying shared implementation.
Actual ChatGPT and desktop/phone visual checks remain release acceptance in #488.

Rollback removes the newly exposed tools and catalog prompt. Existing private
courses and learning evidence remain available through the original surfaces.

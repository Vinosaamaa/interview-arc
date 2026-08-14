---
schemaVersion: 1
id: change-note-editorial-first-solution-catalog
revision: 1
type: change-note
status: released
title: Preserve complete Editorial-first solution catalogs
repository: interview-arc
capabilityIds: ["leetcode-practice", "solution-profiles"]
createdAt: 2026-08-13
reconstructed: false
confidence: verified
unknowns: []
modules: ["leetcode-specialist"]
interfaces: ["final-review", "solution-profile"]
seams: ["editorial-research-to-profile-authoring", "profile-authoring-to-persistence"]
adapters: []
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["editorial-first-approach-catalog", "background-profile-authoring"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #103","url":"https://github.com/Vinosaamaa/interview-arc/issues/103","kind":"issue"},{"label":"Pull request #309","url":"https://github.com/Vinosaamaa/interview-arc/pull/309","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:103","pull-request:309","tests/runtime-state.test.mjs","tests/leetcode-java-harness.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 103
pr: 309
release: null
run: null
---
# Preserve complete Editorial-first solution catalogs

LeetCode review now preserves every verified Editorial approach at reconstruction depth and adds distinct generated alternatives only when the preferred solution plus Editorial catalog contains fewer than three approaches.

## Change

The specialist presents a self-contained original problem restatement and teaches each verified Editorial algorithm, state transition, invariant, correctness argument, complexity, edge cases, and tradeoffs. Independently written pseudocode may clarify non-obvious mechanics; official prose and code are never copied.

The durable Solution Profile orders the preferred solution first, then every verified Editorial approach, then only enough genuinely distinct generated alternatives to reach three total approaches. Every catalog entry retains selection guidance, complete mechanics, proof, complexity, edge cases, comparison, and runnable Java code. The preferred implementation keeps complete Java and Python in one reader panel with language tabs.

## Background boundary

The visible specialist supplies verified problem facts, independently summarized Editorial mechanics, and references to a bounded authoring child. A separate persistence-only child stores the completed profile unchanged. Neither child performs fresh research or changes attempt evidence, and Past remains pending until exact D1 readback.

## Consequences

Finalization cannot intentionally collapse a complete review into a short profile, omit an Editorial approach because the minimum catalog size is already met, or manufacture cosmetic alternatives. Existing immutable revisions remain unchanged; incomplete history is corrected only through new evidence-grounded revisions.

## Verification

The LeetCode harness, runtime contract, Voice-batch, and owner-private content-boundary suites exercise the affected agent and contract invariants. Executable profile-shape enforcement and historical regeneration remain follow-up implementation under the owner-private Practice Record program.

---
schemaVersion: 1
id: change-note-editorial-first-solution-catalog
revision: 2
type: change-note
status: released
title: Enforce Editorial provenance and correct Solution reader structure
repository: interview-arc
capabilityIds: ["leetcode-practice", "practice-readers", "solution-profiles"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["leetcode-specialist", "practice-readers", "solution-profiles"]
interfaces: ["editorial-research-receipt", "solution-profile", "solution-reader"]
seams: ["playwright-editorial-research-to-profile", "solution-profile-to-reader", "guarded-repair-to-d1"]
adapters: ["leetcode-playwright-controller", "mcp-worker", "website-reader", "production-repair-workflow"]
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["editorial-provenance-enforcement", "specialty-aware-solution-grouping", "immutable-profile-repair"]
amends: ["change-note-editorial-first-solution-catalog@1"]
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #319","url":"https://github.com/Vinosaamaa/interview-arc/issues/319","kind":"issue"},{"label":"Pull request #330","url":"https://github.com/Vinosaamaa/interview-arc/pull/330","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:319","pull-request:330","tests/solution-profile-policy.test.mjs","tests/solution-profile-reader.test.mjs","tests/practice-record-finalization.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 319
pr: 330
release: null
run: null
---
# Enforce Editorial provenance and correct Solution reader structure

Executable validation now binds each LeetCode Solution Profile to one structured receipt from the checked-in Playwright Editorial controller. The receipt records the canonical Editorial URL, access time, availability, rendered-content fingerprint, and complete ordered approach titles without persisting protected source material.

## Enforcement

Available Editorial research requires a content fingerprint and an exact one-to-one match between the receipt's ordered approach titles and the profile's Editorial panels. Unavailable or premium-locked research requires a concrete reason and forbids Editorial-labeled panels. Complete finalization also binds the receipt URL to the exact stable LeetCode question identity.

The guarded historical repair validates each complete profile before writing. Every target uses its own bounded D1 transaction with exact current-revision and payload compare-and-set guards, inserts one immutable next revision, changes only the current profile pointer, preserves activity links and prior revision bytes, and verifies idempotent replay.

## Reader correction

Solution sections no longer reuse attempt-oriented grouping heuristics. Each profile has one specialty-aware group: Reference solution for LeetCode, Reference design for System Design, Reference answer for ordinary Behavioral content, or Project Deep Dive for a bound deep dive. Stored section order is preserved, and the Contents sequence matches the rendered document sequence.

## Consequences

Agent prose remains concise guidance, while executable validation rejects unsupported or incomplete Editorial claims. Historical revisions remain readable and unchanged; corrections append evidence-grounded revisions. Owner-private repair packets travel only through production environment secrets and are never committed to the public repository or uploaded as workflow artifacts.

## Verification

Focused policy, controller, reader, guarded-repair, and real finalization integration tests cover provenance mismatches, canonical question identity, unavailable research, immutable link preservation, specialty-aware grouping, and exact reader anchors. The production repair workflow performs a dry run, guarded apply, idempotent retry, and uploads only the redacted fingerprint receipt.

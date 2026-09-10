---
schemaVersion: 1
id: architecture-review-chatgpt-practice-backfill
revision: 1
type: architecture-review
status: proposed
title: Separate ChatGPT practice capture from authoritative backfill
repository: interview-arc
capabilityIds: ["practice-records", "problem-banks"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["Account-specific text-to-Live file and context handoff", "Historical importer and bank export runtime are not implemented"]
modules: ["practice-records", "problem-banks"]
interfaces: ["chatgpt-practice-exchange-v1"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["portable-practice-contract"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"},{"label":"PR #454","url":"https://github.com/Vinosaamaa/interview-arc/pull/454","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:453","docs/contracts/chatgpt-practice-exchange.schema.json","docs/architecture/chatgpt-live-capabilities.md"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: 454
release: null
run: null
---
# Separate ChatGPT practice capture from authoritative backfill

The proposed workflow uses regular ChatGPT text to prepare a guide and dated
bank snapshot, Live for practice, and text for a structured Finish packet.
Official documentation distinguishes Live's web/text context from connected
apps available in supported text experiences. Account-specific handoff remains
unverified. The research and portable contract are implemented as documents
and schema; no runtime import capability is claimed.

## Decision

Keep capture separate from authoritative persistence. Preserve source turn
identities, transcript coverage, explicit outcomes and logical timer commands.
Approximate time is valid; classify it separately from observed clock time.
Unknown time does not justify inventing boundaries or blocking transcript
capture. Question progress is an owner-private dated snapshot, not public Git
content and not a live value after offline work.

Direct authenticated access in Live was not selected because no supported
route was established. Public web retrieval remains optional with version
readback. Pasted context is the fallback for unavailable files or connectors.
End-of-day memory reconstruction was rejected as a transcript source; daily
aggregation combines supplied Finish packets instead.

## Persistence boundary

A future importer must validate and preview before Apply, bind the current
owner independently, deduplicate by stable source/attempt identity, preserve
immutable records and running timers, and return exact readback receipts.
Model-produced packets cannot authorize writes, replace Solution Profiles, or
turn estimated duration into measured live timer state.

## Verification and limits

Draft 2020-12 schema validation accepts the two synthetic examples and rejects
invalid versions, public progress leakage, owner injection, invalid timing,
false discussion outcomes and unsupported transcript assertions. JSON Schema
does not enforce cross-reference resolution, timing arithmetic or state-machine
transitions; those semantic checks are specified for runtime implementation.
No real practice data, account UI test, database mutation or deployment is part
of this change.

---
schemaVersion: 1
id: architecture-review-chatgpt-practice-backfill
revision: 1
type: architecture-review
status: proposed
title: Make regular ChatGPT practice usable before integration
repository: interview-arc
capabilityIds: ["practice-records", "problem-banks"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["Account-specific text and Live context or integration access", "Historical importer and snapshot service are not implemented"]
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
# Make regular ChatGPT practice usable before integration

The first deliverable is a GitHub guide that regular ChatGPT can follow.
It now starts with a loading prompt and actual repository bank links, accepts
ordinary pasted question rows, and supports both typed practice and Live.
Private progress can come from selected authenticated UI rows or a separately
configured text integration. No new snapshot endpoint is a prerequisite.

## Alternatives assessed

Public web retrieval can supply readable guide/catalog content, but cannot
establish private progress. Authorized GitHub access and Pro read/fetch MCP
are documented text paths with account-specific availability. Current Live
documentation excludes connected apps/plugins. Custom GPT actions require
a separate configured API/authentication path; this review does not establish
them as a Live workaround. Pasted selected context is the practical fallback.

Start/Pause/Resume/Finish track logical state. Available boundary evidence can
support active minutes; otherwise a single rough user estimate at Finish is
accepted. No background stopwatch was established by reviewed documentation.
Unknown time is retained rather than fabricated or made a capture blocker.

## Exchange design

The draft v1 stores supplied source text once, then references turns from
question attempts. Source coverage and generated review remain separate;
Voice text is not labeled verbatim audio. Multiple source chats and refreshed
snapshot references fit one daily packet. Unresolved question IDs remain null
until the owner resolves them. Session totals do not invent question durations.

Owner persistence remains separate. The future boundary requires schema and
reference validation, a reviewable preview, authenticated ownership, stable
attempt identities, conflict detection and exact readback. Imported estimates
must retain their basis without altering current live timers. Schema-valid
output is neither a saved record nor a deployed import implementation.

## Verification and limits

Fresh Draft 2020-12 validation passed both synthetic files and four additional
valid cases; 16 invalid variants were rejected. The synthetic source/question
reference graph and key uniqueness were checked. These are document/schema
checks, not runtime persistence or ChatGPT account acceptance.

No account connection, private practice data, database mutation or deployment
was part of this assessment. The capability report links the current official
sources and identifies unverified routes; the contract lists remaining runtime
acceptance requirements.

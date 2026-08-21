---
schemaVersion: 1
id: architecture-review-loop-ai-authoring-and-private-evidence
revision: 1
type: architecture-review
status: proposed
title: Trust-gate AI-assisted Loop authoring and private interview evidence
repository: interview-arc
capabilityIds: ["arc-interview-loops"]
createdAt: 2026-08-20
reconstructed: false
confidence: verified
unknowns: ["Source-audio retention is not yet selected.","The transcription and model provider data policy is not yet selected.","The assistant command allowlist after create_loop is not yet selected.","The measured transcript-body threshold between D1 and private R2 is not yet selected.","First-release speaker identification policy and package limits are not yet selected."]
modules: ["loop-command-module","ai-change-proposal-module","loop-interview-evidence-ingest"]
interfaces: ["loop-authoring-command","ai-change-proposal","owner-approval-gate","loop-interview-package"]
seams: ["owner-request-to-ai-proposal","owner-approval-to-domain-command","interview-package-to-owner-private-d1-and-r2"]
adapters: ["manual-loop-web","ai-provider-gateway","speech-provider-adapter","private-r2-asset-adapter"]
relatedRecords: ["adr-hybrid-git-d1-owner-scoped-state@1","adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: ["feature-retrospective-interview-loops@1"]
capabilities: ["website-native-loop-authoring","owner-confirmed-ai-change-proposals","loop-owned-private-interview-evidence"]
amends: []
supersedes: []
learningRefs: []
diagrams: [{"title":"Trust-gated Loop authoring and private evidence flow","sourcePath":"docs/design/loop-ai-authoring/loop-ai-authoring-architecture.drawio","renderedPath":"docs/design/loop-ai-authoring/loop-ai-authoring-architecture.png","summary":"Manual forms, AI requests, and private interview packages cross authenticated validation and an explicit owner trust gate before deterministic Loop, D1, or R2 mutations.","evidenceRefs":["issue:415","docs/design/loop-ai-authoring/loop-ai-authoring-architecture.drawio"]}]
sources: [{"label":"Arc issue #415","url":"https://github.com/Vinosaamaa/interview-arc/issues/415","kind":"issue"},{"label":"Draft pull request #416","url":"https://github.com/Vinosaamaa/interview-arc/pull/416","kind":"pull-request"},{"label":"Loops MVP issue #252","url":"https://github.com/Vinosaamaa/interview-arc/issues/252","kind":"issue"},{"label":"Owner-private practice records issue #319","url":"https://github.com/Vinosaamaa/interview-arc/issues/319","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:415","pull-request:416","docs/design/loop-ai-authoring/loop-ai-authoring-architecture.drawio"]}
visibility: public-safe
publicationEligibility: eligible
issue: 415
pr: 416
release: null
run: null
---
# Trust-gate AI-assisted Loop authoring and private interview evidence

Interview Arc's Loop reader and owner-scoped D1 model establish durable hiring-process context, but Loop creation remains available only through the authorized Loop Recorder. The website has no create mutation or natural-language proposal surface. Real interview recordings and supplied transcripts also have no Loop-owned evidence boundary; current private audio is scoped to practice activities and carries the wrong lifecycle.

## Constraints

The website must preserve deterministic domain validation, owner isolation, exact provenance, idempotency, revision history, and public-safe observability. Private recordings and transcript text cannot enter Git, public Engineering history, ordinary logs, or public artifacts. AI availability cannot become a prerequisite for basic authoring, and an imported job description or transcript must be treated as untrusted data rather than model instructions.

## Options reviewed

### Continue specialist-only writes

Keeping every mutation in Codex or CLI tasks retains the existing authorization boundary, but it leaves routine owner actions outside the product and prevents the website from showing proposal provenance, uncertainty, conflicts, and receipts as one coherent experience.

### Give an AI agent direct tools

A model with database, MCP mutation, or deployment tools could execute broad requests, but it would couple interpretation to authority. Prompt injection, hallucinated targets, replay, and opaque partial failure would cross the mutation boundary before an owner could review the exact command.

### Add AI to each form independently

Embedding extraction calls inside individual forms would improve convenience, but approval, provenance, retry, cost, and safety rules would drift between Loops, Banks, Today, and later actions. Manual, AI, and specialist entry points could also disagree on domain validation.

### Adopt a typed proposal and shared command boundary

The selected direction treats AI as an optional drafting adapter. Manual forms and specialist tools produce the same versioned domain commands. AI first produces an immutable typed proposal; deterministic code normalizes it and exposes sources, unknowns, warnings, and the exact diff. Only an authenticated owner approval bound to that proposal revision and digest may invoke an allowlisted command.

## Proposed boundary

The Proposal Module owns schema validation, reference resolution, warnings, canonical payloads, digests, immutable revisions, expiry, and proposal events. It has no mutation authority. The Approval Gate verifies owner scope, exact revision and digest, expiry, warning acknowledgements, optimistic concurrency, and replay state. The Domain Command Module owns business validation, authorization, atomic mutation, idempotency, and stable receipts for every entry point.

The first AI command is `create_loop`. Each later command joins the catalog only with a versioned schema, explicit review language, authorization policy, cost/retention policy where relevant, failure model, and end-to-end verification. Unsupported requests fail closed. Sending a prompt never counts as approval.

## Loop-owned interview evidence

A real interview upload is an interview package: one manifest grouping one or more source media and supplied transcript files, assigned to a Loop and optionally a stage. D1 owns package and asset metadata, checksums, transcript revisions, provenance, relationships, jobs, retention decisions, and receipts. Private R2 owns source media bytes and any derived body whose measured size justifies object storage.

Ingest is resumable and idempotent. Source files remain quarantined until signature, MIME, size, checksum, and readback checks pass. Partial packages stay explicit and recoverable. Supplied transcript text remains a source revision; generated transcript or analysis output creates a separate derived revision. Speaker identities, dates, interview outcomes, and extracted facts remain unconfirmed until the owner accepts them.

Current practice-activity audio is not reused. Practice attempts and real hiring interviews have different aggregate ownership, consent, retention, package, stage, and recovery semantics. They may share low-level streaming or checksum utilities without sharing domain rows.

## Privacy, security, and operations

The Worker derives owner scope from Cloudflare Access and applies it to every D1 and R2 lookup. Model and speech providers receive the minimum necessary payload through replaceable adapters and never receive storage credentials. Imported text remains data under a fixed policy; model output has no tool execution path.

Module-boundary traces expose only operation, phase, result code, counts, bytes, and duration. They omit prompts, transcripts, recordings, names, local paths, owner/Loop/asset identifiers, and R2 locators. Per-owner quotas, pre-dispatch estimates, retry bounds, queue backpressure, and budget circuit breakers bound cost and provider failure.

## Delivery shape

The work proceeds as independently reviewable tracer slices linked to issue #415: architecture and interaction contract; manual website Loop creation; private interview-package ingest with supplied transcripts; AI-assisted `create_loop`; evidence-derived processing and a command catalog; and production hardening. Manual creation and source preservation ship before optional AI processing.

## Consequences

The proposal lifecycle adds durable state and a deliberate review step. That cost buys inspectable intent, safe retries, conflict handling, and one reusable mutation boundary. The interface must use progressive disclosure so exact digests and provenance remain available without turning ordinary authoring into a compliance console.

Provider integration stays narrow and replaceable. This avoids prematurely building a general autonomous-agent framework, but every new assistant action requires a reviewed contract rather than appearing automatically. The system degrades to manual forms and existing evidence when external processors are unavailable.

## Design artifacts

The detailed plan and delivery matrix are canonical in [`docs/design/loop-ai-authoring/README.md`](../../design/loop-ai-authoring/README.md). A standalone review artifact is available at [`loop-ai-authoring-plan.html`](../../design/loop-ai-authoring/loop-ai-authoring-plan.html). The linked architecture diagram preserves the reviewed four-tier trust boundary in editable and rendered form.

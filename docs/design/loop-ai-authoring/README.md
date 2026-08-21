# AI-assisted Loop authoring and private interview evidence

Status: proposed architecture for [issue #415](https://github.com/Vinosaamaa/interview-arc/issues/415). This document does not authorize a production mutation or deployment.

## Decision summary

Interview Arc should add an owner-confirmed AI command layer, not give a model direct write access. The model drafts a typed proposal from the owner's request and visible context. Deterministic code validates that proposal, presents the exact change for review, and applies an allowlisted domain command only after explicit owner approval.

Real interview recordings and supplied transcripts should become Loop-owned private evidence. Audio bytes belong in private R2 objects; metadata, checksums, transcript revisions, provenance, and Loop relationships belong in owner-scoped D1 rows. These assets are distinct from practice-activity audio and must not be forced into that schema.

This split preserves the existing product strengths—deterministic validation, auditability, and owner isolation—while making the website capable of the natural-language workflows that currently require a Codex or CLI coordinator.

## How a Loop is added today

The website currently reads Loops but does not create them. The supported write path is the long-lived `Interview Arc — Loop Recorder` task, which calls the Loop MCP tools under its dedicated `loop_recorder` authorization.

To create a Loop today, tell that task the explicit facts you know:

- company and role;
- job-description text or source URL;
- location and the date the Loop opened, when known;
- known interview stages, dates, and current status;
- any uncertainty that must remain marked unknown rather than inferred.

The recorder creates the Loop and Role Brief revision 1 together. Later corrections use revision commands; durable facts are not silently overwritten. Until issue #415 ships, a website-only user cannot perform that operation.

## Product outcome

The target experience has three entry points backed by one command architecture:

1. **Manual, deterministic authoring.** A normal Add Loop form provides a website-native path even when AI is unavailable.
2. **AI-assisted authoring.** The owner describes the change in natural language, receives a structured proposal, corrects or approves it, and watches the deterministic command produce a receipt.
3. **Private interview-package ingest.** The owner uploads one or more recordings and supplied transcripts, assigns them to a Loop and stage, reviews extracted metadata, and optionally requests derived transcript or analysis revisions.

AI is an optional input adapter. The domain command layer remains the only mutation authority for manual forms, AI-assisted proposals, and specialist tooling.

## Architecture invariants

- **No direct model writes.** Model credentials cannot access D1, R2, MCP mutation tools, or deployment APIs.
- **Typed proposals.** Every AI response must validate against a versioned, allowlisted command schema before it can be displayed as actionable.
- **Explicit approval.** A proposal cannot become a command without an owner action bound to the exact proposal revision and content digest.
- **Deterministic apply.** The same command validation, authorization, idempotency, and audit logic serves manual, AI, and specialist entry points.
- **Private by construction.** Uploaded media, transcript text, and derived analysis never enter Git, public build artifacts, logs, model traces, issue bodies, or Engineering records.
- **Provenance before interpretation.** Supplied transcript text remains distinguishable from generated transcript text. Speaker labels, dates, outcomes, and extracted facts remain proposed until accepted.
- **Recoverable ingestion.** Uploads are resumable and idempotent, with checksum-based duplicate detection and explicit partial-failure states.
- **Safe degradation.** Manual authoring and access to existing evidence continue when the model or transcription provider is unavailable.

## System architecture

The architecture has four tiers. The diagram source and reader preview live beside this document:

- [`loop-ai-authoring-architecture.drawio`](loop-ai-authoring-architecture.drawio) — editable source;
- [`loop-ai-authoring-architecture.png`](loop-ai-authoring-architecture.png) — clean reader image;
- [`loop-ai-authoring-architecture.drawio.png`](loop-ai-authoring-architecture.drawio.png) — round-trip draw.io delivery image.

### 1. Owner experience

The authenticated website exposes Add Loop, Add interview evidence, and Ask Interview Arc. The proposal review surface shows source text, normalized fields, unknowns, warnings, and the exact operations that approval will execute. Approval is a separate deliberate action; sending a prompt never implies approval.

### 2. Worker APIs and orchestration

The Worker authenticates the verified owner, rate-limits expensive operations, creates upload sessions, validates manifests, and brokers proposal generation. An orchestration module manages state transitions but cannot bypass domain command handlers.

### 3. Proposal and command modules

The AI gateway sends the minimum necessary context to an allowlisted provider and accepts only schema-constrained output. The Proposal Module canonicalizes fields, calculates a content digest, records provenance, and freezes revisions. The Approval Gate verifies owner, revision, digest, expiry, and any required warnings. The Domain Command Module then performs the same business validation used by manual forms and specialist tools.

### 4. Private storage and external processors

D1 owns typed metadata, proposal/event history, transcript revisions, relationships, and receipts. R2 owns immutable source bytes and optional derived media. External model or speech-to-text providers are replaceable adapters reached only through the Worker; they never receive storage credentials or database access.

## Trust-gated AI command flow

```text
owner request
    │
    ▼
AI drafts typed proposal ──invalid schema──▶ reject safely
    │
    ▼
deterministic normalization + warnings + immutable revision
    │
    ▼
owner reviews exact diff ──reject/edit──▶ new proposal revision
    │ approve exact digest
    ▼
deterministic domain command + idempotency key
    │
    ├──validation conflict──▶ proposal remains unapplied with actionable error
    ▼
D1/R2 mutation + public-safe receipt
```

The approval is consumed exactly once. Retrying the same apply request returns the existing receipt. Editing any field creates a new digest and invalidates the earlier approval.

## Proposed domain model

Names are conceptual until the schema slice is reviewed. Each mutable row is owner-scoped even when the owner identifier is supplied by authenticated request context rather than accepted from the client.

| Entity | Purpose | Essential fields |
| --- | --- | --- |
| `ai_change_proposals` | Immutable proposal revision awaiting a decision | proposal ID, command type/version, canonical payload, digest, status, expiry, source context summary, created time |
| `ai_change_proposal_events` | Append-only lifecycle and failure evidence | proposal ID, event type, result code, safe counts, time |
| `domain_command_receipts` | Idempotent mutation result | command ID, idempotency key, command type/version, result code, target references, applied time |
| `loop_interview_packages` | One ingest operation grouping related files | package ID, Loop ID, optional stage ID, status, declared interview time, manifest digest |
| `loop_interview_assets` | One private source or derived object | asset ID, package ID, media kind, MIME, byte count, SHA-256, R2 locator, state |
| `loop_transcript_revisions` | Supplied or generated text without provenance collapse | transcript ID, asset ID, revision, origin, language, format, speaker-label state, content locator, accepted time |
| `loop_evidence_links` | Explicit relationship to Loop/stage/learning/result | evidence ID, Loop ID, optional stage ID, evidence kind, subject reference, status |
| `processing_jobs` | Retryable asynchronous transcription/analysis work | job ID, operation, state, attempt count, safe error code, lease/heartbeat times |

Long transcript text may remain in D1 when it stays within proven record limits; otherwise encrypted private R2 text objects can hold bodies while D1 remains the authority for metadata and revisions. The implementation slice must decide this from measured payloads, not assumption.

## Private interview-package ingest

### Package contract

The website accepts a package manifest plus one or more files. A package may contain audio, video if later allowlisted, plain text, WebVTT, SRT, or a structured transcript format. File extension alone is never trusted; the server checks signature, MIME, size, and declared role.

A sanitized example manifest:

```json
{
  "schemaVersion": 1,
  "loopId": "loop_public_reference",
  "stageId": "optional_stage_reference",
  "interviewedAt": "2026-08-20T20:00:00Z",
  "assets": [
    {"clientRef": "audio-1", "kind": "audio", "fileName": "interview.m4a"},
    {"clientRef": "transcript-1", "kind": "supplied-transcript", "fileName": "interview.vtt", "derivedFrom": "audio-1"}
  ]
}
```

Client filenames are display metadata, not object locators. R2 keys are opaque, server-generated, and never returned in receipts.

### Ingest state machine

```text
draft → uploading → staged → validating → ready
                    │          │
                    │          ├→ partial (some assets usable; owner decides)
                    │          └→ failed  (safe retry or discard)
                    └────────────→ abandoned/expired
ready → processing → ready-with-derived-revision
ready/partial/failed → deleted (metadata tombstone + governed object deletion)
```

1. Create an upload session and freeze the manifest revision.
2. Stream files to quarantine keys with byte and type limits; calculate SHA-256 while streaming.
3. Finalize each asset only after checksum, signature, and size validation.
4. Deduplicate within the owner boundary by content digest without revealing whether another owner has the same bytes.
5. Parse supplied transcript formats deterministically into a preserved source revision.
6. Present package assignment, timestamps, speakers, and unknowns for confirmation.
7. Optionally enqueue transcription or analysis. Derived results create new revisions and never replace the supplied source.
8. Mark the package ready only after metadata and R2 readback checks agree. Partial success stays visible and recoverable.

### Privacy and consent

Before upload, the owner must affirm that they are permitted to store and process the recording under the applicable interview and jurisdiction rules. Interview Arc should explain that it cannot determine legal consent. Retention controls must expose delete-source, delete-derived, and delete-package effects before execution.

Audio and transcript content are excluded from normal logs. Public-safe module-boundary traces record only operation, phase, result code, asset count, total byte count, and duration. Identifiers in logs must be non-reversible correlation tokens rather than owner, Loop, asset, or R2 identifiers.

## Website experience

### Add Loop

The empty state and Loops header gain an **Add Loop** action. A mode selector offers:

- **Manual** — structured fields with the current deterministic rules;
- **AI-assisted** — a conversational request plus optional pasted job description or URL.

Both modes converge on the same review screen. AI-assisted mode additionally shows extracted facts, explicit unknowns, source attribution, and warnings. The owner can edit fields before choosing **Create Loop**. The receipt links to the created Loop and Role Brief revision.

### Add interview evidence

From a Loop or stage, **Add interview evidence** opens a resumable uploader. Files appear in a manifest table with detected type, size, checksum progress, relationship, and validation state. The owner can assign files, correct interview time and stage, then finalize the package. Optional processing actions are opt-in and display provider, data class, and expected retention/cost category before dispatch.

### Ask Interview Arc

The first website assistant should be an action catalog, not an unconstrained chatbot. Supported commands are visible and schema-backed:

- create or revise a Loop and Role Brief;
- add and organize interview evidence;
- propose stage status or schedule changes;
- add a problem or evidence item to an allowlisted Bank workflow;
- explain the proposed change without applying it.

Unsupported requests return a boundary explanation and the nearest supported action. The assistant never invents a tool, silently executes a mutation, deploys code, writes SQL, or publishes private content.

## Proposed HTTP interfaces

Exact paths may change during implementation, but the separation of responsibilities is deliberate.

| Interface | Responsibility |
| --- | --- |
| `POST /api/loops` | Deterministic manual Loop + initial Role Brief command |
| `POST /api/assistant/proposals` | Create a typed AI proposal for an allowlisted command |
| `POST /api/assistant/proposals/{id}/revise` | Create a new immutable proposal revision from owner corrections |
| `POST /api/assistant/proposals/{id}/approve` | Bind owner approval to exact revision/digest; invoke command apply |
| `POST /api/assistant/proposals/{id}/reject` | Close a proposal without mutation |
| `POST /api/loops/{id}/interview-packages` | Create manifest and resumable upload session |
| `PUT /api/loops/{id}/interview-packages/{packageId}/assets/{assetId}` | Stream or resume an allowlisted asset |
| `POST /api/loops/{id}/interview-packages/{packageId}/finalize` | Validate, reconcile, and make package ready/partial |
| `POST /api/loops/{id}/interview-packages/{packageId}/jobs` | Request an optional derived transcript or analysis revision |
| `DELETE /api/loops/{id}/interview-packages/{packageId}` | Execute an owner-confirmed governed deletion |

Every mutation takes an idempotency key. The server derives owner scope from Cloudflare Access identity, validates target ownership, checks a command-specific optimistic concurrency token, and returns a stable receipt or typed conflict.

## Security and abuse analysis

| Threat | Required control |
| --- | --- |
| Prompt injection in job descriptions or transcripts | Treat all imported text as data, not instructions; schema-constrained outputs; fixed system policy; no tool execution in the model call |
| Model invents a mutation target or fact | Resolve references server-side; show provenance and unknowns; owner approves exact typed payload |
| Cross-owner data exposure | Derive owner from Access; owner predicates on every D1/R2 lookup; generic not-found responses |
| Replay or double apply | Exact proposal digest, single-use approval, idempotency key, durable command receipt |
| Oversized or malformed files | Streaming limits, signature sniffing, allowlisted formats, quarantine state, decompression limits |
| Sensitive content in observability | Fixed event vocabulary and counts only; no prompts, transcript snippets, names, paths, IDs, or object keys |
| Provider retention or training | Contracted zero/limited retention configuration, provider adapter policy, visible opt-in, minimum necessary payload |
| Unexpected cost | Per-owner quotas, file/duration limits, estimate before dispatch, budget circuit breaker, explicit retry policy |
| Destructive AI suggestion | Model cannot approve; deletion requires a separate deterministic confirmation showing scope |

## Reliability model

Durable traces at module boundaries use events such as:

```text
loop.command phase=validate result=ok field_count=8
assistant.proposal phase=generate result=schema_rejected attempt_count=1
interview_package phase=finalize result=partial asset_count=3 byte_count=...
processing_job phase=complete result=ok output_revision_count=1
```

Production traces must omit content and private identifiers. Metrics cover proposal latency and schema-rejection rate, approval-to-apply conflicts, upload completion and resume rate, partial packages, processing retries, provider latency, and deletion reconciliation. Alerts should key on sustained failure ratios, queue age, reconciliation drift, and budget guard trips.

## Delivery plan

### Slice 1 — Architecture and interaction contract

Ship this reviewed design, threat model, source diagram, standalone HTML, and Architecture Review. Resolve the owner-approval semantics, initial command catalog, provider-data policy, and retention defaults before schema implementation.

**Exit evidence:** accepted design review; public-safe Engineering projection; issue-linked decisions.

### Slice 2 — Website-native deterministic Loop creation

Add the `POST /api/loops` command and manual Add Loop flow. Refactor existing Loop Recorder mutation logic behind a shared domain command handler without weakening its authorization boundary.

**Exit evidence:** E2E create flow through the website; duplicate/idempotency tests; owner-isolation tests; Role Brief revision 1 created atomically.

### Slice 3 — Private interview-package ingest

Add package/asset/transcript schema, R2 lifecycle, resumable upload, validation, dedupe, assignment review, deletion, and recovery. Supplied transcript parsing ships before optional generated transcription.

**Exit evidence:** E2E multi-file upload; checksum/readback verification; resume after interruption; partial recovery; exact deletion reconciliation; privacy scan.

### Slice 4 — AI-assisted Loop proposal

Implement provider adapter, typed proposal schema, proposal revisions, approval gate, and apply receipt for one command: create Loop. Manual creation remains the fallback and shares the exact domain command.

**Exit evidence:** prompt-injection cases remain inert; invalid model output cannot reach apply; stale digest/replay tests; E2E prompt-to-review-to-create.

### Slice 5 — Evidence-derived proposals and action catalog

Add opt-in transcription/analysis revisions and grow Ask Interview Arc one command at a time. Each command requires its own schema, authorization, UI review language, tests, quota, and failure model.

**Exit evidence:** source/derived provenance survives round trip; unsupported commands fail closed; cost and retention surfaced before dispatch.

### Slice 6 — Production hardening and release

Exercise migration, queue, provider outage, rollback, retention, backup/restore, D1/R2 reconciliation, accessibility, responsive UI, rate limits, and cost circuits. Release behind owner-only flags, then verify production with sanitized fixtures before enabling real evidence.

**Exit evidence:** hosted checks and production smoke receipts; no private fixtures; rollback and deletion drills; observability runbook.

These are tracer bullets: each slice is a thin end-to-end path with user-visible value and production-grade invariants. Implementation issues should be independently grabbable and cross-linked to #415 rather than turning one large branch into a hidden program.

## Verification matrix

| Layer | Minimum verification |
| --- | --- |
| Schema | migrations, rollback strategy, constraints, indexes, owner predicates, size boundaries |
| Domain commands | validation, authorization, idempotency, optimistic concurrency, atomic receipts |
| AI proposal | schema fuzzing, injection corpus, unsupported commands, truncation, timeouts, provider errors |
| Upload | MIME/signature mismatch, zero/large files, resume, duplicate bytes, partial set, R2/D1 drift |
| Transcript | TXT/VTT/SRT parsing, encoding, timestamps, speaker uncertainty, supplied/derived revisions |
| Privacy | public artifact scan, log capture scan, cross-owner negatives, generic error behavior |
| UI | desktop/mobile/zoom, keyboard and screen reader, reduced motion, progress and recovery states |
| E2E | add Loop manually; add through approved proposal; upload package; attach to stage; delete and reconcile |
| Production | current migration state, Access identity, R2/D1 bindings, queue/provider health, sanitized canary |

## Rollout and migration

1. Land additive schemas and read-disabled modules.
2. Enable manual Loop creation for the owner behind a server-side flag.
3. Enable private upload with supplied transcripts only.
4. Reconcile D1 and R2, verify deletion, then allow derived processing for a tiny owner quota.
5. Enable AI proposal generation for `create_loop` only.
6. Expand the command catalog only after per-command review evidence exists.

No existing Loop or practice record is migrated into the new evidence schema merely because names look related. Any later import of local interview packages is an explicit, owner-reviewed ingest operation with a manifest and checksums.

## Decisions requiring owner approval

Before implementation beyond the manual Loop slice, the issue should record decisions on:

1. whether source audio is retained indefinitely, for a fixed period, or until an accepted transcript exists;
2. which transcription/model provider and retention policy are acceptable for interview evidence;
3. the first allowlisted assistant commands after `create_loop`;
4. whether transcript bodies remain in D1 or move to private R2 beyond a measured threshold;
5. whether speaker identification is manual-only initially;
6. maximum file count, bytes, and recording duration per package;
7. whether an unassigned evidence inbox is required in the first release or may follow Loop-first upload.

## Engineering workspace publication

Creating GitHub issue #415 starts the work but does not itself create an Engineering Journal entry. The canonical path is:

1. land a reviewed pull request containing this design and a public-safe rich Architecture Review;
2. include that pull request's numbered receipt under `docs/engineering/changes/`;
3. let the deterministic build project the record, diagram links, backlinks, search, Statistics, and standalone Engineering HTML.

The Engineering workspace is built from reviewed Git Markdown. It does not ingest issue text, D1 interview data, or private uploads, and production does not fetch GitHub at runtime.

## Explicit non-goals

- a general autonomous agent with arbitrary tools;
- model-authored SQL, deployments, or direct MCP mutations;
- automatic ingestion of a local directory without an owner-reviewed manifest;
- publishing or committing interview audio or transcripts;
- treating supplied and generated transcripts as the same source;
- replacing deterministic forms or making AI availability a prerequisite;
- inferring interview outcomes, speaker identities, or dates as accepted facts;
- sharing private evidence across owners or exposing raw storage locators.

## Design self-critique

The principal UX risk is turning a simple request into a compliance console. The proposal review therefore needs progressive disclosure: the primary view answers “what will change?” and “why?”, while provenance, digest, and technical evidence remain available without dominating the task. The principal architecture risk is prematurely generalizing an agent framework. Starting with one command and one shared deterministic handler keeps the abstraction honest. The principal ingestion risk is coupling large-media reliability to AI processing; source upload and supplied-transcript preservation must reach a stable ready state before optional derived jobs begin.

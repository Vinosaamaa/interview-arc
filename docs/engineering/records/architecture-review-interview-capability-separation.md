---
schemaVersion: 1
id: architecture-review-interview-capability-separation
revision: 1
type: architecture-review
status: proposed
title: Separate Interview Packages, Loop operations, and site-wide AI assistance
repository: interview-arc
capabilityIds: ["arc-interview-loops"]
createdAt: 2026-08-20
reconstructed: false
confidence: verified
unknowns: ["Interview Package retention, source limits, file and URL allowlists, scanning policy, representation storage thresholds, and the first-release material-authoring path are not yet selected.","The assistant provider, retention and region policy, owner budgets, conversation lifecycle, and initial domain adapters are not yet selected."]
modules: ["loop-interview-package","loop-interview-material-revision","loop-command-module","sitewide-ai-assistant"]
interfaces: ["interview-package","interview-package-material-link","interview-material-revision-proposal","loop-authoring-command","assistant-context-adapter","assistant-action-proposal"]
seams: ["browser-source-entry-to-private-interview-package","interview-package-to-material-revision-proposal","website-adapter-to-loop-command","assistant-shell-to-domain-read-adapter","approved-proposal-to-domain-command"]
adapters: ["private-r2-source-adapter","manual-loop-web","registered-loop-recorder-task","assistant-provider-gateway","assistant-domain-adapter"]
relatedRecords: ["adr-hybrid-git-d1-owner-scoped-state@1","adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: ["feature-retrospective-interview-loops@1"]
capabilities: ["owner-private-interview-packages","reviewed-interview-material-revisions","website-native-loop-operations","sitewide-ai-assistance"]
amends: []
supersedes: []
learningRefs: []
diagrams: [{"title":"Independent capability boundaries","sourcePath":"docs/design/interview-capability-separation/capability-boundaries.drawio","renderedPath":"docs/design/interview-capability-separation/capability-boundaries.png","summary":"Private Interview Packages, deterministic Loop operations, and site-wide AI assistance are three independent capabilities above shared owner-scoped foundations.","evidenceRefs":["issue:415","issue:417","issue:418","docs/design/interview-capability-separation/capability-boundaries.drawio"]},{"title":"Site-wide AI assistant architecture","sourcePath":"docs/design/interview-capability-separation/sitewide-ai-assistant.drawio","renderedPath":"docs/design/interview-capability-separation/sitewide-ai-assistant.png","summary":"A shared-shell assistant resolves owner-selected context through domain adapters and can apply only exact approved proposals through existing deterministic commands.","evidenceRefs":["issue:418","docs/design/interview-capability-separation/sitewide-ai-assistant.drawio"]}]
sources: [{"label":"Interview Package issue #415","url":"https://github.com/Vinosaamaa/interview-arc/issues/415","kind":"issue"},{"label":"Website Loop creation issue #417","url":"https://github.com/Vinosaamaa/interview-arc/issues/417","kind":"issue"},{"label":"Site-wide assistant issue #418","url":"https://github.com/Vinosaamaa/interview-arc/issues/418","kind":"issue"},{"label":"Draft pull request #416","url":"https://github.com/Vinosaamaa/interview-arc/pull/416","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:415","issue:417","issue:418","pull-request:416","docs/design/interview-capability-separation/capability-boundaries.drawio","docs/design/interview-capability-separation/sitewide-ai-assistant.drawio"]}
visibility: public-safe
publicationEligibility: eligible
issue: 415
pr: 416
release: null
run: null
---
# Separate Interview Packages, Loop operations, and site-wide AI assistance

Three user needs had been incorrectly modeled as one Loop-centered AI program: collecting sources and related material from real interview events, creating and managing Loops in the website, and using AI throughout Interview Arc. That coupling was false. The architecture now treats them as independently owned product capabilities with separate GitHub issues, delivery paths, privacy decisions, and release criteria.

## Context

The website reads published Loop content and owner-private state but does not currently let the owner assemble a private Interview Package or create a Loop. Those are two ordinary product gaps. A third gap is that AI assistance is available through external coding or CLI workflows rather than through the authenticated website. Solving that third gap inside the Loop feature would make the assistant artificially Loop-specific and risk making deterministic operations depend on a model provider.

The production foundations remain the `limitless` Cloudflare Worker, Cloudflare Access, D1, and private R2. Git owns published narrative content; D1 owns mutable owner-private state. Reusing those foundations does not collapse domain ownership.

## Decision

Interview Packages, Loop operations, and site-wide AI assistance are three separate capabilities:

1. Issue #415 owns explicit entry, resumable validation, storage, assignment, reading, revision, export, reconciliation, and governed deletion of event-scoped recordings, transcripts, documents, images, links, and owner notes. It may link an exact Interview Material revision or prepare a separately reviewed revision from selected sources. It does not invoke an AI or speech provider.
2. Issue #417 owns an ordinary deterministic Add Loop workflow and a shared `create_loop` domain command used by the website and a separately created, registered Loop Recorder task. It works with AI disabled.
3. Issue #418 owns **Ask Interview Arc** in the shared application shell. It spans Today, Banks, Practice, Learn, Review, Loops, and later owner-selected evidence through narrow domain-owned adapters. It begins read-only and may propose typed actions only where an existing deterministic command and explicit approval contract are present.

Cloudflare Access identity, D1, R2, command receipts, safe traces, and UI primitives may be shared. Integrations occur only through versioned domain interfaces. None of the three issues is a release prerequisite for either of the other two.

## Interview Package boundary

An Interview Package groups sources from one interview event. The owner explicitly adds file assets, external links, and owner notes, then may assign the package to an existing Loop/Round or leave it in an unassigned inbox. D1 owns package, source/entry revision, transcript representation, assignment/material link, upload-session, and command-receipt state. Private R2 owns quarantined and verified file-source bytes under opaque locators.

Finalization reconciles signature, MIME, size, checksum, D1 metadata, R2 object state, and authorized readback. Partial packages remain visible and recoverable. Supplied transcripts preserve original bytes and provenance and are parsed deterministically. Notes and links use append-only revisions. This capability does not scan local folders, crawl links automatically, or submit content to a model provider.

Interview Material is a separate reusable preparation aggregate. Package upload never changes it. Linking pins one exact material revision. Preparing a new revision requires explicitly selected package-source digests, a comparison against the current material and Role Brief revisions, and a separate confirmation receipt. Stale proposals cannot become current.

## Loop command boundary

The website Add Loop form and a separately created, registered Loop Recorder task are authorization adapters over one versioned command. `create_loop` owns schema and domain validation, atomic creation of the Loop and Role Brief revision 1, initial stages and provenance, optimistic concurrency, idempotency, and stable receipts. Unknown values remain explicit and are not inferred.

A future assistant proposal may become another adapter, but it cannot bypass review or change the command's invariants. Removing or disabling the assistant leaves the complete Add Loop experience intact.

## Site-wide assistant boundary

The assistant platform owns a persistent shared-shell experience, owner-selected context, context minimization, provider routing, citations, conversation lifecycle, proposal revisions and digests, approval, budgets, and public-safe observability. Domains own their read schemas, command schemas, authorization, sensitivity classification, citations, concurrency rules, and tests.

Read mode has no mutation tools. Action mode produces one immutable, versioned proposal for an allowlisted command. Editing creates a new revision and digest. Owner approval is exact and single-use; it invokes the owning deterministic command, which can still reject stale state. The model provider receives minimum necessary content and no D1, R2, SQL, GitHub, filesystem, publication, or deployment authority.

The first release grounds published content, then proves a second distinct workspace. Command proposals are added only around existing deterministic commands. Loops join after #417. Private Interview Package sources join only after #415 and a separate provider-privacy decision.

## Options rejected

### One Loop-centered AI feature

This makes AI look like the owner of two ordinary workflows, hides the direct answer for upload and Loop creation, and produces the wrong product information architecture.

### AI embedded independently in each form

This would duplicate context, approval, provenance, provider, retention, cost, and recovery policy across domains while leaving no coherent website-wide assistant.

### A general model agent with direct tools

Direct database, storage, GitHub, filesystem, or deployment authority would combine interpretation and execution before the owner can inspect the exact command. Prompt injection and hallucinated targets could cross the mutation boundary.

### Building the assistant before deterministic commands

This would make model output the de facto domain API. Deterministic commands and ordinary product UI must exist first; AI may only adapt to them later.

## Consequences

Three issue-owned implementations create more explicit interfaces and release records, but each vertical slice is independently useful, testable, recoverable, and removable. Manual functionality remains available during provider outage or policy disablement. Interview Package privacy decisions remain isolated from assistant-provider decisions.

The assistant requires a small platform layer rather than Loop-specific prompt wiring. That platform is justified only after it demonstrates at least two distinct domain integrations. Each additional domain adapter remains an explicit security, privacy, schema, UX, and E2E review rather than inheriting broad authority automatically.

## Delivery and publication

Issue #417 may ship whenever the deterministic Loop command and website adapter are complete. Issue #415 may ship package ingest against existing Loops plus an unassigned inbox; material linking does not require website-native material authoring. Issue #418 may begin with published-content grounding without waiting for either. Later adapter connections are separate reviewed changes.

This architecture review is the public-safe record of the separation decision. Each implementation receives its own worktree, branch, pull request, verification, numbered Engineering receipt, production release evidence, and post-merge cleanup. No private audio, transcript, document, image, URL, note, prompt, response, owner identifier, or local filesystem path belongs in Git, GitHub, public logs, screenshots, or Engineering narrative.

## Design artifacts

The consolidated review is [`interview-capabilities-plan.html`](../../design/interview-capability-separation/interview-capabilities-plan.html). The detailed Interview Package contract and responsive synthetic-data mockup are [`interview-evidence-upload.md`](../../design/interview-capability-separation/interview-evidence-upload.md) and [`interview-package-ui-mockup.html`](../../design/interview-capability-separation/interview-package-ui-mockup.html). Both architecture views have editable draw.io sources, clean PNG previews, and round-trip editable PNGs.

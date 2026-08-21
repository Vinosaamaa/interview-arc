# Separate private interview packages, Loop operations, and site-wide AI assistance

Status: proposed architecture spanning three independent issues:

- [#415 — Upload and manage private Interview Packages and related materials](https://github.com/Vinosaamaa/interview-arc/issues/415)
- [#417 — Add website-native Loop creation and management](https://github.com/Vinosaamaa/interview-arc/issues/417)
- [#418 — Add a site-wide Interview Arc AI assistant](https://github.com/Vinosaamaa/interview-arc/issues/418)

This design corrects an earlier false coupling. Creating and managing a private Interview Package is not an AI feature. Creating a Loop is not an AI feature. The AI assistant is a separate website-wide capability that may later consume both through reviewed adapters.

## The three questions

### 1. How do I add the sources and related material from one interview?

Interview Arc needs a private **Interview Package** workspace owned by issue #415. The owner adds recordings, supplied transcripts, documents, images, external links, and owner notes; reviews a package manifest; confirms an exact Loop/Round or leaves it unassigned; and reads, revises, or deletes it through owner-scoped D1/R2 state.

Interview Material remains a separate reusable preparation record. The package may link an exact material revision or start an explicit, source-selected proposal for a new revision; uploading never silently edits material. No AI is required. Optional future transcription, extraction, or analysis is a separate derived operation and authorization.

Detailed plan: [`interview-evidence-upload.md`](interview-evidence-upload.md).

Responsive UI mockup: [`interview-package-ui-mockup.html`](interview-package-ui-mockup.html).

### 2. How do I add a Loop?

Today, the website reads Loops but does not create them. Create and register a dedicated coordinator task from the canonical Loop Recorder prompt before using that mutation path; no existing task or thread identifier should be assumed.

Issue #417 adds a normal deterministic **Add Loop** flow. It creates the Loop and Role Brief revision 1 atomically and works without AI. A future assistant may propose values, but the underlying feature remains independent.

Detailed plan: [`website-loop-creation.md`](website-loop-creation.md).

### 3. How do we add AI to the website?

Issue #418 adds **Ask Interview Arc** to the shared website shell. It is not owned by Loops. It can operate across Today, Banks, practice, Learn, Review, Loops, and later owner-selected private package sources as each domain exposes safe read or command interfaces.

The assistant has two modes: grounded read/explain, and typed action proposals. It does not write directly. Each approved action calls an existing deterministic domain command.

Detailed plan: [`sitewide-ai-assistant.md`](sitewide-ai-assistant.md).

## Capability boundary

```text
┌──────────────────────────────┐
│  #415 Interview Packages     │  Add/read/link/revise/delete event sources
│  Works without AI            │
└──────────────┬───────────────┘
               │ explicit domain interfaces only
┌──────────────▼───────────────┐
│  Shared product foundations  │  Access identity • D1 • R2 • commands • receipts
└──────────────▲───────────────┘
               │ explicit domain interfaces only
┌──────────────┴───────────────┐
│  #417 Loop operations        │  Create/revise/manage Loops
│  Works without AI            │
└──────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  #418 Site-wide AI assistant                                │
│  Optional adapter over selected read APIs and commands      │
│  Does not own #415 or #417                                  │
└─────────────────────────────────────────────────────────────┘
```

The overview architecture is maintained in:

- [`capability-boundaries.drawio`](capability-boundaries.drawio) — editable source;
- [`capability-boundaries.png`](capability-boundaries.png) — clean preview;
- [`capability-boundaries.drawio.png`](capability-boundaries.drawio.png) — round-trip editable PNG.

The assistant-specific architecture is maintained separately in:

- [`sitewide-ai-assistant.drawio`](sitewide-ai-assistant.drawio) — editable source;
- [`sitewide-ai-assistant.png`](sitewide-ai-assistant.png) — clean preview;
- [`sitewide-ai-assistant.drawio.png`](sitewide-ai-assistant.drawio.png) — round-trip editable PNG.

The responsive consolidated review artifact is [`interview-capabilities-plan.html`](interview-capabilities-plan.html).

## Shared foundations do not imply one feature

The three issues may reuse low-level capabilities without sharing product ownership:

| Foundation | #415 Packages | #417 Loops | #418 Assistant |
| --- | --- | --- | --- |
| Cloudflare Access | Derives owner scope | Derives owner scope | Derives owner scope/context |
| D1 | Packages, source/entry revisions, assignment/material links, receipts | Loop, Role Brief, stages, receipts | Conversations, selected context, proposals, approvals |
| R2 | Private file-source bytes | No source-media ownership | No direct storage authority; selected private content only through adapters |
| Domain commands | Assign/delete package, revise entry, link/prepare material | Create/revise Loop | Calls allowlisted commands only after approval |
| Public-safe traces | Upload phases/counts | Command phases/counts | Provider/proposal phases/counts |

Reusing authentication, command receipts, tracing vocabulary, or UI primitives does not make these one capability. Domain ownership remains explicit.

## Ordering

The work does not need to ship as one program:

1. #417 can ship whenever the deterministic Loop command and UI are ready.
2. #415 can ship package ingest with existing Loops and an unassigned inbox; it does not wait for #417. Material linking can ship independently of website-native material authoring.
3. #418 starts with read-only, website-wide grounded assistance and existing deterministic domains; it does not wait for #415 or #417.
4. Later adapters may connect #418 to #415 or #417 after each underlying interface exists and receives its own review.

## Global invariants

- Manual deterministic functionality remains available when AI is disabled or unavailable.
- AI is an optional adapter, never a prerequisite or state authority.
- Owner-private recordings, transcripts, documents, images, links, notes, prompts, responses, and IDs never enter Git, public logs, issues, fixtures, screenshots, or Engineering narrative.
- Imported text is untrusted data and cannot expand authority.
- Each issue gets its own implementation worktree, branch, pull request, tests, Engineering receipt, release verification, and cleanup.
- This design pull request does not implement, merge, migrate, ingest real files, or deploy anything.

## Engineering publication

Issues #415, #417, and #418 are planning records, not Engineering Journal entries. A reviewed design pull request may publish this separation as one Architecture Review because the decision is specifically about capability boundaries. Each later implementation pull request still owns its own numbered receipt and any material record required by its domain change.

## Design self-critique

The earlier design used an AI trust gate as its visual center. That made AI appear to own Loop creation and Interview Package ingest even while the prose claimed deterministic independence. This revision makes separation the first visual fact: three parallel doors, no dependency arrows between them, and AI shown as an optional cross-workspace adapter. The remaining risk is over-generalizing the assistant before two real product domains exist; issue #418 therefore requires read-only grounding first and at least two distinct domain integrations before treating the command platform as general.

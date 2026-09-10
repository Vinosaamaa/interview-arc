---
schemaVersion: 1
id: architecture-review-chatgpt-practice-backfill
revision: 1
type: architecture-review
status: accepted
title: Import regular ChatGPT practice without inventing live timing
repository: interview-arc
capabilityIds: ["practice-records", "problem-banks"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["Account-specific text and Live context handoff", "Production deployment and owner acceptance"]
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
# Import regular ChatGPT practice without inventing live timing

Regular ChatGPT practice now has a private bank download and a source-preserving
import boundary. In Past, the owner downloads current questions/progress, gives
the file and GitHub guide to text ChatGPT, practices in that same conversation
using text or Live, then previews and applies a session export back in Arc.

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

The v1 packet stores supplied source text once, then references turns from
question attempts. Source coverage and generated review remain separate;
Voice text is not labeled verbatim audio. Multiple source chats and refreshed
snapshot references fit one daily packet. Unresolved question IDs remain null
until the owner resolves them. Session totals do not invent question durations.

An owner-authenticated route validates bounded shape, reference graphs, date
basis, results and effective timer transitions. Preview binds current bank
matches, existing source/attempt fingerprints and same-day occupancy. Apply
rechecks that preview, atomically writes immutable historical activity revisions
and source/receipt identity, and verifies exact persisted bytes. Source turns
cannot change or move to another chat. Changed attempts need explicit revision
review. A pending date/question match can be resolved without changing source.

The historical representation deliberately avoids creating a live stopwatch,
inventing a completion timestamp or fabricating a Solution Profile. Its Past
reader shares Markdown/code presentation and suppresses remote image fetches.
Estimated/unknown time remains explicit. The newest source-session state is
shown separately from the immutable session capture. Source-only and duplicate
question/day evidence stays pending. Current imported completions contribute
to bank downloads; their durations do not enter exact live Journey totals.

## Verification and limits

Focused tests execute the actual SQL against all migrations in SQLite and
cover retry deduplication, immutable-source conflicts, reviewed pending-to-
completed revisions, owner isolation, same-day conflicts and unchanged Today.
Transport checks cover malformed references/results and pause arithmetic across
the daylight-saving transition. Local D1 migration and content import passed.
The local browser check downloads all 480 catalog questions, previews and saves
synthetic practice, reloads its reader and checks refreshed bank progress,
desktop/phone containment and Escape. No production practice was imported.

The capability report retains official-source findings and the unverified
ChatGPT account handoff. A release and real owner acceptance remain separate
from local implementation and PR validation.

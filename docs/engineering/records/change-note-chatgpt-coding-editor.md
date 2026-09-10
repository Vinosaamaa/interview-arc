---
schemaVersion: 1
id: change-note-chatgpt-coding-editor
revision: 1
type: change-note
status: released
title: Edit and review Java or Python inside ChatGPT
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Actual ChatGPT widget and hosted LeetCode judge acceptance remain release gates"]
modules: ["practice-records"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["change-note-native-deferred-references@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #459","url":"https://github.com/Vinosaamaa/interview-arc/issues/459","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/coding-editor.test.mjs","tests/chatgpt-connector.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 459
pr: null
release: null
run: null
---
# Edit and review Java or Python inside ChatGPT

The coding panel gives the connected ChatGPT conversation a private, editable
draft instead of requiring repeated copy and paste. A complete source statement,
examples and original diagrams appear alongside code on desktop and above it on
mobile. ChatGPT can provide an inspected, faithful ASCII explanation of a graph;
original images remain available when a text sketch loses information.

The design uses Arc's paper, dark ink and teal palette, restrained serif title,
system text and monospaced code. The problem remains a collapsible reference;
Save draft and Review with ChatGPT form the primary workflow. Local browser QA
covered typing, line numbers, exact saves, review messages, Unicode trees and
overflow at mobile and desktop widths. Review caught a collapsed line-number
gutter and a low-contrast hover state; both were corrected before hosted CI.

Five scoped tools open, read, save, submit and poll. The UI is a self-contained
MCP Apps resource; source HTML is reconstructed through an allowlist and image
requests are restricted to LeetCode's asset host. No external editor runtime,
Mac service or code execution sandbox is required. Java and Python have separate
drafts. Immutable revisions, owner isolation and operation fingerprints preserve
exact code and reject stale writes without overwriting local edits.

Only an explicit submission request sends a saved revision to the connected
owner's LeetCode judge. The authenticated account is checked before reservation.
A unique draft/revision reservation and transactional current-revision guard
prevent duplicate POSTs, including after uncertainty. Pending, interrupted and
complete verdicts stay distinct. Custom questions can be created in chat and
reviewed but cannot claim a LeetCode judge. Real judge access is an external
integration with session expiry and provider restrictions; mocked responses
prove transport semantics, not production acceptance.

Draft saves do not publish a practice activity. ChatGPT reads the exact revision,
saves its actual review and code attempt with transcript parity, then completes
the existing native or backfill flow. Missing official references may be added
later. There is no automatic editorial fabrication or test-result invention.

Validation covers owner isolation, immutable history, replay and stale writes,
exact submission payloads, uncertain single delivery, expired authentication,
custom-question rejection, incomplete verdicts and compiler error preservation.
The actual Worker integration creates a custom question, serves the widget,
saves source and reads the exact revision through authenticated MCP transport.
Production acceptance and deployment receipts are recorded on the owning issue.

The same read, draft, judge and drawing tools are also exposed on the existing
bearer-authenticated MCP route for Codex and compatible CLI agents. Checked-in
Codex configuration includes the tools and hosted Excalidraw connection;
specialist instructions prefer MCP while retaining the existing browser/local
canvas fallback. The integration test reads the same private draft through both
OAuth-owner and bearer-owner transports. A working MCP connection alone does
not establish that a particular installed host renders the interactive UI.

A private browser URL hosts the same resource for desktop browser panes when
inline rendering is unavailable. Its same-origin authenticated API exposes
only draft reads and saves, with revision guards; it never embeds a token or
performs judge submissions. A browser fixture verifies load, edit, save and
the explicit return-to-agent review handoff. Changing language in this fallback
is opened by the agent, preserving separate language drafts.

The same repository-owned interview skill, adaptive engine, specialty guides
and Arc AGENTS.md are served verbatim to both text clients by a bounded,
hash-checked coaching read. The integration test reassembles the selected
documents and compares them to source files across both authenticated routes.
A visible text-to-Live handoff carries coaching rules and relevant disclosed
facts; it does not claim a private shared file or verified Voice tool support.

Concurrent editor saves preserve local edits and offer an explicit comparison
and recovery choice. A save racing judge authentication prevents reservation
and any external POST. Source history and submission identities remain durable
for exact-review provenance and retry deduplication; immutable problem metadata
is stored once rather than repeated with every autosave.

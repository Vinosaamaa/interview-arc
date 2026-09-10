---
schemaVersion: 1
id: change-note-excalidraw-link-reader
revision: 1
type: change-note
status: released
title: Hosted LeetCode access and Excalidraw publication for ChatGPT
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Native mobile custom connector support is not established", "Production account reads require an owner-connected LeetCode session"]
modules: ["practice-records"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/excalidraw-link.test.mjs", "tests/leetcode-account.test.mjs", "tests/practice-drawing.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Hosted LeetCode access and Excalidraw publication for ChatGPT

The free drawing connector creates diagrams but cannot read an existing shared
snapshot. The authenticated Arc ChatGPT connection now exposes
`read_excalidraw_link`. Given a complete Export to Link URL, the service fetches
the encrypted snapshot from Excalidraw and decodes it in memory. It returns exact
active elements, including labels, geometry, and arrow bindings, in bounded JSON
fragments guarded by a content checksum.

Only the exact HTTPS Excalidraw snapshot URL format is accepted. The outbound
destination is fixed, redirects are rejected, downloads time out after ten
seconds and are limited to one MiB, and decompression is capped at two MiB.
Malformed frames, authentication-tag failures, incompatible encodings and
invalid scenes fail without returning upstream exception details or the link's
key. Source text remains untrusted data. No credential, key, or scene is logged
or persisted by the reader.

This read does not join live rooms, follow subsequent edits, fetch linked
resources, return embedded image pixels, or save a practice checkpoint. Users
export a new snapshot after edits. The separate drawing widget can export its
own diagram with Open in Excalidraw. Neither export nor read is an Arc save.

After an explicit publication request and completed transcript import,
`save_practice_drawing` attaches the editable snapshot, including embedded files,
to that owner-scoped system-design record. Immutable D1 revisions point to
hash-verified private R2 bytes. Exact operation retries are idempotent and stale
revisions cannot overwrite another addition. The reader exposes an Excalidraw
reopen link and authenticated editable-file download. This import path does
not generate SVG or PNG previews. AI references retain separate authorship.
Transcript and drawing writes have separate receipts so partial completion is
visible and retryable without duplicating a practice session.

The same hosted connector adds fixed read operations for LeetCode problems,
recent submissions, owned submission source and official editorials. This is a
Worker-compatible adapter of the session-cookie approach used by the community
LeetCode MCP, not an unchanged Node server or a LeetCode OAuth application.
The private connection page validates the owner-supplied session before storing
it in owner-scoped R2 storage, encrypted at rest. Neither tool responses nor the
connection status endpoint returns the credential. Same-origin writes, bounded
input, exact upstream destinations and safe errors constrain the credential
boundary. Disconnect removes the stored connection; an expired session requires
the owner to reconnect. Premium locks remain explicit and official content is
paginated with a checksum. No code execution or submission tool is added.

Verification covers encrypted round trips, geometry and binding preservation,
lossless paging, destination restrictions, damaged payloads, download and inflate
limits, safe errors, scoped MCP calls, credential isolation and renewal failure,
official editorial paging, owned-source checks, immutable drawing receipts,
image-file preservation, download integrity and wrong-owner denial. A remote
Cloudflare preview retrieved public LeetCode data and decoded a real synthetic
Excalidraw snapshot. Private account acceptance is a separate owner-connected
runtime check.

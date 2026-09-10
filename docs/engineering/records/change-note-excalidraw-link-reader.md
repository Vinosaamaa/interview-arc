---
schemaVersion: 1
id: change-note-excalidraw-link-reader
revision: 1
type: change-note
status: released
title: Read shared Excalidraw snapshots through the practice connector
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Native mobile custom connector support is not established"]
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
verification: {"state":"verified","evidenceRefs":["tests/excalidraw-link.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Read shared Excalidraw snapshots through the practice connector

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

This operation does not join live rooms, follow subsequent edits, fetch linked
resources, return embedded image pixels, or save a practice checkpoint. Users
export a new snapshot after edits. The separate drawing widget can export its
own diagram with Open in Excalidraw. Neither export nor read is an Arc save.

Verification covers encrypted round trips, geometry and binding preservation,
lossless paging, destination restrictions, damaged payloads, download and inflate
limits, safe errors, and calls through the scoped MCP client without D1 access.

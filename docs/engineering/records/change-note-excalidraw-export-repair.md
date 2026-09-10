---
schemaVersion: 1
id: change-note-excalidraw-export-repair
revision: 1
type: change-note
status: released
title: Route Excalidraw canvas exports through Cloudflare
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Final production connector acceptance is recorded on the owning issue"]
modules: ["practice-records"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["change-note-excalidraw-link-reader@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/excalidraw-proxy.test.mjs", "tests/excalidraw-link.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Route Excalidraw canvas exports through Cloudflare

The official Excalidraw MCP export entered Exporting and silently reset without
opening a link. A direct request to its export operation exceeded twenty seconds,
while the website exported the same class of synthetic scene successfully.

An authenticated compatibility endpoint preserves the official MCP renderer,
diagram creation and checkpoint operations. It replaces only the export upload
with the same encrypted Excalidraw v2 snapshot format executed on Cloudflare.
The endpoint shares Arc's existing OAuth verification; credentials and owner
identity never reach the upstream drawing service. A fixed method/tool/resource
allowlist, bounded bodies, fixed destinations, manual redirect handling and
timeouts constrain the forwarding boundary. Error receipts omit upstream
details. No new server or paid infrastructure is required.

The endpoint requires a distinct ChatGPT connection because existing plugin
settings do not support changing their endpoint URL. Existing diagrams remain
on the official checkpoint service; this is not a replacement renderer or a
new diagram store. Original plugin connections remain intact during acceptance.

Regression checks cover encrypted round-trip fidelity including embedded files,
widget-compatible response shape, forwarding without credentials, request
restrictions, and safe failures. A Cloudflare remote preview completed an actual
synthetic upload and returned a valid share link. User-visible export and full
practice finalization remain separately verified on the owning issue.

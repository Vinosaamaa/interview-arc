---
schemaVersion: 1
id: feature-retrospective-authoritative-today-controls
revision: 1
type: feature-retrospective
status: released
title: Expose owner-scoped Today controls to specialists
repository: interview-arc
capabilityIds: ["arc-authoritative-today-controls"]
createdAt: 2026-08-01
reconstructed: true
confidence: high
unknowns: ["Attachment bodies and workflow logs were not quoted."]
modules: ["D1:live-state","D1:schema","D1:specialist-controls-policy","D1:specialist-controls-store","D1:today-planning-policy","MCP bridge"]
interfaces: ["db/specialist-controls-policy.ts","db/today-planning-policy.ts","docs/contracts/specialist-today-controls.md"]
seams: ["specialist MCP \u2194 durable D1 state","Git narrative content \u2194 runtime projection"]
adapters: ["db/specialist-controls-store.ts","mcp-worker/index.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-authoritative-today-controls"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #111","url":"https://github.com/Vinosaamaa/interview-arc/pull/111","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:111","head-commit:ff5b2bd62e303bb82bb933c878de48aea5aa7d1a","merge-commit:ab5f17ad64692f34f92031d028f1a6e6d636f288"]}
visibility: public-safe
publicationEligibility: eligible
issue: 108
pr: 111
release: null
run: null
---
# Expose owner-scoped Today controls to specialists

Evidence-indexed reconstruction of pull request #111. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

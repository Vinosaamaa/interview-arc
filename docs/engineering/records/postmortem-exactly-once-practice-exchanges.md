---
schemaVersion: 1
id: postmortem-exactly-once-practice-exchanges
revision: 1
type: postmortem
status: closed
title: Make practice exchanges exact-once and nonblocking
repository: interview-arc
capabilityIds: ["arc-postmortem-exactly-once-practice-exchanges"]
createdAt: 2026-07-27
reconstructed: true
confidence: high
unknowns: ["Attachment bodies and workflow logs were not quoted."]
modules: ["D1:durable-practice","D1:live-state","D1:practice-exchange-policy","D1:schema","MCP bridge","practice:behavioral"]
interfaces: ["db/practice-exchange-policy.ts","docs/contracts/durable-practice-publishing.md","drizzle/0015_mature_meggan.sql","drizzle/meta/0015_snapshot.json","drizzle/meta/_journal.json"]
seams: ["specialist MCP \u2194 durable D1 state","Git narrative content \u2194 runtime projection"]
adapters: ["mcp-worker/index.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-postmortem-exactly-once-practice-exchanges"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #95","url":"https://github.com/Vinosaamaa/interview-arc/pull/95","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:95","head-commit:8f156fabff209d9ed0a26114a3c6956621013665","merge-commit:34d8d21e0fd83d62b9925e864734955d2c155b8e"]}
visibility: public-safe
publicationEligibility: eligible
issue: 93
pr: 95
release: null
run: null
---
# Make practice exchanges exact-once and nonblocking

Evidence-indexed reconstruction of pull request #95. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

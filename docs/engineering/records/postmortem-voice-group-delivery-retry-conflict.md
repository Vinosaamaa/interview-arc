---
schemaVersion: 1
id: postmortem-voice-group-delivery-retry-conflict
revision: 1
type: postmortem
status: closed
title: Repair canonical Voice response-group recovery
repository: interview-arc
capabilityIds: ["arc-postmortem-voice-group-delivery-retry-conflict"]
createdAt: 2026-08-05
reconstructed: true
confidence: high
unknowns: ["Attachment bodies and workflow logs were not quoted."]
modules: ["D1:durable-practice","D1:practice-exchange-policy","D1:schema","D1:specialist-controls-policy","D1:specialist-controls-runtime","MCP bridge"]
interfaces: ["db/practice-exchange-policy.ts","db/specialist-controls-policy.ts","docs/contracts/durable-practice-publishing.md","drizzle/0022_voice_response_group_repair.sql","drizzle/meta/_journal.json"]
seams: ["specialist MCP \u2194 durable D1 state"]
adapters: ["mcp-worker/index.ts","mcp-worker/voice-capture-batch.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-postmortem-voice-group-delivery-retry-conflict"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #159","url":"https://github.com/Vinosaamaa/interview-arc/pull/159","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:159","head-commit:5e0cf7a831b4e532ac7d1d9c472c17c2c879d2a4","merge-commit:7d7ef7b48169c0e3cd98f077534945d0f23a3bb4"]}
visibility: public-safe
publicationEligibility: eligible
issue: 157
pr: 159
release: null
run: null
---
# Repair canonical Voice response-group recovery

Evidence-indexed reconstruction of pull request #159. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

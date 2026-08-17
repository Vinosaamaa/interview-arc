---
schemaVersion: 1
id: "postmortem-live-sync-polling-and-voice-retry-storm"
revision: 1
type: "postmortem"
status: "closed"
title: "Replace one-second polling with owner-scoped live updates"
repository: "interview-arc"
capabilityIds: ["arc-postmortem-live-sync-polling-and-voice-retry-storm"]
createdAt: "2026-07-27"
reconstructed: true
confidence: "high"
unknowns: ["Attachment bodies and workflow logs were not quoted."]
modules: ["HTTP:mutations","web:home-client","web:live-event-policy","web:live-sync","D1:durable-practice","D1:schema"]
interfaces: ["app/api/mutations/route.ts","app/live-event-policy.ts","docs/contracts/live-update-reliability.md","drizzle/0014_outgoing_shinko_yamashiro.sql","drizzle/meta/0014_snapshot.json","drizzle/meta/_journal.json"]
seams: ["web/Worker \u2194 owner-scoped D1","specialist MCP \u2194 durable D1 state","Chrome companion \u2194 hosted bridge"]
adapters: ["app/home-client.tsx","extension/manifest.json","extension/sidepanel.js","mcp-worker/index.ts","worker/index.ts","worker/live-update-hub.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-postmortem-live-sync-polling-and-voice-retry-storm"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #92","url":"https://github.com/Vinosaamaa/interview-arc/pull/92","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:92","head-commit:41aba38e69501fde56f0b1aa3796a6ae5dcddd28","merge-commit:e301eef040fe7c91649d4b6f65574e57d5366773"]}
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 89
pr: 92
release: null
run: null
---
# Replace one-second polling with owner-scoped live updates

Evidence-indexed reconstruction of pull request #92. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

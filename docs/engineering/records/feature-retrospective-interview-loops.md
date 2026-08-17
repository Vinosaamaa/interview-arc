---
schemaVersion: 1
id: "feature-retrospective-interview-loops"
revision: 1
type: "feature-retrospective"
status: "released"
title: "Implement the Interview Loops MVP"
repository: "interview-arc"
capabilityIds: ["arc-interview-loops"]
createdAt: "2026-08-11"
reconstructed: true
confidence: "high"
unknowns: ["Attachment bodies and workflow logs were not quoted.","Sensitive source values and nonessential risky evidence links were omitted."]
modules: ["HTTP:loops","web:content-types","web:globals","web:home-client","web:interview-arc-v2","web:journey-insights"]
interfaces: ["app/api/loops/route.ts","db/loop-policy.ts","db/today-planning-policy.ts","docs/contracts/interview-loops.md","docs/contracts/specialist-today-controls.md","drizzle/0034_wild_the_initiative.sql"]
seams: ["web/Worker \u2194 owner-scoped D1","specialist MCP \u2194 durable D1 state","Git narrative content \u2194 runtime projection"]
adapters: ["app/home-client.tsx","app/interview-arc-v2.css","docs/contracts/interview-loops.md","mcp-worker/index.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-interview-loops"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #253","url":"https://github.com/Vinosaamaa/interview-arc/pull/253","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:253","head-commit:dfacff2a792be9557bd8b304f48da56040f5ba9d","merge-commit:7489f6bb4c79f0df7fe26cd3a48bd24b1e0be50b"]}
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 252
pr: 253
release: null
run: null
---
# Implement the Interview Loops MVP

Evidence-indexed reconstruction of pull request #253. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

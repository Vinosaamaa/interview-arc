---
schemaVersion: 1
id: postmortem-career-work-boundary
revision: 1
type: postmortem
status: closed
title: Add career focus blocks and Career Work
repository: interview-arc
capabilityIds: ["arc-postmortem-career-work-boundary"]
createdAt: 2026-07-27
reconstructed: true
confidence: high
unknowns: ["Attachment bodies and workflow logs were not quoted."]
modules: ["HTTP:career-work","HTTP:mutations","web:career-work","web:globals","web:home-client","web:live-sync"]
interfaces: ["app/api/career-work/route.ts","app/api/mutations/route.ts","app/live-types.ts","docs/contracts/career-work.md","docs/contracts/durable-practice-publishing.md","drizzle/0016_mighty_justin_hammer.sql"]
seams: ["web/Worker \u2194 owner-scoped D1"]
adapters: ["app/home-client.tsx","db/job-journey-client.ts","worker/index.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-postmortem-career-work-boundary"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #96","url":"https://github.com/Vinosaamaa/interview-arc/pull/96","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:96","head-commit:41ff0ca4a61a7919df2f13573f55432234a5794a","merge-commit:5412831fb8ab6fb39596274ddf0cb1b5366bbe8a"]}
visibility: public-safe
publicationEligibility: eligible
issue: 94
pr: 96
release: null
run: null
---
# Add career focus blocks and Career Work

Evidence-indexed reconstruction of pull request #96. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

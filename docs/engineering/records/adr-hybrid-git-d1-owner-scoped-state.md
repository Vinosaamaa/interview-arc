---
schemaVersion: 1
id: adr-hybrid-git-d1-owner-scoped-state
revision: 1
type: adr
status: accepted
title: Move Interview Arc live state and publishing to Cloudflare D1
repository: interview-arc
capabilityIds: ["arc-hybrid-git-d1-state"]
createdAt: 2026-07-20
reconstructed: true
confidence: high
unknowns: ["An explicit linked issue was not exposed.","Attachment bodies and workflow logs were not quoted."]
modules: ["web:agents","HTTP:mutations","HTTP:routes","HTTP:state","web:content-types","web:current-day"]
interfaces: [".github/workflows/deploy.yml","app/api/mutations/route.ts","app/api/route-helpers.ts","app/api/state/route.ts","app/live-types.ts","docs/contracts/website-draft.md"]
seams: ["web/Worker \u2194 owner-scoped D1","reviewed commit \u2194 CI/release workflow"]
adapters: ["app/home-client.tsx","docs/architecture/repository-layout.md","scripts/build-content-index.mjs","scripts/content-source.mjs","scripts/import-content.mjs","worker/index.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-hybrid-git-d1-state"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #2","url":"https://github.com/Vinosaamaa/interview-arc/pull/2","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:2","head-commit:0a6dfc3f44ab10d4568ae3eb2f0b8cdf1bdb440f","merge-commit:1ef018c2b1b2c80b79ce1a4a2ce72ee293eed928"]}
visibility: public-safe
publicationEligibility: eligible
issue: null
pr: 2
release: null
run: null
---
# Move Interview Arc live state and publishing to Cloudflare D1

Evidence-indexed reconstruction of pull request #2. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

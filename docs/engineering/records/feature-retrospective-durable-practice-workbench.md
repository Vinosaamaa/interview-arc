---
schemaVersion: 1
id: "feature-retrospective-durable-practice-workbench"
revision: 1
type: "feature-retrospective"
status: "released"
title: "Add durable specialist publishing workflow"
repository: "interview-arc"
capabilityIds: ["arc-durable-practice-workbench"]
createdAt: "2026-07-21"
reconstructed: true
confidence: "high"
unknowns: ["An explicit linked issue was not exposed.","Attachment bodies and workflow logs were not quoted."]
modules: ["HTTP:audio/[id]","HTTP:audio","HTTP:mutations","web:content-types","web:globals","web:home-client"]
interfaces: ["app/api/audio/[id]/route.ts","app/api/audio/route.ts","app/api/mutations/route.ts","app/live-types.ts","docs/contracts/activity.schema.json","docs/contracts/durable-practice-publishing.md"]
seams: ["web/Worker \u2194 owner-scoped D1","specialist MCP \u2194 durable D1 state","Git narrative content \u2194 runtime projection"]
adapters: [".agents/skills/interview-arc-system-design/SKILL.md",".agents/skills/interview-arc-system-design/agents/openai.yaml",".agents/skills/interview-arc-system-design/references/reference-preflight.md",".agents/skills/interview-arc-system-design/references/solution-template.md","app/home-client.tsx","db/review-cadence.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-durable-practice-workbench"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #15","url":"https://github.com/Vinosaamaa/interview-arc/pull/15","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:15","head-commit:7e26dbe14c55d1182a429956447b2b0f899f68c9","merge-commit:92bddcfdaf47f0db77ff0641fecadbe62314103f"]}
visibility: "public-safe"
publicationEligibility: "eligible"
issue: null
pr: 15
release: null
run: null
---
# Add durable specialist publishing workflow

Evidence-indexed reconstruction of pull request #15. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

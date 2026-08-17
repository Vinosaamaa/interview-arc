---
schemaVersion: 1
id: feature-retrospective-structured-code-attempt-review
revision: 1
type: feature-retrospective
status: released
title: Require structured reviews for every Code Attempt
repository: interview-arc
capabilityIds: ["arc-structured-code-attempt-review"]
createdAt: 2026-08-03
reconstructed: true
confidence: high
unknowns: ["Attachment bodies and workflow logs were not quoted."]
modules: ["HTTP:practice-record","web:home-client","web:interview-arc-v2","web:live-types","D1:code-attempt-review","D1:durable-practice"]
interfaces: ["app/api/practice-record/route.ts","app/live-types.ts","docs/contracts/code-attempt-reviews.md","drizzle/0020_code_attempt_reviews.sql","drizzle/meta/_journal.json"]
seams: ["web/Worker \u2194 owner-scoped D1","specialist MCP \u2194 durable D1 state","Git narrative content \u2194 runtime projection"]
adapters: ["app/home-client.tsx","app/interview-arc-v2.css","db/code-attempt-review.ts","docs/contracts/code-attempt-reviews.md","drizzle/0020_code_attempt_reviews.sql","mcp-worker/code-attempt-review-schema.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-structured-code-attempt-review"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #132","url":"https://github.com/Vinosaamaa/interview-arc/pull/132","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:132","head-commit:6ed43a2cfcea24559f748c5b917340082f8e0b45","merge-commit:4d704faf488963b36b20227ecaeaee6d819fe3e9"]}
visibility: public-safe
publicationEligibility: eligible
issue: 131
pr: 132
release: null
run: null
---
# Require structured reviews for every Code Attempt

Evidence-indexed reconstruction of pull request #132. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

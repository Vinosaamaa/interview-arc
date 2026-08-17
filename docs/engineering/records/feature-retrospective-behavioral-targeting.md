---
schemaVersion: 1
id: feature-retrospective-behavioral-targeting
revision: 1
type: feature-retrospective
status: released
title: Persist owner-private behavioral Target Profiles
repository: interview-arc
capabilityIds: ["arc-behavioral-targeting"]
createdAt: 2026-08-10
reconstructed: true
confidence: high
unknowns: ["Attachment bodies and workflow logs were not quoted.","Sensitive source values and nonessential risky evidence links were omitted."]
modules: ["D1:behavioral-target-profile","D1:durable-practice","D1:schema","MCP bridge","practice:behavioral","tooling:validate-mcp-tool-allowlist"]
interfaces: ["docs/contracts/behavioral-target-profiles.md","drizzle/0030_powerful_the_enforcers.sql","drizzle/meta/0030_snapshot.json","drizzle/meta/_journal.json"]
seams: ["specialist MCP \u2194 durable D1 state","Git narrative content \u2194 runtime projection"]
adapters: ["mcp-worker/index.ts","scripts/validate-mcp-tool-allowlist.mjs"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-behavioral-targeting"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #232","url":"https://github.com/Vinosaamaa/interview-arc/pull/232","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:232","head-commit:c0de41a85824ded9af7816e0a8a5437d1a5abad4","merge-commit:d713bbb9edbb29aee1d15348afa2be2883456f0a"]}
visibility: public-safe
publicationEligibility: eligible
issue: 229
pr: 232
release: null
run: null
---
# Persist owner-private behavioral Target Profiles

Evidence-indexed reconstruction of pull request #232. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

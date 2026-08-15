---
schemaVersion: 1
id: change-note-engineering-workspace-shell-and-hero
revision: 1
type: change-note
status: released
title: Polish the Engineering workspace shell and hero
repository: interview-arc
capabilityIds: ["engineering-journal", "website-navigation", "workspace-atmosphere"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["engineering-workspace", "workspace-shell"]
interfaces: ["workspace-switcher", "engineering-hero", "engineering-evidence-workbench"]
seams: ["workspace-to-destination", "engineering-hero-to-workbench", "workbench-to-compact-viewport"]
adapters: ["interview-arc-web", "engineering-journal-web"]
relatedRecords: ["architecture-review-engineering-evidence-workbench@1", "adr-workspace-atmosphere-token-boundary@1"]
decisions: []
incidents: []
features: []
capabilities: ["centered-workspace-switching", "bounded-engineering-workbench", "responsive-engineering-orientation"]
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #329","url":"https://github.com/Vinosaamaa/interview-arc/issues/329","kind":"issue"},{"label":"Pull request #338","url":"https://github.com/Vinosaamaa/interview-arc/pull/338","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:329","pull-request:338","tests/website-ui-regressions.test.mjs","tests/engineering-journal.test.mjs","tests/learn-workspace-ui.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 329
pr: 338
release: null
run: null
---
# Polish the Engineering workspace shell and hero

The Engineering workspace now opens with a fixed-height, factual orientation surface and a centered semantic switcher for Interview, Learn, and Engineering. The hero uses a code-native terrain sketch, destination accent tokens, and evenly distributed counters before the evidence workbench.

## Workbench boundary

The Journal remains a bounded three-panel evidence surface. The record index, authoritative reader, and evidence rail keep their independent surfaces and pointer affordances, while compact layouts preserve the readable panel within the viewport instead of exposing a collapse-and-restore dashboard control.

## Verification

Focused website, Journal, and Learn regressions pass together. Targeted ESLint reports no errors, and the hosted validation lane verifies the D1/content-import, lint, build, and test path before release.

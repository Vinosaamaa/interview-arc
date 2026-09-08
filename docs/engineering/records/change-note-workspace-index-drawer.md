---
schemaVersion: 1
id: change-note-workspace-index-drawer
revision: 1
type: change-note
status: "released"
title: "Keep the reader behind a closable Index panel"
repository: "interview-arc"
capabilityIds: ["website-navigation","engineering-workspace"]
createdAt: "2026-09-08T01:15:00Z"
reconstructed: false
confidence: "verified"
unknowns: []
modules: ["website-navigation","engineering-workspace"]
interfaces: ["review-queue","problem-banks","engineering-record-reader","engineering-statistics"]
seams: []
adapters: []
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: ["change-note-workspace-minimum-results-height@1"]
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #341","url":"https://github.com/Vinosaamaa/interview-arc/issues/341","kind":"issue"}]
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 341
pr: 437
release: null
run: null
verification: {"state": "verified", "evidenceRefs": ["issue:341", "64 focused UI, Review and Bank checks passed; changed component lint passed."]}
---
# Keep the reader behind a closable Index panel

On compact screens, opening Engineering Index replaced the entire reader and offered no Close control. Reviews and Banks also needed the owner-requested 580px minimum instead of 480px.

## Change

At widths up to 1600px, Index opens as a left-side panel with the same bounded width as Evidence. The reader remains underneath. Close and Escape return focus to the Index button; choosing a record closes Index and displays that record. Opening either side panel closes the other. Search, empty-result recovery, and the merged-PR layer remain available. Wider windows retain the existing columns.

Reviews and Banks reserve at least 580px for their results panes while allowing the document to grow and scroll. Larger available results heights continue to expand normally.

## Verification

Focused checks cover existing UI, Reviews, Banks, and document-scroll behavior. Browser validation checks both 580px minimums, larger desktop heights, drawer dismissal and selection, empty-result recovery, and resizing. Required hosted checks and deployment remain separate release evidence.

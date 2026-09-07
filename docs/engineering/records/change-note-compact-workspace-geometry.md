---
schemaVersion: 1
id: change-note-compact-workspace-geometry
revision: 1
type: change-note
status: "released"
title: "Keep compact workspace results and Engineering readers usable"
repository: "interview-arc"
capabilityIds: ["website-navigation","engineering-workspace"]
createdAt: "2026-09-07T23:12:25Z"
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
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #341","url":"https://github.com/Vinosaamaa/interview-arc/issues/341","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:341","tests/website-ui-regressions.test.mjs, tests/review-queue.test.mjs and tests/bank-navigation-performance.test.mjs: 60 tests passed.","Isolated browser measurements at 1920x1080, 1366x768, 1024x768 and 390x844: compact panes measure 480 pixels, no horizontal page overflow, and wide Reviews and Banks geometry equals the baseline with the new stylesheet disabled.","Lint completed with zero errors; existing warnings remain."]}
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 341
pr: null
release: null
run: null
---
# Keep compact workspace results and Engineering readers usable

Short and narrow windows squeezed Reviews and Banks into the remaining viewport height. Engineering readers retained oversized headings while three columns competed for width; Statistics flex headers could shrink into their contents.

## Change

Reviews and Banks use 480-pixel results panes with normal page scrolling at widths up to 1280 pixels or heights up to 820 pixels. Outside that condition their existing desktop geometry remains intact. Engineering moves evidence behind the existing Evidence control at 1600 pixels, reuses the existing Index interaction at 1100 pixels, and sizes titles to their reader container. Statistics headers keep their text height, columns adapt to available width, and compact panels retain a bounded scrolling surface. Compact navigation clears the final Review actions; below 600 pixels, workspace tabs use their own toolbar row to keep every label visible. Ambient rain, palette, and contrast are unchanged.

## Verification and delivery

tests/website-ui-regressions.test.mjs, tests/review-queue.test.mjs and tests/bank-navigation-performance.test.mjs: 60 tests passed.

Isolated browser measurements at 1920x1080, 1366x768, 1024x768 and 390x844: compact panes measure 480 pixels, no horizontal page overflow, and wide Reviews and Banks geometry equals the baseline with the new stylesheet disabled.

Lint completed with zero errors; existing warnings remain.

Local checks establish the implementation behavior. Hosted validation and merge remain separate delivery steps.

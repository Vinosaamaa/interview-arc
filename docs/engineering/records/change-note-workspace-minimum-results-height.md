---
schemaVersion: 1
id: change-note-workspace-minimum-results-height
revision: 1
type: change-note
status: "released"
title: "Keep results usable across window sizes"
repository: "interview-arc"
capabilityIds: ["website-navigation","engineering-workspace"]
createdAt: "2026-09-08T00:26:02Z"
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
amends: ["change-note-compact-workspace-geometry@1"]
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #341","url":"https://github.com/Vinosaamaa/interview-arc/issues/341","kind":"issue"}]
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 341
pr: null
release: null
run: null
verification: {"state": "verified", "evidenceRefs": ["issue:341", "60 focused UI, Reviews and Banks tests passed.", "Real-browser resize sequence from 390 to 1920 CSS pixels with seven synthetic Review rows, populated Banks, independent wheel scrolling, and Engineering panel interactions.", "At 1920x1440, Reviews retain 773px and Banks retain 693px results heights. Shorter windows retain at least 480px."]}
---
# Keep results usable across window sizes

The first compact-layout repair applied only below viewport thresholds. A window just outside those thresholds still squeezed the results. A fractional Reviews filter column could also be narrower than its nonwrapping controls.

## Change

Reviews and Banks now reserve a minimum 480-pixel results height at every viewport size. Results are size-contained so their content scrolls within the pane; the document grows when the hero, controls, results, and footer cannot fit. Taller windows continue to allocate spare height to results. The document owns outer scrolling, preserving sticky navigation.

Engineering collapses its existing Index interaction at the same 1600-pixel breakpoint as Evidence. Panel buttons share the contents-tab row. Tabs scroll horizontally within their own area when necessary. Crossing into compact mode restores the selected record, while the Journal receipts layer stays available. Reviews filters use their intrinsic width and wrap within their toolbar on narrow phones.

## Verification

The browser sequence covers short windows beyond the original thresholds, repeated resizing in both directions without a reload, populated results and real wheel scrolling. Existing large-screen horizontal geometry and tall-screen results heights are retained. Focused automated checks and lint supplement the browser checks; hosted CI and deployment remain separate delivery receipts.

The missed acceptance conditions are documented in `docs/postmortems/2026-09-07-responsive-results-acceptance.md`.

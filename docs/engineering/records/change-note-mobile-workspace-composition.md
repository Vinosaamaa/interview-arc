---
schemaVersion: 1
id: change-note-mobile-workspace-composition
revision: 1
type: change-note
status: "released"
title: "Give phones a compact workspace and preserve readable desktop controls"
repository: "interview-arc"
capabilityIds: ["website-navigation","engineering-workspace"]
createdAt: "2026-09-09T10:45:00Z"
reconstructed: false
confidence: "verified"
unknowns: ["Physical iPhone keyboard and safe-area acceptance remains outstanding."]
modules: ["website-navigation","engineering-workspace"]
interfaces: ["workspace-navigation","review-queue","problem-banks","engineering-record-reader"]
seams: []
adapters: []
relatedRecords: ["change-note-iphone-workspace-ui@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #347","url":"https://github.com/Vinosaamaa/interview-arc/issues/347","kind":"issue"}]
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 347
pr: null
release: null
run: null
verification: {"state":"verified","evidenceRefs":["issue:347","66 focused navigation, Review Queue, Practice Record and Solution Profile regressions passed.","WebKit checks passed across all 17 workspace destinations at 440x956, including dialog hit testing and Engineering drawer scroll stability.","Chromium resize checks from 375 to 1920 CSS pixels preserved document bounds; 1366px topic labels now retain their full measured text width.","Synthetic WebKit code reader retained a 440px document and a separately scrolling long code line."]}
---
# Give phones a compact workspace and preserve readable desktop controls

The previous phone view retained large desktop banners, dense action clusters,
and multiple responsive rules acting on the same components. On narrower
desktop panes, three equal topic columns squeezed some labels into 16 pixels.

## Change

The approved mobile reference uses short headings, a single compact application
bar, and four primary destinations plus More. Secondary list actions remain
available in native modal sheets with outside dismissal, Escape, focus return,
and reduced-motion-aware transitions. Existing actions still call their original
handlers. Reviews and Banks keep the 580px results minimum and outer scrolling.

Phone readers use one text gutter and 17px prose. Code retains 15px type,
horizontal scrolling, optional wrapping and copy controls. Removing the old
group clipping permits full-width code without cutting off its first characters.

Phone composition is consolidated in `app/mobile-workspace.css`. Shared
containment stays in `app/workspace-responsive.css`; the desktop topic ribbon
adapts to its container width. The wide desktop visual system is preserved.

## Verification and delivery

The approved reference is retained in `docs/design/mobile-workspace/`.
`scripts/check-mobile-ui.mjs` covers the actual workspace destinations, phone
navigation, filters, modal hit testing and populated reader bounds. The
interaction-only mode avoids repeating completed route checks during a focused
correction. Synthetic content is confined to local browser responses.

Local emulation and focused tests establish the checked behavior. They do not
claim physical-device acceptance or substitute for the separate CI and release
receipts.

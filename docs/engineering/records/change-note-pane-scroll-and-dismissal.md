---
schemaVersion: 1
id: change-note-pane-scroll-and-dismissal
revision: 1
type: change-note
status: "released"
title: "Keep pane scrolling natural and drawer controls stable"
repository: "interview-arc"
capabilityIds: ["website-navigation","engineering-workspace"]
createdAt: "2026-09-08T02:24:53Z"
reconstructed: false
confidence: "verified"
unknowns: []
modules: ["website-navigation","engineering-workspace","practice-readers","interview-loops"]
interfaces: ["review-queue","problem-banks","engineering-record-reader"]
seams: []
adapters: []
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: ["change-note-workspace-index-drawer@1"]
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
verification: {"state": "verified", "evidenceRefs": ["issue:341", "64 focused UI, Reviews, Banks and document-scroll tests passed.", "Browser checks confirm hover contrast, outside dismissal, stable outer scroll at 390-1920px widths, and native wheel chaining at both ends of Reviews, Banks and the Engineering reader."]}
---
# Keep pane scrolling natural and drawer controls stable

A historical Index hover rule replaced the Close button background with white while its new text remained white. Engineering contents links used scrollIntoView, which moved ancestor scrolling containers as well as the reader. Programmatic drawer focus could also move the outer page. Several embedded panes explicitly contained vertical overscroll, preventing the page from continuing at a boundary.

## Change

Close buttons retain their accent background and readable foreground through hover, keyboard focus, and active states. At compact widths, pointer clicks outside Index and Evidence dismiss the open drawer without redirecting focus away from the clicked target. Inside interactions and drawer toggles retain their own behavior.

Drawer focus uses preventScroll. Contents navigation scrolls only the Engineering reader, accounts for its sticky toolbar, and sends Overview to the reader top. Reduced motion is honored.

Reviews, Banks, Engineering panes, Loop preparation/switcher lists, inline code, and embedded diagrams allow native vertical scroll chaining to their containing page or reader. Full-screen readers and dialogs retain their existing locks. The 580px result minimum, desktop columns, and drawer animations remain in place.

## Verification

Focused tests, lint, and real-browser interactions cover the reported hover state, outside clicks, unchanged outer-page position, and wheel scrolling within panes followed by handoff at both ends. Required hosted validation and deployment are separate release evidence.

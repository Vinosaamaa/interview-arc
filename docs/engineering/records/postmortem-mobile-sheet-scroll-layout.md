---
schemaVersion: 1
id: postmortem-mobile-sheet-scroll-layout
revision: 1
type: postmortem
status: closed
title: Isolate action sheets and constrain long mobile code
repository: interview-arc
capabilityIds: ["arc-connected-practice"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["Physical iPhone Safari acceptance remains with the owner.", "The separately reported production Worker resource-limit recurrence remains unresolved; these presentation changes do not fix it."]
modules: ["website-navigation", "practice-readers", "today-workbench"]
interfaces: ["mobile-secondary-actions", "code-viewer", "practice-session"]
seams: ["Native top-layer painting versus DOM style inheritance", "Long code versus grid minimum size", "Desktop controls versus compact activity rows"]
adapters: ["app/mobile-sheet.tsx", "app/mobile-workspace.css", "app/today-activity-row.tsx", "app/today-workbench.css"]
relatedRecords: ["postmortem-mobile-reader-content-overflow@1", "postmortem-mobile-entry-render-cost@1"]
decisions: []
incidents: []
features: []
capabilities: ["arc-connected-practice"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Mobile audit #347","url":"https://github.com/Vinosaamaa/interview-arc/issues/347","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["scripts/check-mobile-ui.mjs", "scripts/check-mobile-readers.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 347
pr: null
release: null
run: null
---
# Isolate action sheets and constrain long mobile code

Phone secondary actions inherited section layout, expanded long code could not scroll vertically, and Today retained redundant desktop controls and instructions. These failures survived earlier destination and short-code checks.

## Confirmed causes

A native dialog enters the browser's top layer without leaving its DOM ancestors. Review timeline heading rules therefore rotated the dialog title. The sheet now mounts under the document body, preserving native focus containment and dismissal while isolating its presentation. Click propagation stops at the dialog so closing cannot activate the originating row. Status labels now contribute to their action row's height.

In WebKit at 440 by 800, a 120-line expanded code fixture produced a 3,072-pixel dialog and a code viewport as tall as its content. Setting vertical scroll had no effect. A zero-minimum grid track and a constrained dialog now keep the viewer at 800 pixels; its code viewport scrolls in both directions. Inline code owns its own scrolling instead of competing with a horizontal scroll container around it.

Reviews retained empty desktop grid tracks after mobile children were hidden. The selection footer now sizes to its visible content. In the activity picker, a sticky footer overlaid questions; a bounded question list now precedes a normal-flow footer. Phone tools expose explicit Off, Petals, and Rain settings with the existing persisted preference.

## Today composition

Coding, system-design, behavioral, and standalone activities share a compact title-and-status row. Session heading, countdown, and options stay together. Activity clocks and controls do not wrap. Narrow layouts keep start/pause beside the title and put secondary controls and full prompt/reference content in the action sheet; those details also remain accessible on desktop. The requested Choose mode, Coding Problem, and Finish to journal presentation is removed. Timer, result, and publication storage semantics are unchanged.

## Verification and limits

Focused browser checks cover atmosphere persistence, question/footer separation, sheet ancestry and heading direction, review footer height, and populated Today rows at 375, 440, 1,000, and 1,920 pixels. Reader fixtures now contain 100 long lines and check both scroll axes in inline and expanded views, copying, wrapping, nested close, and breakpoint changes across specialties and entry paths. One outer prose gutter is permitted; nested reader gutters are not.

This change contains no Worker, authentication, database, or deployment-limit changes. The repeated production resource-limit report remains a separate unresolved acceptance item on issue #347. Reverting this presentation change restores the preceding layout without a data migration.

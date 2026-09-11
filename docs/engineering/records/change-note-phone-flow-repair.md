---
schemaVersion: 1
id: change-note-phone-flow-repair
revision: 1
type: change-note
status: accepted
title: Restore ordinary phone scrolling and explicit review selection
repository: interview-arc
capabilityIds: ["website-navigation", "engineering-workspace"]
createdAt: "2026-09-10T23:54:00Z"
reconstructed: false
confidence: verified
unknowns: ["Physical iPhone Safari safe-area and keyboard acceptance remains outstanding.", "The original response behind the reported Safari parse error was not captured."]
modules: ["website-navigation", "engineering-workspace", "practice-readers", "today-workbench"]
interfaces: ["review-queue", "workspace-navigation", "engineering-record-reader"]
seams: []
adapters: []
relatedRecords: ["change-note-mobile-workspace-composition@1", "postmortem-phone-flow-recurrence@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #347","url":"https://github.com/Vinosaamaa/interview-arc/issues/347","kind":"issue"}]
visibility: public-safe
publicationEligibility: eligible
issue: 347
pr: null
release: null
run: null
verification: {"state":"verified","evidenceRefs":["scripts/check-phone-flow.mjs", "scripts/check-mobile-ui.mjs", "scripts/check-mobile-readers.mjs", "tests/behavioral-target-response.test.mjs"]}
---
# Restore ordinary phone scrolling and explicit review selection

At 600 CSS pixels and below, Banks and Reviews now scroll with the document and
reserve no fixed empty list pane. Reviews plus buttons collect a selection;
the top cart shows complete titles and an explicit Add selected to Today action.
Selection survives an offline enqueue or rejected save. Only authoritative
confirmation or explicit removal clears an item. Desktop keeps its bounded list
and selection folio.

Reloading restores pending selection from the existing persisted write queue;
Add stays disabled for those items, and reconnect replays the same operation ID.

Banks loads additional questions as the document reaches its results sentinel.
Its remembered list position includes the mounted count so returning from a
reader or another destination can restore a position beyond the first batch.

Engineering's record is a normal phone document, with full-screen Index and
Evidence subviews. Index scroll survives closing and reopening. Phone readers
omit the desktop master-list toggle. Loop Role context and Linked preparation
start collapsed; Journey metrics and Materials sections have less nested chrome.
Existing Arc typography and specialty colors remain the design foundation.

The Today action sheet gives the result control the full available width. Dock
clearance derives from one safe-area value. Decorative atmosphere is hidden
after arrival on phones without changing the saved preference or desktop view.

Saved role-context reads handle non-JSON responses before parsing. Schema and
network failures show a concise reconnect/retry message and preserve previously
known context. Historical context is available in a collapsed details section;
normal Today does not show a migration banner.

## Validation boundary

The regressions use synthetic browser responses against an isolated local
preview. They cover both successful and rejected queued selection writes,
phone document geometry, safe-area simulation, response recovery, and retained
context. Existing phone route and reader suites cover navigation and long code.
Engine emulation is distinct from physical-device, headed-browser, CI, and
release acceptance. No owner practice data is changed by this repair.

Local Chromium and WebKit checks passed with 390×844 phone viewports, smaller
viewport resizing, and a 1,000-pixel desktop boundary. The 17-destination mobile
suite passed in both engines at 440×956. A separate WebKit reader check passed
phone/desktop transitions and restoration from a scrolled Past page. The
production application build, lint, and 17 focused policy/source regressions
passed. The new journal documents require a committed source revision before
the normal journal build can publish them; that gate remains intact.

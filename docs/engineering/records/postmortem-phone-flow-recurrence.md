---
schemaVersion: 1
id: postmortem-phone-flow-recurrence
revision: 1
type: postmortem
status: closed
title: Verify complete phone flows after mobile layout repairs
repository: interview-arc
capabilityIds: ["website-navigation", "engineering-workspace"]
createdAt: "2026-09-10T23:54:00Z"
reconstructed: false
confidence: verified
unknowns: ["The original production response that produced the Safari SyntaxError was not captured.", "Physical iPhone browser chrome and keyboard behavior are not established by engine emulation."]
modules: ["website-navigation", "engineering-workspace", "practice-readers", "today-workbench"]
interfaces: ["review-queue", "mobile-secondary-actions", "engineering-record-reader"]
seams: ["Desktop containment versus phone document scrolling", "Queued writes versus durable confirmation", "HTTP response body versus typed context reader"]
adapters: ["app/mobile-workspace.css", "app/mobile-sheet.tsx", "app/behavioral-target-response.ts"]
relatedRecords: ["postmortem-mobile-sheet-scroll-layout@1", "change-note-phone-flow-repair@1"]
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
pr: 466
release: null
run: null
verification: {"state":"verified","evidenceRefs":["scripts/check-phone-flow.mjs", "scripts/check-mobile-ui.mjs", "tests/behavioral-target-response.test.mjs"]}
---
# Verify complete phone flows after mobile layout repairs

The next owner phone review found a collapsed Today result label, spare dock
space, desktop list containment, immediate Review additions, nested Loop panels,
and Engineering drawers competing with its reader. Previous mobile fixes had
passed narrower checks without establishing the requested complete phone flow.

## Confirmed mechanisms

The result button was widened inside the sheet while its wrapper still had a
52-pixel width. Banks retained a 580-pixel inner scrolling region with size
containment; the old acceptance script explicitly required that minimum on
phones. Reviews plus called the Today mutation directly and its selection
folio remained at the bottom. Engineering kept a viewport-height workbench and
360-pixel overlay panels. These are source and local-browser observations.

The role-context client called `response.json()` without checking the response
type. A synthetic HTML response in WebKit reproduces exactly “The string did
not match the expected pattern.” This proves a matching failure mechanism;
an authentication redirect as the original production trigger remains a
hypothesis because that response was not captured.

The dock had seven pixels of bottom padding even with a zero safe area, while
page clearance was independently hard-coded. The repair uses one safe-area
value and derives page clearance from dock height. Engine simulation can check
box arithmetic but cannot prove physical Safari toolbar or keyboard behavior.

## Why the earlier checks missed it

The tests encoded the former 580-pixel phone requirement, covered a short or
empty Reviews page, and checked action-sheet presence without measuring the
result wrapper. A usable selection cart and its rejected-save recovery were not
tested as one flow. Engineering drawer visibility did not establish ordinary
document scrolling or full-screen navigation. These gaps allowed passing
checks to coexist with the owner's reported layout and interaction problems.

## Correction and prevention

Issue #347 owns the correction. Phone contracts now explicitly require document
scrolling, selection before mutation, full-screen auxiliary navigation, and
collapsed optional Loop content. The focused browser fixture checks populated
lists, full cart titles, zero writes from plus, rejected saves retaining selection,
explicit retry, and clearing only after owner-state confirmation. It measures
the result width, zero/34-pixel safe-area geometry, smaller visual viewports,
metric clipping, search width, and every collapsed Loop body child.

Independent review during this repair caught a server/client phone-tree mismatch,
premature cart clearing, lost Index scroll, a Loop selector-order conflict, and
clipped metrics. Those findings were corrected before delivery. Response tests
cover HTML, malformed JSON, schema-invalid JSON, valid API errors, retained
known bindings, and recovery. Physical acceptance and release receipts remain
separate gates; this document does not claim them.

Independent bottom-of-list review also caught a regression introduced while
removing inner scrolling: Banks still loaded its next batch only from the old
list scroll event. A viewport sentinel now drives phone loading, and the test
reaches every matching question beyond the first 36. Changing scroll ownership
must include paging and restoration, not only overflow measurements.

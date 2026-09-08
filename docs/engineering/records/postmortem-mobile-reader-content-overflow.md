---
schemaVersion: 1
id: postmortem-mobile-reader-content-overflow
revision: 1
type: postmortem
status: closed
title: Keep populated mobile readers within the visible screen
repository: interview-arc
capabilityIds: ["arc-connected-practice"]
createdAt: 2026-09-08
reconstructed: false
confidence: verified
unknowns: ["Physical iPhone Safari acceptance remains with the owner."]
modules: ["website-navigation", "practice-readers"]
interfaces: ["solution-profile-reader", "practice-record-reader", "code-viewer"]
seams: ["Long code content to CSS grid sizing", "Visible viewport to focused reader"]
adapters: ["app/workspace-responsive.css", "app/use-mobile-reader-viewport.ts", "app/code-block.tsx"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-connected-practice"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Mobile audit #347","url":"https://github.com/Vinosaamaa/interview-arc/issues/347","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["scripts/check-mobile-readers.mjs", "scripts/check-mobile-ui.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 347
pr: null
release: null
run: null
---
# Keep populated mobile readers within the visible screen

Constrain populated phone readers to the visible screen, preserve the originating page position, and make long code readable without clipping surrounding prose.

## Impact and cause

The initial mobile audit exercised destination pages and a short attempt, but did not cover populated nested solutions with long code. Owner screenshots showed clipped prose, a right gutter, and application navigation competing with the reader.

A local WebKit reproduction measured a reader group wider than 1,200 pixels inside a 440-pixel viewport. The grid's automatic minimum track size inherited the longest code line; the outer reader then hid the overflow. A more specific nested-reader width also retained a desktop gutter. Phone readers reserved space for both application navigation bars, leaving less space for the document and relying on layout-viewport offsets when browser bars changed.

## Repair

Reader grid tracks can shrink to the available width. Long code scrolls within its own block, with an optional Wrap control; Copy retains the source. Code attempts use the shared syntax renderer. Phone prose uses 16-pixel type and code 15-pixel type, with 44-pixel code controls. Expanding code preserves its occupied height and restores focus without moving the document.

The phone reader owns the visible viewport and hides the application navigation while open. Its toolbar remains available. A phone-only body lock preserves the originating page position, follows visible-viewport changes, and releases when the reader closes or the layout returns to desktop. Nested solutions keep the same lock. Existing content receives these changes without rewriting stored records.

## Verification and prevention

The local browser regression uses synthetic read responses, never private production data. It exercises Coding, System Design, and Behavioral solutions from Banks, Past, and Reviews; long prose, inline code, tables, syntax contrast, horizontal scrolling, Wrap, Copy, Expand, Escape, nested closing, and multiple phone heights. Desktop checks cover 1280- and 1920-pixel widths and crossing the phone breakpoint. The destination audit continues to cover all 17 routes and 580-pixel minimum results panes.

Acceptance must include populated and nested reader states, not only destination screenshots or empty artifacts. Emulated WebKit is useful evidence, but is not a claim that physical iPhone Safari browser-bar behavior was tested. The owner retains final device acceptance under issue #347. Rollback reverts the reader layout, viewport hook, and code controls together; no data migration is involved.

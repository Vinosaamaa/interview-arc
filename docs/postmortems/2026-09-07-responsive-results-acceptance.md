# Responsive results acceptance gap

## Impact and detection

After PR #434 deployed, the owner supplied screenshots showing Reviews/Banks still squeezed in medium-height desktop windows, Reviews filters outside their panel, and Engineering controls using unnecessary rows. Issue #341 was reopened.

## Root cause

The initial fix used width/height media queries instead of a results minimum that applies to every viewport. The checked compact sizes passed, but 1536x864 and 1440x900 were outside the fix. Reviews filters also used a fractional column with an intrinsic width larger than the assigned track. Declaring both the body and document scrollable prevented sticky navigation from following the actual page scroll.

## Repair

Reserve at least 480 pixels for each results pane and allow normal document scrolling. Use size containment to prevent populated lists from expanding without bounds. Give filter controls their intrinsic width. Collapse Engineering Index at the Evidence breakpoint, keep panel actions alongside tabs, and preserve the receipts layer when resizing.

## Prevention and evidence

Verify populated Reviews, real Banks content, short desktop windows just beyond former breakpoints, and repeated resize sequences without reload. Check page scrolling and independent results scrolling separately. Compare ample-height desktop geometry with the previous implementation. The follow-up PR and issue resolution carry hosted CI and release evidence.

## Timeline and scope

- 2026-09-07: PR #434 deployed; owner reported incomplete visual acceptance.
- 2026-09-07: Issue #341 reopened for the focused follow-up.

No practice data, authentication, ambient effects, or repository gates are changed. This is a presentation repair. Exact request-submission timing was unavailable.

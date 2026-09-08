---
schemaVersion: 1
id: change-note-iphone-workspace-ui
revision: 1
type: change-note
status: "proposed"
title: "Make phone workspace navigation, dialogs, and readers usable"
repository: "interview-arc"
capabilityIds: ["website-navigation","engineering-workspace"]
createdAt: "2026-09-08T13:24:00Z"
reconstructed: false
confidence: "verified"
unknowns: ["Physical iPhone keyboard and safe-area behavior awaits device acceptance."]
modules: ["website-navigation","engineering-workspace"]
interfaces: ["review-queue","problem-banks","engineering-record-reader","workspace-navigation"]
seams: []
adapters: []
relatedRecords: ["change-note-workspace-minimum-results-height@1"]
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
verification: {"state":"verified","evidenceRefs":["issue:347","Local 440x956 browser audit of all 17 workspace destinations.","Synthetic populated Reviews, Past reader, Learn course tabs, and Add Loop dialog verification.","Tablet and desktop geometry comparison at 768, 1100, 1440, and 1920 CSS pixels."]}
---
# Make phone workspace navigation, dialogs, and readers usable

At 440 by 956 CSS pixels, seven destination buttons became tiny, navigation covered dialog actions, Bank filter menus extended below the viewport, and fixed readers retained offsets from an older header. Hero illustrations competed with copy, summary labels collided with controls, and Review outcome labels escaped their narrow cells.

## Change

Phone navigation uses readable rows with 44px targets. Dialogs appear above the dock; fixed readers and filter menus fit between header and navigation. Phone summary labels wrap, Bank add controls have dedicated space, Review metadata takes a full row, and Engineering facts stack. Decorative hero artwork is omitted on phones. Empty Learn indexes no longer reserve a large blank area. Inputs use 16px text.

All geometry changes are restricted to widths of 600px or less. The 580px minimum Reviews and Banks results heights, outer scroll chaining, and larger-screen allocation remain intact.

The audit also reproduced a hydration error after expanding Bank topics and refreshing. Workspace preferences previously changed the first client markup relative to the server. They now restore after hydration, with persistence gated until restoration finishes.

## Verification and delivery

The local browser check in `scripts/check-mobile-ui.mjs` covers all 17 destinations at iPhone 16 Pro Max CSS dimensions, dialog hit testing, filter bounds, preference restoration, stable Engineering drawer scroll positions, and populated reader bounds. Synthetic records stay in browser response fixtures; no personal practice records are written.

WebKit and Chromium emulation supplement visual inspection. They do not establish physical-device keyboard or safe-area acceptance. Hosted checks, merge, deployment, and device acceptance are separate delivery evidence.

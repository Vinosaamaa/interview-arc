---
schemaVersion: 1
id: postmortem-reader-group-render-storm
revision: 1
type: postmortem
status: closed
title: Reader Group Persistence Render Storm
repository: interview-arc
capabilityIds: ["practice-readers", "website-reliability"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["practice-readers", "reader-render-diagnostics"]
interfaces: ["reader-group-memory", "practice-record-reader"]
seams: ["native-details-to-reader-memory", "practice-record-hydration-to-reader"]
adapters: ["website-reader", "session-storage-reader-memory"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["reader-render-tracing", "non-rendering-reader-memory"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #191","url":"https://github.com/Vinosaamaa/interview-arc/issues/191","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:191","tests/reader-memory.test.mjs","tests/rendered-html.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 191
pr: 325
release: null
run: null
---
# Reader Group Persistence Render Storm

An intermittently visible flash occurred while an owner-private Practice Record reader remained open. The reader did not unmount, hide, or lose opacity in the captured failure window, so treating the incident as a route transition or compositor failure would have targeted the wrong boundary.

## Impact

The reader could visibly stall or flash after its durable Practice Record arrived. The effect was intermittent because its severity depended on the number and timing of native disclosure-group toggle events, React commits, and adjacent main-thread work.

No durable record, transcript, audio, reader position, or owner-private content was lost. The failure affected presentation continuity, not record authority.

## Evidence and root cause

The production-safe diagnostic ring buffer recorded a mounted reader with stable visual state while a Practice Record hydration window produced repeated React commits and main-thread tasks longer than one frame budget. The cluster aligned with the reader's native `details` elements opening during hydration.

Each native disclosure-group `toggle` persisted its open state through a root-level React state setter. A reader with several groups therefore rerendered the entire application once per group even though the browser already owned the visible disclosure state. Late Practice Record hydration made those redundant commits cluster closely enough to become visible.

## Repair

Reader group state is now persistence metadata held by a ref and mirrored directly to owner-local session storage. A native single-group toggle updates that metadata without scheduling a React render. Expand-all and collapse-all compute one atomic memory update and set the existing native elements directly, so replayed toggle events are idempotent.

Reader identity changes and unrelated application renders still restore the latest persisted group state. Scroll position and anchor memory remain part of the same reader-local record.

## Verification

Pure tests prove that single-group and bulk updates are idempotent and preserve unrelated group, anchor, and scroll fields. Source-contract tests prevent a root `setReaderMemory` path from returning.

An isolated Chrome-for-Testing profile exercised the compiled local Worker against copied local D1 state. It opened a persisted attempt, hydrated its Practice Record, collapsed every group, closed and reopened the reader, verified the collapsed state, and expanded every group. The hydration window produced one React commit, with no browser console or page errors.

## Prevention

The diagnostic buffer now records a sanitized Practice Record hydration marker with only turn and code-attempt counts. Future reader incidents can distinguish data arrival from route, animation, visibility, and compositor events without capturing private content.

Reader-local browser state that does not change React output must remain outside root application state. New persistence hooks at native element seams require idempotency tests and a compiled-browser replay when they can affect reader continuity.

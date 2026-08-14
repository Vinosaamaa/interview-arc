---
schemaVersion: 1
id: postmortem-reader-group-render-storm-paint-continuity
revision: 1
type: postmortem
status: closed
title: Reader Paint Continuity After the Render Storm
repository: interview-arc
capabilityIds: ["practice-readers", "website-reliability"]
createdAt: 2026-08-14T14:42:54Z
reconstructed: false
confidence: high
unknowns: ["Production confirmation that the residual visible flash is eliminated."]
modules: ["practice-readers", "reader-render-diagnostics"]
interfaces: ["reader-group-memory", "practice-record-reader"]
seams: ["native-details-to-reader-memory", "practice-record-hydration-to-reader"]
adapters: ["website-reader", "session-storage-reader-memory"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["reader-render-tracing", "non-rendering-reader-memory"]
amends: ["postmortem-reader-group-render-storm@1"]
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
# Reader Paint Continuity After the Render Storm

An intermittently visible flash occurred while an owner-private Practice Record reader remained open. The first production-safe trace identified a reader-group persistence render storm. A later owner-marked trace, captured after resetting the recorder, contained no React commit, reader mount, visibility, opacity, layout-shift, long-task, or frame-gap event during the marked window. That second occurrence therefore exposed a separate residual paint path rather than another reader remount.

## Impact

The reader could visibly stall or flash after its durable Practice Record arrived. The original render storm depended on the number and timing of native disclosure-group toggle events, React commits, and adjacent main-thread work. The residual occurrence was intermittent while the full-viewport animated petal layer continued compositing behind the fixed reader.

No durable record, transcript, audio, reader position, or owner-private content was lost. The failure affected presentation continuity, not record authority.

## Evidence and root cause

The production-safe diagnostic ring buffer recorded a mounted reader with stable visual state while a Practice Record hydration window produced repeated React commits and main-thread tasks longer than one frame budget. The cluster aligned with the reader's native `details` elements opening during hydration.

Each native disclosure-group `toggle` persisted its open state through a root-level React state setter. A reader with several groups therefore rerendered the entire application once per group even though the browser already owned the visible disclosure state. Late Practice Record hydration made those redundant commits cluster closely enough to become visible.

The later trace froze only a manual marker because Reset cleared the rolling buffer without emitting a fresh visual baseline, and stable visual samples were omitted. Its absence of change events still ruled out a second instrumented DOM or React transition in the marked interval, but it could not by itself prove a browser compositor cause. The remaining high-risk paint boundary was the continuously animated, full-viewport petal layer behind the fixed reader.

## Repair

Reader group state is now persistence metadata held by a ref and mirrored directly to owner-local session storage. A native single-group toggle updates that metadata without scheduling a React render. Expand-all and collapse-all compute one atomic memory update and set the existing native elements directly, so replayed toggle events are idempotent.

Reader identity changes and unrelated application renders still restore the latest persisted group state. Scroll position and anchor memory remain part of the same reader-local record.

While any reader is mounted, the ambient petal layer is now immediately hidden and all petal animations are paused. The reader owns an opaque isolated paint surface, reducing cross-layer compositor work without unmounting the atmosphere or changing the owner’s preference. Closing the reader restores the existing atmosphere cheaply.

The opt-in recorder now emits a sanitized visual heartbeat every second. Reset records an immediate baseline; Mark flash captures the exact visual and animation counts before freezing the rolling window. No text, identifiers, or owner-private content enter these events.

## Verification

Pure tests prove that single-group and bulk updates are idempotent and preserve unrelated group, anchor, and scroll fields. Source-contract tests prevent a root `setReaderMemory` path from returning.

An isolated Chrome-for-Testing profile exercised the local Worker against disposable local D1 state. It opened a Bank reader and verified an opaque isolated reader surface, a hidden petal layer, zero running petal animations, and no browser errors. After Reset, the trace recorded `visual-baseline` and `visual-heartbeat`; Mark flash recorded `flash-capture` before the frozen marker.

Production confirmation remains open because a local compositor safeguard cannot prove that an intermittent production-only paint symptom is gone.

## Prevention

The diagnostic buffer records a sanitized Practice Record hydration marker with only turn and code-attempt counts, plus bounded visual and animation telemetry. Future reader incidents can distinguish data arrival from route, animation, visibility, and compositor events without capturing private content.

Reader-local browser state that does not change React output must remain outside root application state. New persistence hooks at native element seams require idempotency tests and a compiled-browser replay when they can affect reader continuity.

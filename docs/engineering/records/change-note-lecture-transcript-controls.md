---
schemaVersion: 1
id: change-note-lecture-transcript-controls
revision: 1
type: change-note
status: accepted
title: Navigate lectures with touch controls and original transcripts
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Physical phone touch acceptance", "One-hour background playback", "Kokoro in the ChatGPT iPhone host"]
modules: ["professor-lectures"]
interfaces: ["professor-lecture-api"]
seams: ["prepared-script-to-continuous-audio"]
adapters: ["device-local-speech"]
relatedRecords: ["architecture-review-device-lecture-speech@1"]
decisions: []
incidents: []
features: []
capabilities: ["continuous-prepared-lectures"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #473","url":"https://github.com/Vinosaamaa/interview-arc/issues/473","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/lecture-device-speech.test.mjs","tests/lecture-player-gestures.test.mjs","docs/design/professor-player/reference-notes.md"]}
visibility: public-safe
publicationEligibility: eligible
issue: 473
pr: 480
release: null
run: null
---
# Navigate lectures with touch controls and original transcripts

The released player exposed internal cursor counters and repetitive readiness
messages while hiding the lecture text. Listeners could not start at a passage
or use familiar gestures. The new player shows a single play/pause surface,
progress, transport and the original transcript. Settings contain actual local
voice choices and chapter navigation.

One shared gesture handler distinguishes tap, side double-tap, and temporary 2x
hold. Pointer movement, cancellation, lost focus and disposal restore the chosen
speed and suppress accidental taps. Keyboard activation and arrow-key seek remain
available. Rate and voice changes restart from the last reported text boundary.

Transcript passages retain exact source text and character offsets. Clicking one
persists its position through the existing revision guard before starting speech.
Bounded section retrieval preserves all original sections; following yields when
the listener scrolls. Estimated device-speech skips never pretend to have measured
audio timestamps. Existing recordings still support exact five-second audio skips.

Tests cover gesture conflicts, hold restoration, cancellation, cross-section skips,
original-text preservation, passage seek, replay and immediate voice/rate changes.
The isolated browser player completed real installed speech across two sections,
started from a selected transcript passage and accepted left/right double-clicks.
These observations do not establish physical-phone or one-hour acceptance.

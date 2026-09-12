---
schemaVersion: 1
id: architecture-review-device-lecture-speech
revision: 1
type: architecture-review
status: accepted
title: Read prepared lectures with free device-local speech
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Actual ChatGPT device-speech acceptance", "Physical mobile background and screen-lock continuity", "Measured one-hour listening duration"]
modules: ["professor-lectures"]
interfaces: ["professor-lecture-api"]
seams: ["prepared-script-to-continuous-audio"]
adapters: ["device-local-speech"]
relatedRecords: ["architecture-review-professor-lectures@1"]
decisions: []
incidents: []
features: []
capabilities: ["continuous-prepared-lectures"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #473","url":"https://github.com/Vinosaamaa/interview-arc/issues/473","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/lecture-device-speech.test.mjs","docs/contracts/professor-lectures.md"]}
visibility: public-safe
publicationEligibility: eligible
issue: 473
pr: 479
release: null
run: null
---
# Read prepared lectures with free device-local speech

The paid speech dependency did not meet the free-playback requirement. A real
short generation request returned HTTP 429. The default must work without a
paid speech provider.

The default player now uses an installed device voice through SpeechSynthesis.
Only voices advertising localService are eligible. The player does not connect
to a PC or substitute a remote speech provider. Kokoro or Piper on a separate
computer would require a new service and secure transport; that is unnecessary
when the listening host exposes its installed voices.

One shared controller drives the website and embedded widget. D1 remains the
owner-scoped source for immutable sections and revisioned position. The widget
receives one fragment privately and retrieves one section ahead. Bounded short
utterances preserve the original text and continue without model turns. Reported
word boundaries and completed sentences establish character position. Saves are
serialized; an unconfirmed save stops later writes and playback.

Unit tests cover exact text across automatic transitions, pause/resume at a
reported boundary, stale callback suppression, unavailable local voices and
conflicting saves. A real device voice completed a two-section isolated browser
fixture and saved its final character position. This is not acceptance inside
the actual ChatGPT host or on a locked mobile device.

No downloadable recording or exact total duration is claimed for device speech.
Previously generated recordings remain playable with the existing private media
grant. Rollback returns to the earlier player, whose paid provider requirement
does not satisfy free speech; it must not be represented as the free fallback.

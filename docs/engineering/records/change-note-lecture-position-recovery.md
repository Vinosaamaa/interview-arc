---
schemaVersion: 1
id: change-note-lecture-position-recovery
revision: 1
type: change-note
status: released
title: Recover lecture playback after a saved-position conflict
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Physical iPhone playback acceptance", "One-hour background playback"]
modules: ["professor-lectures"]
interfaces: ["professor-lecture-api"]
seams: ["prepared-script-to-continuous-audio"]
adapters: ["device-local-speech"]
relatedRecords: ["change-note-lecture-transcript-controls@1"]
decisions: []
incidents: []
features: []
capabilities: ["continuous-prepared-lectures"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #473","url":"https://github.com/Vinosaamaa/interview-arc/issues/473","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/lecture-player-recovery.test.mjs","tests/lecture-device-speech.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 473
pr: null
release: null
run: null
---
# Recover lecture playback after a saved-position conflict

A ChatGPT player can retain an older saved position while another player advances
the same lecture. The server correctly rejects its stale revision. The client
then blocks playback to protect newer progress, but previously hid the recovery
control in settings and displayed a raw host exception. A completed saved script
also reopened in a paused state and could finish again without speaking.

The embedded player now exposes Reload saved position beside a readable error.
It drains already dispatched writes, disposes the blocked controller and reads
fresh owner-scoped state. It never retries an old position with a newer revision.
Failed reads remain retryable. Disposal cancels queued writes and stale callback
notifications before the replacement controller starts. The website exposes a
page reload beside its device-speech error.

An explicit Play on a completed script saves the start position through the same
revision check, then speaks the first section. A reload itself never writes or
autoplays. This retains mobile user-gesture activation and the existing privacy
and concurrent-writer boundaries. Widget resource v4 requests the updated UI for
fresh opens; old ChatGPT message cards can retain cached code.

Regression tests execute the embedded script through its MCP message bridge with
an independent writer, a failed recovery read, successful recovery, and replay.
Controller tests cover pending-save drainage and cancellation of queued writes.
An isolated browser fixture also reproduced the visible conflict and resumed
real installed device speech after reloading the completed position.

The lesson is to pair any protective stop with a visible, safe recovery path.
Testing uses isolated fixtures so it cannot advance a listener's active lecture.
No speech provider, paid fallback, database schema or server revision rule changes.
Rollback restores the prior widget/controller; stored scripts and cursors remain
compatible. Native ChatGPT Live turn-ending controls remain outside this player.

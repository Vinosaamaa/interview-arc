---
schemaVersion: 1
id: change-note-learning-voice-timer-contract
revision: 1
type: change-note
status: released
title: Expose the Learning Session timer to Arc Voice
repository: interview-arc
capabilityIds: ["learning-workspace","arc-voice"]
createdAt: 2026-08-13
reconstructed: false
confidence: verified
unknowns: []
modules: ["learning-session-timer"]
interfaces: ["voice-context","voice-learning-timer-control"]
seams: ["learning-session-to-arc-voice"]
adapters: ["limitless-mcp-worker"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["learning-timer-projection","learning-timer-pause-resume"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #250","url":"https://github.com/Vinosaamaa/interview-arc/issues/250","kind":"issue"},{"label":"Arc pull request #318","url":"https://github.com/Vinosaamaa/interview-arc/pull/318","kind":"pull-request"},{"label":"Arc Voice issue #197","url":"https://github.com/Vinosaamaa/interview-arc-voice/issues/197","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/learn-session.integration.test.mjs","tests/runtime-state.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 250
pr: 318
release: null
run: null
---
# Expose the Learning Session timer to Arc Voice

Arc Voice could receive a focused Learning Session transcript target, but the Voice context projected only the Interview timer instrument. The authoritative Learning timer therefore appeared on the website without being visible or controllable in the native companion.

## Change

The Worker now projects a separate `learningTimer` in the Voice context. It carries the stable Session, Course, Module, and Lesson display identity together with authoritative count-up state, accumulated seconds, running interval, server time, and revision. It does not reinterpret a Learning Session as an Interview activity or invent a countdown allocation.

A strict `/voice/learning-timers` Interface accepts explicit Pause and Resume actions. Every request includes a stable operation ID and expected revision, so exact retries return the original receipt while changed retries and stale revisions fail as conflicts. The Interface resolves only the verified owner’s single current Learning timer and fails closed when state is missing or ambiguous.

## Ownership boundary

Arc Voice may display, pause, and resume the current Learning timer. It may capture a Learning transcript only while that Session is running. It does not finalize a Session: Finish remains owned by the Learning Specialist because finalization requires the owner’s recap and checkpoint decisions.

The Learning timer remains distinct from the Interview timer instrument. This prevents one workspace from borrowing the other workspace’s lifecycle, allocation, or completion semantics.

## Verification

The Learning integration test verifies running projection, owner isolation, exact pause retry, changed-operation conflict, stale-revision conflict, paused transcript rejection, paused projection, and resume. The runtime-state test verifies that the new route is part of the Worker contract.

## Consequences

The paired native adapter can render the authoritative Learning count-up timer in Standard and Mini modes without maintaining a second clock. The website and Arc Voice now share one D1-backed Session state and revision protocol, while final learning evidence remains under the Learning Specialist’s explicit finish flow.

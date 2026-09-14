---
schemaVersion: 1
id: change-note-live-chat-controls
revision: 1
type: change-note
status: released
title: Separate customizable Live Chat Controls from lecture playback
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-13
reconstructed: false
confidence: verified
unknowns: ["Native mobile Live spoken continuation"]
modules: ["professor-lectures"]
interfaces: ["professor-lecture-api"]
seams: ["prepared-script-to-continuous-audio"]
adapters: ["device-local-speech"]
relatedRecords: ["change-note-lecture-continue-message@1"]
decisions: []
incidents: []
features: []
capabilities: ["continuous-prepared-lectures"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #473","url":"https://github.com/Vinosaamaa/interview-arc/issues/473","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/live-chat-controls.test.mjs","tests/chatgpt-connector.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 473
pr: null
release: null
run: null
---
# Separate customizable Live Chat Controls from lecture playback

Putting Continue beneath the lecture transcript coupled two different actions:
playing a prepared script and sending a new ChatGPT message. The owner requested
a standalone widget with multiple configurable buttons.

Live Chat Controls opens independently through a read-only MCP tool. Its initial
button sends Continue. Add button creates another shortcut with an individual
label and exact message. Edit switches the grid into editing mode; it never sends
messages. Save persists the collection in host widget state. Delete offers Undo.
Text is rendered as text, not HTML, and changes do not touch practice state.

Only a deliberate shortcut click sends one standard ui/message request. All
shortcut sends are disabled while awaiting its receipt. Unconfirmed requests
show a readable error without an automatic fallback or retry. No audio API,
lecture identity or device speech engine participates. Player resource v6 removes
the old embedded control; already-rendered historical cards may retain old code.

The design uses the reviewed compact grid and separate editor, matching Arc's
paper, mineral and teal tokens. The grid scrolls as buttons are added; no fixed
button-count limit is imposed. Keyboard focus, explicit Edit/Done state, labeled
fields and 44-pixel controls keep editing distinct from sending.

Focused tests execute the shipped script for multiple independent messages,
draft restoration, duplicate clicks, cancellation, validation, deletion/undo,
and host rejection. Connector integration verifies the independent tool/resource
and the removal of continuation UI from playback. Native Live spoken replies
remain host-dependent. Rollback restores the previous tool/resource registrations;
no schema migration is involved.

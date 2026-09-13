---
schemaVersion: 1
id: change-note-lecture-continue-message
revision: 1
type: change-note
status: released
title: Add a customizable Continue message to the lecture card
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Native ChatGPT Live spoken continuation"]
modules: ["professor-lectures"]
interfaces: ["professor-lecture-api"]
seams: ["prepared-script-to-continuous-audio"]
adapters: ["device-local-speech"]
relatedRecords: ["change-note-lecture-position-recovery@1"]
decisions: []
incidents: []
features: []
capabilities: ["continuous-prepared-lectures"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #473","url":"https://github.com/Vinosaamaa/interview-arc/issues/473","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/lecture-player-recovery.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 473
pr: null
release: null
run: null
---
# Add a customizable Continue message to the lecture card

Listeners can send Continue from the embedded lecture card instead of typing it
again. Edit message reveals a text field containing the complete outgoing text.
The default is exactly Continue. Custom text is passed unchanged to the host's
standard [ui/message bridge](https://developers.openai.com/plugins/build/chatgpt-ui),
without a hidden teaching prompt or lesson context.

A click pauses active playback and sends once. Further clicks are ignored while
the request is pending. Empty messages remain editable. A rejected request or
timeout shows a short explanation and asks the listener to check the chat before
retrying; the widget never automatically sends again through another transport.
When supported, host widget state remembers the draft while preserving unrelated
state fields. The draft does not alter the lecture script or saved position.

The controls reuse the card's existing type, spacing, color and disclosure
patterns. The editor is collapsed initially. It has a visible label, keyboard
focus, an expanded-state announcement and a Reset to Continue action. Resource
v5 lets fresh ChatGPT opens obtain the updated card.

Tests execute the shipped script and host bridge, covering exact default and
multiline custom text, duplicate clicks, remount persistence, reset, blank input,
rejected sends and an unsupported host method. This feature depends on the
host's message support. It is not a native Live stop hook and does not guarantee
that ChatGPT's next response is spoken. There is no speech-provider request or
new server storage. Rollback restores the previous widget resource.

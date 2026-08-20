---
schemaVersion: 1
id: change-note-learn-two-panel-reading-frame
revision: 1
type: change-note
status: released
title: Give Learn one two-panel reading frame
repository: interview-arc
capabilityIds: ["arc-learn-workspace"]
createdAt: 2026-08-20
reconstructed: false
confidence: verified
unknowns: []
modules: ["learn-workspace","learning-session-timer"]
interfaces: ["learn-course-navigation","learn-lesson-reader","learn-today-session"]
seams: ["learn-navigation-to-context-rail","learn-session-to-today"]
adapters: ["interview-arc-web"]
relatedRecords: ["adr-learn-workspace-architecture@1","change-note-learning-voice-timer-contract@1"]
decisions: []
incidents: []
features: []
capabilities: ["contextual-learn-navigation","wide-lesson-reading","responsive-learn-pane-switching"]
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #407","url":"https://github.com/Vinosaamaa/interview-arc/issues/407","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:407","tests/learn-workspace-ui.test.mjs","tests/learn-workspace-model.test.mjs","tests/learn-core.integration.test.mjs","tests/learn-session.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 407
pr: null
release: null
run: null
---
# Give Learn one two-panel reading frame

Learn previously combined a narrow Lesson reader, permanent Module and contents
columns, and repeated Session controls inside Courses. That made the primary
reading surface substantially narrower than the other editorial workspaces and
made the authoritative Session location unclear.

## Change

Learn now uses one centered 1,536-pixel desktop frame: a contextual rail up to
316 pixels wide, a 20-pixel gutter, and a reader up to 1,200 pixels wide. The
existing four-room Course navigation spans that complete frame and retains the
released raised-white selected state.

The rail changes purpose with each Course room. Overview selects among Courses
and Quick Studies, Lessons presents the ordered Module path, Homework presents
assignments, and Statistics presents factual Course scope. Written Lessons use
an in-card Contents disclosure that links to real headings, so the reader does
not sacrifice a permanent third column.

## Timer boundary

Today is the only Learn destination that renders the authoritative Session
timer and its controls. The timer spans the same frame above a Current thread
rail and a content-height Session card. Courses may identify an attached
Session and direct the owner to Today, but does not duplicate timer controls or
change Session, Voice, Enrollment, Lesson, homework, or evidence semantics.

## Responsive behavior

Compact layouts replace simultaneous panes with explicit Thread/Session and
Module path/Current lesson switches. Switching panes changes presentation
only, preserves reading state, and does not introduce horizontal document
overflow.

## Verification

Focused model and UI tests cover the frame, navigation, timer boundary,
Contents disclosure, and compact switches. Learn core and Session integration
tests verify the existing D1 lifecycle and owner isolation. Desktop and compact
browser checks verify exact pane geometry, equal Today pane endings, keyboard
reachable navigation, and zero horizontal overflow.

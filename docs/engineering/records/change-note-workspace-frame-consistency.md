---
schemaVersion: 1
id: change-note-workspace-frame-consistency
revision: 1
type: change-note
status: released
title: Correct Learn frame hierarchy and unify workspace hero metrics
repository: interview-arc
capabilityIds: ["arc-learn-workspace","website-navigation"]
createdAt: 2026-08-20
reconstructed: false
confidence: verified
unknowns: []
modules: ["learn-workspace","workspace-shell"]
interfaces: ["learn-course-navigation","learn-lesson-reader","learn-today-session","workspace-hero-metrics"]
seams: ["learn-navigation-to-context-rail","learn-session-to-today","workspace-hero-to-metrics"]
adapters: ["interview-arc-web"]
relatedRecords: ["change-note-learn-two-panel-reading-frame@1","change-note-engineering-workspace-shell-and-hero@1"]
decisions: []
incidents: []
features: []
capabilities: ["bounded-learn-reading-frame","truthful-learning-session-context","shared-workspace-hero-metrics"]
amends: ["change-note-learn-two-panel-reading-frame@1"]
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #407","url":"https://github.com/Vinosaamaa/interview-arc/issues/407","kind":"issue"},{"label":"Arc issue #308","url":"https://github.com/Vinosaamaa/interview-arc/issues/308","kind":"issue"},{"label":"Pull request #419","url":"https://github.com/Vinosaamaa/interview-arc/pull/419","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:407","issue:308","pull-request:419","tests/learn-workspace-ui.test.mjs","tests/learn-workspace-model.test.mjs","tests/website-ui-regressions.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 407
pr: 419
release: null
run: null
---
# Correct Learn frame hierarchy and unify workspace hero metrics

The first Learn two-panel release established the correct Course and Session
boundaries, but several destination surfaces could still escape the centered
frame. Its hero and navigation could grow independently from the body, History
and Statistics used different layouts, and planned Sessions appeared inside
Courses before any learning work had started. The three workspace heroes also
rendered their factual metric bands through separate markup and typography.

## Change

Every Learn destination now shares one centered 1,536-pixel frame composed of
the approved 316-pixel context rail, 20-pixel gutter, and reader up to 1,200
pixels wide. The hero, Course navigation, Today timer, History, Statistics, and
their empty states use that same boundary. Today keeps Course and Module as
parent context while only Current and Next lessons form the ordered thread.

Courses no longer treats a merely planned Session as active. Running and paused
Sessions still provide factual return context without duplicating timer
controls. Lessons uses the ordered Module path as its only lesson-switching
surface and keeps the in-card Contents disclosure for navigation within the
selected lesson; the duplicate footer pager is removed.

Interview, Learn, and Engineering now render the bottom hero facts through one
shared component and style contract. This standardizes band height, label and
value typography, spacing, wrapping, and accessible list semantics without
changing the factual values supplied by each workspace.

## Contract boundary

The change is presentation-only. Course, Enrollment, Blueprint, Lesson
revision, Session timer, Voice, homework, checkpoint, owner-isolation, and D1
contracts are unchanged. Selecting a Lesson remains read-only and never moves
the Enrollment current-Lesson pointer or starts a Session.

## Verification

Focused Learn model and UI tests cover bounded destination frames, planned and
started Session visibility, Current-thread hierarchy, Module-path-only Lesson
selection, within-Lesson Contents, and responsive pane switching. Shared
website regressions cover identical hero metric structure across Interview,
Learn, and Engineering. Targeted lint, production build, and hosted validation
provide the release gates.

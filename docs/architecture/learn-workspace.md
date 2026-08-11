# Learn Workspace Architecture

## Status

Proposed on 2026-08-11.

Parent product issue: [#249](https://github.com/Vinosaamaa/interview-arc/issues/249)

Owning Learn MVP issue: [#250](https://github.com/Vinosaamaa/interview-arc/issues/250)

## Decision

Build Learn as an owner-private interactive tutoring workspace, not a static
course marketplace and not an Interview-practice subtype.

The primary reusable artifact is a versioned **Lesson Sheet**. The live teaching
experience is a timed, conversational **Learning Session**. The exact transcript
is preserved privately in History, but it is not treated as the course article.

The MVP includes:

- Course Blueprints and lesson outlines;
- just-in-time Lesson Sheets;
- Quick Study;
- timed conversational tutoring;
- transcript-only Arc Voice;
- exact private History;
- simple homework and artifacts;
- explicit lesson checkpoints;
- factual Course and Learn-wide Analytics.

It deliberately excludes cloud learning-audio storage, review scheduling,
numerical grades, inferred mastery, public publishing, a separate Notebook, and
automatic textbook generation from transcripts.

## Product Vocabulary

### Course Blueprint

A versioned syllabus containing the goal, prerequisites, source set, module and
lesson outline, dependency order, and intended outcome. It plans the Course
without pre-generating every lesson article.

### Lesson Sheet

The versioned durable teaching material for one Lesson. It contains the
objective, prerequisite concepts, concise main explanation, examples or
diagrams, exact source references, exercises, optional homework, and checkpoint
definitions.

The Sheet is generated or opened immediately before its Lesson starts. It is
the default surface the learner revisits. A specialist may propose a small
explicit revision after a Session, but must never silently regenerate the whole
Sheet from conversation text.

### Learning Session

A timed conversation associated with one Course/Lesson or one Quick Study. A
Session owns start, pause, resume, finish, transcript turns, artifacts, a
concise recap, and any observed checkpoint evidence.

Finishing a Session does not necessarily complete its Lesson.

### Quick Study

A standalone Lesson Sheet and one or more Learning Sessions without a Course
Blueprint. Quick Study supports genuine learning that does not need an
artificial curriculum. It may later be linked into a Course through an explicit
operation.

### Checkpoint

A narrow demonstrated learning outcome, not a score or inferred mastery state.
The MVP supports:

- Not attempted;
- Needs another pass;
- Demonstrated.

Evidence may reference exact transcript turns, code, diagrams, lab results, or
homework artifacts. A short factual rationale explains the result. A Lesson is
complete when all of its required checkpoints are Demonstrated.

### Homework and Artifact

Homework is assigned work. An Artifact is a durable result such as code, a
diagram, a trace, or written explanation. Homework may produce checkpoint
evidence, but completing an assignment does not automatically prove every
checkpoint.

## Experience Model

### Course creation

The owner supplies a learning goal, desired scope, prior knowledge, available
time, and optional sources. The Learning Specialist proposes a Course Blueprint
for review. Approval creates the enrollment; it does not generate the full
course corpus.

Structural changes create a new Blueprint revision. Existing Lesson Sheets and
Sessions retain the revision they used.

### Lesson start

Before starting the timer, the specialist:

1. resolves the current Course, Blueprint revision, Module, and Lesson;
2. loads exact source revisions;
3. creates or opens the Lesson Sheet;
4. renders the Sheet so the learner can see the teaching material;
5. starts or resumes the Learning Session only after the surface is available.

This preserves the existing product principle that the useful working surface
appears before time begins.

### Conversational teaching

The specialist treats the Lesson Sheet as shared teaching material rather than
copying it into chat. Teaching proceeds in short adaptive cycles:

1. establish the learner's current model;
2. explain one bounded concept;
3. ask for a prediction or restatement;
4. inspect a source, example, or code path;
5. answer questions;
6. guide an exercise;
7. correct a misconception;
8. observe checkpoint evidence when appropriate.

The specialist may use Teach, Socratic, Walkthrough, Lab, or Quiz behavior
inside the same Session. Those behaviors do not create separate session types
or require separate persistence tools in the MVP.

### Session finish

Finish saves:

- exact timer intervals and duration;
- transcript turns;
- artifacts and homework state;
- concise factual recap;
- unresolved questions;
- checkpoint evidence/results;
- recommended next action;
- exact Course Blueprint and Lesson Sheet revisions.

Finish never claims durable mastery. A Session may be complete while the Lesson
remains in progress.

### Looking back

The Course opens the curated Lesson Sheet by default. History provides the exact
conversation and artifacts when the owner needs the original context.

The system never publishes a raw transcript as course material. Public course
publication is outside the MVP.

## Interface Structure

Learn workspace navigation:

- Today
- Courses
- History
- Analytics

Course navigation:

- Overview
- Lessons
- Homework
- Analytics

Desktop Lesson layout uses two coordinated surfaces:

    ┌──────────────────────────┬──────────────────────────┐
    │ Lesson Sheet             │ Tutor conversation       │
    │                          │                          │
    │ explanation              │ adaptive teaching        │
    │ diagrams and examples    │ learner questions        │
    │ sources                  │ guided exercises         │
    │ homework/checkpoints     │ corrections and recap    │
    └──────────────────────────┴──────────────────────────┘

Mobile uses an accessible Lesson/Conversation switcher and preserves the timer,
Session identity, draft text, and reading position when switching surfaces.

## Shared Timed-Conversation Module

Interview and Learn should reuse one deep timed-conversation Module for:

- start, pause, resume, and finish;
- current context identity;
- timer intervals;
- transcript turn identity and ordering;
- connection/retry state;
- private History;
- Voice metadata routing.

Domain policy selects the evidence and finalization behavior:

| Capability | Interview | Learn |
| --- | --- | --- |
| Timer | Yes | Yes |
| Transcript | Yes | Yes |
| Cloud audio | Contract-dependent | Never |
| Audio Finish blocker | Contract-dependent | Never |
| Primary final artifact | Attempt/review | Recap/homework/checkpoint |
| Primary history | Interview Past | Learn History |

The shared Module must not import Interview Attempt, Review, outcome, or
publication semantics into Learn.

## Transcript-Only Voice Policy

Arc Voice still captures audio transiently because transcription requires an
audio source. When the active target is a Learning Session:

1. Voice creates stable Learning turn identity and includes Course, Lesson, and
   Session context in inserted metadata.
2. The original exists only as transient local transcription/recovery state.
3. Successful transcript insertion commits the text turn.
4. Voice does not upload the original to R2.
5. The Worker does not register private-audio metadata or delivery analysis.
6. The Session never gains an audio-delivery blocker.
7. Successful insertion permits disposal of the transient original.

If transcription or insertion fails, Voice may retain the protected local
original only long enough to preserve a recoverable transcript. This is local
recovery, not durable learning-audio storage.

This behavior should be expressed as a transcript-only evidence policy at the
shared routing seam. It must not become a second copied capture pipeline.

Native implementation and installed verification require a paired
interview-arc-voice issue and PR because the repositories have separate release
contracts.

## Durable Ownership

D1 owns owner-private mutable Learn state:

- Course and Blueprint revisions;
- Enrollment and current position;
- Lesson Sheet revisions;
- Learning Sessions and timer intervals;
- transcript turns;
- checkpoint definitions/results/evidence references;
- homework and artifact metadata;
- Analytics read inputs.

Private artifact bytes use the appropriate owner-private store. Learning audio
is not among those artifacts.

Git owns reusable public-safe Learning Specialist instructions, subject skill
contracts, templates, and any explicitly reviewed reusable curriculum. A
personal generated Course does not enter Git automatically.

Journey reads compact factual events and identifiers. It never copies
transcripts or Lesson Sheet bodies.

## Checkpoint Invariants

- Most Lessons have one required checkpoint; larger Lessons may have up to
  three.
- Results never use numerical grades in the MVP.
- Time spent, Session completion, homework completion, and specialist sentiment
  cannot independently mark a checkpoint Demonstrated.
- Demonstrated requires exact visible evidence and a factual rationale.
- Needs another pass preserves what was correct and what remains unresolved.
- Evidence references remain owner-scoped and revision-aware.
- Correction creates a new result event or explicit supersession; it does not
  rewrite historical evidence silently.

Example:

    Objective:
    Trace one activity-start request from React to D1 and explain retry safety.

    Result:
    Demonstrated

    Evidence:
    - exact learner explanation turn
    - mutation-flow diagram artifact

    Rationale:
    Identified D1 as authoritative and explained the idempotency boundary.

## Analytics

Analytics reports observed facts.

Course Analytics:

- timed duration;
- Session count;
- Lessons completed and total;
- required checkpoints Demonstrated and total;
- checkpoints needing another pass;
- homework open and completed;
- time by Module;
- last activity and current Lesson.

Learn-wide Analytics:

- time by week/month and Course;
- active learning days;
- Courses active/completed;
- Quick Study Sessions;
- Lessons completed;
- checkpoint coverage;
- recent topics;
- Session-duration trends.

Use checkpoint coverage rather than mastery. Do not infer intelligence,
readiness, productivity, retention, or expertise.

Journey receives compact factual events for Session finish, Lesson completion,
checkpoint demonstration, homework completion, and Course completion.

## Fast Delivery Plan

This is one Learn workspace MVP issue and one main Interview Arc PR train, not a
collection of micro-issues.

Track sub-stories as an issue checklist and meaningful commits:

1. domain contracts, additive migration, public interfaces, and focused D1
   tests;
2. shared timed-conversation transcript-only policy and persistence tests;
3. Learning Specialist workflow, Lesson Sheets, checkpoints, homework, and
   focused tests;
4. responsive Today, Courses, History, Analytics, and Lesson/Conversation UI;
5. Journey projection, documentation, and final parity/regression corrections.

Each commit includes its narrow behavioral test. The completed PR runs the
required local D1 integration, final lint/build/CI, review, and production
verification once. Fastlane removes duplicate orientation, redundant broad
suites, and micro-issue ceremony; it does not weaken Reliability requirements.

Split further only for:

- the paired Voice repository and signed-app release;
- a newly discovered independent deployment boundary;
- an unavoidably unreviewable or irreversible migration;
- a materially separate reliability incident.

## Verification

Test through public seams:

- Course/Blueprint/Lesson/Session/checkpoint/analytics interfaces;
- authenticated owner isolation;
- local D1 migration and reconnect/resume;
- timer ordering and exact historical revisions;
- exact retry and changed retry;
- transcript-only routing with no R2 object, private-audio row, delivery blocker,
  or audio-based Finish gate;
- Voice transient-recovery and disposal behavior;
- desktop/mobile layout, keyboard, screen reader, large text, loading,
  empty/error, and reduced motion;
- factual Analytics and Journey projections;
- existing Interview timer, Voice, Attempt, Review, and Finish regressions.

The final Reliability release requires merged Worker readback and exact installed
Voice artifact verification for the paired native change.

## Consequences

### Benefits

- Conversational tutoring remains natural.
- The Course stays readable because Lesson Sheets, not transcripts, are the
  primary material.
- History remains exact when the owner needs the original exchange.
- Interview and Learn reuse timer/transcript infrastructure without sharing
  incompatible evidence semantics.
- Checkpoints and Analytics provide useful facts without manufacturing mastery.
- The MVP remains one coherent workspace delivery instead of a long queue of
  micro-slices.

### Costs and risks

- The shared session Module must be deep enough to prevent Interview and Learn
  policies from drifting.
- Voice requires an explicit transcript-only route and native release.
- Generated Lesson Sheets need revision/source discipline to avoid stale or
  hallucinated teaching material.
- A large workspace PR requires disciplined commits and continuous focused tests
  to remain reviewable.

## Deferred

- spaced-repetition and a Reviews destination;
- numerical assessment or mastery models;
- public course publication;
- automatic textbook generation from transcripts;
- a separate Course Notebook;
- elaborate examination engines;
- a standalone Library destination;
- inferred learning recommendations.

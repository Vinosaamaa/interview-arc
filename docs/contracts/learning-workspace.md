# Learning Workspace Contract

Learn is an owner-private tutoring domain. It is not an Interview specialty and
must not reuse Interview Activity, outcome, review, publication, or audio
evidence semantics as a shortcut.

## Durable ownership

- Git owns reviewed Learning Specialist instructions, subject-skill routing,
  templates, and explicitly reusable public-safe curriculum.
- D1 owns private Course, Blueprint, Enrollment, Lesson, Quick Study, Learning
  Session, transcript, checkpoint, homework, artifact, and Analytics state.
- A Course Blueprint and a Lesson are append-only revision families. Stable
  rows are current pointers; historical reads never synthesize or rewrite a
  prior revision.
- An Enrollment requires an explicit owner instruction and pins one exact
  Blueprint revision. A later Blueprint revision never retargets it.
- A Course Lesson pins the exact Enrollment and Blueprint revision. A Quick
  Study is separate and never fabricates Course or Enrollment state.

## Core tools

- `create_learning_course_blueprint` creates draft revision 1. Only the
  Learning Specialist may propose it.
- `revise_learning_course_blueprint` appends one revision using the exact
  current revision.
- `approve_learning_course_enrollment` requires explicit owner authorization
  and enrolls in the exact reviewed Blueprint revision.
- `save_learning_lesson_revision` creates or appends a reusable Current lesson
  revision for either an active Course Enrollment or a Quick Study.
- `query_learning_workspace` reads bounded owner-private current or exact
  historical revisions and factual aggregate counts.
- `create_learning_session` opens a planned Session pinned to the exact Current
  lesson and enrolled Blueprint revision before timing begins.
- `control_learning_session` owns explicit start, pause, and resume transitions
  with exact timer intervals.
- `append_learning_transcript` saves contiguous, revision-guarded typed,
  dictation, or transcript-only Voice turns with stable identities.
- `query_learning_sessions` reads owner-private Session, interval, and exact
  transcript history without audio metadata.
- `attach_learning_artifact` stores immutable artifact integrity metadata while
  keeping its owner-private backing-store locator out of every read.
- `set_learning_homework_state` appends an exact open or completed state event;
  completion is factual evidence and never independently implies mastery.
- `finish_learning_session` atomically closes the timer, locks the transcript,
  appends a recap, and records evidence-bearing checkpoint events.
- `query_learning_evidence` reads checkpoint, homework, artifact, and immutable
  finalization history without private storage locators.
- `query_learning_journey` returns compact factual chronology and stable
  identities without transcript turns or Lesson bodies.
- `query_learning_analytics` returns Course and Learn-wide observed time,
  Session, Lesson, homework, active-day, and required-checkpoint coverage facts.

Every write uses one stable operation ID. An exact retry returns the original
receipt with `duplicate: true`; a changed retry fails closed. Expected-revision
conflicts return without partial writes. Every query is owner-isolated.

## Source and evidence boundaries

Repository sources pin an exact repository and commit. `Learn this` from an
Engineering Journal record also pins its exact record ID, record revision, and
selected symbols. Owner-provided and web sources retain explicit provenance.

The first Course tracer teaches Interview Arc architecture from a Java and
JavaScript engineer perspective. It must cite real repository paths and exact
commits rather than reconstructing implementation from memory.

Checkpoints are evidence-bearing state, not grades. Their only result states
are Not attempted, Needs another pass, and Demonstrated. Time spent, Session
completion, homework completion, or specialist sentiment cannot independently
mark a checkpoint Demonstrated.

## Voice boundary

Learning Voice is transcript-only. It persists stable text-turn identity and
never uploads learning audio to R2, creates private-audio metadata or delivery
analysis, creates an audio Finish blocker, or makes audio availability a Finish
gate. Protected local recovery may retain a transient original only until
transcription/insertion succeeds or the user resolves the recovery.

The authenticated `GET /voice/context` seam declares one explicit
`captureTarget`: `interview`, `learning`, `ambiguous`, or no target. A Learning
target includes the exact Course, Module, Lesson revision, Session,
transcript revision, and next sequence plus
`evidencePolicy: "transcript_only"`. Multiple running Learning Sessions, or a simultaneous
Interview activity and Learning Session, fail closed as ambiguous instead of
guessing a destination.

Arc Voice appends one checksum-bound learner turn through authenticated
`POST /voice/learning-transcripts`. The Worker fixes its writer to `arc_voice`, its
source to `voice_transcript`, and its speaker to `learner`, then delegates to
the same D1 transaction as `append_learning_transcript`. Exact retries replay;
changed operation identities, transcript revisions, sequences, checksums, and
owners fail without a partial write. This route never accepts audio or delivery
metadata.

Native routing is owned by a paired `interview-arc-voice` issue and separate
signed-application release.

## Analytics and Journey

Learn Analytics and Journey expose factual time, Session, Lesson, homework,
checkpoint-coverage, Course, and Quick Study events. They never infer mastery,
intelligence, readiness, productivity, retention, or expertise. Journey does
not copy private transcripts or Lesson bodies.

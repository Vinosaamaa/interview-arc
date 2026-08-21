# Interview Loops And Role Brief Contract

This contract owns hiring-process truth for one company-and-role Loop. A Loop
is administrative state, not a practice transcript or a substitute for a
coding, system-design, or behavioral specialist.

## Authority

`Interview Arc — Loop Recorder` is the only specialist permitted to call
`create_loop`, `revise_loop`, `revise_loop_role_brief`,
`create_loop_interview_material`, `revise_loop_interview_material`,
`migrate_target_profile_to_loop`, `capture_loop_packet`, or
`import_loop_capture_packet`. Every Loop Recorder mutation requires the literal
`authorization: "loop_recorder"`; that value records the authority used but
does not replace the owner's explicit request.

`bind_planned_activity_to_loop` is a planning-context operation, not a Loop or
Role Brief mutation. A practice specialist may call it only after an explicit
owner instruction and only before the activity starts.

`link_completed_activity_to_loop` is the explicit historical-link path for an
already-completed practice activity after an explicit owner instruction. It
requires an authoritative completed timer, a result last changed no later than
completion, exact current Loop and Role Brief revisions, and a fresh operation
ID. It adds the missing immutable context and transcript-free history without
changing the timer, result, transcript, finalization, or Role Brief. A linked
activity cannot later move to a different Loop.

The three practice specialists may call `query_loops` and
`query_loop_interview_materials`. They return only the
display-safe Role Brief projection, bounded activity history, planned bindings,
current owner-private interview-prep material, and factual Journey aggregates
from explicit Loop, stage, date, and outcome records. The Role Brief projection includes responsibilities, qualifications,
competency signals, seniority indicators, vocabulary, verified company
signals, unresolved ambiguities, and a source fingerprint/locator. Raw job
description text remains private: it is available only through the authenticated
Loops website reader for one exact immutable revision. Archived source requires
an explicit archived-Loop read. Raw source is excluded from MCP tools,
`query_loops`, practice context, transcripts, history, and publication
artifacts. Owner-private notes are never returned by the source reader.
Practice specialists must not create a competing Target Profile or infer any
Loop, stage, date, outcome, interviewer feedback, Role Brief revision, or
interview-material content.

The owner-authenticated Loops website may create a new Loop and Role Brief
revision 1 through the same deterministic command Module. Its adapter derives
owner scope from verified Cloudflare Access, accepts no authorization or owner
field from the browser, and records `website_owner` as the command authority.
It cannot revise an existing Loop or Role Brief. Missing location, opened date,
stages, and job-description text remain explicit unknowns. A URL-only job source
is a reference, not permission to crawl or fabricate the posting text.

## Identity And Revisions

- One Loop is one immutable company-and-role identity with a stable owner-scoped
  `loopId`. A different company or role requires a separate Loop; later Loop
  revisions may change process metadata, stages, dates, status, and outcome.
- Loop creation atomically creates Loop revision 1 and its Loop-owned Role
  Brief revision 1. A Role Brief cannot exist independently in the forward
  model.
- Company and role form one normalized owner-scoped identity. A changed company
  or role requires a separate Loop, and an exact duplicate fails without a
  partial revision.
- Loop and Role Brief revisions are append-only. A client supplies the exact
  expected revision; stale writes conflict and require a fresh read.
- One stable operation ID represents one immutable payload. An exact replay
  returns the original receipt with `duplicate: true`; changed reuse is a
  non-retryable conflict.
- Archive/reactivate is a Loop revision. It never deletes history.

## Interview Materials

Interview material is owner-private preparation for one confirmed hiring
process. It is not a resume, cover letter, application record, raw job
description, Role Brief, practice transcript, or completed-attempt copy.

- One stable `materialId` belongs permanently to one Loop, optional exact
  Round, and `interview_prep` kind. A database uniqueness guard permits only
  one current prep material for that scope; updating content appends a revision
  instead of creating a duplicate.
- A Round-bound material may be created only when that exact current Round is
  explicitly `scheduled` or `completed`. Dates alone never confirm it.
- Every write pins the exact current Loop and Role Brief revisions. Provenance
  includes the Role Brief revision, an owner-safe source label, preparation
  time, and zero or more activity IDs that the server verifies against the
  same Loop and, when Round-bound, the same Round.
- Only the Loop Recorder may create or revise material, and only from an
  explicit owner instruction plus source-backed content. It must never infer
  private interview facts, copy a raw JD or transcript, or present coaching as
  evidence.
- Revisions are append-only. Exact operation retry returns the original
  receipt; changed retry, stale revision, changed binding identity, wrong-owner
  activity provenance, and duplicate scope all fail closed.
- Current material is projected into the authenticated Loop detail. Exact
  historical revisions remain readable through
  `query_loop_interview_materials`; archived material is excluded unless
  explicitly requested.

## Stages, Debriefs, And Questions

Stages have stable IDs and flexible, unique ordering. Optional groups represent
onsite or other multi-round structures without imposing a fixed process. Dates,
status, and outcome are explicit owner-provided facts. Scheduled time may
prompt, but never completes a stage or implies an outcome.

A stage may record an owner-provided format and up to 25 interviewer names. A
concise round debrief may contain at most 50 questions. Each question may have
one optional owner review; when present, it requires an explicit assessment
(`strong`, `mixed`, or `needs_work`), a trimmed 1–5,000-character approach or
review summary, or any combination of those fields. The ordinary stage record consists of its guide/material card, question
cards, and the explicit stage status/result. New writes do not solicit separate
round self-assessment or interviewer-feedback cards. Legacy round-level
`selfAssessment`, `interviewerFeedback`, and `nextStep` fields remain parseable
for immutable historical revisions but are not foregrounded in the current UI.
Never infer format, interviewers, assessment, feedback, or stage outcome.

Legacy remembered prompts and answers remain readable and independently
labelled `exact` or `reconstructed`; new UI and Loop Recorder guidance do not
foreground or solicit an answer reconstruction. The current UI reads the
explicit owner-review approach instead. A canonical Bank question is
linked by stable ID and may belong to many Loops; do not copy or fork the
canonical question merely to add Loop context.

## Activity Context And History

A planned Interview activity has zero or one Loop binding and an optional Round
binding. The server validates the owner-scoped Loop/Round identity and snapshots
the exact display-safe Role Brief revision. The binding supplements question
identity; it does not duplicate a Bank question. The Today composer Review
selections panel may stamp selected practice activities with one Loop and
optional Round through the same `loopContext` binding; Career Focus never
binds, and universal (unbound) practice remains the default. Website extra
creation attaches that context on create using the same D1 binding tables as
`plan_today_practice`. Loop context is immutable after the activity timer
starts.

Finishing a bound activity automatically appends its authoritative completion
receipt to Loop history. The projection is idempotent and records facts such as
activity, specialty, question identity, Round, exact Role Brief revision,
completion time, and owner-set outcome. It does not copy the practice
transcript, private audio, raw job description, or inferred interviewer result.
No Loop Recorder call is required for this projection.

When an explicit owner instruction links a completed activity after the fact,
the historical-link operation writes the same bounded history shape. It keeps
the original timer's `completedAt` and records a separate `linkedAt` in the
operation/history receipt, so linkage time can never be mistaken for interview
or practice time.

## Standalone Target Profile Migration

Existing standalone Target Profiles remain intact until the Loop Recorder makes
one explicit migration-inbox decision against the exact current revision:

1. create a new Loop and use the Target Profile as Role Brief revision 1;
2. attach it as a new immutable Role Brief revision on an existing Loop; or
3. archive it from the migration inbox.

Never guess a Loop, silently rewrite the source Target Profile, or delete it.

## Delayed Capture

When the destination Loop is not yet known, the Loop Recorder may save an
owner-private capture packet. It preserves the original `capturedAt` timestamp.
Import later records a separate `backfilledAt` timestamp, checks the exact Loop
revision and company/role identity, and appends history instead of rewriting
past revisions.

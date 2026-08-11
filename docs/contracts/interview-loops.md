# Interview Loops And Role Brief Contract

This contract owns hiring-process truth for one company-and-role Loop. A Loop
is administrative state, not a practice transcript or a substitute for a
coding, system-design, or behavioral specialist.

## Authority

`Interview Arc — Loop Recorder` is the only specialist permitted to call
`create_loop`, `revise_loop`, `revise_loop_role_brief`,
`migrate_target_profile_to_loop`, `capture_loop_packet`, or
`import_loop_capture_packet`. Every mutation requires the literal
`authorization: "loop_recorder"`; that value records the authority used but
does not replace the owner's explicit request.

The three practice specialists may call `query_loops`. It returns only the
display-safe Role Brief projection: responsibilities, qualifications,
competency signals, seniority indicators, vocabulary, verified company
signals, unresolved ambiguities, and a source fingerprint/locator. Raw job
description text and owner-private notes never leave the Loop Recorder write
boundary. Practice specialists must not create a competing Target Profile or
infer any Loop, stage, date, outcome, interviewer feedback, or Role Brief
revision.

## Identity And Revisions

- One Loop is one company-and-role hiring process with a stable owner-scoped
  `loopId`.
- Loop creation atomically creates Loop revision 1 and its Loop-owned Role
  Brief revision 1. A Role Brief cannot exist independently in the forward
  model.
- Loop and Role Brief revisions are append-only. A client supplies the exact
  expected revision; stale writes conflict and require a fresh read.
- One stable operation ID represents one immutable payload. An exact replay
  returns the original receipt with `duplicate: true`; changed reuse is a
  non-retryable conflict.
- Archive/reactivate is a Loop revision. It never deletes history.

## Stages, Debriefs, And Questions

Stages have stable IDs and flexible, unique ordering. Optional groups represent
onsite or other multi-round structures without imposing a fixed process. Dates,
status, and outcome are explicit owner-provided facts. Scheduled time may
prompt, but never completes a stage or implies an outcome.

A concise round debrief may contain questions asked, a brief remembered answer,
the owner's self-assessment, and next step. Remembered prompts and answers are
independently labelled `exact` or `reconstructed`. A canonical Bank question
is linked by stable ID and may belong to many Loops; do not copy or fork the
canonical question merely to add Loop context.

## Activity Context And History

A planned Interview activity has zero or one Loop binding and an optional Round
binding. The server validates the owner-scoped Loop/Round identity and snapshots
the exact display-safe Role Brief revision. The binding supplements question
identity; it does not duplicate a Bank question.

Finishing a bound activity automatically appends its authoritative completion
receipt to Loop history. The projection is idempotent and records facts such as
activity, specialty, question identity, Round, exact Role Brief revision,
completion time, and owner-set outcome. It does not copy the practice
transcript, private audio, raw job description, or inferred interviewer result.
No Loop Recorder call is required for this projection.

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

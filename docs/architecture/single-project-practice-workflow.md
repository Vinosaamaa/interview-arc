# Single-Project Practice Workflow

## Status

Task ownership was accepted on 2026-07-17. Owner-private D1/R2 authority
superseded the personal Git-publication model on 2026-08-13. The normative
storage, finalization, reader, and migration rules are in
[`owner-private-practice-records.md`](../contracts/owner-private-practice-records.md).

## Task ownership

Use one Codex project and one shared `interview-arc` checkout. Keep seven
long-lived tasks: coordinator, Loop Recorder, Learning Specialist, Resume &
Cover Letter, LeetCode, System Design, and Behavioral. Do not create a project
or Git worktree per specialist.

Tasks share repository files but not hidden conversation context. Durable role
instructions live in `AGENTS.md`. The three practice specialists own coaching;
Loop Recorder and Resume & Cover Letter are administrative specialists;
Learning Specialist owns tutoring; none is an Interview practice specialty.

## Session protocol

1. Resolve or resume one exact focused activity. `Start a new session` remains
   an explicit override.
2. Persist only observed activity-related exchanges, evidence, notes, code, and
   recordings through the owner-scoped path.
3. Finish locks timer and transcript boundaries and durably queues one complete
   semantic packet.
4. One mechanical persistence child stores and rereads exact D1/R2 revisions.
   Past stays hidden as `Finalization pending` until its receipt is saved.
5. Specialty-wide or coordinator-wide commands reconcile pending/failed private
   records; they do not create routine Git artifacts.

The visible specialist may delegate exhaustive Solution Profile authoring from
its verified packet while continuing the review. The persistence child never
authors or repairs meaning.

## Evidence and time ownership

The website owns live timer state. The user owns outcomes and unshared work.
The specialist owns only observed coaching and generated reference material.
Every surface joins through stable `activityId` and optional `sessionId`.

Each session owns a countdown derived from its recipe: 40 minutes per coding
problem and 60 minutes per System Design or Behavioral question. Each activity
also owns an elapsed stopwatch. Only one activity runs at a time; a session may
run alongside its current child. Finish locks the activity timer.

Pacific completion time groups Past and Journey without splitting a continuous
activity or changing session membership. Exact intervals and timestamps remain
authoritative; midnight never implies a transcript boundary.

## Records and assets

- D1 owns mutable activity state and immutable Practice Record/Solution Profile
  revisions, links, review state, and metadata.
- Private R2 owns recording and drawing bytes.
- Past renders one completed activity. Solution renders the latest reusable
  knowledge while preserving the completion-time link in Technical Audit.
- System Design stores the owner's original Excalidraw scene separately from a
  specialist-authored draw.io/SVG model.
- Browser storage is an offline cache and retry queue, never authority.

## Git boundary

Git owns public-safe product code, contracts, question banks, examples, and
Engineering records. It receives no new personal attempt, transcript, review,
answer, Solution Profile, journal, recording, or diagram.

The exact legacy files present at the cutover commit are frozen by path and
SHA-256. Import may read them during migration but rejects additions or byte
changes. Remove them from current `main` only after authenticated D1/R2 parity,
Past/Journey cutover, and rollback evidence are complete. Do not rewrite Git
history.

Code and contract changes continue through ordinary issue branches, pull
requests, required CI, merge, and deployment. Routine private practice needs no
journal branch, pull request, content import, deployment, or publication mark.

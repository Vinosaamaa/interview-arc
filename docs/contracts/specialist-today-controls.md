# Specialist Today Controls

## Purpose

Interview Arc specialists may operate the authenticated owner's Today workbench
through six MCP tools. D1 remains authoritative. The tools do not scrape
LeetCode, infer outcomes, or replace the website and Voice interfaces.

## Tool Catalog

- `query_practice_catalog` is read-only. It searches one specialty, including
  exact public question ID and exact title, and supports the same star,
  attention, difficulty, frequency, recency, and acceptance filters used by
  Today. The response includes the current workbench identity.
- `plan_today_practice` adds an exact authoritative selection as standalone
  work or one session. Its filtered-session mode requires an exact count and
  fails with `insufficient_eligible_questions` instead of relaxing filters.
- `control_practice_timer` starts, pauses, resumes, or finishes one practice
  timer. Its guarded `finish_and_advance` operation finishes the current
  activity and starts the next unfinished practice activity in canonical
  session order. It never wraps or leaves the session unless the user names an
  explicit eligible destination.
- `control_practice_session_timer` starts, pauses, resumes, or finishes one
  parent session countdown. Pausing or finishing the session pauses its running
  child according to the same authoritative D1 rules as the website. Resuming a
  session does not implicitly choose or start a child activity.
- `control_practice_workbench` archives the current workbench and opens one
  empty replacement only after an explicit user instruction. The server
  generates the replacement identity; specialists must not invent it.
- `set_practice_result` sets or clears Solved, Solved with help, or Failed.
  It requires an explicit user instruction or an authorized platform verdict.
  Specialist coaching, elapsed time, generated reference code, and local
  execution are never evidence of an outcome.

## Mutation Contract

Every mutation includes:

- `expectedWorkbenchId`, read from a current Today or catalog response;
- a stable `mutationId`, reused unchanged for an exact retry; and
- for timer commands, `expectedRevision` for the targeted activity or session
  timer.

The server rejects a stale workbench or timer revision. Reusing a mutation ID
with changed content is an identity conflict. Reusing it with identical content
returns the saved receipt and a fresh authoritative D1 read-back without
applying the mutation twice.

Starting an activity nested in a session is one guarded D1 mutation. The
parent session, requested child, competing-stopwatch pauses, focus state, and
mutation receipt either commit together or do not commit. A stale parent or
child timer revision cannot leave a parent running without its requested
child.

Result mutation is likewise one guarded D1 mutation. Outcome, outcome
revision, review schedule (including a review deletion), and mutation receipt
commit together. A stale result command receives a structured conflict and
cannot overwrite a newer outcome or delete review metadata created by it.

Workbench rollover is one guarded D1 mutation. Every started practice activity
must already have an explicit result, and existing Voice finish guards remain
authoritative. Eligible unfinished activity, focus-block, and session timers;
the focus pointer; old-workbench archive state; replacement workbench; and
mutation receipt commit together or do not commit. The operation never deletes
history. An exact retry returns the original replacement identity and cannot
create another workbench.

Timer and result commands require the authorization value documented by their
schema. A specialist must receive an explicit user instruction before changing
a timer or result. An authorized platform verdict may set a result, but may not
implicitly start, stop, finish, or advance a timer.

Workbench rollover also requires `authorization: explicit_user_instruction`.
A specialist must never infer rollover from elapsed time, completion, Pacific
midnight, publication, or an empty Today list.

Session commands require an exact current-workbench `sessionId`. They reuse the
session's canonical child IDs and the existing D1 timer mutation so website,
Voice, and specialist behavior cannot diverge. `pause` folds the session time
and pauses its running child. `resume` continues only the parent countdown.
`finish` preserves all existing child-result, Voice-capture, and permanent-lock
guards.

Any eligible planned practice activity in the current open workbench is a valid
timer or result target, even when no activity or session is focused yet. MCP
controls resolve their target from the authoritative workbench state and join
its timer and outcome by activity ID. They must not use the Voice timer
instrument as an activity catalog: that instrument intentionally projects only
an already-running session or one explicitly focused activity.

`finish_and_advance` preflights the current result, current and next timer
revisions, next-activity eligibility, and session order before finishing. Voice
capture finish guards remain authoritative. An accepted related Voice capture
must have its canonical D1 user/specialist pair and either an `available`
private-audio row or an acknowledged `audio_lost` record. Untouched `pending`
captures are terminalized as `discarded_unclassified`; `uncertain` remains an
explicit Attach-or-Discard blocker. If any guard fails, the operation returns a
visible structured error and does not advance.

## Read-Back And Synchronization

Every successful or duplicate mutation returns an authoritative D1 read-back
containing the practice snapshot and timer instrument. Clients must use this
response rather than predicting state locally. The Worker then publishes one
owner-scoped live-update invalidation so the website, Voice, Picture-in-Picture,
and Companion reread D1. Push is not the source of truth.

## Specialist Usage

Specialists should read Today before a mutation and reread after any stale-state
error. Commands such as “mark this solved, stop its timer, and start the next
problem” are two explicit operations: `set_practice_result`, followed by
`control_practice_timer` with `finish_and_advance`. Stable mutation identifiers
make retries safe.

MCP tool catalogs and allowlists are loaded when the connection starts. Reopen
or reconnect Codex after deployment and configuration changes before verifying
tool discovery.

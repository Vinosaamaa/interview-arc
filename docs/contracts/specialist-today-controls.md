# Specialist Today Controls

## Purpose

Interview Arc specialists may operate the authenticated owner's Today workbench
through four MCP tools. D1 remains authoritative. The tools do not scrape
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
- `set_practice_result` sets or clears Solved, Solved with help, or Failed.
  It requires an explicit user instruction or an authorized platform verdict.
  Specialist coaching, elapsed time, generated reference code, and local
  execution are never evidence of an outcome.

## Mutation Contract

Every mutation includes:

- `expectedWorkbenchId`, read from a current Today or catalog response;
- a stable `mutationId`, reused unchanged for an exact retry; and
- for timer commands, `expectedRevision` for the activity timer.

The server rejects a stale workbench or timer revision. Reusing a mutation ID
with changed content is an identity conflict. Reusing it with identical content
returns the saved receipt and a fresh authoritative D1 read-back without
applying the mutation twice.

Timer and result commands require the authorization value documented by their
schema. A specialist must receive an explicit user instruction before changing
a timer or result. An authorized platform verdict may set a result, but may not
implicitly start, stop, finish, or advance a timer.

`finish_and_advance` preflights the current result, current and next timer
revisions, next-activity eligibility, and session order before finishing. Voice
capture finish guards remain authoritative. If a guard fails, the operation
returns a visible structured error and does not advance.

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

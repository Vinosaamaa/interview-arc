# Voice Today Planning Contract

The authenticated `limitless-mcp` Worker exposes the owner’s current Today
workbench to the native Interview Arc Voice planner. D1 and the existing Today
mutation rules remain authoritative. Voice stores only ephemeral selection and
presentation state.

## Read

`GET /voice/planning`

Query parameters:

- `specialty`: `leetcode`, `system_design`, or `behavioral`
- `search`: bounded free-text search
- `starred`: `true` to show owner-starred questions only
- `attention`: comma-separated `due`, `needs_review`, `solved`, `helped`,
  `failed`, `todo`; review filters OR together, result filters OR together,
  and the two groups combine with AND, matching the website composer
- `difficulty`: comma-separated `easy`, `medium`, `hard`
- `sort`: `frequency`, `recent`, or `acceptance`
- `direction`: `asc` or `desc`
- `page`: one-based page
- `pageSize`: 1–100

The response contains:

- protocol version and Pacific date;
- current open workbench identity;
- its optimistic workbench revision;
- Today summary and current sessions, activities, focus blocks, and timers;
- a paginated specialty-local catalog;
- per-question owner star, eligibility, disabled reason, and recent completion.

Already-planned questions remain visible but ineligible. Filter/search/sort
state is supplied by the caller and never crosses specialties unless the caller
deliberately reuses it.

## Mutate

`POST /voice/planning/mutations`

Every mutation supplies:

- `mutationId`: a stable client-generated identity reused for retries;
- `workbenchId`: the workbench read before composing the change.

Supported mutation types:

- `add_selection`: add 1–30 practice or Job applications selections as
  `standalone` work or one new `session`;
- `create_full_session`: use the canonical frequency/eligibility recipe for
  configurable Coding, System design, and Behavioral counts;
- `problem_star`;
- `personal_question_upsert`;
- `remove`: remove an untouched activity, focus block, or session.
- `start_fresh_today`: archive the current workbench and create the supplied
  new workbench identity only after the canonical missing-result guard passes.

Job applications is a focus selection inside Activities. It is never a fourth
full-session specialty.

An exact retry returns the stored mutation response. Reusing a mutation ID with
changed content returns `planning_mutation_identity_conflict`. A stale
workbench returns `stale_workbench`. Batch creation writes its activities,
optional focus block, optional session, and mutation receipt in one D1 batch.

Successful mutations publish exactly one owner-scoped `practice_changed`
revision. Voice refreshes from this invalidation and does not poll.

`start_fresh_today` returns `planning_conflict` with the canonical missing-result
message when any started practice activity lacks a result. Voice presents that
blocker and leaves the current workbench untouched.

## Concurrency

The Worker rejects stale workbench identities before mutation. Existing
server-side removal guards reject work that has started or accumulated durable
evidence. Same-workbench duplicate questions return `already_planned`.

Conflicts are recoverable: refresh authoritative state, preserve still-valid
local selections, and explain disabled items before retrying with a new
mutation ID.

## Timer Projection

The authenticated Voice timer read adds `workbenchActivities`, containing every
activity and focus block in the open workbench grouped by nullable `sessionId`,
plus `sessions` and each session timer. Completed rows remain visible there
with their authoritative timer state so a client can show them as complete and
suppress Start. The legacy `activities` focused-session slice remains during
native-client rollout. A focused or running row is only the current pointer;
it never narrows `workbenchActivities`. An empty workbench is represented by
empty arrays, not by falling back to Session 1.

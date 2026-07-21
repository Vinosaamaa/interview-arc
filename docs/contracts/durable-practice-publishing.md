# Durable Practice Publishing Contract

Interview Arc separates **draft capture**, **specialist finalization**, and
**publication**. Saving a record to D1 is not publication. Publication means a
versioned artifact and daily journal have been merged, imported, and marked in
D1 by the coordinator.

## Stable Tasks

Use these long-lived Codex task titles inside the same project:

- `Interview Arc — Coordinator`
- `Interview Arc — LeetCode`
- `Interview Arc — System Design`
- `Interview Arc — Behavioral`

Titles help discovery but do not grant hidden shared memory. The coordinator
registers each specialist's task/thread identifier once with
`register_specialist_task`. It then reuses `get_specialist_tasks` and the Codex
task coordination tools; the user should not repeatedly paste task IDs.

## Activity Resolution

Every transcript turn, note, review, and finalization is joined by
`activity_id`.

1. Prefer an explicitly supplied activity ID or LeetCode URL/title.
2. Otherwise use the matching focused dashboard activity from
   `get_today_practice`.
3. Otherwise use a clearly established recent activity in the same specialist
   task.
4. If more than one activity is plausible, ask. Never attach conversation to a
   guessed activity.

Only practice conversation after the activity boundary is in scope. Website
bugs, scheduling, Git discussion, unrelated questions, and task administration
must not enter a practice transcript.

## Draft Capture

Specialists call `append_practice_transcript` with small, ordered, idempotent
batches. Flush after roughly two or three short exchanges and always on:

- activity switch;
- pause or finish;
- a long answer;
- a coordinator finalization request;
- task interruption when a flush is still possible.

This is an append-only draft. Do not rewrite the whole interview after every
message. `turn_id` must be stable on retries. Preserve the user's and
specialist's exact activity-related meaning; do not reconstruct unobserved
conversation.

When the user says “please note for this problem/question,” call
`add_practice_note` for any specialty and preserve the user's wording. Notes are
pinned and appear before the rest of the case file.

## Specialist Finalization

On the coordinator's request—or `Publish today's practice` inside one
specialist task—the specialist:

1. reads its pending/ready activities;
2. flushes all unsaved activity-scoped turns;
3. consults the required question references;
4. saves one complete bundle per activity with
   `save_specialist_finalization`;
5. schedules review when warranted.

The specialist does **not** edit Git, switch branches, commit, open a pull
request, mark an activity published, or deploy.

Every complete bundle contains:

- title and concise summary;
- transcript scope;
- what the user did well;
- what to improve;
- an improved answer or solution/walkthrough;
- references actually consulted, with access date/time;
- type-specific analysis.

System-design and behavioral bundles use `transcript_scope: full_activity` and
include the complete two-sided activity transcript. LeetCode uses
`activity_exchanges` when coaching occurred and `none_observed` when it did not.
An unasked LeetCode problem still receives an original problem summary, best
approach, generated reference code, time/space complexity, edge cases, and up
to two meaningful alternatives. It must explicitly say no coaching
conversation was observed.

References are source links, not copied protected text. Include only URLs
actually consulted. SystemDesign.io and Bugfree.ai bank pages are checked first
for their matching activities. Never claim an inaccessible reference was read.

## Coordinator Command

`Publish all pending practice` is owned by `Interview Arc — Coordinator`.

1. Read `get_publication_queue` without forcing a date.
2. Group ready activities by specialty and Pacific completion date.
3. Discover registered specialist tasks. Message each relevant specialist
   sequentially to flush and finalize its pending activity IDs; wait for the
   response before consuming its bundle.
4. Read each complete D1 practice record with
   `get_activity_practice_record`. If a specialist task is unavailable, use an
   already-complete D1 bundle. If neither exists, report the specific activity
   as blocked; never invent the missing transcript or review.
5. Render the type-specific Markdown artifacts and daily journals from D1.
6. Preserve exact Pacific start/end time, elapsed time, session membership,
   outcome, notes, transcript, review, and references.
7. Use the guarded journal checkpoint workflow for each Pacific date, then push
   one journal pull request, merge it, and allow the main workflow to import and
   deploy.
8. Only after the artifact exists and is merged/importable, call
   `mark_activities_published`.

The command is a checkpoint over every still-unpublished ready activity, not
merely the current Pacific day. It can be run after midnight without losing the
prior day's work.

Inside a specialist task, `Publish today's practice` means “finalize all
pending activities for this specialty.” It does not publish Git or production.

## Review Scheduling

Review applies to LeetCode, system design, and behavioral practice.

- failed attempt or full walkthrough: first review in **4 days**;
- completed after an approach review: first review in **7 days**;
- successful reimplementation: next review in **21 days**, then **60 days**;
- independently solved: no automatic review unless the user or specialist asks
  for one.

New session creation places up to two due reviews first and fills the remaining
configured slots with new questions. The stable bank `question_id` is the
preferred review identity; activity ID is the fallback.

## Published Case-File Order

1. Pinned Notes
2. Prompt or Problem Reference
3. Summary
4. Full Activity Transcript (system design/behavioral) or Activity Exchanges
   (LeetCode, when observed)
5. Type-specific solution or improved answer
6. What Went Well
7. What To Improve
8. Review Plan
9. Delivery Recordings
10. References

Raw transcripts and long code remain expandable in the website, but they are
still part of the published artifact.

## Audio

Transcripts are canonical. Voice Memo clips may supplement long answers and
multiple clips may belong to one activity. Raw audio never belongs in Git.
Until private Cloudflare R2 storage is configured, clips remain `local_only`.
When R2 is enabled, store only private object metadata in D1 and stream through
an authenticated Worker route that supports byte ranges; never expose a public
bucket URL.

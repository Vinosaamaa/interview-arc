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

## Solution Profile Preflight

After resolving the stable `questionId`, every specialist calls
`get_problem_solution_profile` before preparing the activity.

- When no profile exists, prepare from the canonical prompt and the specialty's
  permitted references, then create revision 1 during finalization.
- When a profile exists, use its current revision privately as the baseline for
  coaching and evaluation. Do not reveal it before a fresh attempt unless the
  user asks for the answer.
- Fresh web research is not the default on a revisit. Use it only when the
  stored profile is incomplete, plausibly outdated, disputed, missing needed
  support, or the user explicitly requests fresh research.
- After the attempt, use `solutionProfileAction: reuse_current` when the
  canonical solution did not materially change. Use `create_or_revise` with a
  complete profile when the discussion adds verified facts, a better approach,
  a stronger explanation, or a useful alternative.

Every completed attempt links to the exact revision reused or created. Never
create a new revision for punctuation or formatting alone.

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
- a complete standalone `modelAnswer` suitable for review even when the live
  conversation never requested or reached a full solution;
- references actually consulted, with access date/time;
- type-specific analysis.
- a stable `questionId` and reusable Solution Profile revision. The Solution
  Profile holds the canonical best answer and normalized tags; it never holds
  an attempt transcript. Past retains the activity transcript, feedback,
  timing, notes, result, and recording links.

Follow `solution-profiles.md` for the specialty-specific structure and tags.

System-design and behavioral bundles use `transcript_scope: full_activity` and
include the complete two-sided activity transcript. LeetCode uses
`activity_exchanges` when coaching occurred and `none_observed` when it did not.
An unasked LeetCode problem still receives an original problem summary, best
approach, generated reference code, time/space complexity, edge cases, and up
to two meaningful alternatives. It must explicitly say no coaching
conversation was observed. This requires an available canonical prompt or
user-supplied problem statement; a title or inaccessible URL alone is not
permission to invent missing constraints. Leave the bundle incomplete and ask
for the statement when the exact problem cannot be established.

The model answer is generated during specialist finalization, not reconstructed
by the coordinator. For LeetCode it is the complete original solution and
analysis. For system design it is a complete reference design with assumptions,
architecture, flows, tradeoffs, reliability, and concise interview walkthrough.
For behavioral it is the strongest truthful standalone answer supported by the
user's verified evidence. The coordinator renders this field but does not
invent or improve specialist content silently.

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
10. Delivery Review
11. References

Raw transcripts and long code remain expandable in the website, but they are
still part of the published artifact.

The website presents all observed transcript sources as one collapsed
**Conversation** layer. Structured D1 turns win over repeated Markdown
transcript sections because they preserve answer-to-audio links. Each answer's
authenticated player remains immediately above its transcript; segment details
and Delivery Coach evidence are nested and collapsed by default. Reference
solutions form a separate collapsed layer in Past and a hierarchical,
contents-navigable document in the Problem Bank.

User text highlights are owner-scoped D1 annotations. Store a quote selector
with prefix and suffix context, never an unstable DOM offset. Re-anchor after a
profile or artifact revision so highlights survive content updates; users can
list and remove saved highlights.

The web experience may replace item 5 with a stable link to the corresponding
Problem Bank Solution Profile. This avoids duplicating the same canonical
solution across repeated attempts while preserving the exact profile revision
used for each attempt.

## Audio

Transcripts are canonical. Voice Memo clips may supplement long answers and
multiple clips may belong to one activity. Raw audio never belongs in Git.
Upload clips to the private Cloudflare R2 `AUDIO` binding, store owner-scoped
metadata in D1, and stream through the authenticated `/api/audio/:id` Worker
route with byte-range support. Never expose a bucket URL or place raw audio in
Git. Transcription remains canonical for search and publication.

When audio and transcript text describe the same user answer, append the user
turn first with a stable `turnId`, then upload the audio with that ID as
`transcriptTurnId`. The link is valid only when the turn belongs to the same
owner and activity and its speaker is `user`. Past renders the full player after
the preceding specialist prompt and immediately before the linked answer text.
Multiple takes may share one user turn. Older clips without a turn link remain
readable in an unlinked activity-level recording section; never guess their
answer association.

## Interview Arc Voice

Interview Arc Voice uses protocol version `1` and the same personal integration
token as MCP and the Chrome companion.

1. `GET /voice/context` returns the **single activity whose stopwatch is
   currently running**, deterministic speech
   metadata, and registered specialist task. It never returns credentials.
2. The client records one continuous local M4A and transcribes it with Groq
   `whisper-large-v3`. Temporary derivatives or chunks are not durable clips.
3. `POST /voice/captures` writes the verbatim user transcript first with a
   client-generated, idempotent `turnId` and `source: audio_transcript`.
4. `POST /audio/upload` uploads the original recording and links it to that
   same user turn. Upload retries do not duplicate the transcript.
5. The client inserts the transcript into the visible Codex editor followed by
   an `Interview Arc Voice` Markdown comment envelope containing `activityId`
   and `turnId`. The user presses Send. The envelope states that Voice owns the
   durable D1 turn; the specialist must reuse that exact turn and must not append
   the user text again. Voice never resumes or submits the specialist task
   invisibly.
6. Delivery Coach runs asynchronously. Its owner-scoped result is saved with
   `save_delivery_analysis` and references the same activity, turn, and clip.

Focused activity lookup is global rather than limited to the current calendar
day. A mock that crosses Pacific midnight keeps its original activity and
transcript boundary; its eventual Past/publication date still comes from the
activity completion timestamp.

Persistent dashboard focus is only navigation history. A paused, unstarted, or
finished activity is never a Voice target. Voice refreshes context on launch,
wake, link-mode changes, immediately before recording, and by short background
polling. The recording locks its activity at capture start; the server accepts
it after a later pause only when an immutable activity timer interval proves
the stopwatch was running at that start timestamp.

Codex app-server accepts text and image input items, not generic audio
attachments. The background Delivery Coach therefore receives a private local
file reference for tool-based analysis while R2 provides the playable website
attachment. The visible specialist receives only the transcript and its
machine-readable Voice envelope. Raw audio is never embedded in Git or exposed
through a public URL.

Each linked clip may have one delivery-analysis record. Past renders that
review with its player and before the written answer. Analysis is limited to
observable evidence: pace, pauses, fillers, clarity, organization, vocal
variation, and perceived confidence. It must not infer mental state, health,
identity, or other sensitive traits. Queued or failed analysis never blocks the
specialist response, finalization, publication, or audio playback.

Every stop action remains one immutable transcript turn, R2 clip, and delivery
analysis. When two or more Voice-managed user turns are consecutive within the
same activity, with no specialist turn between them, they form one logical
answer for presentation. Past joins their text in sequence and presents one
segmented player that advances across the original clips without merging or
rewriting the source M4A objects.

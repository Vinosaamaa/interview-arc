# Durable Practice Publishing Contract

Interview Arc separates **draft capture**, **specialist finalization**, and
**publication**. Saving a record to D1 is not publication. Publication means a
versioned artifact and daily journal have been merged, imported, and marked in
D1 by the coordinator.

## Stable Tasks

Use these long-lived Codex task titles inside the same project:

- `Interview Arc — Coordinator`
- `Interview Arc — Loop Recorder`
- `Interview Arc — Resume & Cover Letter`
- `Interview Arc — LeetCode`
- `Interview Arc — System Design`
- `Interview Arc — Behavioral`

Loop Recorder and Resume & Cover Letter are administrative specialists and do
not participate in practice transcript, timer, finalization, review, or journal
publication state. Titles help discovery but do not grant hidden shared memory.
The coordinator registers each specialist's task/thread identifier once with
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

## Workbench Boundary

Today is the owner's current open **workbench**, not a Pacific calendar query.
It may cross midnight and remains visible until the user starts a fresh day or
its publishable rows are marked published.

- `Start fresh day` archives the current workbench and opens a new durable
  `workbench_id`.
- Starting an activity stopwatch creates an attempt. A started activity must
  receive an explicit **Solved**, **Solved with help**, or **Failed** result
  before its activity timer, parent session, workbench, or publication cycle
  can finish. Interview Arc never assigns a result automatically.
- Started timers with explicit results close at the confirmation time; elapsed
  time and outcomes are preserved. Never-started activities remain not
  attempted, return to the selection pool, and do not enter the publication
  queue.
- Archived ready work stays discoverable through the undated publication
  queue and in Past. Starting fresh never marks an activity published and never
  loses pending work.
- A completed publication cycle archives the current workbench and opens a new
  empty one once every started activity in that workbench is published.
  Never-started questions return to the pool.
- A finished session permanently locks all child timer controls. Unpublished
  result flags remain correctable; published result flags are read-only.
- Session and activity removal is allowed only before any timer, result,
  transcript, recording, finalization, or publication evidence exists.

Career focus blocks share the workbench and single-active-stopwatch boundary
but are not practice activities. They require no outcome, specialist,
finalization, review, or publication. Starting fresh closes and archives
started focus time; it never places that block in Past or the publication
queue. A focus block may be a standalone Today row or a member of an
Activities-composer session; session membership does not add a practice result
or publication requirement. Follow `career-work.md`.

## Solution Profile Preflight

After resolving the stable `questionId`, every specialist calls
`get_problem_solution_profile` before preparing the activity.

- When neither a current nor provisional profile exists, prepare from the
  canonical prompt and permitted references, then call
  `save_provisional_solution_profile`. This reusable preflight survives delayed
  or batch publication without creating a numbered revision.
- When only a provisional profile exists, use it as the private baseline. The
  first complete finalization promotes the finalized answer to revision 1.
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
- Save `solutionProfileDecision` with the reason, changed section names,
  whether fresh research occurred, and the sources checked. The D1 write path
  automatically reuses the current revision when the submitted profile is
  substantively identical.

Every completed attempt links to the exact revision reused or created. Never
create a new revision for punctuation or formatting alone.

## Exact-once Draft Capture

During the interim #155 workflow, the specialist delegates the operations in
this section to the activity's reusable persistence-only sub-agent after
composing the visible answer. Follow `background-specialist-persistence.md`
for delegation, concurrency, and failure behavior. The operation mappings and
durability rules below remain authoritative. A child acknowledgement is not a
saved receipt. The hook/D1 outbox replacement remains tracked by #93.

For a related typed exchange, the persistence child calls
`save_practice_exchange` once
per user question and canonical specialist response. The write is atomic,
ordered, and identity-idempotent. Exact retries reuse the saved pair; the same
turn ID with changed identity or content is rejected rather than rewritten.
`append_practice_transcript` remains available only for legacy recovery and
imports.

If the user explicitly authorizes removing one already-saved typed exchange,
read `get_activity_practice_record` and select the exact entry from
`typedExchanges`. Call `delete_typed_practice_exchange` with its activity,
user/reply turn IDs and revision, one stable operation ID, the literal
authorization, and a non-empty audit reason. The D1 transaction removes both
typed turns or neither and stores an immutable tombstone in
`typedExchangeDeletions`; exact retries return that receipt, while changed
payloads or deleted stable-ID reuse conflict. A ready/published exchange or one
that anchors Code Attempt, Voice, audio, or delivery evidence is ineligible.
The tombstone fences every transcript writer. Code Attempt review completion
and audio registration recheck exact transcript identity in their write
transaction, while finalization checks the activity transcript/deletion
snapshot it evaluated; concurrent operations therefore leave no dangling
evidence. Repair-event history is dependent Voice evidence and also blocks
deletion.
The operation never resets the whole transcript and never removes activity,
timer, session, result, note, Code Attempt, Voice, or published state.

For a related protocol-v2 Voice envelope, the persistence child calls
`resolve_voice_capture_and_save_response`. That operation atomically marks the
capture `activity_related` and reserves one canonical response linked through
`replyToTurnId`. Interview Arc holds the response provisionally until Voice
delivers the matching user transcript, then materializes the ordered pair once.
Use `resolve_voice_capture` only for `unrelated` or `uncertain` decisions.

When one visible specialist response answers 2–20 ordered Voice captures and
any member is activity-related, call
`resolve_voice_captures_and_save_response` once with every capture/user-turn
identity that response actually answers, in visible order, and one stable
specialist response. This applies whether the captures appeared as several
envelopes in one prompt or arrived as separate prompts while the assistant turn
remained active. The response boundary, not arrival timing, defines membership.
Never reserve a member with the singular resolver before the complete response
and exact group are known. If no member is activity-related, do not save the
response as practice dialogue; resolve each member through the supported
`unrelated` or `uncertain` path.
D1 buffers each accepted transcript independently, permits each private clip
and delivery analysis to arrive independently, and materializes the canonical
transcript only when every member is durable: all ordered user turns followed
by the one shared specialist turn. Exact retries must preserve order,
membership, activity, specialty, response identity, and response body. A
changed retry returns a structured non-retryable conflict without mutating the
stored canonical group. The first accepted group defines one owner-scoped
immutable digest over its ordered identities and response content; exact
replays return that canonical receipt with `duplicate: true`. The singular operation
remains the compatible path for exactly one capture. Both paths acquire the
same owner-scoped capture and response-turn reservation fence in one D1
transaction, so a concurrent singular and grouped request cannot both win.
Voice still delivers each transcript and recording independently; each arrival
buffers only its member, and the final arrival performs the one guarded group
materialization after confirming every canonical turn exactly.
After this MCP catalog change deploys, reconnect the coordinator and all three
long-lived specialist tasks before relying on the batch operation.

When delivery or Finish reports a group conflict, the coordinator first calls
`get_voice_delivery_blockers`. It returns owner/activity-scoped identity,
canonical-turn/audio/deletion state, retryability, permitted actions, and the
group digest without transcript or audio content. An intact
`quarantined_conflict` group may be restored only with
`repair_voice_response_group`, the exact activity and response turn, current
digest/status, explicit user authorization, and an audit reason. Repair checks
every member and reservation, never rewrites immutable evidence, is
idempotent, and leaves missing members awaiting delivery. Exact deletion is a
separate explicitly authorized action. Reconnect Codex after deployment
because MCP tool catalogs are loaded when the connection starts.

For a retryable delivery blocker, a specialist now follows this bounded runbook:

1. Call `get_voice_delivery_blockers` for the exact activity and classify each
   returned capture before taking action:

   | Server state | Classification | Action |
   | --- | --- | --- |
   | `audioState: "available"` | Complete, even if the current server also labels it retryable | Exclude it from retry. |
   | Non-available, accepted or related, with `retry_delivery` allowed | Eligible | Keep its exact capture identity in the actionable set. |
   | Non-available without `retry_delivery` | Not retry-eligible | Follow only the listed permitted action; never wake it by inference. |

   The temporary `available` exclusion remains required until
   `Vinosaamaa/interview-arc#175` is released.
2. If the actionable set is empty, do not wake Voice. Otherwise, keep
   Interview Arc Voice running and call `retry_voice_delivery` once for this
   activity. The call publishes
   `voice_delivery_retry:<activityId>` and asks the native client for one
   forced, idempotent local-original retry. It does not upload bytes itself or
   prove completion.
3. Never issue parallel or immediate back-to-back wakes. Complete this scoped
   call and its authoritative read-back before signaling another activity.
   This serialization is required until
   `Vinosaamaa/interview-arc-voice#178` is released because an occupied native
   single-flight lock may drop a later wake.
4. Re-read `get_voice_delivery_blockers` for the same activity after the native
   attempt. Finish only when every required capture is
   `audioState: "available"` and no other blocker remains.
5. When exact captures remain non-available, the specialist reports their IDs
   and states to the coordinator instead of looping. After the native retry is
   idle, the coordinator re-reads state and may serialize at most one later
   wake for that still-blocked activity.
6. For `retry_signal_unavailable`, ask the user to open Interview Arc Voice,
   then retry the same scoped MCP operation once. Do not claim a native
   **Retry now** button exists unless it is visible in the installed app.

If the user explicitly confirms that a particular original cannot be recovered,
call `acknowledge_voice_audio_loss` with that exact capture, activity, and turn
identity. It preserves the canonical transcript and specialist response,
creates the missing owner-scoped audio-loss metadata when necessary, and marks
the recording `audio_lost` and acknowledged so Finish can proceed while
rendering **Recording unavailable**. This is not a silent unregister or a
shortcut for a retryable upload. To remove the entire accepted exchange,
including its transcript and shared response, use the separately authorized
`delete_related_voice_capture` operation instead.

This gives specialists an actionable recovery operation while preserving the
privacy boundary: protected local recordings never cross through the specialist
conversation or become public URLs.

An administrative capture that is still pending must be classified
`unrelated`; it does not require deletion. If an explicit user correction says
that a capture already classified related was misclassified, use
`delete_related_voice_capture` with the exact registered capture, activity,
and turn IDs. This is destructive post-acceptance remediation: never infer
authorization, delete by transcript text, or use it for a merely pending
capture. The operation reuses the fenced owner-scoped deletion graph, removes
the canonical user/response turns, response reservation, private recording
metadata/object, and delivery analysis, and retains only the terminal intent
tombstone needed for idempotence.
If the capture belongs to a multi-capture response group, remediation deletes
the entire logical answer—including every member transcript, clip, analysis,
and the shared response—so it cannot leave a misleading partial answer.

Completed MCP receipts confirm every decision and write but are never
persisted. The parent may instead show the interim background-delegation line;
it must not translate that line into a saved claim.
Untouched `pending` captures are discarded as `discarded_unclassified` when an
activity finishes and do not block completion. An `uncertain` capture requires
Attach or Discard. A confirmed related capture missing delivery requires Retry
or Discard. Local 24-hour expiry must first record
`expired_unclassified` on the server before deleting the local record.

Finish, parent-session Finish, workbench closure, and complete specialist
finalization use the same authoritative evidence gate. Every `accepted`
capture must have the exact canonical user/specialist pair materialized in D1
and its matching `activity_audio_clips.status` must be `available`. The gate
reads indexed D1 state; it never performs an R2 object lookup. Missing,
`local_only`, `uploading`, and `failed` clips block with Retry upload. Proven
irrecoverable local-source loss becomes `audio_lost`; it blocks until explicit
acknowledgement, then preserves the canonical transcript and renders
**Recording unavailable** without inventing audio or Delivery Coach evidence.

An untouched pending capture that reaches 24 hours is not deleted by local age
alone. Voice sends its stable capture/activity/turn identity, the Worker
verifies the owner-scoped pending row, records `expired_unclassified`, and only
then may Voice remove the local transcript/audio. `uncertain` never
auto-expires; it remains an Attach-or-Discard decision.

Publishing reads only materialized D1 turns. It never guesses missing Voice
decisions, reconstructs specialist answers from task history, or publishes
provisional responses.

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
5. polls the returned durable write receipt until `saved` or `failed`—a
   `queued`, `processing`, or `retry_wait` receipt is not a completed
   finalization;
6. schedules review when warranted.

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
- for every new completed behavioral activity, the immutable typed final-answer
  snapshot defined by `behavioral-final-answer-snapshots.md`.
- the typed Behavioral Attempt audit embedded in that snapshot, as defined by
  `behavioral-attempt-analysis.md`.

For a CLI-native Java LeetCode activity, the specialist may maintain one local
working file at
`practice/leetcode/solutions/<four-digit-number>-<canonical-title-slug>.java`.
It must not create per-problem directories, separate prompt Markdown files, or
local/Git snapshots of failed intermediate submissions. The file becomes a
publishable Git solution only after an authoritative LeetCode `Accepted`
verdict. The specialist does not commit it; the coordinator includes the exact
accepted source with the activity publication. An unfinished or unaccepted
working file is not a publication artifact.

For the temporary self-test workflow, the **Durable-practice boundary** in
`leetcode-java-harness.md` is authoritative. Publishing never ingests local
harness state or plumbing; it may render a meaningful local conclusion only
when that conclusion already belongs to an observed activity exchange.

For an owner-private LeetCode question created from a public problem URL, the
LeetCode specialist also performs a metadata preflight during the first
complete finalization. It supplies `questionMetadata` with every currently
verified field that is available: public problem number, difficulty, acceptance
rate, official topic labels, and any permitted company metadata. The bundle
must include a capture time and every source actually consulted.

- This metadata preflight is a single-question step, not a bulk crawler. Never
  inspect cookies, account state, submission history, or undocumented private
  endpoints. Editorial review is separate: after a fresh attempt or when the
  user requests a solution/review/alternatives, follow the LeetCode specialist
  guide and review the visible official Editorial tab through the normal UI.
  Paraphrase its approaches and cite it only when actually consulted. Generate
  independently written, Java-first reference code that preserves the best
  justified asymptotic complexity, correctness invariants, and edge-case
  behavior while removing unnecessary verbosity or abstraction. Never copy
  protected prose or official code verbatim, and state any changed tradeoff.
- Prefer the exact public LeetCode URL supplied by the user for official
  metadata. If access is blocked, omit the unavailable fields instead of
  guessing them.
- Company tags and frequency signals require an existing user-provided import
  or another source the user explicitly authorized. Do not infer company
  frequency from general reputation or search snippets.
- The D1 write merges verified values into the owner-scoped question. Omitted
  fields and prior provenance are preserved. The finalized Solution Profile's
  normalized tags are also merged into the personal question for search and
  filtering.
- Canonical Git-backed bank questions are never mutated by this path. On later
  attempts, metadata research is needed only for a concrete missing or
  plausibly stale field, a disputed value, or an explicit refresh request.

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

Behavioral `modelAnswer` remains the compatibility field, but new completed
behavioral finalizations must also store the byte-identical typed snapshot.
Past and exports read the attempt snapshot; they never substitute the current
canonical Solution Profile. A changed saved answer is an explicit append-only
correction, not a finalization overwrite. Legacy `modelAnswer` remains an
explicit fallback without fabricated backfill.

Behavioral finalization may additionally carry the explicitly requested,
labeled `practiceScenarios` defined by
`solution-profiles.md`. They are adjacent study material, never a substitute
for the truthful `modelAnswer`, user evidence, or a preferred personal answer.
The coordinator preserves their mode, label, stable scenario/revision identity,
and canon verbatim on every reader or export surface.

References are source links, not copied protected text. Include only URLs
actually consulted. SystemDesign.io and Bugfree.ai bank pages are checked first
for their matching activities. Never claim an inaccessible reference was read.

## Coordinator Command

`Publish all pending practice` is owned by `Interview Arc — Coordinator`.

1. Read `get_publication_queue` without forcing a date.
2. Group ready activities by specialty and Pacific completion date. Within
   each specialty, group by stable `questionId` and process attempts in
   chronological completion order. The first attempt may create revision 1;
   each later attempt reloads the newly current profile and reuses it unless
   that attempt materially improves it.
3. Discover registered specialist tasks. Message each relevant specialist
   sequentially to flush and finalize its pending activity IDs; wait for the
   response before consuming its bundle.
4. Read each complete D1 practice record with
   `get_activity_practice_record`. If a specialist task is unavailable, use an
   already-complete D1 bundle. If neither exists, report the specific activity
   as blocked; never invent the missing transcript or review.
   When the tool returns `delivery: content_json`, parse the complete compact
   record from `content`; the bounded `structuredContent` object is only the
   delivery receipt and deliberately does not duplicate a large transcript.
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

Behavioral Project Deep Dives additionally follow
`behavioral-project-deep-dives.md`. The publishing coordinator resolves the
exact project binding and immutable Solution Profile revision, then renders
that canonical profile; it never copies a Learn-owned body or publishes from a
title/tag inference. Existing Past attempts require their audited additive
project link before publication. Finalization and D1 linkage are readiness,
not publication, and never authorize publishing a transcript by themselves.

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

The upload boundary is D1 status `available`, written only after the private R2
put succeeds. Voice retains the original local M4A and stable clip identity
until that acknowledgement. A repeated upload uses the same identity and must
not duplicate the D1 row or R2 object. D1 `audio_lost` is a terminal incident,
not a substitute for `available`; it requires the explicit acknowledgement
described above.

## Interview Arc Voice

Interview Arc Voice uses protocol version `2` and the same personal integration
token as MCP and the Chrome companion.

1. `GET /voice/context` returns the **single activity whose stopwatch is
   currently running**, its `startedAt` and `runningSince` timer timestamps,
   authoritative open `workbenchId`, deterministic speech metadata, and
   registered specialist task. The
   timestamps permit safe late binding only when the activity was already
   running when recording began. It never returns credentials.
2. The client records one continuous local M4A and transcribes it with Groq
   `whisper-large-v3`. Temporary derivatives or chunks are not durable clips.
3. Only captures started in the Codex bundle (`com.openai.codex`) can enter the
   linked flow. Other destinations remain general dictation and never write
   D1/R2.
4. `POST /voice/intents` writes stable IDs, activity, specialty, occurrence
   time, status, and SHA-256 only. Exact transcript and audio remain in Voice's
   permission-`0600` local pending queue.
5. The client inserts the transcript plus a v2 envelope containing
   `captureId`, `activityId`, and `turnId`. The specialist classifies that same
   turn as activity-related, unrelated, or uncertain.
6. Only activity-related captures may call `POST /voice/captures` and
   `POST /audio/upload`. The accepted turn is idempotent; upload retries do not
   duplicate it. Uncertain captures require a Voice Attach/Delete decision.
7. Delivery Coach runs asynchronously. Its owner-scoped result is saved with
   `save_delivery_analysis` and references the same activity, turn, and clip.
8. **Captures in this Workbench** contains every local linked capture for the
   authoritative open workbench, including more than twenty. Complete capture
   metadata remains until successful workbench rollover; General Dictation
   stays in the separate newest-20/24-hour Recent Transcripts history.

Focused activity lookup is global rather than limited to the current calendar
day. A mock that crosses Pacific midnight keeps its original activity and
transcript boundary; its eventual Past/publication date still comes from the
activity completion timestamp.

Persistent dashboard focus is only navigation history. A paused, unstarted, or
finished activity is never a Voice target. Voice refreshes context on launch,
wake, link-mode changes, immediately before recording, and owner-scoped live
invalidation, with bounded status-first fallback while disconnected. It never
uses an unconditional one-second poll. The recording locks its activity at capture start; the server accepts
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

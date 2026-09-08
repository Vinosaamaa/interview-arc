# ChatGPT Specialist Workflow — Portability Proposal

Status: proposed implementation contract for issue #439, not a claim of shipped
ChatGPT connectivity. The existing owner-private practice, Today controls,
interaction-mode, and specialist contracts remain authoritative. This proposal
must not relax their guards or change existing Codex/Voice behavior by itself.

## Outcome and scope

The owner should conduct a complete, hours-long practice workflow primarily
through **ChatGPT Live**, with the same practice capabilities as the local Codex
specialists. Connecting a timer or publishing an OAuth endpoint is not completion.

Cover LeetCode, System Design, and Behavioral practice: choose the specialist;
create/resume a workbench; create sessions and standalone activities; search or
add questions; coach in the selected mode; control timing; save relevant exact
conversation; capture attempts, notes and reviews; finish; finalize privately;
and resume from durable history. Audio upload is not required. Local code,
submission, drawing, and research capabilities remain explicit parity work, not
features silently excluded by calling the remote subset complete.

Loop Recorder, Learning, Resume & Cover Letter, and Coordinator remain distinct
roles. Inventory their dependencies when a practice flow consumes them, but do
not grant a practice specialist their administrative mutation authority. Do not
relabel GitHub issue work or application administration as practice dialogue.

## Client feasibility is a release gate

ChatGPT Live is the requested OpenAI conversation surface. It is not the native
`interview-arc-live` application, ordinary dictation into text chat, a custom GPT,
or a new application built with a separately billed model API.

Before selecting a production adapter, record the actual account/workspace,
client surface, application version, available actions, and observed transport:

1. Discover the connected tool catalog in the target client.
2. Verify an owner-authenticated read and one explicitly authorized mutation
   with authoritative dashboard readback, using a dedicated test activity.
3. Verify availability of the finalized user transcript and the **actual**
   specialist response for the same Live exchange, including interruptions.
4. Verify continued tool use and transcript delivery after a long answer,
   interruption, reconnect, and conversation continuation.

OpenAI's Voice documentation, inspected on 2026-09-07 Pacific time, says Live
initially does not support connected apps/plugins; the Apps help page also says
Voice does not support apps. Availability must therefore be verified in the
actual target surface rather than inferred from a working text-chat connector.
The documentation separately describes Voice in Work/Codex; that is another
surface to evaluate, not proof that consumer ChatGPT Live has custom MCP writes.

Sources:
- https://help.openai.com/en/articles/20001274/
- https://help.openai.com/en/articles/11487775
- https://help.openai.com/en/articles/12584461

If direct Live cannot invoke the integration or deliver exact turns, report the
specific blocker and retain it in #439. Evaluate a supported, owner-authorized
bridge separately. Do not silently substitute another app or model API, claim a
backend change enables unavailable client features, scrape hidden chat APIs,
extract cookies, or reconstruct missing responses. A text-only milestone does
not satisfy Live acceptance.

The user referred to "MCP2" while requesting the audit. No repository component
with that exact identifier was found in the inspected main branch. Inventory the
actual MCP catalog, protocol negotiation, SDK version, Voice v2 envelope, and
Live HTTP v1 independently; do not assume these are interchangeable protocols.

## Existing foundations and gaps

Baseline: main commit `94be6c6cf25065fe8ba6e342ed09c3891ca37354`.

| Workflow | Existing tool/contract foundation | Portability work to verify or implement |
| --- | --- | --- |
| Resume/context | `get_today_practice`, `get_activity_practice_record`, `get_problem_solution_profile` | Connected-client identity, bounded hydration, exact role/mode/context |
| Workbench | `control_practice_workbench` | Initial/no-workbench behavior and explicit guarded rollover |
| Sessions/activities | `query_practice_catalog`, `plan_today_practice`, `remove_today_practice_activities` | Full-session and standalone creation, extras, focus, partial-command recovery |
| Questions | `upsert_personal_bank_question`, `get_specialist_write_status` | Durable custom question creation before planning; canonical deduplication and verified metadata |
| Activity/session clocks | `control_practice_timer`, `control_practice_session_timer` | Real client calls with current revisions, explicit authorization, receipt readback |
| Coaching modes | `get_practice_interaction_mode`, `set_practice_interaction_mode` | Preserve Interviewer/Mentor behavior and exact classification provenance |
| Transcript/notes | `save_practice_exchange`, Voice-v2 resolvers, `add_practice_note` | ChatGPT transcript-only provenance, relevance segmentation, finalized response parity, delivery hook/outbox |
| Attempt/result | `save_leetcode_code_attempt`, `set_practice_result` | Exact owner code and visible review; no inferred success |
| Finish/review | `save_specialist_finalization`, `schedule_practice_review`, `get_specialist_write_status`, `retry_specialist_writes` | Drain accepted exchanges, queue complete packet, reread exact immutable revisions |
| Reconciliation | `get_publication_queue`, private-record contract | Resume pending/failed private finalizations without Git publication |
| Local specialist features | Repository LeetCode/Excalidraw controllers and Java harness | Supported, authenticated execution bridge and real runtime health evidence |

Inspect server registration and input/output schemas as well as the Codex
allowlist. Presence in a source file is not a live capability check.

Relevant contracts:
- [Today controls](specialist-today-controls.md)
- [Owner-private records](owner-private-practice-records.md)
- [Durable capture](durable-practice-publishing.md)
- [Background persistence](background-specialist-persistence.md)
- [Live HTTP v1](live-v1.md)
- [Interaction modes](practice-interaction-modes.md)
- [Solution Profiles](solution-profiles.md)
- [Shared specialists](../../practice/AGENTS.md)
- [LeetCode](../../practice/leetcode/AGENTS.md)
- [System Design](../../practice/system-design/AGENTS.md)
- [Behavioral](../../practice/behavioral/AGENTS.md)

`/live/v1` already has atomic candidate/interviewer pairs with optional clips and
text-evidence Finish guards, but its activity projection is System Design only,
its current provenance identifies Codex/audio transcripts, and its writer lease
requires client renewal. Reuse established transaction/storage semantics, not
that entire wire contract unchanged. Incompatible v1 changes require a new
version. Do not manufacture Voice-v2 capture identities to carry ChatGPT text.

## Complete interaction lifecycle

### Start, plan, and switch

Resolve or initialize the current owner workbench through a documented supported
operation. Read current state before planning or mutation. Never fabricate an
activity, session, workbench ID, revision, role assignment, or running timer.

Support explicit session creation with selected category counts, standalone
activities, extra activities, existing bank selection, and one new owner-private
question from a supplied title/prompt/URL. Verify permitted metadata, preserve
source provenance, leave unknowns empty, and wait for the question's durable
receipt before planning an activity that references it. Preserve current
canonical question/day deduplication and review rules.

Keep the session countdown separate from each activity stopwatch. Respect the
single-active-activity invariant, canonical session order, and existing
pause/resume/finish semantics. Preparation alone does not start timing. Compound
requests such as "add this question, start it, and use Mentor mode" carry stable
per-operation identities and explicit authorization. Report partial completion
and resume from receipts rather than rerunning the entire command blindly.

Resolve activity context at each exchange boundary. A later dashboard focus
change cannot move an already accepted answer to a different activity. Switching
specialists/questions changes subsequent context explicitly; a conversation may
span many activities without mixing their evidence.

### Coach with the existing specialist standards

Load the owning guide and private current/provisional Solution Profile before
coaching; preserve the answer boundary for a fresh attempt. Keep Interviewer and
Mentor distinct and apply only owner-requested changes. Preserve question
clarification, hints, reasoning, debugging, correctness, complexity, system
design tradeoffs, behavioral evidence, references, full post-attempt review,
complete model solutions, and spaced reviews.

Walkthroughs are not successful attempts. Generated reference code/designs are
not owner work. Local test success is not a platform Accepted verdict. Missing
code, evidence, outcomes, or observations stay missing.

### Persist conversation incrementally, without required audio

The new adapter must support an explicit transcript-only source. Its exact wire
schema and migration are implementation work. Required semantics are:

- stable conversation/segment, activity, exchange, and turn identities;
- exact finalized user text and exact actual specialist response, roles, order,
  activity/question binding, provenance, and available occurrence timestamps;
- server receipt time distinct from source occurrence time; unavailable source
  metadata is never invented;
- atomic canonical exchanges, stable idempotency identities, changed-content
  conflicts, and immutable correction/deletion audit boundaries;
- no raw recordings, Voice capture intent, R2 audio placeholder, Delivery Coach
  request, or missing-audio Finish blocker for a transcript-only exchange.

Do not label ChatGPT output as Codex output or its transcript as a verified
recording. Existing Voice-v2 audio obligations remain unchanged for real
Voice-v2 captures, including when an activity contains multiple evidence types.

For each observed exchange, classify relevance against the resolved activity:

| Classification | Required action |
| --- | --- |
| Related | Save the exact activity-related user/specialist exchange, including follow-up questions and coaching. |
| Unrelated | Do not put its text in the practice transcript, review, or Solution Profile. Operational commands may execute separately. |
| Mixed | Preserve only precisely identified related spans with source/turn linkage; exclude administrative spans. When reliable separation is impossible, request a bounded decision rather than silently storing everything. |
| Uncertain | Keep it out of the canonical transcript until an explicit Attach/Exclude decision; make the unresolved boundary visible. |

Relevance is semantic, not a keyword filter. "Pause the timer" is an operation,
not interview evidence; "Why is this BFS O(V+E)?" is related. A general subject
change must not enter the active problem merely because a timer is running.
Minimal receipt metadata for exclusion must not copy the excluded body. Any
retained recovery text requires a separately defined private retention policy.

Group multiple input segments only when one actual response answers them. Use
stable order, membership, response identity, and source-span provenance. Do not
rewrite the existing Voice-v2 whole-group contract as a side effect of adding a
new ChatGPT source. Repeated identical wording in distinct real turns remains
distinct; retry deduplication uses identity, not text equality.

Interruptions require exact final-response handling. A precomposed response
passed to a tool is not automatically the response the user ultimately received.
Use a supported finalized-turn hook or a verified parity-preserving delivery
protocol. Store the actual delivered partial/final text with its status; never
present abandoned generation as a complete spoken answer. Test edits,
regeneration, interruption, overlapping captures, and cancellation explicitly.

### Survive hours, reconnects, and context limits

Accepted payloads must enter an application-owned durable queue or D1 transaction
incrementally. Do not depend on a final end-of-chat flush, hidden chat history,
a continuously running model, a Codex sub-agent, or perfect context retention.
A queue is durable only after its actual server receipt.

Maintain ordered watermarks/cursors and immutable write receipts. Bound reads
and payloads; hydrate the current question, mode, notes, transcript tail,
progress checkpoint, and pending writes after reconnect. A compact checkpoint
helps coaching but never replaces the complete transcript. Missing turns remain
explicit gaps, not reconstructed dialogue.

Credential expiration, app suspension, network loss, stale revisions, duplicate
messages, retry storms, two concurrent clients, and cross-surface handoff must
not duplicate, rewrite, or silently drop accepted evidence. Lease ownership and
renewal must belong to a real client/service, not an assumed idle ChatGPT timer.
Preserve session IDs across Pacific midnight and apply existing completion-date
rules. Never claim the assistant will independently wake or notify later unless
an actual product scheduler delivers that functionality.

### End, finalize, publish, and revisit

Distinguish pause, stop/finish activity, finish session, workbench rollover,
outcome, and private finalization. Resolve ambiguous destructive/completing
intent without inventing a result. Before Finish, reconcile all accepted related
exchanges and expose specific unresolved decisions or failures.

Queue one complete finalization packet with the supported transcript scope,
review, correct owner-versus-Mentor attribution, exact code/design assets when
available, complete reusable Solution Profile, consulted references, and review
schedule. Pending/processing is not saved. Verify the exact immutable record,
profile revision, hashes, and links before reporting completion.

"Publish the transcript" means make the authorized practice record available
in owner-private Past through the existing D1/R2 path, not put personal dialogue
in a public GitHub commit. "Publish today's practice" reconciles eligible
specialty work; "publish all pending practice" uses the coordinator boundary.
No daily Git artifact or deployment is necessary for routine practice.

## Authentication and local capability boundaries

Use supported remote MCP authentication with verified owner binding, revocation,
least privilege, correct read/write metadata, and explicit mutation consent.
Never expose integration tokens in chat, URLs, examples, logs, or committed
files. Retain existing revision, retry, owner isolation, and authorization checks.
Do not grant arbitrary shell or arbitrary upstream HTTP access.

Remote calls alone do not run the owner's Java source, local browser controller,
or Excalidraw canvas. For full parity, provide a supported authenticated bridge
to the existing controllers or a separately reviewed equivalent. Verify exact
workspace/activity, runtime lease, source bytes, one-submit identity, verdict,
scene checkpoint, and immutable final assets. Offline/unavailable runtimes need
honest recovery states; do not report submission, drawing, or testing success
from intent. Cross-repository work requires linked issues/PRs in its actual owner.

## Delivery and acceptance

Deliver reviewable slices without narrowing the parent issue:

1. Full parity inventory, client feasibility evidence, and this contract.
2. Secure connection and portable role/context bootstrap.
3. Workbench, session, activity, question, mode, and timer orchestration.
4. Transcript-only relevance classification, exact delivery, durable queue,
   and bounded reconnect recovery.
5. Attempts, reviews, private finalization, Solution Profiles, and history.
6. Local-runtime parity and deployed multi-hour end-to-end verification.

All of the following remain required for #439 closure:

- [ ] Verify the actual ChatGPT Live surface; document any supported bridge and
      its limitations without substituting a different product silently.
- [ ] Run a complete LeetCode, System Design, and Behavioral workflow, including
      new workbench/session/activity/question creation and specialty switching.
- [ ] Verify activity and session timer commands through dashboard readback.
- [ ] Persist exact two-sided related transcripts incrementally with no audio
      uploads; exclude unrelated and operational text; resolve mixed/uncertain
      turns; preserve interrupted-response evidence correctly.
- [ ] Verify correct outcomes, attempts, notes, reviews, exact private Past and
      Solution Profile revisions, and next-review scheduling.
- [ ] Exercise a two-hour real-client run and a six-hour synthetic reliability
      run, including restarts, token refresh, repeated text, identical retries,
      changed-payload conflicts, simultaneous clients, and Pacific midnight.
- [ ] Confirm counts/order/content hashes for all accepted exchanges; no orphan
      responses, cross-activity attachments, silent omissions, or private Git data.
- [ ] Verify the required local code/browser/canvas paths, or leave full parity
      explicitly incomplete with linked blockers.
- [ ] Pass focused tests, applicable lint/local-D1/build checks, independent CI,
      and authenticated deployed smoke tests; retain rollback evidence.

These are planned acceptance tests, not tests already executed by this proposal.
A draft PR, source-level tool inventory, or passing unit test is not proof that
ChatGPT Live can run this complete workflow.

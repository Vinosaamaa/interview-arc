# LeetCode Agent Instructions

Act as a coding-interview practice curator and coach. Before starting, read:

1. `../../README.md` and `../../AGENTS.md`.
2. `../../docs/contracts/activity.schema.json`.
3. `../../docs/contracts/leetcode-log.md` and `leetcode-log.schema.json`.
4. `../../docs/contracts/question-bank.schema.json` before changing bank data.
5. `../../docs/contracts/durable-practice-publishing.md` before saving notes,
   transcripts, reviews, or finalizations.
6. `../../docs/contracts/solution-profiles.md` before finalizing reusable bank
   knowledge.
7. `../../docs/contracts/reader-rendering.md` before changing the reusable
   solution template or its code-block structure.

## Authoritative Durable Publishing Workflow

The durable publishing contract supersedes any older checkpoint/branch language
later in this guide.

- Resolve the activity by explicit URL/title, then focused coding activity,
  then unambiguous recent coding context. Ask when still ambiguous.
- After resolving `questionId`, call `get_problem_solution_profile`. On a
  revisit, use the current best approach privately as the evaluation baseline
  without revealing it before the user's fresh attempt.
- If neither a current nor provisional profile exists, do the canonical prompt
  preflight once and call `save_provisional_solution_profile`. Later attempts
  reuse that prepared profile even when prior practice has not been published.
- Save every related typed user/specialist pair immediately with
  `save_practice_exchange`. Use stable user and response turn IDs. The visible
  success receipt is not part of the durable transcript. Keep
  `append_practice_transcript` only for recovery/import compatibility.
- For a related `Interview Arc Voice capture` envelope, call
  `resolve_voice_capture_and_save_response` with the supplied user `turnId` and
  one stable response turn ID. This one operation marks the capture related and
  reserves the canonical specialist answer; D1 exposes the pair after Voice
  delivers the user transcript. Use `resolve_voice_capture` only for
  `unrelated` or `uncertain`. Never append the enveloped user turn separately.
  The separate background Delivery Coach owns audio inspection and saves its
  result to D1; do not rerun that work in the visible specialist task.
  One visible message may contain several envelopes after an accidental stop
  and restart. Reuse every supplied turn in order and treat consecutive
  Voice-managed turns as one logical answer until the next specialist turn.
- Before finalization, read the activity practice record and incorporate all
  available delivery analyses into evidence-grounded `didWell` and `improve`
  feedback. Queued or failed analysis never blocks finalization.
- “Please note for this problem” calls `add_practice_note` with the user's exact
  wording. Notes apply to all practice types and lead the final case file.
- When the user supplies audio and transcript text for one coding explanation,
  append the user transcript turn first and upload the recording with that
  stable turn ID using `scripts/upload-practice-audio.mjs --turn`. This places
  the player after the specialist prompt and before the answer in Past. Never
  guess a turn association.
- `Publish this session` finalizes the current coding activity in D1.
- `Publish today's practice` and `Publish today's LeetCode` finalize every
  pending coding activity in D1. They do not edit Git, switch branches, commit,
  open a PR, mark production published, or deploy.
- For every activity, call `save_specialist_finalization` with a review (what
  went well and what to improve), mandatory complete standalone model solution,
  complexity, edge cases, and only
  references actually consulted. Include all observed activity Q&A. When no
  coding conversation occurred, use `transcript_scope: none_observed` and still
  generate the best approach, code, up to two meaningful alternatives, and
  complexity; never invent a user attempt. Generate against an available
  canonical prompt or user-supplied statement; never infer missing constraints
  from only a title or inaccessible URL. Keep finalization incomplete and ask
  for the statement when the exact problem cannot be established.
- When the resolved question is an owner-private entry created from a public
  LeetCode URL, perform the question-metadata preflight at its first complete
  finalization. Add `questionMetadata` containing every field actually
  verified from permitted sources: public problem number, difficulty,
  acceptance rate, official topics, and authorized company metadata. Include
  `capturedAt` plus each consulted source and access time. If the public page is
  inaccessible, omit unavailable fields; never guess or block an otherwise
  evidence-complete finalization solely because optional metadata could not be
  reached. Recheck later only for a missing/stale/disputed field or explicit
  request.
- Pass the stable `questionId` and a complete reusable `solutionProfile`. Put
  the canonical best approach, reference implementation, complexity, edge
  cases, and up to two meaningful alternatives in the profile. Keep the
  activity transcript and attempt-specific feedback on the Past record.
- Finalize with `solutionProfileAction: reuse_current` when the existing best
  solution remains correct and complete. Use `create_or_revise` only for a
  meaningful algorithm, correctness, implementation, complexity, edge-case,
  or explanation improvement.
- Include `solutionProfileDecision`. Never research again merely because a
  later attempt is in the same batch; research only for a concrete gap,
  disputed claim, plausible staleness, or explicit user request.
- Schedule failed/full-walkthrough review in 4 days, approach-review completion
  in 7 days, and successful reimplementation in 21 then 60 days.

The coordinator owns Git rendering and production publication through `Publish
all pending practice`.

## What This Task Is For

The user may use this long-lived task in two different ways:

- attempt support: the user genuinely tries a problem and may ask for a hint, approach review, debugging, or a walkthrough afterward;
- solution walkthrough: the user provides only a LeetCode URL and asks the agent to solve or explain it.

Do not treat the second flow as a successful attempt. Choose the record kind from the observed interaction, not from what would make the statistics look better.

## Session Commands

### Start Or Resume A Problem

When the user says `Start a new session`, clearly begins one problem, asks about
"the current problem," or asks for the solution to the focused coding activity:

1. Prefer `get_today_practice` through the Interview Arc MCP bridge and use its
   focused coding activity. Ask which problem the user means only when there is
   no focused coding activity and the request itself is ambiguous.
2. Reuse that dashboard `activity_id`; otherwise reuse the activity ID from the
   matching daily manifest when the problem is already planned, or create a
   stable lowercase ID.
3. Identify `source: daily` or `extra`.
4. Identify `record_kind: attempt` or `walkthrough` from the user's intent.
5. Create or acknowledge a draft under `attempts/` when substantive work begins.

The explicit command remains available as an override, but it is not required
for every problem. The focused dashboard activity or a clearly named problem is
the boundary. Only interaction after that boundary belongs to the optional
session transcript.

### Publish This Session

Flush the current problem's remaining activity exchanges, create its complete
review/solution bundle with `save_specialist_finalization`, and schedule any
required review. Stop at D1 finalization; the coordinator publishes Git.

### Publish Today's LeetCode

When the user says `Publish today's LeetCode`, `Publish the LeetCode session`,
or `Publish today's practice`, perform one D1 finalization batch across every
ready coding activity. The command may be issued after midnight and may contain
work from more than one Pacific calendar day:

1. Prefer the configured Interview Arc MCP tool `get_publication_queue` without
   forcing a date. It reads the user's authenticated D1 state directly and
   groups ready activities by Pacific completion date. If the MCP bridge is
   unavailable, use every relevant `../../data/drafts/journal-YYYY-MM-DD-draft.json`
   export attached or otherwise explicitly provided by the user.
2. Read the ready activity IDs, outcomes, timers, exact start/end timestamps,
   session IDs, publication states, personal notes, extra activities, and each
   matching daily manifest.
3. Select every queued LeetCode activity, including locally added activities that do not yet exist in the daily manifest.
4. Preserve each website-provided stopwatch time and result. Do not use chat timestamps as a timer and do not upgrade a failed or unset result to solved. A failed activity may be ready and should receive a postmortem.
5. For every selected problem, generate an original coaching solution or walkthrough, reference code, time and space complexity, edge cases, and key lesson. Do this even when the user never discussed that problem in this task.
6. Assign each activity to the Pacific calendar date containing its completion
   timestamp. A problem begun before midnight and finished after midnight belongs
   to the new date. Preserve its original timestamps and `session_id`; one
   dashboard session may therefore span multiple daily manifests without losing
   session membership.
7. Save one complete `save_specialist_finalization` bundle per problem. Do not
   write artifacts, update a daily manifest, switch branches, checkpoint,
   commit, mark published, open a pull request, or deploy.

This command is the normal coding workflow. The user does not need to say `Publish this session` six times. The queue contains every finished, unpublished LeetCode activity: only finishing its already-started stopwatch makes it **Ready for journal** (internal state: `ready`) automatically. Choosing or clearing a result never finishes or queues the activity. Do not include merely planned or running problems, and do not substitute every problem discussed in chat.

Do not scrape the user's LeetCode account, authenticated pages, or submission history. Read live state only through the authenticated Interview Arc MCP bridge. If neither MCP nor a website draft is available, finalize only the facts present in repository files or explicitly supplied by the user and mark the rest unknown.

## Evidence Ownership

- Allocated and elapsed time come from the website timer or an explicit user report. Chat timestamps are not a timer.
- Outcome comes from the user's actual attempt result.
- Initial approach, user code, and blocker exist only when the user shares them.
- Generated approach, code, complexity, edge cases, and coaching notes come from this task.
- Join this artifact to website state with `activity_id`.

Leave unavailable fields empty or set timing source to `unknown`. Never invent elapsed time, outcome, code, reasoning, or a blocker.

## Record Kinds And Outcomes

For `record_kind: attempt`, a completed problem uses exactly one outcome:

- `solved`
- `solved_after_reviewing_approach`
- `failed`

The website displays these as **Solved**, **Solved with help**, and **Failed**;
continue to persist the canonical enum above.

Do not add partial-success labels. Put nuance in notes. Keep outcome separate from lifecycle status.

For `record_kind: walkthrough`, use `user_attempted: false` or `unknown`, assistance level `full_solution`, and no outcome. A walkthrough can later be linked to a separate reimplementation attempt.

## Daily Shape

- Select 6 problems inside the day's fixed six-hour full session, while recording a compact elapsed-time stopwatch for every problem.
- Balance topic coverage and difficulty using only questions in the user's bank.
- Extra questions use their own elapsed-time stopwatch and `source: extra`.
- Avoid unnecessary recent repeats; schedule intentional reviews when a prior attempt needs reinforcement.

## Coaching Behavior

If the user is attempting a problem, give them room to reason before revealing the full solution unless they ask for it directly. Escalate help deliberately: hint, approach review, then full solution.

A complete review may cover:

- the user's approach, when shared;
- the correctness gap or blocker, when observed;
- a stronger approach;
- generated reference code;
- time and space complexity;
- edge cases;
- key lesson and mistakes to avoid;
- a reimplementation or follow-up date.

Clearly distinguish user work from generated coaching material.

## Voice intent and exact code boundaries

For an `interview-arc-voice:v2` envelope, classify and save the same model turn
before treating it as durable practice evidence:

- use `resolve_voice_capture_and_save_response` only when it belongs to the
  focused LeetCode activity;
- `unrelated` for website, tooling, or other administrative speech;
- `uncertain` when the turn itself is insufficient to decide.

Use `resolve_voice_capture` for the latter two decisions. Never append an
enveloped user turn separately. Return the tool's exact visible receipt and do
not persist it. For unrelated typed administration, return exactly
`*Not attached to this practice activity · Not saved to the practice transcript or publication*`.

An exact code block becomes a Code Attempt only when the user explicitly says
it is an attempt/submission/final code or confirms the specialist's boundary
question. Then call `save_leetcode_code_attempt` with the exact code,
language, originating turn, observed evidence, and a declaration that does not
invent platform correctness. Ordinary snippets, pseudocode, generated
reference implementations, and Scratch Notes are not Code Attempts.

Every created or revised reusable coding Solution Profile must be independently
reviewable in the Problem Bank. Include, in order: problem summary, pattern and
constraints, best approach, correctness argument, **Java first** and Python
reference implementations, complexity, edge cases, at least one meaningful
alternative with code when practical, a recall cue, and an improved concise
interview answer. Use fenced code blocks with explicit language identifiers.
Do not create a new profile revision for reader colors, typography, spacing, or
controls; those belong to the shared runtime reader. Revise or backfill only
when substantive sections or code are actually missing or improved.

## Content Boundary

- Do not bulk-crawl LeetCode or inspect authenticated pages, private endpoints,
  cookies, account state, submissions, editorials, or solutions. A
  finalization may open the exact user-supplied public problem URL once to read
  its visible official metadata; that narrow metadata preflight is not
  permission to copy the problem statement or solution content.
- Accept manual metadata and user-provided CSV, JSON, PDF, or saved MHTML snapshots. A user-saved company page is an authorized input artifact, not permission to automate the live account.
- For a saved MHTML company list, run `scripts/import_leetcode_company_mhtml.py` from the repository root. Import every complete visible table row, preserve the public problem number, title, URL, difficulty, acceptance rate, and structured company-frequency signal, then report source, imported, updated, and total counts.
- Deduplicate in this order: canonical LeetCode URL slug, public displayed problem number, then normalized title. Merge company signals rather than creating another copy of a known problem.
- Ignore account-specific solved/check icons during bank import. Website progress comes from Interview Arc activities and published artifacts, not from the company-list snapshot.
- Add company tags or frequency signals during finalization only from an
  existing user-provided import or another source the user explicitly
  authorized. Never derive company frequency from a title, model memory, or
  unverified search result.
- Never invent a LeetCode URL; use a validated URL from the bank or the URL the user supplied.
- Link to the original problem for prompt reading and submission.
- Do not copy protected statements or official solutions into this repository.
- Label AI-generated explanations or code as original coaching material, not official LeetCode content.

## Files

- Canonical bank: `bank/questions.json`
- Import example: `bank/import-template.csv`
- Attempt or walkthrough artifact: `attempts/YYYY-MM-DD-<problem-id>.md`
- Daily website manifest: `../../data/daily/YYYY-MM-DD.json`

Never overwrite a prior attempt. Add an attempt suffix when the same problem is repeated on the same day.

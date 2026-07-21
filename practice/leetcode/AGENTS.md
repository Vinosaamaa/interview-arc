# LeetCode Agent Instructions

Act as a coding-interview practice curator and coach. Before starting, read:

1. `../../README.md` and `../../AGENTS.md`.
2. `../../docs/contracts/activity.schema.json`.
3. `../../docs/contracts/leetcode-log.md` and `leetcode-log.schema.json`.
4. `../../docs/contracts/question-bank.schema.json` before changing bank data.

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

When the user says `Publish this session`:

1. Read the dashboard activity and use the Pacific completion date reported by
   the bridge. Finalize `attempts/YYYY-MM-DD-<problem-id>.md` using that date and
   the LeetCode log contract.
2. Add only facts observed in this task or explicitly supplied by the user/website export.
3. Preserve the dashboard `session_id`, exact Pacific start/end timestamps, and
   elapsed time. Update the matching activity in
   `../../data/daily/YYYY-MM-DD.json` with known durable fields and
   `artifactPath`.
4. Run `pnpm journal:checkpoint -- --date YYYY-MM-DD --area leetcode` from the repository root. This is the only Git commit this task may initiate; the guarded helper creates or reuses the daily branch and refuses unrelated dirty code.
5. After the checkpoint succeeds, call `mark_activities_published` with the artifact path when the MCP bridge is available. Do not push, open a pull request, or deploy. The main task does that once for the day.

LeetCode uses a structured postmortem by default. Preserve a full two-sided transcript only when the conversation itself contains reasoning or feedback worth revisiting.

### Publish Today's LeetCode

When the user says `Publish today's LeetCode` or `Publish the LeetCode session`,
perform one batch across every ready coding activity. The command may be issued
after midnight and may contain work from more than one Pacific calendar day:

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
7. Write one artifact per problem under `attempts/`, update or add the matching
   daily activity for that completion date, and point it to `artifactPath`.
8. Process the date groups sequentially. After every artifact for one date
   exists, run `pnpm journal:checkpoint -- --date YYYY-MM-DD --area leetcode`
   from the repository root. The helper creates or reuses that date's local
   journal branch and must finish before those activities are marked in D1.
9. Call `mark_activities_published` for that date group with each activity ID and
   repository-relative artifact path, then continue to the next date group. If
   MCP is unavailable, leave publication state for the website task to reconcile
   from the artifact. Do not commit local draft exports. Do not push, open a pull
   request, or deploy; the main task handles daily journal integration.

Never run raw branch-switching or commit commands in this task. Use only the checkpoint helper. If it reports unrelated uncommitted work, stop publishing and ask the coordinator to protect or finish that work; do not stash, discard, or absorb it into the journal commit.

This command is the normal coding workflow. The user does not need to say `Publish this session` six times. The queue contains every finished, unpublished LeetCode activity: finishing its stopwatch or choosing its actual result makes it **Ready for journal** (internal state: `ready`) automatically. Do not include merely planned or running problems, and do not substitute every problem discussed in chat.

Do not scrape the user's LeetCode account, authenticated pages, or submission history. Read live state only through the authenticated Interview Arc MCP bridge. If neither MCP nor a website draft is available, publish only the facts present in repository files or explicitly supplied by the user and mark the rest unknown.

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

## Content Boundary

- Do not crawl LeetCode, authenticated pages, private endpoints, cookies, editorials, or solutions.
- Accept manual metadata and user-provided CSV, JSON, PDF, or saved MHTML snapshots. A user-saved company page is an authorized input artifact, not permission to automate the live account.
- For a saved MHTML company list, run `scripts/import_leetcode_company_mhtml.py` from the repository root. Import every complete visible table row, preserve the public problem number, title, URL, difficulty, acceptance rate, and structured company-frequency signal, then report source, imported, updated, and total counts.
- Deduplicate in this order: canonical LeetCode URL slug, public displayed problem number, then normalized title. Merge company signals rather than creating another copy of a known problem.
- Ignore account-specific solved/check icons during bank import. Website progress comes from Interview Arc activities and published artifacts, not from the company-list snapshot.
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

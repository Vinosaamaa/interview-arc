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

For coding catalog, planning, result, and `control_practice_timer` commands,
follow `../../docs/contracts/specialist-today-controls.md`; preserve the exact
requested coding filters and count rather than substituting another problem.

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

## CLI Java Editing And Authoritative Submission

When the user practices LeetCode from Codex CLI, use one evolving Java file
instead of creating a per-problem directory, a separate `problem.md`, or a
series of local attempt snapshots.

### Prepare The Problem

1. Resolve the focused activity and verify the official public LeetCode problem
   number, title, and URL from the bank, the exact user-supplied public URL, or
   another permitted public source. Never invent any of them.
2. Present an original concise restatement, constraints, examples, and the Java
   method signature in the visible specialist conversation. Do not copy the
   protected official statement.
   - When an example depends on a graph, tree, grid, diagram, or other visual,
     inspect the original in the persistent Playwright-controlled dedicated
     Google Chrome tab. Reproduce every faithfully representable relationship
     as concise ASCII/text in both the conversation and the Java header comment.
   - If ASCII/text would lose material information and the user needs to inspect
     that visual, bring the existing tab to the foreground. This is the only
     routine practice flow that may foreground the dedicated browser. Reuse the
     same tab, then restore the previously active app as soon as the inspection
     is complete.
   - Screenshots are transient comprehension aids only. Never use image
     coordinates for submission, commit copied problem images, omit a material
     visual relationship, or invent one that cannot be verified.
3. Create or resume exactly one working source file at:

   `practice/leetcode/solutions/<four-digit-number>-<canonical-title-slug>.java`

   Zero-pad the official number to four digits. For example:

   - `0001-two-sum.java`
   - `0123-best-time-to-buy-and-sell-stock-iii.java`
   - `0200-number-of-islands.java`

4. Put the verified title, public URL, original restatement, constraints, and
   examples in a header comment, followed by the required method signature in
   a non-public `class Solution`. A non-public class keeps the descriptive file
   name valid Java.
5. Every time the file is prepared or resumed, give the user the complete
   absolute editor command:

   `micro -syntax java "<absolute-path-to-the-file>"`

   The user opens `micro`. Do not assume that Codex can safely create or target
   a Warp pane, and do not replace the running Codex process with the editor.

### Test And Submit

- Re-read the same file whenever the user asks to test or submit. All edits
  replace the evolving contents of that file; do not create attempt-numbered,
  dated, backup, or failed-submission source files.
- For local testing, compile the current source and exercise the provided
  examples, boundary cases, targeted adversarial cases, and a brute-force
  differential oracle when practical. Temporary generated harnesses must stay
  outside the durable solution directory.
- Report **Locally verified** separately from the authoritative platform
  verdict. Local compilation and generated tests never imply LeetCode
  acceptance.
- Submit only after the user explicitly asks. Follow the persistent one-tab
  Playwright contract below. Submit through the normal LeetCode UI and observe
  only that submission's verdict and any failing input LeetCode returns. Never
  inspect or export cookies, crawl the account, open submission history, access
  editorials or official solutions, or call authenticated/private endpoints
  directly.
- Preserve the Java file as a durable local/Git solution only after LeetCode
  returns **Accepted**. If the activity ends without a correct solution, remove
  the unfinished solution artifact rather than publishing it.
- The specialist may create and update the local working file, but it never
  switches branches, commits, opens the publication PR, or deploys. The
  coordinator remains the only task that publishes the accepted source file to
  Git/GitHub.

### Persistent One-Tab Playwright Contract

Use Playwright over CDP with a dedicated instance of the locally installed
regular **Google Chrome** application and the user-authorized persistent profile
at the outer workspace path `browser-profiles/leetcode-submitter`. This is a
separate process and profile from the user's ordinary Google Chrome session.
Do not substitute Chrome for Testing, the Codex in-app browser, the user's
ordinary Chrome profile, coordinate-based computer control, or an ephemeral
profile.

#### Idempotent launch and reconnect

Run the launch procedure from the `interview-arc` repository root. First test
the loopback CDP endpoint. When it already responds, reuse that browser and do
not launch another one. Otherwise launch the dedicated browser with exactly
this profile and endpoint:

```bash
LEETCODE_REPO_ROOT="$(git rev-parse --show-toplevel)"
LEETCODE_CHROME_PROFILE="$(dirname "$LEETCODE_REPO_ROOT")/browser-profiles/leetcode-submitter"

if ! curl --fail --silent --show-error \
  http://127.0.0.1:9223/json/version >/dev/null; then
  LEETCODE_RETURN_BUNDLE_ID="$(osascript -e \
    'tell application "System Events" to get bundle identifier of first application process whose frontmost is true')"

  open -g -na "Google Chrome" --args \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=9223 \
    --user-data-dir="$LEETCODE_CHROME_PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    https://leetcode.com/problemset/

  for LEETCODE_CDP_ATTEMPT in {1..50}; do
    if curl --fail --silent \
      http://127.0.0.1:9223/json/version >/dev/null; then
      break
    fi
    sleep 0.2
  done

  open -b "$LEETCODE_RETURN_BUNDLE_ID"
fi

curl --fail --silent --show-error \
  http://127.0.0.1:9223/json/version >/dev/null
```

The launch block remembers the frontmost application, uses `open -g` to avoid
activation, waits at most ten seconds for the dedicated CDP endpoint, and then
explicitly restores the original application because macOS or Chrome can still
steal focus while a new instance initializes. If the final endpoint check
fails, stop and report the launch failure instead of opening another browser.
Then connect Playwright with
`chromium.connectOverCDP("http://127.0.0.1:9223")`. Reacquire the existing
browser context and its single LeetCode problem page. Do not launch Playwright's
bundled Chromium and do not call `launchPersistentContext`; both create a
different browser lifecycle from the approved CDP browser.

The dedicated profile is durable authentication state. Never delete, replace,
copy, or recreate it merely because Codex, cmux, Playwright, or the CDP
connection restarted. If LeetCode authentication expires, keep the browser and
profile intact and ask the user to sign in within that dedicated window.

#### Ordinary-Chrome safety boundary

- Never run `killall`, `pkill`, a generic `kill`, AppleScript `quit`, or any
  other command targeting Google Chrome by application or process name. Such a
  command can terminate the user's ordinary Chrome windows.
- Never start remote debugging against the ordinary Chrome profile under the
  user's Library directory. The only authorized profile is the workspace's
  `browser-profiles/leetcode-submitter` directory, and the only authorized CDP
  endpoint is loopback port `9223`.
- Before any explicit dedicated-browser shutdown, verify one running process
  contains both the exact `--user-data-dir` above and
  `--remote-debugging-port=9223`. Close that verified browser through its CDP
  `Browser.close` command. If identity cannot be proven, leave every Chrome
  process running and report the ambiguity.
- Do not close the dedicated browser during normal practice. Close it only
  when the user explicitly asks or closes it personally.

- Run the dedicated Chrome headed, not headless, while keeping it behind the
  user's active app. Do not minimize or suspend it. Routine navigation, code
  insertion, submission, verdict reading, and tab reuse must remain in the
  background. Foreground the existing tab only for the material visual fallback
  defined in **Prepare The Problem**, and restore the previously active app
  immediately afterward. If authentication expires, ask the user to switch to
  the preserved dedicated window rather than automatically foregrounding it.
- Keep the Chrome process independent from one Playwright connection and
  reconnect through its loopback-only CDP endpoint after Codex, cmux, or the
  Playwright controller restarts. Never expose that endpoint beyond localhost.
- Maintain exactly one automation-owned LeetCode problem tab across the entire
  practice day. Do not open a tab per problem. Completing, publishing, or
  abandoning an Interview Arc activity does not close the browser or tab.
  Close them only when the user explicitly asks or closes them personally.
- Before navigating, reacquire the existing page. If another CLI currently
  controls it, wait for that single controller instead of launching a second
  browser or creating another problem tab.
- For the first problem, navigate the single tab to the verified canonical
  public problem URL. Wait for the matching problem identity and editable Java
  editor, then leave the browser in the background while the user works in
  `micro`.
- For a new activity/problem, reuse that same tab and navigate it directly to
  the new verified canonical problem URL. Confirm the number/title/slug, select
  Java when necessary, and wait for the editable problem page. Never close the
  prior activity's tab because the prior and next problems intentionally share
  one tab.
- For each explicit submission, re-read the evolving Java file, reacquire the
  same tab, verify the current problem, replace the editor contents, focus the
  editor, and send `Meta+Enter` (Command-Enter). Wait for the resulting verdict
  view and report only that attempt's visible verdict and failing input.
- LeetCode may navigate the same tab from the editable problem page to a
  submission/result page. Before retrying revised code for that problem, use
  Playwright's browser Back operation, then wait for the canonical problem URL
  and editable Java editor before replacing the code and pressing
  Command-Enter again. Navigate to the canonical problem URL only when browser
  history is unavailable or the restored page is stale.
- Repeat the Back → editor-ready → replace code → Command-Enter → verdict cycle
  for every failed submission. Never create a retry tab, inspect submission
  history, or retain a second local source file.
- Use targeted URL, problem-title, editor, submission-state, and verdict waits.
  Do not wait for global network idle, add arbitrary sleeps, poll continuously,
  or use screenshots/pixel coordinates for routine submission.
- If authentication expires, preserve the browser/profile and ask the user to
  sign in. Do not discard the profile, copy credentials, or create another
  authenticated browser.

### Interview Arc Control Boundary

- Read current owner-scoped Today state only through the registered Interview
  Arc MCP tools. `get_today_practice` is read-only; its presence does not imply
  permission or capability to mutate timers or planning state.
- Do not claim to pause, resume, stop, advance, delete, or create Today work
  unless the corresponding owner-scoped MCP mutation is registered and
  discoverable in the current connection. Never substitute website automation
  or an undocumented direct HTTP request.
- When supported mutation tools are available, use them only after an explicit
  user command, preserve D1 timer/result/finalization guards, and report the
  authoritative read-back state.
- A request such as “create one session with ten hard problems” must apply the
  exact requested filters and count. If eligible inventory is insufficient,
  report that fact instead of silently weakening the criteria or inventing
  activities.

### Transcript And Code Boundaries

Save meaningful problem discussion, the user's reasoning, hints, feedback,
relevant test conclusions, the authoritative submission verdict, and the final
reflection as activity exchanges. Do not save terminal-control chatter, the
`micro` command, browser-automation mechanics, ordinary file saves, or
irrelevant raw compiler output as practice dialogue.

The structured Code Attempt contract remains the source of exact user code
evidence when the user explicitly crosses an attempt boundary. This CLI policy
forbids multiple *local or Git source files*; it does not rewrite or conflate
the D1 activity evidence required by the durable-practice contract. Generated
reference implementations are never user Code Attempts.

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

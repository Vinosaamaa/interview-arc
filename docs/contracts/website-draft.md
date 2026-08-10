# Website Draft Contract

The website stores unpublished timer and planning state in owner-scoped D1
tables and caches it on the current device for offline use. Versioned daily
manifests and specialist artifacts remain the durable narrative record.

## Timers

Every session has a stored countdown allocation. The default 6/1/1 recipe is 21,600 seconds (six hours). Configured sessions derive their allocation from 2,400 seconds per coding problem and 3,600 seconds per system-design or behavioral question. A session countdown may run alongside an activity stopwatch.

Every activity has its own elapsed-time stopwatch ID, including each LeetCode problem. Only one activity stopwatch may run at a time. Starting another activity first pauses the active stopwatch and preserves its elapsed seconds.

The practice timezone is always `America/Los_Angeles`. The first start records
`startedAt`; finishing the timer or selecting the first result records
`endedAt`. Exact active intervals are retained so later reports can divide
recorded effort across Pacific midnight without guessing from a total.

Starting an activity gives it durable focus. Focus survives pause, navigation,
and Pacific midnight, so “the current problem” remains unambiguous even when
its stopwatch is not running. Starting another activity transfers focus.

Finishing a session or activity sets `completed: true`, clears `runningSince`, and locks the timer permanently. A completed timer must never expose a resume action.

Pausing or finishing a session countdown pauses its running child activity.
Starting a child activity resumes its unfinished parent session. Only one
session countdown and one activity stopwatch may run at a time. Starting a
standalone activity pauses the running session so standalone effort is not
counted inside that session.

## Result Flags

The website uses one cycling flag control:

1. hollow: no result;
2. green: `solved`;
3. yellow: `solved_after_reviewing_approach` (displayed as **Solved with help**);
4. red: `failed`.

The control appears on coding, system-design, and behavioral activities so all Today cards keep the same layout. Every interface uses the labels **Solved**, **Solved with help**, and **Failed** while D1 preserves the canonical outcome enum. Published mock artifacts describe these as qualitative review signals rather than LeetCode acceptance claims.

The control provides an accessible label and a hover/focus legend. Its legend must escape the card visually rather than being clipped by its card. A result flag and timer completion are separate signals. A red flag does not appear in Past or become publication-ready until the already-started stopwatch is explicitly finished; completed red work remains useful for postmortems and scheduled review.

## Publication State

Every activity exposes an owner-scoped publication state derived from timer lifecycle and artifact existence:

- `draft`: unfinished and not offered to a specialist task;
- `ready`: finished and automatically included in the publication queue;
- `published`: the coordinator wrote/imported the artifact and reported its path back to Interview Arc.

Finishing an already-started activity stopwatch changes the effective state to **Ready for journal** (`ready`) automatically. Choosing or clearing an outcome does not change lifecycle state. The coordinator changes it to **In journal** (`published`) only after the repository artifact actually exists and is importable. Completed failed attempts are eligible and produce useful postmortems.

## Sessions

A session is a named collection of activities. The default session contains:

- six LeetCode activities selected from the LeetCode question bank;
- one system-design activity selected from the system-design bank;
- one behavioral activity selected from the behavioral bank.

Each session declares `allocatedSeconds`. The default recipe uses `21600`; a configured recipe uses `(codingCount * 2400) + (systemDesignCount * 3600) + (behavioralCount * 3600)`.

The user may add another session, configure its three category counts, or add a standalone activity. A website-created session recipe can be edited only before its timer, activity work, completion, or publication state begin. A result flag alone does not lock the recipe. Editing replaces its unstarted picks while preserving the session identity. Locally added activities can be removed with their compact cross control before publication.

Standalone cards expose one compact, accessible cross control for removal. They do not hide edit or destructive actions behind swipe gestures.

Session membership and journal date are independent. A session that starts at
9:00 PM Pacific may continue after midnight with the same session ID. Each
completed activity is assigned to the Pacific date of its completion. An
activity that crosses midnight belongs to the date it finishes; its exact
start and finish remain visible. Session statistics may span multiple daily
journals without duplicating an activity.

## Question Selection

- LeetCode: search the bank first. If the problem is absent, accept a public LeetCode problem URL and derive the display title from the URL slug. Do not scrape the page or authenticated account data.
- System design and behavioral: search the matching bank first. If absent, accept a custom title/prompt without requiring a URL.

## Export

Draft export schema version 6 contains session countdowns, activity stopwatches,
Pacific start/finish timestamps, durable focus, outcomes, publication states,
personal and structured notes, review schedules, specialist finalization
summaries, audio metadata, locally added sessions and activities,
`publishQueueActivityIds`, and `publishQueueByDate`.

`publishQueueActivityIds` contains exactly the finished, unpublished activities whose effective publication state is `ready`, including red/failed work and timer-finished work with no result selected.

A specialist task should use the authenticated Interview Arc MCP tool
`get_publication_queue` when it is connected. The portable fallback remains an
export the user makes available at
`data/drafts/journal-YYYY-MM-DD-draft.json`. Draft JSON files are ignored by
Git; `data/drafts/README.md` documents the fallback workflow.

## Durable Publication

Specialists read their ready activities and save complete D1 finalization
bundles; they do not write Git artifacts. `Publish today's LeetCode` remains a
coding-only alias for this finalization step.

The coordinator command `Publish all pending practice` reads the complete queue,
asks each registered specialist to flush unsaved exchanges and finalize its
activities, renders artifacts grouped by Pacific completion date, and publishes
the journal pull request. Follow `durable-practice-publishing.md`.

If neither MCP nor an export is available, no task may claim it knows what was
finished. It may use durable manifest facts or ask the user to connect
Interview Arc or attach the draft.

## Past

Past updates immediately from the same D1-backed eligibility rules as
`publishQueueActivityIds`. Planned and running records are excluded. Completed
failed attempts remain visible and can be isolated with the Failed or Needs
review attention filters.

Published LeetCode letters show original agent-generated solution material. Published system-design and behavioral letters show the complete formatted conversation transcript and review. Markdown is rendered as a preview with headings, lists, tables, links, quotations, and fenced code blocks; raw Markdown source is not the default reading surface.

## Review Queue

Review Queue joins active owner-scoped D1 review schedules to their completed
practice attempts. It never includes unfinished work or Career Focus blocks.
The Recall Spine groups records into **Review now**, **Review soon**, and
**Later** from the persisted due date; every reason names only the stored
schedule reason, prior result, interval, and completed attempt evidence.

Single and bulk **Add to Today** actions reuse the durable Today planning
mutation, including stable operation identity, workbench validation, canonical
duplicate prevention, review-source lineage, and authoritative read-back.
**Review next week** moves the schedule to the exact Pacific date seven days
from the current practice date. An exact retry is idempotent; a stale expected
due date fails closed and reconciles from D1. Browser storage may retain the
mutation retry and interface selections, but it never owns a competing review
schedule.

The selection folio keeps a fixed geometry in both empty and populated states.
Its bookmarks support touch/trackpad scrolling, pointer drag, keyboard arrows,
and explicit arrow controls without relocating the source rows. Opening the
prior attempt routes through the shared Past reader.

## Problem Banks

Problem Banks is the reusable catalog for all three sources: LeetCode, system design, and behavioral. It provides independent question-type, review (`Due now`, `Needs review`), result (`Solved`, `Solved with help`, `Failed`, `To do`), notes, difficulty, tag, and starred filters. Every question shows the most recent finished-attempt flag and has a `Practice today` action that adds it as standalone practice and returns to Today. Past instead shows the flag belonging to each specific attempt.

The same canonical question may appear only once on a Pacific practice day.
This rule applies to full-session selection, standalone activity selection,
Problem Bank shortcuts, and pasted URLs. A URL with no canonical bank match
creates a deduplicated personal bank question using the public URL and a title
derived without crawling the source page.

SystemDesign.io entries link to their canonical question pages and label the availability of reference solutions. The specialist agent uses those sources to prepare; the website does not copy or embed third-party solution content.

Bugfree.ai behavioral entries link to their canonical answer pages and label their expected answer format, frequency, and possible sign-in requirement. The behavioral specialist consults the current page when an answer is requested. If the page cannot be reached, it reports the exact URL instead of claiming the source was reviewed.

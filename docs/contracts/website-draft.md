# Website Draft Contract

The website stores unpublished timer and planning state in owner-scoped D1
tables and caches it on the current device for offline use. Versioned daily
manifests and specialist artifacts remain the durable narrative record.

## Timers

Every session has a fixed 21,600-second (six-hour) countdown. It may run alongside an activity stopwatch.

Every activity has its own elapsed-time stopwatch ID, including each LeetCode problem. Only one activity stopwatch may run at a time. Starting another activity first pauses the active stopwatch and preserves its elapsed seconds.

Finishing a session or activity sets `completed: true`, clears `runningSince`, and locks the timer permanently. A completed timer must never expose a resume action.

## Result Flags

The website uses one cycling flag control:

1. hollow: no result;
2. green: `solved`;
3. yellow: `solved_after_reviewing_approach`;
4. red: `failed`.

The control appears on coding, system-design, and behavioral activities so all Today cards keep the same layout. For LeetCode, green and yellow retain their canonical outcome names. For system-design and behavioral work, the interface reads them as `finished` and `finished after reviewing approach`; those mock labels are local publishing signals and must not be written into the durable activity `outcome` field, which remains LeetCode-specific.

The control provides an accessible label and a hover/focus legend. Its legend must escape the card visually rather than being clipped by the swipe container. A result flag and timer completion are separate signals. Red work is excluded from Past, but it is still ready for publication so the specialist can write a useful postmortem.

## Publication State

Every activity exposes an owner-scoped publication state derived from lifecycle, outcome, and artifact existence:

- `draft`: unfinished and not offered to a specialist task;
- `ready`: finished and automatically included in the publication queue;
- `published`: the specialist wrote the artifact and reported its path back to Interview Arc.

Finishing a timer or choosing an outcome changes the effective state to **Ready for journal** (`ready`) automatically. A specialist changes it to **In journal** (`published`) only after the repository artifact actually exists. Failed attempts are eligible and produce useful postmortems.

## Sessions

A session is a named collection of activities. The default session contains:

- six LeetCode activities selected from the LeetCode question bank;
- one system-design activity selected from the system-design bank;
- one behavioral activity selected from the behavioral bank.

Each session declares `allocatedSeconds: 21600`.

The user may add another complete session or add a standalone activity. Locally added activities can be edited or removed before publication.

Standalone cards reveal Edit and Remove by swiping left. A compact overflow control provides the same action for pointer, keyboard, and assistive-technology users.

## Question Selection

- LeetCode: search the bank first. If the problem is absent, accept a public LeetCode problem URL and derive the display title from the URL slug. Do not scrape the page or authenticated account data.
- System design and behavioral: search the matching bank first. If absent, accept a custom title/prompt without requiring a URL.

## Export

Draft export schema version 4 contains session countdowns, activity stopwatches, outcomes, publication states, personal notes, locally added sessions, locally added activities, and `publishQueueActivityIds`.

`publishQueueActivityIds` contains exactly the finished, unpublished activities whose effective publication state is `ready`, including red/failed work and timer-finished work with no result selected.

A specialist task should use the authenticated Interview Arc MCP tool
`get_publication_queue` when it is connected. The portable fallback remains an
export the user makes available at
`data/drafts/journal-YYYY-MM-DD-draft.json`. Draft JSON files are ignored by
Git; `data/drafts/README.md` documents the fallback workflow.

## End-Of-Day LeetCode Publication

The user finishes the desired activities and says `Publish today's LeetCode`.

The LeetCode task must:

1. call `get_publication_queue` through the configured Interview Arc MCP bridge; if it is unavailable, read the exported `publishQueueActivityIds`, `outcomes`, `timers`, publication states, notes, daily manifest, and locally added activity metadata;
2. select only queued LeetCode activities;
3. preserve the website-provided outcome and elapsed time without inferring either from chat timestamps;
4. generate an original coaching solution, code, complexity analysis, edge cases, and key lesson for every selected problem, even when that problem was never discussed earlier in the task;
5. write one attempt artifact per problem and update the daily manifest;
6. checkpoint the artifact and daily manifest with the guarded daily-branch helper;
7. after the checkpoint succeeds, call `mark_activities_published` with its repository path; when using the fallback export, leave the draft file local and uncommitted.

If neither MCP nor an export is available, the task must not claim it knows what was finished. It may use durable manifest facts or ask the user to connect Interview Arc or attach the draft.

## Past

Past updates immediately from the same D1-backed eligibility rules as
`publishQueueActivityIds`. Planned, running, and red/failed records are
excluded. Failed attempts remain available to Journey statistics but do not
appear in the reading log.

Published LeetCode letters show original agent-generated solution material. Published system-design and behavioral letters show the complete formatted conversation transcript and review. Markdown is rendered as a preview with headings, lists, tables, links, quotations, and fenced code blocks; raw Markdown source is not the default reading surface.

## Problem Banks

Problem Banks is the reusable catalog for all three sources: LeetCode, system design, and behavioral. It provides independent question-type filters (`All`, `Coding`, `System design`, `Behavioral`) and progress filters (`All`, `To practice`, `Finished`). Finished uses the same green/yellow or published eligibility as Past; failed and merely planned work remains to practice. Every question has a `Practice today` action that adds it as standalone practice and returns to Today.

SystemDesign.io entries link to their canonical question pages and label the availability of reference solutions. The specialist agent uses those sources to prepare; the website does not copy or embed third-party solution content.

Bugfree.ai behavioral entries link to their canonical answer pages and label their expected answer format, frequency, and possible sign-in requirement. The behavioral specialist consults the current page when an answer is requested. If the page cannot be reached, it reports the exact URL instead of claiming the source was reviewed.

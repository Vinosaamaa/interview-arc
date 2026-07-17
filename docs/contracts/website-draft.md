# Website Draft Contract

The website keeps unpublished timer and planning state on the current device. Versioned daily manifests and specialist artifacts remain the durable record.

## Timers

Every session has a fixed 21,600-second (six-hour) countdown. It may run alongside an activity stopwatch.

Every activity has its own elapsed-time stopwatch ID, including each LeetCode problem. Only one activity stopwatch may run at a time. Starting another activity first pauses the active stopwatch and preserves its elapsed seconds.

Finishing a session or activity sets `completed: true`, clears `runningSince`, and locks the timer permanently. A completed timer must never expose a resume action.

## LeetCode Results

The website uses one cycling flag control:

1. hollow: no result;
2. green: `solved`;
3. yellow: `solved_after_reviewing_approach`;
4. red: `failed`.

The control provides an accessible label and a hover/focus legend. Outcome remains separate from timer completion.

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

Draft export schema version 3 contains session countdowns, activity stopwatches, outcomes, locally added sessions, locally added activities, and `publishQueueActivityIds`.

`publishQueueActivityIds` contains:

- LeetCode activities marked `solved` or `solved_after_reviewing_approach`;
- completed system-design activities;
- completed behavioral activities.

A specialist task may use an exported draft the user makes available, but it cannot read deployed browser storage directly.

## Practice Library

The device-local Practice Library updates immediately from the same eligibility rules as `publishQueueActivityIds`. Planned and running records are excluded. Failed LeetCode attempts remain available to Journey statistics but do not appear in the reading library.

Published LeetCode letters show original agent-generated solution material. Published system-design and behavioral letters show the complete formatted conversation transcript and review. Markdown is rendered as a preview with headings, lists, tables, links, quotations, and fenced code blocks; raw Markdown source is not the default reading surface.

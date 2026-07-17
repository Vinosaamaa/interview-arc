# Website Draft Contract

The website keeps unpublished timer and planning state on the current device. Versioned daily manifests and specialist artifacts remain the durable record.

## Timers

Every activity has its own timer ID, including each LeetCode problem. Only one activity timer may run at a time. Starting another timer first pauses the active timer and preserves its elapsed seconds.

The three-hour LeetCode allocation is an aggregate target. The website calculates it by summing the six individual problem timers; it does not use a second overlapping sprint timer.

## Sessions

A session is a named collection of activities. The default session contains:

- six LeetCode activities selected from the LeetCode question bank;
- one system-design activity selected from the system-design bank;
- one behavioral activity selected from the behavioral bank.

The user may add another complete session or add a standalone activity. Locally added activities can be edited or removed before publication.

## Question Selection

- LeetCode: search the bank first. If the problem is absent, accept a public LeetCode problem URL and derive the display title from the URL slug. Do not scrape the page or authenticated account data.
- System design and behavioral: search the matching bank first. If absent, accept a custom title/prompt without requiring a URL.

## Export

The exported draft contains per-activity timers, outcomes, locally added sessions, and locally added activities. A specialist task may use an exported draft the user makes available, but it cannot read deployed browser storage directly.

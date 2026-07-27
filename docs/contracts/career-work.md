# Career Work Contract

Career Work joins two deliberately separate sources without turning job
applications into interview-practice problems.

## Ownership

| Evidence | Owner |
| --- | --- |
| Career focus block, planned time, elapsed intervals, optional focus note | Interview Arc D1 |
| Company, role, application URL, external ID, source, referral state, pipeline status, status timestamps | Job Journey |

Interview Arc never copies Job Journey records into D1 and never edits them.
Job Journey never owns Interview Arc stopwatches.

## Focus-block lifecycle

A job-application block has:

```ts
{
  activityClass: "focus_block";
  focusCategory: "job_applications";
  id: string;
  workbenchId: string;
  date: string;
  title: string;
  plannedSeconds: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
```

- It uses the shared `activity` timer kind, so only one practice or focus
  stopwatch can run at once.
- It is selected from the Today **Activities** composer. It may be added as a
  standalone focus block or included in the composer’s **One session**
  destination. The Full session recipe remains practice-only.
- When included in a session, its ID participates in `activityIds` and its
  planned time contributes to the session countdown. It still finishes without
  a result and may let the parent session auto-complete once every child is
  complete.
- It never receives a problem ID, result, review schedule, specialist task,
  transcript, reusable solution, publication status, Past card, or Problem
  Bank entry.
- Untouched blocks may be edited or removed.
- A completed block is locked.
- Starting fresh closes a started block at the confirmation time, archives it,
  and opens a clean workbench. It never queues publication.

## Pacific-time analytics

Career heat is derived only from immutable Interview Arc timer intervals.
Intervals crossing Pacific midnight are split across the two Pacific dates.

Heat levels:

| Elapsed focus time | Level |
| --- | --- |
| none | 0 |
| less than 30 minutes | 1 |
| 30–59 minutes | 2 |
| 60–119 minutes | 3 |
| exactly 2 hours | 4 |
| more than 2 hours | 5 |

The Journey selector offers All practice, Coding, System design, Behavioral,
and Job applications. Practice shades remain completion-based; Job
applications shades are elapsed-time based.

## Job Journey v1 boundary

Interview Arc's Worker calls:

- `GET /api/integrations/interview-arc/v1/career-summary`
- `GET /api/integrations/interview-arc/v1/jobs`

The private credential is a Worker secret and is never sent to browser
JavaScript, put in a URL, logged, or returned. Responses are normalized through
an explicit field allowlist. The job projection may contain only the v1 fields
documented in [Job Journey issue #49](https://github.com/Vinosaamaa/job-journey/issues/49).

The Worker uses a five-minute private in-isolate cache. A failed refresh may
serve the last successful value as stale. Without any successful value, Career
Work reports the application source as unavailable while local focus analytics
remain usable.

Until Job Journey #49 is deployed and the Worker secrets are configured, this
unavailable state is the only truthful production behavior. Contract fixtures
may be used in tests but never as production application data.

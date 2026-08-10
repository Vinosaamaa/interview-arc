# Practice-State Command Module

## Status

Accepted first slice for issue #202 on 2026-08-09.

## Domain map

```text
browser retry queue ──> website HTTP adapter ─┐
                                              ├─> Practice-State Command Module ─> owner-scoped D1 transitions
Chrome Companion ────> Companion adapter ────┘                                  ├─> review scheduling
                                                                                 └─> stable mutation receipts

website HTTP adapter ──> authoritative state read-back ──> owner live-update invalidation
Companion adapter ─────> authoritative practice snapshot ─> owner live-update invalidation
```

D1 remains authoritative. Browser storage remains an offline retry queue, and
live updates remain invalidations rather than mutation acknowledgements.

## Candidate ranking

Recent change history since July 2026 shows the practice-state path spread
across the browser, the website mutation adapter, `db/live-state.ts`, the
Companion, and runtime tests. Reader work has greater raw file churn, while
Voice persistence has the broadest lifecycle, but both carry more active
behavioral risk.

| Candidate | Locality and regression evidence | Testability | Rank |
| --- | --- | --- | ---: |
| Practice-state commands | Command knowledge was duplicated across two adapters and several D1 modules; timer, workbench, queue, and result regressions repeatedly touched the same path. | Existing local-D1 integration tests exercise owner, revision, idempotency, and read-back behavior through an external Interface. | 1 |
| Durable Voice evidence | Intent, grouping, audio, repair, deletion, Code Attempt, and finalization lifecycles still meet in broad implementations. | Strong integration coverage exists, but #89 and #93 own active reliability decisions that this refactor must not reopen. | 2 |
| Workspace and reader orchestration | Routing, saved view state, scroll restoration, readers, and rendering concentrate in `home-client.tsx`, the highest-churn source file. | Visual state is testable, but active flash diagnostics in #191 make a behavior-preserving extraction less bounded. | 3 |

## Decision checkpoint

Select the practice-state commands and create one deep Module with this
Interface:

- input: authenticated `ownerId`, Pacific `date`, one typed command, and the
  server timestamp;
- output: the live-update scope and an optional stable mutation receipt;
- errors: typed input errors plus the existing timer and planning conflicts.

The Module owns command validation, D1 transition ordering, review-schedule
side effects, workbench revision checks, and stable deletion identity. The
website and Companion adapters continue to own authentication, their existing
response shape, authoritative read-back, and live-update transport. This keeps
the Interface small while concentrating implementation knowledge and gives two
real adapters one shared seam.

The first tracer bullet moves every website practice-state command behind the
Module and reuses it for the Companion's outcome, publication, note, and star
commands. Companion timer and add-from-LeetCode orchestration stay in place
because they include Voice-finish and content-catalog behavior that is not part
of this slice.

## Preserved behavior and invariants

- Browser queue wire values, discard/retry behavior, and response payloads do
  not change.
- Every D1 read and write remains owner-scoped.
- Stable mutation identities and receipts for Today removal remain unchanged.
- Workbench and timer revision conflicts still fail closed.
- Existing D1 transaction guards remain inside their current implementations;
  the Module calls them in the same order as the prior adapter.
- Authoritative state is read only after a successful command, then the
  owner-scoped invalidation is published.
- Voice evidence, publication, and visible product behavior are unchanged.

Behavior-level local-D1 characterization covers the external Companion
Interface before and after the extraction. A fitness test also rejects import
cycles across website, D1, MCP, and Worker sources and prevents the website
mutation adapter from importing the review and planning-policy implementations
directly.

## Deferred candidates

Deepening the Voice evidence lifecycle must preserve #89 and #93 and belongs in
a separately approved reliability slice. Reader orchestration should wait for
#191 diagnostics so a refactor does not hide or reclassify the active flash.
Neither candidate is broadened into this tracer bullet.

# Specialist verification and NeetCode 150 — 2026-09-11

Owning issues: [#453](https://github.com/Vinosaamaa/interview-arc/issues/453)
(connected practice) and [#469](https://github.com/Vinosaamaa/interview-arc/issues/469)
(NeetCode 150). This tracked report replaces the ignored local report as the
durable verification record. It contains engineering evidence, not private
practice transcripts, account details, or authentication screenshots.

## Current result

NeetCode 150 and the Windows verification fixes are merged and deployed.
The rejected OAuth grant was cleared by a successful reconnect on September 11.
Authenticated bank search, exact question fetches, and complete retrieval of all
three specialist guides passed. Authentication is no longer the recorded blocker.

The full physical text → Voice → text save flow remains unverified. Successful
server integration tests and account reads do not prove that Voice can invoke
tools or save a complete conversation. Issue #453 remains open for that acceptance.

## Released changes

| Change | Tested PR head | Merge commit | Successful release |
| --- | --- | --- | --- |
| [#470: Windows verification and imports](https://github.com/Vinosaamaa/interview-arc/pull/470) | `1f1dcd33c4dd4e12bfdfda93f257915a2390f949` | `35372ead052f56b03d3cc9db9a51988615a93c82` | [34602574635](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602574635) |
| [#471: NeetCode 150 metadata](https://github.com/Vinosaamaa/interview-arc/pull/471) | `25b5e7313ed27ece18fed82b0cb07ab655aeae01` | `519f2509b42ac5425be628b8754e96eb147ed4b3` | [34602931350](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602931350) |

Both tested PR heads had exact source-tree parity with their squash merges.
The releases reused their validated PR Worker artifacts.

| Release | Website version | MCP version |
| --- | --- | --- |
| #470 | `fefd8b31-5eeb-4e74-b513-942c398f7d0c` | `c3a0aea5-c228-414d-bf60-81919bc35326` |
| #471 | `0363841b-b442-4e77-bc29-5b0f613a47f2` | `763ba1d0-dac8-474b-8516-669856b54716` |

PR #470 repaired Windows Wrangler invocation, subprocess and fixture cleanup,
content-path normalization, and stale specialist documentation. The real bundled
Worker integration exercised guide retrieval and content parity, coding draft
and transcript persistence, owner isolation, finalization, solution batches,
immutable fingerprints, and retry conflicts.

PR #471 reused 101 existing NeetCode members and added 49 missing questions.
The coding bank grew from 350 to 399 questions, with exactly 150 NeetCode members
across 18 categories. Existing metadata and ordering were preserved. Membership
was grounded in the [pinned official NeetCode dataset](https://github.com/neetcode-gh/leetcode/blob/9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e/.problemSiteData.json).
The final public content import reported 529 bank entries and zero journals,
artifacts, or story projects.

## Authenticated account verification

The connector had returned `oauth_token_invalid_grant`. That error did not
establish whether the grant had expired, been revoked, or failed for another
reason. Cloudflare Access owns the OAuth exchange; no Interview Arc
authentication code was changed to resolve it.

The existing connection completed its real Reconnect/sign-in/consent/callback
flow. The authenticated `get_today_practice` request succeeded at
`2026-09-12T04:08:02.883Z` (September 11 in Pacific time). Subsequent checks:

- Catalog pagination returned 100 and 50 NeetCode entries: 150 unique IDs,
  each carrying the NeetCode 150 topic.
- Authenticated search and exact fetch succeeded for coding, system-design,
  and behavioral questions. Coding returned canonical metadata and the
  official problem URL; the other specialties returned stored prompts and
  source snapshots.
- Every page of each specialist guide was retrieved. The assembled SHA-256
  digests matched both connector receipts and repository files after
  normalizing Windows line endings to LF.

| Guide | Characters | SHA-256 |
| --- | ---: | --- |
| `practice/leetcode/AGENTS.md` | 19,520 | `8c50f625577b20ca651ac9fa27765d61971e321fcd9edbd9bef889cdcf9d3f76` |
| `practice/system-design/AGENTS.md` | 21,212 | `b58fbcbd317303b4306eb0d67f0b60d706bc6a0faa8d6e8a9b4b84d559f78fd5` |
| `practice/behavioral/AGENTS.md` | 15,666 | `288b6aadda3ca06c5500fd17e7cb5e8a4e3f818db1da084238e4853d50d9876d` |

These account checks performed reads only. Existing workbench state, activities,
timers, outcomes, transcripts, and publications were not changed. They did not
exercise account-level write/finalization or physical Voice acceptance.
Production MCP health returned HTTP 200; unauthenticated MCP access returned
the expected OAuth 401 challenge, and resource/authorization metadata returned
200 with S256 and authorization-code/refresh-token support.

## Remaining acceptance

Exercise text preparation → physical Voice → text save on the actual account,
using synthetic practice for writes. Confirm which tools that surface exposes,
compare the available transcript with the saved receipt, verify finalization
and retries, and preserve estimated or unknown time honestly. Guide retrieval
alone does not establish that the speaking model follows every instruction.
See [connected-practice boundaries](../../architecture/chatgpt-live-capabilities.md)
and the [practice guide](../../agents/chatgpt-practice-prompt.md).

The following ledger preserves the earlier product implementation's recorded
checkpoints and hosted receipts. It does not measure the later reconnect or
this documentation repair; the repair's own ledger belongs to its PR.

## Execution ledger

- request_submitted_at: unavailable
- tool_execution_started_at: unavailable; first recorded checkpoint was 2026-09-11 05:35:20 PDT (-0700), after work had started
- ledger_finished_at: 2026-09-11 06:17:23 PDT (-0700)
- client_measured_duration: unavailable
- reconciliation: total wall-clock and active engineering time are unknown; the client exposed neither request timing nor total duration, and the recorded blocks include interruptions and overlapping hosted waits.

All timestamps below are on 2026-09-11, PDT (-0700).

| Meaningful work block | Started | Ended | Duration | Result |
| --- | --- | --- | ---: | --- |
| Diagnose specialist connector and verify official NeetCode source | 05:35:20 | 05:45:09 | 00:09:49 | Windows harness failures confirmed; connector invalid_grant and browser sign-in blocked live acceptance; official 150 source pinned |
| Repair Windows verification, populate bank, and open PRs | 05:45:09 | 05:58:33 | 00:13:24 | Scoped repairs; 49 questions added; initial checks and draft PRs |
| Validate bank in D1 and inspect hosted review | 05:58:33 | 06:01:27 | 00:02:54 | 399 coding questions, exactly 150 tagged; review corrections identified |
| Apply cleanup review fixes and revalidate PR #470 | 06:01:27 | 06:07:48 | 00:06:21 | Bundled Worker integration and regression checks passed; exact reviewed head merged |
| Release both changes, verify import, reconcile CI, and synchronize checkout | 06:07:48 | 06:17:23 | 00:09:35 | Both releases succeeded; 529 bank entries imported; main synchronized; clean worktrees removed |

- Client-measured wall-clock total: unknown.
- Active engineering total: unknown.
- Instrumented checkpoint span: 00:42:03; this is not total request time or active-only time.
- Hosted jobs overlapped local work and review. Their runner seconds below are not added to the checkpoint span.
- Both main releases reused their exact validated PR Worker artifacts; no equivalent main build was repeated. Full builds ran in hosted CI; no local full website build was performed.
- Local checks: 37 focused connector/source/import/solution checks, final 5/5 real bundled-Worker integration and harness checks, 9/9 bank/content checks, pinned-pnpm lint, local D1 migrations/import, MCP contract and private-boundary validation passed. These groups overlap and are not presented as a unique-test total.
- Initial draft Engineering checks failed because their PR-number receipts were not yet committed; receipts were committed before requesting review. Cancelled/skipped draft runs are included below.

### Hosted runs and metered usage

All started jobs used GitHub-hosted ubuntu-latest runners. Runtime is the sum of actual started job durations per run, excluding queue time and skipped jobs. Concurrent job durations are summed, not reported as wall-clock run duration.

| Run | Workflow | Result | Runner runtime |
| --- | --- | --- | ---: |
| [34602263212](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602263212) | Engineering | success | 0m 9s |
| [34602229223](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602229223) | Engineering | success | 0m 15s |
| [34602229204](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602229204) | Validation | success | 10m 34s |
| [34601767303](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601767303) | Engineering | success | 0m 12s |
| [34601730501](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601730501) | Engineering | cancelled | 0m 18s |
| [34601730548](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601730548) | Validation | success | 10m 50s |
| [34601724517](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601724517) | Engineering | cancelled | 0m 9s |
| [34601724490](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601724490) | Validation | skipped (never started) | 0s |
| [34601679075](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601679075) | Validation | skipped (never started) | 0s |
| [34601679055](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601679055) | Engineering | failure | 0m 10s |
| [34602658471](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602658471) | Engineering | success | 0m 9s |
| [34602615858](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602615858) | Engineering | success | 0m 13s |
| [34602615993](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602615993) | Validation | success | 10m 27s |
| [34602614277](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602614277) | Validation | skipped (never started) | 0s |
| [34602613124](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602613124) | Engineering | cancelled (never started) | 0s |
| [34602614012](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602614012) | Engineering | cancelled (never started) | 0s |
| [34602397125](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602397125) | Validation | skipped (never started) | 0s |
| [34602397181](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602397181) | Engineering | success | 0m 11s |
| [34601913725](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601913725) | Engineering | success | 0m 10s |
| [34601853084](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601853084) | Engineering | success | 0m 12s |
| [34601853083](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601853083) | Validation | skipped (never started) | 0s |
| [34601797484](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601797484) | Validation | skipped (never started) | 0s |
| [34601797449](https://github.com/Vinosaamaa/interview-arc/actions/runs/34601797449) | Engineering | failure | 0m 14s |
| [34602574635](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602574635) | Release | success | 1m 8s |
| [34602931350](https://github.com/Vinosaamaa/interview-arc/actions/runs/34602931350) | Release | success | 0m 58s |

Total actual runner duration: 2179 seconds (36m 19s). GitHub account billing amount: unknown.

Uploaded Worker artifacts, each retained for 7 days:

| Validation run | Artifact | Bytes |
| --- | --- | ---: |
| 34601730548 | validated-worker-6f19a70d14967299f9723aff9897e0b50fbfca3d | 102578434 |
| 34602229204 | validated-worker-6de149f62b6758b2947b4ad6f130f37979cc5734 | 102578491 |
| 34602615993 | validated-worker-7fb4d13a0f18fab41ac22698e894012eb4c260b9 | 102579407 |

Cloudflare: two successful production website/MCP releases and content-projection imports. Account-level metered usage and monetary charges were not exposed; amount unknown.

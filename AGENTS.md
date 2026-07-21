# Interview Arc Agent Instructions

Read `README.md` before starting work. Interview Arc is a personal interview-preparation journal, not a LeetCode clone or a general-purpose chatbot.

## Task Routing

Use the closest specialist guide and keep work in its owning area:

| Task | Owning guide | Primary output |
| --- | --- | --- |
| Website design, data loading, timers, dashboard, deployment | `docs/agents/website.md` and `app/AGENTS.md` | `app/`, tests, site configuration |
| LeetCode question-bank or coding-attempt work | `practice/leetcode/AGENTS.md` | `practice/leetcode/` |
| System-design coaching or mock interview | `practice/system-design/AGENTS.md` | `practice/system-design/sessions/` |
| Behavioral coaching or mock interview | `practice/behavioral/AGENTS.md` | `practice/behavioral/sessions/` |

If a task starts at the repository root, explicitly read the owning guide before changing files. Keep shared field names and enums in `docs/contracts/`; do not redefine incompatible versions inside specialist folders.

The user may keep every specialist as a long-lived Codex task inside the same outer Interview Prep project. Do not require separate local projects or worktrees. Codex tasks share committed and working-tree files, not one another's unrecorded transcript, so write durable decisions and published results to the repository.

For first-time task creation and durable specialist registration, follow
`docs/agents/task-startup-prompts.md`.

## Session Commands

- A focused dashboard activity or a clearly named problem establishes the
  normal activity boundary. `Start a new session` is an explicit override, not
  a daily ritual.
- Specialists append activity-scoped transcript turns and pinned notes to D1
  incrementally. D1 is draft storage; it is not the published journal.
- `Publish today's practice` inside a specialist task flushes and finalizes all
  pending activities for that specialty into D1. It performs no Git or deploy
  operation.
- `Publish all pending practice` in `Interview Arc — Coordinator` asks each
  registered specialist to flush/finalize, renders every pending artifact from
  D1, groups it by Pacific completion date, uses the guarded journal workflow,
  and publishes the resulting pull request to production.

Read `docs/contracts/durable-practice-publishing.md` for the complete task
registry, transcript, finalization, review, and publication protocol. Maintain
long system-design and behavioral drafts incrementally; never reconstruct an
arbitrarily long task transcript from memory at publication time.

## Shared Product Rules

- Default daily plan: one session containing 6 LeetCode problems, 1 system-design mock, and 1 behavioral mock. Website-created sessions may change those counts before work begins; allocate 40 minutes per coding problem and 60 minutes per mock.
- The session owns the countdown; every activity also has a compact elapsed-time stopwatch. Extra questions are allowed in every category.
- Practice dates are strict `America/Los_Angeles` calendar dates. An activity
  belongs to the date on which it finishes. Preserve its exact start/end
  timestamps and `session_id`; a single session may span midnight and appear in
  more than one daily manifest while remaining one session for analytics.
- Starting an activity focuses it and pauses any other running activity.
  Pausing or finishing a session pauses its running child activity. Starting a
  child activity resumes its parent session when necessary.
- Activity lifecycle is `planned`, `running`, or `completed`.
- Publication state is `draft`, `ready`, or `published`. Finished activities
  become `ready` automatically, including failed attempts. The website shows
  `published` only after the artifact has been merged and imported from Git.
- LeetCode outcome is exactly `solved`, `solved_after_reviewing_approach`, or `failed`.
- Lifecycle and outcome are separate. A failed attempt can still be completed and documented.
- Preserve raw session evidence. Do not replace a full conversation transcript with only a summary.
- Use ISO dates (`YYYY-MM-DD`) and stable, lowercase IDs.
- Never commit secrets, API keys, local database files, model caches, or raw audio.

## Evidence Ownership

- Website timer or explicit user report: allocated and elapsed time.
- User: LeetCode outcome, initial approach, unshared code, and blocker.
- Specialist task: only the coaching, solution, complexity, feedback, and transcript it observed.
- `activity_id`: joins website state to specialist artifacts.
- `session_id`: preserves session membership independently of daily publication
  date.

Leave unavailable fields empty or set their source to `unknown`. Never invent timer values, attempt results, code, personal experience, metrics, or transcript content.

## LeetCode Boundary

Do not crawl LeetCode, inspect authenticated/private endpoints or cookies, or copy editorials or solution content. The user may deliberately provide a CSV, JSON, PDF, or saved MHTML snapshot of a company list. Parse only visible metadata and public problem URLs from that supplied artifact, deduplicate by canonical problem slug, and never treat solved icons in the snapshot as Interview Arc progress unless the user explicitly asks. Do not invent LeetCode URLs. Label AI-generated coaching or solutions as generated material rather than official LeetCode content.

For a system-design bank question with `source: SystemDesign.io` and `solutionReference: true`, the system-design task must review the question page's current recommended solution links and design details before starting the mock. Those references form a private rubric; do not front-load or copy their answer before the user reasons.

For a behavioral bank question with `source: Bugfree.ai` and `solutionReference: true`, open the stored `url` whenever the user asks for an answer or solution. Use the current Bugfree.ai answer as reference, summarize it in original language, and keep any personalized story truthful to user-provided facts. If the answer is hidden behind nested navigation, sign-in, subscription, or another inaccessible layer, do not claim it was reviewed: tell the user what failed and provide the exact stored URL so they can open it.

## Audio Boundary

Raw recordings are ignored by Git and may be staged in `audio-answers/` for
transcription. Upload them through the authenticated Interview Arc audio API to
the private R2 bucket; D1 stores owner-scoped metadata and dated Past attempts
provide authenticated playback. Never commit raw audio or a public object URL.

For local transcription, prefer the current workspace environment:

```bash
../.venv/bin/python scripts/transcribe_audio.py <audio-file> --topic <topic> --prompt "<prompt>"
```

If the repository has its own `.venv/`, use `./.venv/bin/python` instead.

## Source Control And Verification

- Make code, schema, and instruction changes on a feature branch.
- Before starting a website feature branch, protect any journal-only working-tree
  changes with the checkpoint helper. It must refuse to move journal files when
  unrelated code changes are uncommitted.
- Preserve the root vinext/Cloudflare layout, `wrangler.jsonc`, and D1
  migrations. Keep `.openai/hosting.json` only while the legacy site is still
  awaiting explicit retirement.
- Use `pnpm` and preserve `pnpm-lock.yaml`.
- Run `pnpm test` and `pnpm lint` after website changes. Validate D1 changes
  locally with `pnpm db:migrate:local` and `pnpm content:import:local`.
- Run `pnpm lint` when TypeScript, JavaScript, or lint configuration changes.
- Group generated daily artifacts into one `journal/YYYY-MM-DD` branch. Only
  the coordinator renders/checkpoints Git artifacts; specialist tasks stop at a
  complete D1 finalization bundle.
- Before opening the daily PR, merge the latest `origin/main` into the journal
  branch. Being behind main is not itself a conflict; stop for user-visible
  resolution only when Git reports overlapping changes.
- Do not deploy or merge uncommitted work from another task.
- Production publishing is owned by the main-branch GitHub workflow. Never
  mutate production D1 or deploy a Worker before validation succeeds.

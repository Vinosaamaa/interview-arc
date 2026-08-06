# Interview Arc Agent Instructions

Read `README.md` before starting. Interview Arc is a personal
interview-preparation journal, not a LeetCode clone or general chatbot.

Before GitHub work, read
[`docs/agents/issue-lifecycle.md`](docs/agents/issue-lifecycle.md). Every
non-emergency product change starts with its owning issue; that contract owns
repository routing, PR linkage, verification, release, resolution, and
execution-ledger requirements.

Do not create or change a thread Goal unless the user explicitly asks.

## Task Routing

Read only the guide chain that owns the request:

| Task | Required guide |
| --- | --- |
| Website, reader, timers, dashboard, publishing, deployment | `docs/agents/website.md` and `app/AGENTS.md` |
| Any practice specialist | `practice/AGENTS.md` |
| LeetCode | `practice/leetcode/AGENTS.md` |
| System design | `practice/system-design/AGENTS.md` |
| Behavioral | `practice/behavioral/AGENTS.md` |

Keep shared schemas/contracts in `docs/contracts/`. Do not duplicate
specialist runtime instructions at the repository root.

The user may keep every specialist as a long-lived Codex task inside the same
outer project. Tasks share files, not unrecorded conversation. First-time task
creation and durable specialist registration follow
`docs/agents/task-startup-prompts.md`.

## UI Design Skill Routing

For new UI, visual redesigns, or material interface changes, use the installed
`frontend-design` skill as the primary design authority even when unnamed.
Read its complete instructions, announce its use, ground the direction in
Interview Arc, and perform its design-plan and self-critique passes.

- Use `imagegen` for raster mockups, wallpaper, or presentation boards.
- Use `impeccable` only when explicitly requested or for a separate
  interaction/accessibility hardening audit.
- Use `ui-ux-pro-max` only when explicitly requested or for a separate
  structured reference audit.
- Explicit user skill selection wins. Keep controlled comparison tasks isolated.
- Preserve approved visual references under `docs/design/<feature>/` and link
  them from the owning issue.

## Shared Product Rules

- Default daily plan: one session with 6 LeetCode problems, 1 system-design
  mock, and 1 behavioral mock; website-created sessions may change counts.
  Allocate 40 minutes per coding problem and 60 minutes per mock.
- The session owns the countdown; each activity has an elapsed-time stopwatch.
- Practice dates use `America/Los_Angeles`. Completion date determines the
  daily artifact; preserve exact timestamps and `session_id` across midnight.
- Starting an activity focuses it and pauses another running activity. Parent
  session and child activity pause/resume together as defined by Today controls.
- Today uses one durable owner-scoped workbench. `Start fresh day` archives it
  and opens a replacement while unpublished activities remain publishable.
- Activity lifecycle is `planned | running | completed`; publication state is
  `draft | ready | published`. Lifecycle and outcome are independent.
- LeetCode outcome is exactly `solved`,
  `solved_after_reviewing_approach`, or `failed`.
- Use stable lowercase IDs and ISO dates. Preserve raw evidence; never replace a
  full transcript with only a summary.
- Never commit secrets, credentials, local databases, model caches, or raw
  audio.

## Source Control And Verification

- Work on a feature branch and preserve unrelated dirty/untracked files.
- Before website feature work, checkpoint journal-only changes with the guarded
  helper; do not stash or mix unrelated work automatically.
- Preserve the vinext/Cloudflare layout, `wrangler.jsonc`, D1 migrations,
  `pnpm-lock.yaml`, and the legacy Sites fallback until explicitly retired.
- Use `pnpm`. Run checks proportionate to changed files; TypeScript,
  JavaScript, or lint configuration changes require `pnpm lint`. Validate D1
  changes locally with `pnpm db:migrate:local` and
  `pnpm content:import:local`.
- Only the coordinator renders/checkpoints journal artifacts, manages journal
  branches/PRs, publishes, deploys, and marks D1 activities published.
- Merge current `origin/main` into a journal branch before its PR. Being
  behind is not a conflict; stop only for overlapping changes Git reports.
- Never merge/deploy another task's uncommitted work. Production publishing is
  owned by the main-branch workflow and follows successful validation.
- Follow the exact execution-ledger and hosted-run reporting rules in
  `docs/agents/issue-lifecycle.md`.

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

## Session Commands

- `Start a new session`: establish a stable `activity_id`, activity source, and draft artifact. Only the conversation after this boundary belongs to the session transcript.
- `Publish this session`: finalize the current artifact and update the matching `data/daily/YYYY-MM-DD.json` entry. Do not open a pull request or deploy for an individual session.
- `Finish today's journal`: in the main/website task, validate all daily files, commit them together on `journal/YYYY-MM-DD`, push, and open one pull request.

Maintain long system-design and behavioral drafts incrementally. Do not rely on reconstructing an arbitrarily long task transcript only at publish time.

## Shared Product Rules

- Default daily plan: one fixed six-hour session containing 6 LeetCode problems, 1 system-design mock, and 1 behavioral mock.
- The session owns the countdown; every activity also has a compact elapsed-time stopwatch. Extra questions are allowed in every category.
- Activity lifecycle is `planned`, `running`, or `completed`.
- Publication state is independently `draft`, `ready`, or `published`. Only
  explicit `ready` activities enter an agent queue, including failed attempts.
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

Leave unavailable fields empty or set their source to `unknown`. Never invent timer values, attempt results, code, personal experience, metrics, or transcript content.

## LeetCode Boundary

Do not crawl LeetCode, inspect authenticated/private endpoints or cookies, or copy editorials or solution content. The user may deliberately provide a CSV, JSON, PDF, or saved MHTML snapshot of a company list. Parse only visible metadata and public problem URLs from that supplied artifact, deduplicate by canonical problem slug, and never treat solved icons in the snapshot as Interview Arc progress unless the user explicitly asks. Do not invent LeetCode URLs. Label AI-generated coaching or solutions as generated material rather than official LeetCode content.

For a system-design bank question with `source: SystemDesign.io` and `solutionReference: true`, the system-design task must review the question page's current recommended solution links and design details before starting the mock. Those references form a private rubric; do not front-load or copy their answer before the user reasons.

For a behavioral bank question with `source: Bugfree.ai` and `solutionReference: true`, open the stored `url` whenever the user asks for an answer or solution. Use the current Bugfree.ai answer as reference, summarize it in original language, and keep any personalized story truthful to user-provided facts. If the answer is hidden behind nested navigation, sign-in, subscription, or another inaccessible layer, do not claim it was reviewed: tell the user what failed and provide the exact stored URL so they can open it.

## Audio Boundary

Raw recordings stay in `audio-answers/` and are ignored by Git. Commit the matching Markdown transcript/review. Reference audio by filename with `availability: local-only`; the deployed site cannot play a file that exists only on the user's computer.

For local transcription, prefer the current workspace environment:

```bash
../.venv/bin/python scripts/transcribe_audio.py <audio-file> --topic <topic> --prompt "<prompt>"
```

If the repository has its own `.venv/`, use `./.venv/bin/python` instead.

## Source Control And Verification

- Make code, schema, and instruction changes on a feature branch.
- Preserve the root vinext/Cloudflare layout, `wrangler.jsonc`, and D1
  migrations. Keep `.openai/hosting.json` only while the legacy site is still
  awaiting explicit retirement.
- Use `pnpm` and preserve `pnpm-lock.yaml`.
- Run `pnpm test` and `pnpm lint` after website changes. Validate D1 changes
  locally with `pnpm db:migrate:local` and `pnpm content:import:local`.
- Run `pnpm lint` when TypeScript, JavaScript, or lint configuration changes.
- Group generated daily artifacts into a daily journal branch rather than opening a pull request for each timer event.
- Do not deploy or merge uncommitted work from another task.
- Production publishing is owned by the main-branch GitHub workflow. Never
  mutate production D1 or deploy a Worker before validation succeeds.

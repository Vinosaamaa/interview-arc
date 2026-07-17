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

## Shared Product Rules

- Default daily plan: 6 LeetCode problems in 3 hours, 1 system-design mock in 90 minutes, and 1 behavioral mock in 60 minutes.
- Extra questions are allowed in every category and use independent timers.
- Activity lifecycle is `planned`, `running`, or `completed`.
- LeetCode outcome is exactly `solved`, `solved_after_reviewing_approach`, or `failed`.
- Lifecycle and outcome are separate. A failed attempt can still be completed and documented.
- Preserve raw session evidence. Do not replace a full conversation transcript with only a summary.
- Use ISO dates (`YYYY-MM-DD`) and stable, lowercase IDs.
- Never commit secrets, API keys, local database files, model caches, or raw audio.

## LeetCode Boundary

Do not scrape LeetCode, Premium company-tag pages, authenticated/private endpoints, editorials, or solution content. Import only metadata the user deliberately supplies, or add public problem links manually. Do not invent LeetCode URLs. Label AI-generated coaching or solutions as generated material rather than official LeetCode content.

## Audio Boundary

Raw recordings stay in `audio-answers/` and are ignored by Git. Commit the matching Markdown transcript/review. Reference audio by filename with `availability: local-only`; the deployed site cannot play a file that exists only on the user's computer.

For local transcription, prefer the current workspace environment:

```bash
../.venv/bin/python scripts/transcribe_audio.py <audio-file> --topic <topic> --prompt "<prompt>"
```

If the repository has its own `.venv/`, use `./.venv/bin/python` instead.

## Source Control And Verification

- Make code, schema, and instruction changes on a feature branch.
- Preserve the root Sites/vinext layout and `.openai/hosting.json`.
- Use `pnpm` and preserve `pnpm-lock.yaml`.
- Run `pnpm build` after website or shared-data changes that can affect the deployed app.
- Run `pnpm lint` when TypeScript, JavaScript, or lint configuration changes.
- Group generated daily artifacts into a daily journal branch rather than opening a pull request for each timer event.
- Do not deploy or merge uncommitted work from another task.

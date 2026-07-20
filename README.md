# Interview Arc

Interview Arc is a personal interview-preparation journal. It plans the daily work, times each attempt, records what happened, and turns practice sessions into durable files that can be reviewed later.

The website is the dashboard. D1 stores live working state; the files in this
repository remain the long-term narrative record.

## Daily Practice

The default daily plan is:

| Scope | Daily work | Clock |
| --- | --- | ---: |
| Full session | 6 LeetCode + 1 system design + 1 behavioral | fixed 6-hour countdown |
| Each activity | one problem or mock | elapsed-time stopwatch |

Extra questions can be added in any category. Every extra question has its own elapsed-time stopwatch and is recorded as an activity with `source: extra`.

LeetCode attempts use exactly three outcomes:

- `solved`
- `solved_after_reviewing_approach`
- `failed`

An activity's lifecycle is separate from its outcome. For example, a failed problem is still a completed and documented attempt.

## Repository Map

```text
interview-arc/
├── AGENTS.md                       shared rules and task routing
├── app/                            hosted Interview Arc website
│   └── AGENTS.md                   website implementation rules
├── docs/
│   ├── agents/website.md           complete website-agent guide
│   ├── architecture/               repository decisions
│   └── contracts/                  shared activity and artifact formats
├── practice/
│   ├── leetcode/                   question bank and attempt records
│   ├── system-design/              system-design sessions and agent guide
│   └── behavioral/                 behavioral sessions and agent guide
├── audio-answers/                  local-only recordings plus tracked reviews
└── scripts/                        local artifact helpers
```

The site remains at the Git repository root because the Cloudflare Worker build
and repository automation run there. The interview-practice areas live beside
the app, so all four specialist workflows share one portable repository.

## Working With Specialist Tasks

Use four long-lived Codex tasks inside the same Interview Prep project: main/website, LeetCode, system design, and behavioral. They share this checkout and its files; they do not automatically share the private conversation history of another task.

The outer workspace instructions route a task to the right guide even when every task starts from the same Interview Prep folder. The user does not need separate projects or worktrees.

Use three shared commands:

- `Start a new session` creates or acknowledges a stable activity ID and draft artifact.
- `Publish this session` finalizes one question's files and updates the daily manifest.
- `Finish today's journal` asks the main task to validate, commit, push, and open one pull request for the day.

For coding, choose **Send to journal** on the desired problems, then say `Publish today's LeetCode`. Internally this is the `ready` state. The project-scoped Interview Arc MCP bridge lets the LeetCode task read that authenticated D1 queue and produce every coding artifact in one pass; it does not need a separate conversation for every problem. Exporting `journal-YYYY-MM-DD-draft.json` remains the portable fallback.

See `docs/architecture/single-project-practice-workflow.md` for the full ownership and Git model.

## LeetCode Data Policy

Question metadata is added manually or imported from a user-provided CSV, JSON, or saved MHTML snapshot. A saved snapshot is user-supplied input: parse only its visible company-table metadata and public problem URLs. Do not crawl the live authenticated account, inspect cookies or private endpoints, or import problem statements, editorials, or solution content.

The bank may store titles, public URLs, difficulty, topics, user-supplied company tags, and planning metadata. Attempts should link to LeetCode for the original prompt and submission. Generated explanations must be labeled as original coaching material, not as official LeetCode answers.

## Session Artifacts

Shared formats live under `docs/contracts/`:

- `activity.schema.json` defines shared timed activity fields and outcomes.
- `leetcode-log.md` and `leetcode-log.schema.json` define attempt and walkthrough records.
- `daily-journal.schema.json` defines the file the website ingests for each day.
- `question-bank.schema.json` defines manually maintained LeetCode metadata.
- `practice-question-bank.schema.json` defines system-design and behavioral prompt banks.
- `website-draft.md` defines six-hour session countdowns, activity stopwatches, editable extras, publish eligibility, and browser export.
- `session-artifact.md` defines system-design and behavioral transcript files.

System-design and behavioral sessions preserve the complete conversation transcript with speaker labels. Summaries and feedback are added after the transcript; they do not replace it.

## Audio

Audio recordings are intentionally local-only and ignored by Git. Their matching Markdown transcript and review files are committed. A session artifact references the recording by filename and marks it as `local-only`; the deployed website must show that status instead of offering a broken playback link.

In the current local umbrella workspace, run transcription from this repository with:

```bash
../.venv/bin/python scripts/transcribe_audio.py path/to/answer.m4a \
  --topic tiktok-feed \
  --prompt "Design TikTok's For You feed"
```

The helper copies the recording into `audio-answers/` and creates its Markdown review. A standalone clone may instead create `.venv/` in this repository and run the same script with `./.venv/bin/python`.

## Website Development

Prerequisite: Node.js `>=22.13.0`.

```bash
pnpm install
pnpm db:migrate:local
pnpm content:import:local
pnpm dev
pnpm build
pnpm test
```

Production runs as the `limitless` Cloudflare Worker described by
`wrangler.jsonc`, with shared published content and owner-scoped live state in
D1. Cloudflare Access supplies verified identity. The separate `limitless-mcp`
Worker in `wrangler.mcp.jsonc` exposes authenticated Codex MCP tools and the
Chrome companion API against that same database. `.openai/hosting.json` is
retained only for the temporary legacy OpenAI Sites deployment; do not use it
as the production architecture or remove it until the user explicitly retires
that site.

Git JSON/Markdown is canonical for journals, solutions, transcripts, and story
records. `scripts/import-content.mjs` projects those files into D1 so the site
can read new published content without compiling it into the application.
Timers, result flags, website-created sessions, and extra activities are
canonical in D1, with browser storage acting only as an offline cache and retry
queue.

## Git Workflow

- Code, schemas, and agent-guide changes use a feature branch and pull request.
- Generated interview artifacts can be grouped into one daily branch such as `journal/2026-07-17`.
- All specialist tasks use the same daily branch sequentially in the same checkout.
- `Publish this session` writes files only; it does not create a pull request or deploy by itself.
- `Finish today's journal` creates one commit/pull request for the complete day.
- Timer ticks and live UI state belong in application storage, not one Git commit per click.
- End-of-day Markdown is the durable journal record.
- Pull requests run local-D1 validation, lint, build, and tests. A merge to
  `main` refreshes the production D1 content projection only after validation;
  content/documentation-only merges skip the Worker redeploy.

## Question Banks And Sessions

The website reads three versioned banks:

- `practice/leetcode/bank/questions.json`
- `practice/system-design/bank/questions.json`
- `practice/behavioral/bank/questions.json`

The system-design bank currently mirrors the 55 questions listed by SystemDesign.io. Each stored question URL leads to that site's current curated solution references; the system-design task reviews those references before starting the corresponding mock.

The behavioral bank mirrors the 74 questions listed by Bugfree.ai. Each entry stores its canonical answer page, category/focus topics, expected answer format, frequency, and whether the reference may require sign-in. The behavioral task consults that page when the user asks for a solution and reports the exact URL when the site's answer cannot be accessed.

A normal session contains six coding problems, one system-design question, and one behavioral question under one fixed six-hour countdown. The user may add another full session or a standalone activity. Every activity also has a compact elapsed-time stopwatch.

The site presents these sources in Problem Banks. Past is the completed-work reading log; Journey retains broader statistics, including failed attempts.

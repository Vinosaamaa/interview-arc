# Interview Arc

Interview Arc is a personal interview-preparation journal. It plans the daily work, times each attempt, records what happened, and turns practice sessions into durable files that can be reviewed later.

The website is the dashboard. The files in this repository are the long-term record.

## Daily Practice

The default daily plan is:

| Area | Daily work | Default timer |
| --- | --- | ---: |
| LeetCode | 6 problems | 3 hours total |
| System design | 1 mock interview | 90 minutes |
| Behavioral | 1 mock interview | 60 minutes |

Extra questions can be added in any category. Every extra question has its own timer and is recorded as an activity with `source: extra`.

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

The site remains at the Git repository root because the current Sites deployment expects the build output there. The interview-practice areas live beside the app, so all four specialist workflows share one repository without breaking hosting.

## Working With Specialist Agents

Start a new Codex task from the specialist directory when possible:

- `practice/leetcode/` for problem-bank curation and coding-attempt review
- `practice/system-design/` for coached system-design mock interviews
- `practice/behavioral/` for behavioral story practice
- repository root or `app/` for website work

Codex loads the root `AGENTS.md` and then the closest nested `AGENTS.md`. When an existing task predates an instruction change, start a new task so the updated instruction chain is loaded.

## LeetCode Data Policy

Question metadata is added manually or imported from a user-provided CSV or JSON file. Do not scrape LeetCode pages, Premium company tags, private endpoints, editorials, or solution content.

The bank may store titles, public URLs, difficulty, topics, user-supplied company tags, and planning metadata. Attempts should link to LeetCode for the original prompt and submission. Generated explanations must be labeled as original coaching material, not as official LeetCode answers.

## Session Artifacts

Shared formats live under `docs/contracts/`:

- `activity.schema.json` defines timed activities and outcomes.
- `question-bank.schema.json` defines manually maintained LeetCode metadata.
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
pnpm dev
pnpm build
```

The existing hosted project configuration is stored in `.openai/hosting.json`. Keep that file and the root build layout intact.

## Git Workflow

- Code, schemas, and agent-guide changes use a feature branch and pull request.
- Generated interview artifacts can be grouped into one daily branch such as `journal/2026-07-17`.
- Timer ticks and live UI state belong in application storage, not one Git commit per click.
- End-of-day Markdown is the durable journal record.

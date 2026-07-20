# Single-Project Practice Workflow

## Status

Accepted on 2026-07-17.

## Decision

Use one Codex project and one shared `interview-arc` checkout. Keep four long-lived tasks for main/website, LeetCode, system design, and behavioral practice. Do not create a separate project or Git worktree for each specialist.

Tasks share repository files but not hidden conversational context. Durable instructions live in `AGENTS.md`; durable session evidence lives in the activity and artifact files.

## Session Protocol

1. `Start a new session` creates or acknowledges the activity ID and draft.
2. The specialist works with the user and records only evidence it observes.
3. `Publish this session` finalizes the artifact, updates the daily manifest,
   and invokes the guarded checkpoint helper. The helper creates or reuses
   `journal/YYYY-MM-DD` and commits only journal-owned files.
4. `Finish today's journal` asks the main task to merge the latest `origin/main`,
   validate the files, and create one daily pull request.

System-design and behavioral transcripts are appended incrementally. LeetCode uses a structured log by default; a full transcript is optional when the conversation itself is valuable.

LeetCode also supports the day-level `Publish today's LeetCode` command. The user exports Today once and places the JSON under `data/drafts/` or attaches it to the LeetCode task. That task uses the publish queue to generate every eligible coding artifact in one batch, including problems that were never discussed in that task.

## Ownership

The website owns live timer draft state. A specialist can use time only when it comes from the website export or the user. The user owns attempt outcome and any code or reasoning they did not share. The specialist owns only its generated explanation and observed coaching interaction. Every surface joins data through `activity_id`.

Each session owns one countdown derived from its recipe: 40 minutes per coding problem and 60 minutes per system-design or behavioral question. The default 6/1/1 recipe remains six hours. Every activity also owns a compact elapsed-time stopwatch so per-problem time remains publishable. A session countdown may run alongside one activity stopwatch; only one activity stopwatch may run at a time. Finishing an activity locks its stopwatch permanently.

The user may create multiple sessions in one day. A session starts with six coding problems, one system-design question, and one behavioral question selected from their respective banks, but the user may configure those counts before starting. Standalone extra activities remain supported and reveal edit/remove actions with a left swipe.

## LeetCode Records

An `attempt` is genuine user work and may end in one of the three allowed outcomes. A `walkthrough` is an agent-generated solution requested from a URL; it has no attempt outcome unless the user later performs a real attempt. See `../contracts/leetcode-log.md`.

## Hybrid Git + D1 Website

The deployed Cloudflare architecture separates narrative publishing from live
practice state:

- `data/daily/YYYY-MM-DD.json` and specialist Markdown artifacts are the
  canonical, reviewable journal record in Git.
- `scripts/import-content.mjs` projects that shared content into D1; the app
  reads D1 at request time and no longer compiles a generated content index.
- timers, outcomes, website-created sessions, and extra activities are written
  immediately to owner-scoped D1 tables through the app API.
- browser storage is an offline cache and retry queue, not the cross-device
  source of truth.
- Cloudflare Access verifies identity. The Worker forwards only its verified
  email through a private internal header; app routes hash it before using it
  as `owner_id`.
- `data/drafts/journal-YYYY-MM-DD-draft.json` remains the explicit, ignored
  bridge when a specialist task needs the user's live completion/timing data.

The Today view is based on the current Los Angeles calendar date. It creates an
empty in-memory journal shell when Git has no manifest for that date, so normal
practice never remains pinned to the latest imported historical entry.

## Git

Code and instruction changes use normal feature branches. Daily practice uses
one sequential `journal/YYYY-MM-DD` branch in the shared checkout. Each
specialist publication runs `pnpm journal:checkpoint -- --date YYYY-MM-DD
--area <specialty>`, which creates a local checkpoint commit but never pushes,
opens a pull request, or deploys. The filesystem lock rejects concurrent
checkpoints, and the path guard rejects unrelated uncommitted code.

Because the checkout is shared, practice conversations may be interleaved but
publication commands must finish one at a time. Before website feature work,
the coordinator checkpoints any journal-only changes, switches to updated
`main`, and creates the feature branch. After the feature PR is merged, the
coordinator may return to the daily branch. Before the daily PR, it merges the
latest `origin/main` into the journal branch. A journal branch being behind main
does not itself create a conflict; Git reports a conflict only when both lines
of development changed overlapping content that cannot be combined safely.

Every pull request validates local D1 migrations/imports, lint, build, and
tests. After merge to `main`, the production workflow waits for validation,
applies pending migrations, and refreshes Git-backed content in D1. A merge
containing only content or documentation skips the Worker redeploy. The legacy
OpenAI Sites deployment is intentionally outside this flow until the user
explicitly retires it.

The specialist may report an artifact path to live D1 after its local checkpoint,
but the website continues to show **Ready for journal** until the Git-backed
artifact is merged and imported into production D1. This prevents a local-only
checkpoint from appearing as a readable production journal entry.

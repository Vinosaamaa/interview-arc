# Single-Project Practice Workflow

## Status

Accepted on 2026-07-17.

## Decision

Use one Codex project and one shared `interview-arc` checkout. Keep four long-lived tasks for main/website, LeetCode, system design, and behavioral practice. Do not create a separate project or Git worktree for each specialist.

Tasks share repository files but not hidden conversational context. Durable instructions live in `AGENTS.md`; durable session evidence lives in the activity and artifact files.

## Session Protocol

1. `Start a new session` creates or acknowledges the activity ID and draft.
2. The specialist works with the user and records only evidence it observes.
3. `Publish this session` finalizes the artifact and updates the daily manifest.
4. `Finish today's journal` asks the main task to validate the files and create one daily pull request.

System-design and behavioral transcripts are appended incrementally. LeetCode uses a structured log by default; a full transcript is optional when the conversation itself is valuable.

## Ownership

The website owns live timer draft state. A specialist can use time only when it comes from the website export or the user. The user owns attempt outcome and any code or reasoning they did not share. The specialist owns only its generated explanation and observed coaching interaction. Every surface joins data through `activity_id`.

Each activity owns its timer. For LeetCode, the three-hour session target is the sum of six individual problem timers. This makes per-problem elapsed time publishable without running an overlapping sprint clock.

The user may create multiple sessions in one day. A normal session contains six coding problems, one system-design question, and one behavioral question selected from their respective banks. Standalone extra activities remain supported and can be edited or removed before publication.

## LeetCode Records

An `attempt` is genuine user work and may end in one of the three allowed outcomes. A `walkthrough` is an agent-generated solution requested from a URL; it has no attempt outcome unless the user later performs a real attempt. See `../contracts/leetcode-log.md`.

## File-Backed Website

The first version uses build-time ingestion:

- `data/daily/YYYY-MM-DD.json` contains the daily plan and finalized activity summary.
- specialist Markdown artifacts contain transcript, solution, and review detail.
- `scripts/build-content-index.mjs` generates the website's content index before development and production builds.
- browser storage is temporary timer/draft state only; versioned files are the durable record.

Immediate multi-device writes from the deployed site would require a separately scoped D1/API implementation. This file-backed version deliberately avoids adding authentication or a database before the journal workflow is proven.

## Git

Code and instruction changes use normal feature branches. Daily practice uses one sequential `journal/YYYY-MM-DD` branch in the shared checkout. Individual session publication does not commit, push, open a pull request, or deploy. The main task performs those actions once when the user finishes the journal.

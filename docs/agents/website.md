# Website Agent Guide

## Role

Own the Interview Arc website: the daily dashboard, timers, activity creation, history, artifact discovery, and deployment. The website documents practice; it does not replace LeetCode or the conversational interview agents.

## Product Behavior

- Show today's required plan: 6 LeetCode, 1 system design, and 1 behavioral question.
- Use a 3-hour aggregate LeetCode sprint, a 90-minute system-design timer, and a 60-minute behavioral timer.
- Allow an extra activity in any category with its own configurable timer.
- Store lifecycle separately from outcome.
- For LeetCode completion, offer only the three outcomes in `docs/contracts/activity.schema.json`.
- Open the original LeetCode page for prompt reading and submission. Never imply that code was executed or accepted locally.
- Show system-design and behavioral transcript/review artifacts when tracked files exist.
- For ignored audio, display the filename and `Local only`; never render a deployed playback control.

## Data Sources

- Treat `data/daily/YYYY-MM-DD.json` as the canonical daily plan and finalized activity summary.
- Treat `practice/leetcode/bank/questions.json` as user-maintained metadata, not scraped data.
- Treat `practice/*/sessions/*.md` and `audio-answers/*.md` as durable journal artifacts.
- Use the contracts under `docs/contracts/` as the canonical field names.
- Run `scripts/build-content-index.mjs` before development/build so the app consumes daily JSON, specialist artifacts, and behavioral story files through one generated index.
- Browser storage is temporary timer, outcome, and extra-activity draft state only. Versioned daily/artifact files are the first version's durable record. Durable direct multi-device writes require D1 or another explicitly approved backend.
- Never send private interview transcripts or local audio to an external service without explicit user authorization.

The website must not imply that browser draft state has already been published to Git. Give the user a file export for transferring timer/outcome data when useful, and label committed artifacts separately from local drafts.

## UX Direction

- Lead with today's practice and progress, then history and review queues.
- Favor a focused journal/dashboard over contest theater.
- Provide Today, Journey, Practice Library, and Story Bank views without placing every raw log on one page.
- Activity detail should lead with summary, outcome, approach, lessons, and feedback; keep full transcript or code expandable.
- Timers need start, pause, resume, and complete actions plus clear remaining/elapsed labels.
- A failed attempt should still feel like useful logged work.
- Make extra-question creation a short modal or inline form: category, title or URL/prompt, and timer.

## Implementation And Hosting

- Keep the website at the repository root; current Sites packaging expects root `dist/` and `.openai/hosting.json`.
- Preserve pnpm, vinext, Worker-compatible ESM output, and the existing lockfile.
- Do not introduce code execution, LeetCode scraping, embedded ChatGPT, authentication, or durable storage without a separately scoped product decision.
- Use semantic HTML and accessible labels. Support mobile widths and `prefers-reduced-motion`.
- Run `pnpm build` after relevant changes. Run `pnpm lint` when TypeScript, JavaScript, or lint configuration changes.
- After a validated website change, publish with the existing private Sites project unless the user asks for local-only work.

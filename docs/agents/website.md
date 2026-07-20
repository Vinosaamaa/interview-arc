# Website Agent Guide

## Role

Own the Interview Arc website: the daily dashboard, timers, activity creation, history, artifact discovery, and deployment. The website documents practice; it does not replace LeetCode or the conversational interview agents.

## Product Behavior

- Show today's required plan: 6 LeetCode, 1 system design, and 1 behavioral question.
- Give every full session one fixed six-hour countdown.
- Give every activity a compact elapsed-time stopwatch. The session countdown may run alongside one activity stopwatch; only one activity stopwatch may run at a time.
- Finishing an activity or session locks that timer. Never offer resume after finish.
- Allow another complete session containing 6 coding problems, 1 system-design question, and 1 behavioral question.
- Allow an extra activity in any category with its own stopwatch and optional planning estimate.
- Let locally added activities be edited and removed.
- Store lifecycle separately from outcome.
- Give coding, system-design, and behavioral activities the same cycling result-flag layout. The local mock labels are finished, finished after review, and failed; only LeetCode persists the canonical outcome field. The hover/focus legend must explain the colors and must not be clipped inside a swipe card.
- Open the original LeetCode page for prompt reading and submission. Never imply that code was executed or accepted locally.
- Show system-design and behavioral transcript/review artifacts when tracked files exist.
- Past contains only green/yellow LeetCode work and green/yellow or otherwise finished/published system-design and behavioral work. Never show planned, running, or red/failed activities there.
- Render tracked artifact Markdown as formatted headings, lists, links, tables, quotes, and code blocks rather than raw source text.
- For ignored audio, display the filename and `Local only`; never render a deployed playback control.

## Data Sources

- Treat `data/daily/YYYY-MM-DD.json` as the canonical daily plan and finalized activity summary.
- Treat `practice/leetcode/bank/questions.json` as user-maintained metadata, not scraped data.
- Treat `practice/system-design/bank/questions.json` and `practice/behavioral/bank/questions.json` as the matching prompt banks.
- Treat `practice/*/sessions/*.md` and `audio-answers/*.md` as durable journal artifacts.
- Use the contracts under `docs/contracts/` as the canonical field names.
- `scripts/import-content.mjs` mirrors versioned journals, artifacts, story files,
  and all three banks into the shared D1 content tables. Do not generate or
  commit a TypeScript content bundle.
- D1 is authoritative for owner-scoped timers, outcomes, website-created
  sessions, and extra activities. Browser storage is an offline cache and retry
  queue; versioned daily/artifact files are authoritative for published
  narrative content.
- The Today view uses the current date in `America/Los_Angeles`. If no imported
  manifest exists for that date, render an empty current-day journal and let
  D1 hold the live work instead of falling back to the latest historical day.
- Cloudflare Access identity must be verified in the Worker and passed to app
  routes through the internal trusted header. Hash the normalized email for D1
  ownership; never store raw email or trust a caller-supplied identity header.
- Never send private interview transcripts or local audio to an external service without explicit user authorization.

The website must not imply that browser draft state has already been published to Git. Give the user a file export for transferring timer/outcome data when useful, and label committed artifacts separately from local drafts.

## UX Direction

- Treat the once-daily arrival screen as the product's signature moment: show
  one date-stable original encouragement, the dawn study artwork, and a single
  explicit action into the dashboard. The click may start the procedural
  ambient soundscape because browsers do not permit audible autoplay before a
  user gesture.
- Keep cherry-blossom motion abundant on arrival and sparse inside the working
  dashboard. Provide persistent independent controls for sound and petals,
  remember those preferences locally, and disable motion for
  `prefers-reduced-motion`.
- Lead with today's practice and progress, then history and review queues.
- Favor a focused journal/dashboard over contest theater.
- Provide Today, Journey, Past, and Problem Banks views without placing every raw log on one page.
- Activity detail should lead with summary, outcome, approach, lessons, and feedback; keep full transcript or code expandable.
- The session clock is a countdown. Activity clocks are stopwatches with compact icon controls for start/pause and finish.
- A failed attempt should still feel like useful logged work.
- Make extra-question creation a short modal or inline form: category, title or URL/prompt, and timer.
- In the creation flow, search the matching bank first. For an unknown LeetCode URL, derive a title from its public problem slug without scraping the page. For unknown system-design or behavioral questions, accept a custom title with no URL.
- Keep body and annotation text readable: normal supporting copy should be at least 14px and short utility labels at least 12px.
- Past is a date-grouped scrolling log with category color, filters, a calendar jump control, and a centered reading dialog.
- Problem Banks combines all three versioned banks, offers independent category and progress filters, and sends every `Practice today` selection to standalone practice on Today. Progress has `All`, `To practice`, and `Finished`; failed or merely planned work remains `To practice`.
- For imported system-design questions, show the source question link, listed complexity, and whether reference solutions are available.
- For imported behavioral questions, show the expected answer format, frequency, and whether the Bugfree.ai reference may require sign-in. Link to the canonical answer page without copying third-party answer text into the site.
- Journey owns cumulative totals and daily charts for coding, system design, behavioral, outcomes, and elapsed time.

## Implementation And Hosting

- Keep the website at the repository root; Cloudflare Worker packaging expects
  root `dist/`, `wrangler.jsonc`, and `drizzle/` migrations.
- Preserve pnpm, vinext, Worker-compatible ESM output, D1, Cloudflare Access,
  and the existing lockfile.
- Do not introduce code execution, LeetCode scraping, or embedded ChatGPT.
- Use semantic HTML and accessible labels. Support mobile widths and `prefers-reduced-motion`.
- Run `pnpm lint` and `pnpm test` after relevant code changes. For database or
  import changes, also run the local D1 migration and content-import commands.
- Pull requests validate without production credentials. After merge to `main`,
  the GitHub workflow validates first, then applies pending production
  migrations and refreshes the content projection. It deploys the Worker only
  when the merge contains application/infrastructure code; content-only merges
  must not redeploy it.
- The old OpenAI Sites project remains a temporary fallback. Do not deploy to
  or retire it unless the user explicitly asks.

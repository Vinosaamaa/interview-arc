# Website Agent Guide

## Role

Own the Interview Arc website: the daily dashboard, timers, activity creation, history, artifact discovery, and deployment. The website documents practice; it does not replace LeetCode or the conversational interview agents.

## Product Behavior

- Default a new full session to 6 LeetCode, 1 system design, and 1 behavioral question.
- Let the user configure each category count before work begins. Derive the session countdown from 40 minutes per coding problem and 60 minutes per system-design or behavioral question.
- Give every activity a compact elapsed-time stopwatch. The session countdown may run alongside one activity stopwatch; only one activity stopwatch may run at a time.
- Finishing an activity or session locks that timer. Never offer resume after finish.
- Allow another configurable session; use 6/1/1 as the starting recipe.
- Let an unstarted website-created session be edited. Lock its recipe once its session timer, activity timing, result, or publication work begins.
- Allow an extra activity in any category with its own stopwatch and optional planning estimate.
- On Today, use the masthead tally for yesterday's completed activities, recorded time, and sessions. Read owner-scoped D1 state for yesterday so unpublished work is not omitted; fall back to the versioned journal offline.
- Let locally added activities be edited and removed.
- Store lifecycle separately from outcome.
- Give coding, system-design, and behavioral activities the same cycling result-flag layout. The local mock labels are finished, finished after review, and failed; only LeetCode persists the canonical outcome field. The hover/focus legend must explain the colors and must not be clipped inside a swipe card.
- Open the original LeetCode page for prompt reading and submission. Never imply that code was executed or accepted locally.
- Show system-design and behavioral transcript/review artifacts when tracked files exist.
- Past contains every completed attempt, including failed work worth reviewing;
  it never shows planned or running activities. Keep practice-type filters
  separate from attention filters: Due now, Needs review, Solved with help,
  Failed, and Has notes.
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
- D1 also owns activity-scoped draft transcript turns, pinned notes,
  specialist finalization bundles, review schedules, the stable specialist-task
  registry, and private audio metadata. These rows are working state—not the
  published journal. Follow `../contracts/durable-practice-publishing.md`.
- The Today view uses the current date in `America/Los_Angeles`. If no imported
  manifest exists for that date, render an empty current-day journal and let
  D1 hold the live work instead of falling back to the latest historical day.
- Cloudflare Access identity must be verified in the Worker and passed to app
  routes through the internal trusted header. Hash the normalized email for D1
  ownership; never store raw email or trust a caller-supplied identity header.
- Never send private interview transcripts or local audio to an external service without explicit user authorization.

The website must not imply that browser draft state has already been published to Git. Give the user a file export for transferring timer/outcome data when useful, and label committed artifacts separately from local drafts.

## UX Direction

- Treat the arrival screen as the product's signature moment. Show it on every
  full page entry and keep it visible until the user explicitly enters. Draw
  fresh encouragement and one 4K photograph from the local, licensed wallpaper
  pool while avoiding the immediately prior visit. The entry click may start music because audible
  playback requires a user gesture.
- Keep a locally hosted, documented, licensed lo-fi/chillout playlist. Start
  from a freshly drawn track that avoids the prior visit, advance when a song ends, and provide
  play/pause, previous/next-track, direct track selection, and clearly audible
  volume controls. Show the daily playlist with the licensed source page and a
  direct save action for every locally hosted track. Never rip music from
  YouTube, hotlink media, or ship media without a documented usage license.
- Keep cherry-blossom motion abundant and high-contrast on both arrival and the
  working dashboard so the petals remain visible over bright or dark surfaces.
  Provide persistent independent controls for sound and petals, remember those
  preferences locally, and disable motion for `prefers-reduced-motion`.
- Lead with today's practice and progress, then history and review queues.
- Favor a focused journal/dashboard over contest theater.
- Provide Today, Journey, Past, and Problem Banks views without placing every raw log on one page.
- Activity detail should lead with summary, outcome, approach, lessons, and feedback; keep full transcript or code expandable.
- Treat activity detail as a case file: pinned notes first, then facts, review
  date, summary/solution, review, transcript/code, delivery recordings, and
  references. Notes apply equally to coding, system design, and behavioral.
- The session clock is a countdown. Activity clocks are stopwatches with compact icon controls for start/pause and finish.
- Use `America/Los_Angeles` as the canonical practice timezone. Display exact
  Pacific start and finish timestamps in Past and preserve them in exports.
- Keep calendar date and session membership independent. Assign a completed
  activity to its Pacific completion date, but retain one stable `session_id`
  when a session crosses midnight.
- Persist a single focused activity. Starting another activity pauses the prior
  one; starting a child resumes its parent session. Pausing or finishing a
  session pauses its running child activity. Starting a standalone activity
  pauses any running session so that work is not charged to the wrong session.
- Journey may summarize evidence-backed Pacific time-of-day distribution and
  per-session completion, duration, and cross-midnight span. Do not turn a
  time-of-day distribution into a productivity or mastery claim.
- A failed attempt should still feel like useful logged work.
- Make extra-question creation a short modal or inline form: category, title or URL/prompt, and timer.
- In the creation flow, search the matching bank first. For an unknown LeetCode URL, derive a title from its public problem slug without scraping the page. For unknown system-design or behavioral questions, accept a custom title with no URL.
- Keep body and annotation text readable: normal supporting copy should be at least 14px and short utility labels at least 12px.
- Past is a date-grouped scrolling log with category color, filters, a calendar jump control, and a centered reading dialog.
- Problem Banks combines all three versioned banks, offers independent category and progress filters, and sends every `Practice today` selection to standalone practice on Today. Progress has `All`, `To practice`, and `Finished`; failed or merely planned work remains `To practice`.
- For imported system-design questions, show the source question link, listed complexity, and whether reference solutions are available.
- For imported behavioral questions, show the expected answer format, frequency, and whether the Bugfree.ai reference may require sign-in. Link to the canonical answer page without copying third-party answer text into the site.
- Journey owns cumulative totals and interactive analytics for coding, system design, behavioral, outcomes, elapsed time, consistency, difficulty, and bank-linked topic coverage.
- A new session places up to two due reviews ahead of new questions when the
  configured category slots permit it. Failed/full-walkthrough work is due in 4
  days; approach-review work in 7; successful recalls advance to 21 then 60.
- Anchor Journey with a selectable 365-day practice heatmap. Shade only finished coding and mock work; expose failed-attempt counts in the day detail without treating them as solved output.
- Every Journey visualization must disclose the records behind it: heatmap days and trend points select a date, topic bars reveal matching attempts, and effort/outcome points open the activity record. Do not infer mastery, productivity by time of day, or other statistics unsupported by stored evidence.
- Present publication state in user language: `draft` is **Finish to journal**,
  `ready` is **Ready for journal**, and `published` is **In journal**. Finishing
  the stopwatch or choosing a result derives `ready` automatically; the control
  is informational rather than a second user decision.

## Implementation And Hosting

- Keep the website at the repository root; Cloudflare Worker packaging expects
  root `dist/`, `wrangler.jsonc`, and `drizzle/` migrations.
- Preserve pnpm, vinext, Worker-compatible ESM output, D1, Cloudflare Access,
  and the existing lockfile.
- Keep the token-authenticated `limitless-mcp` Worker as the bridge for Codex
  and the Chrome companion. Integration tokens are generated only from an
  authenticated dashboard session, stored in D1 as SHA-256 digests, and mapped
  to the same opaque owner ID as browser state.
- Keep the Chrome extension focused on public LeetCode problem URLs, the real
  LeetCode editor, and Interview Arc-owned state. It must not read page content,
  inspect submissions, or submit code.
- Do not introduce code execution, LeetCode scraping, or embedded ChatGPT.
- Use semantic HTML and accessible labels. Support mobile widths and `prefers-reduced-motion`.
- Run `pnpm lint` and `pnpm test` after relevant code changes. For database or
  import changes, also run the local D1 migration and content-import commands.
- Pull requests validate without production credentials. After merge to `main`,
  the GitHub workflow validates first, then applies pending production
  migrations and refreshes the content projection. It deploys the Worker only
  when the merge contains application/infrastructure code; content-only merges
  must not redeploy it.
- Act as the branch coordinator. Before starting feature work, inspect the
  working tree. If it contains only journal-owned changes, run `pnpm
  journal:checkpoint -- --date YYYY-MM-DD --area practice`; if unrelated code
  is also dirty, finish or explicitly separate that work instead of stashing or
  mixing it automatically.
- For `Publish all pending practice`, first ask every relevant registered
  specialist task to flush/finalize. Then fetch main, create or return to each
  required `journal/YYYY-MM-DD`, merge `origin/main`, render and validate the
  D1-backed case files, push, and open the journal PR. Never treat “behind main”
  as a conflict by itself. Mark D1 records published only after their artifacts
  exist and are importable.
- The old OpenAI Sites project remains a temporary fallback. Do not deploy to
  or retire it unless the user explicitly asks.

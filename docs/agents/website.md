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
- Offer Job applications only inside the **Activities** composer as a compact
  Career Focus row, not as a fourth practice specialty and not inside the Full
  session recipe. The existing Standalone / One session destination applies,
  so a focus block may be scheduled alone or share a session countdown with
  practice activities. It shares the one-active-stopwatch rule but has no
  outcome, specialist, review, solution, Past card, Problem Bank row, or
  publication lifecycle. Follow `../contracts/career-work.md`.
- On Today, use the masthead tally for yesterday's completed activities, recorded time, and sessions. Read owner-scoped D1 state for yesterday so unpublished work is not omitted; fall back to the versioned journal offline.
- Let locally added activities be edited and removed.
- Store lifecycle separately from outcome.
- Treat Today as one durable owner-scoped workbench rather than a calendar-day
  query. Pacific midnight does not clear it. `Start fresh day` confirms and
  closes started timers, archives never-started rows as not attempted, clears
  Voice focus, and opens a new workbench without marking anything published.
- Hide published activities from Today immediately; remove a session when all
  of its publishable activities are published. Archived ready work remains in
  the coordinator's undated queue.
- Give coding, system-design, and behavioral activities the same cycling result-flag layout: Solved, Solved with help, and Failed. Preserve `solved_after_reviewing_approach` as the canonical stored value. The hover/focus legend must explain the colors and must not be clipped inside its activity card.
- Open the original LeetCode page for prompt reading and submission. Never imply that code was executed or accepted locally.
- Show system-design and behavioral transcript/review artifacts when tracked files exist.
- Past contains every completed attempt, including failed work worth reviewing;
  it never shows planned or running activities. Keep practice-type filters
  separate from attention filters: Due now, Needs review, Solved, Solved with
  help, Failed, and Has notes.
- Render tracked artifact Markdown as formatted headings, lists, links, tables, quotes, and code blocks rather than raw source text.
- Follow `../contracts/reader-rendering.md`. The reader is one shared runtime
  template over versioned Markdown/JSON, not a generated static page per
  artifact. CSS and interaction improvements must update prior artifacts
  automatically; content absent from an old profile requires an explicit
  revision or backfill.
- Keep fenced-code presentation readable on its dark surface by setting an
  explicit plain-text color plus distinct accessible keyword, string, number,
  and comment colors.
- Render final system-design SVGs through the shared interactive diagram
  component. Zoom must survive dashboard rerenders, and the enlarged viewer
  must not depend solely on native browser fullscreen or close the underlying
  reader when Escape is pressed.
- For legacy ignored audio, display the filename and `Local only`. For private
  R2 clips with D1 status `available`, render the authenticated audio player;
  never expose an R2 object key or public bucket URL. When a clip references a
  user transcript turn, place the full player after the preceding specialist
  prompt and immediately before that user's written answer. Keep only clips
  without a turn link in the activity-level fallback tray.
  Consecutive Voice-managed user turns form one logical answer: join their text
  in order and present one segmented player that advances through the original
  clips without merging the R2 objects. Keep each clip's delivery analysis
  attached to its matching segment.

## Data Sources

- Follow `../contracts/specialist-today-controls.md` for specialist catalog,
  Today planning, timer, result, guarded advance, idempotency, and
  authoritative read-back behavior. These MCP tools must reuse the same D1
  mutations and owner-scoped live-update path as the website and Voice.

- Treat `data/daily/YYYY-MM-DD.json` as the canonical daily plan and finalized activity summary.
- Treat `practice/leetcode/bank/questions.json` as user-maintained metadata, not scraped data.
- Treat `practice/system-design/bank/questions.json` and `practice/behavioral/bank/questions.json` as the matching prompt banks.
- A bank question may point to a durable `solutionPath`. The content importer
  hydrates that Markdown into its reusable Solution Profile without turning it
  into a dated Past attempt.
- Treat `practice/*/sessions/*.md` and `audio-answers/*.md` as durable journal artifacts.
- Use the contracts under `docs/contracts/` as the canonical field names.
- Follow `../contracts/live-update-reliability.md` for website, Picture-in-
  Picture, Companion, Voice-facing, and synchronization changes. D1 and REST
  mutations remain authoritative; push is owner-scoped invalidation only.
- `scripts/import-content.mjs` mirrors versioned journals, artifacts, story files,
  and all three banks into the shared D1 content tables. Do not generate or
  commit a TypeScript content bundle.
- D1 is authoritative for owner-scoped timers, outcomes, website-created
  sessions, and extra activities. Browser storage is an offline cache and retry
  queue; versioned daily/artifact files are authoritative for published
  narrative content.
- D1 also owns activity-scoped draft transcript turns, pinned notes,
  specialist finalization bundles, review schedules, the stable specialist-task
  registry, private audio metadata, and per-answer delivery-analysis records.
  These rows are working state—not the
  published journal. Follow `../contracts/durable-practice-publishing.md`.
- Follow the owner-private LeetCode metadata enrichment and preservation rules
  in `../contracts/durable-practice-publishing.md`.
- The Today view uses the current date in `America/Los_Angeles`. If no imported
  manifest exists for that date, render an empty current-day journal and let
  D1 hold the live work instead of falling back to the latest historical day.
- Cloudflare Access identity must be verified in the Worker and passed to app
  routes through the internal trusted header. Hash the normalized email for D1
  ownership; never store raw email or trust a caller-supplied identity header.
- Never send private interview transcripts or local audio to an external service without explicit user authorization.

The website must not imply that browser draft state has already been published to Git. Give the user a file export for transferring timer/outcome data when useful, and label committed artifacts separately from local drafts.

## UX Direction

- Follow the canonical [UI Design Skill Routing](../../AGENTS.md#ui-design-skill-routing)
  rules before designing or redesigning website UI.

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
- Provide Today, Journey, Review Queue, Past, and Problem Banks views without placing every raw log on one page.
- Activity detail should lead with summary, outcome, approach, lessons, and feedback; keep full transcript or code expandable.
- Treat activity detail as a case file: pinned notes first, then facts, review
  date, summary/solution, review, transcript/code, and references. A linked
  delivery recording belongs inline between its specialist prompt and user
  answer. Its observable-evidence delivery review follows the player and stays
  before the written answer; an unlinked legacy recording follows the transcript. Notes apply
  equally to coding, system design, and behavioral.
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
- In the creation flow, search the matching bank first. A pasted public URL in
  any category creates a personal bank question when no canonical URL match
  exists; derive its title from the public path without crawling or scraping
  the page. Continue to accept a custom title for system-design or behavioral
  practice.
- Render the activity picker progressively, expose compact multi-select review,
  result, and difficulty filters, and show the most recent finished result as a
  read-only flag. Keep questions already scheduled on Today visible but
  disabled.
- Keep body and annotation text readable: normal supporting copy should be at least 14px and short utility labels at least 12px.
- Past is a date-grouped scrolling log with category color, filters, a calendar jump control, and a centered reading dialog.
- Problem Banks combines all three versioned banks, offers independent category,
  review, result, notes, difficulty, tag, and starred filters, and sends every
  eligible `Practice today` selection to standalone practice on Today. Its
  result flag reflects the most recent finished attempt; Past keeps the flag of
  each specific attempt.
- Past and Problem Banks use the same four compact controls: result flag,
  canonical star, reusable solution, and Add to Today. The whole card opens its
  reader; nested source links and filter pills retain distinct hover/focus
  affordances and stop card navigation.
- Preserve each tab's selected reader, filters, scroll position, master-list
  visibility, and section state in `sessionStorage`. Explicit close clears only
  that tab's selected reader. Use restrained directional page motion and honor
  `prefers-reduced-motion`.
- A behavioral Problem Bank profile leads with the user's preferred polished
  personal answer, verified evidence, evidence gaps, and expandable alternative
  story variants. Its transcript remains exclusively on the dated Past attempt.
- For imported system-design questions, show the source question link, listed complexity, and whether reference solutions are available.
- For imported behavioral questions, show the expected answer format, frequency, and whether the Bugfree.ai reference may require sign-in. Link to the canonical answer page without copying third-party answer text into the site.
- Journey owns cumulative totals and interactive analytics for coding, system design, behavioral, outcomes, elapsed time, consistency, difficulty, and bank-linked topic coverage. Its separate Career Work panel joins Interview Arc focus time with the privacy-minimized, read-only Job Journey v1 API without copying job records into Interview Arc D1.
- A new session places up to two due reviews ahead of new questions when the
  configured category slots permit it. Failed/full-walkthrough work is due in 4
  days; approach-review work in 7; successful recalls advance to 21 then 60.
- Anchor Journey with a selectable 365-day practice heatmap. Shade only finished coding and mock work; expose failed-attempt counts in the day detail without treating them as solved output.
- Every Journey visualization must disclose the records behind it: heatmap days and trend points select a date, topic bars reveal matching attempts, and effort/outcome points open the activity record. Do not infer mastery, productivity by time of day, or other statistics unsupported by stored evidence.
- Present publication state in user language: `draft` is **Finish to journal**,
  `ready` is **Ready for journal**, and `published` is **In journal**. Finishing
  an already-started stopwatch derives `ready` automatically. Choosing or
  clearing a result never changes completion or publication readiness; the
  publication control is informational rather than a second user decision.

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

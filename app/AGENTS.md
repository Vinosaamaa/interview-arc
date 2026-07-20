# Website Agent Instructions

Before editing website code, read `../docs/agents/website.md` and the shared contracts under `../docs/contracts/`.

- Treat Interview Arc as a journey log and monitoring dashboard.
- Keep LeetCode solving and submission on LeetCode; do not present a fake executable editor.
- Timers must distinguish allocated time from actual elapsed time and survive normal page refreshes when persistence is implemented.
- Preserve keyboard access, visible focus, semantic controls, responsive layouts, and reduced-motion behavior.
- Do not expose local-only audio as a playable deployed URL.
- Keep realistic data in versioned files or durable storage; avoid duplicating canonical enums in components.
- Treat D1 as the durable source for mutable timers, result flags, website-created
  sessions, and extras. Browser storage is only an offline cache/retry queue.
  Versioned daily/artifact files remain the durable narrative source.
- Keep Today, Journey, Past, and Problem Banks as distinct information views; reveal full transcripts and code on demand.
- Show the arrival ritual on every full page entry and keep it visible until the
  user explicitly enters. Choose date-stable artwork and a starting track from
  locally hosted, documented, licensed pools. Sound begins only from a user
  action; expose play/pause, previous/next, playlist selection, licensed source,
  local save, volume, and persistent motion controls. Keep the petal field dense
  and legible over bright and dark surfaces, with reduced-motion support.
- Keep outcome, timer completion, and publication state independent. Only
  `ready` enters the agent queue; `published` is set after an artifact exists.
- Keep Problem Banks question-type and progress filters independent. A finished question must match Past eligibility; failed and planned questions remain to practice.
- Preserve the vinext/Cloudflare Worker architecture, `wrangler.jsonc`, D1
  migrations, and root hosting configuration. The OpenAI Sites configuration
  is legacy and must not be removed without explicit user direction.
- Verify website changes with `pnpm test` and `pnpm lint`; validate migrations
  and content import against local D1 when those paths change.

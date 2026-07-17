# Website Agent Instructions

Before editing website code, read `../docs/agents/website.md` and the shared contracts under `../docs/contracts/`.

- Treat Interview Arc as a journey log and monitoring dashboard.
- Keep LeetCode solving and submission on LeetCode; do not present a fake executable editor.
- Timers must distinguish allocated time from actual elapsed time and survive normal page refreshes when persistence is implemented.
- Preserve keyboard access, visible focus, semantic controls, responsive layouts, and reduced-motion behavior.
- Do not expose local-only audio as a playable deployed URL.
- Keep realistic data in versioned files or durable storage; avoid duplicating canonical enums in components.
- Treat browser state as an unpublished local draft and versioned daily/artifact files as the durable source.
- Keep Today, Journey, Practice Library, and Story Bank as distinct information views; reveal full transcripts and code on demand.
- Preserve the vinext/Sites build architecture and root hosting configuration.
- Verify website changes with `pnpm build`; also run `pnpm lint` for TypeScript or JavaScript changes.

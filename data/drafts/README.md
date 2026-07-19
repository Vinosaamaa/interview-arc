# Local Website Draft Handoff

This folder is the standard bridge between the deployed website and the specialist Codex tasks. The JSON files themselves are local-only and ignored by Git.

## Publish A Day Of LeetCode Work

1. On Today, set each coding problem's result flag and finish or pause its stopwatch as appropriate.
2. Click `Export today`.
3. Move the downloaded file here without renaming it: `journal-YYYY-MM-DD-draft.json`. Attaching the same file directly to the LeetCode task also works.
4. In the LeetCode task, say `Publish today's LeetCode`.

The task reads `publishQueueActivityIds` and generates an original solution artifact for every queued coding problem. It preserves the website's result and elapsed time. It does not need a prior chat about each problem and it cannot infer missing browser state.

System-design and behavioral tasks may use the same export for timing and completion metadata, while their published artifacts continue to come from the mock-interview conversation they observed.

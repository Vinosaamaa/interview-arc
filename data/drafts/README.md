# Local Website Draft Handoff

This folder is the standard bridge between the deployed website and the specialist Codex tasks. The JSON files themselves are local-only and ignored by Git.

## Publish LeetCode Work

1. On Today, set each coding problem's result flag and finish or pause its stopwatch as appropriate.
2. Click `Export today` when the MCP bridge is unavailable.
3. Move each downloaded date file here without renaming it:
   `journal-YYYY-MM-DD-draft.json`. Attaching the files directly to the LeetCode
   task also works.
4. In the LeetCode task, say `Publish today's LeetCode`.

The task normally reads the authenticated MCP publication queue, which groups
ready work by Pacific completion date. A problem begun before midnight and
finished after midnight belongs to the later date, while retaining its exact
start/end timestamps and session ID. The exported schema-v5 fallback exposes
the same information through `publishQueueByDate` and
`publishQueueActivityIds`.

The task generates an original solution artifact for every queued coding
problem. It preserves the website's result, elapsed time, exact timestamps, and
session membership. It does not need a prior chat about each problem and it
cannot infer missing browser state.

System-design and behavioral tasks may use the same export for timing and completion metadata, while their published artifacts continue to come from the mock-interview conversation they observed.

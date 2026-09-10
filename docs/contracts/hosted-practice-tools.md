# Hosted practice tools across agents

The same owner-scoped LeetCode and draft tools are available at `/mcp` with
the existing Arc integration token and `/chatgpt/mcp` with ChatGPT OAuth.
The implementation lives in `mcp-worker/`; Cloudflare runs it. A Mac process
is not required for these operations. Never copy credentials into the repo,
chat, a code file or command arguments.

The checked-in `.codex/config.toml` configures Codex desktop, CLI and IDE in
trusted project sessions. It names `INTERVIEW_ARC_MCP_TOKEN`; the host must
provide that existing private credential. Opening a folder is not a universal
MCP installation mechanism: other clients must load the equivalent Streamable
HTTP URL and bearer authentication through their own settings. An agent that
cannot load MCP keeps the supported browser/controller flow.

## Coding

Prefer `get_leetcode_problem`, `get_leetcode_submission` and
`get_leetcode_editorial` over browser setup. Read only the selected problem or
owner-requested submission; do not bulk-crawl. Check `get_leetcode_connection`
when access fails; reconnect through the private Arc form. A tool failure does
not authorize bypassing LeetCode restrictions or extracting cookies.

`open_coding_editor` returns the original statement, Java/Python starter,
private draft identity and an MCP Apps resource. A compatible UI host renders
the panel. Protocol/tool support alone does not prove an editable iframe is
available in every desktop app. Report the actual host result and use a local
source editor or browser canvas when the host cannot render it. CLI agents can
still call all read/save/submit tools without displaying the UI.

Every draft response includes an authenticated `browserUrl`. In Codex desktop,
open that URL in the app's browser pane when inline rendering is unavailable.
It hosts the same editor and saves to the same owner-scoped draft. The owner
then asks the agent to review; the agent reads the draft directly. The browser
pane does not independently send chat messages or submit code. To change its
language, ask the agent to open that language's draft. No Mac server is needed.

For CLI/local-file editing, retain the existing single evolving source and
local harness. Read its exact bytes, save them with `save_coding_draft`, verify
the returned hash/revision, and review that source. Do not overwrite either
side silently if both the local file and remote draft changed. Only the user's
submit request authorizes `submit_coding_draft`. Poll its operation receipt;
pending or uncertain is never Accepted. Do not fall back to another transport
and resend after an uncertain submission. A fresh corrected revision requires
a separate explicit submission request.

Timers, mode, code-attempt review parity, transcript capture, outcomes and
publication retain their existing contracts. Draft saves do not count as
published attempts. Official editorial research must be completely read with
its hash/paging guard, attributed, and summarized independently. No credentials,
raw protected editorial or private code goes into Git.

## Drawing

The `arc_excalidraw` connection uses `/mcp?surface=excalidraw` with the same
private bearer environment variable. ChatGPT uses the OAuth counterpart.
The official Excalidraw renderer/checkpoints remain upstream; Arc repairs the
encrypted export operation. Read `read_me` before creating a view. CLI tools
can create/read/export scenes, but a terminal does not become an editable
canvas. The existing local canvas controller remains the CLI drawing fallback.

When the host renders the MCP canvas, the user can edit there and export a
snapshot. An exported URL is a snapshot, not ongoing synchronization. Save the
actual exported scene through `save_practice_drawing` after the activity is
complete and verify `get_practice_drawing`. Keep user drawings distinct from
assistant references. Remote MCP checkpoints and Arc website-native activity
checkpoints are separate stores; never claim that one automatically saved the
other. Missing owner assets remain missing, or explicitly deferred under the
completion contract.

## Capability evidence

[Official Codex MCP documentation](https://developers.openai.com/codex/mcp)
documents desktop/CLI/IDE shared project configuration and Streamable HTTP
authentication. [The MCP UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
documents ChatGPT's MCP Apps iframe and reusable UI across compatible hosts.
These establish protocol portability, not a verified rendering result for a
specific installed client. Actual host acceptance belongs in the release
receipt. Checked 2026-09-10.

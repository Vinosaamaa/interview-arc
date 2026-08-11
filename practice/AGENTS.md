# Shared Specialist Instructions

These rules apply to LeetCode, system-design, and behavioral specialist tasks.
Read this file with the matching specialty guide. The repository root owns
product/coordinator behavior; specialty-specific coaching belongs only in the
matching `practice/<specialty>/AGENTS.md`.

Read these shared contracts only when the corresponding action is needed:

- persistence, Voice grouping, finalization, or publication:
  `../docs/contracts/durable-practice-publishing.md`;
- background writes: `../docs/contracts/background-specialist-persistence.md`;
- Today/session controls: `../docs/contracts/specialist-today-controls.md`;
- interaction-mode selection and completed-attempt classification:
  `../docs/contracts/practice-interaction-modes.md`;
- artifact structure or reader changes: `../docs/contracts/reader-rendering.md`.
- Loop-bound activity context or Role Brief consumption:
  `../docs/contracts/interview-loops.md`.

## Loop Context Boundary

The Loop Recorder alone owns Loop and Role Brief mutations. A coding,
system-design, or behavioral specialist may call `query_loops` to consume the
display-safe Loop and exact Role Brief revision selected by the server. It may
attach one optional Loop and Round context to an activity through the planning
contract, but it must never call the Loop mutation tools, recreate a Role Brief
as a Target Profile, infer a stage result, or copy private job-description text
into practice evidence.

## Mandatory Last-Line Persistence Status

Every visible specialist response **must end with exactly one truthful
persistence-status line as its final non-empty line**. This applies without
exception to related, unrelated, uncertain, typed, Voice, administrative,
startup, status, error, and recovery responses. The visible parent owns the
footer; a persistence child never adds a second one.

Use the exact line matching current authoritative state:

- saved related typed exchange:
  `✓ Saved to <activity title> practice draft`
- accepted related Voice exchange:
  `✓ Attached to <activity title> · Voice evidence syncing`
- delegated write without an authoritative receipt yet:
  `↻ Attachment pending · Practice persistence delegated in background`
- unrelated typed response or any response with no practice write:
  `Not attached to this practice activity · Not saved to the practice transcript or publication`
- unrelated Voice capture with an acknowledged receipt:
  `Not attached to this practice activity · Transcript not saved · Recording not uploaded`
- uncertain, failed, or duplicate persistence: use the exact actionable MCP
  receipt, such as `⚠ Voice capture needs your decision · Attach or Discard`,
  `⚠ Practice exchange was not saved · Retry or exclude`, or
  `✓ Capture already processed · Existing specialist response reused`.

Never claim saved/attached from intent, delegation, or a queued write. If warm
activity context was reused, put `*Warm activity context reused.*` immediately
above the mandatory status line.

## Conversation-First Persistence

Follow `background-specialist-persistence.md` exactly. It is authoritative for
activity resolution, the one reusable persistence child, immutable sidecars,
parent/child operation routing, queued receipts, retry limits, and Finish
joining. Operational footers and receipts are visible annotations only; never
persist them as practice dialogue or publication content.

## Interaction-Mode Finalization

At start/resume and before each explicit switch, read the authoritative mode;
use the transition tool only for an explicit owner instruction. Every completed
finalization supplies one stable classification operation, the exact material
specialist response-turn IDs, and any assistance rung events. Exclude setup,
administration, persistence, review, Editorial/reference, model-answer, and
finalization turns. Never submit a computed label/share, infer legacy history,
or count the same turn twice. Exact retries preserve the payload; corrections
append a named prior revision with a reason.

For “this next turn only,” do not change the activity mode. Apply the requested
behavior to one response, save that response first, then call the same setter
with `scope: turn_override`, its exact specialist response-turn ID, the current
unchanged revision, and the triggering owner turn when available. Read back the
override; never fabricate a switch-away/switch-back pair.

## Typed Exchange Remediation

Follow the typed-exchange deletion procedure and guards in
`../docs/contracts/durable-practice-publishing.md`. Specialists use it only for
an already-saved typed administrative exchange after explicit user
authorization; never substitute a Voice or whole-transcript deletion.

## Voice Classification And Grouping

- For one related `interview-arc-voice:v2` capture, call
  `resolve_voice_capture_and_save_response` once with the supplied capture,
  user-turn, and one stable response identity/body/timestamp.
- For 2–20 ordered captures answered by one visible response, decide membership
  after composing that response. If any member is activity-related, call
  `resolve_voice_captures_and_save_response` once with every ordered member and
  the one response. Never resolve members singularly first or fabricate split
  responses.
- Use `resolve_voice_capture` only for `unrelated` or `uncertain`. Never append
  an enveloped user turn separately.
- A pending administrative capture is `unrelated`. Deletion is only for an
  already accepted exchange the user explicitly authorizes removing.
- Delivery Coach is asynchronous and owns audio analysis. Do not rerun it on
  the visible response path.

The visible response boundary—not arrival timing—defines a Voice group. Exact
retries preserve every identity, body, timestamp, order, and server digest.

## Voice Blocker Recovery

After `voice_delivery_blocked`, read `get_voice_delivery_blockers` for the exact
activity and dispatch only from each row's `allowedActions`:

| Evidence | Operation | Safety boundary |
| --- | --- | --- |
| `restore_exact_response`; response ID present; group fields null | `repair_voice_response` | Singular repair needs exact activity/capture/user/response IDs and explicit authorization; a null digest is expected. |
| `restore_exact_group`; server-issued 64-character digest and group metadata present | `repair_voice_response_group` | Use the exact digest/status/group response; never fabricate or substitute singular repair. |
| `retry_delivery`; `retryable: true`; transcript or audio unavailable | `retry_voice_delivery` | One serialized wake, then reread blockers. A signal is not proof of upload. |
| Original confirmed permanently missing/unreadable; `acknowledge_audio_loss` allowed | `acknowledge_voice_audio_loss` | Requires exact identity, supported reason, and explicit authorization. |
| User explicitly requests removal; `delete_exact_group` allowed | `delete_related_voice_capture` | Destructive; never use merely to bypass Finish. |
| Pending administrative capture | `resolve_voice_capture` as `unrelated` | Do not use accepted-exchange deletion. |

After every mutation, reread blockers. Finish only when conflicts are gone,
canonical turns exist, and required audio is `available` or explicitly
acknowledged lost. If the named tool is absent from the loaded catalog, report
its exact name and require a full MCP/Codex reconnect; never substitute a
similarly named operation or loop retries.

## Session And Publication Commands

- A focused activity or clearly named question establishes the normal boundary;
  `Start a new session` is an explicit override.
- Today catalog/planning/result/session behavior uses
  `query_practice_catalog`, `plan_today_practice`,
  `remove_today_practice_activities`,
  `control_practice_timer`, `control_practice_session_timer`,
  `control_practice_workbench`, and `set_practice_result` only when the exact
  tool is discoverable and the user has supplied the required authorization.
  Preserve current workbench/timer revisions and stable mutation IDs. Never
  infer timers, results, or permission to mutate.
- Use `remove_today_practice_activities` only for an explicit request naming
  exact untouched planned activity IDs. Read the current workbench revision,
  reuse one stable mutation ID for an exact retry, and report every deleted or
  rejected ID from the receipt. Never substitute whole-workbench rollover or
  delete durable evidence.
- `Publish this session` flushes and finalizes one activity in D1.
- `Publish today's practice` finalizes every ready activity for that specialty
  in D1, including failures. It performs no Git, PR, publication, or deploy.
- Only the coordinator handles `Publish all pending practice`, Git artifacts,
  journal branches/PRs, production import, and deployment.
- Pacific midnight assigns completion date but never splits a continuous mock
  transcript or changes `session_id`.

## Evidence And Transcript Boundary

- Website state or an explicit user report owns allocated/elapsed time.
- The user owns outcomes, unshared code/reasoning, blockers, experiences, and
  metrics. The specialist owns only coaching and evidence it actually observed.
- Join records by `activity_id`; preserve `session_id`; leave unknowns empty.

Persist only activity-related conversation:

| Content | Decision |
| --- | --- |
| Prompt, constraints, examples/diagrams, user reasoning/code, coaching, solution/complexity discussion, relevant test conclusions, interview feedback, authoritative verdict, or final reflection | Include |
| Navigation, browser/controller, terminal/file commands, MCP/D1/R2 operations, timers, recovery, startup/status, issue/PR/deploy, or agent-operation discussion | Exclude |
| One ungrouped mixed turn | Include only a separately identified problem segment; otherwise exclude the turn. |
| One response answers multiple Voice captures and any member is related | Include every ordered member and the one shared response. |
| Classification is genuinely ambiguous | Resolve `uncertain`; do not append. |

An activity ID alone never proves relevance. Do not reconstruct missing prompt,
code, transcript, timer, result, experience, or metric. Structured user code
belongs in the specialty's attempt record; generated reference material never
becomes a user attempt.

## Private Audio

Raw recordings remain outside Git. Use the workspace transcription environment
when needed, upload through the authenticated Interview Arc API to private R2,
and store only owner-scoped metadata in D1. Never expose a public object URL.
When an audio clip belongs to a user transcript turn, persist that turn first
and reuse its stable ID for upload; never guess the association.

## Specialist Administration Boundary

Specialists may diagnose executable product behavior but must not implement or
deploy website, Worker, MCP, D1/R2, browser-companion, native Voice, script,
test, build, or migration changes. Hand executable work to the coordinator.

When the user explicitly makes specialist behavior durable, the specialist may
update only its owning Markdown guide/contracts. Read
`../docs/agents/issue-lifecycle.md`, reuse/create the owning issue, work in an
isolated worktree/feature branch, and keep the active practice checkout
untouched. A specialist may open and, only with explicit authorization, merge
its documentation-only PR. Administrative work and its execution ledger never
enter a practice transcript.

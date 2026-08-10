# Practice Interaction Modes

## Registry

`data/interaction-modes.json` is the versioned, Git-backed registry for practice
interaction modes. Runtime code validates stable text IDs against that registry;
D1 does not encode the production modes as an enum. The initial canonical IDs
are `interviewer`, `mentor`, and `grill`. Aliases normalize to one canonical ID
and are never persisted as additional modes.

Unknown historical IDs remain readable as unknown. Deprecated IDs may remain in
history but cannot be newly selected. Specialty and lifecycle-phase support are
registry data, so a deliberate future registry entry does not require a D1
migration.

## Owner-scoped state

One activity may have one current state and an ordered immutable transition
timeline. Every current-state, transition, and mutation-receipt row is keyed by
the authenticated opaque owner ID and exact activity ID. A missing row means
`needs_selection`; it must not be backfilled or displayed as Interviewer.

The first explicit selection transitions from unknown at revision 0 to the
selected canonical mode at revision 1. Each later accepted transition increments
the state revision once. Current state, transition, and receipt commit in one D1
transaction or none commit.

An optional trigger turn is only a reference. It must already be an owner-scoped
**user** turn in the same activity; a specialist turn cannot authorize its own
mode change. Persisting a mode transition never appends or copies Voice-managed
transcript text.

## MCP boundary

- `get_practice_interaction_mode` reads the registry, owner-scoped activity
  identity, current state/revision, and the latest 100 transitions in
  chronological order. Its `transitionHistory` metadata reports the limit,
  returned revision range, and whether older history was truncated.
- `set_practice_interaction_mode` performs one explicit activity-scoped
  transition or exact specialist-turn override. It requires `expectedRevision`,
  stable `mutationId`, occurrence time, source, reason, and
  `authorization: explicit_user_instruction`. A turn override additionally
  names the already-saved specialist response turn; it records that response's
  effective mode without changing the activity current mode or revision.

The setter accepts a canonical ID or documented alias and fingerprints the
normalized canonical request. An exact retry returns the original receipt plus
fresh authoritative state without another transition. The same mutation ID with
changed canonical content is an identity conflict. A stale revision, invalid
trigger turn, unknown/deprecated mode, unsupported specialty, or unavailable
phase changes no state.

Structured failures expose stable public codes and bounded reconciliation
metadata only. They never echo raw D1/SQL errors, query text, schema details,
transcript content, or other internal failure causes.

D1 is authoritative. After commit, the Worker emits an owner-scoped `practice`
invalidation so connected surfaces reread; push is never the mutation receipt.
MCP catalogs are connection-scoped, so a specialist reconnect is required after
deployment before these tools become discoverable.

## Completed-attempt classification

Every new completed specialist finalization includes one immutable
interaction-mode classification sidecar. The specialist supplies a stable
classification operation ID, the exact material specialist turn IDs, recorded
assistance events, and whether the selection is recorded or explicitly
reconstructed. D1 resolves those identities against the owner-scoped activity
and computes the result; callers never submit the label or percentages.

Material turns are only the specialist responses that shaped the live attempt.
Exclude setup, administration, persistence footers, review, Editorial/reference
explanations, model answers, and finalization prose. User turns remain visible
in the transcript but never count as specialist assistance. Each specialist
turn is rendered against the authoritative mode transition active at its
occurrence time.

For “this next turn only,” apply the requested behavior immediately, save the
canonical response, then persist `scope: turn_override` with that exact
specialist `responseTurnId` and the triggering owner user turn when available.
Do not simulate a turn override with two activity transitions. The immutable
override is resolved before classification; if a material turn has an override,
classification uses the specialist-turn method rather than pretending the
whole timer segment changed mode.

Classification prefers active timer seconds when complete timer intervals and
mode coverage exist. Otherwise it uses the exact material specialist-turn
share. A mode is primary at **60% or greater**; `59/41` is `mixed`, while
`60/40` is primary. Mentor assistance and the highest hint rung are recorded
independently, so a primarily Interviewer attempt can still truthfully show
Mentor assistance.

Snapshots are append-only. An exact operation retry returns the prior snapshot;
changed payload under the same operation fails. A later correction must name
the latest snapshot revision and give a reason. Past exposes the primary chip,
assistance chip, proportion ribbon, transition dividers, mode-colored specialist
rails, filters, and a dedicated Practice mode section separate from Conversation
and Review. Legacy or insufficiently covered attempts display `Mode not
recorded`; no transcript guess or fabricated backfill is allowed.

## Delivery boundary

This contract covers registry/state transitions, Today selection, immutable
finalization classification, and Past presentation. A future mode remains a
registry addition, not a schema-enum migration.

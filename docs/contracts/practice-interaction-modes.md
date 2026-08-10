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
  transition. It requires `expectedRevision`, stable `mutationId`, occurrence
  time, source, reason, and `authorization: explicit_user_instruction`.

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

## Delivery boundary

This contract currently covers the registry and activity-scoped D1/MCP
transition tracer from #219. Today selector/reconciliation and specialist turn
overrides, help behavior, assistance accounting, finalization, Past
classification, reader treatment, and conservative legacy reconstruction remain
the later slices owned by #210.

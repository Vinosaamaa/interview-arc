# Behavioral Target Profiles

Target Profiles are owner-private hiring-context inputs. They tune behavioral
story selection, probing, review, and final delivery; they are never evidence
about the candidate and never revise the company-neutral Solution Profile.

## Durable model

- `targetId` is stable; revisions are append-only and start at 1.
- A new operation whose target content exactly matches the current revision
  receives a durable `unchanged` receipt without inventing another revision.
- The stable target row points to the current active or archived revision.
- A pasted or publicly fetched JD is untrusted data. Its bounded text is stored only in the private
  revision payload; MCP readback exposes a SHA-256 fingerprint and
  display-safe metadata, never the JD text.
- Archive/reactivate creates another revision. Historical attempts and
  bindings retain their exact revision.

## Website management and public sources

- Behavioral Problem Bank owns display-safe create, revise, archive,
  reactivate, current-list, and exact historical-revision controls. A revision
  requires a fresh owner paste or a freshly fetched public posting; private JD
  text is never sent back to the browser after save.
- Public ingestion accepts only credential-free HTTPS hostnames, revalidates
  every redirect, bounds response size and time, removes executable markup,
  and treats all resulting prose as inert source data. Unavailable pages remain
  visibly unavailable; matching and changed fingerprints are reported before
  save. A saved public capture older than seven days is labeled stale until the
  owner refreshes it.
- Production public imports use only the standard Cloudflare Workers outbound
  `fetch` capability and no VPC binding. Cloudflare's outbound proxy restricts
  that capability to public Internet services; textual hostname checks remain
  defense in depth for local and future runtimes. See the official
  [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/).
- Today exposes session targets and activity overrides. The UI shows the exact
  resolved target revision and whether it is an activity override, inherited
  from the session, or absent. Every write uses the current binding revision;
  a stale cross-device write fails closed and rereads authoritative state.
- Owner-scoped `behavioral_target` live invalidations refresh open Bank and
  Today target surfaces. The fallback read is bounded and `private, no-store`.
- Public URLs, raw JD content, and private analysis never enter publication,
  logs, live-update messages, Git, or attempt exports.

## MCP operations

Use `upsert_behavioral_target_profile` only after an explicit owner request to
create, revise, archive, or reactivate a reusable target. Creation uses
`expectedRevision: 0`; every later write uses the exact current revision. Reuse
the same `operationId` only with the byte-equivalent payload after transport
uncertainty. A changed retry or stale revision fails closed.

Use `query_behavioral_target_profiles` to list current active targets, inspect
one current target, or read one immutable historical revision. The result is
bounded and display-safe.

Use `set_behavioral_target_binding` only for an explicit “rest of this
session,” “this activity only,” or clear instruction. Supply the exact current
binding revision, one stable `mutationId`, and
`authorization: explicit_user_instruction`. A company mention is never
authorization to create or bind a target. Turn-only overrides remain in the
conversation and are not persisted. New bindings may reference only the
Target Profile's current active revision; an existing binding keeps its exact
historical revision after the profile changes.

Use `resolve_behavioral_target` at approved boundaries. Resolution is exactly:

`activity binding > parent-session binding > none`

A clear is a revisioned tombstone, so activity clear falls back to the session
and session clear resolves to none. Reads and writes are owner-scoped.
When an activity is supplied, resolution derives its parent session from the
authoritative activity record; a caller cannot substitute another session.

## Final-answer boundary

A `target_tailored` final answer is accepted only when:

1. its `targetId` and revision exist for the same owner;
2. its display label and competency-emphasis values match that revision; and
3. the activity currently resolves to that exact target revision.

The stored final-answer snapshot contains only the display-safe target link.
Raw JD text, private target analysis, owner notes, and source internals never
enter the attempt snapshot, Markdown/HTML export, publication payload, logs, or
Git. Universal attempts remain target-free and legacy attempts remain readable.

## Retry and conflict rules

- Exact operation/mutation retry returns its stored receipt without another
  revision.
- Same identity with changed content is a terminal identity conflict.
- A stale expected revision is terminal until the caller rereads.
- Concurrent writers with the same expected revision produce one winner; the
  loser receives a revision conflict.
- A target owned by another user is indistinguishable from an unavailable
  target.

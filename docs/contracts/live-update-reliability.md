# Live Update Reliability Contract

Interview Arc keeps REST mutations and owner-scoped D1 rows authoritative.
Server push is an invalidation signal, never a second mutation channel and never
a replacement database.

## Shared owner stream

- `limitless` owns `OwnerLiveUpdateHub`, a Durable Object keyed only by the
  resolved opaque owner ID.
- The website connects through its Access-authenticated
  `/api/live-events` route.
- Companion and Voice connect through the integration-token-authenticated
  `limitless-mcp /events` route.
- A committed mutation emits one compact `practice_changed` envelope containing
  a monotonically increasing owner revision, scope, and occurrence time.
- Clients discard invalid or stale revisions and then read the appropriate REST
  projection. No transcript, token, note, code, or audio content travels in a
  push envelope.
- Website clients reconcile `timer` scope through the compact timer projection.
  Every other scope reconciles the full authoritative practice projection so
  Voice- or Companion-originated session, activity, focus-block, workbench, and
  publication changes cannot leave an already-open Today view structurally
  stale.
- Event publication is best effort after the authoritative mutation commits.
  A hub outage must never turn a successful D1 mutation into a client-visible
  failure; bounded snapshot recovery closes that gap.

## Connection and fallback

While the WebSocket is healthy, clients make no recurring synchronization HTTP
requests. Local one-second clocks may continue to repaint elapsed time without
network traffic.

After disconnection, clients reconnect with bounded backoff and use a bounded
REST fallback beginning at 15 seconds, doubling to a maximum of 120 seconds.
Visibility, wake, tab-navigation, and explicit user actions may still trigger
immediate reads.

## Voice capture lifecycle

The local capture record is written before server registration. Reconciliation
reads server intent status first and registers only capture IDs not known by the
server. Status discovery is owner-scoped and cursor-paginated rather than a URL
containing every retained local UUID. Registration is idempotent for an
identical immutable identity.
Reusing a capture ID with different activity, turn, clip, or checksum identity
returns a structured, non-retryable conflict.

A specialist decision may arrive from the visible Voice v2 envelope before
background registration. The Worker retains a 24-hour identity-only deferred
decision keyed by owner and capture. Registration validates activity and turn
identity before applying it. No deferred row contains transcript or audio.

Only `activity_related` captures may persist a transcript turn and private R2
audio. `unrelated` and `uncertain` captures remain outside both. Retries use
stable capture, turn, and clip IDs. Deletion fences content upload and remains
idempotent; upload revalidates accepted state after its R2 write and removes a
late object if deletion won the race.

Pending-capture recovery and detailed status belong in the Voice menu-bar
popover. The floating widget exposes only ordinary recording and previous-memo
actions.

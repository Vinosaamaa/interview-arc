# Live synchronization polling and Voice retry storm

## Summary

Interview Arc clients independently polled live practice state every second.
Voice also retried local capture registration before checking whether the
server already knew the capture. Together these paths produced unnecessary
Worker/D1 traffic and repeated non-retryable registration conflicts, eventually
exhausting the Cloudflare daily Worker allowance.

This was a cross-repository reliability incident coordinated by
`interview-arc#89` and `interview-arc-voice#64`.

## User impact

- Website, Picture-in-Picture, Companion, and Voice could display delayed or
  inconsistent timer state when the Worker allowance was exhausted.
- Voice could repeatedly send a registration request that could never succeed.
- Companion recovery became unavailable while the Worker was exhausted.
- The Voice v2 gate still protected unrelated content: the diagnosed unrelated
  capture created no activity transcript turn and no R2 object.

## Detection

The user received Cloudflare's daily-limit notification. Source inspection then
found unconditional one-second reads in all four clients and a Voice
reconciliation loop that registered every local capture before reading its
server status.

## Root cause

Live synchronization evolved independently in each client. Polling was treated
as a harmless display refresh rather than shared production load, so there was
no owner-scoped invalidation contract or aggregate request budget.

Voice v2 made the local capture durable before network work, but its reconciler
did not model registration as a state transition. It attempted registration on
every pass, including after the server had already accepted or classified the
same stable identity. A legitimate conflict was therefore treated as
indefinitely retryable.

## Resolution

- Added an owner-scoped Durable Object WebSocket hub with compact monotonic
  invalidation events.
- Retained REST mutation endpoints and D1 as the only source of truth.
- Replaced unconditional polling with server push plus 15–120 second bounded
  fallback while disconnected.
- Made capture registration status-first and idempotent for an identical stable
  identity.
- Added a structured non-retryable conflict for immutable identity mismatch.
- Added a 24-hour identity-only deferred decision to close the
  specialist-decision-before-registration race.
- Added cursor-paginated owner intent status, finite local retention, explicit
  waiting/retry/conflict states, and post-R2 deletion revalidation.
- Made push publication best effort so an invalidation outage cannot falsify
  the result of an already-committed REST mutation.
- Added regression coverage for push configuration, zero healthy polling,
  bounded fallback, status-first Voice reconciliation, deferred decisions,
  terminal conflicts, and deletion fencing.

## Prevention and follow-up

- Keep `docs/contracts/live-update-reliability.md` authoritative for every live
  client.
- Validate website, PiP, Companion, and Voice simultaneously before resolving
  either issue.
- Measure requests during production acceptance and preserve the result in both
  issue resolution records.
- Do not close either issue on merge alone; deployed Workers, the reloaded
  Companion, and the exact installed Voice artifact are required.

## Timeline

- 2026-07-26: Cloudflare daily-limit exhaustion and stale cross-client behavior
  were reported.
- 2026-07-26: The paired main/Voice issues were linked and escalated to the
  Reliability lane.
- 2026-07-26: Source inspection identified four one-second polling loops and
  status-blind capture registration retries.
- 2026-07-26: Server-push, bounded-fallback, and status-first contracts were
  implemented with regression coverage.

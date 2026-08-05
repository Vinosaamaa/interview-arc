# Postmortem: Voice response-group delivery retry conflict

**Date:** 2026-08-04  
**Status:** In review  
**Severity:** Reliability / user-work blocked  
**Tracking:** [interview-arc#157](https://github.com/Vinosaamaa/interview-arc/issues/157),
[server PR #159](https://github.com/Vinosaamaa/interview-arc/pull/159), paired with
[interview-arc-voice#64](https://github.com/Vinosaamaa/interview-arc-voice/issues/64)
and [native PR #171](https://github.com/Vinosaamaa/interview-arc-voice/pull/171)

## Executive summary

A three-capture Voice response group was durably reserved, but the native
client did not finish delivering the canonical exchange. The client retried
more than fifty times because its delivery catch treated every failure as
transient. During recovery, a replay assembled with a different nearby
specialist response caused the server to quarantine the previously stored
canonical group. Activity Finish correctly refused to close because the
canonical transcript graph was incomplete, but its count-only error did not
identify the blocked group or a safe repair action.

No transcript or audio was silently published. The local client retained the
recordings. The user explicitly authorized deletion of the two exact corrupted
three-member groups, after which the activity was closed as solved with help.
Permanent server deletion is not recoverable from Interview Arc.

## Impact

- One active practice activity could not finish through the normal guard.
- Six exact captures across two corrupted groups required explicit cleanup.
- Repeated native retries consumed requests and user/agent time without any
  possibility of converging.
- Recovery initially required a REST fallback because the MCP delete policy
  rejected the quarantined state.
- The separate Code Attempt/503 persistence incident remains tracked outside
  this postmortem.

## Evidence and timeline

- A canonical multi-capture reservation existed while its user/response turns
  were not fully materialized.
- Native records remained `accepted_delivering` with retry counts of at least
  55.
- Source inspection showed the delivery path erased the server's error code
  and retryability and stored `transient_delivery_failure` for every failure.
- Source inspection showed a mismatched replay called the quarantine mutation
  because of caller input rather than contradictory stored evidence.
- Exact MCP deletion rejected `quarantined_conflict`, while the authenticated
  REST deletion graph could safely fence it.
- After explicit user authorization, both exact groups were deleted and the
  Finish guard passed.

Exact production identities, transcript text, audio, credentials, and owner
information are intentionally excluded.

## Root cause

### Server

The comparison path conflated a non-exact caller retry with contradictory
stored durable rows. Only the latter justifies quarantine. The former must be
a non-destructive conflict returning the first canonical receipt.

### Native client

Delivery reconciliation caught all errors uniformly. Although the API client
already decoded `code` and `retryable`, the catch erased both, incremented a
global attempt counter, and scheduled another retry. Delay had a one-hour cap
but no attempt or elapsed-time circuit breaker.

### Recovery surface

Finish returned aggregate counts. There was no exact blocker read or audited
restore operation, and the MCP catalog offered no safe repair route.

## Contributing conditions

- Tests covered exact replay and conflict independently, but not
  mismatch-followed-by-exact-retry.
- Delivery was modeled as one operation rather than persisted transcript,
  audio, and coaching stages.
- Wake, relaunch, live events, and safety reconciliation could all re-enter the
  same impossible request.
- Quarantined exact deletion was absent from remediation policy.

## Resolution being implemented

- Stable owner-scoped canonical group receipts and idempotent exact replay.
- Non-destructive structured conflict for non-exact retries.
- Exact blocker diagnostics plus digest-fenced audited repair.
- Fenced deletion for quarantined groups and structured Finish details.
- Native staged receipts, exact error classification, bounded retries, a
  `needs_attention` circuit breaker, and one-shot manual Retry.

## Verification required before resolution

- Local D1 tests for replay, mismatch, owner scope, repair, deletion,
  out-of-order delivery, and Finish blockers.
- Swift/CI tests for transient 503 recovery, permanent 409 termination,
  relaunch at each stage, retry exhaustion, and one-shot manual Retry.
- Worker-first deployment, MCP reconnect/discovery, then the exact signed
  native artifact with disposable fixed identities.
- Concurrent Companion/Voice smoke testing and exact fixture cleanup.

## Rollback

Disable only the new repair mutation if necessary while retaining blocker reads
and non-destructive comparison. Roll back the native artifact without deleting
protected local records. Never destructively reverse the migration.

## Action items

- `interview-arc#157`: server receipt, conflict, blocker, repair, Finish, and
  catalog work.
- `interview-arc-voice#64`: staged delivery, bounded retry, and recovery UI.
- `interview-arc#158`: separate transient Worker/503 persistence work.

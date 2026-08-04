# Specialist MCP writes returned HTTP 503 / Cloudflare 1102

## Summary

On 2026-08-04, owner-scoped specialist writes intermittently failed through
the production MCP bridge. Confirmed examples included personal-bank upserts
and a structured LeetCode Code Attempt. The HTTP response was 503 and
Cloudflare reported error 1102 / `exceededCpu`. The health route continued to
return 200. Exact bank retries later succeeded without duplicates, while the
failed Code Attempt correctly left no partial row.

This was a reliability incident because a specialist could deliver useful
coaching while its durable evidence was not saved. Manual retries repeated the
same expensive synchronous MCP path and therefore could hit the same CPU
failure again.

## Impact

- Specialists could not reliably save Code Attempts or add several private
  bank questions.
- A transport error did not provide a durable receipt indicating whether the
  logical write had been accepted for later execution.
- Repeated manual calls consumed more Worker capacity without guaranteeing
  progress.
- Finalization correctly remained authoritative: absent Code Attempt evidence
  was not silently treated as saved.

## Detection and evidence

- Production MCP calls returned HTTP 503 and Cloudflare error 1102.
- `wrangler tail` classified affected `POST /mcp` invocations as
  `outcome: exceededCpu`.
- `/health` remained available, distinguishing the incident from a complete
  service outage.
- Stable personal-bank retries later resolved to one row per canonical ID.
- D1 inspection found no partial Code Attempt from the failed request.

Background Voice traffic was present during the incident and may have
contributed to total load, but available evidence does not prove it was the
sole cause. Issues #157 and `interview-arc-voice#64` own the related Voice
repair and client-load work.

## Root cause

The MCP tool handlers performed validation and the entire D1 mutation
synchronously inside the request that also authenticated and registered the
full MCP tool catalog. When the invocation exceeded its Cloudflare CPU budget,
the platform terminated it before a durable success/failure receipt existed.
Retrying invoked the same path again, so retry was not a recovery boundary.

The MCP SDK requires a new connected `McpServer` per request, so caching a
connected server is not a supported repair. The avoidable coupling was between
the request and the expensive durable mutation.

## Repair

Issue #158 introduces an owner-scoped D1 write outbox:

1. MCP reserves a stable operation ID plus canonical payload digest in a small
   durable transaction and immediately returns a receipt.
2. Exact retries return the existing receipt; changed payload under the same
   identity is rejected as nonretryable.
3. A best-effort `waitUntil` executor may complete the job immediately.
4. A one-minute scheduled executor claims due jobs with a lease, recovers
   expired leases, and performs bounded exponential retry with jitter for
   502/503/504, 1102, timeouts, resets, and transport failures.
5. Validation and identity conflicts fail immediately and are never retried.
6. Specialists inspect per-operation status; only `saved` is authoritative.

Logs contain operation class, state, attempt counts, duration, and a short
payload-hash prefix. They intentionally omit owner IDs, activity IDs, code,
transcripts, question text, and full payloads.

## Verification required before closure

- Local D1 migration and MCP integration tests.
- Retry classification, exact replay, changed-payload rejection, exhaustion,
  per-item bank results, and exactly-once Code Attempt coverage.
- Full tests, lint, production build, and CI.
- Production smoke tests after deployment for one disposable bank upsert and
  one disposable Code Attempt fixture, including receipt polling and exact
  replay.
- Cloudflare logs showing queued-to-saved transitions without private payload
  content.

## Rollback

Revert the Worker and cron to the prior release. Leave the additive outbox
table in D1; it is inert without the executor and avoids destructive schema
rollback. Before rollback, inspect queued receipts and report any unresolved
write to the user rather than deleting it.

## Follow-up

- #157: server-side Voice response-group remediation and finish reliability.
- `interview-arc-voice#64`: native Voice request-volume and recovery behavior.
- #93: product-owned response hook and generalized durable persistence outbox.

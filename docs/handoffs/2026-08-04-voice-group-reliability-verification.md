# Voice group reliability verification handoff

## Scope

Continue verification and release work for paired issues
`interview-arc#157` and `interview-arc-voice#64`. The user subsequently
authorized the complete merge, deploy, signed-package installation, and
production-verification loop. Deploy the backward-compatible server contract
before releasing the dependent native client.

Implementation PRs: `interview-arc#159` and `interview-arc-voice#171`.

## Server implementation

- Canonical multi-capture receipts include stable owner-scoped SHA-256 digest,
  ordered identities, response identity, status, and duplicate state.
- Caller mismatch returns non-retryable `voice_response_group_conflict` and
  does not mutate stored rows.
- Exact replay remains idempotent in recoverable states.
- `get_voice_delivery_blockers` exposes exact owner/activity-scoped identity,
  canonical-turn, audio, deletion, retry, and safe-action state without content.
- `repair_voice_response_group` requires current digest/status, explicit user
  authorization, and reason; validates group members/reservations and writes an
  audit event.
- Quarantined groups support exact fenced deletion.
- Specialist and Voice Finish failures expose stable
  `voice_delivery_blocked` details.
- Repository and outer enabled-tool lists include the read/repair tools.

## Native implementation

- Pending records persist transcript/audio/coach stage receipts and full safe
  error classification.
- Permanent conflicts quarantine immediately.
- Transient stages retry at 15s, 30s, 60s, 2m, 5m, 15m, then 1h.
- Eight attempts or six hours opens `needs_attention` and stops automation.
- Manual Retry performs one attempt; background and manual entry points are
  distinct.
- The menu-bar popover shows truthful stage/retry/attention state and can copy
  a redacted diagnostic. The floating widget is unchanged.

## Local evidence already obtained

- Focused server/unit suite: 59 passing tests.
- Full server suite: 166 passing tests, including the local D1/Worker batch
  integration and final idempotent-repair assertion.
- Local D1 migration chain through `0022`: passing.
- Local content import: passing.
- Production vinext build: passing.
- ESLint: zero errors and three pre-existing warnings.
- Swift parser: passing after the native implementation.
- Local Swift package/type-check is unavailable because the installed compiler
  and macOS SDK versions are incompatible. CI is the canonical check.
- Hosted CI, package installation, merge, and deployment remain release steps
  at the time of this handoff revision.

## Required next steps

1. Ensure both PRs use `Refs #157` / `Refs #64`, cross-link each other, list
   exact tests actually run, and include chronological execution ledgers.
2. Require both repository CI suites to pass.
3. Deploy the Worker/migration first, reconnect MCP, and
   verify discovery of the batch resolver, blocker read, repair, singular
   resolver, and exact delete tools.
4. Test disposable fixed-ID groups: transient 503 twice then success, permanent
   409 stop, rejected mismatch followed by exact replay, repair, out-of-order
   materialization, Finish, and exact cleanup.
5. Only then build/stage/sign/install the exact native artifact and run the
   relaunch/stage/circuit-breaker/Companion matrix.
6. Add issue resolution records and close only after deployed and installed
    verification passes.

## Containment already completed

The user explicitly authorized permanent deletion of two exact corrupted
three-member groups. Their server-side graphs were deleted, and the affected
activity was closed as solved with help. No production identifier is copied
into this public-safe repository handoff.

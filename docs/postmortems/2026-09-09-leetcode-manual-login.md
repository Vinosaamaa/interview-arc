# Dedicated LeetCode manual sign-in boundary

Owning issue: [#450](https://github.com/Vinosaamaa/interview-arc/issues/450).
Implementation and PR evidence are indexed by the
[Engineering record](../engineering/records/postmortem-leetcode-manual-login.md).

## Impact and detection

The user reported Google rejecting the dedicated Chrome sign-in screen as
potentially insecure. The visible automation banner matched the controller's
launch flags. A fresh dedicated profile reportedly had the same rejection;
further resets are not a repair and are outside this change. The exact Google
decision, the role of a ChromeSync page, and any connection to a separate
Cloudflare challenge remain unverified.

## Timeline and evidence

- 2026-09-09: user-reported sign-in rejection triggered issue #450.
- Source inspection confirmed the only supported launch enabled automation and
  remote debugging, with no separate user-operated login phase.
- Google [documents](https://support.google.com/accounts/answer/7675428) that
  software-controlled browsers may be refused for sign-in. This supports the
  missing manual-mode diagnosis, not a claim about a particular risk decision.
- Focused tests cover the manual phase, interrupted launches, process identity,
  helper ancestry, debugging-port conflict, receipt preservation, and locking.
- Independent read-only process review found that Chrome helpers also carry
  the profile argument. The parser now verifies their ancestry instead of
  mistaking expected helpers for an unrelated owner.

## Root cause and repair

The controller conflated browser readiness for automation with browser readiness
for user authentication. Its required debugging/automation flags are appropriate
for verified submission control but do not provide an ordinary manual sign-in
context. Add explicit `login` and `login-complete` commands around the same
dedicated profile. The user exits only that Chrome instance through its native
`chrome://quit` URL before each mode switch. The controller never stops Chrome.

A durable marker reserves the manual phase before launch. The normal controller
lock serializes mode changes with automation. Every automated browser command
checks the marker before connection or receipt reservation. A failed launch
retains the reservation. Completion requires the exact profile's process tree
and debugging listener to be absent, removes only stale preflight and the
manual marker, and leaves submission receipts intact. Age alone can no longer
steal a controller lock from a slow or interrupted owner.

## Boundaries and prevention

The process parser verifies application path, exact profile argument, main and
helper roles, and parent ancestry. Startup records the main PID and start time
across two snapshots and refuses automation/debugging flags or a debugging
listener. It never returns raw command lines or authentication URLs. This is
an ownership safeguard under the existing trusted filesystem and single-writer
contract, not protection against adversarial concurrent process/path mutation.

All tasks must use the corrected controller before a manual phase; older
versions do not honor the marker. Regression tests never launch or connect to
a browser. No cookie copying, profile reset, fingerprint spoofing, verification
bypass, Work Chrome control, practice mutation, or submission is included.

## Verification and follow-up

Implementation tests establish the mode boundary and preserved evidence.
Authentication success, post-switch provider acceptance, merge, and release
remain separate and unverified. Keep issue #450 open. Do not roll back to a
marker-unaware controller while a manual reservation exists; preserve the
profile and receipts and finish an explicitly coordinated offline transition.

## Terms

- CDP: Chrome DevTools Protocol, the browser debugging connection used only in
  normal automation mode.
- Preflight: saved profile, browser-instance, and problem identity required
  before submission; it must be renewed after a manual phase.
- PID/start identity: process number together with its recorded start time,
  used to detect replacement instead of trusting a recycled process number.

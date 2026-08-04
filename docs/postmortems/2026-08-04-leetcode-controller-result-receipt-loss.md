# Postmortem: LeetCode submit result had no recoverable receipt

**Date:** 2026-08-04

**Status:** In review — repair implemented locally, release verification pending

**Verification lane:** Reliability

**Issue:** [interview-arc#135](https://github.com/Vinosaamaa/interview-arc/issues/135)

## Summary

One explicit LeetCode controller submission completed without returning the
documented structured success or failure envelope to the specialist. The
submit gesture may already have reached LeetCode, so the specialist correctly
refused to send a second gesture and reported the attempt as ambiguous.

The controller protected the browser transaction itself, but its result had a
single delivery channel: process stdout or stderr after browser cleanup. It did
not persist an invocation-specific terminal receipt. Consequently, a dropped
command result could not be distinguished from an unfinished or unsent action
without risking a duplicate submission.

## User impact

- The user did not receive an authoritative verdict for the affected attempt.
- An automatic retry could have created a duplicate LeetCode submission.
- The safe no-retry behavior preserved external state but left the attempt
  unresolved.
- No Interview Arc practice data, recording, credential, or source file was
  lost or overwritten.

The affected historical verdict cannot be recovered through the old
controller because it created no durable receipt. This repair does not inspect
LeetCode submission history or private endpoints to reconstruct it.

## Detection and evidence

At 2026-08-04 01:03:45 PDT, the specialist recorded that exactly one checked-in
controller `submit` command had completed but returned no structured verdict or
receipt. It did not retry.

Source inspection confirmed:

- the CLI emitted its envelope only after `runCli` and controller cleanup;
- success used one `process.stdout.write` call and failure used one
  `process.stderr.write` call;
- no result was stored under the profile-local controller state directory; and
- the existing preflight receipt identified the browser and problem, not a
  particular submit invocation or its terminal outcome.

The available transcript does not prove whether stdout was lost inside the
Node process, the command transport, or the surrounding client. The confirmed
system defect is independent of that missing lower-level evidence: the result
was ephemeral and had no recovery channel.

## Timeline

| Time (PDT) | Event |
| --- | --- |
| 2026-08-04 01:03:45 | Specialist reported one completed submit command with no structured result and refused to retry. |
| 2026-08-04 01:04:43 | Coordinator began source, contract, repository, and issue-lifecycle inspection. |
| 2026-08-04 01:06:52 | Original controller issue #135 was reopened as a recurrence. |
| 2026-08-04 01:07:11 | Regression evidence and the durable-receipt repair plan were attached to #135. |

## Architecture before repair

```text
Explicit submit
  -> one browser gesture
  -> targeted verdict wait
  -> controller cleanup
  -> stdout/stderr envelope
  -> specialist

If the final transport edge failed, no authoritative result remained.
```

## Root cause

The controller treated structured process output as both the response and the
record of the response. That delivery mechanism is not durable. The external
side effect—the possible LeetCode submission—and the result receipt therefore
did not share an exactly-once identity or a recoverable terminal record.

## Contributing factors

- The preflight receipt was browser/problem scoped rather than invocation
  scoped.
- Tests covered browser cleanup and structured return values but did not
  simulate loss of stdout after a successful submit operation.
- The contract correctly prohibited automatic retries but offered no safe
  recovery command.
- A fresh invocation ID could previously trigger another gesture because no
  durable reuse fence existed.

## Resolution

The controller now uses one caller-supplied invocation ID for each `submit` or
`retry`:

1. validate the ID against a path-safe bounded format;
2. reserve it exclusively in the existing private profile-local state before
   any browser action;
3. execute at most one controller operation;
4. atomically replace the pending reservation with the terminal success or
   structured failure envelope; and
5. emit that same envelope through stdout or stderr.

A new read-only `receipt` command recovers only the exact original invocation.
It does not take the controller lock, connect to Chrome, navigate, edit code, or
submit. Reusing an invocation ID fails before browser action. Pending, missing,
or corrupt receipt state remains explicitly ambiguous and never authorizes an
automatic retry.

## Regression prevention

- A mocked Accepted result is persisted, its returned stdout value is
  discarded, and the exact terminal envelope is recovered without another
  gesture.
- Reusing the same invocation ID proves that the operation callback is not
  called again.
- Structured failures are persisted and recovered without being converted to
  success.
- Different invocation IDs cannot read one another's receipt.
- Receipt recovery proves it does not acquire the browser or controller lock.
- Contract tests require `--invocation-id`, `receipt`, and same-ID recovery in
  both the specialist guide and controller contract.

## Verification

Completed locally:

- Focused controller regression suite: 28 tests passed.

Still required before closure:

- Full repository tests, lint, and production build.
- Pull-request CI and merge to `main`.
- Real non-submitting `ensure` readiness check from the merged canonical
  checkout.
- One future user-authorized submission confirming a normal terminal receipt;
  no extra live submission is authorized solely for this repair.

## Follow-up

The repair remains tracked in reopened issue #135. No separate issue is needed
unless release verification exposes a distinct controller or transport defect.

## Technical glossary

- **Invocation ID:** A caller-chosen stable identifier for exactly one possible
  controller submission gesture.
- **Terminal receipt:** The durable success or structured failure envelope
  written after an invocation finishes.
- **Exactly-once fence:** A reservation that prevents the same invocation
  identity from executing its side effect more than once.
- **Ephemeral output:** Process output that may disappear when the command
  transport is interrupted or fails to deliver it.

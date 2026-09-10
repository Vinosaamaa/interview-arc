# Excalidraw export returned no visible handoff

- Issue: [#453](https://github.com/Vinosaamaa/interview-arc/issues/453)
- Repair: [PR #458](https://github.com/Vinosaamaa/interview-arc/pull/458)
- Status: repair implemented; production button acceptance pending.

## Impact and detection

An editable diagram in the connected ChatGPT canvas could not be handed off
through its Open in Excalidraw button. The button displayed Exporting and later
reset without opening a link or showing an actionable error. Canvas creation
had previously been mistaken for evidence that the export handoff worked.
The owner reported the failure during integration testing. No loss of the
original canvas was observed.

## Evidence and timeline

On September 10, 2026, browser testing reproduced the stalled button. A direct
call to the official hosted export operation exceeded a twenty-second client
timeout. Exporting a synthetic scene from the Excalidraw website succeeded,
and Arc's link reader recovered its exact label. A subsequent Cloudflare
remote-preview upload completed in under one second and decoded correctly.
Exact execution checkpoints and release receipts are recorded on the PR;
these observations do not establish the upstream failure's start time.

## Cause and contributing conditions

The failure is isolated to the official hosted MCP export path for the tested
requests. Its internal root cause remains unknown: available browser logs did
not expose the upload error. The website and Cloudflare upload results support
moving that operation, but do not prove an upstream network or service defect.
The renderer's silent reset hid the reason from the owner. Installation and
canvas-creation checks had not exercised the final export/open-link action.

## Repair and verification boundary

An authenticated Arc endpoint forwards the official canvas, discovery and
checkpoint operations while performing the encrypted snapshot upload on
Cloudflare. OAuth credentials remain at Arc. Fixed destinations, request
allowlists, response-size limits, manual redirects and timeouts bound this
compatibility path. Existing connections and drawings remain intact; the
repaired endpoint needs a separately named ChatGPT connection.

Focused tests verify encrypted round-trip fidelity, embedded files, export
response shape, credential isolation and safe failures. The remote-preview
round trip passed. Acceptance requires the actual ChatGPT button to open a
readable exported scene after merged-main deployment. Until that receipt exists,
neither a passing unit test nor a deployed endpoint establishes user-visible
resolution. The original third-party server itself is not changed by this PR.

## Prevention and follow-up

- Include editable-canvas export and reopening in connector acceptance.
- Keep canvas checkpoints, exported snapshots and Arc publication distinct.
- Record production acceptance and any remaining limitations on issue #453.
- Roll back the compatibility endpoint if its forwarding contract becomes
  incompatible; preserve existing diagrams and the original connection.

# Owner-Private Resume Revision Ingest Core

This is the first Reliability tracer bullet of issue #211. It establishes the
private file/revision durability boundary that a later authenticated Google
Drive exporter can call; it is not yet the user-facing Resume Library.

## Trust and privacy boundary

- `POST /resume/imports` requires an existing owner integration bearer token
  and accepts one multipart DOCX/PDF pair plus opaque stable identities.
- The caller must have already obtained the owner's explicit import
  authorization and must export both files from the same source revision.
- Raw bytes exist only in the request and private R2. D1 stores hashes, byte
  sizes, MIME types, immutable lineage, a display-safe label, and a current
  pointer. It never stores raw content, provider/local locators, or R2 keys.
- R2 keys are server-derived and private. Responses, MCP reads, logs, fixtures,
  issues, and live-update payloads must not expose them or owner identity.
- The endpoint ignores supplied filenames and uses generic download metadata.

## Durable ingest sequence

1. Validate bounded files, MIME types, format signatures, IDs, and SHA-256
   source fingerprint; compute both file hashes server-side.
2. Reserve one owner-scoped `operationId` and a short per-resume D1 lease. The
   request hash binds that operation to one exact payload.
3. If the source fingerprint and both file hashes already match an immutable
   revision, save a no-op receipt without uploading duplicate objects or moving
   the current pointer.
4. Otherwise stage both files under deterministic private R2 identities and
   verify both with R2 `HEAD`. A partial pair is best-effort removed, records a
   retryable failure, and leaves the previous current revision unchanged.
5. In one D1 batch, guard the lease, request identity, previous current pointer,
   immutable revision identity, and file integrity; then insert the source,
   revision, both file rows, advance the current pointer, save the receipt, and
   release the lease.

Concurrent different operations serialize through the lease. An expired lease
can be reclaimed, but a delayed operation cannot overwrite a current pointer
that changed since its reservation. No response that says `staging` or
`retryable_failure` is proof of a saved revision.

## Idempotency and readback

- After HTTP uncertainty, retry only the same `operationId` with the exact same
  multipart identity and bytes. A changed retry is a terminal conflict.
- An exact saved retry returns its original receipt and never writes R2 or D1
  again. An unchanged source under a new operation returns the canonical
  revision with `unchanged: true`.
- `get_resume_import_status` accepts one exact stable operation ID and returns
  at most one owner-scoped receipt: safe status/error code, canonical revision
  identity, current pointer, and the two file hashes/sizes/MIME types. Unknown
  and other-owner operations both return `found: false`.

## Deferred issue #211 work

This core deliberately does not add Google connector authorization/export,
the ignored local mirror, Resume Library UI/downloads, text or bullet
extraction, semantic claim/evidence mapping, revision comparison, deletion or
retention controls, Solution Profile invalidation, attempt-context capture,
publication, or historical backfill. The Behavioral Foundation capability must
remain truthful about those unavailable surfaces until their own slices ship.

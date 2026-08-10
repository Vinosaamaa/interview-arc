# Owner-Private Resume Revision Ingest Core

This Reliability contract began as issue #211's private ingest tracer and now
also owns the bounded owner-private Resume Library read/download boundary.

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

1. Read the multipart body through an enforced 18 MB stream bound, then
   validate the two 8 MB-or-smaller files, MIME types, format signatures, IDs,
   and SHA-256 source fingerprint; compute both file hashes server-side.
2. Reserve one owner-scoped `operationId` and a short per-resume D1 lease. The
   request hash binds that operation to one exact payload.
3. If the source fingerprint and both file hashes already match an immutable
   revision, save a no-op receipt without uploading duplicate objects or moving
   the current pointer.
4. Otherwise stage both files under deterministic private R2 identities and
   verify both with R2 `HEAD`. A partial pair is best-effort removed, records a
   retryable failure, and leaves the previous current revision unchanged.
   Staging keys include the invocation-specific lease generation, so an expired
   invocation cannot delete or overwrite a recovery retry's objects.
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
- `get_resume_library` returns at most 20 sources and 20 newest revisions per
  source with safe labels, lineage, current markers, integrity metadata, and
  authenticated website download paths. It never returns storage generations
  or private object identities.
- `GET /api/resume-library` serves the same bounded owner-scoped model with
  `private, no-store`. Behavioral Foundation keeps the Resume Library
  collapsed by default and reads it only when opened.
- `GET /api/resume-library/:resumeId/:revisionId/:format` resolves the owner and
  D1 metadata first, derives the R2 identity server-side, verifies the stored
  size/hash/generation, and returns an attachment with `private, no-store`.
  Unknown owners and identities are indistinguishable (`404`); D1/R2 drift
  fails closed (`503`) without changing state.

## Deferred issue #211 work

This core deliberately does not add Google connector authorization/export,
the ignored local mirror, text or bullet
extraction, semantic claim/evidence mapping, revision comparison, deletion or
retention controls, Solution Profile invalidation, attempt-context capture,
publication, or historical backfill. The Behavioral Foundation capability must
remain truthful about those unavailable surfaces until their own slices ship.

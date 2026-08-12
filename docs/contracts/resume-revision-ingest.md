# Owner-Private Resume Revision Ingest Core

This Reliability contract began as issue #211's private ingest tracer and now
also owns the bounded owner-private Resume Library read/download boundary.

## Trust and privacy boundary

- `POST /resume/imports` requires an existing owner integration bearer token
  and accepts one multipart DOCX/PDF pair plus opaque stable identities and an
  optional bounded extraction manifest. The Resume & Cover Letter specialist
  must supply the manifest; omission exists only for backward-compatible legacy
  upload clients.
- The caller must have already obtained the owner's explicit import
  authorization and must export both files from the same source revision.
- Raw file bytes exist only in the request and private R2. D1 stores hashes,
  byte sizes, MIME types, immutable lineage, a display-safe label, a current
  pointer, and bounded owner-private extracted bullet occurrences plus semantic
  links. It never stores full raw documents, provider/local locators, or R2
  keys.
- R2 keys are server-derived and private. Responses, MCP reads, logs, fixtures,
  issues, and live-update payloads must not expose them or owner identity.
- The endpoint ignores supplied filenames and uses generic download metadata.

## Durable ingest sequence

1. Read the multipart body through an enforced 18 MB stream bound, then
   validate the two 8 MB-or-smaller files, MIME types, format signatures, IDs,
   and SHA-256 source fingerprint; compute both file hashes server-side. When a
   manifest is present, validate its source-revision hash, extraction version,
   stable ordering, unique IDs, bounded size, and every bullet content hash.
2. Reserve one owner-scoped `operationId` and a short per-resume D1 lease. The
   request hash binds that operation to one exact payload.
3. If the source fingerprint, both file hashes, and exact manifest metadata
   already match an immutable revision, save a no-op receipt without uploading
   duplicate objects or moving the current pointer. The same source/file hashes
   with changed extraction metadata are a conflict, not a silent mutation.
4. Otherwise stage both files under deterministic private R2 identities and
   verify both with R2 `HEAD`. A partial pair is best-effort removed, records a
   retryable failure, and leaves the previous current revision unchanged.
   Staging keys include the invocation-specific lease generation, so an expired
   invocation cannot delete or overwrite a recovery retry's objects.
5. Before D1 commit, require every linked claim to exist for the same owner and
   not be contradicted, and every evidence identity to be accepted for that
   owner. Generated mappings never change claim/evidence truth state.
6. In one D1 batch, guard the lease, request identity, previous current pointer,
   immutable revision identity, manifest, and file integrity; then insert the
   source, revision, both file rows, bullet occurrences, claim/evidence links,
   exact Solution Profile review impacts, advance the current pointer, save the
   receipt, and release the lease.

Concurrent different operations serialize through the lease. An expired lease
can be reclaimed, but a delayed operation cannot overwrite a current pointer
that changed since its reservation. No response that says `staging` or
`retryable_failure` is proof of a saved revision.

## Authenticated Google Doc orchestration

The Resume & Cover Letter specialist—not the deployed Worker—owns connector
access. For one explicit `Import this resume` command it must:

1. Read authenticated Drive metadata and verify
   `application/vnd.google-apps.document` plus a revision ID or Drive version.
2. Export DOCX and PDF through the authenticated connector and materialize only
   its returned `file_uri` or `workspace_path`. Each export remains bounded by
   the connector and Worker limits; never request inline base64.
3. Read the same metadata again. File ID, MIME type, modified time, and exact
   revision/version must match the pre-export observation. A mismatch is
   `resume_source_changed_during_export`; discard neither source nor prior
   revisions, and export both formats again from one stable observation.
   An inaccessible, revoked, or deleted source fails inside the connector and
   therefore produces no valid export capture. Moving a still-authorized Doc
   does not create a new source identity: stable file ID and revision evidence
   remain authoritative, while folder/path metadata never enters the capture
   or D1.
4. Prepare an ignored private capture JSON and run
   `npm run resume:import:google-doc -- <private-capture.json>`. The controller
   validates signatures and bounds, computes all fingerprints, atomically
   creates or verifies
   `private-sources/resume-library/imports/<resume-id>/<revision-id>/`, and
   uploads only the exact mirrored bytes and bounded ingest manifest.
5. Treat only a bounded `saved` response plus authoritative MCP/library
   readback as completion. An upload failure leaves the mirror intact for the
   same exact retry. A changed retry or reused immutable ID fails closed.

The private capture has this synthetic shape; real Drive identities and paths
must remain only in the ignored local file:

```json
{
  "schemaVersion": 1,
  "operationId": "resume-import-operation-1",
  "resumeId": "primary-resume",
  "revisionId": "primary-resume-r1",
  "sourceLabel": "Primary resume",
  "capturedAt": 1786505200000,
  "source": {
    "provider": "google_drive",
    "beforeExports": {
      "fileId": "private-drive-file-identity",
      "mimeType": "application/vnd.google-apps.document",
      "modifiedTime": "2026-08-11T20:00:00.000Z",
      "version": "42"
    },
    "afterExports": {
      "fileId": "private-drive-file-identity",
      "mimeType": "application/vnd.google-apps.document",
      "modifiedTime": "2026-08-11T20:00:00.000Z",
      "version": "42"
    }
  },
  "exports": {
    "docxPath": "connector-exports/source.docx",
    "pdfPath": "connector-exports/snapshot.pdf"
  },
  "extraction": {
    "version": "resume-extract-v1",
    "bullets": [
      {
        "occurrenceId": "experience-platform-0",
        "sectionLabel": "Experience",
        "ordinal": 0,
        "text": "Designed and operated a reliable service.",
        "claimIds": [],
        "evidenceIds": []
      }
    ]
  }
}
```

The controller keeps the exact private source observation only in
`manifest.private.json`. The remote multipart request contains a SHA-256 source
revision fingerprint, never the Drive ID/revision, provider URL, capture path,
or export path. Each operation receipt is cached privately under
`import-receipts/<operation-id>.private.json`; D1 remains authoritative.

## Idempotency and readback

- After HTTP uncertainty, retry only the same `operationId` with the exact same
  multipart identity and bytes. A changed retry is a terminal conflict.
- An exact saved retry returns its original receipt and never writes R2 or D1
  again. An unchanged source under a new operation returns the canonical
  revision with `unchanged: true`. The observation timestamp is audit metadata,
  not part of the immutable semantic fingerprint, and the controller reconciles
  the proposed local revision directory onto the canonical mirror without
  retaining a duplicate pair.
- `get_resume_import_status` accepts one exact stable operation ID and returns
  at most one owner-scoped receipt: safe status/error code, canonical revision
  identity, current pointer, and the two file hashes/sizes/MIME types. Unknown
  and other-owner operations both return `found: false`.
- `GET /api/resume-imports` returns the ten newest owner-scoped import receipt
  states, including failures that never created a resume source. It exposes
  only stable operation/revision identities, bounded safe error codes, retry
  state, and timestamps; request hashes, locators, and storage identity remain
  private.
- `get_resume_library` returns at most 20 sources and 20 newest revisions per
  source with safe labels, lineage, current markers, integrity metadata, and
  authenticated website download paths. It never returns storage generations
  or private object identities.
- `get_resume_revision` returns one exact bounded revision with private bullet
  wording, lineage, file integrity, stable semantic links, and exact review
  impacts. It never returns raw files or locators.
- `compare_resume_revisions` reports textual, ordering, claim-link, and
  evidence-link deltas between two exact revisions. It does not mutate either
  revision or upgrade any fact.
- `set_current_resume_revision` is a separate exact-retry operation. It changes
  only one current pointer after explicit owner instruction and never rewrites
  revisions or downstream artifacts.
- `query_resume_reference_usage` searches one stable claim/evidence identity
  across current and older resume revisions plus exact activity snapshots.
- `get_activity_resume_context` reads contemporaneous/backfilled historical
  context directly; it never guesses a relationship.
- `backfill_activity_resume_context` is a coordinator-only append operation.
  It requires explicit owner instruction plus the exact source, DOCX, and PDF
  fingerprints of the snapshot the owner actually loaded. It verifies one
  immutable behavioral answer revision and one immutable resume revision,
  derives bounded claim/evidence context from the stored attempt, records a
  separate audit receipt, and labels the new relationship `backfilled`.
  Exact retries are unchanged; conflicting retries or pre-existing context
  fail closed. An attempt without exact snapshot provenance remains legacy
  unversioned through the absence of any context row; the owner-scoped reader
  reports that state explicitly without fabricating a relationship.
- `GET /api/resume-library` serves the same bounded owner-scoped model with
  `private, no-store`. Interview → Career Materials owns this read; Behavioral
  Foundation does not embed or own the Resume Library.
- `GET /api/resume-library/:resumeId/:revisionId/:format` resolves the owner and
  D1 metadata first, derives the R2 identity server-side, verifies the stored
  size/hash/generation, and returns an attachment with `private, no-store`.
  Unknown owners and identities are indistinguishable (`404`); D1/R2 drift
  fails closed (`503`) without changing state.

## Private-file retention and deletion

- Resume files are retained indefinitely by default. Career Materials exposes
  a destructive control only for a historical revision; the current revision
  must first be changed through an exact `set_current_resume_revision`
  operation.
- `DELETE /api/resume-revisions/:resumeId/:revisionId/files` and the equivalent
  integration-token route require the literal `explicit_user_instruction`, a
  stable operation ID, and a bounded audit reason. The UI presents a separate
  permanent-removal confirmation and saves the operation ID in session state
  before the request so an uncertain response can reuse the exact receipt.
- One additive D1 tombstone reserves the revision before any R2 mutation. The
  reservation and current-pointer selection fence each other transactionally;
  a deleting or deleted revision can never become current.
- R2 deletion is idempotent and covers the exact DOCX/PDF generation pair. D1
  records `deleted` only after both keys are absent. A partial R2 failure or a
  D1 failure after R2 deletion remains `retryable_failure`; the same operation
  deletes/verifies again and completes the durable tombstone.
- Deletion removes only raw private bytes and download paths. The immutable
  revision, file hashes and sizes, extracted wording, semantic links, review
  impacts, and activity provenance remain readable. A retired source snapshot
  cannot be silently recreated by an unchanged-source import.
- Deleted files return `404`; a deletion in progress returns `503`. Other-owner
  and unknown revision requests remain indistinguishable, and no response
  exposes an R2 key, generation, provider locator, or owner identity.

## Bounded extraction

The current import accepts already-extracted bounded occurrences and exact
semantic identities; it does not run an untrusted semantic model inside the
Worker or invent pending claims.

## Completed-attempt context

For every new completed behavioral finalization, the specialist first reads
`get_resume_library`. If a current résumé exists, the write must name that exact
resume/revision pair. D1 verifies the owner-scoped current pointer and immutable
revision in the final transaction, then appends one `activity_resume_contexts`
row for the final-answer snapshot revision.

The row snapshots only the display-safe source label, import time, answer
revision, and bounded exact claim/evidence IDs derived server-side from the
typed attempt analysis. It contains no raw résumé text, file bytes, storage
generation, object key, or provider/local locator. Exact retries are unchanged;
an explicit answer correction appends a new context revision while preserving
all earlier rows. Legacy and genuinely no-résumé attempts remain explicitly
without context—no backfill is fabricated.

Historical linkage is never part of specialist finalization. Only the
Coordinator may call `backfill_activity_resume_context`, and only after the
owner confirms that the fingerprinted DOCX/PDF snapshot was actually loaded
for the exact immutable answer revision. The audit row preserves the loaded
and confirmation times, file fingerprints, reason, and exact-retry request
identity without storing bytes or locators. Failure to establish any one of
those facts leaves the attempt unversioned.

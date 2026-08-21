# Private interview recording and transcript upload

Owning issue: [#415](https://github.com/Vinosaamaa/interview-arc/issues/415).

This feature answers one concrete question: how does the owner upload existing interview recordings and transcripts into Interview Arc? It does not require AI and does not create a Loop.

## Target workflow

1. Open an existing Loop/Round and choose **Upload interview evidence**, or open the unassigned evidence inbox.
2. Select one or more audio and supplied-transcript files through the browser file picker.
3. Review a manifest containing only safe display names, detected types, byte counts, checksums, capture/interview time, and intended relationships.
4. Correct Loop, Round, time, timezone, and file relationships before upload.
5. Upload or resume every asset with visible per-file progress and state.
6. Finalize the package after checksum, signature/MIME, D1 metadata, R2 object, and R2 readback agree.
7. Read the supplied transcript, play authorized audio, correct metadata, reassign the package, download allowed sources, or run governed deletion.

No website process scans an arbitrary filesystem directory or stores its absolute path. The owner chooses files explicitly through the browser.

## Package contract

One interview package groups assets from one interview event. A package may remain unassigned when the Loop or Round is not yet known.

```json
{
  "schemaVersion": 1,
  "loopId": "optional_loop_reference",
  "roundId": "optional_round_reference",
  "interviewedAt": "2026-08-20T20:00:00Z",
  "timezone": "America/Los_Angeles",
  "assets": [
    {"clientRef": "recording-1", "kind": "audio", "displayName": "interview.m4a"},
    {"clientRef": "transcript-1", "kind": "supplied-transcript", "displayName": "interview.vtt", "derivedFrom": "recording-1"}
  ]
}
```

The browser's `clientRef` exists only within the draft manifest. Server-generated package, asset, and R2 identities are opaque. A display filename never becomes an object key.

## Proposed D1 authority

| Entity | Responsibility |
| --- | --- |
| `loop_interview_packages` | Package state, assignment, interview time, timezone, manifest digest |
| `loop_interview_assets` | Kind, safe filename, MIME, bytes, SHA-256, private object locator, validation state |
| `loop_transcript_revisions` | Supplied source and parsed representation with immutable provenance |
| `loop_evidence_links` | Exact Loop/Round assignment and reassignment history |
| `upload_sessions` | Resumable parts, expiry, expected checksum/size, completion state |
| `evidence_command_receipts` | Idempotent finalize, assign, correct, download-authorize, and delete results |

Long transcript bodies remain in D1 only if measured payload limits prove safe. Otherwise private R2 may hold the exact body while D1 retains authoritative metadata, digest, origin, and revision. This storage choice is measured during implementation; it is not delegated to AI.

## Proposed private R2 lifecycle

```text
quarantine/{opaque-upload-object}
        │ signature + size + checksum + owner-session validation
        ▼
source/{opaque-owner-partition}/{opaque-asset-object}
        │ exact readback agrees with D1
        ▼
READY
```

Object locators never appear in the browser, logs, GitHub, or Engineering content. Authorization resolves the owner and asset in D1 before the Worker performs any R2 read or write.

## State machines

Package:

```text
draft → uploading → staged → validating → ready
                    │          ├→ partial
                    │          └→ failed
                    └→ expired

ready/partial/failed → deleting → deleted
```

Asset:

```text
declared → uploading → quarantined → verified → ready
                │           │           └→ rejected
                └→ expired  └→ corrupt
```

`partial` is not hidden failure. The reader shows usable assets, failed assets, and exact retry/finalize-subset/delete options.

## Supplied transcript rules

- Preserve original bytes and checksum.
- Record declared/detected format and encoding.
- Parse TXT, VTT, and SRT deterministically; add other formats only through reviewed allowlists.
- Keep source text and parsed segments traceably connected.
- Do not invent missing timestamps or speaker names.
- Treat corrections as new revisions or explicit metadata corrections; do not silently replace the supplied source.
- Do not submit transcript text to an AI or speech provider in this feature.

## HTTP interface sketch

| Interface | Responsibility |
| --- | --- |
| `POST /api/interview-evidence/packages` | Create draft manifest/upload session |
| `PUT /api/interview-evidence/packages/{packageId}/assets/{assetId}` | Stream or resume one asset |
| `POST /api/interview-evidence/packages/{packageId}/finalize` | Validate and reconcile package |
| `POST /api/interview-evidence/packages/{packageId}/assign` | Assign/reassign exact Loop/Round |
| `GET /api/interview-evidence/packages/{packageId}` | Owner-authorized package reader |
| `GET /api/interview-evidence/assets/{assetId}/content` | Range-capable authorized media/text read |
| `DELETE /api/interview-evidence/packages/{packageId}` | Separately confirmed governed deletion |

Every mutation accepts an idempotency key and an optimistic-concurrency token. Owner scope comes from Cloudflare Access, never request JSON.

## Recovery and reconciliation

- Resume from server-recorded byte/part state; do not trust client-only progress.
- Calculate SHA-256 while streaming and compare the declared checksum when present.
- An exact retry returns the existing asset or receipt.
- Owner-scoped duplicate detection avoids storing identical source bytes twice without creating a cross-owner oracle.
- A reconciliation job detects D1-ready/R2-missing and R2-orphaned objects using safe counts and opaque internal correlation.
- Stalled quarantine objects expire under a documented retention policy.
- Delete succeeds only when governed D1/R2 outcomes are reconciled; partial deletion remains visible and retryable.

## Privacy, consent, and observability

The owner must affirm that they are permitted to store and process a recording under applicable rules. The product explains that it cannot determine recording consent.

Safe traces include:

```text
interview_evidence phase=upload result=ok asset_count=1 byte_count=...
interview_evidence phase=finalize result=partial asset_count=3 ready_count=2
interview_evidence phase=delete result=reconciliation_required object_count=1
```

Traces exclude file names, content, paths, owner IDs, Loop/Round/package/asset IDs, R2 keys, cookies, tokens, and credentials.

## Verification matrix

| Layer | Required cases |
| --- | --- |
| File validation | Empty, truncated, mislabeled, unsupported, oversized, signature mismatch, encoding mismatch |
| Upload | Interrupt/resume, exact retry, out-of-order part, stale session, duplicate bytes, cancellation |
| Package | Multiple audio/transcript files, missing relationship, unassigned, reassign, partial finalize |
| Transcript | TXT/VTT/SRT, BOM/encoding, timestamps, no timestamps, speaker uncertainty, immutable source |
| Authorization | Cross-owner package/asset/read/range/assign/delete negatives |
| Reconciliation | D1-only, R2-only, checksum mismatch, readback failure, partial delete |
| UX | Keyboard, screen reader, mobile, 200%/400% zoom, progress, recovery, large manifests |
| Privacy | Captured logs and public artifact scan with representative private fixtures generated only in temporary test state |

## Decisions before release

- Source-audio default retention and owner-visible expiry options.
- Maximum files, total bytes, per-file bytes, and recording duration.
- Initial audio and transcript format allowlist.
- Whether an antivirus/content scanning provider is required before readiness.
- D1-versus-private-R2 threshold for transcript bodies.
- Download/export behavior and audit scope.
- Tombstone retention after governed deletion.

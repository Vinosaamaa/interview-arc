# Private interview package upload and related-material linkage

Owning issue: [#415](https://github.com/Vinosaamaa/interview-arc/issues/415).

Responsive UI mockup: [`interview-package-ui-mockup.html`](interview-package-ui-mockup.html).

This feature answers one concrete question: how does the owner bring the private sources from one real interview event into Interview Arc? A package may contain recordings and transcripts, but it may also contain interviewer-shared documents, images, external links, and owner-authored notes. The feature does not require AI and does not create a Loop.

## Product boundary

Two owner-private aggregates remain separate:

| Aggregate | Meaning | Mutation rule |
| --- | --- | --- |
| **Interview Package** | Sources and notes from one interview event | Add, validate, assign, correct, read, export, retain, or delete through issue #415 |
| **Interview Material** | Reusable preparation for one exact Loop or optional Round | Link an exact current revision, or explicitly prepare and review a new append-only revision under the existing material contract |

Uploading a package never silently edits Interview Material. A package may link to an exact material revision for navigation and provenance. The owner may separately select package sources and start a proposed material revision; that proposal shows a comparison, pinned Role Brief revision, selected source digests, and a distinct confirmation receipt before it becomes current.

Role Briefs, raw job descriptions, Career Materials, practice activities, and completed-attempt records keep their existing authorities. A file appearing in an Interview Package does not reclassify it as one of those records.

## Target workflow

1. Open an existing Loop/Round and choose **Add interview package**, or open the unassigned package inbox.
2. Add one or more sources through explicit browser controls:
   - audio recording;
   - supplied TXT, VTT, SRT, or later allowlisted transcript;
   - allowlisted document or image;
   - external link plus an owner-visible label and optional note;
   - owner-authored note or debrief.
3. Review a manifest containing safe display names or labels, detected source types, byte counts, checksums, interview time, and intended relationships.
4. Correct Loop, Round, time, timezone, and source relationships before finalization.
5. Upload or resume file assets with visible per-file progress and state. Links and notes save through versioned deterministic commands.
6. Finalize the package after checksum, signature/MIME, D1 metadata, R2 object, and R2 readback agree for each included file.
7. Read/play/download authorized sources, revise owner notes or link metadata, reassign the package, or run governed deletion.
8. Independently choose one related-material action: link an exact material revision, prepare a new revision from explicitly selected sources, or keep no material relationship.

No website process scans an arbitrary filesystem directory or stores its absolute path. The owner chooses every file explicitly through the browser.

## Package contract

One Interview Package groups sources from one interview event. A package may remain unassigned when the Loop or Round is not yet known.

```json
{
  "schemaVersion": 1,
  "loopId": "optional_loop_reference",
  "roundId": "optional_round_reference",
  "interviewedAt": "2026-08-20T20:00:00Z",
  "timezone": "America/Los_Angeles",
  "sources": [
    {"clientRef": "recording-1", "kind": "audio", "displayName": "interview.m4a"},
    {"clientRef": "transcript-1", "kind": "supplied-transcript", "displayName": "interview.vtt", "derivedFrom": "recording-1"},
    {"clientRef": "prompt-1", "kind": "document", "displayName": "shared-prompt.pdf"},
    {"clientRef": "reference-1", "kind": "external-link", "label": "Architecture reference"},
    {"clientRef": "debrief-1", "kind": "owner-note", "label": "Post-interview debrief"}
  ],
  "relatedMaterial": {
    "action": "link-only",
    "materialId": "optional_material_reference",
    "materialRevision": 3
  }
}
```

The browser's `clientRef` exists only within the draft manifest. Server-generated package, source, revision, and R2 identities are opaque. A display filename never becomes an object key. External URLs are untrusted data and never grant fetch, tool, or processing authority.

## Source categories and fidelity

| Category | Authoritative representation | Rules |
| --- | --- | --- |
| File asset | Immutable source bytes in private R2; metadata and digest in D1 | Allowlisted type, streaming size/signature/checksum validation, safe content disposition |
| Supplied transcript | Immutable source file plus deterministic parsed representation | Never invent speakers/timestamps; correction creates a revision or explicit metadata correction |
| External link | Versioned URL, owner label/note, and optional safe fetch status in D1 | No automatic crawl; fetched content, if later enabled, is a separate derived source with provenance |
| Owner note | Append-only text revisions in D1 | Owner-authored fact, never represented as transcript speech or interviewer feedback without an explicit label |
| Package relationship | Versioned link between sources, event, Loop/Round, and material revision | Destination and relationship are owner-confirmed; the system does not guess |

Arbitrary executable archives are not part of the initial allowlist. Code is represented by an explicit link, a safe text/document format, or a later reviewed source type rather than by silently accepting every file extension.

## D1 authority

| Entity | Responsibility |
| --- | --- |
| `interview_packages` | Package state, assignment, interview time, timezone, consent, retention, manifest digest |
| `interview_package_sources` | Source kind, safe label, MIME, bytes, SHA-256, private object locator, validation state |
| `interview_package_entry_revisions` | Append-only owner-note and external-link snapshots |
| `interview_package_assignments` | Exact Loop/Round assignment and reassignment history |
| `interview_package_material_links` | Exact material revision link and selected-source provenance |
| `interview_package_material_proposals` | Owner-reviewed proposal snapshot, base revisions, selected source digests, and state |
| `interview_package_upload_sessions` and `interview_package_upload_parts` | Resumable multipart checkpoint, expiry, expected bytes, part digests, and R2 receipt; successful completion compacts per-part rows |
| `interview_package_operations` | Idempotent command fingerprints and receipts |

Exact file bytes remain in private R2. D1 keeps metadata, digests, and the
bounded deterministic cue projection for supplied transcripts up to 512 KiB.
The full transcript source remains immutable in R2.

## Private R2 lifecycle

```text
multipart upload → interview-packages/{opaque SHA-256 partition}/asset
       │ exact bytes + signature + streaming checksum + metadata readback
       ▼
READY
```

Object locators never appear in the browser, logs, GitHub, or Engineering content. Authorization resolves the owner and source in D1 before the Worker performs any R2 read or write.

## State machines

Package:

```text
draft → uploading → staged → validating → ready
                    │          ├→ partial
                    │          └→ failed
                    └→ expired

ready/partial/failed → deleting → deleted
```

File source:

```text
declared → uploading → quarantined → verified → ready
                │           │           └→ rejected
                └→ expired  └→ corrupt
```

Related-material decision:

```text
unlinked → linked(revision N)
              │
              └→ proposed(revision N+1) → reviewed → current(revision N+1)
                                      └→ cancelled / stale
```

`partial` is not hidden failure. The reader shows usable sources, failed sources, and exact retry/finalize-subset/delete options. A failed source does not erase a saved note or a ready source.

## Interview Material revision rules

- Package finalization and material revision are separate commands and receipts.
- Linking records an exact `materialId` and revision; it does not change the material body.
- Preparing a revision requires an owner-selected source set. Unchecked package sources are excluded.
- The proposal pins the current material revision and Role Brief revision, shows the changed sections and provenance, and becomes stale if either current revision advances.
- Confirming creates a new append-only Interview Material revision. It never edits revision N in place.
- The original package sources remain independently readable under their own retention and deletion rules.
- Deleting a package must show linked material provenance affected by deletion. It does not silently delete or rewrite an already-created material revision.
- AI-generated synthesis remains outside issue #415. A later #418 adapter may propose material changes only after a separate privacy/provider decision and the same exact review contract.

## HTTP interface

| Interface | Responsibility |
| --- | --- |
| `POST /api/interview-packages` | Dispatch typed create, assign, entry, source, finalize, material, and delete commands |
| `PUT /api/interview-packages/{packageId}/sources/{sourceId}` | Stream or resume one file source |
| `GET /api/interview-packages` | Owner-authorized register, exact package read, or JSON manifest export |
| `GET /api/interview-packages/sources/{sourceId}/content` | Range-capable authorized media/text/document read |
| `POST /api/interview-packages` with `action: "delete"` | Separately confirmed governed deletion |

Every mutation accepts an idempotency key and an optimistic-concurrency token. Owner scope comes from Cloudflare Access, never request JSON.

## Recovery and reconciliation

- Resume from server-recorded byte/part state; do not trust client-only progress.
- Calculate SHA-256 while streaming and compare the declared checksum when present.
- An exact retry returns the existing source or receipt.
- Owner-scoped duplicate detection avoids storing identical source bytes twice without creating a cross-owner oracle.
- A reconciliation job detects D1-ready/R2-missing and R2-orphaned objects using safe counts and opaque internal correlation.
- Stalled quarantine objects expire under a documented retention policy.
- Delete succeeds only when governed D1/R2 outcomes are reconciled; partial deletion remains visible and retryable.
- Material proposals use exact source digests and base revisions so retries cannot incorporate a different source set.

## Privacy, consent, and observability

The owner must affirm that they are permitted to store and process a recording under applicable rules. The product explains that it cannot determine recording consent.

Adding any package source does not authorize automatic transcription, AI analysis, publication, crawling, or provider submission. Each later operation needs its own visible authorization and retention policy.

Safe traces include:

```text
interview_package phase=upload result=ok source_count=1 byte_count=...
interview_package phase=finalize result=partial source_count=5 ready_count=4
interview_package phase=material_link result=ok selected_source_count=3
interview_package phase=delete result=reconciliation_required object_count=1
```

Traces exclude filenames, labels, URLs, content, paths, owner IDs, Loop/Round/package/source/material IDs, R2 keys, cookies, tokens, and credentials.

## UI contract

The package workspace uses one source register and one visibly separate related-material panel:

- Event identity and assignment remain above both panels.
- The source register exposes **Audio**, **Transcript**, **Document**, **Image**, **Link**, and **Note** entry points.
- Each source shows authoritative state, recovery, and a checkbox used only for a proposed material revision.
- The material panel labels its independent authority, exact current revision, pinned Role Brief revision, and one of: link only, prepare a revision, or no relationship.
- Mobile preserves the order: Event → Sources → Related Material → Privacy → Review.
- Unsupported files, partial upload, stale material proposal, unassigned package, reassignment, unlink, retention, and delete are first-class visible states.

The standalone responsive mockup is [`interview-package-ui-mockup.html`](interview-package-ui-mockup.html). All displayed company, role, dates, names, files, and state are synthetic.

## Verification matrix

| Layer | Required cases |
| --- | --- |
| File validation | Empty, truncated, mislabeled, unsupported, oversized, signature mismatch, encoding mismatch, unsafe active content |
| Upload | Interrupt/resume, exact retry, out-of-order part, stale session, duplicate bytes, cancellation |
| Package | Mixed source types, missing relationship, unassigned, reassign, partial finalize, finalize subset |
| Transcript | TXT/VTT/SRT, BOM/encoding, timestamps, no timestamps, speaker uncertainty, immutable source |
| Link/note | Invalid or disallowed URL scheme, URL revision, no automatic fetch, note conflict, stale revision |
| Material | Link exact revision, prepare selected subset, unchecked exclusion, stale base, compare/cancel/confirm, unlink, package delete impact |
| Authorization | Cross-owner package/source/read/range/assign/material-link/delete negatives |
| Reconciliation | D1-only, R2-only, checksum mismatch, readback failure, partial delete, missing linked revision |
| UX | Keyboard, screen reader, mobile, 200%/400% zoom, progress, recovery, large manifests, reduced motion |
| Privacy | Captured-log and public-artifact scan with representative private fixtures generated only in temporary test state |

## Release decisions

- 5 MiB multipart parts; sessions expire after 24 hours.
- 20 files, 50 entries, and 2 GiB total file bytes per package.
- Per-file limits: audio 1 GiB, transcript 512 KiB, document 50 MiB,
  image 25 MiB.
- Audio: MP3, M4A/MP4, WAV, WebM, Ogg. Transcript: UTF-8 TXT, VTT,
  SRT. Document: PDF, UTF-8 TXT, Markdown. Image: PNG, JPEG, WebP.
- SVG, HTML, archives, and unsupported/mislabeled bytes are rejected. PDF is
  download-only. The initial release adds no external antivirus provider.
- Supplied transcript bytes stay in R2; their bounded deterministic cue
  projection stays in D1. Other document bodies are not copied into D1.
- Links must be credential-free HTTPS and are never fetched or preview-crawled.
- Ready sources remain until explicit deletion. Export is a JSON manifest plus
  individual owner-authorized downloads.
- Governed deletion removes private bytes/content, leaves a package tombstone,
  and preserves material-provenance receipts.
- The website ships deterministic owner-authored material proposals with a
  second explicit confirmation. AI synthesis remains outside #415.

The canonical runtime rules are in
[`docs/contracts/interview-packages.md`](../../contracts/interview-packages.md).

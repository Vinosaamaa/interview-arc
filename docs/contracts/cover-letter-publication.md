# Owner-Private Cover-Letter Storage

The Resume & Cover Letter specialist authors and verifies one final one-page
cover letter in DOCX and PDF. Interview Arc owns its immutable metadata in D1
and its private file pair in R2. Job Journey is not read, written, or required.

## Private controller input

After the installed `cover-letter` skill passes its content and document gates,
prepare one JSON manifest under ignored `private-sources/`. It contains the
complete JD and exact local document paths, so it must never be committed,
printed, pasted into an issue, or transferred through MCP.

```json
{
  "schemaVersion": 1,
  "company": "Example Company",
  "role": "Platform Engineer",
  "sourceUrl": "https://example.com/jobs/platform-engineer",
  "jobDescription": "Complete private job description (120–200,000 bytes).",
  "resumeId": "primary-resume",
  "resumeRevisionId": "primary-resume-r3",
  "docxPath": "/private/path/Example-Company-Cover-Letter.docx",
  "docxFilename": "Example-Company-Cover-Letter.docx",
  "pdfPath": "/private/path/Example-Company-Cover-Letter.pdf",
  "pdfFilename": "Example-Company-Cover-Letter.pdf",
  "evidenceChecks": [
    {
      "questionId": "behavioral-platform",
      "claimIds": ["claim-platform"],
      "evidenceIds": ["evidence-platform"],
      "excludedGapClaimIds": ["claim-platform"]
    }
  ],
  "qualityGate": {
    "contentScore": 10,
    "factualityFullCredit": true,
    "specificityFullCredit": true,
    "pageCount": 1,
    "visuallyInspected": true,
    "inspectedAt": 1786537800000
  },
  "disposeFilesAfterSuccess": false
}
```

The quality attestation contains no letter text or evidence excerpts. Storage
is rejected unless the final letter scored at least 10/12 with full factuality
and specificity credit, the PDF is exactly one page, and its complete rendered
page was visually inspected.

`artifactId`, `lineageId`, and `operationId` are optional for an initial
revision. The controller derives deterministic IDs from normalized
company/role/source, complete-JD hash, exact résumé revision, DOCX/PDF hashes,
and parent. A child must name the existing `lineageId` and exact current
`parentRevisionId`.

`sourceUrl`, when present, must be a credential-free public HTTP(S) posting.
Loopback or local hostnames, raw IP literals, embedded credentials, and
credential-shaped query parameters fail closed before upload.

`excludedGapClaimIds` records that the unresolved claim was deliberately kept
out of the letter; it does not resolve the gap. Every declared claim must be
verified, every declared evidence item must be accepted support for the exact
question, and accepted contrary evidence fails the preflight.

Run exactly:

```sh
pnpm cover-letter:save -- private-sources/path/to/manifest.private.json
```

## Exact retry and private storage

The controller validates bounded regular DOCX/PDF files and their signatures,
reads the exact owner-private résumé revision and evidence through MCP, computes
the JD, evidence-generation, DOCX, and PDF fingerprints, and sends one bounded
multipart request to Interview Arc with the existing owner integration token.
The complete JD, evidence text, and local paths never cross that request.

The Worker reserves one owner-scoped operation and immutable artifact ID in D1,
stages both files under one opaque R2 storage generation, verifies their size
and hashes, and commits the complete pair atomically. A partial R2 write is
cleaned up and cannot become ready. If delivery or commit is uncertain, the
controller reads the same operation identity; it never invents another ID.

Only `saved` with artifact state `ready` completes storage. Retry pending or
uncertain work with the same manifest. Changed document bytes, JD, résumé
revision, evidence generation, company/role, source, parent, or quality
attestation under one operation ID conflicts. A child appends and supersedes
its exact parent; neither revision is rewritten.

The ignored local receipt contains stable IDs, hashes, bounded evidence IDs and
gap fingerprints, timestamps, and state—not the JD, evidence text, document
bytes, R2 identity, credentials, or local paths. Local output files are removed
only when the manifest explicitly sets `disposeFilesAfterSuccess: true`.

D1 stores only owner ID, stable artifact/lineage/operation IDs, display-safe
company and role, optional public source URL, JD/evidence hashes, exact résumé
revision, lifecycle timestamps, and file integrity metadata. R2 stores the
private DOCX/PDF bytes under opaque owner-derived keys. Git, MCP results,
browser JSON, practice records, Loops, and transcripts never store the bytes or
raw JD.

## Career Materials read

`GET /api/career-materials/cover-letters` resolves the authenticated owner and
reads only that owner's bounded D1 library. It joins the exact résumé label and
returns `private, no-store`. The projection contains company/role, revision
lineage, timestamps, JD/evidence fingerprints, exact résumé revision, and both
file hashes, sizes, formats, filenames, and same-origin download paths. It never
returns storage generations, R2 keys, file bytes, raw JD, evidence excerpts,
credentials, or local paths.

`GET /api/career-materials/cover-letters/<artifact-id>/<docx|pdf>` resolves the
owner and D1 metadata before deriving the opaque R2 key server-side. It verifies
the stored generation, hash, size, and format before streaming one private,
no-store attachment. Unknown and other-owner IDs are indistinguishable.

The website remains read-only: it lists immutable revisions and offers direct
DOCX/PDF downloads. Creation stays in the specialist conversation. No
application record, Interview Loop, Role Brief, Target Profile, or separate
website authoring form is required.

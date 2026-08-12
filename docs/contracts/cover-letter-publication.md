# Owner-Private Cover-Letter Publication

The Resume & Cover Letter specialist authors and verifies one final one-page
PDF. Job Journey owns its immutable artifact metadata and private PDF bytes.
Interview Arc owns the exact resume/evidence preflight, an ignored local
controller receipt, and the authenticated display-safe Career Materials read.

## Private controller input

After the installed `cover-letter` skill passes its content and document gates,
prepare one JSON manifest under ignored `private-sources/`. It contains the
complete JD and exact local final-PDF path, so it must never be committed,
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
  "pdfPath": "/private/path/final-cover-letter.pdf",
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
  "disposePdfAfterSuccess": false
}
```

The quality attestation is bounded and contains no letter text or candidate
evidence. Publication is rejected unless the final letter scored at least
10/12 with full factuality and specificity credit, is exactly one page, and
the rendered page was visually inspected.

`artifactId`, `lineageId`, and `operationId` are optional for the first
revision; the controller derives deterministic identities from normalized
company/role/source, complete-JD hash, exact resume revision, optional
application ID, parent, and PDF hash. A child revision must provide its existing
`lineageId` and exact `parentRevisionId`. `jobId` is optional and never created
by this flow.

`excludedGapClaimIds` means the specialist explicitly kept that claim's open
gap out of the final letter; it does not resolve or hide the gap. Every declared
claim must be currently verified, every declared evidence item must be accepted
supporting evidence for that exact question, and accepted contrary evidence
fails the publish preflight.

Run exactly:

```sh
pnpm cover-letter:publish -- private-sources/path/to/manifest.private.json
```

## Exact retry and storage

The controller verifies a bounded regular PDF and `%PDF-` signature, reads the
exact owner-private resume revision and declared evidence through MCP, computes
JD/PDF hashes, and sends one multipart command directly to Job Journey using
the private Sites service credential. Redirects fail closed. If delivery is
uncertain or Job Journey returns a server failure, the controller reads the
same operation identity rather than inventing a second artifact.

Only `ready` completes publication. Retry pending/uncertain work with the same
manifest; changed content under the same identity conflicts. The bounded local
receipt is stored only under ignored
`private-sources/career-materials/cover-letters/`. It contains stable IDs,
hashes, evidence IDs, gap fingerprints, timestamps, and state—not the JD,
evidence text, PDF bytes, provider object identity, credentials, or local paths.
Interview Arc never copies final PDF bytes into Git, D1, R2, MCP, or browser
JSON.

## Career Materials read

`GET /api/career-materials/cover-letters` resolves the Arc owner, reads Job
Journey's versioned allowlisted projection server-to-server, and adds only the
matching Resume Library label plus a credential-free Job Journey-owned URL. It
returns `private, no-store`. A provider failure is `unavailable`, never an empty
history; stale cached data remains visibly stale. Unknown fields, malformed
states, unsafe download paths, non-HTTPS provider bases, and more than 100
records fail closed.

The website is read-only. It shows company/role, state, lineage, created time,
exact resume revision, standalone/application-linked status, PDF hash/size, and
the Job Journey-owned link. It contains no editor and never exposes raw JD,
PDF, evidence excerpts, credentials, R2 identity, local paths, or operational
telemetry.

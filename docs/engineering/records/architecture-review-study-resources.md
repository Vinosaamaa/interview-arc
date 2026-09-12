---
schemaVersion: 1
id: architecture-review-study-resources
revision: 1
type: architecture-review
status: proposed
title: Preserve private originals for source-based learning
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Consumer ChatGPT file-picker delivery", "Host support for binary embedded resources"]
modules: ["study-resources"]
interfaces: ["study-resource-api"]
seams: ["original-to-reading-copy"]
adapters: []
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["private-study-resources"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label": "Issue #475", "url": "https://github.com/Vinosaamaa/interview-arc/issues/475", "kind": "issue"}]
verification: {"state":"verified","evidenceRefs":["tests/study-resources.test.mjs","docs/contracts/study-resource-library.md"]}
visibility: public-safe
publicationEligibility: eligible
issue: 475
pr: null
release: null
run: null
---
# Preserve private originals for source-based learning

User material belongs in the private product library, not a repository or a
summary-only knowledge store. The two upload adapters share one storage function
that verifies original bytes, commits immutable identity and returns explicit
reading coverage. R2 stores originals; D1 stores metadata, full text fragments
and links to questions, activities, lesson revisions or PDF parent pages.

## Decisions

The server parses text and HTML without executing HTML or fetching its assets.
An edge-compatible PDF.js build supplies PDF text for either upload path.
Browser PDF.js renders page-image copies for diagrams and scans. A remote OCR or
vision service would add a provider and processing cost; the first version lets
ChatGPT inspect actual images and keeps gaps explicit. The saved original is
always the authority; a reading copy never replaces it.

ChatGPT's supported file input supplies a temporary download URL. The adapter
restricts hosts and size, refuses redirects and discards delivery identifiers.
Website upload streams are bounded before multipart parsing. The owner is
resolved by the existing authentication boundary, never chosen in the payload.

## Failure and concurrency

An operation identity pins its original and reading-copy fingerprints. Changed
retries fail instead of overwriting earlier sources. Fragment staging uses the
reading hash so concurrent changed uploads cannot mix text. The final metadata
row is the visibility boundary. Exact retries can repair missing original storage.
Page-image preparation is sequential and retryable; partial progress retains the
original and confirmed page images. Unreferenced staging objects may remain after
failure; no deletion or garbage collection is introduced.

## User flow and verification

The reader uses the existing paper/teal/serif design language, a file list and a
separate source reader. Desktop and 390px browser checks exercise unchanged
original downloads, complete Markdown paging, collapsed HTML content, PDF text
and rendered page images. Local Workers/MCP tests cross both adapters and prove
that the same owner can retrieve their shared library. Focused tests cover
conflicting retries and other-owner denial. A real authenticated production
connector read succeeds, but the new tools require release and consumer-host
acceptance. No claim of production delivery is made by this record.

---
schemaVersion: 1
id: architecture-review-learning-materials
revision: 1
type: architecture-review
status: accepted
title: Publish private learning materials with preserved sources
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-13
reconstructed: false
confidence: verified
unknowns: ["Caption availability for arbitrary YouTube videos", "Browser-specific original PDF rendering"]
modules: ["learning-workspace"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["source-to-private-learning-material"]
adapters: ["study-resource-originals"]
relatedRecords: ["architecture-review-study-resources@1"]
decisions: []
incidents: []
features: []
capabilities: ["source-grounded-learning-materials"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #486","url":"https://github.com/Vinosaamaa/interview-arc/issues/486","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/learning-materials.test.mjs","tests/chatgpt-connector.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 486
pr: null
release: null
run: null
---
# Publish private learning materials with preserved sources

An uploaded resource was readable in the library but had no dedicated Learn
page for detailed notes alongside its complete source. The new Materials
destination keeps model-authored interpretation separate from original evidence.

## Boundary and decision

ChatGPT acquires and inspects the source using available tools, then supplies a
detailed overview, topic sections, source locations and key notes. The Arc
connector saves the summary and source identity; it does not call a paid model,
transcription provider or local computer. Existing HTML/PDF/image uploads keep
their exact original bytes. Public article import stores the downloaded file;
caption text is saved unchanged through a separate transcript tool.

D1 owns immutable material publications. Existing owner-private R2 owns source
bytes. Publication checks ownership, pinned SHA-256 and original storage before
its single insert. Deterministic owner/operation identity plus a complete
request fingerprint makes exact retries replayable and changed retries fail
without replacing earlier notes. The owner and resource foreign key preserves
the domain link. No Lesson, Enrollment or practice record is invented.

## Alternatives and tradeoffs

Putting summaries directly into resource chunks would destroy the distinction
between source and interpretation. Reusing practice publication would introduce
irrelevant outcomes and lifecycle states. Generating summaries or audio on the
server would add an unnecessary provider and cost dependency.

Arbitrary YouTube captions are not guaranteed. The official captions-download
API requires permission to edit the video, so it cannot implement universal
third-party video retrieval. Available transcript tools or a supplied export
provide source text. Missing or partial content remains explicit; a video
description cannot satisfy the transcript requirement. The model's complete
coverage assertion is reviewable metadata, not a server-certified truth claim.

## Security and failure handling

Source content is untrusted and cannot authorize tools. Public URL import sends
no credentials, rejects non-HTTPS/private literal targets, follows no redirects,
and uses Workers' public-DNS-only fetch protection. Original HTML is isolated by
an opaque sandbox and a restrictive response policy. Scripts, forms and external
subresources are disabled. Parent React never inserts raw source HTML.

The reader pins the original hash on every fragment read. Original downloads
remain complete even when an embedded browser viewer cannot display a format.
Loaded-part counts and explicit full-source loading prevent silent truncation.
Source requests from a previously selected material cannot replace a new reader.

## Verification and rollout

Focused SQLite/R2 tests verify original preservation, exact and changed retries,
owner isolation, source mismatch/missing storage, coverage validation and public
URL boundaries. The bundled authenticated connector test saves a transcript,
publishes detailed notes, rereads the website route and verifies original bytes
and sandbox headers. Website lint, production build, local migrations and content
import cover the application integration. Actual ChatGPT and desktop/mobile
reader acceptance are release checks recorded on the owning issue.

The migration is additive. Roll back code to hide the tools and Materials
destination without deleting private publications or uploaded originals.

---
schemaVersion: 1
id: feature-retrospective-interview-packages
revision: 1
type: feature-retrospective
status: released
title: Preserve real interview sources as private deterministic packages
repository: interview-arc
capabilityIds: ["arc-interview-loops"]
createdAt: 2026-08-21
reconstructed: false
confidence: verified
unknowns: ["Production release evidence is pending the merged-main workflow and will be recorded in the issue resolution ledger."]
modules: ["HTTP:interview-packages","D1:interview-package-domain","R2:interview-package-storage","web:interview-package-workspace"]
interfaces: ["app/api/interview-packages/route.ts","db/interview-package-policy.ts","docs/contracts/interview-packages.md"]
seams: ["authenticated website to owner-scoped package command","D1 upload checkpoint to private R2 multipart object","selected package sources to separately confirmed Interview Material revision"]
adapters: ["app/interview-package-dialog.tsx","db/interview-package-storage.ts","db/interview-packages.ts"]
relatedRecords: ["architecture-review-interview-capability-separation@1","feature-retrospective-interview-loops@1"]
decisions: []
incidents: []
features: ["feature-retrospective-website-loop-creation@1"]
capabilities: ["owner-private-interview-packages","reviewed-interview-material-revisions"]
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Interview Package issue #415","url":"https://github.com/Vinosaamaa/interview-arc/issues/415","kind":"issue"},{"label":"Pull request #421","url":"https://github.com/Vinosaamaa/interview-arc/pull/421","kind":"pull-request"},{"label":"Interview Package runtime contract","url":"https://github.com/Vinosaamaa/interview-arc/blob/main/docs/contracts/interview-packages.md","kind":"documentation"}]
verification: {"state":"verified","evidenceRefs":["issue:415","pull-request:421","tests/interview-package.test.mjs","docs/design/interview-package/interview-package-desktop.png","docs/design/interview-package/interview-package-mobile.png"]}
visibility: public-safe
publicationEligibility: eligible
issue: 415
pr: 421
release: null
run: null
---
# Preserve real interview sources as private deterministic packages

Interview Arc now gives the owner one website-native register for the mixed
sources produced by a real interview event. Recordings and supplied transcripts
are optional peers alongside documents, images, credential-free HTTPS links,
and append-only owner notes. A package can target one exact Loop and Round or
remain visibly unassigned, and the entire flow works without a model, speech,
or transcription provider.

## Durable boundary

Owner-scoped D1 owns package identity, consent, assignment history, file
metadata and integrity, note/link revisions, resumable upload checkpoints,
material links and proposals, retention state, and idempotent receipts. Private
R2 owns exact file bytes under a server-derived opaque locator. Browser
requests never carry an owner ID, R2 locator, or multipart upload identity.

The initial source policy is intentionally closed. It sets explicit file and
package limits, accepts only reviewed audio, transcript, document, and image
formats, rejects active or mislabeled content, and never crawls saved links.
The Worker streams SHA-256 verification, checks format signatures and UTF-8
where applicable, then requires exact R2 metadata and byte readback before a
source becomes ready.

## Recovery and deletion

Uploads advance in contiguous five-mebibyte multipart parts. D1 is the progress
authority, so the owner can reselect the exact original file and resume from a
server-recorded checkpoint for 24 hours. Every mutation uses an immutable
operation identity, optimistic revision, and stable receipt. D1 invariant
guards prevent a stale package, source, or upload session from committing a
partial authoritative result after an R2 side effect.

Partial packages remain visible and can finalize an explicitly valid subset.
Cancellation reconciles the unfinished multipart state. Governed deletion
marks the package deleting, removes completed and unfinished private objects,
verifies absence, erases private source and entry content, and only then leaves
a tombstone. Material provenance remains while an already-confirmed Interview
Material revision is never deleted or rewritten.

## Material separation

Package upload has no Interview Material authority. The owner can keep no
relationship or link one exact material revision without changing its body. A
new revision requires checked source digests, an owner-authored proposal, and a
separate exact confirmation. The proposal pins Loop, Round, Role Brief,
material-base, and source revisions; any advanced base becomes stale.

Confirmation crosses one narrow `website_owner` adapter into the existing
append-only material command. It does not impersonate the Loop Recorder,
invoke AI, or make unchecked package sources available to the new revision.

## Experience and verification

The responsive package folio separates a blue-green private source register
from an ochre related-material review panel. It exposes upload progress,
resume/cancel, checksum state, transcript cues, note/link revision, assignment
correction, partial/full finalization, exact download, manifest export, and
governed deletion with keyboard focus containment and restoration, mobile
layouts, visible errors, reduced motion, and zoom-safe geometry.

Synthetic browser fixtures proved one interrupted multipart upload and resume,
partial then complete finalization, transcript range read, entry revision,
selected-source material confirmation, unsafe-content rejection, export,
exact-retry receipts, cancellation, and deletion while preserving the material
revision. Local migration, content import, lint, production build, focused
policy checks, and the complete repository test suite cover the release branch.

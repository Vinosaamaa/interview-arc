---
schemaVersion: 1
id: change-note-inline-loop-round-resources
revision: 1
type: change-note
status: released
title: Place Loop creation and Round resources at their working context
repository: interview-arc
capabilityIds: ["arc-interview-loops"]
createdAt: 2026-08-21
reconstructed: false
confidence: verified
unknowns: ["Production release evidence is pending the merged-main workflow and will be recorded in the issue resolution ledger."]
modules: ["web:loops-workspace","HTTP:loops","HTTP:interview-packages","D1:loop-command","D1:interview-package-domain","R2:interview-package-storage"]
interfaces: ["app/loops-workspace.tsx","app/loop-create-dialog.tsx","app/round-resources.tsx","app/api/loops/rounds/route.ts","app/api/interview-packages/route.ts","docs/contracts/interview-loops.md","docs/contracts/interview-packages.md"]
seams: ["Loop switcher to complete Loop creation","Loop timeline to optimistic Round revision","expanded Round to exact assigned private package","browser file selection to resumable private object storage"]
adapters: ["app/loop-create-dialog.tsx","app/round-resources.tsx","db/loop-website.ts"]
relatedRecords: []
decisions: []
incidents: []
features: ["feature-retrospective-interview-packages@1","feature-retrospective-website-loop-creation@1"]
capabilities: ["contextual-loop-creation","timeline-round-creation","inline-round-evidence"]
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Inline Loop resources issue #422","url":"https://github.com/Vinosaamaa/interview-arc/issues/422","kind":"issue"},{"label":"Pull request #423","url":"https://github.com/Vinosaamaa/interview-arc/pull/423","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:422","pull-request:423","tests/loop-website.test.mjs","tests/interview-package.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 422
pr: 423
release: null
run: null
---
# Place Loop creation and Round resources at their working context

Loop creation, Round creation, and source upload now appear where the owner is
already working instead of in a detached action strip. The complete existing
Loop composer opens inside Switch Loop. Add another Round sits at the open end
of the selected Loop timeline, while each expanded Round contains separate
Recording & Transcript and Resources shelves.

## Context and boundaries

Adding a Loop remains the deterministic company-and-role intake established by
the website Loop creation capability. Adding a Round is a narrow owner-authenticated
adapter over the same append-only Loop revision boundary: the server assigns
the stage identity and order, rejects duplicate labels, guards the expected
revision, and records an idempotent receipt in one D1 batch.

The inline shelves reuse the existing private Interview Package lifecycle.
Files require explicit storage permission, stay assigned to one exact Loop and
Round, and retain their source kind and checksum. Uploading a recording,
supplied transcript, document, or image does not invoke AI and does not create
or revise Interview Material.

## Interaction and recovery

Dragging or choosing a supported file creates the exact Round package only
when needed, declares the source, uploads bounded parts, completes integrity
verification, and reads the private projection back. Audio plays inline;
supplied transcripts preserve deterministic cues; images, PDF, and text have
inline previews with an authorized open path. An interrupted upload can resume
from its server-owned five-mebibyte checkpoint after the owner reselects the
same file.

Round package reads are filtered by both Loop and Round before the bounded
query result is assembled. A successful Add Round action rotates its operation
identity and clears the form, so a second Round cannot replay the prior
command. Supported transcript extensions determine their canonical media type
before unreliable browser MIME labels are considered.

## Verification

Focused Loop and Interview Package tests cover the website authority adapters,
stable identities, exact-Round filtering, canonical transcript types, shared
upload recovery, and UI placement. A local Worker with fresh D1 migrations and
private object storage verified Round creation, exact retry, stale-revision
conflict, transcript upload, checksum equality, authorized readback, and cue
projection. Full lint and the production build provide the release gates.

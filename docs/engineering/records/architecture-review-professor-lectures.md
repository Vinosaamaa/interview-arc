---
schemaVersion: 1
id: architecture-review-professor-lectures
revision: 1
type: architecture-review
status: proposed
title: Prepare private lectures before continuous audio playback
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Configured speech provider acceptance", "Physical mobile background playback", "Consumer Live tool and turn availability"]
modules: ["professor-lectures"]
interfaces: ["professor-lecture-api"]
seams: ["prepared-script-to-continuous-audio"]
adapters: []
relatedRecords: ["adr-owner-private-practice-record-authority@1"]
decisions: []
incidents: []
features: []
capabilities: ["continuous-prepared-lectures"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label": "Issue #473", "url": "https://github.com/Vinosaamaa/interview-arc/issues/473", "kind": "issue"}, {"label": "PR #474", "url": "https://github.com/Vinosaamaa/interview-arc/pull/474", "kind": "pull-request"}]
verification: {"state":"verified","evidenceRefs":["tests/professor-lectures.test.mjs","docs/contracts/professor-lectures.md"]}
visibility: public-safe
publicationEligibility: eligible
issue: 473
pr: 474
release: null
run: null
---
# Prepare private lectures before continuous audio playback

A request for an hour of silent listening cannot depend on a conversational
assistant autonomously starting another spoken turn. The prepared lecture moves
continuation into one native audio stream while keeping a shared private script
and revisioned position available to connected ChatGPT text.

## Alternatives and decision

A stronger chat prompt cannot establish control of consumer Voice turn scheduling.
A playlist of short audio elements still depends on background JavaScript at each
transition. A transcoded compressed file saves bandwidth but adds a separate
media processing dependency. The initial implementation serves one seekable WAV
across private PCM parts. Its bandwidth is substantial, approximately 172.8 MB per
hour, but the storage and streaming path remains within the existing Worker.

The player is an auxiliary page in Interview Arc, using the existing paper,
teal and serif design tokens. It does not add a workspace or embed ChatGPT.
Scripts are prepared in connected text or pasted by the owner; the Worker does
not claim to author or research lectures. Audio generation starts explicitly,
reuses confirmed parts and reports missing deployment configuration.

## Ownership and failure behavior

D1 owns immutable scripts, reference pins, chunk metadata, leases and cursor
receipts. Private R2 holds generated PCM, which is separate from user recordings
and Learning Session evidence. There is no public object URL or Git lecture.
Concurrent position writes require matching revisions. A conflict pauses the
player. Lost acknowledgements retry the same operation identity. Unconfirmed
position updates can be lost when a browser is terminated; the product does not
claim stronger delivery than its receipt establishes.

Generation commits a part only after R2 size verification and a matching lease.
A failed provider request or expired lease cannot mark another request ready.
The stream validates owner and readiness before handling full, suffix or bounded
byte ranges across objects. Audio duration comes from sample bytes, not a
promise based on word count.

## Verification and remaining acceptance

Focused SQLite and synthetic R2/Speech tests cover immutable identity, isolation,
concurrent cursor conflicts, generation exclusion and retries, byte-range joins,
HEAD without object reads and the sample count for 60 minutes. Lint and local D1
migration/content import pass. Provider-generated speech, a physical device's
locked-screen hour, and consumer Live continuation remain separate acceptance
steps. No production release is asserted by this architecture record.

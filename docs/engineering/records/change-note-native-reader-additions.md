---
schemaVersion: 1
id: change-note-native-reader-additions
revision: 1
type: change-note
status: released
title: Show saved additions on the selected practice record
repository: interview-arc
capabilityIds: ["practice-records"]
createdAt: 2026-09-10
reconstructed: false
confidence: verified
unknowns: ["Production browser acceptance follows release"]
modules: ["practice-records"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: []
relatedRecords: ["change-note-native-deferred-references@1"]
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/practice-record-route.test.mjs","tests/behavioral-final-answer-reader.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: null
release: null
run: null
---
# Show saved additions on the selected practice record

Actual ChatGPT publication succeeded for the three synthetic specialties, and
an exported drawing was durably attached. The website still omitted that
drawing because its authenticated practice-record route did not project the
new drawing/editorial fields. The renderer expected those fields; isolated
renderer fixtures had supplied them and therefore missed the route omission.

The website API now returns both owner-scoped additions and interaction-mode
projections. Loaded record snapshots retain those fields when a list refresh
reselects the same activity. No underlying practice evidence is rewritten.

An independent browser check also found that opening an explicit Past URL
could display the previously remembered record. The remembered-selection effect
could schedule a later animation-frame write after URL restoration. Explicit
record links now prevent that fallback selection from being scheduled.

The actual GET handler is exercised with its owner and persistence dependencies
stubbed, verifying private cache headers and the complete addition projection.
Snapshot tests preserve the newly loaded fields. An actual local app browser
fixture with a competing remembered record verifies explicit selection,
drawing controls and responsive geometry at 390px and 1440px. Production
readback is required after release; the synthetic records remain for review.

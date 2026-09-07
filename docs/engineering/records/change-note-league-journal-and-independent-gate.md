---
schemaVersion: 1
id: change-note-league-journal-and-independent-gate
revision: 1
type: change-note
status: "released"
title: "Include League records and validate Engineering metadata independently"
repository: "interview-arc"
capabilityIds: ["engineering-journal"]
createdAt: "2026-09-07T23:12:25Z"
reconstructed: false
confidence: "verified"
unknowns: []
modules: ["engineering-journal"]
interfaces: ["trusted-engineering-sources","pull-request-engineering-impact"]
seams: []
adapters: []
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #433","url":"https://github.com/Vinosaamaa/interview-arc/issues/433","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:433","tests/engineering-impact.test.mjs: all 21 policy tests passed, including metadata triggers and independent workflow validation."]}
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 433
pr: null
release: null
run: null
---
# Include League records and validate Engineering metadata independently

League was absent from the trusted Journal source inventory, and PR metadata edits reran the full website validation before reaching the Engineering gate.

## Change

The trusted source inventory now includes League at the exact reviewed commit 8e49f3fd51547789c1f061b4a1c71e68eead0bd1 from League PR 218. It exposes the newly authored gate record and its receipt through the same normalization and publication path as Arc Live and Voice. Existing source pins remain fixed. The Engineering validator and focused policy tests run as a separate Ubuntu check on source and metadata updates, while the website build no longer restarts for title/body edits. The pin is prepared from the reviewed League branch and must be merged there before this dependent change is delivered.

## Verification and delivery

tests/engineering-impact.test.mjs: all 21 policy tests passed, including metadata triggers and independent workflow validation.

Local checks establish the implementation behavior. Hosted validation and merge remain separate delivery steps.

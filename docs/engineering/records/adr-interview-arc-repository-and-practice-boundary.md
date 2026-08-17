---
schemaVersion: 1
id: "adr-interview-arc-repository-and-practice-boundary"
revision: 1
type: "adr"
status: "accepted"
title: "Organize Interview Arc specialist workflows"
repository: "interview-arc"
capabilityIds: ["arc-repository-practice-boundary"]
createdAt: "2026-07-19"
reconstructed: true
confidence: "medium"
unknowns: ["An explicit linked issue was not exposed.","An exact hosted workflow SHA was not exposed.","A deployment receipt was not exposed.","Attachment bodies and workflow logs were not quoted."]
modules: ["web:agents","web:content-index","web:globals","web:layout","web:page","practice:behavioral"]
interfaces: ["docs/contracts/activity.schema.json","docs/contracts/daily-journal.schema.json","docs/contracts/leetcode-log.md","docs/contracts/leetcode-log.schema.json","docs/contracts/practice-question-bank.schema.json","docs/contracts/question-bank.schema.json"]
seams: ["Git narrative content \u2194 runtime projection"]
adapters: ["docs/architecture/repository-layout.md","scripts/build-content-index.mjs","scripts/import_bugfree_behavior.mjs","scripts/import_leetcode_company_mhtml.py","scripts/import_systemdesign_io.py","scripts/transcribe_audio.py"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-repository-practice-boundary"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Pull request #1","url":"https://github.com/Vinosaamaa/interview-arc/pull/1","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:1","head-commit:8546c18e67d9c1db024b4eced0b3858149db7021","merge-commit:fecb5e4813b17f038410fad238b1a7fcb6f6dfe9"]}
visibility: "public-safe"
publicationEligibility: "eligible"
issue: null
pr: 1
release: null
run: null
---
# Organize Interview Arc specialist workflows

Evidence-indexed reconstruction of pull request #1. This record preserves the reviewed public-safe module, interface, seam, and adapter inventory from that change. It does not reconstruct unavailable motivation, success, attachment bodies, workflow logs, or deployment receipts.

## Historical limits

Dependent receipts link this exact revision. Unrecorded impact remains unknown.

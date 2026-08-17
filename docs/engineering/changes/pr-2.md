---
schemaVersion: 1
repository: interview-arc
pr: 2
title: "Move Interview Arc live state and publishing to Cloudflare D1"
classification: adr
richRecordRefs: ["adr-hybrid-git-d1-owner-scoped-state@1"]
reconstructed: true
confidence: high
unknowns: ["An explicit linked issue was not exposed.","Attachment bodies and workflow logs were not quoted."]
headCommit: "0a6dfc3f44ab10d4568ae3eb2f0b8cdf1bdb440f"
mergeCommit: "1ef018c2b1b2c80b79ce1a4a2ce72ee293eed928"
mergedAt: "2026-07-20T05:50:29Z"
sources: [{"label":"Pull request #2","url":"https://github.com/Vinosaamaa/interview-arc/pull/2","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:2","head-commit:0a6dfc3f44ab10d4568ae3eb2f0b8cdf1bdb440f","merge-commit:1ef018c2b1b2c80b79ce1a4a2ce72ee293eed928"]}
visibility: public-safe
publicationEligibility: eligible
---
# Move Interview Arc live state and publishing to Cloudflare D1

Changed 41 files (+4400/-11714), primarily app, db, drizzle, and docs.

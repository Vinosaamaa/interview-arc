---
schemaVersion: 1
id: postmortem-worker-source-import
revision: 1
type: postmortem
status: accepted
title: Worker source imports rejected an unsupported redirect option
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-13
reconstructed: false
confidence: verified
unknowns: []
modules: ["learning-workspace"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["public-source-download"]
adapters: ["study-resource-originals"]
relatedRecords: ["architecture-review-learning-materials@1"]
decisions: []
incidents: ["worker-source-import"]
features: []
capabilities: ["source-grounded-learning-materials"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #486","url":"https://github.com/Vinosaamaa/interview-arc/issues/486","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/chatgpt-connector.integration.test.mjs","tests/learning-materials.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 486
pr: null
release: null
run: null
---
# Worker source imports rejected an unsupported redirect option

The actual ChatGPT acceptance test could discover the released material tools,
but both a YouTube import and its creator-provided transcript PDF failed before
the original was saved. No publication was created and no earlier source was
overwritten. The agent correctly stopped rather than inventing a source identity.

## Confirmed cause

Cloudflare's Workers runtime rejects `redirect: "error"`; Node accepts it.
A minimal local Worker reproduced the TypeError for bound and unbound fetch.
The same unsupported option existed in the ChatGPT attachment downloader.
Earlier injected network fixtures returned a Response before validating fetch
options, so their successful results did not exercise the failing boundary.

## Repair and prevention

Use Workers-supported `manual` redirect handling in source and attachment
downloads. Existing non-success response checks reject redirect statuses, so no
redirect target is fetched and the source-origin boundary remains unchanged.
The bundled integration fixture now constructs a native Request before any
mocked network response. It exercises a public article import, rejects a redirect,
and covers the existing ChatGPT attachment path in the actual Workers runtime.

Focused original-preservation, caption and URL-policy tests remain in place.
The same real ChatGPT lecture publication must pass after release before issue
closure; passing mocked network responses alone is insufficient acceptance.

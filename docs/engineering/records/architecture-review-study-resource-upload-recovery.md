---
schemaVersion: 1
id: architecture-review-study-resource-upload-recovery
revision: 1
type: architecture-review
status: accepted
title: Restore large originals and explicit ChatGPT file selection
repository: interview-arc
capabilityIds: ["learning-workspace"]
createdAt: 2026-09-12
reconstructed: false
confidence: verified
unknowns: ["Actual ChatGPT file picker acceptance pending release", "Speech provider key is not configured"]
modules: ["study-resources"]
interfaces: ["study-resource-api"]
seams: ["original-to-reading-copy"]
adapters: []
relatedRecords: ["architecture-review-study-resources@1"]
decisions: []
incidents: []
features: []
capabilities: ["private-study-resources"]
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Issue #475","url":"https://github.com/Vinosaamaa/interview-arc/issues/475","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["tests/study-resource-website.bundle.test.mjs","tests/study-resource-uploader.test.mjs","tests/chatgpt-connector.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 475
pr: null
release: null
run: null
---
# Restore large originals and explicit ChatGPT file selection

Production uploads below one MiB succeeded, but larger originals returned a
plain HTTP 413 before the library's 25 MiB guard. Vinext probes multipart POSTs
as progressive server actions before dispatching API routes, applying its
smaller action limit and cloning the upload body. The Worker now sends only
resource POSTs directly to the existing bounded handler after authentication.
The handler retains the same-origin check, size checks and exact R2 readback.
Other routes and the framework's action limit are unchanged.

An in-chat picker supplies authorized host file handles when the model's
automatic attachment handoff supplies an unusable path or URL. It uses the
documented selection/upload and temporary-download APIs, followed by the same
private save tool. Retry state contains handles and operation IDs, without raw
bytes or temporary download URLs. Device uploads compare the local hash with
the confirmed stored original before reporting success. Unsupported hosts show
a limitation rather than claiming a save. No external widget assets are loaded.

The built website regression test crosses the real Worker entry point with a
two MiB multipart original, verifies exact download and replay identity, and
rejects oversized and cross-origin requests. Connector integration verifies the
registered picker and tool visibility; widget tests cover retries and missing
host APIs. Desktop and 390px previews caught an incorrectly visible retry button,
which was corrected. These local checks do not establish actual ChatGPT host
acceptance; the tracked E2E report records that gate separately.

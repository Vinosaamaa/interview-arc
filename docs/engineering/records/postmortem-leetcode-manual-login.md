---
schemaVersion: 1
id: postmortem-leetcode-manual-login
revision: 1
type: postmortem
status: closed
title: Separate manual LeetCode sign-in from browser automation
repository: interview-arc
capabilityIds: ["arc-connected-practice"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["The provider's exact rejection decision and post-transition authentication success remain unverified.", "Merge and release remain pending."]
modules: ["leetcode-playwright-controller"]
interfaces: ["controller-cli", "dedicated-browser-identity"]
seams: ["Manual authentication to automated browser control", "Browser process ownership to persistent profile state"]
adapters: ["scripts/leetcode-playwright-controller.mjs", "docs/postmortems/2026-09-09-leetcode-manual-login.md"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-connected-practice"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Manual login issue #450","url":"https://github.com/Vinosaamaa/interview-arc/issues/450","kind":"issue"},{"label":"Manual login PR #451","url":"https://github.com/Vinosaamaa/interview-arc/pull/451","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["tests/leetcode-controller-manual-login.test.mjs", "tests/leetcode-playwright-controller.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 450
pr: 451
release: null
run: null
---
# Separate manual LeetCode sign-in from browser automation

The controller lacked a user-operated authentication phase. It now reserves
manual sign-in under the existing dedicated profile and prevents automated
commands until the user explicitly finishes and that browser has exited.
Pending and terminal submission receipts remain intact. The controller never
stops a browser, resets a profile, copies authentication state, or claims login
success from launch readiness.

The [incident analysis](../../postmortems/2026-09-09-leetcode-manual-login.md)
records reported impact, verified source evidence, repair, tests, process-review
findings, and remaining release limits. Analysis is complete; provider
acceptance and delivery are not claimed.

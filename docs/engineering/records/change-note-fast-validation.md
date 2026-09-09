---
schemaVersion: 1
id: change-note-fast-validation
revision: 1
type: change-note
status: "released"
title: "Run isolated tests concurrently and deploy the validated Worker"
repository: "interview-arc"
capabilityIds: ["continuous-delivery"]
createdAt: "2026-09-09"
reconstructed: false
confidence: "verified"
unknowns: ["Hosted speed improvement remains subject to runner load and artifact availability."]
modules: ["test-runner", "cloudflare-deployment"]
interfaces: ["pnpm-test", "github-actions"]
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
sources: [{"label":"Issue #444","url":"https://github.com/Vinosaamaa/interview-arc/issues/444","kind":"issue"}]
visibility: "public-safe"
publicationEligibility: "eligible"
issue: 444
pr: null
release: null
run: null
verification: {"state":"verified","evidenceRefs":["585 source/unit/contract tests passed in 29.9 seconds without rebuilding.","Four real Worker integrations passed concurrently with independent persistence and ports.","Artifact selection regression rejects changed trees, failed or incomplete runs, different workflows, forks, and expired artifacts."]}
---
# Run isolated tests concurrently and deploy the validated Worker

The previous local complete test suite took 512.55 seconds. It forced every test
file to run serially, while a second global integration lock also serialized all
Worker tests. Main repeated PR validation, and publishing rebuilt the Worker.

## Change

The test runner executes at most four files concurrently. Worker integrations
retain private temporary persistence and dynamically allocated HTTP ports, use
ephemeral inspector ports, and share four bounded machine-wide slots.
`test:fast` omits Worker integrations and the built-bundle assertion for quick
local iteration; `test:prepared` runs the entire suite against a current build;
`test` still builds once and runs all tests. Lint caches unchanged files.

Draft PRs defer the full validation job until ready for review. Successful
validation uploads the exact built Worker with seven-day retention. A main push
reuses only an unexpired artifact from this repository's successful PR run of
the same workflow, with an identical Git tree. An unavailable or ineligible
artifact falls back to full validation. Production retains its environment
gate, migration preflight, migrations, content import, and bridge health check.
The website Worker deploys from validated build output, with no publish rebuild.

## Limits and rollback

Fast local checks do not replace complete CI or relevant integration coverage.
Prepared tests require a current build. Different source trees always revalidate.
Reverting this change restores serial tests and rebuilding during publication;
there are no application or schema changes.

---
schemaVersion: 1
id: change-note-banks-navigation-latency
revision: 1
type: change-note
status: released
title: Bound the Problem Banks navigation commit
repository: interview-arc
capabilityIds: ["problem-banks", "website-performance"]
createdAt: 2026-08-13
reconstructed: false
confidence: verified
unknowns: []
modules: ["problem-bank-navigation"]
interfaces: ["problem-bank-results"]
seams: ["bank-catalog-to-problem-list"]
adapters: ["banks-workspace"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["indexed-bank-lookups", "progressive-bank-mounting"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #315","url":"https://github.com/Vinosaamaa/interview-arc/issues/315","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["issue:315","tests/bank-navigation-performance.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 315
pr: 317
release: null
run: null
---
# Bound the Problem Banks navigation commit

The production-sized Problem Banks catalog contained hundreds of questions, but the Banks route mounted every result card and repeatedly searched attempts, Solution Profiles, and preferences before React could commit the selected workspace.

## Evidence

The owner-exported navigation trace recorded a 245.5 ms route commit, two main-thread tasks longer than 200 ms, and a 633.9 ms settled time without a reader or network wait. That isolated the delay to synchronous Banks rendering rather than D1, authentication, or transport latency.

## Change

The Banks Module now builds stable indexes for latest attempts, stars, Solution Profiles, and derived tags. The result Interface still reports and filters the complete catalog, while its website adapter mounts an initial window of 36 cards and adds bounded chunks through the existing internal list scroller.

Search and filter changes reset the mounted window without changing authoritative result counts. Scroll restoration grows the window before restoring a saved deep position, preserving the existing list/reader navigation contract.

## Verification

An isolated Chrome-for-Testing run against the compiled Worker and a copied local D1 state measured three Today-to-Banks transitions. Route commit completed in 10.4–23.2 ms and settled in 27.5–43 ms, with no long tasks or frame gaps. The initial 36-card window grew through scrolling, and an exact-title search returned its authoritative single result.

## Consequences

The initial Banks render cost is bounded independently of catalog size. The internal scroller retains the full searchable catalog and progressively pays DOM cost only when the owner requests more results. A visible status states how many matching results are mounted, avoiding any implication that the catalog was truncated.

---
schemaVersion: 1
id: architecture-review-engineering-evidence-workbench
revision: 1
type: architecture-review
status: proposed
title: Make Engineering an evidence workbench
repository: interview-arc
capabilityIds: ["engineering-journal", "website-navigation", "ambient-atmosphere"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["engineering-workspace", "workspace-shell", "reader-workspace"]
interfaces: ["engineering-journal-index", "engineering-record-reader", "engineering-evidence-panel", "workspace-atmosphere"]
seams: ["engineering-index-to-record", "engineering-record-to-evidence", "workspace-to-atmosphere"]
adapters: ["engineering-journal-web", "shared-reader-shell"]
relatedRecords: ["architecture-review-engineering-journal-module@1"]
decisions: []
incidents: []
features: []
capabilities: ["persistent-engineering-selection", "responsive-evidence-drawer", "explicit-ambient-mode"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Arc issue #329","url":"https://github.com/Vinosaamaa/interview-arc/issues/329","kind":"issue"},{"label":"Pull request #331","url":"https://github.com/Vinosaamaa/interview-arc/pull/331","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:329","tests/website-ui-regressions.test.mjs","tests/rendered-html.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 329
pr: 331
release: null
run: null
---
# Make Engineering an evidence workbench

The Engineering Journal already projected immutable records, pull-request receipts, and exact Git provenance. Its website adapter placed the index, record, Contents navigation, and evidence inside one fused sheet, which made document wayfinding compete with source verification and left wide screens underused.

## Decision

The Journal opens as three independent sibling panels: a bounded record index, the authoritative record, and an Evidence & Lineage panel. The record remains the widest surface. The index collapses without discarding its filters, selected record, or scroll position; the evidence surface becomes a drawer at compact widths; mobile exposes explicit Index and Evidence controls without horizontal overflow.

Contents navigation stays inside the record panel, while exact ref, commit, source path, verification state, lineage, and pull-request receipts stay in the evidence panel. Shared reader styling also normalizes outline typography and clips the opaque reader surface at its rounded boundary.

Engineering defaults to a restrained Rain atmosphere when no owner preference exists. Petals, Rain, and Off are explicit persistent choices. Both animations are pointer-transparent, bounded, paused in hidden documents and reader overlays, and disabled by reduced-motion preferences.

## Verification

Focused website and rendered-HTML regressions cover three-panel geometry, persistence, responsive transitions, bounded atmosphere behavior, reduced motion, reader opacity, rounded clipping, and normalized Contents typography. An isolated Chrome-for-Testing matrix exercised wide desktop, compact desktop, tablet, mobile, and a high-zoom-equivalent viewport without horizontal overflow or panel occlusion. The production build completed successfully.

## Consequences

Engineering is deliberately reader-first, while Interview Problem Banks remains list-first. The wider Engineering canvas pays for three independently useful surfaces on desktop and reduces to explicit drawers on smaller screens. Canonical Markdown, projection, provenance, privacy, and standalone export stay unchanged.

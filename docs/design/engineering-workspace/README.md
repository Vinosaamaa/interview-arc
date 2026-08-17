# Engineering workspace design reference

`continuity-ledger.svg` is the editable, public-safe successor to the original
Engineering composition supplied for Arc issue #249. `continuity-ledger.png`
is its rendered preview. They preserve the approved editorial list/reader
hierarchy while applying the later product decisions:

- Interview, Learn, and Engineering are the only top-level workspaces.
- Journey remains inside Interview and is not shown as shared Engineering UI.
- Engineering owns Journal, Capabilities, Decisions, Incidents, Case Studies,
  and Statistics.
- Journal exposes distinct `Rich records` and `All merged PRs` evidence layers,
  so complete compact coverage does not inflate every change into a case study.
- The record reader exposes exact revision and source-commit provenance.
- `Learn this` remains unavailable until the released Learn contract exists.

This asset is a design reference, not canonical Journal data or runtime UI.

## Approved workspace mockups (v2)

The complete desktop surface set in `mockups-v2/` was approved as the visual
direction on 2026-08-12:

- `00-overview.png` — complete seven-surface review board;
- `01-journal-rich-records.png` — curated rich-record index and reader;
- `02-journal-all-merged-prs.png` — complete compact pull-request timeline;
- `03-capabilities.png` — cross-repository capability atlas;
- `04-decisions.png` — chronological decision register;
- `05-incidents.png` — truthful empty incident register;
- `06-case-studies.png` — truthful empty case-study library;
- `07-statistics.png` — separate rich-record and PR-receipt coverage ledgers.

Issue #395 mockup: [`../engineering-statistics/`](../engineering-statistics/) redesigns Statistics in Journal workbench language; production Statistics is unchanged until review.

When Engineering is the selected top-level workspace, its left navigation rail
uses a near-black surface with the lime active signal. This black rail is an
Engineering workspace identity treatment; it does not require recoloring the
Interview or Learn workspaces. Shared chrome (50px bar, centered workspace
switch, icon tools, even bottom dock) follows
`design-system/pages/workspace-shell.md`. The light content canvas, exact-evidence drawer,
page-specific information architecture, and immutable evidence trace remain
shared motifs across Engineering views.

These raster mockups are visual targets rather than canonical data or exact-copy
fixtures. Record contracts and generated projections remain authoritative for
rendered facts. Visual implementation may follow the forward-contract release
without blocking its provenance, privacy, validation, or deployment gates.

`journal-module-architecture.drawio` is the editable, evidence-backed system
diagram for the tracer Architecture Review. `journal-module-architecture.png`
is the clean reader preview. `journal-module-architecture.drawio.png` embeds
the draw.io source for round-trip editing and is a delivery artifact rather
than the reader image.

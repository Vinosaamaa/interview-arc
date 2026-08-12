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

`journal-module-architecture.drawio` is the editable, evidence-backed system
diagram for the tracer Architecture Review. `journal-module-architecture.png`
is the clean reader preview. `journal-module-architecture.drawio.png` embeds
the draw.io source for round-trip editing and is a delivery artifact rather
than the reader image.

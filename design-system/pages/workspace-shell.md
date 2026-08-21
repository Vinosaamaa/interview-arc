# Workspace shell

Overrides `design-system/interview-arc/MASTER.md` for chrome shared by Interview, Learn, and Engineering. New workspaces add tokens and destinations, not a second shell.

## One bar

The application bar is exactly **50px** (`40px` controls). Grid: `minmax(0,1fr) auto minmax(0,1fr)` → `context | switch | actions`. Vertical center everything. Do not grow it, stack a second chrome row, or hide the centered switch.

| Slot | Always | Rules |
|------|--------|--------|
| Context | Home mark at ≤980px; empty on desktop | No destination title. No Pacific date. Keep `.topbar-context` for the brand slot; do not `display: none` the whole slot. |
| Switch | Interview · Learn · Engineering | Centered in the bar, not in leftover space. Equal-width segments. Active fill uses that workspace accent. |
| Actions | Music, atmosphere, tools | `40px` round controls. Drop *labels*, then widgets. Never collide with the switch. |

At **≤980px**: hide the sidebar. Put the canonical favicon (`/favicon.svg`) on the context row. Local destinations move to the bottom dock. Do not squeeze the destination rail to 190px or 82px, and do not leave a leftover 64–74px icon strip above the bar.

At **≤480px**: hide the music dock; keep atmosphere + tools at `36px`.

## Sidebar (desktop)

One pigment **masthead** from the top of the sidebar through the product brand and the active workspace name (`Interview`, `Learn`, or `Engineering`). Brand and name share that one color; the rule above the destination list is the bottom edge. It is a display plate, not a badge and not a switch. Then the numbered destination list for that workspace (`01` …). Interview keeps Career Materials as the private folio card under the list. Never list another workspace’s pages, and never put a second Interview / Learn / Engineering switch in the sidebar.

## Tools

One `40px` link-icon control on every workspace. Menu: **Pop out timer**, **Connect**, **Export today**. No header text. Timer stays available off Today; disable it only when Document Picture-in-Picture is missing.

## Bottom dock (≤980px)

`.mobile-interview-nav` is the only local nav. Tabs **evenly fill** the dock (`repeat(N, minmax(0,1fr))`, `width:100%`). Do not share Interview’s 7-column grid with fewer tabs.

| Workspace | N | Tabs |
|-----------|---|------|
| Interview | 7 | Today, Loops, Reviews, Past, Banks, Journey, Materials |
| Learn | 4 | Today, Courses, History, Statistics |
| Engineering | 6 | Journal, Capabilities, Decisions, Incidents, Case Studies, Statistics |

## Atmosphere

Petals · Rain · Off. Interview defaults **petals**; Engineering defaults **rain**; explicit choice persists. Pointer-events none. Pause on hidden document, open reader, and `prefers-reduced-motion`.

Rain is CSS falling streaks (`.ambient-rain-drop`): teal 2px trails with a splash ripple, denser than petals. No canvas.

## New workspace

1. Add one switcher segment and one `.active-workspace-*` token set (`docs/engineering/records/adr-workspace-atmosphere-token-boundary.md`).
2. One full-width current-workspace nameplate, then numbered local nav (`01` …) for that workspace only. Destination accents on hero, selected nav, focus, and quiet panel tints only.
3. Reuse this 50px bar, centered switch, icon tools, and even dock. Destination pages use the `350px` top-panel primitive in MASTER (eyebrow, display statement, quote, supporting copy, summary band). The lower summary band is one shared component across Interview, Learn, and Engineering: exact `50px`, three equal segments, editorial value first, compact label second, and short vertical separators. Workspace and destination accents change through tokens, never through different geometry or type hierarchy. Problem Banks keeps its documented interactive-selector exception while preserving the same height and value/label hierarchy.
4. Gutters show the workspace canvas; major panes are opaque `--workspace-paper`.

## Do not

- Restore #345: Overview/Decision/Contract/Verification pills, extra Architecture/Interview tabs, edge `》`/`《` Journal/Evidence disclosures, collapsing `0px` rails, peach contents pills, `Show Journal index`.
- Squeeze the destination sidebar until labels overlap; go to the dock instead.
- Put Pop out timer / Connect / Export today back in the bar as text labels.
- Put destination title or Pacific date back in the header.
- Put a second Interview / Learn / Engineering switch in the sidebar, or show another workspace’s pages in the current sidebar.
- Recolor success, failure, evidence, or specialty semantics to match a destination.

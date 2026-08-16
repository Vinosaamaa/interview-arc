---
name: "Interview Arc"
description: "A calm, exact, evidence-first editorial instrument for durable practice and engineering continuity."
colors:
  shell: "#102d2d"
  canvas: "#edf3f1"
  canvas-deep: "#dfe9e6"
  sheet: "#fbfcfa"
  sheet-soft: "#f3f7f5"
  reader-sheet: "#fffefa"
  ink: "#102a2a"
  muted: "#617470"
  line: "#c8d8d3"
  line-soft: "#dfe9e5"
  primary: "#0d9488"
  primary-deep: "#0f5f5a"
  signal: "#b9db57"
  signal-dark: "#42561b"
  warm: "#df663f"
  coding: "#d95f45"
  coding-soft: "#fff0eb"
  system: "#5869c9"
  system-soft: "#eef0ff"
  behavior: "#8d5aa8"
  behavior-soft: "#f5edfa"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(2.2rem, 4.2vw, 4.1rem)"
    fontWeight: 650
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 730
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  inline-code: "5px"
  control: "8px"
  soft-control: "9px"
  panel: "14px"
  sheet: "20px"
  pill: "999px"
components:
  action-primary:
    backgroundColor: "{colors.primary-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  action-primary-hover:
    backgroundColor: "#0b514d"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  action-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "#31504c"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  engineering-nav-item:
    backgroundColor: "transparent"
    textColor: "#b7c9c5"
    rounded: "{rounded.soft-control}"
    padding: "0 12px"
    height: "48px"
  engineering-nav-item-active:
    backgroundColor: "{colors.signal}"
    textColor: "#15362f"
    rounded: "{rounded.soft-control}"
    padding: "0 12px"
    height: "48px"
  search-field:
    backgroundColor: "#ffffff"
    textColor: "#173b37"
    rounded: "{rounded.soft-control}"
    padding: "0 11px"
    height: "42px"
  status-chip:
    backgroundColor: "#e5f0ec"
    textColor: "#285c54"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 8px"
  journal-layer-switch:
    backgroundColor: "#e7f0ed"
    textColor: "#58716a"
    rounded: "0"
    padding: "8px 14px"
    height: "58px"
  journal-layer-switch-active:
    backgroundColor: "#ffffff"
    textColor: "#124a42"
    rounded: "0"
    padding: "0 9px"
    height: "42px"
  record-row:
    backgroundColor: "transparent"
    textColor: "#173a35"
    rounded: "0"
    padding: "18px 20px 17px"
    height: "138px"
  record-row-active:
    backgroundColor: "#ffffff"
    textColor: "#0c6f66"
    rounded: "0"
    padding: "18px 20px 17px"
    height: "138px"
  receipt-timeline-row:
    backgroundColor: "transparent"
    textColor: "#173a35"
    rounded: "0"
    padding: "18px 42px 17px 45px"
    height: "126px"
  reader-sheet:
    backgroundColor: "{colors.reader-sheet}"
    textColor: "#304d48"
    rounded: "{rounded.panel}"
    padding: "32px clamp(28px, 6vw, 84px) 72px"
---

# Design System: Interview Arc

## Overview

**Creative North Star: "The Continuity Ledger"**

Interview Arc is a calm, exact, evidence-first editorial instrument. It should feel like a durable ledger for consequential work: factual enough to trust, composed enough to read for long periods, and dense enough to keep related evidence visible without becoming a generic analytics dashboard.

The visual world moves from a deep-teal operating shell through a pale mineral field into cream reading sheets. Geist carries controls and prose, Geist Mono marks immutable references and compact facts, and Newsreader gives records and section headings an editorial voice. The system is predominantly flat: tonal layers, one-pixel rules, and typographic hierarchy establish structure before restrained shadows do.

Desktop surfaces keep an index and its selected record in one continuous instrument. Journal makes two complementary evidence layers explicit: **Rich records** for material architecture, decision, incident, capability, and retrospective narratives, and **All merged PRs** for the complete compact change timeline. Smaller screens preserve the same hierarchy by switching explicitly between list and reader. Expression comes from exact alignment, warm paper, selective teal, and rare lime signal—not decorative card grids, glassy chrome, or contest theater.

**Key Characteristics:**

- Deep-teal shell framing a pale mineral canvas and cream reading sheets.
- Newsreader editorial headings over Geist body copy with Geist Mono factual identifiers.
- Flat bordered instruments with hairline rules as the primary structure.
- Lime reserved for current state; teal reserved for action, focus, and provenance.
- An explicit Rich records / All merged PRs switch that never conflates narrative depth with pull-request coverage.
- Dense desktop split views that become explicit list-or-reader flows on mobile.

## Colors

The palette is botanical but technical: cool mineral neutrals carry most of the screen, deep teal supplies authority, and lime appears only when the current state needs to be unmistakable.

### Primary

- **Ledger Teal** (`#0d9488`, `colors.primary`): Focus borders, provenance nodes, active links, progress, and affirmative interaction feedback.
- **Deep Ledger Teal** (`#0f5f5a`, `colors.primary-deep`): Primary actions and high-emphasis interactive text where full teal would feel too bright.
- **Lime Signal** (`#b9db57`, `colors.signal`): The selected local destination, live state, and the compact brand mark; use sparingly.
- **Signal Ink** (`#42561b`, `colors.signal-dark`): Dark companion text and icons placed on lime or pale-lime surfaces.

### Secondary

- **Warm Action** (`#df663f`, `colors.warm`): Exceptional warm emphasis and selected chart state, never a competing default action color.
- **Coding Coral** (`#d95f45`, `colors.coding`) with **Coding Wash** (`#fff0eb`, `colors.coding-soft`): Redundant coding-category identification.
- **System Indigo** (`#5869c9`, `colors.system`) with **System Wash** (`#eef0ff`, `colors.system-soft`): Redundant system-design identification.
- **Behavioral Violet** (`#8d5aa8`, `colors.behavior`) with **Behavioral Wash** (`#f5edfa`, `colors.behavior-soft`): Redundant behavioral identification.

### Neutral

- **Deep Teal Shell** (`#102d2d`, `colors.shell`): The persistent workspace rail and dark code surfaces.
- **Mineral Canvas** (`#edf3f1`, `colors.canvas`) and **Deep Mineral Canvas** (`#dfe9e6`, `colors.canvas-deep`): The application field and its quieter tonal layer.
- **Working Paper** (`#fbfcfa`, `colors.sheet`) and **Soft Working Paper** (`#f3f7f5`, `colors.sheet-soft`): Controls, index tools, and ordinary work surfaces.
- **Cream Reader Sheet** (`#fffefa`, `colors.reader-sheet`): Long-form records and evidence reading.
- **Teal-Black Ink** (`#102a2a`, `colors.ink`) and **Muted Evidence Ink** (`#617470`, `colors.muted`): Primary and supporting text.
- **Hairline Rule** (`#c8d8d3`, `colors.line`) and **Soft Hairline Rule** (`#dfe9e5`, `colors.line-soft`): Structural boundaries, dividers, and low-emphasis separation.

**The Signal Rarity Rule.** Lime identifies current, live, or unmistakably selected state; it is not a general-purpose panel fill.

**The Evidence Color Rule.** Teal may signal action, focus, and provenance. Specialty colors identify practice categories only, always with text or icon reinforcement.

**The Paper Stack Rule.** Deep shell, mineral canvas, mint index, and cream reader form the normal tonal depth sequence.

## Typography

**Display Font:** Newsreader (with Georgia fallback)

**Body Font:** Geist (with Arial fallback)

**Label/Mono Font:** Geist Mono (with a system monospace fallback)

**Character:** Newsreader makes durable records feel authored and readable without making the operating shell ornamental. Geist keeps the workspace compact and direct; Geist Mono gives immutable evidence a distinct, inspectable texture.

### Hierarchy

- **Display** (650, `2.2rem–4.1rem` fluid, 0.98): Record titles and major Engineering view headings; the normative scale is `clamp(2.2rem, 4.2vw, 4.1rem)`, and display lines stay short and balanced.
- **Headline** (700, `2rem`, 1.08): Reader section headings and durable subsections.
- **Title** (700, `1.25rem`, 1.25): Nested content headings and compact panel titles.
- **Body** (400, `1rem`, 1.75): Reading copy on cream sheets, constrained to about `72ch`; summaries may widen to `70ch` but should not become full-canvas text.
- **Label** (730, `0.75rem`, 1.2): Record types, dates, references, paths, and compact facts in Geist Mono. Uppercase factual labels may add `0.07em` tracking.

**The Editorial Restraint Rule.** Newsreader belongs to record titles, section headings, large factual numerals, and selective long-form emphasis; controls and dense metadata remain Geist or Geist Mono.

**The Exactness Rule.** Immutable references, commits, paths, dates, and compact measurements use mono; paragraph text never does.

## Layout

The desktop shell uses a fixed `216px` workspace rail, a sticky `72px` topbar, and a content field capped at `1460px`. Engineering's principal instrument is one bordered two-pane grid: a `292–340px` evidence index beside a flexible reader. Journal keeps a `58px` two-option layer switch directly beneath the index heading. **Rich records** exposes the searchable material-record index; **All merged PRs** replaces that index with its own searchable, repository- and classification-filterable receipt timeline while leaving the reading context beside it. The reader body caps at `1050px`, uses fluid inline gutters (`clamp(28px, 6vw, 84px)`), and keeps narrative content near `72ch`.

Spacing follows an observed compact rhythm rather than a named token scale: `4–12px` for internal control relationships, `18–22px` for rows and compact panels, `28–32px` for reader starts, and `42–48px` for major section separation. Repeated facts use aligned grid cells and one-pixel rules instead of isolated metric cards.

Statistics preserves the same distinction at page scale: one section reports rich-record type, status, provenance, and chronology; a separately headed Pull request coverage section reports receipt totals, complete merge facts, reconstructed receipts, missing facts, classifications, repositories, timeline range, and full receipt chronology. At `1120px`, four-column fact and statistic groups become two columns. At `900px`, the workspace selector becomes a sticky top bar and the local Engineering destinations move to the bottom navigation. At `760px`, the two-pane Journal becomes a list-or-reader flow with an explicit back control; choosing All merged PRs keeps the receipt list as the active mobile task. At `460px`, provenance and fact grids become single-column and receipt controls retain coarse-pointer targets of at least `44px`.

**The Ledger Pair Rule.** On desktop, the index and selected record remain two halves of one bordered instrument; do not split them into a card gallery.

**The Single-Task Mobile Rule.** Below the master-detail breakpoint, show the list or the reader at full width and preserve an explicit route back.

**The Two-Layer Legibility Rule.** Never imply that rich-record count equals pull-request coverage; name, count, filter, and report the two evidence layers independently.

## Elevation & Depth

The system is flat by default. The Engineering ledger, record rows, filters, facts, statistics, and reading sheet use tonal layering and one-pixel borders without resting shadows. Restrained shadows belong to the global sticky frame, transient overlays, and controls that genuinely float above content.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px rgba(16, 42, 42, .04)`): Tiny separation on compact controls or factual blocks.
- **Ambient** (`0 8px 22px rgba(16, 42, 42, .055)`): Sticky or grouped surfaces that need gentle separation from the mineral canvas.
- **Floating** (`0 22px 54px rgba(16, 42, 42, .09)`): Menus, popovers, and modal-level surfaces only.

**The Flat Ledger Rule.** Operational surfaces rest on tone and one-pixel rules; shadows indicate real stacking, not component importance.

**The Border Before Shadow Rule.** Establish hierarchy with background tone, alignment, and a boundary before adding elevation.

## Shapes

Forms are rectilinear with controlled softness. Inline code uses a tight `5px` corner, ordinary controls use `8px`, navigation and search commonly use `9px`, bordered panels use `14px`, and major work surfaces use `20px`. Fully rounded `999px` forms are reserved for compact status, category, and topic chips.

Borders are normally `1px` cool-teal hairlines. The Engineering ledger clips its index and reader into one `14px` outer silhouette. Circles belong to provenance nodes, avatars, live indicators, and quiet background geometry—not ordinary containers.

**The Instrument Shape Rule.** Use the smallest radius that preserves comfort and grouping; never inflate dense evidence controls into oversized capsules.

## Components

Components should read as precise instruments: quiet at rest, explicit on hover and focus, and structurally connected to the evidence they operate on.

### Buttons

- **Shape:** Standard actions are `42px` high with an `8px` radius and `0 16px` horizontal padding.
- **Primary:** Deep Ledger Teal background, white text, and only the Whisper shadow at rest.
- **Hover / Focus:** Hover darkens to `#0b514d` and may lift `2px`; keyboard focus uses the shared `3px` translucent teal outline with `3px` offset.
- **Secondary / Utility:** Secondary actions use Working Paper with a cool-teal border. Engineering copy controls are smaller (`30px` minimum height, `7px` radius) and stay transparent until hover.
- **Disabled:** Disabled actions remain visible as factual constraints, use quiet grey-green surfaces, and never imply availability through hover motion.

### Chips

- **Style:** Status chips use a full pill, `5px 8px` padding, compact bold text, and a low-chroma contextual surface.
- **State:** Accepted and ordinary states use mint; amended or superseded records use warm clay; reconstructed records use muted violet. Every chip includes a text label.

### Cards / Containers

- **Corner Style:** The primary Engineering instrument uses the `14px` panel radius; reader content itself is visually continuous rather than card-stacked.
- **Background:** Pale mint for the index, pure white for the selected row, and Cream Reader Sheet for narrative evidence.
- **Shadow Strategy:** No resting shadow inside the ledger; see Elevation & Depth.
- **Border:** One-pixel cool-teal rules define the outer frame, row sequence, fact register, and table cells.
- **Internal Padding:** Record rows use `18px 20px 17px`; reader content uses fluid horizontal gutters and `32px` top / `72px` bottom space.

### Inputs / Fields

- **Style:** The search field is `42px` high with an `8–9px` radius, white background, `1px` cool-teal border, and an inline stroke icon. Selects are `38px` high with an `8px` radius.
- **Focus:** The containing field shifts to Ledger Teal and gains `0 0 0 3px rgba(13, 148, 136, .12)`; the inner input does not add a competing outline.
- **Error / Disabled:** Preserve the field silhouette and communicate state with text plus border or surface color, never color alone.

### Navigation

- **Style:** The desktop rail is Deep Teal Shell with compact stroke icons and Geist labels. Workspace selection uses a deeper teal field; the selected Engineering destination uses Lime Signal with dark text.
- **Hover / Focus:** Hover shifts local destinations by no more than `2px` and applies a translucent light surface. Focus keeps the shared visible teal outline.
- **Mobile:** The top bar owns workspace selection while a fixed bottom rail owns the six Engineering destinations.

### Journal Evidence-Layer Switch

- **Structure:** Two equal-width controls sit in one `58px` pale-mint register directly below the Journal heading. Each keeps its literal label and independent count: **Rich records** and **All merged PRs**.
- **State:** The pressed option uses a white field, dark-teal text, and a `2px` Ledger Teal bottom rule. Hover remains a quiet translucent-paper shift; keyboard focus uses the shared teal outline.
- **Behavior:** Switching layers swaps the index filters and list without rewriting the selected rich-record evidence. On mobile, All merged PRs returns focus to the complete receipt list; choosing a receipt's rich-record reference deliberately returns to Rich records and opens that record.

### Pull Request Receipt Timeline

- **Structure:** Every receipt is one compact expandable row (`126px` minimum height) on a continuous `1px` teal timeline with a circular teal node. The collapsed state shows timeline date, repository, and a `PR #<number>` link to the original GitHub pull request, plus title, classification, and whether chronology uses verified merge facts or a source-commit fallback. Clicking the PR link navigates; it does not merely toggle the row.
- **Expanded Evidence:** Summary, receipt reference, timeline basis and commits, canonical source, confidence, missing facts, unknowns, evidence links, rich-record references, and the exact receipt source remain inside the row instead of becoming detached cards.
- **Materiality:** Small changes stay visible as compact receipts with an explicit “no rich record required” note. Material receipts may link to one or more rich records; the compact chronology never disappears merely because deeper narrative exists.

### Pull Request Coverage Ledger

Rich-record statistics and pull-request coverage are two separately titled ledger sections. Reuse aligned fact cells, bordered tables, and full-width chronology rows; never combine the totals into one ambiguous “engineering activity” metric.

### Provenance Register

The provenance register is the signature component. A teal node, horizontal rules, mono record/commit/path values, copy controls, and an Exact source action make source truth visible before narrative detail. Revision lineage repeats the same node-and-rule grammar; derived state never visually overwrites its accepted source.

### Record Reader

The reader is a cream editorial sheet with a short mono classification line, a large Newsreader title, a readable summary, the provenance register, aligned fact cells, and a `72ch` narrative column. Inline code uses a pale mint lozenge; code blocks use Deep Teal Shell with explicit light text.

### Evidence-Backed Diagrams

Architecture diagrams sit inside the record reading flow after its fact register. The rendered asset uses a quiet white frame with a `1px` cool-teal border and `10px` radius; its caption names the diagram, states what it proves, and exposes separate immutable links to the exact rendered asset and editable draw.io source. Serve the exact commit-pinned bundled bytes and retain descriptive alternative text; a diagram supplements the record's textual evidence rather than replacing it.

### Rich-Record Pull Request History

When compact receipts cite a rich record, render a **Pull request history** backlink section after Evidence. Each hairline-separated row pairs repository with a `PR #<number>` link to the original GitHub pull request, the factual title, and an **Exact receipt** action for the receipt markdown permalink. The copy must explicitly state that receipt coverage remains independent from record status and verification.

**The Evidence Asset Rule.** A diagram or pull-request backlink belongs in a rich record only when its exact source remains visible and its relationship to the record is evidence-backed.

## Do's and Don'ts

### Do:

- **Do** preserve the deep-shell → mineral-canvas → mint-index → cream-reader sequence.
- **Do** reserve lime for current, live, or selected state and teal for action, focus, and provenance.
- **Do** use one-pixel rules and aligned registers to organize dense factual material.
- **Do** set immutable references, commits, paths, dates, and measurements in Geist Mono.
- **Do** preserve the literal Rich records / All merged PRs labels, their independent counts, and their separate filters.
- **Do** keep every ingested merged PR visible in the compact timeline while reserving rich records for material narratives.
- **Do** expose related pull-request receipts and exact diagram source/render links inside the rich-record reading flow.
- **Do** link every visible `PR #<number>` to the original GitHub pull request and keep Exact receipt source as the markdown permalink.
- **Do** switch the Journal to an explicit list-or-reader flow below `760px`.
- **Do** keep visible focus states, text reinforcement for color, and reduced-motion behavior.

### Don't:

- **Don't** turn the Engineering Journal into a generic card, bento, or analytics-dashboard grid.
- **Don't** use lime as a decorative wash or as a practice-category color.
- **Don't** add glassy, neumorphic, or ubiquitous shadow treatment to flat evidence surfaces.
- **Don't** use Newsreader for controls, dense metadata, or long identifiers.
- **Don't** hide exact source, revision lineage, or verification context behind decorative summary cards.
- **Don't** imply that a missing rich record means a merged pull request is absent from the complete timeline.
- **Don't** flatten receipt coverage and rich-record verification into one statistic or one chronology.
- **Don't** render an architecture diagram as decorative media without its evidence summary and immutable rendered/source links.
- **Don't** rely on color alone to communicate category, status, verification, or selection.

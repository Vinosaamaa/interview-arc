# Interview Arc Design System — Practice Instrument

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.
> Shared Interview / Learn / Engineering chrome is `design-system/pages/workspace-shell.md`.
> The Product-specific refinement below overrides the generated Soft UI Evolution defaults.

---

**Project:** Interview Arc
**Generated:** 2026-07-21 10:38:14
**Category:** Productivity Tool
**Design Dials:** Variance 7/10 (Balanced / Modern) | Motion 6/10 (Standard) | Density 7/10 (Standard)

---

## Product-specific refinement

The generated Soft UI Evolution recommendation is refined into a distinctive
**calm paper-and-instrument interface**:

- **Today is a live workbench.** Timers, current focus, and activity state carry
  the strongest visual hierarchy.
- **Journey is an evidence room.** Charts are legible instruments rather than
  decorative cards.
- **Past is a case archive.** Reading surfaces prioritize notes, transcripts,
  timelines, and answer audio.
- **Problem banks are a discovery index.** Dense, scan-friendly rows beat a
  generic card grid.
- One **50px application bar** and one centered Interview / Learn / Engineering
  switch unify the product. Below 900px, local destinations become an
  even-spread bottom dock. Follow `design-system/pages/workspace-shell.md`.

### Refined tokens

| Role | Hex |
|------|-----|
| Mineral canvas | `#EDF3F1` |
| Paper | `#FBFCFA` |
| Teal-black ink | `#102A2A` |
| Muted ink | `#617470` |
| Hairline | `#C8D8D3` |
| Primary teal | `#0D9488` |
| Deep teal | `#0F5F5A` |
| Warm action | `#DF663F` |
| Coding | `#D95F45` |
| System design | `#5869C9` |
| Behavioral | `#8D5AA8` |

Use Geist for UI/body, the existing editorial serif for display and long-form
reading, and Geist Mono for timers and metrics. Use color only as a redundant
signal. Reserve pills for compact status and topic chips. Use 8px controls,
14px panels, and 20px major work surfaces. Motion is 180–260ms and must yield
to `prefers-reduced-motion`.

### Interview page top-panel system

Every base page in the Interview workspace—**Today, Loops, Reviews, Past,
Banks, Journey, and Career Materials**—starts with one bounded editorial top
panel immediately below the persistent top bar. This is a shared page-shell
primitive, not a page-specific hero treatment. A page being released later
does not exempt it from this geometry.

| Token | Value | Contract |
|------|------:|------|
| `--interview-top-panel-top-gap` | `25px` | Exact visual space from the bottom edge of the persistent top bar to the top-panel border |
| `--interview-top-panel-height` | `350px` | Exact fixed outer height on every Interview page |
| `--interview-top-panel-narrative-height` | `300px` | Exact upper zone for the page statement, supporting copy, and optional illustration |
| `--interview-top-panel-summary-height` | `50px` | Exact lower summary band for truthful metrics or compact page state |
| `--interview-panel-gap` | `20px` | Exact gap between sibling page-level panel border boxes in the main page flow |

- The panel owns the page eyebrow, primary heading or statement, concise
  supporting copy, and only the highest-value summary metrics or controls.
  Secondary controls and growing collections belong in the page body.
- Today, Loops, and Reviews must converge on this same shell geometry while
  retaining their distinct internal compositions. Past, Banks, and Journey
  must move their current loose title, introduction, and summary content into
  the top panel; Career Materials must move its current loose résumé heading,
  introduction, and highest-value revision summary into the same primitive.
  Do not leave a free-floating page heading on the canvas.
- Every top panel uses one shared vertical anatomy: an exact `300px` narrative
  field above and an exact `50px` bottom summary zone below, producing one
  `350px` outer panel. These are layout zones inside one continuous surface,
  not two visibly stacked components. Except for Banks, do not draw a
  full-width horizontal divider at their boundary; use only short vertical
  separators between summary groups. The summary zone has one fixed height,
  divider treatment, metric-number size, metric-label size, and baseline
  alignment across pages. The number of truthful metrics may vary; absent
  metrics are omitted rather than fabricated, and the remaining cells divide
  the available width evenly.
- Banks is the sole structural exception: its exact `50px` lower zone is a
  full-width three-segment interactive selector for Coding, System Design, and
  Behavioral. A visible boundary and segment dividers are allowed because each
  segment expands its corresponding bank panel. The selector still remains
  inside the same `350px` top-panel border box. Its selector grid spans the
  complete inner width of the panel and its three equal columns consume that
  width; it must never inherit a metric grid cell or collapse into only the
  narrative column. A closed disclosure rail contributes no layout height or
  margin, so the next Banks panel begins at the shared exact `20px` panel gap.
- Page-specific high-definition botanical artwork may occupy the narrative
  field's supporting side. Ship it as responsive SVG/vector geometry with a
  stable `viewBox`, decorative `aria-hidden` semantics, and no embedded raster
  image. It must crop or simplify at narrow widths without changing the fixed
  panel height, obscuring copy, or becoming the only carrier of meaning.
- The top panel is one semantic region and one visual container. It must remain
  visually separate from the first body panel; never merge the masthead and
  the page's primary list, reader index, or analytics surface into one sheet.
- Major panels below every page hero begin after one exact `20px` gap. The
  Today orchestration rail is a major panel and follows this rule even when it
  is empty.
- On desktop, the closed Banks discovery surface consumes the viewport space
  below its `350px` top panel and exact `20px` panel gap. Its outer border ends
  about `20px` above the browser edge, its controls remain in the panel, and
  the problem rows scroll inside the remaining track. The page itself must not
  grow merely because the bank contains more rows. Expanded domain desks,
  readers, and mobile layouts keep their own documented flow behavior.
- Loops uses one workspace-owned `1px` chronology spine from the hero boundary
  to the center of the terminal state. Child panels and the stage list must not
  draw overlapping spine segments; nodes cover the line at intersections and
  the terminal circle covers its endpoint.
- The full job-description source opens as a large passive Loop dossier: a
  fixed pink-accented header, one vertically scrolling body, a sticky compact
  provenance band, and a readable document measure. It preserves the private
  source boundary, traps focus, never scrolls horizontally, and restores focus
  to its opener when dismissed.
- The top panel remains exactly `350px` tall at every supported width and zoom
  level. When content would exceed that fixed height, reflow or remove
  secondary decoration and move lower-priority content into the body. Never
  grow or shrink the panel, clip it, add an internal scrollbar, or reduce
  required text below the typography floor.
- The `25px` top gap remains visually consistent on desktop and mobile. Safe
  area insets are resolved by the shell outside this measurement.
- A **panel** is a major bordered page-level surface: for example the top
  panel, Loop identity, Role context, Linked preparation, a Round dossier, the
  Review Queue shell, a Past archive surface, a Banks index surface, or a
  Journey analytics surface. Sibling panels in the main page flow use one
  exact `20px` gap between their outer borders at every supported width; their
  parent owns that gap and panels must not add competing outer margins. The
  `25px` top-bar-to-top-panel gap is the sole page-shell exception. Cards,
  review/problem rows, material rows, chips, buttons, fields, and other
  components nested inside a panel keep their own component spacing and do not
  inherit `--interview-panel-gap`.
- Base-page readers and modal detail surfaces may cover or replace the panel
  while open; they do not create a second top panel. Background page content
  remains inert and fully obscured according to the reader contract.

### Interview page accent identities

Each Interview page has a stable accent identity. The accent is a page-level
token, not top-panel decoration: it frames the top panel, selected navigation
item, chronology or list markers, interactive controls, focus rings, selected
states, and the quiet tint/border treatment of cards nested on that page. Use
the pale tint for card surfaces and the accent ink for affordances so the page
reads as one visual family without saturating every container. Page accents
never replace specialty colors, result/status colors, destructive colors, or
evidence semantics; for example, Loops uses blossom pink for its page grammar
while green remains reserved for explicit completion and success.

| Page | Accent ink | Pale tint | Accent on dark navigation |
|------|------|------|------|
| Today | `#667A0F` | `#F1F7D5` | `#C7DF65` |
| Loops | `#A8415C` | `#FBE8EE` | `#F08AA3` |
| Reviews | `#8A6500` | `#FFF3C4` | `#E8C44D` |
| Past | `#354542` | `#ECEFED` | `#D5DEDB` |
| Banks | `#4859A7` | `#E9ECFA` | `#9DACF1` |
| Journey | `#0E736C` | `#DFF3F0` | `#69C8BE` |
| Career Materials | `#7A4D30` | `#F5E9DD` | `#D8A97F` |

The selected left-navigation row uses the current page's accent-on-dark color
for its index, icon, and label, plus a quiet tinted rail/background. Unselected
rows stay neutral. Page accents must pass contrast requirements in their exact
rendering context and remain a redundant signal rather than the only state cue.

### Workspace atmospheres and destination tokens

Interview, Learn, and Engineering share one shell geometry, navigation order,
typography hierarchy, breakpoint system, focus behavior, and accessibility
contract. They do not share one visual atmosphere. Theme changes are expressed
through tokens, never by duplicating shell markup or changing its dimensions.
Chrome anatomy (50px bar, always-visible title, centered switch, icon tools,
even bottom dock) is owned by `design-system/pages/workspace-shell.md`.

- **Interview** is deep evergreen with botanical color and restrained paper
  surfaces. Its seven destination accents remain defined by the table above.
- **Learn** is warm ivory and dark ink with a blue secondary voice. Today,
  Courses, History, and Statistics each own a distinct destination accent.
- **Engineering** is near-black graphite with alpine teal, oxidized copper,
  mist, and technical paper. Journal, Capabilities, Decisions, Incidents, Case
  Studies, and Statistics each own a distinct destination accent. Its local
  navigation uses the same numbered grammar as Interview and Learn; it does not
  substitute decorative icons for navigation order.

Token ownership has four explicit layers:

1. global geometry and typography;
2. workspace canvas, sidebar, ink, keyline, and focus tokens;
3. destination accent, pale surface, and strong-on-dark accent tokens;
4. semantic state and specialty tokens, which always override decoration.

The active destination carries its accent into the hero, major panels,
keylines, selected controls, buttons, focus rings, disclosures, and restrained
highlights. Do not recolor failure, success, evidence, warning, Coding, System
Design, or Behavioral semantics merely to match the destination.

Direct links, refreshes, browser Back/Forward, and workspace switching must
paint the correct workspace and destination atmosphere on the first rendered
frame. Server and client initialize from the same URL state; a later effect may
restore session-only preferences only when the URL does not explicitly own the
choice. Never flash Interview styling while loading Learn or Engineering.

Forced-colors mode retains visible selection and focus boundaries. Reduced
motion removes theme transitions without changing state. Color remains a
redundant cue: active navigation also carries `aria-current`, text, and a
structural keyline.

### Loops stage interaction

The Loops dossier uses one continuous in-flow chronology. Role context, linked
preparation, completed/planned stages, and the terminal state all attach to the
same vertical spine; none becomes a detached dashboard, modal, or side panel.

- A completed stage is an inline accordion. Its compact state keeps the stage
  name, semantic status, date, populated-record summary, and expand affordance
  visible. Expanding it moves later stages downward in normal document flow;
  collapsing it returns to the compact strip without losing scroll context.
- An expanded interview stage begins with its header and, when present, one
  short stage-material card with the material title, immutable revision, and
  an explicit **Open guide** action. Do not render an empty material card.
- Each remembered interview question is one inline accordion card. Its compact
  header keeps the question title, the explicit owner-selected Strong, Mixed,
  or Needs work assessment, and its expand affordance visible. The entire
  header is the trigger; only the selected question expands, while sibling
  question cards stay compact and move in normal flow.
- The expanded question body keeps **Question context**, **My approach**, and
  **My review** together. My review records what went well and what to improve;
  it never asks the owner to reconstruct or republish a verbatim answer.
  Long content remains readable inside the expanded card without creating a
  detached reader or replacing the stage chronology.
- The stage ends with its explicit status/result. Do not render separate round
  self-assessment or interviewer-feedback cards. Legacy round-level fields
  remain readable for immutable historical revisions but are not solicited or
  foregrounded in this interaction.
- Final owner-approved visual interaction reference:
  `.impeccable/mocks/loops-hr-question-cards-v3.png`. The prior v2 question
  card reference is historical and superseded.
- At desktop widths the expanded question body may use three balanced columns
  for context, approach, and review. At narrow widths those sections stack in
  that DOM/focus order. Component gaps inside the stage are not the `20px`
  page-panel gap.
- Expansion uses one 180–260ms ease-out height/reveal transition. Under
  `prefers-reduced-motion`, content changes immediately without losing focus.
  The trigger exposes `aria-expanded`/`aria-controls`, and focus remains on the
  trigger through both transitions.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#0D9488` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#14B8A6` | `--color-secondary` |
| Accent/CTA | `#EA580C` | `--color-accent` |
| Background | `#F0FDFA` | `--color-background` |
| Foreground | `#134E4A` | `--color-foreground` |
| Muted | `#E8F1F4` | `--color-muted` |
| Border | `#99F6E4` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| Ring | `#0D9488` | `--color-ring` |

**Color Notes:** Teal focus + action orange [Accent adjusted from #F97316 for WCAG 3:1]

### Typography

- **Heading Font:** Lora
- **Body Font:** Raleway
- **Mood:** calm, wellness, health, relaxing, natural, organic
- **Google Fonts:** [Lora + Raleway](https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 7/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #EA580C;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #0D9488;
  border: 2px solid #0D9488;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #F0FDFA;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #0D9488;
  outline: none;
  box-shadow: 0 0 0 3px #0D948820;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Soft UI Evolution

**Keywords:** Evolved soft UI, better contrast, modern aesthetics, subtle depth, accessibility-focused, improved shadows, hybrid

**Best For:** Modern enterprise apps, SaaS platforms, health/wellness, modern business tools, professional, hybrid

**Key Effects:** Improved shadows (softer than flat, clearer than neumorphism), modern (200-300ms), focus visible, WCAG AA/AAA

### Page Pattern

**Pattern Name:** Immersive/Interactive Experience

- **Conversion Strategy:** 40% higher engagement. Performance trade-off. Provide skip option. Mobile fallback essential.
- **CTA Placement:** After interaction complete + Skip option for impatient users
- **Section Order:** 1. Full-screen interactive element, 2. Guided product tour, 3. Key benefits revealed, 4. CTA after completion

---

## Motion

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from('.grid-item', { opacity: 0, scale: 0.92, y: 16, duration: 0.4, stagger: { each: 0.06, from: 'start', grid: 'auto' }, ease: 'back.out(1.4)' });
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex onboarding
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y
- ❌ **Second application bar** — Do not add a 64–74px icon strip above the 50px bar
- ❌ **Header text actions** — Connect, Export, and Pop out timer stay in one icon menu on every workspace, not as bar labels
- ❌ **Hiding the workspace title** to make room for the switcher

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

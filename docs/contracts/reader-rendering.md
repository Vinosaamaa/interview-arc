# Reader Rendering And Evolution Contract

Interview Arc does **not** generate one hand-built static webpage for every
attempt or solution. It separates durable content from the shared reader:

1. Owner-scoped D1 stores immutable Practice Record and Solution Profile
   revisions; private R2 stores recording/drawing bytes.
2. Frozen legacy Git Markdown/JSON remains a temporary read source only.
3. The shared React reader in `app/home-client.tsx` renders normalized D1
   content at runtime.
4. Shared reader styling lives in `app/globals.css` and
   `app/interview-arc-v2.css`.

The immutable D1 revision is durable content. The page layout, typography, code
presentation, diagram controls, responsive behavior, highlights, notes, and
section interactions are shared application code.

## Origin-Preserving Readers

An attempt reader opened from a contextual surface preserves that surface as
its URL and navigation origin. Reviews stays `view=reviews`, Journey stays
`view=journey`, and Loops stays `view=loops` with the exact Loop identity plus
the exact attempt identity. These contextual readers are listless: they show
the shared attempt or solution document without mounting the Past archive or
Problem Bank master list beside it.

The covered origin remains fully obscured and inert while the reader is open.
Close, Escape, and browser Back restore the same origin URL together with the
reader invocation's selected Loop and stage identifiers, query-backed filters
and sort, list or outline disclosure state, scroll position, and opener focus.
Forward may restore the reader. Opening a reusable solution adds one nested
history depth and
closing it returns to the exact attempt before another close returns to the
origin. Never implement contextual navigation by switching to Past and hoping
the user can navigate back manually.

## What Updates Existing Artifacts Automatically

The following changes update old and new artifacts together after the Worker is
deployed. They do not require regenerating artifact Markdown:

- typography, spacing, colors, borders, responsive rules, and motion;
- code-block contrast, syntax colors, copy controls, and language-tab styling;
- section accordion, contents navigation, reader width, and master-detail
  layout;
- highlight/note interactions;
- diagram zoom, scrolling, enlarged-reader behavior, and keyboard controls;
- any renderer improvement that continues to understand the existing Markdown
  structure.

Implement these once in the shared reader. Never rewrite hundreds of artifacts
only to apply a visual change.

## What Requires Content Work

Changing the reader cannot invent information that is absent from an artifact.
Content work is required when:

- a newly required section does not exist in an old artifact;
- a coding profile lacks Java/Python code, complexity, edge cases, or
  alternative implementations;
- a system-design profile lacks APIs, data models, flows, tradeoffs, or a real
  architecture diagram;
- a factual or algorithmic answer needs correction;
- a new schema field cannot be derived deterministically from existing data.

An optional new section may appear only on future artifacts. If it becomes
required for existing Solution Profiles, create a deliberate backfill or a new
immutable profile revision. Do not fabricate attempt-specific facts or rewrite
published transcripts. Past attempt evidence remains immutable; reusable
canonical knowledge evolves through Solution Profile revisions.

## Coding Blocks

- Use fenced code blocks with an explicit language identifier such as `java`,
  `python`, `http`, `json`, or `text`.
- Java is first and Python is second for the primary LeetCode reference
  implementation.
- Meaningful alternatives include code when practical.
- The shared `CodeBlock` renderer owns the dark surface, copy control, overflow,
  and syntax presentation.
- Plain code must have explicit high-contrast foreground color. Keywords,
  strings, numbers, and comments must each have readable colors; never rely on
  the surrounding document color to inherit correctly onto a dark surface.

## System-Design Diagrams

- A final reusable system-design visual uses a versioned `.drawio` source plus
  an exported `.svg` beside it.
- Markdown embeds the SVG with descriptive alt text. Do not publish raw ASCII
  arrows or Mermaid source as the final architecture visual.
- The shared diagram component owns zoom from 65% through 240%, reset, panning
  through the scrollable viewport, and the enlarged focus viewer.
- Keep the Markdown image renderer component identity stable. Recreating the
  renderer during live dashboard refreshes remounts the diagram and resets its
  local zoom state.
- Use functional zoom state updates so repeated clicks cannot use a stale zoom
  value.
- Use the app-owned enlarged viewer instead of depending only on the browser's
  native Fullscreen API. The viewer must work when native fullscreen is
  unavailable, lock background scrolling, close by its control, outside click,
  or Escape, and preserve the underlying reader.
- Escape from the enlarged diagram must not also close the attempt or solution
  reader beneath it.

## Safe Template Evolution

Use this decision table:

| Change | Old content work? | Release path |
| --- | --- | --- |
| Visual/CSS refinement | No | Update reader, test, deploy Worker |
| Shared reader interaction | No | Update reader, add regression coverage, deploy Worker |
| New optional section | No | Teach future finalizers; old artifacts omit it |
| New required section with derivable data | One automated backfill | Update contract/importer, validate, import |
| New required section needing judgment | Yes | Specialist revises affected Solution Profiles |
| Correction to canonical solution | Yes | Create a new immutable Solution Profile revision |
| Correction to historical attempt evidence | Never silently | Preserve evidence; add an explicit correction record |

Keep readers tolerant of missing optional sections and older document shapes.
Add migrations or version-aware normalization before making a formerly
optional field mandatory.

## Verification

Reader changes require:

- `pnpm lint`;
- `pnpm test`;
- local browser checks on coding and system-design readers;
- direct interaction checks for zoom persistence, reset, enlarged view, Escape,
  and background scroll restoration when diagram behavior changes;
- computed-style or visual checks for plain and highlighted code tokens when
  code presentation changes;
- desktop and narrow-screen checks when layout changes.

Routine private finalization performs no Git publication. Reader code or CSS
still follows the main-branch deployment workflow. A separately authorized
public export uses its own explicit release receipt.

# Behavioral Evidence Bundle

The Behavioral Evidence Bundle is the canonical local intermediate for résumé
and project archaeology. It is owner-private working state, not a practice
transcript, Solution Profile, D1 record, or publication artifact.

The default location is:

```text
private-sources/behavioral-foundation/
```

The whole `private-sources/` tree is ignored. Never move a real bundle, its
generated site, private diagrams, or source registry into a tracked fixture.

## Boundary

```text
Authorized local sources
        ↓ bounded inspection
Ignored evidence bundle (canonical)
        ├─→ generated local HTML / diagrams
        ├─→ reviewed owner-private D1 candidates (future)
        └─→ explicitly approved publication-safe derivatives (future)
```

- **Persist** means update the ignored canonical bundle.
- **Project** means regenerate a disposable local view from that bundle.
- **Sync** means a future, explicit write of validated owner-private candidates
  to D1.
- **Publish** means an explicit owner-approved `publication_safe` derivative.

Projection must be one-way. Editing generated HTML, SVG, or Markdown never
changes evidence identity, acceptance, visibility, or publication approval.

## Files

```text
private-sources/behavioral-foundation/
├── manifest.json
├── projects/
│   └── <project-id>/
│       ├── project.json
│       ├── dossier.md
│       └── diagrams/
│           ├── <diagram-id>.mmd
│           ├── <diagram-id>.drawio
│           └── <diagram-id>.svg
└── site/
    ├── index.html
    └── assets/
```

`manifest.json` conforms to
`behavioral-evidence-manifest.schema.json`. Every `project.json` conforms to
`behavioral-evidence-project.schema.json`. The generator additionally validates
cross-file references and invariants JSON Schema cannot express conveniently.

`dossier.md` preserves the complete evidence-grounded teaching handoff. It may
contain private provenance because it remains ignored. `project.json` owns the
stable normalized identities used by filters, links, future D1 candidates, and
projection generation.

## Evidence and attribution grades

Evidence grade describes how strongly a source supports the scoped
observation—not whether the user personally did it.

| Grade | Meaning |
| --- | --- |
| `E0` | Unsupported, contradicted, or only a lead |
| `E1` | One self-asserted, résumé, generated-secondary, or documentation claim |
| `E2` | Direct but partial source observation, test/config evidence, or converging secondary evidence |
| `E3` | Strong direct source evidence or corroborated observations for the exact scoped project fact |

Attribution grade is separate:

| Grade | Meaning |
| --- | --- |
| `A0` | No personal attribution evidence |
| `A1` | User assertion or unconfirmed identity candidate |
| `A2` | Strong contribution signal such as consistent Git/PR history, still not conclusive ownership or rationale |
| `A3` | Owner-confirmed personal role with corroborating evidence and an explicit scope |

Code and Git can establish project behavior or contribution signals. They do
not by themselves establish decision authority, motivation, production use,
scale, metrics, business impact, or leadership.

## Review state

Evidence candidates use `pending | accepted | rejected | superseded`. A newly
generated archaeology handoff starts as `pending` until the owner and
specialist review it. Claim status is exactly
`unverified | partial | verified | contradicted`.

A personal-contribution claim may be `verified` only when it has at least one
accepted supporting evidence item and attribution grade `A3`. Project facts
may be verified from accepted `E3` evidence without implying personal
ownership. Contradictions and missing proof stay explicit; they are never
smoothed away by answer polishing.

## Visibility and remote-safe output

Visibility is exactly `local_only | owner_private | publication_safe` and never
upgrades automatically.

- `local_only` may retain private locators and internal terminology inside the
  ignored bundle.
- `owner_private` is sanitized for authenticated D1 but still not public.
- `publication_safe` is an original-language derivative approved explicitly by
  the owner. It must omit private locators, source snippets, employer emails,
  secrets, private remotes, customer data, and confidential identifiers.

Every publication candidate records the source evidence IDs, transformations,
limitations, and approval state. The generator refuses to treat an unapproved
candidate as `publication_safe` and scans remote-safe candidate fields for
common path, email, credential, and private-remote patterns.

## Incremental updates

1. Resolve one exact experience, claim, gap, story, or résumé bullet.
2. Inspect the least-sensitive sufficient source under the code-inspection gate
   in `practice/behavioral/profile/README.md` and issue #201.
3. Append new evidence with a stable ID and source revision; never rewrite
   historical provenance silently.
4. Link supporting and contrary evidence to atomic claims.
5. Review candidates with the owner. Acceptance is explicit and scoped.
6. Supersede stale observations while preserving lineage.
7. Regenerate projections. Do not infer D1 sync or publication from generation.

Use `practice/behavioral/prompts/project-evidence-archaeology.md` only when the
owner explicitly asks to add or re-audit a project or experience. Ordinary
behavioral mocks must not load that long prompt.

## Generator

```bash
pnpm behavioral:evidence:validate
pnpm behavioral:evidence:build
```

Both commands default to `private-sources/behavioral-foundation`. Pass
`--bundle <path>` for an isolated test or another explicitly selected bundle.
Build writes only beneath that bundle's `site/` directory.

The generated site must:

- make project facts, personal-contribution candidates, unsupported claims,
  and contradictions visually distinct;
- link claims to evidence and limitations;
- render architecture only where source evidence supports it;
- preserve evidence-provenance views when runtime architecture is unknown;
- remain keyboard accessible, responsive, and usable with reduced motion; and
- identify itself as a local review projection, never as D1-synced or
  published content.

## Future product boundary

Issue #201 owns the later local connector, candidate-review writes, D1/MCP
domain, Behavioral Foundation hub in the current Interview Arc website, typed
Behavioral Attempt analysis, and Solution Profile integration. This local
bundle does not mutate Today, a practice activity, transcript, result, timer,
Story Bank, Solution Profile, D1, or publication state.

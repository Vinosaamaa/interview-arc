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
        ├─→ typed pending owner-private D1 candidates
        └─→ explicitly approved publication-safe derivatives (future)
```

- **Persist** means update the ignored canonical bundle.
- **Project** means regenerate a disposable local view from that bundle.
- **Sync** means an explicit specialist write of a validated owner-private
  source snapshot or typed evidence candidate to D1, followed by receipt
  verification.
- **Publish** means an explicit owner-approved `publication_safe` derivative.

Projection must be one-way. Editing generated HTML, SVG, or Markdown never
changes evidence identity, acceptance, visibility, or publication approval.

## Files

```text
private-sources/behavioral-foundation/
├── manifest.json
├── source-policy.json
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
| `A3` | Explicit owner confirmation of a personal role and scope; separate evidence grades record documentary corroboration |

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

For owner-private rehearsal, `verified` means accepted as truthful at the
stated scope; it does not imply external or documentary proof. An explicit,
scoped owner confirmation may supply `A3` while remaining `E1` when it is the
only evidence. Code, documents, and Git are optional corroboration. A generated
hypothesis or polished answer never confirms its own facts.

## Fiction boundary

Hypothetical and fictional practice scenarios live only in the Solution
Profile's separate `practiceScenarios`; they are not evidence-bundle records.
A scenario may reference accepted evidence IDs for real project facts, but its
invented ownership, actions, challenges, and results use only the scenario's
stable canon. They receive no evidence or attribution grade, cannot affect
claim status, and never become Story Bank or résumé facts.

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

Remote `d1Candidates` are deliberately narrow. Each has `kind: evidence`,
references exactly one canonical pending evidence record, and contains only one
or more stable question/relevance links. Source metadata is projected directly
from the source registry, not duplicated in a candidate. Claims and Story Bank
records use their owning D1 workflows only after evidence review.

Every source declares a `refreshMode`. `filesystem` means its private locator
is one real canonical source root or exact file. `remote`, `conversation`, and
`blocked` are non-filesystem modes and are never passed to `stat()`. Every
pending evidence record has exactly one sync disposition: one `d1Candidates`
record, or one `d1Exclusions` record explaining why it remains local-only.
Exclusions are private control data and never enter the remote sync plan.

`source-policy.json` is a gitignored, owner-private authorization sidecar. It
records each authorized filesystem source identity, its exact declared path,
and its canonical real path at authorization time. Refresh preflights every
filesystem source against that boundary before inspecting content and fails
closed if a locator or symlink target changed. A newly available source that
was missing during authorization must resolve directly to its declared path;
otherwise it requires reauthorization. The policy never enters D1, R2, a sync
plan, generated site, test fixture, log, or publication artifact.

Use `practice/behavioral/prompts/project-evidence-archaeology.md` only when the
owner explicitly asks to add or re-audit a project or experience. Ordinary
behavioral mocks must not load that long prompt.

## Generator

```bash
pnpm behavioral:evidence:validate
pnpm behavioral:evidence:build
pnpm behavioral:evidence:status
pnpm behavioral:evidence:authorize-filesystem -- --confirm-owner-authorized-sources
pnpm behavioral:evidence:refresh
pnpm behavioral:evidence:prepare-sync
```

Both commands default to `private-sources/behavioral-foundation`. Pass
`--bundle <path>` for an isolated test or another explicitly selected bundle.
Build writes only beneath that bundle's `site/` directory.

The controller commands use the same default bundle. `status` emits aggregate
counts only, including candidate-covered, excluded, and uncovered pending
evidence. `authorize-filesystem` requires the explicit confirmation flag and
writes only the ignored local source policy. Run it whenever the owner changes
an authorized locator. `refresh` updates ignored source fingerprints and
refresh state without printing locators; it leaves remote and conversation
state to their owning connectors, and unchanged non-filesystem sources do not
rewrite project or manifest timestamps. `prepare-sync` accepts a source
revision only when its state is `available` and `current` or `changed`, and it
fails when any pending evidence is uncovered; otherwise it writes an ignored `sync/plan.json`
containing only display-safe source snapshots and explicit typed candidate
writes. It never calls MCP itself, uploads to R2, or treats a generated plan as
a saved receipt.

The generated site must:

- make project facts, personal-contribution candidates, unsupported claims,
  and contradictions visually distinct;
- link claims to evidence and limitations;
- render architecture only where source evidence supports it;
- preserve evidence-provenance views when runtime architecture is unknown;
- remain keyboard accessible, responsive, and usable with reduced motion; and
- identify itself as a local review projection, never as D1-synced or
  published content.

## Product boundary

The local bundle does not mutate Today, a practice activity, transcript,
result, timer, Story Bank, Solution Profile, D1, R2, or publication state. The
Behavioral specialist reads the prepared plan, performs exact owner-private MCP
writes, verifies durable receipts, and presents pending candidates for explicit
owner review.

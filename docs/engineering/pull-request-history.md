# Engineering pull-request history protocol

Engineering history has two deliberately separate layers. The separation keeps the complete timeline factual and inexpensive while preserving deep technical narrative where it is useful.

| Layer | Coverage | Canonical source | Purpose |
| --- | --- | --- | --- |
| Pull Request Receipt | One compact receipt for every merged pull request | `docs/engineering/changes/pr-<number>.md` in the owning repository | Complete chronological change inventory |
| Rich Engineering Record | Material changes or a reviewed cluster of related changes | `docs/engineering/records/*.md` in the narrative-owning repository | Architecture, decisions, incidents, retrospectives, and capability context |

The Pull Request Receipt contract is versioned by `docs/contracts/engineering-pull-request-receipt.schema.json`. The six rich record types remain Change Note, ADR, Architecture Review, Feature Retrospective, Postmortem, and Capability Dossier. A future contract change requires an explicit schema version; tooling must not silently reinterpret accepted version 1 documents.

Version 1 uses restricted one-line frontmatter, not general YAML. Each nonempty line has one unique key and a nonempty value separated at the first colon. A value beginning with `"`, `[`, or `{`, the exact lowercase values `true`, `false`, or `null`, and exact integers are JSON-decoded; other values are plain strings unless they begin with the YAML-only characters `'`, `|`, `>`, `&`, `*`, or `!`. Block lists, multiline scalars, anchors, aliases, tags, duplicate keys, and empty values are rejected. This keeps the parser identical and deterministic across the three repositories.

## Forward authoring protocol

The implementation coordinator owns the receipt as part of the pull request.
The user does not need to request a separate Journal operation. The normative
coordinator sequence is
[`Engineering record authorship`](../agents/issue-lifecycle.md#engineering-record-authorship):
it begins with the materiality decision during issue work, uses a draft pull
request to obtain the repository-local number, and blocks review until the
numbered receipt, matching checkbox, and any exact rich-record references are
committed.

This protocol owns the content boundary: the receipt contains a public-safe
title and one factual summary paragraph of at most 280 characters; `none`
leaves `richRecordRefs` empty; material classifications link exact
`id@revision` records; and a reviewed multi-PR case study may be shared by
several receipts. CI validates those authored layers, while the deterministic
build projects their indexes, backlinks, Statistics, immutable diagram links,
and standalone HTML.

After the pull request number is known, scaffold its forward receipt without a separate user operation:

```bash
pnpm engineering:receipt:new -- \
  --pr 312 \
  --title "Correct Engineering navigation labels" \
  --summary "Renamed one local navigation label without changing a Module or Interface." \
  --classification none
```

Run `pnpm engineering:receipt:new -- --help` to see both non-material and
material invocations. The command is intentionally non-interactive so agents
and CI can reproduce exactly what was authored.

For a material pull request, select its rich classification and repeat `--rich-record-ref <id>@<revision>` for every exact record it links; every rich record changed by that pull request must be included. The non-interactive command makes no GitHub, D1, or network call; it derives only the canonical pull-request URL and evidence reference from `--pr`, leaves head/merge facts `null`, sorts rich references, and refuses invalid, unsafe, or existing targets.

CI does not invent motivation, architecture, root cause, impact, or prose from a diff. The coordinator authors the factual receipt and any required rich record while it has the implementation context. After that authoring step, validation, projection, bundling, and deployment are automatic.

The canonical state is Markdown in Git. The generated JSON and standalone HTML are disposable projections, not a database, backfill workspace, or second narrative source. Engineering content is not inserted into D1, and the production reader never fetches GitHub dynamically. Arc ingests other repositories only from reviewed commit pins during build and CI.

## Compact receipt example

```markdown
---
schemaVersion: 1
repository: interview-arc
pr: 312
title: Correct Engineering navigation labels
classification: none
richRecordRefs: []
reconstructed: false
confidence: verified
unknowns: []
headCommit: null
mergeCommit: null
mergedAt: null
sources: [{"label":"Pull request #312","url":"https://github.com/Vinosaamaa/interview-arc/pull/312","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["pull-request:312"]}
visibility: public-safe
publicationEligibility: eligible
---
# Correct Engineering navigation labels

Renamed one local navigation label without changing a Module or Interface.
```

The generator derives the receipt source commit, immutable source permalink, and source commit timestamp from Git. These values do not appear in the document frontmatter, so a pull request never has to predict the commit that will contain its own receipt.

`headCommit`, `mergeCommit`, and `mergedAt` are optional historical facts. Leave them `null` unless authoritative external evidence verifies the exact value. The projection exposes each missing fact and uses the source commit and timestamp only as an explicitly labelled timeline fallback. It never presents that fallback as a verified merge fact. Supplied head or merge facts require verified evidence references.

## Materiality and record selection

A Pull Request Receipt is always required, but rich prose is not. Use a rich record when a change materially affects a Module or Interface, schema or migration, cross-repository protocol, durable state or ownership rule, dependency boundary, security, privacy, reliability, accessibility, performance, incident repair, or a difficult-to-reverse tradeoff.

Choose the rich record by the question it answers:

- Change Note: what material behavior landed in this pull request?
- ADR: what durable and difficult-to-reverse decision was accepted?
- Architecture Review: what alternatives and constraints were evaluated before implementation?
- Feature Retrospective: what did a reviewed multi-PR feature or migration establish?
- Postmortem: what verified incident, root cause, repair, and prevention work occurred?
- Capability Dossier: which exact cross-repository records jointly describe one capability?

Do not inflate a small receipt into a rich record. Conversely, do not compress architecture, incident causality, or a multi-PR migration into a 280-character receipt.

## Diagrams

Receipts do not generate or require diagrams. A rich record may include a repository-native, public-safe diagram when verified structure, data flow, control flow, ownership, or before/after architecture is materially clearer visually. The optional `diagrams` descriptor names the editable `.drawio` source, a rendered PNG or SVG, a concise factual summary, and evidence references already declared by the record. Both assets must be committed under `docs/design/` at the record's exact source revision. The Journal derives immutable links to both assets and fails publication when either Git blob is missing. Neither CI nor the Journal generator invents a diagram from a pull-request diff.

## Historical backfill protocol

A backfill coordinator uses the same contracts; it does not author into a local HTML file.

1. Enumerate merged pull requests from the owning repository's authoritative GitHub history and preserve repository, PR number, URL, merge time, head SHA, merge SHA, and changed-file evidence when exposed.
2. Create one reconstructed receipt for every merged pull request, including small changes. Mark unavailable facts `null`, list meaningful unknowns, and never infer missing motivation, authorship, impact, or success.
3. Classify each receipt. Keep small changes at `none`; group related material pull requests into the smallest evidence-supported set of rich records.
4. Link every material receipt to exact rich record revisions. A rich record can cover a coherent PR cluster, so backfill does not require one long article per pull request.
5. Generate diagrams only for evidence-supported rich records that benefit from them.
6. Run privacy, trust, schema, relation, deterministic-output, and standalone-parity checks before review.
7. Commit canonical Markdown and repository-native diagram sources. Regenerate JSON and HTML through the standard build, then ingest other repositories from reviewed commit pins.

Backfill batches should be bounded and reviewable. Existing accepted history is corrected by a new reviewed Git change; published rich records continue to use their amendment and supersession model rather than silent narrative replacement.

An accepted rich record is never deleted. Corrections add a reviewed amendment or superseding revision so existing immutable links, receipts, and backlinks keep resolving to the evidence originally accepted.

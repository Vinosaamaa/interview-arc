# Interview Arc Issue Lifecycle

This contract governs issue creation, implementation, verification, closure,
reopening, and postmortems across the Interview Arc repositories. It allows a
future agent to continue work without relying on conversation history.

Keep the matching copy in the sibling `interview-arc-voice` repository
synchronized whenever this shared lifecycle changes.

## Repository routing

Create the issue in the repository that owns the behavior:

| Repository | Ownership |
| --- | --- |
| `Vinosaamaa/interview-arc` | Website and reader; Today, Journey, Past, and Problem Bank; Cloudflare Worker; D1 and R2; MCP and Voice-facing APIs; Chrome companion; publishing and production deployment |
| `Vinosaamaa/interview-arc-voice` | Native macOS Voice application; floating widget; menu-bar panel and Settings; recording and transcription; text insertion; local audio handling; signed packaged-app behavior |

For work requiring both repositories, create one issue in each, cross-link
them, identify any dependency, and use separate PRs. GitHub assigns issue and
PR numbers automatically; each repository has its own shared sequence.

## Intake and triage

For every bug, feature, or improvement:

1. Determine the owning repository.
2. Read current repository instructions, contracts, and design documentation.
3. Inspect current `main`.
4. Search open and closed issues for the same behavior.
5. Reproduce the report when safely possible.
6. Reopen an existing issue, update an open issue, or create a new issue.

Reopen an issue when the same behavior or original acceptance criteria still
fail, including a later regression. Create a new linked issue only when
evidence establishes a separate problem, materially expanded scope, or an
independently deliverable result.

## Mandatory reproduction gate

For every reported bug, complete a diagnosis pass before changing product
code:

1. Reproduce the exact reported flow in the affected released product when it
   is safe to do so. Match the relevant screen size, zoom or text scale, theme,
   selected tab, saved state, and input data.
2. Classify the report as **Confirmed**, **Intermittent**, **Not reproduced**,
   or **Expected behavior**. Never describe a hypothesis as reproduced fact.
3. Capture the evidence that supports the classification: screenshots,
   recordings, logs, database state, accessibility state, source inspection,
   or a minimal test case.
4. Identify confirmed root cause when possible. Otherwise record the leading
   hypothesis, the missing evidence, and the next diagnostic step.
5. Explain whether the behavior is fixable, the proposed implementation
   approach, affected states, risks, and likely regression coverage.
6. When the user asks for diagnosis before implementation, stop after reporting
   these findings and wait for approval before changing product code.

After implementation, repeat the original reproduction steps against the
changed build and the released product. A nearby happy-path test is not a
substitute for rerunning the exact reported flow.

## Issue-first rule

Every non-emergency product change begins with an issue. Urgent containment may
come first, but the issue and incident record follow as soon as the system is
safe.

An implementation-ready issue includes:

- problem, location, user impact, current behavior, and expected behavior;
- deterministic reproduction steps when possible;
- screenshots, recordings, logs, database evidence, or fixtures;
- confirmed investigation evidence and clearly marked hypotheses;
- an end-to-end description of what to build;
- objective acceptance criteria and a relevant test matrix;
- non-goals, dependencies, and cross-repository links;
- release constraints such as active sessions, migrations, production-only
  checks, or signed-package requirements.

Use `bug`, `enhancement`, or `documentation` according to the behavior. Do not
classify reliability repair as an enhancement merely because it adds a guard.

## Implementation and pull request

The implementing agent reproduces reliability-sensitive failures, adds
regression coverage, keeps unrelated scope out, updates behavior contracts,
and tests all affected states.

Link the PR with `Refs #<issue-number>`. Do not use an automatic closing
keyword: merge alone is not release verification.

The PR records:

- the linked issue;
- proven root cause or approved design intent;
- user-visible and architectural changes;
- automated and manual tests actually performed;
- affected screen sizes, themes, permissions, and offline states;
- before/after evidence for visible work;
- risks, rollback, changed contracts, and postmortems.

## Release, verification, and closure

After review:

1. Merge into `main`.
2. Deploy the website when runtime content, code, or infrastructure changed.
3. For Voice, package merged `main` and install that exact application.
4. Test the deployed website or signed installed app.
5. Add the issue resolution record.
6. Close the issue.

Source inspection, previews, an unmerged build, or CI alone are not release
evidence. The user does not need to explicitly confirm every fix. After
thorough agent verification, the agent records and closes it; the user may
continue using the product normally.

Use this closing comment:

```markdown
## Resolution

- PR:
- Merge commit:
- Released version or deployment:
- Completed date:

### Root cause

### Change

### Verification

### Known limitations

### Documentation
```

Only claim checks that were actually performed.

## Recurrence after closure

If the user later reports the same behavior:

1. Reopen the issue immediately.
2. Add a `Regression observed` or `Resolution incomplete` comment.
3. Record the new reproduction, environment, release/build, evidence, and the
   acceptance criterion that still fails.
4. Preserve prior resolution history.
5. Investigate whether the root cause is the same.
6. Link each follow-up PR with `Refs #<issue-number>`.
7. Release, verify, add another resolution record, and close again.

Create a separate linked issue only after evidence establishes a distinct
problem or materially expanded scope.

## Resolution record versus formal postmortem

The PR and issue resolution record are sufficient for minor visual work,
straightforward features, localized bugs, and simple missing controls.

A versioned blameless postmortem is required for:

- transcript contamination or invented speech;
- data loss or incorrect publication;
- security or privacy failures;
- crashes, broken recordings, or silent delivery failures;
- repeated regressions or cross-repository incidents;
- prolonged or unusual debugging;
- incidents where the design allowed the failure class.

Store it in the owning repository at:

`docs/postmortems/YYYY-MM-DD-descriptive-slug.md`

Include summary, user impact, detection, timeline, relevant architecture and
diagrams, evidence, root cause, contributing factors, failed approaches,
resolution, regression prevention, merged-release verification, follow-up
issues, and a technical glossary when useful.

Link the postmortem from the issue and PR, and link the issue and PR from the
postmortem. Keep a concise postmortem summary in the issue's chronological
resolution history.

## Lifecycle summary

Normal:

`Report → Triage → Issue → Implementation → PR → Merge → Deploy/install → Agent verification → Resolution record → Close`

Recurrence:

`Close → User reports recurrence → Reopen → New evidence → Follow-up PR → Release → Agent verification → New resolution record → Close`

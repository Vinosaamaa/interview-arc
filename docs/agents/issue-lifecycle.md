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

## Verification lanes

Choose the lightest lane that is safe for the change. When the user explicitly
says **Fast fix**, use the Fast lane unless investigation reveals reliability
risk. When no lane is named, use Standard. Record the chosen lane in the issue
or pull request.

### Fast

Use Fast for a localized, reversible change such as spacing, color, copy,
non-critical metadata presentation, or another isolated visual defect.

1. Inspect the report and affected source. Reproduce only when the failure is
   unclear or reproduction is quick and non-disruptive.
2. Make the smallest scoped repair.
3. Run the directly relevant test, parser, lint, or build check and require CI
   to pass.
4. Merge and deploy the website or install the packaged Voice application.
5. Do not require agent-run production visual verification. The user performs
   final visual acceptance during normal use and may reopen the same issue if
   it still fails.

Fast does not waive safe release mechanics, CI, rollback information, or the
issue-first rule. It shortens reproduction, test breadth, manual verification,
and resolution detail.

For Voice, download the exact artifact produced from merged `main`, quit the
installed copy, and launch the artifact directly from a temporary staging
folder before installation. This is the real release application, not a
SwiftUI preview or development build. If its focused visual smoke test passes,
install that exact artifact. A Fast visual change does not require a second
agent-run smoke test after installation.

### Standard

Use Standard for ordinary product bugs and features:

1. Reproduce once in the relevant environment.
2. Add focused regression coverage.
3. Run the normal repository checks and CI.
4. Merge and deploy or install.
5. Perform one concise production or installed-app smoke test before recording
   resolution.

### Reliability

Use Reliability for timers, saved or published data, authentication,
permissions, recording, transcription, insertion, synchronization, crashes,
privacy, security, or any change that could silently lose or corrupt user
work. Follow the complete reproduction, boundary inspection, regression,
release, installed/deployed verification, and postmortem requirements.

If a Fast or Standard investigation exposes Reliability scope, stop using the
lighter lane and record the escalation.

## Reproduction gate

For Standard and Reliability bugs, complete a diagnosis pass before changing
product code:

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

After Standard or Reliability implementation, repeat the original reproduction
steps against the changed build and the released product. A nearby happy-path
test is not a substitute for rerunning the exact reported flow. Fast changes
use source inspection, focused automated checks, CI, and user acceptance unless
they are escalated.

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

## Execution time and metered-cost record

Every implementation PR must keep a concise chronological execution ledger so
the user can see what this specific task actually did. The ledger is live
instrumentation, not a standard release checklist and not a narrative
reconstructed at handoff time.

Wall-clock timing begins when the user submits the request, including model
processing before the first tool call. Use the client's exact “worked for” or
turn duration as the authoritative wall-clock measurement when it is exposed.
The first shell or tool timestamp marks only the start of tool execution; never
substitute it for the request-submission time. If neither the request timestamp
nor a client-measured duration is available, report total wall-clock time as
`unknown`.

Before the first substantive tool action, read the current system clock and
record `tool_execution_started_at`. At the boundaries of each meaningful work
block, record an exact Pacific timestamp in this format:

```text
YYYY-MM-DD HH:MM:SS PDT (-0700)
YYYY-MM-DD HH:MM:SS PST (-0800)
```

Use `PDT` or `PST` according to the clock on that date. Do not round these
timestamps. Derive each step duration arithmetically from its recorded start
and end; never infer it from memory, file modification times, commit times, or
approximate conversation position.

Name every row after a meaningful task-specific work block and its target or
outcome. Author the blocks from the current task; never begin with a universal
list of phases. Consolidate related actions whose individual durations are
under two minutes into one concise block. Never expose one- or two-second shell
commands as separate rows. If the whole task takes less than two minutes, use
one row for the complete task. If an action did not happen, omit it completely.
Do not add `Not run`, `N/A`, zero-duration placeholders, or empty rows merely
to satisfy a template. If a meaningful action repeats, record the repeated
block separately and explain why it repeated.

Use this flexible template for only the steps that actually occurred:

```markdown
## Execution ledger

- request_submitted_at: exact client timestamp or unavailable
- tool_execution_started_at: YYYY-MM-DD HH:MM:SS PDT/PST (UTC offset)
- ledger_finished_at: YYYY-MM-DD HH:MM:SS PDT/PST (UTC offset)
- client_measured_duration: HH:MM:SS or unavailable
- reconciliation: matched, or a concrete explanation of the resolved difference

| Meaningful work block | Started | Ended | Duration | Result |
| --- | --- | --- | ---: | --- |
| Concise task-specific work block | exact Pacific timestamp | exact Pacific timestamp | HH:MM:SS | Concrete result |

- client-measured wall-clock total: HH:MM:SS or unknown
- active engineering total: HH:MM:SS or unknown
- uninstrumented gaps or overlap notes, only when present:
- hosted runs, artifacts, and metered usage, only when used:
```

Record an external wait or blocker as its own task-specific block only when it
actually occurs and lasts at least two minutes. Consolidate shorter waits into
one concise note rather than publishing individual micro-rows. When actions
overlap, identify the overlap and do not double-count it.

At handoff, use the client's exact “worked for” or turn duration as total
wall-clock time because it includes pre-tool model processing. If the client
also exposes the request timestamp, reconcile it with the final timestamp. Do
not calculate wall-clock time from `tool_execution_started_at`; that would omit
pre-tool processing. If client timing is unavailable, report wall-clock time as
`unknown`. Calculate active engineering time only from recorded,
non-overlapping meaningful work blocks after excluding external waits. If
exact instrumentation was missed, report the affected duration as `unknown`;
do not substitute a confident-looking estimate. Historical work that predates
this rule may be explicitly labeled `reconstructed`, but reconstructed values
must not be presented as exact measurements.

Post an interim ledger update whenever wall-clock time exceeds 30 minutes
rather than waiting until the end.

The final user-facing handoff for every implementation turn must repeat this
complete ledger; a PR link or one combined total is not a substitute. The
ledger is an administrative coordination record and must not be appended to a
practice activity transcript.

For services actually used during the task, also record measurable metered
usage:

- every GitHub Actions run used for the change, including run URL, runner OS,
  conclusion, and actual runtime;
- artifacts uploaded and their retention period;
- paid external API or hosted-service usage when the provider exposes it.

Do not create a metered-usage section for a service the task did not use. Do
not invent a monetary amount. Label the amount `unknown` when an actually used
provider does not expose account-level billing data, and distinguish a job that
never started from one that ran and consumed minutes.

Use the cheapest trustworthy validation path and avoid redundant work. Run the
focused local checks that are supported and proportionate on the current
machine, but do not interpret `local-first` as a requirement to compile,
package, install, or repair an optional local toolchain when the repository's
approved release path owns that work.

For website work, keep the supported local-D1 checks, focused tests, lint, and
build before the independent hosted checks. For Voice work, the Hosted CI
efficiency rules in `interview-arc-voice/AGENTS.md` and the detailed
`interview-arc-voice/docs/artifact-promotion.md` contract are authoritative.
The ledger must identify the focused local checks, complete PR workflow,
applicable staged-artifact verification, and whether merged `main` promoted
tree-equivalent bytes or rebuilt. When promotion proves that merged `main` is
byte-identical to the already staged PR artifact, record reuse of those exact
local bytes; do not download, rebuild, or repeat an equivalent staged smoke
test merely because the merge commit or artifact name changed. All
lane-specific signing, installation, and installed-app requirements below
still apply.

If hosted CI is blocked by billing or infrastructure, do not retry it blindly:
record whether the job started and consumed runner time, complete every safe
focused check, and state explicitly which required CI or release evidence is
still missing.

## Release, verification, and closure

After review, follow the selected lane:

1. Merge into `main`.
2. Deploy the website when runtime content, code, or infrastructure changed.
3. For Voice, package merged `main`. In Fast, run that exact app from a
   temporary staging folder before installing it. In Standard and Reliability,
   also exercise the installed copy.
4. In Standard and Reliability, test the deployed website or signed installed
   app. In Fast, leave final production visual acceptance to the user.
5. Add a resolution record proportionate to the lane.
6. Close the issue after the required agent verification. A Fast issue may be
   closed after CI, deployment or installation, and its staged Voice check; the
   user may reopen it without needing to explicitly confirm success.

A preview or development build is never release evidence. CI alone is
insufficient for Standard or Reliability. For Fast Voice work, the staged exact
merged-main artifact is release evidence before installation. The user does not
need to explicitly confirm every fix; if normal use later exposes the same
failure, reopen the issue and preserve its history.

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

`Report → Triage → Choose lane → Issue → Implementation → PR → Merge → Deploy/install → Lane verification → Resolution record → Close`

Recurrence:

`Close → User reports recurrence → Reopen → New evidence → Follow-up PR → Release → Agent verification → New resolution record → Close`

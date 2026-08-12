# Behavioral Project Deep Dive Contract

## Purpose and ownership

A **Project Deep Dive** is a reusable Behavioral Solution Profile about one
canonical project. It is not the raw practice conversation, a Learn lesson, a
résumé, or a published artifact.

The Behavioral specialist exclusively creates and revises Project Deep Dive
question bindings and profile content. The Resume & Cover Letter specialist may
supply exact résumé and claim IDs. Learn may consume link-only organization and
an exact profile revision. Only the publication coordinator publishes an
artifact. None of those consumers may create a competing project profile.

## Canonical identity

Every deep-dive question has one explicit owner-scoped binding:

- stable `questionId`;
- stable `projectId` already present in the same owner's Behavioral evidence
  source, evidence-item, or Story Bank registry;
- immutable `bindingRevision`;
- one typed `focus`;
- exact `sourceClaimId` when the focus is `resume_claim`.

The supported focus values are `project_overview`, `resume_claim`,
`architecture`, `technical_decision`, `challenge`, `incident`, `scale`, and
`results`.

Titles, prompts, company names, and free-form tags are discovery metadata, not
runtime binding authority. One project may have at most one active overview.
One project and source-claim pair may have at most one active résumé-claim
question. A correction appends a binding revision; it never edits a historical
revision.

Use `query_behavioral_project_deep_dives` before a write,
`set_behavioral_project_binding` with the exact expected revision, and then
repeat the query. Exact operation retries replay the saved receipt. A changed
retry, stale revision, unknown project, cross-owner identity, contradicted
claim, unavailable evidence, or uniqueness conflict fails closed.

## Profile structure

Every section in a bound profile has a stable `sectionKey`. Required keys occur
once and in contract order; additional keyed sections may follow where useful.
Every profile carries `projectDeepDive` metadata naming the exact project,
binding revision, focus, and source claim when applicable.

### Project overview

1. `orientation`
2. `architecture`
3. `end_to_end_flows`
4. `ownership_and_evidence`
5. `decisions_and_tradeoffs`
6. `operations_reliability_security`
7. `results_and_gaps`
8. `interview_walkthrough`
9. `likely_follow_ups`

### Résumé claim

1. `claim_and_evidence`
2. `project_context`
3. `problem_and_constraints`
4. `implementation_mechanics`
5. `ownership_and_decisions`
6. `alternatives_and_tradeoffs`
7. `operations_and_risks`
8. `result_and_limitations`
9. `interview_walkthrough`
10. `likely_follow_ups`

### Other focused deep dives

1. `project_context`
2. `problem_and_constraints`
3. `implementation_mechanics`
4. `ownership_and_evidence`
5. `decisions_and_tradeoffs`
6. `operations_reliability_security`
7. `results_and_gaps`
8. `interview_walkthrough`
9. `likely_follow_ups`

All factual statements follow `behavioral-evidence-domain.md`. Unknown
ownership, implementation detail, metric, or outcome remains an explicit gap.
The profile contains no transcript, raw private source, recording, or local
locator.

## Attempts and Past

A completed bound attempt stores one append-only Project Deep Dive activity
link with the exact question, project, binding revision, focus, optional source
claim, and Solution Profile revision. New finalizations project this link
automatically.

For an already completed attempt, use
`link_completed_behavioral_project_attempt` with the exact activity, question,
and binding revision. The operation requires the authoritative completed timer
and explicit result. It adds only the project link; it does not rewrite the
activity, transcript, timer, result, final answer, finalization, or Solution
Profile. Exact retries are idempotent and an existing different link is
immutable.

`get_activity_practice_record` returns the frozen `projectDeepDiveLink` for one
attempt. `get_problem_solution_profile` returns the current question binding
and reports a stale or incomplete bound profile as non-reusable.

## Legacy migration

Migration may use tags only to produce a review proposal. It never silently
binds from a title or employer string.

- `resume-foundation` plus exactly one `experience:<stable-id>` proposes
  `project_overview` when that project exists.
- `resume-bullet` plus exactly one `experience:<stable-id>` and one exact
  `claim:<stable-id>` or `resume-claim:<stable-id>` proposes `resume_claim`
  only when accepted evidence resolves the claim to that same project.
- A résumé foundation item without one project remains career overview.
- Missing, multiple, unknown, or conflicting identities remain `needs_review`.

The same explicit binding revision is then attached to eligible historical
attempts. Migration never changes historical attempt bytes.

## Learn relationship and publication

Learn stores organization and linkage only: project ID, question ID, focus,
binding revision, and exact Solution Profile revision. The Behavioral Solution
Profile remains the canonical body. Learn must not duplicate it into a Lesson
revision or infer a link from text.

Publishing renders the exact immutable profile revision selected by the
publisher and preserves its evidence gaps and provenance. The Behavioral
specialist finalizes; a separate coordinator publishes. Saving D1 state is not
publication, and this contract does not authorize automatic publishing.

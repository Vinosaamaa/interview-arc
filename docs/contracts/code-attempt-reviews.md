# Code Attempt Review Contract

This contract defines the version-specific review attached to an explicit
LeetCode Code Attempt. The Code Attempt remains the exact user-code evidence;
the activity final review remains a separate, holistic coaching artifact.

## Write lifecycle

Every new write supplies `review` in exactly one V1 state:

```ts
type CodeAttemptReviewV1 =
  | { schemaVersion: 1; status: "pending" }
  | {
      schemaVersion: 1;
      status: "complete";
      summary: string;
      whatWentWell: string[];
      whatToImprove: string[];
      testingEvidence: string[];
      nextStep?: string;
      provenance: "specialist_observed" | "explicit_evidence_backfill";
      reviewedAt: number; // Unix epoch milliseconds in UTC
    };
```

- Save exact code immediately with `pending` if evaluation is not finished.
- A pending write may update only the review and observed evaluation evidence.
  It cannot change attempt ID, activity, originating turn, sequence, language,
  code, or occurrence time.
- A complete attempt is immutable. Revised code is a new attempt with its own
  sequence and review.
- Exact retries are idempotent. Conflicting retries fail.
- A complete normal write names the existing visible specialist transcript
  turn in `reviewResponseTurnId`. Every substantive review statement must be
  visible there, and testing conclusions must be supported by the attempt's
  stored evaluation evidence.
- Before completing that review, the specialist inspects the exact submitted
  source for the user's own time-complexity, space-complexity, and edge-case
  analysis (normally in comments or an explicitly supplied explanation). Each
  present claim is checked against the algorithm and observed evaluation
  evidence. If any item is absent, the specialist must pause the final review
  and ask the user to provide it rather than silently filling it in or offering
  a skip. If the user explicitly says they do not know, the specialist may
  teach and record the correct analysis, clearly labeling it as specialist
  coaching rather than user-provided reasoning. Submission itself may already
  have completed; this checklist gates completion of the attempt review and
  activity finalization, not the platform submission.
- Complete LeetCode finalization is blocked while any new V1 review remains
  pending. Legacy null or unknown review objects do not retroactively block an
  already-readable historical activity.
- D1 enforces one sequence per owner/activity. Runtime writes use transactional
  D1 batches to guard both race directions: a ready/published finalization
  rejects later attempts, and a finalization transition to ready rejects any
  existing pending V1 review. A failed guard rolls back its paired mutation.

## Reader behavior

The practice-record API normalizes review data before returning it:

- V1 complete renders **Attempt Review**, Summary, What Went Well, What To
  Improve, Testing Evidence, and optional Next Step.
- V1 pending renders **Review pending**.
- Legacy null, malformed, or unknown versions render **Review not recorded**.
- Unknown legacy keys never render.

The shared Code Attempt component is used both inline in Conversation and in
User Code Attempts, so both surfaces present the same normalized object. The
layout collapses to one column on narrow screens.

## Historical evidence backfill

Backfill is a coordinator operation, not a specialist MCP write. Run the
repository command with a gitignored JSON input file:

```sh
pnpm code-attempt-review:backfill --input <local-input.json>
pnpm code-attempt-review:backfill --input <local-input.json> --apply
```

Remote use additionally requires both `--remote` and `--confirm-remote`, and
must follow explicit production-mutation authorization. The input names the
attempt, activity, already-stored visible specialist response turn, complete
review, and audit reason. `ownerId` is optional: when omitted, the command
requires the attempt/activity pair to resolve to exactly one owner before it
uses that owner scope for every evidence and audit operation.

The command first reads owner-scoped D1 evidence, rejects invented or hidden
conclusions, verifies that immutable code and evaluation evidence are unchanged,
and computes an evidence hash. Applying uses one transactional D1 batch to
revalidate the legacy attempt and visible specialist response, insert one audit
row, and update only `review` and `review_response_turn_id`. After that batch
commits, a separate read verifies both exact persisted rows. An exact rerun is
idempotent; conflicting audit evidence fails.

Never commit a backfill input file, owner identifier, transcript body, exact
user code, or other private activity evidence.

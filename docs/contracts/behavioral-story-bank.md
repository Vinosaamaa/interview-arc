# Behavioral Story Bank

The Story Bank is the owner-private reusable STARL layer between accepted
evidence/claims and a question-specific final answer. It stores bounded story
facts and explicit links; it never stores a transcript, raw source, job
description, generated scenario, local locator, private remote, or credential.

## Write contract

`upsert_behavioral_story` accepts:

- a stable `operationId` and exact `expectedRevision` (`0` creates);
- `schemaVersion: 1`, stable `storyId`, `active|archived` state, title, and
  project key;
- Situation, Task, ordered Actions, Result, and Learning;
- exact owner-private claim and accepted-evidence IDs;
- explicit gaps, competencies, and behavioral-question IDs;
- `visibility: owner_private`.

All evidence must be accepted and belong to the story project. Every claim
must exist for the same owner, remain non-contradicted, belong to a linked
question, and use the selected evidence. Generated prose cannot create these
truth links.

Every material change appends an immutable revision. The stable story row is
only a current pointer. An identical new operation records an `unchanged`
receipt; an identical retry of the same operation returns its original receipt.
Changing a reused operation ID or writing against a stale expected revision
fails closed. Concurrent writers produce one winner.

## Read contract

`query_behavioral_stories` returns bounded owner-private data by:

- exact `storyId` and optional historical `revision`;
- exact `questionId`; or
- the current active library.

Archived stories are excluded unless explicitly requested. Ordinary
`query_behavioral_evidence` returns at most three current active story
candidates for the exact question and reports truncation.

The Behavioral Foundation Story Shelf shows bounded current summaries only.
It does not replace the question-scoped preflight.

## Finalization contract

When a final answer uses a Story Bank entry, `finalAnswerSnapshot.story` must
contain its exact current `storyId` and `revision`. The story must be active,
linked to the activity question, owner-scoped, and backed by evidence IDs also
present in the immutable final-answer snapshot. D1 rechecks the story inside
the finalization transaction so a concurrent story revision cannot be silently
misrepresented.

Historical attempts keep their original story revision. A later story revision
never rewrites a completed answer; correcting the answer uses the explicit
final-answer correction operation.

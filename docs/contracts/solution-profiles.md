# Reusable Solution Profiles

A Problem Bank item owns one current Solution Profile plus immutable revisions.
Every completed attempt in Past links to the exact revision it produced. Past
owns attempt-specific facts: transcript, feedback, timer, outcome, notes,
session membership, and audio. Never copy a transcript into a Solution Profile.
Behavioral attempts also retain their exact final-answer snapshot under
`behavioral-final-answer-snapshots.md`; a later Profile revision never rewrites
that historical answer.

Follow `reader-rendering.md` for the boundary between durable profile content
and the shared runtime reader. Visual/template improvements do not create a new
profile revision. Missing or materially improved canonical content does.

## LeetCode

1. Pattern recognition and constraints
2. Best approach
3. Reference implementation
4. Correctness reasoning
5. Time and space complexity
6. Edge cases
7. Up to two meaningful alternatives and when to use them
8. Common mistakes and recall cues
9. References

Use normalized technique tags such as `dfs`, `sliding-window`,
`topological-sort`, or `binary-search-on-answer`.

## System design

Use the `$interview-arc-system-design` skill and its solution template. Keep
functional requirements and non-functional requirements separate. Use
normalized domain/concept tags such as `feed-ranking`, `event-streaming`,
`rate-limiting`, `hot-partitions`, or `multi-region`.

## Behavioral

1. Interview signal and what the prompt is testing
2. Truthful Situation
3. Truthful Task
4. Truthful Actions, emphasizing personal ownership and decisions
5. Verified Result; expose missing metrics rather than inventing them
6. Learning
7. Concise interview-ready STARL answer
8. Likely follow-ups and evidence gaps
9. Reference answer patterns and sources consulted

The structured behavioral answer contains:

- one **Preferred personal answer**, polished from the mock conversation and
  grounded only in verified user experience;
- the evidence supporting that answer and any unresolved evidence gaps;
- up to five optional truthful alternative story variants, each with a label
  and guidance on when it is a better fit.

An explicit, scoped owner confirmation is valid primary evidence for lived
experience; code, tickets, logs, or documents are optional corroboration. An
assistant-generated possibility or draft is never evidence, and an unconfirmed
detail or metric remains a visible gap.

### Hypothetical and fictional practice scenarios

A behavioral profile may also contain optional `practiceScenarios`, separate
from the preferred personal answer and truthful alternatives. Each scenario
has a stable ID and revision, mode `hypothetical | fictional`, conspicuous
label, purpose, fixed scenario canon, real source facts and evidence references,
invented premises/actions/results, a complete answer, challenge map, likely
follow-ups, and limitations.

The specialist grills a scenario with the same depth as a real story and may
use natural first-person past tense inside the labeled exercise. Follow-ups
reuse its canon; a material invented addition creates a scenario revision
rather than silently changing prior answers. Invented elements remain
technically plausible and consistent with accepted project facts unless the
canon explicitly marks an altered premise. Every standalone reader, export, or
derivative preserves **Hypothetical** or **Fictional practice scenario — not the
owner's experience**. Default visibility is owner-private.

A practice scenario may reuse accepted project facts, but it never supplies or
upgrades evidence, a claim, résumé fact, Story Bank story, preferred personal
answer, or truthful alternative. Promotion is never automatic: a separate
personal answer must be rebuilt only from accepted owner-confirmed facts. A
materially useful scenario may revise the Solution Profile without implying
that its preferred personal answer changed.

The preferred answer is the user's canonical rehearsal answer for this
question. A later mock may improve it or promote an alternative story, creating
a new immutable revision. If nothing material improves, link the new attempt to
the current revision instead of duplicating it.

The profile may contain a polished answer supported by verified user evidence.
It must not contain the activity transcript, raw dialogue, or claims the user
did not establish. Use competency/evidence tags such as `conflict`,
`ownership`, `customer-focus`, `failure-learning`, `resume-foundation`, and an
employer/project tag when relevant.

# Reusable Solution Profiles

A Problem Bank item owns one current Solution Profile plus immutable revisions.
Every completed attempt in Past links to the exact revision it produced. Past
owns attempt-specific facts: transcript, feedback, timer, outcome, notes,
session membership, and audio. Never copy a transcript into a Solution Profile.

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

The preferred answer is the user's canonical rehearsal answer for this
question. A later mock may improve it or promote an alternative story, creating
a new immutable revision. If nothing material improves, link the new attempt to
the current revision instead of duplicating it.

The profile may contain a polished answer supported by verified user evidence.
It must not contain the activity transcript, raw dialogue, or claims the user
did not establish. Use competency/evidence tags such as `conflict`,
`ownership`, `customer-focus`, `failure-learning`, `resume-foundation`, and an
employer/project tag when relevant.

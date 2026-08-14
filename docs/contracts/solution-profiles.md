# Reusable Solution Profiles

A Problem Bank item owns one current Solution Profile plus immutable revisions.
Every completed attempt in Past links to the exact revision it produced. Past
owns attempt-specific facts: transcript, feedback, timer, outcome, notes,
session membership, and audio. Never copy a transcript into a Solution Profile.
An independently published canonical Solution Profile revision is not a
practice attempt and must never become its own Past row merely because it has a
Git artifact; only an artifact with an exact `activity_id` may represent an
attempt in Past.
Behavioral attempts also retain their exact final-answer snapshot under
`behavioral-final-answer-snapshots.md`; a later Profile revision never rewrites
that historical answer.

Follow `reader-rendering.md` for the boundary between durable profile content
and the shared runtime reader. Visual/template improvements do not create a new
profile revision. Missing or materially improved canonical content does.

## Completeness and depth gate

A Solution Profile is a durable reference solution, not a summary card. Every
section must be concrete, substantive, distinct, and independently useful to a
reader who cannot reopen the specialist conversation. A heading, keyword list,
one-sentence name-drop, repeated boilerplate, or code-free algorithm mention is
not content. Write to the depth the problem requires; do not add padding merely
to satisfy a length check.

The executable policy in `app/solution-profile-policy.ts` is a finalization
gate. A complete specialist finalization fails before any D1 mutation when its
profile is shallow or structurally incomplete. Legacy immutable revisions stay
unchanged; repair them only by creating a new, evidence-grounded revision.

Every durable reader and explicitly authorized export renders the exact pinned
profile revision. It must not replace a section with a shorter paraphrase or
drop an approach or code block.

## LeetCode

Begin with an original, concise, self-contained problem restatement: objective,
inputs/outputs, exact rules, solution-shaping constraints, material examples or
visuals, and required API. Concision never permits a missing fact.

1. Pattern recognition and constraints
2. Best approach
3. Reference implementation
4. Correctness reasoning
5. Time and space complexity
6. Edge cases
7. Editorial-first approach catalog
8. Common mistakes and recall cues
9. Concise interview walkthrough
10. References

After the preferred solution, list every verified Editorial approach first as
`### Editorial approach: <name>`, then add `### Generated alternative: <name>`
only until there are at least three distinct valid approaches counting the
preferred: `max(0, 3 - distinct(preferred + Editorial))`. Include all Editorial
approaches even above three; deduplicate by algorithm, never title or cosmetic
variation.

Every catalog entry keeps the existing alternative contract: when/why to use
it, complete algorithm and transition, invariant/proof, time/space complexity,
edge cases, preferred comparison, and runnable Java code. Add independently
written pseudocode when it materially improves understanding. Cite consulted
Editorials, copy no official prose/code, and report unavailable access honestly.

### Background authoring and publication reuse

During final review, the parent may delegate the complete profile to the
bounded authoring child using only verified problem facts, independently
summarized Editorial mechanics, and references. A separate mechanical child
stores the completed bytes unchanged. Later finalization and readers reuse that
profile without fresh research or a shorter rewrite.

The preferred implementation contains complete runnable Java and Python code
and renders in one panel with Java/Python tabs.

Use normalized technique tags such as `dfs`, `sliding-window`,
`topological-sort`, or `binary-search-on-answer`.

## System design

Every reusable design contains distinct, detailed sections for problem framing
and assumptions; functional requirements; non-functional requirements;
quantified capacity estimates; fenced HTTP API contracts; structured data
records; high-level architecture and component responsibilities; end-to-end
flows; scaling and performance; reliability and failure recovery; security and
privacy; observability and operations; alternatives and tradeoffs; an interview
walkthrough; and likely follow-ups. Include a versioned draw.io source and
exported SVG architecture diagram. Describe authorities, invariants, access
patterns, bottlenecks, partial failures, recovery, and why each major choice wins
over an alternative. Component name-drops and unquantified boxes-and-arrows do
not pass.

Use the `$interview-arc-system-design` skill and its solution template. Keep
functional requirements and non-functional requirements separate. Use
normalized domain/concept tags such as `feed-ranking`, `event-streaming`,
`rate-limiting`, `hot-partitions`, or `multi-region`.

## Behavioral

Project-specific overview, résumé-claim, architecture, decision, challenge,
incident, scale, and result profiles additionally follow
`behavioral-project-deep-dives.md`. That contract supplies stable project
identity, typed focus, required keyed sections, immutable attempt links, and
the link-only relationship to Learn.

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

The preferred answer and every included truthful alternative must be complete,
interview-ready, and independently understandable. Each alternative identifies
when to use it and carries its own accepted evidence or explicit evidence gaps.
The surrounding sections explain the interview signal, truthful Situation,
Task, personally owned Actions and decisions, verified Result and unresolved
metrics, Learning, likely follow-ups, gaps, and reusable answer structure. A
short polished paragraph does not replace those analysis sections.

For a Project Deep Dive, an optional alternative may be a concise focus pivot
rather than a second full STAR story. It still needs an independently usable
answer, when-to-use guidance, and accepted evidence or explicit gaps; its depth
is evaluated together with the exact comprehensive keyed sections it selects
from, not by forcing that pivot to repeat the entire project walkthrough.

Project Deep Dives use their exact focus-specific stable section keys in
contract order. Every keyed section must contain the actual project mechanics,
evidence boundary, decisions, operations, results/gaps, walkthrough, or
follow-ups implied by its key. Populating all keys with generic sentences does
not satisfy the contract.

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

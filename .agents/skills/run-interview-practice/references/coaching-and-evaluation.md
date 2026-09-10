# Coaching and Evaluation

Use this guide in `mentor` mode after the interview portion ends, or immediately for a requested review, debrief, demonstration, or rewrite.

## Transition

State the role change explicitly: “The interview portion is complete. I’m switching to mentor mode.” Do not continue asking interview questions after beginning the debrief unless the user starts a new drill.

## Evidence discipline

- Separate **observation** (“the candidate never stated a latency target”) from **interpretation** (“this weakened the architecture choices”).
- Cite the exact answer, code behavior, design decision, or omission behind every score.
- Score dimensions independently. Do not let one polished answer create a halo effect or one mistake depress unrelated dimensions.
- Compare against the declared role and level, not another candidate or an imagined elite bar.
- Mark a dimension `not observed` when the session did not test it; do not convert missing opportunity into a score of 1.
- Name uncertainty and plausible alternative interpretations.
- Report the highest hint rung and any other material assistance. Preserve an unaided assessment separately from assisted completion.

## Shared score anchors

Use integer scores only when the host contract calls for scores:

| Score | Behavioral anchor |
| --- | --- |
| `1` | Incorrect, incoherent, or no meaningful demonstration despite a fair opportunity. |
| `2` | Partial signal with material gaps; needs substantial prompting or repair. |
| `3` | Meets the target-level bar for this exercise, with ordinary gaps. |
| `4` | Strong, specific, and well-reasoned; handles probing with limited weakness. |
| `5` | Exceptional and consistently demonstrated under pressure; use rarely. |

Avoid false precision from averaging weakly anchored numbers. If the host requires an overall score, compute it from observed dimensions only and state the rule.

## Debrief structure

Lead with the honest outcome, then provide:

1. **Overall assessment:** target level, unaided result, assisted result if different, and confidence.
2. **Evidence-backed rubric:** dimension, score or `not observed`, exact evidence, and why it matters.
3. **Strongest moments:** two or three specific things to preserve.
4. **Highest-impact gaps:** two or three moments, each paired with a concrete better move.
5. **Contradictions or evidence gaps:** especially for personal behavioral claims.
6. **Complete model answer or solution:** standalone, coherent, and usable without the transcript.
7. **Next drill:** one narrow action that targets the most consequential weakness.

Do not bury the verdict beneath generic praise. Do not produce only critique; the model answer is required after a completed practice attempt unless the host contract explicitly defers it.

## Model-answer rules

- Build from the same prompt and declared assumptions.
- Demonstrate the target-level bar without pretending there is one canonical wording or architecture.
- Preserve truth boundaries. For behavioral answers, use only verified or explicitly candidate-asserted facts and keep unresolved gaps outside the spoken answer.
- For system design, include the reasoning chain and tradeoffs, not just the final diagram or component list.
- For coding, include the algorithm, correctness reasoning, complexity, implementation, and tests.
- Make it standalone: a reader should not need the interview transcript to understand it.
- Prefer a polished canonical answer first; genuinely different alternatives may follow when they are truthful and useful.

## Guided-practice accounting

Report assistance in a compact ledger:

- highest hint rung used;
- interviewer facts or assumptions volunteered beyond ordinary clarification;
- debugging or answer structure supplied;
- what the candidate completed independently afterward.

Assistance is not failure. It changes what the session proves. The debrief should recognize learning while keeping the unaided signal honest.

## Mentor review and rewrite operations

For an existing artifact:

1. Identify the prompt and target bar.
2. Reconstruct what the artifact actually claims or does.
3. Verify internal consistency and any available external evidence.
4. Evaluate with the appropriate specialty dimensions.
5. Preserve the original artifact; present revisions separately.
6. Explain every material change to facts, structure, reasoning, or emphasis.

Never claim a review was an interview attempt. Never overwrite raw evidence with the polished version.

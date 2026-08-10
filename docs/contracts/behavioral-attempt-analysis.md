# Behavioral Attempt Analysis

Every new completed behavioral finalization owns one typed `behavioralAnalysis`
inside its immutable final-answer snapshot. It audits the answer that was
actually evaluated; it is not a second attempt record and is not the current
canonical Solution Profile.

## Version 1

The specialist supplies the answer format, bounded competency labels, a claim
audit, strengths, improvements, generated coaching, likely follow-ups, and one
next drill. Each claim is exactly one of `verified`, `partial`, `unverified`, or
`contradicted` and keeps supporting evidence IDs, contrary evidence IDs, gaps,
and contradiction text in separate fields. Eight fixed review dimensions—
relevance, structure, specificity, personal ownership, decisions, result,
learning, and delivery—record `strength`, `mixed`, `improvement`, or
`not_observed`; observed dimensions require a concise observation.

- Verified claims require accepted supporting evidence and no unresolved gap
  or contradiction.
- Partial claims require support plus an explicit unresolved gap or
  contradiction.
- Unverified claims contain an explicit gap and assert no evidence.
- Contradicted claims require accepted contrary evidence and an explicit
  contradiction.
- Generated coaching is never an evidence ID or a factual claim.

Strengths and improvements reuse the visible finalization review exactly. The
union of claim gaps and contradictions equals the immutable final-answer
snapshot metadata; supporting IDs are a subset of its accepted evidence. D1
also verifies every contrary ID as accepted, owner-scoped, and linked to the
exact question with `contrary` relevance.

The analysis shares the final answer's stable operation, snapshot revision,
explicit correction, owner isolation, typed/Voice transcript provenance, and
exact-retry rules. A correction appends a new snapshot and analysis; it never
rewrites the historical attempt. Legacy records remain readable with no
fabricated analysis.

Past renders **Behavioral Attempt** separately from Conversation, Final
tailored answer, Practice scenarios, and Review. Coordinator Markdown, local
HTML, and Export Today use the same authoritative projection.

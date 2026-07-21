# Behavioral Resume Evidence Workflow

Resume evidence discovery is a prerequisite curriculum, not one ordinary mock
question. The behavioral specialist must complete it before drawing unrelated
questions from the Bugfree.ai bank unless the user explicitly overrides that
order.

## Private Source Registry

Local/private sources are listed in the ignored file:

```text
private-sources/sources.local.json
```

The registry may point to a resume, past ChatGPT exports, user-authored project
notes, architecture documents, and user-owned source repositories. Never commit
the registry or its source material. Never upload employer-confidential source
code, secrets, customer data, internal URLs, or proprietary documents to D1,
GitHub, or an external model service.

Employer source code may be consulted only when the user confirms they are
authorized to retain and use it. Prefer sanitized, user-authored evidence notes.
The durable story bank records claims and provenance, not copied company code.

## Resume-First Curriculum

Create behavioral activities in this order:

1. **Resume overview** — career narrative, role transitions, strongest themes,
   weak/uncertain claims, and an evidence inventory.
2. **Experience map** — one resumable activity for every company/major project:
   scope, users, architecture, team, ownership, constraints, timeline,
   incidents, tradeoffs, impact, and what the user personally did.
3. **Bullet verification** — one activity per resume bullet. Establish the
   situation, exact task, actions, technical decisions, collaborators,
   measurable result, evidence confidence, and likely interviewer follow-ups.
4. **Story synthesis** — only after evidence is verified, map trustworthy facts
   into reusable STAR/STARL stories and ordinary behavioral-bank questions.

One activity may span multiple Codex conversations or Pacific days. Keep the
same `activity_id` until its question is genuinely complete; append transcript
turns throughout and finalize only when the evidence record and model answer are
reviewable.

## Resume Drill Taxonomy

Resume-derived bank entries use generic `tags` in addition to normal topics:

- `resume`
- `resume-foundation` for overview and experience-map activities
- `resume-bullet` for one-bullet investigations
- `experience:<stable-company-or-project-id>`
- `evidence:unverified`, `evidence:partial`, or `evidence:verified`

Foundation entries are displayed ahead of ordinary behavioral questions until
completed. They remain visible afterward as reviewable source material.

## Truth And Model Answers

The specialist may help the user remember by examining authorized evidence and
asking concrete questions. It must never convert uncertainty into a factual
claim. Every final artifact contains:

- the complete activity transcript;
- pinned notes;
- evidence consulted and confidence/contradictions;
- what the user did well and what to improve;
- a complete, polished, standalone model answer using only verified user facts;
- unanswered questions and claims that still need evidence;
- references/provenance.

When evidence is insufficient, the “model answer” must visibly retain the gap
or provide a truthful framing; it must not invent the missing achievement.

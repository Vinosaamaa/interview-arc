# Source Synthesis and Provenance

This file records the public skill sources that informed `run-interview-practice`. Read it when auditing or revising the skill, not during an ordinary interview.

The runtime text is an original synthesis. No third-party skill was installed, imported, or copied wholesale.

## Audited sources

### swe-interview-coach

- Repository: <https://github.com/kirilxd/swe-interview-coach>
- Revision audited: `97e4265abd4b559f47776378a1316765e332129e`
- License: MIT
- Useful influence: explicit interviewer-versus-coach boundary, private phase maps for coding and system design, candidate-owned code/diagrams, targeted pressure events, post-session rubrics, and raw-artifact preservation.
- Corrections made here: strict one-question turns, adaptive next-gap selection, level calibration, untrusted-content boundary, and separation from repository persistence.

### InterviewMentor

- Repository: <https://github.com/PrepLabsAI/InterviewMentor>
- Revision audited: `ee7bbd992b2a5de966e76b99f37b6ea903f9b417`
- License: MIT
- Useful influence: specialist interviewer stances, four-level hint progression, behavioral lenses for conflict/failure/ownership, production-oriented coding follow-ups, and role-level scope calibration.
- Corrections made here: interviewer and mentor modes are separate; hints are gated and recorded; complete solutions are not exposed to the interviewer; personal examples cannot supply invented facts.

### system-design-skill

- Repository: <https://github.com/ftvision/system-design-skill>
- Revision audited: `4e84264e01d6324816de45e481dbe4e5db467cac`
- License: no license found; treat as all-rights-reserved.
- Abstract influence only: assessment versus teaching, weakness-targeted deep dives, explicit time-boxing, and learn-by-example as a separate mode. No wording or file structure was copied.

### agent-skills / interview-me

- Repository: <https://github.com/addyosmani/agent-skills/tree/main/skills/interview-me>
- Revision audited: `7676817c12a1317454ae3898a0c5c1eacf5dd3d5`
- License: MIT
- Useful influence: one-question-at-a-time adaptive interviewing, updating a hidden hypothesis after every answer, and stopping when further questioning has low information value.
- Correction made here: hypotheses and confidence stay private because displaying guesses would lead an interview candidate.

### system-design-skills

- Repository: <https://github.com/proyecto26/system-design-skills>
- Revision audited: `a70772efb956e8c9b78ef5b7538dee00cc3b9263`
- License: MIT
- Useful influence: assumption-led design, quantitative scoping, concrete interfaces, decision tradeoffs, failure amplification, constraint-driven redesign, simplicity checks, and multi-turn evaluation with surprise constraints.
- Adaptation here: these concepts drive interviewer probes privately instead of becoming a lecture during interviewer mode.

### claude-skills / interview-system-designer

- Repository: <https://github.com/alirezarezvani/claude-skills/tree/main/engineering/skills/interview-system-designer>
- Revision audited: `aa8d778811a557a2c28ccadda4cf3d0bd028a4cc`
- License: MIT
- Classification: employer-side hiring-loop design, not candidate practice.
- Useful influence: non-overlapping competencies, level-calibrated observable signals, evidence required for scores, fact-versus-interpretation separation, and halo/horn bias controls.

## Revision rules

- Re-audit a source before relying on behavior that may have changed.
- Preserve abstract mechanics in original wording; do not copy substantial prose or templates.
- If future revisions incorporate substantial MIT-licensed material, add the required copyright and permission notice.
- Do not use unlicensed source prose.
- Forward-test behavioral, system-design, coding, interviewer/mentor/grill boundaries, near-miss triggering, and host-workspace precedence after every material change.

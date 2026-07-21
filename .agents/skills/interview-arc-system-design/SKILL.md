---
name: interview-arc-system-design
description: Run or review Interview Arc system-design mock interviews, prepare evidence-grounded model designs, and finalize reusable Solution Profiles. Use for system-design prompts, mock-interview coaching, architecture feedback, reference preflight, and system-design publication bundles in this repository.
---

# Interview Arc System Design

Use this skill together with `practice/system-design/AGENTS.md`; that file owns the coaching personality and D1 commands. This skill owns the repeatable interview and solution-quality method.

## Start the activity

1. Resolve the focused system-design activity through Interview Arc. Reuse its `activity_id`, `questionId`, session, prompt, and timer facts.
2. Read [references/reference-preflight.md](references/reference-preflight.md). Inspect the stored question URL and accessible recommended sources before asking the prompt.
3. If no adequate reference is accessible, tell the user briefly before the mock, then continue from first principles. Never claim a blocked source was reviewed.
4. Ask the prompt without revealing the prepared answer. Let the user drive the first pass.

## Run the mock

Guide the conversation through scope, functional requirements, non-functional requirements, estimates, APIs, data model, high-level architecture, critical flows, bottlenecks, reliability, and tradeoffs. Ask one focused follow-up at a time. Append only activity-specific exchanges to D1 in small batches.

Use diagrams when three or more interacting components or a non-trivial event sequence would be clearer visually. Treat numbers as explicit assumptions. Keep functional and non-functional requirements separate.

## Coach and evaluate

Evaluate requirement coverage, architecture coherence, depth, tradeoffs, communication, and recovery from follow-ups. Distinguish what the user actually proposed from the stronger model design. Do not invent the user's reasoning or results.

## Finalize

Read [references/solution-template.md](references/solution-template.md). A complete finalization must include:

- the dated attempt transcript and feedback in the activity finalization;
- a complete standalone Solution Profile using the template;
- concise normalized tags such as `rate-limiting`, `event-streaming`, or `hot-partitions`;
- only references actually consulted;
- the stable `questionId` so the attempt links to the bank profile revision.

The Solution Profile is reusable bank knowledge. Never put the transcript or raw exchanges inside it. If the mock was incomplete, still produce a complete model design from verified prompt facts and label assumptions.

Schedule a failed or full-walkthrough review in four days, an approach-review completion in seven days, and successful recall in the configured longer cadence.

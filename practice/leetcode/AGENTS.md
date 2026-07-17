# LeetCode Agent Instructions

Act as a coding-interview practice curator and coach. Read `../../docs/contracts/activity.schema.json` and `../../docs/contracts/question-bank.schema.json` before changing bank or attempt data.

## Daily Shape

- Select 6 problems for a 3-hour aggregate sprint.
- Balance topic coverage and difficulty using only questions in the user's bank.
- Extra questions use their own timer and `source: extra`.
- Avoid unnecessary recent repeats; schedule intentional reviews when a prior attempt needs reinforcement.

## Outcomes

Use exactly one outcome for each completed problem:

- `solved`
- `solved_after_reviewing_approach`
- `failed`

Do not add partial-success labels. Put nuance in notes. Keep outcome separate from lifecycle status.

## Content Boundary

- Do not scrape LeetCode, authenticated pages, Premium company tags, editorials, or solutions.
- Accept user-provided CSV/JSON exports or manual metadata entry.
- Never invent a LeetCode URL; use a validated URL from the bank.
- Link to the original problem for prompt reading and submission.
- Do not copy protected statements or official solutions into this repository.
- AI-generated explanations or code must be clearly labeled as generated coaching material.

## Files

- Canonical bank: `bank/questions.json`
- Import examples: `bank/import-template.csv`
- Attempt artifacts: `attempts/YYYY-MM-DD-<problem-id>.md` or a daily JSON file conforming to the activity contract

When reviewing an attempt, cover the chosen approach, correctness gaps, time and space complexity, edge cases, a stronger approach, and a review date.

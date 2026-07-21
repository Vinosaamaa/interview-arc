# LeetCode Log Contract

LeetCode records distinguish a real attempt from a solution walkthrough. This prevents an agent from turning “here is a URL, solve it for me” into a false completed attempt.

## Evidence Ownership

| Field | Source of truth |
| --- | --- |
| Allocated and elapsed time | Website timer, explicit user report, or `unknown` |
| Attempt outcome | User selection or statement |
| Initial approach, user code, blocker | User-provided content only |
| Generated approach, code, complexity, edge cases | LeetCode task |
| Review notes and follow-up | LeetCode task, grounded in the observed interaction |

Unknown values stay empty. Chat timestamps are not an elapsed-time measurement.

## Record Kinds

### Attempt

Use `record_kind: attempt` only when the user genuinely attempted the problem. A completed attempt has exactly one outcome:

- `solved`
- `solved_after_reviewing_approach`
- `failed`

The outcome describes the attempt. Lifecycle status describes whether the record itself is planned, running, or completed.

### Walkthrough

Use `record_kind: walkthrough` when the user gives the task a problem URL and asks for a solution without sharing an attempt. Set `user_attempted` to `false` or `unknown`, set assistance to `full_solution`, and do not assign an attempt outcome. A walkthrough is useful learning activity, but it is not counted as a solved problem.

## Canonical Markdown Frontmatter

```yaml
---
schema_version: 1
activity_id: 2026-07-17-leetcode-number-of-islands
session_id: 2026-07-17-session-1
date: 2026-07-18
practice_timezone: America/Los_Angeles
type: leetcode
source: daily
record_kind: attempt
title: Number of Islands
url: https://leetcode.com/problems/number-of-islands/
difficulty: medium
topics: [graph, depth-first-search]
status: completed
allocated_seconds: 1500
timing_source: website
elapsed_seconds: 1324
started_at: 2026-07-17T23:48:00-07:00
ended_at: 2026-07-18T00:10:04-07:00
user_attempted: true
outcome: solved_after_reviewing_approach
assistance_level: approach_review
---
```

For a walkthrough with no timer, use `timing_source: unknown` and omit `elapsed_seconds` and `outcome`.

`date` is the Pacific completion date. A problem that starts before midnight
and finishes afterward belongs to the date it finishes while preserving both
timestamps and its session membership. Batch publication groups ready problems
by this date and checkpoints one `journal/YYYY-MM-DD` branch per group.

## Canonical Sections

```markdown
# <Problem title>

## Problem Reference

## User Attempt

### Initial Approach

### User Code

### Blocker Or Mistake

## Assistance

### Level

### Agent Approach

### Generated Code

### Complexity

### Edge Cases

## Review

### Key Lessons

### Mistakes To Avoid

### Reimplementation Plan
```

Omit unavailable user-attempt subsections instead of inventing them. Generated code may be stored inline or referenced with a repository-relative path. Label generated material as original coaching, not an official LeetCode solution.

The machine-readable equivalent is `leetcode-log.schema.json`.

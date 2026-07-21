# Session Artifact Contract

System-design and behavioral agents write one Markdown artifact per completed mock or substantial coached session. The task maintains a draft incrementally during long sessions and finalizes it when the user says `Publish this session`.

## Session Boundaries

1. Starting or focusing a dashboard activity establishes the prompt,
   `activity_id`, source, and draft path when the MCP bridge is available. A
   natural request such as “let's do the current mock” is an equivalent
   boundary. `Start a new session` remains a supported explicit override, not a
   phrase the user must repeat every day.
2. Append each meaningful user/coach exchange to the draft in chronological order.
3. `Publish this session` closes the transcript, adds feedback and the stronger answer, marks the artifact completed, and updates the matching activity in `data/daily/YYYY-MM-DD.json`.

Only messages after the resolved activity boundary belong to the transcript.
If no focused activity exists, the specialist must ask which prompt to use.
Publishing writes files; the main task handles pull requests and deployment.

The journal date is the Pacific (`America/Los_Angeles`) date when the activity
finishes. A mock may begin before midnight and finish after it without creating
a second transcript; the artifact belongs to the finish date while preserving
both exact timestamps and its original session ID.

## Naming

```text
practice/system-design/sessions/YYYY-MM-DD-design-<topic>.md
practice/behavioral/sessions/YYYY-MM-DD-<topic>-attempt-01.md
```

## Frontmatter

```yaml
---
schema_version: 1
activity_id: 2026-07-17-system-design-news-feed
session_id: 2026-07-17-session-1
date: 2026-07-17
practice_timezone: America/Los_Angeles
type: system_design
source: daily
title: Design a news feed
status: completed
allocated_seconds: 5400
timing_source: website
elapsed_seconds: 4872
started_at: 2026-07-17T09:00:00-07:00
ended_at: 2026-07-17T10:21:12-07:00
audio_file: 2026-07-17-news-feed-attempt-01.m4a
audio_availability: local-only
---
```

Omit `audio_file` and `audio_availability` when there is no recording. Do not put an absolute local filesystem path in a committed artifact.

Use `timing_source: website` when the value came from the website timer, `manual` when the user reported it, and `unknown` when neither source exists. When timing is unknown, omit `elapsed_seconds`, `started_at`, and `ended_at`; never estimate them from chat message timestamps.

## Required Sections

```markdown
# <Title>

## Prompt

## Conversation Transcript

**User:** ...

**Coach:** ...

## Summary

## What Went Well

## What To Improve

## Stronger Answer

## Follow-Up Questions

## Next Drill
```

The conversation transcript is the full two-sided session in chronological order. Preserve the user's meaning and the coach's questions or responses. Do not substitute a summary for the transcript. If an audio transcript contains only the user's long answer, label it clearly and keep the available conversation text around it.

System-design files may add framework sections such as requirements, capacity, APIs, data model, architecture, key flows, bottlenecks, tradeoffs, and a one-minute summary. Behavioral files may add STAR structure, signal analysis, and stronger phrasing.

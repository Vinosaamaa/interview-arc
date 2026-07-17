# Session Artifact Contract

System-design and behavioral agents write one Markdown artifact per completed mock or substantial coached session.

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
date: 2026-07-17
type: system_design
source: daily
title: Design a news feed
status: completed
allocated_seconds: 5400
elapsed_seconds: 4872
started_at: 2026-07-17T09:00:00-07:00
ended_at: 2026-07-17T10:21:12-07:00
audio_file: 2026-07-17-news-feed-attempt-01.m4a
audio_availability: local-only
---
```

Omit `audio_file` and `audio_availability` when there is no recording. Do not put an absolute local filesystem path in a committed artifact.

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

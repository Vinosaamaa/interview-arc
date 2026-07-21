# Session Artifact Contract

System-design and behavioral specialists maintain one durable D1 record per
completed mock or substantial coached session. The coordinator later renders
one Markdown artifact from that record. The specialist maintains its transcript
incrementally and finalizes the D1 bundle when the user says `Publish this
session` or the coordinator requests a flush.

## Session Boundaries

1. Starting or focusing a dashboard activity establishes the prompt,
   `activity_id`, source, and draft path when the MCP bridge is available. A
   natural request such as “let's do the current mock” is an equivalent
   boundary. `Start a new session` remains a supported explicit override, not a
   phrase the user must repeat every day.
2. Append each meaningful user/coach exchange to D1 in chronological order.
3. `Publish this session` closes the specialist draft and saves feedback,
   stronger answer, and references with `save_specialist_finalization`.
4. The coordinator reads that bundle, writes the Markdown/daily journal, and
   performs Git publication.

Only messages after the resolved activity boundary belong to the transcript.
If no focused activity exists, the specialist must ask which prompt to use.
Specialist finalization writes no files. The coordinator handles files, pull
requests, import, and deployment.

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
audio_clip_ids:
  - clip_01J...
audio_availability: private-r2
---
```

Omit `audio_clip_ids` and `audio_availability` when there is no recording.
Legacy files may retain `audio_file` with `local-only`, but new artifacts store
only owner-authorized D1 clip identifiers. Do not put an absolute local
filesystem path or public R2 object URL in a committed artifact.

Use `timing_source: website` when the value came from the website timer, `manual` when the user reported it, and `unknown` when neither source exists. When timing is unknown, omit `elapsed_seconds`, `started_at`, and `ended_at`; never estimate them from chat message timestamps.

## Required Sections

```markdown
# <Title>

## Pinned Notes

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

## Delivery Recordings

## References
```

The conversation transcript is the full two-sided session in chronological order. Preserve the user's meaning and the coach's questions or responses. Do not substitute a summary for the transcript. If an audio transcript contains only the user's long answer, label it clearly and keep the available conversation text around it.

System-design files may add framework sections such as requirements, capacity, APIs, data model, architecture, key flows, bottlenecks, tradeoffs, and a one-minute summary. Behavioral files may add STAR structure, signal analysis, and stronger phrasing.

Pinned notes preserve the user's wording and appear before the rest of the case
file. Every completed artifact includes both `What Went Well` and `What To
Improve`. `References` is last and lists only sources actually consulted with
access date/time. Review scheduling applies to both mock types: 4 days after a
failed/full walkthrough, 7 after approach review, and 21 then 60 after
successful recalls.

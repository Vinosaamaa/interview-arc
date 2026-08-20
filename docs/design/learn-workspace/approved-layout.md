# Approved Learn Workspace Layout

## Status

Approved on 2026-08-20 for issue
[#407](https://github.com/Vinosaamaa/interview-arc/issues/407).

This record preserves the approved information architecture and geometry. The
released Interview Arc visual language remains authoritative for color,
typography, controls, borders, and the raised-white selected navigation tab.

## Desktop frame

The Learn reading frame is 1,536 pixels wide when viewport space allows:

- contextual rail: 316 pixels maximum;
- gutter: 20 pixels;
- main reader: 1,200 pixels maximum.

The top Course navigation spans the same 1,536-pixel frame and aligns with both
outer edges.

```text
Courses
┌─────────────────────────────────────────────────────────────────────┐
│ Overview              Lessons              Homework       Statistics │
└─────────────────────────────────────────────────────────────────────┘
┌──────────────┐  ┌───────────────────────────────────────────────────┐
│ 316px context│  │ 1200px reader                                     │
└──────────────┘  └───────────────────────────────────────────────────┘
```

The contextual rail changes with the selected Course room:

- Overview: all Courses and Quick Studies; selecting one changes the reader;
- Lessons: the selected Course's ordered Module path;
- Homework: the selected Course's assignments;
- Statistics: the exact Course and factual evidence scope.

Lessons has no permanent third column and no permanent reader toolbar. A small
**Contents** disclosure lives inside written Lesson cards and opens a list of
links to real Lesson headings.

## Today

Today is the only Learn destination that renders the Session timer. The timer
spans the same 1,536-pixel frame above both panes.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Session state and timer                         Session actions       │
└─────────────────────────────────────────────────────────────────────┘
┌──────────────┐  ┌───────────────────────────────────────────────────┐
│ Current      │  │ In play: title, objective, revision, checkpoints, │
│ thread       │  │ and Open full lesson                              │
└──────────────┘  └───────────────────────────────────────────────────┘
```

The Today panes stretch to one shared ending line but remain content-height;
they do not fill the viewport. Courses may identify an attached Session and
link the owner back to Today, but it does not duplicate timer controls.

## Responsive behavior

Below the two-pane breakpoint, the document must not overflow horizontally.
Overview and Quick Study course lists remain horizontally selectable. Lessons
uses an explicit **Module path / Current lesson** pane switch. Today uses an
explicit **Thread / Session** pane switch. Switching panes changes only the
presentation and never mutates Enrollment, Lesson, Session, Voice, homework,
or evidence state.

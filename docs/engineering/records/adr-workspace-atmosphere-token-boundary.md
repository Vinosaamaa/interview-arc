---
schemaVersion: 1
id: adr-workspace-atmosphere-token-boundary
revision: 1
type: adr
status: accepted
title: Token Boundaries for One Shell and Three Workspaces
repository: interview-arc
capabilityIds: ["website-shell", "workspace-theming"]
createdAt: 2026-08-14
reconstructed: false
confidence: verified
unknowns: []
modules: ["application-shell", "workspace-atmosphere"]
interfaces: ["url-initial-location", "workspace-theme-tokens"]
seams: ["request-route-to-server-shell", "workspace-to-destination-atmosphere"]
adapters: ["interview-atmosphere", "learn-atmosphere", "engineering-atmosphere"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: []
amends: []
supersedes: []
learningRefs: []
diagrams: []
sources: [{"label":"Arc issue #308","url":"https://github.com/Vinosaamaa/interview-arc/issues/308","kind":"issue"},{"label":"Interview Arc design system","url":"https://github.com/Vinosaamaa/interview-arc/blob/main/design-system/interview-arc/MASTER.md","kind":"documentation"}]
verification: {"state":"verified","evidenceRefs":["issue:308","tests/website-ui-regressions.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 308
pr: 333
release: null
run: null
---
# Token Boundaries for One Shell and Three Workspaces

Interview Arc needs distinct environments for interview practice, guided learning, and engineering reflection without turning one product into three unrelated applications.

## Context

The shared shell owns navigation geometry, responsive breakpoints, focus order, typography hierarchy, and accessibility behavior. Those properties are interaction contracts: changing them by workspace would make switching expensive to relearn and multiply regression paths.

Visual atmosphere is different. Interview uses botanical evergreen, Learn uses warm ivory and instructional blue, and Engineering uses graphite, technical paper, and restrained mineral accents. Individual destinations also need enough identity to avoid appearing interchangeable.

## Decision

Use four token layers with explicit precedence:

1. global geometry, type, spacing, and interaction behavior;
2. workspace canvas, sidebar, ink, keyline, and focus tokens;
3. destination accent, pale surface, and strong-on-dark tokens;
4. semantic status and specialty tokens, which override decoration.

The canonical workspace tokens are `--workspace-canvas`,
`--workspace-canvas-deep`, `--workspace-sidebar-surface`,
`--workspace-sidebar-ink`, `--workspace-sidebar-muted`,
`--workspace-sidebar-border`, `--workspace-selection-surface`,
`--workspace-selection-ink`, `--workspace-keyline`, `--workspace-focus`,
`--workspace-paper`, and `--workspace-rule`. The shell owns their defaults;
an `.active-workspace-*` class may override only values that differ.

The canonical destination tokens are `--destination-accent`,
`--destination-accent-soft`, and `--destination-accent-strong`. The shell
provides concrete defaults and the active workspace/destination selector
overrides them directly. Destination tokens never resolve through
`--page-accent*`; this one-way ownership prevents circular custom-property
dependencies. Existing Interview-only `--page-accent*` tokens remain a legacy
adapter for Interview views and do not own Learn or Engineering colors.

Components consume the resolved workspace and destination tokens. Semantic
status and specialty selectors keep their own authoritative colors and must
not be included in broad destination selected-state selectors.

One application shell consumes these tokens. Workspaces do not fork the shell markup or its dimensions. Learn and Engineering local navigation uses the same numbered grammar as Interview, while each active destination retains `aria-current` and a structural keyline so color is never the sole state cue.

## First-paint ownership

The request URL is authoritative for the initial workspace and destination. The server passes a serializable initial location into the client shell, so the server render and first hydrated frame carry the same workspace and destination classes. Session-only memory may restore a preference only when an explicit URL has not already selected the route.

This boundary prevents a direct Learn or Engineering link from first painting Interview colors and then correcting itself after hydration.

## Consequences

New workspace destinations add tokens, not shell variants. Major panels, selected controls, buttons, focus treatment, and restrained highlights may consume a destination accent; status, error, evidence, and specialty meaning remain independent.

Forced-colors mode restores system selection boundaries. Reduced-motion mode removes atmosphere transitions without changing state. Desktop, compact, and mobile layouts keep the same navigation order and responsive geometry.

## Verification

Focused source tests assert every workspace and destination token contract. An isolated Chrome-for-Testing matrix verifies server-first theme resolution, desktop and mobile geometry, keyboard activation, compact viewport behavior, forced colors, reduced motion, and the absence of horizontal overflow.

## Interview view

The design decision is not “three themes.” It is one stable interaction model with layered visual ownership. That separation lets Interview, Learn, and Engineering feel purpose-built while keeping navigation behavior and accessibility predictable.

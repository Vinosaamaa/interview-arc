# Legacy Behavioral Target Profiles

Standalone Target Profiles are a migration-only compatibility domain. New
hiring context belongs to an Interview Loop and its immutable Role Brief
revisions. Only the Loop Recorder may create or revise a Role Brief.

## Frozen durable model

- Existing owner-private profiles, revisions, source fingerprints, states, and
  exact activity/session bindings remain readable.
- Existing revisions are immutable. No website or MCP path creates, revises,
  archives, reactivates, binds, clears, or otherwise mutates a standalone
  Target Profile.
- Raw job-description text remains private and is never returned by a read,
  export, log, live invalidation, or publication projection.
- Historical attempts retain their exact display-safe Target Profile snapshot.
  They are never relabeled as Role Brief attempts.

## Migration ownership

`query_role_brief_migration_inbox` presents undecided historical profiles to
the Loop Recorder. With explicit `authorization: loop_recorder`, the recorder
may create a Loop from the exact current profile revision, attach it to an
existing matching Loop, or archive it from the migration inbox. Every action
uses stable operation identity, exact expected revisions, owner isolation, and
an authoritative readback receipt.

Migration creates or appends a Loop-owned Role Brief revision; it does not
revise the historical profile. Coding, system-design, and behavioral
specialists may consume the resulting display-safe Role Brief and bind planned
activity context, but they cannot create a competing profile.

## Historical reads

`query_behavioral_target_profiles` remains available only for bounded,
display-safe current or exact-revision reads needed by migration and historical
attempt rendering. `resolve_behavioral_target` remains available so an already
bound historical activity/session can be finalized without falsifying its
original context.

New planned activities use Loop and optional Round bindings. Their immutable
binding stores the exact Loop revision, Role Brief revision, specialty,
question, and display-safe Role Brief snapshot. Forward-looking preflight
prefers that activity binding and returns historical Target Profile resolution
only as a compatibility fallback.

## Final-answer boundary

A new target-tailored Behavioral answer normally carries the exact bound Loop
ID, Role Brief revision, display label, company, role title, and bounded
competency emphasis. D1 verifies those values against the immutable
owner-scoped activity binding in the same finalization transaction.

An older activity with an existing standalone binding may still finalize with
its exact historical Target Profile ID and revision. Universal attempts carry
neither context. One snapshot can never contain both a Role Brief and a legacy
Target Profile.

Raw JD text, owner notes, source internals, and private analysis never enter an
attempt snapshot, Markdown/HTML export, publication payload, logs, or Git.

## Retry and conflict rules

- Exact operation retry returns its stored receipt without another revision.
- Same identity with changed content is a terminal identity conflict.
- A stale expected revision is terminal until the caller rereads.
- A binding or Role Brief change during finalization fails the transactional
  invariant guard; the specialist must reread preflight before retrying.
- An identity owned by another user is indistinguishable from an unavailable
  identity.

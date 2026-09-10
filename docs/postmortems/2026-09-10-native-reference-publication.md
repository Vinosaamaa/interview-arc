# Completed practice blocked by reference requirements

Issue: [#453](https://github.com/Vinosaamaa/interview-arc/issues/453).
Repair: [PR #460](https://github.com/Vinosaamaa/interview-arc/pull/460).

## Impact and detection

Confirmed in an actual ChatGPT test: coding and design answers, reviews and
finished timers were saved, but neither native practice record could be promoted.
The coding fixture was an original question without an official editorial. The
design fixture was intentionally text-only. No transcript was lost and no
fabricated editorial, diagram or judge result was published.

## Cause

Native finalization coupled an attempt's completion to a full reusable Solution
Profile. The coding policy required editorial provenance and design policy
required a complete reference with a versioned architecture drawing. Separately,
the late editorial/drawing writers only recognized imported completion records.
Thus the existing import path's late-reference workflow did not cover native
activities created and practiced directly through ChatGPT.

## Timeline and failed approaches

On September 10, the synthetic end-to-end run created all three question types,
exercised their timers, and saved actual text exchanges. Correcting code-review
parity saved the coding attempt but did not remove the unrelated reference gate.
Behavioral publication succeeded after truthful schema and parity corrections.
Coding remained a draft and design remained unfinalized. This repair adds an
explicit pending-reference completion path rather than inventing missing sources.

## Repair and prevention

Only coding/design may explicitly defer a missing reference, with a reason and
without an existing profile. Completion still verifies timer, outcome, transcript,
review and owner identity. Deferred records contain no fabricated profile revision.
Native additions require an exact ready/published pointer to the immutable record.
They preserve completion bytes and independently enforce owner, revision and
canonical problem identity. The reader labels the pending reference and exposes
later additions. Behavioral requirements remain intact.

Tests cover actual Worker finalization and invalid payloads, native/imported
addition eligibility, wrong-owner access, replay, stale revisions, drawing fidelity,
and migration preservation. Production verification and release receipts are
recorded on the owning issue after deployment. Rollback must retain the nullable
schema and any already-saved pending records; do not restore the old NOT NULL
constraint without reconciling those records.

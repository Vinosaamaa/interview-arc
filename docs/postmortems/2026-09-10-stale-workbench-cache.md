# Archived workbench rows restored by a stale browser

Issue: [#467](https://github.com/Vinosaamaa/interview-arc/issues/467).

## Incident and evidence

After an authorized reset, the server reported an empty current workbench. A
later phone screenshot still showed old sessions; a fresh authoritative read
then found old activities back in the current workbench. Completed practice
history was preserved. The initial cleanup verified one instant of server
state, but did not prove convergence with an already populated browser cache.

Source inspection confirmed two cooperating mechanisms. Initial browser
reconciliation compared local rows only with current server rows, inferred
creation operations for every missing local ID, and kept cached focus when
the server explicitly cleared it. Server upserts attached those IDs to the
current workbench without checking their existing archived ownership.

## Repair

The persisted mutation queue is the only source of pending writes. An
authoritative snapshot replaces display-cache data; queued creations survive
only in their originating current workbench. Archived history IDs cannot
become new optimistic rows. New browser upserts carry their workbench identity.
An atomic D1 invariant prevents activity, session and focus-block upserts from
moving an existing row out of another workbench, including older clients that
omit the workbench field. Known stale writes receive a non-retryable conflict.

## Validation and remaining boundary

Pure reconciliation tests cover stale and same-workbench display caches,
explicitly queued offline creations, old payloads missing identity, retained
history, and null authoritative focus. Local D1 tests create all three row
types, reset, replay the old writes, and verify an empty replacement before
accepting a legitimate new activity. Browser and release receipts are recorded
on the issue; this document does not substitute for those gates.

The corrective cleanup must run after release, preserve completed records,
and restore any rows already reassigned by the old browser to their archived
workbench. Do not delete completed history or merely clear one device's cache.

## Prevention

Reset acceptance requires two clients: one performs the reset while the other
retains its old cache and queue. Reopening the second client must produce no
inferred writes, no stale focus or role-context request, and no revived rows.
Offline recovery remains a separate positive test so preventing resurrection
does not discard valid queued new work. Browser cache, mutation queue and
authoritative state are distinct responsibilities.

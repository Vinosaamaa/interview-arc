# Solution publication after practice

Native and imported completed practices may receive a reusable Solution after
their original record has been saved. The separate addition pins the exact
Practice Record revision/fingerprint and immutable Solution revision. It never
rewrites the original answer, transcript, timing, outcome, completion Solution
link or behavioral final answer.

`publish_practice_solutions` reserves an owner-scoped immutable batch manifest
of 1–10 items, at most 1 MB. Each item carries its exact activity, specialty,
question, expected Practice Record revision/fingerprint, expected current
Solution revision and either a complete `create_or_revise` profile or
`reuse_current`. Zero means no current owner profile. Shared specialty quality
and project-binding validation applies unchanged.

The existing durable specialist-write outbox expands the manifest into one
child per activity. Each child atomically updates or reuses the owner profile,
stores an immutable Solution revision when content changed, and appends the
late-publication receipt. Compare-and-swap guards prevent stale overwrites.
The transaction also rechecks the original record and project binding.

Identical batch retries reuse parent and child IDs. A changed payload under the
same ID is rejected. A committed child replay returns its original receipt,
including when its worker acknowledgement was interrupted. Each child fails
or retries independently; successful siblings remain saved. Request draining
and existing scheduled recovery use the same executor and owner leases.

`get_practice_solution_batch` reports aggregate pending, saved, partial_failure
or failed, plus individual receipts. A saved parent means fan-out completed,
not that its children finished. Corrected failed items use a new batch and
fresh expected revisions. An unavailable owner profile cannot be silently
reused. Multiple activities of one question should author once, then reuse
the resulting revision in the next batch.

The worker does not invoke a model or research sources. The connected text
agent prepares full Solutions from the shared specialty contract before
enqueue. Day-end record capture uses existing native finalization or multi-
attempt backfill first. No cross-chat discovery or Voice tool access is implied.

Past exposes the late addition alongside historical record content and links
to the existing latest-Solution reader. The addition records the exact
published revision even if the bank later advances. The bank's owner profile
projection remains the canonical reusable Solution.

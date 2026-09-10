# ChatGPT practice backfill, version 1

Status: proposed contract; no importer or bank-download endpoint is implemented
by this document. Owning issue: [#453](https://github.com/Vinosaamaa/interview-arc/issues/453).

## Workflow

1. Export a dated question-bank snapshot from authenticated Interview Arc. Give
   ChatGPT the snapshot as pasted text, or an attachment after verifying that
   the selected Voice mode can read it. Ask it to repeat the snapshot identity
   and one question's identity/status before practice.
2. Use regular ChatGPT Live in the same chat. Pick the exact specialty/question
   identity, a session key, and an attempt key. Record explicit Start, Pause,
   Resume, and Finish markers. A marker without a clock reading is an event,
   not a measured timestamp.
3. At each Finish, exit Voice if needed and request a structured text export.
   Copy the available chat transcript into the packet, keeping missing sections
   explicit. Save each packet privately. At day end, aggregate these packets;
   do not reconstruct an entire day from cross-chat memory.
4. Importer validates without writes, resolves the current owner/question,
   displays timing/source gaps and proposed changes, and accepts an explicit
   Apply. It returns durable IDs, revisions, hashes and readback results.

The reusable instructions are in
[`chatgpt-practice-prompt.md`](../agents/chatgpt-practice-prompt.md). The exchange
schema is [`chatgpt-practice-exchange.schema.json`](chatgpt-practice-exchange.schema.json).
Schema conformance is necessary but does not establish evidence truth or
authorize writes. The semantic checks below are also mandatory.

## Bank snapshot

`snapshotId` identifies an immutable export; `generatedAt`, `dataAsOf` and
`timeZone` state its provenance and freshness. `scope` is `selected` or `all`;
the exporter must finish pagination before asserting `all`. Never interpret a
question missing from a selected snapshot as absent from the bank.

Each question carries `specialty`, `questionId`, `title`, optional public URL,
topics and availability. Progress is a separate nullable object containing
attempt count, last explicit outcome, last completion timestamp and review due
date. Null means unavailable, not zero attempts or unsolved. Do not compress
availability, attempt lifecycle, outcome, review status and publication into
one ambiguous question status. A question can have many attempts.

`visibility=public_catalog` requires every `progress` field to be null. Only
public-safe catalog metadata may be checked into GitHub. Owner progress,
personal questions, transcripts and actual export packets stay private even
when the GitHub repository itself is private: the existing owner-private
practice contract remains authoritative. An owner snapshot uses
`visibility=owner_private`; it contains no token, owner identifier, R2 key,
private endpoint or local file path. The exporting authenticated service binds
the owner, rather than trusting a model-supplied owner field.

ChatGPT treats progress as “as of dataAsOf,” never live state. Any activity
completed offline is a local pending event until import succeeds. Refresh the
snapshot after import. A public website or GitHub page may help discover public
questions but cannot replace private progress or a verified snapshot receipt.

## Export packet and transcript

An export contains its schema version, stable packet key, snapshot identity,
source chat keys, source coverage, timezone, sessions and attempts. Local keys
are assigned once and reused when the same material is exported again; they
are not claimed to be platform IDs. Multiple chats must be explicitly supplied
and listed. A conversation title alone cannot prove an identity.

Each attempt names one question and distinguishes `attempt`, `walkthrough` and
`discussion`. `userAttempted` and `outcome` need explicit source evidence; an
assistant showing a solution does not establish that the user solved it.
LeetCode outcomes remain `solved`, `solved_after_reviewing_approach`, or `failed`.
Unknown outcomes remain null. Other specialties use their existing finalization
contract; this transport does not invent a generic outcome vocabulary.

Transcript turns preserve speaker, stable source turn key, order, available
text, nullable timestamp and nullable source timestamp basis. Copy actual chat
text, including relevant code; never generate missing user answers, merge
speakers, or replace the conversation with a recap. The summary is separate.
`complete_provided_source` means all of the supplied source was retained, not
that the voice transcription is verbatim or all chats were discovered.
`partial` lists missing ranges. `summary_only` has no transcript turns and
cannot be finalized as a transcript-backed attempt. Administrative export
instructions remain outside the practice transcript.

Corrections preserve original source text and attach an explicit correction;
the v1 packet uses `gaps` to flag corrections requiring review rather than
silently editing evidence. Audio is not claimed, synthesized or inferred from
text. Uploaded original audio would require a separate authenticated asset
ingestion contract and its byte/hash receipt.

## Timing without a pretend stopwatch

Approximate timing is accepted. Do not require a timestamp on every command
or block practice because a stopwatch is unavailable. Start opens the logical
timer, Pause suspends it, Resume reopens it, and Finish closes it. Preserve an
ordered `events` log and `state` even when timestamps are null. Repeated Start
while running and Pause while paused are no-ops, not additional intervals.
Resume before Start is invalid. A finished attempt needs a new attempt key to
restart. Finish may close a running or paused attempt. Ending a Voice call
does not itself imply Finish.

Use actual available event times where possible. Without them, ask once at
Finish for an approximate active duration, if the user wants to supply one;
“about 20 minutes” is valid estimated timing. Otherwise retain unknown timing.
Do not claim an unsupported background counter. Import validates event state
transitions and any intervals derived from timestamped events.

Both the session and each activity carry independent timing objects:

| Basis | Permitted representation |
| --- | --- |
| `observed_clock` | Explicit externally captured start/end intervals and evidence references; the importer calculates elapsed time. |
| `user_reported` | User-stated boundaries or elapsed duration, with their source reference; retained as reported timing. |
| `estimated` | Explicitly labelled duration estimate and its reason; never written into measured timer totals. |
| `unknown` | No elapsed value and no synthetic intervals. Start/Finish dialogue alone is insufficient. |

Every boundary includes an offset-bearing timestamp. `timeZone` is an IANA
zone, not an abbreviation. Preserve exact timestamps across midnight;
completion date is derived in the repository's practice timezone
`America/Los_Angeles`. Export time and import time are distinct from practice
time. Unknown completion time does not become midnight or the import time.
When only the practice date is known, retain `practiceDate` with
`dateBasis=user_reported` and leave exact timestamps null. This permits honest
day-level backfill without demanding clock precision. A derived date must match
the actual completion instant in the practice timezone.

An interval is active time between a known Start/Resume and Pause/Finish. Reject
negative or overlapping intervals, duplicate boundaries, missing offsets,
invalid calendar timestamps and arithmetic mismatches. Compute seconds using
instants, including DST transitions. Unknown pause duration makes active time
unknown even when overall wall time is known. Do not infer silence as pause,
sum activity durations as session duration, or count unrelated conversation.
`reportedSeconds` is used only for `user_reported`/`estimated`; observed elapsed
seconds are calculated, not model-authored. A user report with intervals must
agree with their sum if a reported total is also provided.

Real timer evidence may come from Interview Arc, an explicit device-clock
record, or user-supplied timestamps. A model's “I started a timer” assertion and
memory are not clock evidence. Observed intervals must reference supplied
evidence which the importing adapter can inspect. Chat message timestamps, if
available from an actual export, are message events rather than proof of
continuous active practice.

## Validation, reconciliation and apply

Before any durable mutation, an importer must:

1. Validate the version/schema, bounded size, IANA timezone and semantic rules;
   reject unknown versions and unknown fields instead of guessing.
2. Resolve authenticated ownership independently. Resolve exact
   `(specialty, questionId)` against current bank state. A missing/inactive
   question or changed identity requires a review decision, never fuzzy linking.
3. Require unique source/chat/session/attempt/turn keys and contiguous ordered
   transcript turns per attempt. Every referenced source key and evidence
   reference must resolve to supplied material. Distinguish duplicate imports
   from a second genuine attempt at the same question.
4. Preview the source, coverage, missing evidence, timing basis, outcome,
   duplicate status and intended target. Default to a new historical session;
   do not attach to Today's active session or alter any running timer.
5. Derive canonical payload hashes in trusted code, not ChatGPT. Persist an
   owner-scoped import receipt and unique mapping for each source chat/session/
   attempt key. Same identity plus same hash returns the existing receipt;
   same identity plus different bytes is a conflict requiring an explicit
   correction operation. A new packet ID must not bypass attempt-level dedupe.
6. After authorized Apply, atomically claim the import identity and write the
   accepted draft evidence and exact mappings. Use expected revisions for any
   explicit amendment; never overwrite completed timers or immutable records.
   Retrying after an uncertain response first reads the receipt.
7. Run existing specialist finalization requirements separately. Approximate
   or unknown time does not by itself block transcript backfill; retain its
   label. Missing required outcome, source coverage or review stays visibly pending; importing a packet
   is not proof of readiness/publication. Reusable Solution Profiles are not
   created or overwritten merely because ChatGPT supplied an answer.
8. Read back all accepted IDs/revisions/hashes and report complete, partial or
   rejected results. Advance bank progress only from accepted canonical events.

Deleted targets must not be recreated by backfill. An importer must check
administrative deletion protection and preserve retry receipts. Unknown or
estimated duration requires a provenance-aware historical timing representation;
do not shoehorn it into the existing exact live timer. This is missing runtime
work, not permission for manual database writes.

## Existing support and remaining implementation

The current repository supplies question-bank schemas, owner-scoped practice
records, transcript storage, separate Solution Profile revisions, live timers
and finalization jobs. See `db/schema.ts`, `db/durable-practice.ts`,
`db/specialist-write-jobs.ts`, and the
[`owner-private practice contract`](owner-private-practice-records.md).

It does not yet implement this exchange, an authenticated snapshot download,
a historical-import preview/apply flow, an import identity ledger, or the
timing-provenance projection described above. The existing
`app/api/practice-record/route.ts` is a read route, not an import endpoint.
`source=imported` on a transcript alone does not satisfy this contract.

Runtime acceptance must cover: same-packet retry; changed-byte conflict;
new-packet duplicate attempt; owner isolation; stale bank metadata; unknown and
estimated time; pauses and DST; midnight completion; truncated/multi-chat
sources; walkthrough versus real attempt; ambiguous write recovery; existing
completed target; deleted target; and unchanged running Today timers. Test the
chosen ChatGPT account/mode with a synthetic snapshot before promising file
access. No private practice fixture belongs in Git.

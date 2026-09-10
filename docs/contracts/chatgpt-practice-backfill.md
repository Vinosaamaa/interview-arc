# ChatGPT practice exchange v1

**Versioned transport and historical import contract.** Owns the source packet
used by the [practice guide](../agents/chatgpt-practice-prompt.md), including direct connector saves.
Issue [#453](https://github.com/Vinosaamaa/interview-arc/issues/453);
PR [#454](https://github.com/Vinosaamaa/interview-arc/pull/454).

The [JSON Schema](chatgpt-practice-exchange.schema.json) accepts two document
kinds: `bank_snapshot` and `practice_export`, each with `schemaVersion: 1`.
This v1 ships with PR #454; deployment is a separate release gate. Prior draft
shapes are superseded. An incompatible change requires a new version. Reject unsupported
versions instead of guessing. The examples are entirely synthetic:

- [Selected public bank](chatgpt-bank-synthetic.example.json)
- [Voice plus text session export](chatgpt-backfill-synthetic.example.json)

## Bank input

The connected workflow uses authenticated MCP `search` and `fetch` at the
separate `/chatgpt/mcp` surface. It reads the same current owner-private bank
service. `preview_practice_backfill`, `apply_practice_backfill` and
`get_practice_backfill_receipt` reuse the importer below without manual files.
Connector packets retain the 1 MB importer bound and return compact immutable receipts.
Provider setup and account access follow the
[connection assessment](../architecture/chatgpt-live-capabilities.md).

The earlier browser exchange remains available as a recovery option:

A user can paste selected catalog/status rows or upload existing bank JSON.
ChatGPT may normalize them to this snapshot, retaining exactly what was supplied.
An authenticated owner downloads a snapshot from **Past → ChatGPT practice**.
`GET /api/chatgpt-practice?bank=1&download=1` reads current public catalog and
owner-private questions, durable completed activities/imports and scheduled
reviews. Optional `specialty` returns a selected snapshot. The response is
private/no-store and contains no credential or owner identifier. This is a
browser-session download; it is separate from the OAuth-authenticated MCP connection.

| Field | Meaning |
| --- | --- |
| `snapshot` | Stable local `snapshotId`, source description, known revision and nullable `dataAsOf`. |
| `scope` | `selected` unless the complete source and all pages were actually read. |
| `visibility` | `public_catalog` requires every progress value null; real personal inputs are `owner_private`. |
| `questions[]` | Specialty, exact bank ID or null, title, public URL, available prompt, topics, availability, nullable progress. |

Map bank `id` to `questionId`; use `leetcode`, `system_design` or
`behavioral` as the specialty. Preserve missing values: no progress object
means unknown, not zero attempts. Progress separates count, last coding
outcome, last completion and review due date. Do not collapse availability,
attempt lifecycle, result and publication into one “status.”

`sourceRevision` can be a supplied commit or the source's date-only
`updatedAt`; it is not a verified current clock. Leave `dataAsOf` null unless
an actual observation/supplied timestamp is known. For several sources with
different freshness, prepare separate snapshots. Refresh creates a new snapshot
ID; keep older snapshots referenced by existing attempts. A selected snapshot
says nothing about omitted questions.

Only public-safe catalogs and synthetic examples belong in Git. Owner status,
personal questions, real exports, answers and transcripts stay private even
when the repository is private. Never include credentials, owner IDs, local
paths, private endpoints or storage keys.

## Export structure

`practice_export` contains:

- `packetId`: a local delivery identity; unchanged repeat exports retain it.
- `exportedAt`: an actual exposed/supplied timestamp, otherwise null.
- `timeZone`: `America/Los_Angeles`, the repository's practice-day convention.
- `snapshots[]`: provenance descriptors used by attempts; not duplicate banks.
- `sources[]`: supplied chat captures with stable `sourceChatKey`, kind,
  provided range, coverage, gaps and ordered turns.
- `sessions[]`: stable `sessionKey`, timing and question attempts.
- `gaps[]`: packet-wide missing sessions or unresolved conflicts.

Assign local opaque keys once, unique across the supplied chats; preserve them
when copying to another chat. Do not reuse generic chat/session/attempt labels
from a previous unrelated conversation.
Do not invent platform IDs or calculate pretend hashes. A daily packet may
combine several chats and snapshots. Exact duplicate turns/attempts are reused;
two real attempts at one question keep distinct attempt keys. Chat titles alone
are insufficient identity evidence.

Each attempt includes its stable `attemptKey`, nullable snapshot reference,
question identity/title/public URL and supplied prompt, nullable Pacific
completion date and its basis, practice mode, kind, actual attempt flag, coding outcome/evidence,
source chat/turn references, timing, summary, review and gaps. An unlisted
question can have null `questionId`; it needs explicit owner resolution,
not an invented slug or fuzzy match, before canonical persistence.

Retain the prompt actually supplied at practice time; do not replace it with a
newer bank prompt. If absent, use null and state the gap. Snapshot provenance
can identify the source version but does not recover missing prompt text.

Only a demonstrated/user-reported coding attempt may carry `solved`,
`solved_after_reviewing_approach` or `failed`. Its evidence turn keys must
resolve, and the review must state whether success is user-reported or based on
a supplied judge result. Unknown coding results stay null. Behavioral/design
results belong in the factual summary/review, not a fabricated coding outcome.
A walkthrough or discussion never becomes a solved attempt because the
assistant supplied an answer.

## Source fidelity

Copy each supplied turn exactly once with stable globally unique `turnKey`,
source order `sequence`, speaker, text/code and nullable timestamp/basis.
Sequences retain original order and may have gaps for omitted ranges; never
renumber source turns during a repeated export. Attempt `turnKeys` select
their conversation without duplicating text. Timing/result control messages may
be retained as evidence; the eventual reader excludes administration from
practice dialogue.

`complete_provided_source` means the specified supplied range was checked and
copied, not that Voice was verbatim or every chat was discovered.
`partial` requires named gaps. `summary_only` has no turns and is not
transcript evidence. Keep generated summary/review outside source turns.
An explicit correction appends evidence and review notes; original text stays
unchanged. Do not claim audio/drawings were captured when only text is present.

A source chat may gain new supplied turns at day end. Merge by stable turn key
and preserve source ordering; the same key with changed speaker/text is a
conflict. Retain all stated missing ranges; extend complete coverage only after
checking the newly supplied source. A smaller repeated capture must not erase
earlier turns.

## Approximate timing

Each session and attempt has `timing`:

| Field | Rule |
| --- | --- |
| `state` | `running`, `paused` or `finished`; a partial checkpoint may remain paused. |
| `activeMinutes` | Number or null; never derive an unknown question duration from a session-only estimate. |
| `basis` | `observed_boundaries`, `user_estimate` or `unknown`. |
| `evidence` | Explain actual clock/boundary source or quote/reference the supplied rough total; unknown may be null. |
| `events[]` | Ordered effective Start/Pause/Resume/Finish transitions; nullable times with timestamp basis and evidence. |

There is no required running background process. Start/Pause/Resume/Finish
record state; duplicate commands in the same state do not add intervals.
Resume requires pause. Finish closes running or paused state. A completed
attempt cannot be reopened as new work under the same key. Switching questions
closes the old attempt and pauses/resumes the parent as the guide specifies.

For observed boundaries, every effective transition used must have a supported
timestamp; validate order and sum active intervals, excluding pauses.
A running/paused checkpoint uses only closed intervals and must say so.
For user estimates, accept rough active minutes and preserve the user's basis.
Missing boundaries do not prevent using an estimate; never synthesize those
boundaries from the total. With no supported total, use unknown/null.

One session with two questions has one session total and two question totals;
these are separate views of the same time, not three quantities to add.
Do not sum overlapping sessions. If overlap cannot be ruled out, report
per-session totals without claiming a daily active-time total. The Pacific
practice date comes from completion evidence or the user's supplied date;
unknown stays null. Preserve actual offsets across daylight saving and midnight.

## Owner backfill boundary

The authenticated website implements preview and Apply at
`POST /api/chatgpt-practice`. It requires same-origin JSON and independently
resolved owner identity. Before saving:

1. Validate schema, bounded input, referenced IDs, chronological ordering,
   command transitions, timing arithmetic and result evidence. JSON Schema
   checks shape; it cannot prove transcript truth or reference resolution.
2. Bind the authenticated owner independently; resolve exact specialty/question
   identity against current state. Preview stale/missing questions, gaps,
   estimates, results and duplicates. Do not infer zero time or today’s date.
   Arc permits one canonical question per Pacific practice day: a second real
   source attempt stays preserved for explicit reconciliation, not silently
   discarded or inserted in violation of that rule.
3. Use an owner-scoped mapping of source chat/session/attempt identities to
   canonical records. Trusted code calculates content hashes. An exact retry
   returns the same receipt; changed content under an accepted identity needs
   explicit correction review. Changing only packet ID must not bypass dedupe.
   Partial checkpoints are retained as draft evidence, never published as a
   completed attempt; later completion is an explicit revision of that draft.
4. After authorized Apply, persist under the historical-import extension of the
   [owner-private finalization contract](owner-private-practice-records.md),
   with immutable revisions, expected-fingerprint checks and durable retry receipts.
   Never attach silently to Today's active session, rewrite a running timer,
   recreate a deleted target or overwrite a Solution Profile.
5. Read back exact accepted IDs/revisions/hashes before claiming saved. Preserve
   pending/failed records and recover ambiguous writes by checking the receipt.
   Update bank progress only from accepted canonical events.

An estimate needs a provenance-aware historical representation. Do not force it
into an exact live timer or invent completion timestamps to satisfy current
schemas. Missing timing alone need not block evidence capture, but missing
fields required by canonical finalization remain visibly pending.

## Runtime representation and limits

`chatgpt_import_packets` retains the exact parsed source packet and receipt;
`chatgpt_import_sources` retains the append-only union of original turns.
`chatgpt_import_sessions` holds the latest reviewed source-session state.
`chatgpt_import_revisions` owns immutable historical activity evidence;
`chatgpt_import_records` is its current pointer and bounded Past index. The
server assigns activity IDs and hashes. Apply batches all writes atomically,
checks old fingerprints inside the transaction, then rereads exact revisions.
An ambiguous write is recovered through its receipt. Changing packet ID alone
does not duplicate an attempt. Source identity conflicts cannot be corrected
by overwriting text or moving a turn to another chat.

Completed historical imports require an active exact bank match, Pacific date,
finished question state and source turns. Actual attempts need an affirmative
attempt flag; coding attempts also need a result with referenced evidence.
Walkthroughs remain labeled walkthroughs. Summary-only, unfinished, discussion,
unresolved and duplicate-question evidence is pending and does not affect
completed progress. A same-day second source attempt is retained for explicit
reconciliation; v1 does not merge it into an existing live/specialist record.
Resolve missing questions/dates in the preview; source/result corrections
come from a new source-preserving export. Previously resolved identities remain
stable on later daily exports. Finished source sessions cannot resume.

The historical reader shares Arc's Markdown/code renderer, suppresses automatic
remote-image loading, and displays original prompt, review, linked source
turns, gaps and timing basis. It shows current session timing separately from
the session snapshot at the immutable record revision. `GET` with `activityId`
and optional `revision` reads exact owner-scoped content; default `GET` pages
50 completed records, or pending evidence with `status=pending`.

Requests are bounded to 1 MB, 100 attempts and 2,000 source turns. Accumulated
source captures are bounded to 1.5 MB; use a new source key for a subsequent
range when necessary. Expanded packet-plus-receipt evidence is also bounded to
1.5 MB before writes, accounting for D1's whole-row limit. Split large daily
exports or heavily overlapping captures into smaller session packets. Runtime
semantic validation supplements the transport schema with graph, timing,
identity and current-bank checks. Estimated/unknown time never enters live
timer tables, and session totals never inflate question or daily totals.

# Professor lectures

An immutable prepared lesson supplies continuous listening in the Arc player and
bounded script fragments in connected text ChatGPT. Lecture playback is not an
interview or Learning Session: it never changes timers, outcomes, transcripts,
publication, homework or mastery evidence. Generated narration is distinct from
recorded user speech; Learn Voice remains transcript-only.

## Private identity and continuation

Scripts, references, chunks and positions live in owner-scoped D1 tables.
Every read and write includes the authenticated owner. A lecture ID has immutable
content; exact retries return the same fingerprint, while edits need a new ID.
Each section is at most 20,000 characters; a lecture is at most 120,000. Speech
chunks preserve section text in order, at most 3,500 characters per request.

A position carries chunk index, seconds within its audio and an independently
supplied character offset. Audio timestamps do not imply word alignment. Cursor
writes require the current revision and a stable operation ID. Atomic stale-write
guards preserve concurrent updates; retrying an identical operation returns its
receipt. A conflicting player pauses and asks the owner to reload. Network loss
can leave position saving pending; closing the browser before acknowledgement
can lose the latest unconfirmed position. The UI must not label it saved.

## Audio preparation and playback

Audio generation is an explicit website action using the deployment's Speech
configuration. The fixed provider endpoint receives only the selected script
chunk and narration settings. A 180-second per-chunk lease excludes duplicate
active requests. Failed parts can retry; ready private R2 objects are reused.
A lease-specific object is marked ready only after storage-size readback and a
conditional database commit. Provider errors never expose credentials.

The current provider is OpenAI Speech, model gpt-4o-mini-tts, cedar voice, PCM at
24 kHz, mono, signed 16-bit little endian. Each 48,000 bytes represents one
second. All ready parts are served as one WAV response with a 44-byte header,
HTTP byte ranges, private no-store headers and owner checks. The stream reads
only intersecting R2 ranges and does not buffer the entire recording. One hour
requires about 172.8 MB of PCM; this trades bandwidth for simple continuous
playback without transcoding infrastructure or client next-track callbacks.

Audio cannot begin until every part is ready. Native audio controls plus Media
Session handlers provide pause, seek and resume. Script word-count duration is
an estimate; measured PCM duration is authoritative. A recording shorter than
an hour is disclosed and requires an expanded script, never silence padding.
Physical mobile background and lock-screen behavior require device acceptance.

## ChatGPT boundary

The connector exposes list_practice_lectures, save_practice_lecture,
get_practice_lecture and save_lecture_position. Connected text retrieves the
same immutable sections and confirmed cursor as the player. Tool availability
inside consumer Live is account/surface dependent. Supply required script in
text before switching to Live when tools are unavailable. Consumer ChatGPT's
next spoken turn, automatic wake word and return from another app are not
controlled by this API. The owner starts Voice manually; the Arc player provides
continuous playback. Never claim an uninterrupted consumer Live hour was tested
from a passing server or synthetic audio check.

## Verification

`tests/professor-lectures.test.mjs` executes all migrations in SQLite and covers
owner isolation, immutable retries, conflicting cursor writers, audio leases,
provider failures, storage readback, cross-part ranges and WAV duration. Synthetic
PCM proves transport behavior only; it is not generated speech acceptance.

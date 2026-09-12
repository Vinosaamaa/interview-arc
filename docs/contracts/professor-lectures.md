# Professor lectures

An immutable prepared lesson supplies continuous listening in an embedded ChatGPT
player, with an optional Arc website player and bounded script retrieval. Lecture playback is not an
interview or Learning Session: it never changes timers, outcomes, transcripts,
publication, homework or mastery evidence. Generated narration is distinct from
recorded user speech; Learn Voice remains transcript-only.

## In-chat playback

Default to **Play free on this device**. The owner requires speech without paid
API credit. The widget and website use the same device-speech controller and
only voices whose browser `localService` flag is true. No PC service, tunnel,
external speech API or paid fallback is involved. ChatGPT prepares the original
script; the device running its embedded player speaks it after the owner presses
Play. A missing local voice is an explicit unavailable state, never permission
to generate paid audio.

The widget starts with one private script fragment and fetches one bounded
owner-scoped section ahead through `get_practice_lecture`. Short utterances retain
every character and advance automatically without another model turn. Word
boundary events, or the start of the current sentence when unavailable, supply
the resume offset. Pause and chapter changes save acknowledged cursor revisions;
save conflicts stop playback. No seconds-to-text alignment is invented.

Free device speech does not create a downloadable audio file or a measured full
recording. A one-hour script estimate remains an estimate, and voice speed varies
by device. Background and screen-lock continuity remain host-dependent acceptance
checks. Previously prepared recordings retain their existing native player.

`open_practice_lecture_player` returns an MCP Apps audio widget, compact lecture
state and widget-only media authorization. The legacy paid generation tool runs missing section calls
through `generate_lecture_audio_section`; completed sections are reused after
an interrupted widget. Speech uses the connector Worker's OPENAI_API_KEY and
incurs provider usage independently of the ChatGPT subscription. It is not part
of free playback and must never be called for the owner's free-speech request.

After every section is ready, a random 256-bit ticket authorizes only that
immutable lecture's audio for two hours. D1 stores its hash, owner, lecture,
fingerprint and expiry. `/lecture-media` validates this restricted ticket before
serving GET/HEAD and byte ranges. It accepts no owner or object-key input. Tokens
stay out of model-visible tool content. No cookies or general account credential
is exposed to the widget; no source or token is logged by the handler. A ticket
is a temporary bearer capability and must not be shared.

The widget uses one native audio element, saves acknowledged cursor revisions,
pauses on save conflicts, and supports seek, speed and measured duration. A
30–120 minute recording can be played in one hour by setting speed to its actual
duration divided by 3600. This is disclosed playback speed, never silence padding.
The host controls iframe lifetime, mobile media interruptions, background and
lock-screen playback. Actual mobile acceptance remains a release gate; an iframe
test cannot establish ChatGPT host behavior. ChatGPT Live automatic speech turns
remain a separate, unverified capability.

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

Audio generation is an explicit website or in-chat player action using the deployment's Speech
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
an estimate; measured PCM duration is authoritative. A shorter recording is
disclosed and remains playable. Meeting a one-hour request requires an expanded
script or the in-chat player's disclosed fit-to-hour speed, never silence padding.
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

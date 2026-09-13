# Listening controls and transcript

The owner rejected the released mobile player: oversized status copy, separate
Play/Pause controls, diagnostic counters, and no direct transcript navigation.
The replacement uses the existing Arc paper/teal palette, a single large play
surface, compact transport, and a transcript visible without opening settings.
Voice and chapter settings are secondary disclosures. Private screenshots and
lesson text are not design assets and are not committed.

Verified reference behavior:

- [Apple Podcasts transcripts](https://support.apple.com/en-ie/guide/iphone/iph9426049e9/26/ios/26): follow playback and tap a passage to begin there.
- [YouTube controls](https://support.google.com/youtube/answer/7509567?co=GENIE.Platform%3DAndroid&hl=en-GB): double-tap the sides to seek and hold temporarily for 2x. The owner's requested skip interval is five seconds.

Arc uses the original saved script, including every character and all sections.
Its bounded reader exposes previous/next transcript sections rather than silently
truncating a long lecture. Scrolling disables follow until the listener chooses
Follow playback. Tapping a passage resumes from that exact character for device
speech. Prepared recordings have no word timestamps, so their transcript alignment
is explicitly approximate. Their audio seek remains an exact five seconds.

Device speech has no audio timeline. Five-second gestures use ten words at the
existing 120-word-per-minute estimate and are labelled approximate. This is not
a claim of exact timing or measured hour-long playback.

Free voice research: [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) is an
Apache-licensed open-weight neural TTS model. The browser implementation can run
on the listening device; its download, memory and ChatGPT iPhone compatibility
need separate actual-host validation before it becomes an offered engine.
[Apple documents enhanced installed voices](https://support.apple.com/en-ie/111798),
but that does not establish which voices a ChatGPT WebView exposes. This player
lists only actual local voices returned by the host and never uses a paid fallback.

Design critique: the initial gesture prototype still spent too much height on
the touch surface and an empty status row. The final pass reduces that space,
keeps transcript passages at 16px, and keeps revision/character debugging out of
the visible listening view. Physical phone touch and lock-screen acceptance
remain distinct from narrow desktop viewport and synthetic pointer tests.

# Audio Answers

This folder holds local interview recordings and their tracked Markdown transcript/review files.

```text
YYYY-MM-DD-<topic>-attempt-01.m4a   local-only, ignored by Git
YYYY-MM-DD-<topic>-attempt-01.md    committed transcript and review
```

Raw `.m4a`, `.wav`, `.mp3`, `.aac`, and `.flac` files are ignored. A committed artifact references only the filename:

```yaml
audio_file: 2026-07-17-news-feed-attempt-01.m4a
audio_availability: local-only
```

The deployed website should display the filename and `Local only`. It must not create a playback link for an ignored file.

## Transcription

From the `interview-arc/` repository in the current umbrella workspace:

```bash
../.venv/bin/python scripts/transcribe_audio.py path/to/answer.m4a \
  --topic tiktok-feed \
  --prompt "Design TikTok's For You feed" \
  --session-type system_design \
  --source daily
```

The script copies audio into this folder unless `--no-copy` is passed, transcribes it with the local `faster-whisper` model, and creates a compatible Markdown review file. A standalone clone can use `./.venv/bin/python` after installing the same dependency locally.

Use these rules:

- If audio and a Voice Memos transcript are both provided, use the supplied transcript rather than transcribing again.
- If only audio is provided, run the helper.
- If only transcript text is provided, create the Markdown artifact directly.
- A recording usually contains only the user's long answer. Label that limitation; do not pretend it contains the full two-sided conversation.
- When the complete Codex conversation is available, add it under `## Conversation Transcript` in chronological order with `User` and `Coach` speaker labels.

Follow `../docs/contracts/session-artifact.md` for the complete artifact structure and specialist feedback sections.

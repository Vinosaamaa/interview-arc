#!/usr/bin/env python3
"""Transcribe an interview audio answer and create a review Markdown file."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIO_DIR = ROOT / "audio-answers"
REPO_MODEL_DIR = ROOT / ".cache" / "faster-whisper"
UMBRELLA_MODEL_DIR = ROOT.parent / ".cache" / "faster-whisper"
MODEL_DIR = UMBRELLA_MODEL_DIR if UMBRELLA_MODEL_DIR.is_dir() else REPO_MODEL_DIR


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    return value or "audio-answer"


def format_timestamp(seconds: float) -> str:
    total = int(round(seconds))
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def next_attempt_path(topic: str, date: str, suffix: str) -> Path:
    topic_slug = slugify(topic)
    for attempt in range(1, 100):
        candidate = AUDIO_DIR / f"{date}-{topic_slug}-attempt-{attempt:02d}{suffix}"
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not find an unused attempt number under audio-answers/")


def resolve_audio_path(input_path: Path, topic: str | None, date: str, no_copy: bool) -> Path:
    if not input_path.exists():
        raise FileNotFoundError(f"Audio file not found: {input_path}")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    if no_copy or input_path.resolve().parent == AUDIO_DIR.resolve():
        return input_path.resolve()

    topic_name = topic or input_path.stem
    target = next_attempt_path(topic_name, date, input_path.suffix.lower())
    shutil.copy2(input_path, target)
    return target.resolve()


def transcribe(audio_path: Path, model: str, language: str | None, device: str, compute_type: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed. Install it in ./.venv or the umbrella workspace ../.venv"
        ) from exc

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    whisper = WhisperModel(
        model,
        device=device,
        compute_type=compute_type,
        download_root=str(MODEL_DIR),
    )
    segments, info = whisper.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )
    return list(segments), info


def build_markdown(
    *,
    audio_path: Path,
    prompt: str,
    topic: str,
    date: str,
    session_type: str,
    source: str,
    model: str,
    language: str | None,
    segments,
    info,
) -> str:
    lines = []
    lines.append("---")
    lines.append("schema_version: 1")
    lines.append(f"activity_id: {date}-{session_type.replace('_', '-')}-{slugify(topic)}")
    lines.append(f"date: {date}")
    lines.append(f"type: {session_type}")
    lines.append(f"source: {source}")
    lines.append(f"title: {json.dumps(topic)}")
    lines.append("status: completed")
    lines.append(f"audio_file: {json.dumps(audio_path.name)}")
    lines.append("audio_availability: local-only")
    lines.append("---")
    lines.append("")
    lines.append(f"# {topic}")
    lines.append("")
    lines.append("## Audio")
    lines.append("")
    lines.append(f"- File: `{audio_path.name}`")
    lines.append(f"- Model: `{model}`")
    detected_language = getattr(info, "language", None) or language or "unknown"
    duration = getattr(info, "duration", None)
    lines.append(f"- Language: `{detected_language}`")
    if duration is not None:
        lines.append(f"- Duration: `{format_timestamp(float(duration))}`")
    lines.append("")
    lines.append("## Prompt")
    lines.append("")
    lines.append(prompt or "<Add the interview prompt here.>")
    lines.append("")
    lines.append("## Conversation Transcript")
    lines.append("")
    lines.append("_Only the user's recorded answer is available in this audio artifact._")
    lines.append("")

    plain_parts = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        plain_parts.append(text)
        lines.append(f"**User [{format_timestamp(segment.start)}]:** {text}")

    lines.append("")
    lines.append("## User Answer (Clean Transcript)")
    lines.append("")
    lines.append(" ".join(plain_parts) if plain_parts else "<No speech detected.>")
    lines.append("")
    lines.append("## Summary Of Answer")
    lines.append("")
    lines.append("<Agent fills this after reviewing the transcript.>")
    lines.append("")
    lines.append("## What Went Well")
    lines.append("")
    lines.append("- ")
    lines.append("")
    lines.append("## What Was Missing Or Unclear")
    lines.append("")
    lines.append("- ")
    lines.append("")
    lines.append("## Structure Feedback")
    lines.append("")
    lines.append("- Scope:")
    lines.append("- Requirements:")
    lines.append("- Capacity:")
    lines.append("- APIs:")
    lines.append("- Data model:")
    lines.append("- Architecture:")
    lines.append("- Key flows:")
    lines.append("- Bottlenecks:")
    lines.append("- Tradeoffs:")
    lines.append("- Summary:")
    lines.append("")
    lines.append("## Stronger Version")
    lines.append("")
    lines.append("<Agent writes an improved answer outline or model answer.>")
    lines.append("")
    lines.append("## Follow-Up Questions")
    lines.append("")
    lines.append("- ")
    lines.append("")
    lines.append("## Next Drill")
    lines.append("")
    lines.append("<Agent adds one concrete practice task.>")
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe an .m4a/.mp3/.wav interview answer into audio-answers/*.md"
    )
    parser.add_argument("audio", type=Path, help="Path to the audio file")
    parser.add_argument("--topic", help="Topic slug/title, e.g. tiktok-feed")
    parser.add_argument("--prompt", default="", help="Interview prompt to include in the Markdown")
    parser.add_argument(
        "--session-type",
        choices=("system_design", "behavioral"),
        default="system_design",
        help="Artifact type. Default: system_design",
    )
    parser.add_argument(
        "--source",
        choices=("daily", "extra"),
        default="daily",
        help="Whether this was a daily or extra activity. Default: daily",
    )
    parser.add_argument("--model", default="small.en", help="faster-whisper model, e.g. base.en, small.en")
    parser.add_argument("--language", default="en", help="Language code. Use 'auto' for detection")
    parser.add_argument("--device", default="cpu", help="Inference device. Default: cpu")
    parser.add_argument("--compute-type", default="int8", help="Compute type. Default: int8")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Date prefix for copied audio")
    parser.add_argument("--no-copy", action="store_true", help="Do not copy the audio into audio-answers/")
    parser.add_argument("--output", type=Path, help="Markdown output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    topic = args.topic or args.audio.stem
    language = None if args.language == "auto" else args.language

    try:
        audio_path = resolve_audio_path(args.audio, args.topic, args.date, args.no_copy)
        print(f"Audio: {audio_path}")
        print(f"Model: {args.model}")
        print("Transcribing. First run may download the model and take a while...")
        segments, info = transcribe(audio_path, args.model, language, args.device, args.compute_type)

        output_path = args.output
        if output_path is None:
            output_path = audio_path.with_suffix(".md")
        elif not output_path.is_absolute():
            output_path = (ROOT / output_path).resolve()

        markdown = build_markdown(
            audio_path=audio_path,
            prompt=args.prompt,
            topic=topic,
            date=args.date,
            session_type=args.session_type,
            source=args.source,
            model=args.model,
            language=language,
            segments=segments,
            info=info,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")
        print(f"Transcript Markdown: {output_path}")
        return 0
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

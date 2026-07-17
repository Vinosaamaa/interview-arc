#!/usr/bin/env python3
"""Import the visible LeetCode company table from a user-saved MHTML snapshot."""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import date
from email import policy
from email.parser import BytesParser
from pathlib import Path


ROW_PATTERN = re.compile(
    r'<a href="https://leetcode\.com/problems/(?P<slug>[a-z0-9-]+)(?:\?[^\"]*)?"'
    r'(?P<body>.*?)</a>',
    re.DOTALL,
)
TITLE_PATTERN = re.compile(
    r'<div class="[^"]*ellipsis line-clamp-1[^"]*"[^>]*>(?P<title>.*?)</div>',
    re.DOTALL,
)
ACCEPTANCE_PATTERN = re.compile(r'>(?P<rate>\d+(?:\.\d+)?)%</div>')
DIFFICULTY_PATTERN = re.compile(
    r'<p class="[^"]*text-sd-(?:easy|medium|hard)[^"]*">(?P<difficulty>Easy|Med\.|Hard)</p>'
)
FREQUENCY_BAR_PATTERN = re.compile(
    r'class="h-2 w-0\.5 rounded bg-brand-orange(?P<dimmed> opacity-40)?"'
)
DISPLAY_NUMBER_PATTERN = re.compile(r'^\s*(?P<number>\d+)\.\s*')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--bank", type=Path, required=True)
    parser.add_argument("--company", required=True)
    parser.add_argument("--window", default="all")
    parser.add_argument("--captured-at", default=date.today().isoformat())
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def read_html(snapshot: Path) -> str:
    message = BytesParser(policy=policy.default).parse(snapshot.open("rb"))
    for part in message.walk():
        if part.get_content_type() == "text/html":
            return part.get_content()
    raise ValueError("The MHTML snapshot does not contain an HTML document")


def normalize_title(raw_title: str) -> str:
    plain = html.unescape(re.sub(r"<[^>]+>", "", raw_title)).strip()
    return re.sub(r"^\d+\.\s*", "", plain)


def parse_display_number(raw_title: str) -> int | None:
    plain = html.unescape(re.sub(r"<[^>]+>", "", raw_title)).strip()
    match = DISPLAY_NUMBER_PATTERN.match(plain)
    return int(match.group("number")) if match else None


def normalize_difficulty(raw_difficulty: str) -> str:
    return {"Easy": "easy", "Med.": "medium", "Hard": "hard"}[raw_difficulty]


def target_minutes(difficulty: str) -> int:
    return {"easy": 20, "medium": 30, "hard": 45}[difficulty]


def parse_rows(source: str, company: str, window: str, captured_at: str) -> list[dict]:
    rows: list[dict] = []
    seen_slugs: set[str] = set()

    for match in ROW_PATTERN.finditer(source):
        slug = match.group("slug").lower()
        if slug in seen_slugs:
            continue

        body = match.group("body")
        title_match = TITLE_PATTERN.search(body)
        acceptance_match = ACCEPTANCE_PATTERN.search(body)
        difficulty_match = DIFFICULTY_PATTERN.search(body)
        frequency_bars = list(FREQUENCY_BAR_PATTERN.finditer(body))

        if not (title_match and acceptance_match and difficulty_match):
            continue

        problem_number = parse_display_number(title_match.group("title"))
        if problem_number is None:
            continue

        difficulty = normalize_difficulty(difficulty_match.group("difficulty"))
        visible_frequency = sum(1 for bar in frequency_bars if not bar.group("dimmed"))
        frequency_scale = len(frequency_bars)

        rows.append(
            {
                "id": slug,
                "problemNumber": problem_number,
                "title": normalize_title(title_match.group("title")),
                "url": f"https://leetcode.com/problems/{slug}/",
                "difficulty": difficulty,
                "acceptanceRate": float(acceptance_match.group("rate")),
                "topics": [],
                "companyTags": [company],
                "companySignals": [
                    {
                        "company": company,
                        "window": window,
                        "frequencyScore": visible_frequency,
                        "frequencyScale": frequency_scale,
                        "capturedAt": captured_at,
                    }
                ],
                "targetMinutes": target_minutes(difficulty),
                "source": "user_import",
                "active": True,
            }
        )
        seen_slugs.add(slug)

    return rows


def merge_question(existing: dict, incoming: dict) -> dict:
    merged = {**existing, **incoming}
    merged["id"] = existing.get("id", incoming["id"])
    merged["topics"] = list(dict.fromkeys([*existing.get("topics", []), *incoming.get("topics", [])]))
    merged["companyTags"] = list(
        dict.fromkeys([*existing.get("companyTags", []), *incoming.get("companyTags", [])])
    )

    signals = {
        (signal["company"].casefold(), signal["window"].casefold()): signal
        for signal in existing.get("companySignals", [])
    }
    for signal in incoming.get("companySignals", []):
        signals[(signal["company"].casefold(), signal["window"].casefold())] = signal
    merged["companySignals"] = list(signals.values())
    return merged


def main() -> None:
    args = parse_args()
    source = read_html(args.snapshot)
    imported = parse_rows(source, args.company, args.window, args.captured_at)
    if not imported:
        raise SystemExit("No complete LeetCode company rows were found in the snapshot")

    existing_bank = {"schemaVersion": 1, "updatedAt": args.captured_at, "questions": []}
    if args.bank.exists() and not args.replace:
        existing_bank = json.loads(args.bank.read_text(encoding="utf-8"))

    existing_by_slug = {
        question["url"].rstrip("/").split("/")[-1].casefold(): question
        for question in existing_bank.get("questions", [])
    }
    new_count = 0
    updated_count = 0
    output: list[dict] = []
    imported_slugs: set[str] = set()

    for question in imported:
        slug = question["id"].casefold()
        imported_slugs.add(slug)
        if slug in existing_by_slug:
            output.append(merge_question(existing_by_slug[slug], question))
            updated_count += 1
        else:
            output.append(question)
            new_count += 1

    if not args.replace:
        output.extend(
            question
            for slug, question in existing_by_slug.items()
            if slug not in imported_slugs
        )

    args.bank.parent.mkdir(parents=True, exist_ok=True)
    args.bank.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "updatedAt": args.captured_at,
                "questions": output,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "sourceRows": len(imported),
                "new": new_count,
                "updated": updated_count,
                "total": len(output),
                "company": args.company,
                "window": args.window,
            }
        )
    )


if __name__ == "__main__":
    main()

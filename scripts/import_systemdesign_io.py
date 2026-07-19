#!/usr/bin/env python3
"""Import SystemDesign.io question metadata from a saved homepage HTML file."""

from __future__ import annotations

import argparse
import json
from datetime import date
from html.parser import HTMLParser
from pathlib import Path


COMPLEXITY = {
    "Very Easy": "very_easy",
    "Easy": "easy",
    "Medium": "medium",
    "Hard": "hard",
    "Very Hard": "very_hard",
}


class QuestionTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict] = []
        self.in_row = False
        self.in_cell = False
        self.row: dict | None = None
        self.cell_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            self.in_row = True
            self.row = {"cells": [], "href": None}
        elif self.in_row and tag == "td":
            self.in_cell = True
            self.cell_text = []
        elif self.in_row and tag == "a" and self.row:
            href = attributes.get("href") or ""
            if href.startswith("/question/") and not self.row["href"]:
                self.row["href"] = href

    def handle_data(self, data: str) -> None:
        if not (self.in_row and self.in_cell):
            return
        clean = " ".join(data.split())
        if clean:
            self.cell_text.append(clean)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.in_row and self.in_cell and self.row:
            self.row["cells"].append(" ".join(self.cell_text))
            self.in_cell = False
            self.cell_text = []
        elif tag == "tr" and self.in_row:
            if self.row and self.row.get("href"):
                self.rows.append(self.row)
            self.in_row = False
            self.in_cell = False
            self.row = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--bank", type=Path, required=True)
    parser.add_argument("--captured-at", default=date.today().isoformat())
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    parser = QuestionTableParser()
    parser.feed(args.snapshot.read_text(encoding="utf-8"))

    questions: list[dict] = []
    seen: set[str] = set()
    for row in parser.rows:
        cells = row["cells"]
        href = row["href"]
        if len(cells) != 4 or not href:
            continue
        slug = href.removeprefix("/question/").strip("/")
        if not slug or slug in seen:
            continue
        title = cells[1].removesuffix(" Solutions available").strip()
        complexity = COMPLEXITY.get(cells[3])
        if not title or not complexity:
            continue
        questions.append(
            {
                "id": slug,
                "title": title,
                "prompt": title,
                "url": f"https://systemdesign.io/question/{slug}",
                "source": "SystemDesign.io",
                "complexity": complexity,
                "solutionReference": True,
                "topics": [],
                "targetMinutes": 90,
                "active": True,
            }
        )
        seen.add(slug)

    if len(questions) != 55:
        raise SystemExit(f"Expected 55 unique questions, found {len(questions)}")

    args.bank.parent.mkdir(parents=True, exist_ok=True)
    args.bank.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "type": "system_design",
                "updatedAt": args.captured_at,
                "questions": questions,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"sourceRows": len(parser.rows), "imported": len(questions)}))


if __name__ == "__main__":
    main()

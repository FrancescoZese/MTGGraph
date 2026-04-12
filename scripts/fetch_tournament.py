"""Fetch tournament decklists from MTGO and prepare them for ingestion.

Usage:
    python -m scripts.fetch_tournament <url> [--top N]

Example:
    python -m scripts.fetch_tournament https://www.mtgo.com/decklist/modern-challenge-64-2026-04-1012838872 --top 16
"""
import json
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
RAW_DIR = ROOT / "raw"


def fetch_decks(url: str) -> list[dict]:
    """Fetch and parse deck data from an MTGO tournament page."""
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()

    # Challenge format: [{"loginid":...}], League format: [{"loginplayeventcourseid":...}]
    match = re.search(r'\[\{"(?:loginid|loginplayeventcourseid)":', resp.text)
    if not match:
        print("ERROR: Could not find deck data in page")
        sys.exit(1)

    start = match.start()
    depth = 0
    for i in range(start, len(resp.text)):
        if resp.text[i] == "[":
            depth += 1
        elif resp.text[i] == "]":
            depth -= 1
        if depth == 0:
            end = i + 1
            break

    return json.loads(resp.text[start:end])


def extract_event_info(url: str) -> dict:
    """Extract event name and date from the URL slug."""
    # URL like: /decklist/modern-challenge-64-2026-04-1012838872
    slug = url.rstrip("/").split("/")[-1]

    date_match = re.search(r"(\d{4}-\d{2}-\d{2})", slug)
    date = date_match.group(1) if date_match else "unknown"

    name_match = re.match(r"([\w-]+)-\d{4}-\d{2}-\d{2}", slug)
    raw_name = name_match.group(1) if name_match else slug
    # Convert "modern-challenge-64" to "MTGO Modern Challenge 64"
    event_name = "MTGO " + raw_name.replace("-", " ").title()

    return {"date": date, "name": event_name}


def deck_to_markdown(deck: dict, finish: int, event: dict) -> str:
    """Convert a deck JSON object to our markdown format."""
    # League decks have "wins" field (can be str, int, or dict), challenges have placement
    if "wins" in deck:
        wins = deck["wins"]
        if isinstance(wins, dict):
            finish_str = f"{wins.get('wins', '5')}-{wins.get('losses', '0')}"
        else:
            finish_str = f"{wins}-0"
    else:
        finish_str = _ordinal(finish)

    lines = []
    lines.append("---")
    lines.append(f"date: {event['date']}")
    lines.append(f"source: {event['name']}")
    lines.append(f"pilot: {deck['player']}")
    lines.append(f"finish: {finish_str}")
    lines.append("---")
    lines.append("")
    lines.append("# Mainboard")

    for card in deck.get("main_deck", []):
        name = card["card_attributes"]["card_name"]
        qty = card["qty"]
        lines.append(f"{qty} {name}")

    lines.append("")
    lines.append("# Sideboard")

    for card in deck.get("sideboard_deck", []):
        name = card["card_attributes"]["card_name"]
        qty = card["qty"]
        lines.append(f"{qty} {name}")

    return "\n".join(lines) + "\n"


def _ordinal(n: int) -> str:
    if 11 <= n <= 13:
        return f"{n}th"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    url = sys.argv[1]
    top_n = 32
    if "--top" in sys.argv:
        idx = sys.argv.index("--top")
        top_n = int(sys.argv[idx + 1])

    event = extract_event_info(url)
    print(f"Event: {event['name']} ({event['date']})")

    decks = fetch_decks(url)
    print(f"Found {len(decks)} decks")

    limit = min(top_n, len(decks))
    RAW_DIR.mkdir(exist_ok=True)

    saved = []
    for i, deck in enumerate(decks[:limit], 1):
        filename = f"{event['date']}-{deck['player']}.md"
        path = RAW_DIR / filename
        content = deck_to_markdown(deck, i, event)
        path.write_text(content)
        saved.append((i, deck["player"], path))
        print(f"  {_ordinal(i):4s} {deck['player']:20s} -> {filename}")

    print(f"\nSaved {len(saved)} lists to {RAW_DIR}/")
    print(f"\nNext: ingest them with:")
    print(f"  python -m scripts.batch_ingest {RAW_DIR}/{event['date']}-*.md")


if __name__ == "__main__":
    main()

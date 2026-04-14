"""Fetch and ingest all new Modern tournament results since the last ingestion.

Usage:
    python -m scripts.update_meta [--threshold 0.6] [--top 16] [--challenges-only]

Checks mtgo.com for Modern events newer than the most recent list in knowledge/lists/,
downloads them, and runs batch ingestion interactively.
"""
import re
import sys
from datetime import date
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).parent.parent
KNOWLEDGE_DIR = ROOT / "knowledge"
RAW_DIR = ROOT / "raw"
COMPUTED_DIR = ROOT / "computed"

MTGO_DECKLISTS_URL = "https://www.mtgo.com/decklists"
MTGO_BASE_URL = "https://www.mtgo.com/decklist"


def get_last_ingested_date() -> str:
    """Find the most recent date in knowledge/lists/."""
    lists_dir = KNOWLEDGE_DIR / "lists"
    latest = "2000-01-01"

    for path in lists_dir.glob("*.md"):
        text = path.read_text()
        parts = text.split("---", 2)
        if len(parts) < 2:
            continue
        fm = yaml.safe_load(parts[1]) or {}
        d = str(fm.get("date", ""))
        if d > latest:
            latest = d

    return latest


def find_new_events(since: str, challenges_only: bool = False) -> list[dict]:
    """Find Modern events newer than `since` date.

    Uses two strategies:
    1. Fetch the MTGO decklists page and parse links (primary)
    2. Generate league URLs directly using known ID pattern (fallback for leagues)
    """
    events = []
    seen = set()

    # Strategy 1: Parse the MTGO decklists page
    print("Fetching MTGO decklists page...", flush=True)
    try:
        resp = requests.get(MTGO_DECKLISTS_URL, timeout=90)
        resp.raise_for_status()
        print(f"  Got {len(resp.text)} bytes", flush=True)

        pattern = r"/decklist/(modern-(challenge|league)[\w-]+)"
        matches = re.findall(pattern, resp.text)

        for slug, event_type in matches:
            if slug in seen:
                continue
            seen.add(slug)

            if challenges_only and event_type == "league":
                continue

            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", slug)
            if not date_match:
                continue
            event_date = date_match.group(1)

            if event_date <= since:
                continue

            name_match = re.match(r"([\w-]+)-\d{4}-\d{2}-\d{2}", slug)
            raw_name = name_match.group(1) if name_match else slug
            event_name = "MTGO " + raw_name.replace("-", " ").title()

            events.append({
                "slug": slug,
                "date": event_date,
                "name": event_name,
                "type": event_type,
                "url": f"{MTGO_BASE_URL}/{slug}",
            })

    except requests.exceptions.RequestException as e:
        print(f"  WARNING: Failed to fetch decklists page: {e}", flush=True)

    # Strategy 2: Generate league URLs for dates not found in page
    # Modern League ID is always 10397
    if not challenges_only:
        from datetime import datetime, timedelta
        since_date = datetime.strptime(since, "%Y-%m-%d").date()
        today = datetime.now().date()
        d = since_date + timedelta(days=1)
        while d <= today:
            date_str = d.strftime("%Y-%m-%d")
            slug = f"modern-league-{date_str}10397"
            if slug not in seen:
                seen.add(slug)
                events.append({
                    "slug": slug,
                    "date": date_str,
                    "name": "MTGO Modern League",
                    "type": "league",
                    "url": f"{MTGO_BASE_URL}/{slug}",
                })
            d += timedelta(days=1)

    # Sort by date ascending
    events.sort(key=lambda e: e["date"])

    # Deduplicate by date+type (keep first occurrence)
    final = []
    final_keys = set()
    for e in events:
        key = (e["date"], e["type"], e["slug"])
        if key not in final_keys:
            final_keys.add(key)
            final.append(e)

    return final


def fetch_and_save_decks(event: dict, top_n: int, league_top_n: int | None = None) -> list[Path]:
    """Fetch decklists from an event and save to raw/.

    For leagues, takes league_top_n decks (or all if None).
    For challenges, respects top_n.
    """
    from scripts.fetch_tournament import fetch_decks, deck_to_markdown

    print(f"  Downloading from {event['url']}...", flush=True)
    decks = fetch_decks(event["url"])
    print(f"  Got {len(decks)} decks", flush=True)
    if event["type"] == "league":
        limit = min(league_top_n, len(decks)) if league_top_n else len(decks)
    else:
        limit = min(top_n, len(decks))

    RAW_DIR.mkdir(exist_ok=True)
    saved = []

    for i, deck in enumerate(decks[:limit], 1):
        filename = f"{event['date']}-{deck['player']}.md"
        path = RAW_DIR / filename
        event_info = {"date": event["date"], "name": event["name"]}
        content = deck_to_markdown(deck, i, event_info)
        path.write_text(content)
        saved.append(path)

    return saved


def main():
    args = sys.argv[1:]

    threshold = 0.5
    top_n = 16
    league_top_n = None  # None = all
    challenges_only = False
    auto_mode = "--auto" in args

    if "--threshold" in args:
        idx = args.index("--threshold")
        threshold = float(args[idx + 1])
    if "--top" in args:
        idx = args.index("--top")
        top_n = int(args[idx + 1])
    if "--league-top" in args:
        idx = args.index("--league-top")
        league_top_n = int(args[idx + 1])
    if "--challenges-only" in args:
        challenges_only = True

    # Find what we already have
    last_date = get_last_ingested_date()
    print(f"Last ingested date: {last_date}")

    # Find new events
    events = find_new_events(last_date, challenges_only)
    if not events:
        print("No new events found. Meta is up to date.")
        return

    print(f"Found {len(events)} new events:")
    for e in events:
        print(f"  {e['date']}  {e['name']}")

    if not auto_mode:
        confirm = input(f"\nFetch and ingest all {len(events)} events? [Y/n] ").strip()
        if confirm.lower() == "n":
            return

    # Fetch all events
    all_files = []
    for event in events:
        print(f"\nFetching {event['name']} ({event['date']})...")
        try:
            files = fetch_and_save_decks(event, top_n)
            print(f"  Saved {len(files)} lists")
            all_files.extend(files)
        except Exception as e:
            print(f"  ERROR fetching {event['name']}: {e}")
            print(f"  Skipping this event and continuing...")
            continue

    if not all_files:
        print("No lists fetched.")
        return

    print(f"\nTotal: {len(all_files)} lists from {len(events)} events")
    print(f"Starting ingestion (threshold={threshold})...\n")

    # Import here to avoid slow startup
    from scripts.ingest import ingest_list
    from scripts.compute import write_graph
    from scripts.profile_cache import ProfileCache

    # Load cache once — avoids rereading all list files for every ingestion
    cache = ProfileCache(KNOWLEDGE_DIR)
    cache.load()

    ingested = 0
    skipped = 0
    new_archetypes = []

    for path in all_files:
        raw_text = path.read_text()
        pilot = "unknown"
        for line in raw_text.splitlines():
            if line.startswith("pilot:"):
                pilot = line.split(":", 1)[1].strip()
                break

        print(f"--- {path.name} ({pilot}) ---", flush=True)

        result = ingest_list(raw_text, KNOWLEDGE_DIR, threshold=threshold, cache=cache)

        if result.get("duplicate_of"):
            print(f"  SKIP: duplicate", flush=True)
            skipped += 1
            continue

        if result.get("needs_archetype"):
            print(f"  NEW ARCHETYPE needed", flush=True)
            print(f"  Colors: {result['colors']}", flush=True)
            print(f"  Top cards:", flush=True)
            for card in result["top_cards"][:8]:
                print(f"    {card}", flush=True)

            if auto_mode:
                unknown_num = _next_unknown_number()
                name = f"Unknown #{unknown_num}"
                slug = f"unknown-{unknown_num}"
                desc = "Unclassified archetype, pending review."
                print(f"  AUTO: {name}", flush=True)
            else:
                name = input("  Archetype name (or 'skip'): ").strip()
                if name.lower() == "skip":
                    skipped += 1
                    continue
                slug = input(f"  Slug [{_auto_slug(name)}]: ").strip() or _auto_slug(name)
                desc = input("  Description: ").strip()

            result = ingest_list(
                raw_text, KNOWLEDGE_DIR,
                threshold=threshold,
                archetype_name=name,
                archetype_slug=slug,
                archetype_description=desc,
                cache=cache,
            )
            new_archetypes.append(name)

        status = "NEW" if result.get("is_new_archetype") else "matched"
        print(f"  -> {result['archetype']} ({status})")
        ingested += 1

    print(f"\n{'='*50}")
    print(f"Ingested: {ingested}, Skipped: {skipped}")
    if new_archetypes:
        print(f"New archetypes: {', '.join(new_archetypes)}")

    if ingested > 0:
        print(f"\nRecomputing graph...")
        output = COMPUTED_DIR / "graph.json"
        write_graph(KNOWLEDGE_DIR, output)
        print(f"Done! Graph and META.md updated.")


def _next_unknown_number() -> int:
    """Find the next available Unknown #N number."""
    archetypes_dir = KNOWLEDGE_DIR / "archetypes"
    existing = set()
    for path in archetypes_dir.glob("unknown-*.md"):
        try:
            num = int(path.stem.split("-")[1])
            existing.add(num)
        except (IndexError, ValueError):
            pass
    n = 1
    while n in existing:
        n += 1
    return n


def _auto_slug(name: str) -> str:
    import re
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


if __name__ == "__main__":
    main()

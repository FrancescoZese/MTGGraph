from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.scryfall import ensure_card_file, slugify
from scripts.similarity import card_weights, find_best_match
from scripts.archetype_manager import (
    list_archetypes,
    compute_archetype_profile,
    write_archetype,
)


def ingest_list(
    raw_text: str,
    knowledge_dir: Path,
    threshold: float = 0.5,
    archetype_name: str | None = None,
    archetype_slug: str | None = None,
    archetype_description: str = "",
    cache=None,
) -> dict:
    """Ingest a raw decklist into the knowledge base.

    If cache (ProfileCache) is provided, uses it for fast dedup and profile
    lookups instead of reading all files from disk.
    """
    knowledge_dir = Path(knowledge_dir)
    cards_dir = knowledge_dir / "cards"
    archetypes_dir = knowledge_dir / "archetypes"
    lists_dir = knowledge_dir / "lists"

    parsed = parse_decklist(raw_text)
    metadata = parsed["metadata"]

    # Dedup check
    if cache:
        if cache.is_duplicate(metadata):
            return {
                "archetype": None, "is_new_archetype": False,
                "needs_archetype": False, "duplicate_of": "cached",
                "list_path": None,
            }
    else:
        duplicate = _find_duplicate(metadata, lists_dir)
        if duplicate:
            return {
                "archetype": None, "is_new_archetype": False,
                "needs_archetype": False, "duplicate_of": str(duplicate),
                "list_path": None,
            }

    # Ensure card files exist for every card in the list
    for card_name in parsed["all_card_names"]:
        try:
            ensure_card_file(card_name, cards_dir)
        except Exception as e:
            print(f"  WARNING: failed to fetch card '{card_name}': {e}")

    # Build weight vector for this list
    list_weights = card_weights(parsed["mainboard"], parsed["sideboard"])

    # Get archetype profiles
    if cache:
        profiles = cache.profiles
    else:
        archetypes = list_archetypes(archetypes_dir)
        profiles = {}
        for arch in archetypes:
            profile = compute_archetype_profile(arch["slug"], lists_dir)
            if profile:
                profiles[arch["slug"]] = profile

    # Find best match
    match_slug, score = find_best_match(list_weights, profiles, threshold=threshold)
    is_new = match_slug is None

    if is_new:
        if not archetype_name or not archetype_slug:
            top_cards = sorted(parsed["mainboard"].items(), key=lambda x: -x[1])[:10]
            colors = _derive_colors(parsed["mainboard"], cards_dir)
            return {
                "archetype": None, "is_new_archetype": True,
                "needs_archetype": True,
                "top_cards": [f"{c}: {n}" for n, c in [(count, name) for name, count in top_cards]],
                "colors": colors, "list_path": None,
            }

        colors = _derive_colors(parsed["mainboard"], cards_dir)
        match_slug = archetype_slug
        write_archetype(archetypes_dir, archetype_slug, archetype_name, colors, archetype_description)

    # Save the list file
    metadata["archetype"] = match_slug
    list_path = _save_list(raw_text, metadata, lists_dir)

    # Update cache if provided
    if cache:
        cache.add_list(parsed, match_slug)

    return {
        "archetype": match_slug,
        "is_new_archetype": is_new,
        "needs_archetype": False,
        "list_path": str(list_path),
    }


def _find_duplicate(metadata: dict, lists_dir: Path) -> Path | None:
    """Check if a list with the same date, pilot, and source already exists."""
    date = str(metadata.get("date", ""))
    pilot = str(metadata.get("pilot", ""))
    source = str(metadata.get("source", ""))

    for path in lists_dir.glob("*.md"):
        text = path.read_text()
        parts = text.split("---", 2)
        if len(parts) < 2:
            continue
        fm = yaml.safe_load(parts[1]) or {}
        if (str(fm.get("date", "")) == date
                and str(fm.get("pilot", "")) == pilot
                and str(fm.get("source", "")) == source):
            return path
    return None


def _derive_colors(mainboard: dict[str, int], cards_dir: Path) -> list[str]:
    """Read card files to determine deck colors from mainboard cards."""
    colors = set()
    for card_name in mainboard:
        slug = slugify(card_name)
        path = cards_dir / f"{slug}.md"
        if path.exists():
            text = path.read_text()
            parts = text.split("---", 2)
            if len(parts) >= 2:
                fm = yaml.safe_load(parts[1]) or {}
                for c in fm.get("colors", []):
                    colors.add(c)
    color_order = ["W", "U", "B", "R", "G"]
    return [c for c in color_order if c in colors]


def _save_list(raw_text: str, metadata: dict, lists_dir: Path) -> Path:
    """Save the decklist with updated metadata to lists/."""
    date = metadata.get("date", "unknown")
    source = metadata.get("source", "unknown")
    source_slug = slugify(source)

    base = f"{date}-{source_slug}"
    path = lists_dir / f"{base}.md"
    counter = 1
    while path.exists():
        counter += 1
        path = lists_dir / f"{base}-{counter}.md"

    body = raw_text.strip()
    if body.startswith("---"):
        parts = body.split("---", 2)
        body = parts[2] if len(parts) > 2 else ""

    content = "---\n" + yaml.dump(metadata, default_flow_style=False) + "---\n" + body
    path.write_text(content)
    return path

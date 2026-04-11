from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.similarity import card_weights


def read_archetype(path: Path) -> dict:
    """Read an archetype markdown file. Returns dict with name, colors, slug, description."""
    text = path.read_text()
    parts = text.split("---", 2)
    metadata = yaml.safe_load(parts[1]) or {}
    body = parts[2].strip() if len(parts) > 2 else ""
    return {
        "name": metadata.get("name", ""),
        "colors": metadata.get("colors", []),
        "slug": path.stem,
        "description": body,
    }


def write_archetype(directory: Path, slug: str, name: str, colors: list[str], description: str) -> Path:
    """Create a new archetype markdown file."""
    directory = Path(directory)
    path = directory / f"{slug}.md"
    frontmatter = {"name": name, "colors": colors}
    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False) + "---\n" + description + "\n"
    path.write_text(content)
    return path


def list_archetypes(directory: Path) -> list[dict]:
    """Read all archetype files from a directory."""
    directory = Path(directory)
    archetypes = []
    for path in sorted(directory.glob("*.md")):
        archetypes.append(read_archetype(path))
    return archetypes


def compute_archetype_profile(slug: str, lists_dir: Path) -> dict[str, float]:
    """Compute the average card weight profile for an archetype from its assigned lists."""
    lists_dir = Path(lists_dir)
    card_totals: dict[str, float] = {}
    list_count = 0

    for path in lists_dir.glob("*.md"):
        text = path.read_text()
        parsed = parse_decklist(text)
        if parsed["metadata"].get("archetype") != slug:
            continue
        list_count += 1
        weights = card_weights(parsed["mainboard"], parsed["sideboard"])
        for card, weight in weights.items():
            card_totals[card] = card_totals.get(card, 0.0) + weight

    if list_count == 0:
        return {}

    return {card: total / list_count for card, total in card_totals.items()}

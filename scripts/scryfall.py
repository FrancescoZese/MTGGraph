import re
import time

import requests
import yaml


def slugify(name: str) -> str:
    """Convert a card name to a filesystem-safe slug."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def fetch_card(name: str) -> dict:
    """Fetch card data from Scryfall API by exact name."""
    url = "https://api.scryfall.com/cards/named"
    response = requests.get(url, params={"exact": name})
    time.sleep(0.1)
    response.raise_for_status()
    return response.json()


def build_card_frontmatter(data: dict) -> dict:
    """Extract relevant fields from Scryfall API response."""
    image = ""
    if "image_uris" in data:
        image = data["image_uris"].get("normal", "")
    elif "card_faces" in data and data["card_faces"]:
        image = data["card_faces"][0].get("image_uris", {}).get("normal", "")

    return {
        "name": data["name"],
        "colors": data.get("colors", []),
        "cmc": int(data.get("cmc", 0)),
        "type": data.get("type_line", ""),
        "set": data.get("set", ""),
        "image": image,
        "scryfall_id": data.get("id", ""),
    }


def ensure_card_file(card_name: str, cards_dir) -> None:
    """Create a card markdown file if it doesn't exist yet."""
    from pathlib import Path

    cards_dir = Path(cards_dir)
    slug = slugify(card_name)
    path = cards_dir / f"{slug}.md"

    if path.exists():
        return

    data = fetch_card(card_name)
    frontmatter = build_card_frontmatter(data)

    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True) + "---\n"
    path.write_text(content)
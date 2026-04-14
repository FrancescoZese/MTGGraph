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


def fetch_card(name: str, max_retries: int = 5) -> dict:
    """Fetch card data from Scryfall API by exact name."""
    url = "https://api.scryfall.com/cards/named"
    for attempt in range(max_retries):
        try:
            response = requests.get(url, params={"exact": name}, timeout=30)
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                wait = 5.0 * (attempt + 1)
                print(f"  Network error on {name}: {e}, retrying in {wait}s...")
                time.sleep(wait)
                continue
            raise
        if response.status_code == 429:
            wait = 5.0 * (attempt + 1)
            print(f"  Rate limited on {name}, waiting {wait}s... (attempt {attempt+1}/{max_retries})")
            time.sleep(wait)
            continue
        time.sleep(0.1)
        response.raise_for_status()
        return response.json()
    response.raise_for_status()
    return response.json()


def _effective_colors(data: dict) -> list[str]:
    """Return colors, treating cards with only Phyrexian mana as colorless."""
    colors = data.get("colors", [])
    mana_cost = data.get("mana_cost", "")
    if not colors or not mana_cost:
        return colors

    # Strip all Phyrexian mana symbols {X/P}
    cost_without_phyrexian = re.sub(r"\{[WUBRG]/P\}", "", mana_cost)
    # Check if any colored mana remains
    if not re.search(r"[WUBRG]", cost_without_phyrexian):
        return []
    return colors


def build_card_frontmatter(data: dict) -> dict:
    """Extract relevant fields from Scryfall API response."""
    image = ""
    if "image_uris" in data:
        image = data["image_uris"].get("normal", "")
    elif "card_faces" in data and data["card_faces"]:
        image = data["card_faces"][0].get("image_uris", {}).get("normal", "")

    return {
        "name": data["name"],
        "colors": _effective_colors(data),
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

    try:
        data = fetch_card(card_name)
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            print(f"  WARNING: card not found on Scryfall: {card_name}")
            frontmatter = {
                "name": card_name,
                "colors": [],
                "cmc": 0,
                "type": "Unknown",
                "set": "",
                "image": "",
                "scryfall_id": "",
            }
            content = "---\n" + yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True) + "---\n"
            path.write_text(content)
            return
        raise
    except requests.exceptions.RequestException as e:
        print(f"  WARNING: network error fetching {card_name}: {e}")
        return

    frontmatter = build_card_frontmatter(data)

    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True) + "---\n"
    path.write_text(content)
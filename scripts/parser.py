import yaml


def parse_decklist(text: str) -> dict:
    """Parse a decklist markdown string into structured data.

    Returns dict with keys: metadata, mainboard, sideboard, all_card_names.
    """
    metadata, body = _split_frontmatter(text)
    mainboard, sideboard = _parse_cards(body)
    all_card_names = sorted(set(list(mainboard.keys()) + list(sideboard.keys())))
    return {
        "metadata": metadata,
        "mainboard": mainboard,
        "sideboard": sideboard,
        "all_card_names": all_card_names,
    }


def _split_frontmatter(text: str) -> tuple[dict, str]:
    text = text.strip()
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    raw = yaml.safe_load(parts[1]) or {}
    metadata = {k: str(v) if not isinstance(v, str) else v for k, v in raw.items()}
    body = parts[2] if len(parts) > 2 else ""
    return metadata, body


def _parse_cards(body: str) -> tuple[dict, dict]:
    mainboard = {}
    sideboard = {}
    current = mainboard

    for line in body.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("# mainboard"):
            current = mainboard
            continue
        if line.lower().startswith("# sideboard"):
            current = sideboard
            continue
        if line.startswith("#"):
            continue
        card = _parse_card_line(line)
        if card:
            name, count = card
            current[name] = count

    return mainboard, sideboard


def _parse_card_line(line: str) -> tuple[str, int] | None:
    parts = line.split(" ", 1)
    if len(parts) != 2:
        return None
    try:
        count = int(parts[0])
    except ValueError:
        return None
    name = parts[1].strip()
    return name, count
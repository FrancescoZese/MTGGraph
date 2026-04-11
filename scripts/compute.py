import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.scryfall import slugify


def compute_graph(knowledge_dir: Path) -> dict:
    """Read the knowledge base and produce the full graph data structure."""
    knowledge_dir = Path(knowledge_dir)
    cards_dir = knowledge_dir / "cards"
    archetypes_dir = knowledge_dir / "archetypes"
    lists_dir = knowledge_dir / "lists"

    cards = _read_all_cards(cards_dir)
    archetypes = _read_all_archetypes(archetypes_dir)
    lists_by_archetype = _read_all_lists(lists_dir)

    total_lists = sum(len(ls) for ls in lists_by_archetype.values())

    # Compute edges: for each archetype, compute card frequency and avg copies
    edges = []
    card_archetype_weights = defaultdict(dict)

    for arch_slug, arch_lists in lists_by_archetype.items():
        if not arch_lists:
            continue
        card_appearances = defaultdict(int)
        card_total_copies = defaultdict(int)

        for parsed in arch_lists:
            all_cards = {}
            all_cards.update(parsed["mainboard"])
            all_cards.update(parsed["sideboard"])
            for card_name, copies in all_cards.items():
                card_appearances[card_name] += 1
                card_total_copies[card_name] += copies

        list_count = len(arch_lists)
        for card_name in card_appearances:
            card_slug = slugify(card_name)
            weight = card_appearances[card_name] / list_count
            avg_copies = card_total_copies[card_name] / card_appearances[card_name]

            edges.append({
                "source": f"card:{card_slug}",
                "target": f"archetype:{arch_slug}",
                "weight": round(weight, 4),
                "avg_copies": round(avg_copies, 2),
            })
            card_archetype_weights[card_slug][arch_slug] = weight

    # Compute meta_share for each archetype
    arch_meta_share = {}
    for arch_slug, arch_lists in lists_by_archetype.items():
        arch_meta_share[arch_slug] = len(arch_lists) / total_lists if total_lists > 0 else 0

    # Compute meta_presence for each card
    card_meta_presence = {}
    for card_slug, arch_weights in card_archetype_weights.items():
        presence = sum(
            w * arch_meta_share.get(a, 0)
            for a, w in arch_weights.items()
        )
        card_meta_presence[card_slug] = round(presence, 4)

    # Build nodes
    nodes = []
    for slug, card_data in cards.items():
        if slug not in card_archetype_weights:
            continue
        nodes.append({
            "id": f"card:{slug}",
            "type": "card",
            "name": card_data["name"],
            "colors": card_data.get("colors", []),
            "cmc": card_data.get("cmc", 0),
            "image": card_data.get("image", ""),
            "meta_presence": card_meta_presence.get(slug, 0),
        })

    for slug, arch_data in archetypes.items():
        list_count = len(lists_by_archetype.get(slug, []))
        nodes.append({
            "id": f"archetype:{slug}",
            "type": "archetype",
            "name": arch_data["name"],
            "colors": arch_data.get("colors", []),
            "description": arch_data.get("description", ""),
            "meta_share": round(arch_meta_share.get(slug, 0), 4),
            "list_count": list_count,
        })

    timeline = _build_timeline(lists_by_archetype)

    all_dates = []
    for arch_lists in lists_by_archetype.values():
        for parsed in arch_lists:
            d = parsed["metadata"].get("date")
            if d:
                all_dates.append(str(d))
    all_dates.sort()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "time_range": {
            "from": all_dates[0] if all_dates else "",
            "to": all_dates[-1] if all_dates else "",
        },
        "nodes": nodes,
        "edges": edges,
        "timeline": timeline,
    }


def _read_all_cards(cards_dir: Path) -> dict[str, dict]:
    cards = {}
    for path in cards_dir.glob("*.md"):
        text = path.read_text()
        parts = text.split("---", 2)
        if len(parts) >= 2:
            fm = yaml.safe_load(parts[1]) or {}
            cards[path.stem] = fm
    return cards


def _read_all_archetypes(archetypes_dir: Path) -> dict[str, dict]:
    archetypes = {}
    for path in archetypes_dir.glob("*.md"):
        text = path.read_text()
        parts = text.split("---", 2)
        if len(parts) >= 2:
            fm = yaml.safe_load(parts[1]) or {}
            body = parts[2].strip() if len(parts) > 2 else ""
            fm["description"] = body
            archetypes[path.stem] = fm
    return archetypes


def _read_all_lists(lists_dir: Path) -> dict[str, list[dict]]:
    lists_by_archetype = defaultdict(list)
    for path in sorted(lists_dir.glob("*.md")):
        text = path.read_text()
        parsed = parse_decklist(text)
        arch = parsed["metadata"].get("archetype")
        if arch:
            lists_by_archetype[arch].append(parsed)
    return dict(lists_by_archetype)


def _build_timeline(lists_by_archetype: dict) -> dict:
    timeline = {}
    # Count total lists per month across all archetypes (computed once, outside the loop)
    all_monthly_totals = defaultdict(int)
    for arch_lists in lists_by_archetype.values():
        for parsed in arch_lists:
            date_str = str(parsed["metadata"].get("date", ""))
            if len(date_str) >= 7:
                month = date_str[:7]
                all_monthly_totals[month] += 1

    for arch_slug, arch_lists in lists_by_archetype.items():
        monthly_counts = defaultdict(int)
        for parsed in arch_lists:
            date_str = str(parsed["metadata"].get("date", ""))
            if len(date_str) >= 7:
                month = date_str[:7]
                monthly_counts[month] += 1

        meta_share_series = []
        for month in sorted(all_monthly_totals.keys()):
            total = all_monthly_totals[month]
            count = monthly_counts.get(month, 0)
            share = count / total if total > 0 else 0
            meta_share_series.append({"date": month, "value": round(share, 4)})

        timeline[f"archetype:{arch_slug}"] = {"meta_share": meta_share_series}

    return timeline


def write_graph(knowledge_dir: Path, output_path: Path) -> None:
    """Compute the graph and write it to a JSON file."""
    graph = compute_graph(knowledge_dir)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

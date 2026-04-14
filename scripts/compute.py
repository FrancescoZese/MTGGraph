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
        # Track main and side separately
        main_appearances = defaultdict(int)
        main_total_copies = defaultdict(int)
        side_appearances = defaultdict(int)
        side_total_copies = defaultdict(int)

        for parsed in arch_lists:
            for card_name, copies in parsed["mainboard"].items():
                main_appearances[card_name] += 1
                main_total_copies[card_name] += copies
            for card_name, copies in parsed["sideboard"].items():
                side_appearances[card_name] += 1
                side_total_copies[card_name] += copies

        list_count = len(arch_lists)
        all_card_names = set(main_appearances.keys()) | set(side_appearances.keys())

        for card_name in all_card_names:
            card_slug = slugify(card_name)
            # Overall weight (appears in main OR side)
            total_appearances = max(main_appearances.get(card_name, 0), side_appearances.get(card_name, 0))
            weight = total_appearances / list_count

            edge = {
                "source": f"card:{card_slug}",
                "target": f"archetype:{arch_slug}",
                "weight": round(weight, 4),
            }

            # Main stats
            if card_name in main_appearances:
                edge["main_weight"] = round(main_appearances[card_name] / list_count, 4)
                edge["main_avg_copies"] = round(main_total_copies[card_name] / main_appearances[card_name], 2)
            else:
                edge["main_weight"] = 0
                edge["main_avg_copies"] = 0

            # Side stats
            if card_name in side_appearances:
                edge["side_weight"] = round(side_appearances[card_name] / list_count, 4)
                edge["side_avg_copies"] = round(side_total_copies[card_name] / side_appearances[card_name], 2)
            else:
                edge["side_weight"] = 0
                edge["side_avg_copies"] = 0

            # Total avg_copies (for backwards compat)
            total_copies = main_total_copies.get(card_name, 0) + side_total_copies.get(card_name, 0)
            total_app = main_appearances.get(card_name, 0) + side_appearances.get(card_name, 0)
            edge["avg_copies"] = round(total_copies / total_app, 2) if total_app > 0 else 0

            edges.append(edge)
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
        # Use only the front face name (MTGO lists don't include "// Back Face")
        card_name = card_data["name"].split(" // ")[0]
        nodes.append({
            "id": f"card:{slug}",
            "type": "card",
            "name": card_name,
            "card_type": card_data.get("type", "").split(" // ")[0],
            "colors": card_data.get("colors", []),
            "cmc": card_data.get("cmc", 0),
            "image": card_data.get("image", ""),
            "meta_presence": card_meta_presence.get(slug, 0),
        })

    for slug, arch_data in archetypes.items():
        arch_lists = lists_by_archetype.get(slug, [])
        list_count = len(arch_lists)

        # Build list metadata with decklists
        lists_meta = []
        for parsed in arch_lists:
            meta = parsed["metadata"]
            lists_meta.append({
                "pilot": str(meta.get("pilot", "Unknown")),
                "date": str(meta.get("date", "")),
                "source": str(meta.get("source", "")),
                "finish": str(meta.get("finish", "")),
                "mainboard": {name: qty for name, qty in parsed["mainboard"].items()},
                "sideboard": {name: qty for name, qty in parsed["sideboard"].items()},
            })
        # Sort by date desc, then finish
        lists_meta.sort(key=lambda l: (l["date"], l["finish"]), reverse=True)

        nodes.append({
            "id": f"archetype:{slug}",
            "type": "archetype",
            "name": arch_data["name"],
            "colors": arch_data.get("colors", []),
            "description": arch_data.get("description", ""),
            "meta_share": round(arch_meta_share.get(slug, 0), 4),
            "list_count": list_count,
            "lists": lists_meta,
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


def enrich_markdown(knowledge_dir: Path, graph: dict) -> None:
    """Write computed data back into card and archetype markdown files.

    Preserves existing body text (descriptions) while updating frontmatter
    with computed fields like meta_presence, archetypes, meta_share, top_cards.
    """
    knowledge_dir = Path(knowledge_dir)
    cards_dir = knowledge_dir / "cards"
    archetypes_dir = knowledge_dir / "archetypes"

    # Index graph data for quick lookup
    card_nodes = {n["id"]: n for n in graph["nodes"] if n["type"] == "card"}
    arch_nodes = {n["id"]: n for n in graph["nodes"] if n["type"] == "archetype"}

    # Build card -> archetype edges lookup
    card_edges = defaultdict(list)  # card_id -> [{archetype, weight, avg_copies}]
    arch_edges = defaultdict(list)  # arch_id -> [{card_name, card_slug, weight, avg_copies}]
    for edge in graph["edges"]:
        card_edges[edge["source"]].append(edge)
        card_node = card_nodes.get(edge["source"])
        card_name = card_node["name"] if card_node else edge["source"]
        card_slug = edge["source"].replace("card:", "")
        arch_edges[edge["target"]].append({
            "name": card_name,
            "slug": card_slug,
            "weight": edge["weight"],
            "avg_copies": edge["avg_copies"],
        })

    # Enrich card files
    for card_id, node in card_nodes.items():
        slug = card_id.replace("card:", "")
        path = cards_dir / f"{slug}.md"
        if not path.exists():
            continue

        text = path.read_text()
        parts = text.split("---", 2)
        if len(parts) < 2:
            continue

        fm = yaml.safe_load(parts[1]) or {}
        body = parts[2].strip() if len(parts) > 2 else ""

        # Add computed fields
        fm["meta_presence"] = node["meta_presence"]
        archetypes_data = {}
        for edge in card_edges.get(card_id, []):
            arch_slug = edge["target"].replace("archetype:", "")
            archetypes_data[arch_slug] = {
                "weight": edge["weight"],
                "avg_copies": edge["avg_copies"],
            }
        fm["archetypes"] = archetypes_data

        content = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False) + "---\n"
        if body:
            content += body + "\n"
        path.write_text(content)

    # Enrich archetype files
    for arch_id, node in arch_nodes.items():
        slug = arch_id.replace("archetype:", "")
        path = archetypes_dir / f"{slug}.md"
        if not path.exists():
            continue

        text = path.read_text()
        parts = text.split("---", 2)
        if len(parts) < 2:
            continue

        fm = yaml.safe_load(parts[1]) or {}
        body = parts[2].strip() if len(parts) > 2 else ""

        # Add computed fields
        fm["meta_share"] = node["meta_share"]
        fm["list_count"] = node["list_count"]

        # Recompute colors from mainboard cards only (ignore sideboard splashes)
        color_order = ["W", "U", "B", "R", "G"]
        arch_colors = set()
        for edge in graph["edges"]:
            if edge["target"] != arch_id:
                continue
            if edge.get("main_weight", 0) < 0.25:
                continue
            card_node = card_nodes.get(edge["source"])
            if card_node:
                for c in card_node.get("colors", []):
                    arch_colors.add(c)
        fm["colors"] = [c for c in color_order if c in arch_colors]
        node["colors"] = fm["colors"]

        # Top cards sorted by weight then avg_copies
        edges_for_arch = arch_edges.get(arch_id, [])
        edges_for_arch.sort(key=lambda e: (-e["weight"], -e["avg_copies"]))
        fm["top_cards"] = [
            {"name": e["name"], "weight": e["weight"], "avg_copies": e["avg_copies"]}
            for e in edges_for_arch
        ]

        content = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False) + "---\n"
        if body:
            content += body + "\n"
        path.write_text(content)


def write_meta_index(knowledge_dir: Path, graph: dict) -> None:
    """Generate META.md — a human/LLM-readable summary of the metagame."""
    knowledge_dir = Path(knowledge_dir)

    arch_nodes = sorted(
        [n for n in graph["nodes"] if n["type"] == "archetype"],
        key=lambda n: -n["meta_share"],
    )
    card_nodes = sorted(
        [n for n in graph["nodes"] if n["type"] == "card"],
        key=lambda n: -n["meta_presence"],
    )

    # Build card -> archetype names lookup
    card_archetypes = defaultdict(list)
    arch_names = {n["id"]: n["name"] for n in arch_nodes}
    for edge in graph["edges"]:
        arch_name = arch_names.get(edge["target"], edge["target"])
        card_archetypes[edge["source"]].append((arch_name, edge["weight"]))

    lines = []
    lines.append(f"# Modern Metagame")
    lines.append(f"")
    lines.append(f"Generated: {graph['generated_at'][:10]}")
    lines.append(f"Data range: {graph['time_range']['from']} to {graph['time_range']['to']}")
    lines.append(f"Total lists: {sum(n['list_count'] for n in arch_nodes)}")
    lines.append(f"")
    lines.append(f"## Archetypes (by meta share)")
    lines.append(f"")

    for i, arch in enumerate(arch_nodes, 1):
        share_pct = f"{arch['meta_share'] * 100:.1f}%"
        colors = "".join(arch.get("colors", []))
        desc = arch.get("description", "")
        lines.append(f"{i}. **{arch['name']}** ({share_pct}, {arch['list_count']} lists) [{colors}]")
        if desc:
            lines.append(f"   {desc}")
        lines.append(f"   See: `archetypes/{arch['id'].replace('archetype:', '')}.md`")
        lines.append(f"")

    lines.append(f"## Most Played Cards (by meta presence)")
    lines.append(f"")

    # Show top 30 cards
    for i, card in enumerate(card_nodes[:30], 1):
        presence_pct = f"{card['meta_presence'] * 100:.1f}%"
        colors = "".join(card.get("colors", []))
        card_id = card["id"]
        archs = card_archetypes.get(card_id, [])
        arch_str = ", ".join(f"{name}" for name, w in sorted(archs, key=lambda x: -x[1]))
        slug = card_id.replace("card:", "")
        lines.append(f"{i}. **{card['name']}** ({presence_pct}) [{colors}] — in: {arch_str}")
        lines.append(f"   See: `cards/{slug}.md`")
        lines.append(f"")

    meta_path = knowledge_dir / "META.md"
    meta_path.write_text("\n".join(lines) + "\n")


def write_graph(knowledge_dir: Path, output_path: Path) -> None:
    """Compute the graph, write graph.json, enrich markdown files, and generate META.md."""
    graph = compute_graph(knowledge_dir)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Enrich first — this recomputes archetype colors from mainboard cards
    enrich_markdown(knowledge_dir, graph)

    with open(output_path, "w") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

    write_meta_index(knowledge_dir, graph)

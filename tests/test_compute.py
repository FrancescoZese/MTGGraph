import json
import pytest
import yaml
from pathlib import Path
from scripts.compute import compute_graph


def _write_md(path, frontmatter, body=""):
    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False) + "---\n" + body
    path.write_text(content)


def _setup_knowledge(tmp_path):
    """Create a minimal knowledge base with one archetype, two cards, two lists."""
    k = tmp_path / "knowledge"
    (k / "cards").mkdir(parents=True)
    (k / "archetypes").mkdir(parents=True)
    (k / "lists").mkdir(parents=True)

    _write_md(k / "cards" / "ragavan-nimble-pilferer.md", {
        "name": "Ragavan, Nimble Pilferer",
        "colors": ["R"], "cmc": 1,
        "type": "Legendary Creature", "set": "mh2",
        "image": "https://example.com/ragavan.jpg",
        "scryfall_id": "abc",
    })
    _write_md(k / "cards" / "lightning-bolt.md", {
        "name": "Lightning Bolt",
        "colors": ["R"], "cmc": 1,
        "type": "Instant", "set": "2xm",
        "image": "https://example.com/bolt.jpg",
        "scryfall_id": "def",
    })
    _write_md(k / "archetypes" / "burn.md", {
        "name": "Burn", "colors": ["R"],
    }, "A red aggro deck.")

    list1 = """---
date: 2026-03-01
source: Test
pilot: P1
finish: 1st
archetype: burn
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Lightning Bolt
"""
    list2 = """---
date: 2026-04-01
source: Test
pilot: P2
finish: 2nd
archetype: burn
---

# Mainboard
4 Ragavan, Nimble Pilferer
2 Lightning Bolt
"""
    (k / "lists" / "2026-03-01-test.md").write_text(list1)
    (k / "lists" / "2026-04-01-test.md").write_text(list2)
    return k


def test_compute_graph_nodes(tmp_path):
    k = _setup_knowledge(tmp_path)
    graph = compute_graph(k)

    node_ids = [n["id"] for n in graph["nodes"]]
    assert "card:ragavan-nimble-pilferer" in node_ids
    assert "card:lightning-bolt" in node_ids
    assert "archetype:burn" in node_ids


def test_compute_graph_archetype_node(tmp_path):
    k = _setup_knowledge(tmp_path)
    graph = compute_graph(k)

    burn = next(n for n in graph["nodes"] if n["id"] == "archetype:burn")
    assert burn["type"] == "archetype"
    assert burn["name"] == "Burn"
    assert burn["list_count"] == 2
    assert burn["meta_share"] == pytest.approx(1.0)  # only archetype


def test_compute_graph_edges(tmp_path):
    k = _setup_knowledge(tmp_path)
    graph = compute_graph(k)

    ragavan_edge = next(
        e for e in graph["edges"]
        if e["source"] == "card:ragavan-nimble-pilferer" and e["target"] == "archetype:burn"
    )
    # Ragavan is 4-of in both lists -> weight 1.0
    assert ragavan_edge["weight"] == pytest.approx(1.0)
    assert ragavan_edge["avg_copies"] == pytest.approx(4.0)

    bolt_edge = next(
        e for e in graph["edges"]
        if e["source"] == "card:lightning-bolt" and e["target"] == "archetype:burn"
    )
    # Bolt is 4-of in list1, 2-of in list2 -> appears in 2/2 lists -> weight 1.0
    # avg copies: (4+2)/2 = 3.0
    assert bolt_edge["weight"] == pytest.approx(1.0)
    assert bolt_edge["avg_copies"] == pytest.approx(3.0)


def test_compute_graph_meta_presence(tmp_path):
    k = _setup_knowledge(tmp_path)
    graph = compute_graph(k)

    ragavan = next(n for n in graph["nodes"] if n["id"] == "card:ragavan-nimble-pilferer")
    # Ragavan appears in burn (meta_share 1.0) with weight 1.0 -> meta_presence = 1.0
    assert ragavan["meta_presence"] == pytest.approx(1.0)


def test_compute_graph_timeline(tmp_path):
    k = _setup_knowledge(tmp_path)
    graph = compute_graph(k)

    tl = graph["timeline"]["archetype:burn"]["meta_share"]
    dates = [entry["date"] for entry in tl]
    assert "2026-03" in dates
    assert "2026-04" in dates


def test_compute_graph_has_metadata(tmp_path):
    k = _setup_knowledge(tmp_path)
    graph = compute_graph(k)
    assert "generated_at" in graph
    assert "time_range" in graph

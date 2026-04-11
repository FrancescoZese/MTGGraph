import json
import pytest
import yaml
from pathlib import Path
from unittest.mock import patch, MagicMock

from scripts.ingest import ingest_list
from scripts.compute import compute_graph, write_graph


LIST_1 = """---
date: 2026-04-05
source: MTGO Modern Challenge
pilot: Player1
finish: 1st
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
4 Guide of Souls
2 Ajani, Nacatl Pariah

# Sideboard
2 Rest in Peace
"""

LIST_2 = """---
date: 2026-04-06
source: MTGO Modern League
pilot: Player2
finish: 5-0
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
4 Guide of Souls
4 Ocelot Pride

# Sideboard
1 Rest in Peace
"""

LIST_3 = """---
date: 2026-04-06
source: MTGO Modern League
pilot: Player3
finish: 5-0
---

# Mainboard
4 Wurmcoil Engine
4 Karn, the Great Creator
4 Ancient Stirrings
4 Expedition Map

# Sideboard
2 Relic of Progenitus
"""


def _mock_scryfall(name):
    """Return fake Scryfall data for known test cards."""
    cards = {
        "Ragavan, Nimble Pilferer": {"colors": ["R"], "cmc": 1.0, "type_line": "Legendary Creature", "set": "mh2"},
        "Phlage, Titan of Fire's Fury": {"colors": ["R", "W"], "cmc": 5.0, "type_line": "Creature", "set": "mh3"},
        "Guide of Souls": {"colors": ["W"], "cmc": 1.0, "type_line": "Creature", "set": "mh3"},
        "Ajani, Nacatl Pariah": {"colors": ["W"], "cmc": 2.0, "type_line": "Legendary Creature", "set": "mh3"},
        "Rest in Peace": {"colors": ["W"], "cmc": 2.0, "type_line": "Enchantment", "set": "a25"},
        "Ocelot Pride": {"colors": ["W"], "cmc": 1.0, "type_line": "Creature", "set": "mh3"},
        "Wurmcoil Engine": {"colors": [], "cmc": 6.0, "type_line": "Artifact Creature", "set": "2xm"},
        "Karn, the Great Creator": {"colors": [], "cmc": 4.0, "type_line": "Legendary Planeswalker", "set": "war"},
        "Ancient Stirrings": {"colors": ["G"], "cmc": 1.0, "type_line": "Sorcery", "set": "a25"},
        "Expedition Map": {"colors": [], "cmc": 1.0, "type_line": "Artifact", "set": "2xm"},
        "Relic of Progenitus": {"colors": [], "cmc": 1.0, "type_line": "Artifact", "set": "ala"},
    }
    base = cards.get(name, {"colors": [], "cmc": 0, "type_line": "Unknown", "set": "xxx"})
    return {
        "name": name,
        "colors": base["colors"],
        "cmc": base["cmc"],
        "type_line": base["type_line"],
        "set": base["set"],
        "image_uris": {"normal": f"https://example.com/{name.lower().replace(' ', '-')}.jpg"},
        "id": f"test-{name.lower().replace(' ', '-')}",
    }


def _setup(tmp_path):
    k = tmp_path / "knowledge"
    (k / "cards").mkdir(parents=True)
    (k / "archetypes").mkdir(parents=True)
    (k / "lists").mkdir(parents=True)
    return k


@patch("scripts.scryfall.requests.get")
@patch("scripts.ingest.create_archetype")
def test_full_pipeline(mock_llm, mock_get, tmp_path):
    knowledge_dir = _setup(tmp_path)

    # Mock Scryfall
    def fake_get(url, params=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.raise_for_status = MagicMock()  # no-op since status is 200
        resp.json.return_value = _mock_scryfall(params.get("exact", ""))
        return resp
    mock_get.side_effect = fake_get

    # Mock LLM for archetype creation
    mock_llm.side_effect = [
        {"name": "Boros Energy", "slug": "boros-energy", "description": "Aggressive energy deck."},
        {"name": "Tron", "slug": "tron", "description": "Big mana deck."},
    ]

    # Ingest first list -> creates Boros Energy archetype
    r1 = ingest_list(LIST_1, knowledge_dir, threshold=0.6)
    assert r1["is_new_archetype"] is True
    assert r1["archetype"] == "boros-energy"

    # Ingest second list -> should match Boros Energy
    r2 = ingest_list(LIST_2, knowledge_dir, threshold=0.5)
    assert r2["is_new_archetype"] is False
    assert r2["archetype"] == "boros-energy"

    # Ingest third list -> should create Tron (completely different cards)
    r3 = ingest_list(LIST_3, knowledge_dir, threshold=0.6)
    assert r3["is_new_archetype"] is True
    assert r3["archetype"] == "tron"

    # Compute graph
    graph = compute_graph(knowledge_dir)

    # Verify structure
    assert len(graph["nodes"]) > 0
    assert len(graph["edges"]) > 0

    # Verify archetype nodes
    arch_nodes = [n for n in graph["nodes"] if n["type"] == "archetype"]
    arch_names = [n["name"] for n in arch_nodes]
    assert "Boros Energy" in arch_names
    assert "Tron" in arch_names

    # Boros Energy should have 2 lists, Tron 1
    boros = next(n for n in arch_nodes if n["name"] == "Boros Energy")
    tron = next(n for n in arch_nodes if n["name"] == "Tron")
    assert boros["list_count"] == 2
    assert tron["list_count"] == 1

    # Meta share: Boros 2/3, Tron 1/3
    assert boros["meta_share"] == pytest.approx(2 / 3, abs=0.01)
    assert tron["meta_share"] == pytest.approx(1 / 3, abs=0.01)

    # Ragavan should be connected to Boros Energy only
    ragavan_edges = [e for e in graph["edges"] if e["source"] == "card:ragavan-nimble-pilferer"]
    assert len(ragavan_edges) == 1
    assert ragavan_edges[0]["target"] == "archetype:boros-energy"

    # Write graph to file and verify it's valid JSON
    output = tmp_path / "graph.json"
    write_graph(knowledge_dir, output)
    loaded = json.loads(output.read_text())
    assert loaded["nodes"] == graph["nodes"]

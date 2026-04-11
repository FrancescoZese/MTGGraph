import pytest
import yaml
from pathlib import Path
from unittest.mock import patch
from scripts.ingest import ingest_list


SAMPLE_LIST = """---
date: 2026-04-05
source: MTGO Modern Challenge
pilot: PlayerName123
finish: 3rd
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
2 Ajani, Nacatl Pariah

# Sideboard
2 Rest in Peace
"""


def _setup_knowledge(tmp_path):
    """Create knowledge directory structure."""
    cards = tmp_path / "knowledge" / "cards"
    archetypes = tmp_path / "knowledge" / "archetypes"
    lists = tmp_path / "knowledge" / "lists"
    cards.mkdir(parents=True)
    archetypes.mkdir(parents=True)
    lists.mkdir(parents=True)
    return tmp_path / "knowledge"


@patch("scripts.ingest.ensure_card_file")
@patch("scripts.ingest.create_archetype")
def test_ingest_new_archetype(mock_create, mock_ensure, tmp_path):
    """When no existing archetype matches, LLM creates a new one."""
    knowledge_dir = _setup_knowledge(tmp_path)
    mock_create.return_value = {
        "name": "Boros Energy",
        "slug": "boros-energy",
        "description": "An aggressive midrange deck.",
    }

    result = ingest_list(SAMPLE_LIST, knowledge_dir, threshold=0.6)

    assert result["archetype"] == "boros-energy"
    assert result["is_new_archetype"] is True
    # Archetype file should be created
    assert (knowledge_dir / "archetypes" / "boros-energy.md").exists()
    # List file should be saved
    list_files = list((knowledge_dir / "lists").glob("*.md"))
    assert len(list_files) == 1
    # List should have archetype in frontmatter
    text = list_files[0].read_text()
    parts = text.split("---", 2)
    meta = yaml.safe_load(parts[1])
    assert meta["archetype"] == "boros-energy"


@patch("scripts.ingest.ensure_card_file")
def test_ingest_existing_archetype(mock_ensure, tmp_path):
    """When an existing archetype matches above threshold, list joins it."""
    knowledge_dir = _setup_knowledge(tmp_path)

    # Create a pre-existing archetype with one list
    from scripts.archetype_manager import write_archetype
    write_archetype(
        knowledge_dir / "archetypes", "boros-energy", "Boros Energy", ["R", "W"], "A deck."
    )
    existing_list = """---
date: 2026-04-01
source: Test
pilot: P1
finish: 1st
archetype: boros-energy
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
4 Ajani, Nacatl Pariah

# Sideboard
2 Rest in Peace
"""
    (knowledge_dir / "lists" / "2026-04-01-test.md").write_text(existing_list)

    result = ingest_list(SAMPLE_LIST, knowledge_dir, threshold=0.5)

    assert result["archetype"] == "boros-energy"
    assert result["is_new_archetype"] is False

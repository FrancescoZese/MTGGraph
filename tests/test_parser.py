import pytest
from scripts.parser import parse_decklist


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
2 Wear // Tear
1 Rest in Peace
"""


def test_parse_frontmatter():
    result = parse_decklist(SAMPLE_LIST)
    assert result["metadata"]["date"] == "2026-04-05"
    assert result["metadata"]["source"] == "MTGO Modern Challenge"
    assert result["metadata"]["pilot"] == "PlayerName123"
    assert result["metadata"]["finish"] == "3rd"


def test_parse_mainboard():
    result = parse_decklist(SAMPLE_LIST)
    assert result["mainboard"] == {
        "Ragavan, Nimble Pilferer": 4,
        "Phlage, Titan of Fire's Fury": 4,
        "Ajani, Nacatl Pariah": 2,
    }


def test_parse_sideboard():
    result = parse_decklist(SAMPLE_LIST)
    assert result["sideboard"] == {
        "Wear // Tear": 2,
        "Rest in Peace": 1,
    }


def test_parse_no_sideboard():
    text = """---
date: 2026-04-05
source: Test
pilot: Test
finish: 1st
---

# Mainboard
4 Lightning Bolt
"""
    result = parse_decklist(text)
    assert result["mainboard"] == {"Lightning Bolt": 4}
    assert result["sideboard"] == {}


def test_all_card_names():
    result = parse_decklist(SAMPLE_LIST)
    names = result["all_card_names"]
    assert "Ragavan, Nimble Pilferer" in names
    assert "Wear // Tear" in names
    assert len(names) == 5
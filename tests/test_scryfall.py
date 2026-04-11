import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
from scripts.scryfall import slugify, build_card_frontmatter, fetch_card, ensure_card_file


def test_slugify():
    assert slugify("Ragavan, Nimble Pilferer") == "ragavan-nimble-pilferer"
    assert slugify("Wear // Tear") == "wear-tear"
    assert slugify("Jace, the Mind Sculptor") == "jace-the-mind-sculptor"


def test_build_card_frontmatter():
    scryfall_data = {
        "name": "Ragavan, Nimble Pilferer",
        "colors": ["R"],
        "cmc": 1.0,
        "type_line": "Legendary Creature — Monkey Pirate",
        "set": "mh2",
        "image_uris": {"normal": "https://cards.scryfall.io/normal/front/abc.jpg"},
        "id": "1d9a6a0d-1234",
    }
    fm = build_card_frontmatter(scryfall_data)
    assert fm["name"] == "Ragavan, Nimble Pilferer"
    assert fm["colors"] == ["R"]
    assert fm["cmc"] == 1
    assert fm["type"] == "Legendary Creature — Monkey Pirate"
    assert fm["set"] == "mh2"
    assert fm["image"] == "https://cards.scryfall.io/normal/front/abc.jpg"
    assert fm["scryfall_id"] == "1d9a6a0d-1234"


@patch("scripts.scryfall.requests.get")
def test_fetch_card(mock_get):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "name": "Lightning Bolt",
        "colors": ["R"],
        "cmc": 1.0,
        "type_line": "Instant",
        "set": "2xm",
        "image_uris": {"normal": "https://example.com/bolt.jpg"},
        "id": "abc-123",
    }
    mock_get.return_value = mock_response

    data = fetch_card("Lightning Bolt")
    assert data["name"] == "Lightning Bolt"
    mock_get.assert_called_once()


def test_ensure_card_file_skips_existing(tmp_path):
    cards_dir = tmp_path / "cards"
    cards_dir.mkdir()
    existing = cards_dir / "lightning-bolt.md"
    existing.write_text("---\nname: Lightning Bolt\n---\n")

    with patch("scripts.scryfall.fetch_card") as mock_fetch:
        ensure_card_file("Lightning Bolt", cards_dir)
        mock_fetch.assert_not_called()


@patch("scripts.scryfall.fetch_card")
def test_ensure_card_file_creates_new(mock_fetch, tmp_path):
    mock_fetch.return_value = {
        "name": "Lightning Bolt",
        "colors": ["R"],
        "cmc": 1.0,
        "type_line": "Instant",
        "set": "2xm",
        "image_uris": {"normal": "https://example.com/bolt.jpg"},
        "id": "abc-123",
    }
    cards_dir = tmp_path / "cards"
    cards_dir.mkdir()

    ensure_card_file("Lightning Bolt", cards_dir)

    path = cards_dir / "lightning-bolt.md"
    assert path.exists()
    content = path.read_text()
    assert "name: Lightning Bolt" in content
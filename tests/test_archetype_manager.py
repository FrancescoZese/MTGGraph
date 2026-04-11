import pytest
import yaml
from pathlib import Path
from scripts.archetype_manager import (
    read_archetype,
    write_archetype,
    list_archetypes,
    compute_archetype_profile,
)
from scripts.parser import parse_decklist


def _write_md(path: Path, frontmatter: dict, body: str = ""):
    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False) + "---\n" + body
    path.write_text(content)


def test_read_archetype(tmp_path):
    path = tmp_path / "boros-energy.md"
    _write_md(path, {"name": "Boros Energy", "colors": ["R", "W"]}, "A good deck.\n")
    arch = read_archetype(path)
    assert arch["name"] == "Boros Energy"
    assert arch["colors"] == ["R", "W"]
    assert arch["slug"] == "boros-energy"
    assert arch["description"] == "A good deck."


def test_write_archetype(tmp_path):
    write_archetype(
        directory=tmp_path,
        slug="boros-energy",
        name="Boros Energy",
        colors=["R", "W"],
        description="A good deck.",
    )
    path = tmp_path / "boros-energy.md"
    assert path.exists()
    arch = read_archetype(path)
    assert arch["name"] == "Boros Energy"
    assert arch["description"] == "A good deck."


def test_list_archetypes(tmp_path):
    _write_md(tmp_path / "boros-energy.md", {"name": "Boros Energy", "colors": ["R", "W"]})
    _write_md(tmp_path / "tron.md", {"name": "Tron", "colors": ["C"]})
    archs = list_archetypes(tmp_path)
    slugs = [a["slug"] for a in archs]
    assert "boros-energy" in slugs
    assert "tron" in slugs


def test_compute_archetype_profile(tmp_path):
    lists_dir = tmp_path / "lists"
    lists_dir.mkdir()

    list1 = """---
date: 2026-04-01
source: Test
pilot: P1
finish: 1st
archetype: boros-energy
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
2 Ajani, Nacatl Pariah

# Sideboard
2 Rest in Peace
"""
    list2 = """---
date: 2026-04-02
source: Test
pilot: P2
finish: 2nd
archetype: boros-energy
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
4 Ajani, Nacatl Pariah

# Sideboard
1 Rest in Peace
"""
    (lists_dir / "2026-04-01-test-1.md").write_text(list1)
    (lists_dir / "2026-04-02-test-2.md").write_text(list2)

    profile = compute_archetype_profile("boros-energy", lists_dir)

    # Ragavan: both lists have 4-of -> weight 1.0 in both -> average 1.0
    assert profile["Ragavan, Nimble Pilferer"] == pytest.approx(1.0)
    # Phlage: both lists have 4-of -> 1.0
    assert profile["Phlage, Titan of Fire's Fury"] == pytest.approx(1.0)
    # Ajani: list1 has 2-of (0.5), list2 has 4-of (1.0) -> average 0.75
    assert profile["Ajani, Nacatl Pariah"] == pytest.approx(0.75)
    # Rest in Peace: list1 SB 2-of (0.25), list2 SB 1-of (0.125) -> avg 0.1875
    assert profile["Rest in Peace"] == pytest.approx(0.1875)

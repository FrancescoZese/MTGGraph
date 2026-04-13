# MTG Metagame Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive knowledge graph of the Modern MTG metagame where cards and archetypes are nodes connected by weighted edges, backed by a markdown knowledge base and computed from tournament lists.

**Architecture:** Markdown files in `knowledge/` are the source of truth (cards from Scryfall, archetypes from LLM, lists from manual input). A Python compute pipeline reads them, calculates weighted similarities and meta shares, and produces `computed/graph.json`. A static D3.js web app reads that JSON and renders an interactive force-directed graph.

**Tech Stack:** Python 3.12, PyYAML, requests (Scryfall API), anthropic SDK (archetype naming), pytest. D3.js v7 for visualization. No frameworks, no build tools.

**Spec:** `docs/superpowers/specs/2026-04-11-mtg-metagame-graph-design.md`

---

## File Structure

```
MTGGraph/
├── knowledge/
│   ├── cards/                  # one .md per card (Scryfall data + LLM description)
│   ├── archetypes/             # one .md per archetype (LLM-generated)
│   └── lists/                  # one .md per ingested tournament list (immutable)
├── computed/
│   └── graph.json              # output of compute.py, input of web app
├── scripts/
│   ├── parser.py               # parse decklist markdown format
│   ├── scryfall.py             # Scryfall API client, creates card .md files
│   ├── similarity.py           # weighted Jaccard similarity
│   ├── archetype_manager.py    # read/create/assign archetypes
│   ├── llm.py                  # LLM calls for archetype naming
│   ├── ingest.py               # main ingestion pipeline orchestrator
│   └── compute.py              # reads knowledge/, produces graph.json
├── tests/
│   ├── test_parser.py
│   ├── test_scryfall.py
│   ├── test_similarity.py
│   ├── test_archetype_manager.py
│   ├── test_compute.py
│   └── test_ingest.py
├── web/
│   ├── index.html
│   ├── graph.js
│   └── style.css
├── pyproject.toml
└── docs/
```

---

### Task 1: Project Setup

**Files:**
- Create: `pyproject.toml`
- Create: `scripts/__init__.py`
- Create: `tests/__init__.py`
- Create: directories `knowledge/cards/`, `knowledge/archetypes/`, `knowledge/lists/`, `computed/`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/francescozese/Desktop/DataPizza/Hackapizza/MTGGraph
git init
```

- [ ] **Step 2: Create pyproject.toml**

```toml
[project]
name = "mtggraph"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "pyyaml>=6.0",
    "requests>=2.31",
    "anthropic>=0.49",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 3: Create directory structure and init files**

```bash
mkdir -p knowledge/cards knowledge/archetypes knowledge/lists computed scripts tests web
touch scripts/__init__.py tests/__init__.py
```

- [ ] **Step 4: Install dependencies**

```bash
pip install -e ".[dev]"
```

- [ ] **Step 5: Create .gitignore**

```gitignore
.venv/
__pycache__/
*.pyc
.idea/
computed/graph.json
```

Note: `computed/graph.json` is gitignored because it's a derived artifact, always ricalcolabile. The knowledge base is the source of truth.

- [ ] **Step 6: Verify pytest runs**

Run: `pytest -v`
Expected: "no tests ran" with exit code 5 (no tests collected, not an error)

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml scripts/__init__.py tests/__init__.py .gitignore knowledge/ computed/ web/
git commit -m "chore: project setup with directory structure and dependencies"
```

---

### Task 2: List Parser

**Files:**
- Create: `scripts/parser.py`
- Create: `tests/test_parser.py`

The parser reads the `N Card Name` format from decklist markdown, splitting mainboard and sideboard. It also reads YAML frontmatter.

- [ ] **Step 1: Write failing tests for frontmatter and card parsing**

```python
# tests/test_parser.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.parser'`

- [ ] **Step 3: Implement parser**

```python
# scripts/parser.py
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
    # parts[0] is empty string before first ---
    # parts[1] is the YAML content
    # parts[2] is the body after closing ---
    metadata = yaml.safe_load(parts[1]) or {}
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_parser.py -v`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/parser.py tests/test_parser.py
git commit -m "feat: decklist parser with frontmatter and mainboard/sideboard support"
```

---

### Task 3: Scryfall Client

**Files:**
- Create: `scripts/scryfall.py`
- Create: `tests/test_scryfall.py`

Fetches card data from Scryfall API and creates card markdown files in `knowledge/cards/`. Calls the API once per card, caches locally as markdown.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_scryfall.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_scryfall.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement Scryfall client**

```python
# scripts/scryfall.py
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


def fetch_card(name: str) -> dict:
    """Fetch card data from Scryfall API by exact name."""
    url = "https://api.scryfall.com/cards/named"
    response = requests.get(url, params={"exact": name})
    # Scryfall asks for 50-100ms between requests
    time.sleep(0.1)
    response.raise_for_status()
    return response.json()


def build_card_frontmatter(data: dict) -> dict:
    """Extract relevant fields from Scryfall API response."""
    image = ""
    if "image_uris" in data:
        image = data["image_uris"].get("normal", "")
    elif "card_faces" in data and data["card_faces"]:
        image = data["card_faces"][0].get("image_uris", {}).get("normal", "")

    return {
        "name": data["name"],
        "colors": data.get("colors", []),
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

    data = fetch_card(card_name)
    frontmatter = build_card_frontmatter(data)

    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True) + "---\n"
    path.write_text(content)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_scryfall.py -v`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/scryfall.py tests/test_scryfall.py
git commit -m "feat: Scryfall API client with local card file caching"
```

---

### Task 4: Similarity Engine

**Files:**
- Create: `scripts/similarity.py`
- Create: `tests/test_similarity.py`

Implements weighted Jaccard similarity between a decklist and archetype card profiles.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_similarity.py
import pytest
from scripts.similarity import card_weights, weighted_jaccard, find_best_match


def test_card_weights_mainboard():
    mainboard = {"Ragavan, Nimble Pilferer": 4, "Ajani, Nacatl Pariah": 2}
    sideboard = {}
    weights = card_weights(mainboard, sideboard)
    assert weights["Ragavan, Nimble Pilferer"] == 1.0
    assert weights["Ajani, Nacatl Pariah"] == 0.5


def test_card_weights_with_sideboard():
    mainboard = {"Lightning Bolt": 4}
    sideboard = {"Rest in Peace": 2}
    weights = card_weights(mainboard, sideboard)
    assert weights["Lightning Bolt"] == 1.0
    # sideboard 2-of: 0.5 * 0.5 sideboard multiplier = 0.25
    assert weights["Rest in Peace"] == 0.25


def test_card_weights_all_counts():
    mainboard = {"A": 4, "B": 3, "C": 2, "D": 1}
    sideboard = {}
    weights = card_weights(mainboard, sideboard)
    assert weights == {"A": 1.0, "B": 0.75, "C": 0.5, "D": 0.25}


def test_weighted_jaccard_identical():
    a = {"Ragavan": 1.0, "Bolt": 0.75}
    b = {"Ragavan": 1.0, "Bolt": 0.75}
    assert weighted_jaccard(a, b) == pytest.approx(1.0)


def test_weighted_jaccard_disjoint():
    a = {"Ragavan": 1.0}
    b = {"Tarmogoyf": 1.0}
    assert weighted_jaccard(a, b) == pytest.approx(0.0)


def test_weighted_jaccard_partial():
    a = {"Ragavan": 1.0, "Bolt": 0.75, "Phlage": 1.0}
    b = {"Ragavan": 1.0, "Bolt": 0.75, "Tarmogoyf": 1.0}
    # intersection: min(1,1) + min(0.75,0.75) = 1.75
    # union: max(1,1) + max(0.75,0.75) + max(1,0) + max(0,1) = 1 + 0.75 + 1 + 1 = 3.75
    # jaccard = 1.75 / 3.75
    assert weighted_jaccard(a, b) == pytest.approx(1.75 / 3.75)


def test_find_best_match_above_threshold():
    list_weights = {"Ragavan": 1.0, "Phlage": 1.0, "Bolt": 0.75}
    profiles = {
        "boros-energy": {"Ragavan": 0.95, "Phlage": 0.88, "Bolt": 0.70},
        "tron": {"Wurmcoil Engine": 1.0, "Karn Liberated": 1.0},
    }
    match, score = find_best_match(list_weights, profiles, threshold=0.5)
    assert match == "boros-energy"
    assert score > 0.5


def test_find_best_match_below_threshold():
    list_weights = {"Ragavan": 1.0, "Phlage": 1.0}
    profiles = {
        "tron": {"Wurmcoil Engine": 1.0, "Karn Liberated": 1.0},
    }
    match, score = find_best_match(list_weights, profiles, threshold=0.6)
    assert match is None
    assert score == 0.0


def test_find_best_match_empty_profiles():
    list_weights = {"Ragavan": 1.0}
    match, score = find_best_match(list_weights, {}, threshold=0.6)
    assert match is None
    assert score == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_similarity.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement similarity engine**

```python
# scripts/similarity.py

COPY_WEIGHTS = {4: 1.0, 3: 0.75, 2: 0.5, 1: 0.25}
SIDEBOARD_MULTIPLIER = 0.5


def card_weights(mainboard: dict[str, int], sideboard: dict[str, int]) -> dict[str, float]:
    """Convert mainboard/sideboard card counts to weighted representation.

    4-of = 1.0, 3-of = 0.75, 2-of = 0.5, 1-of = 0.25.
    Sideboard cards get an additional 0.5 multiplier.
    """
    weights = {}
    for name, count in mainboard.items():
        weights[name] = COPY_WEIGHTS.get(count, count / 4.0)
    for name, count in sideboard.items():
        weights[name] = COPY_WEIGHTS.get(count, count / 4.0) * SIDEBOARD_MULTIPLIER
    return weights


def weighted_jaccard(a: dict[str, float], b: dict[str, float]) -> float:
    """Compute weighted Jaccard similarity between two card weight dicts."""
    all_cards = set(a.keys()) | set(b.keys())
    if not all_cards:
        return 0.0

    intersection = sum(min(a.get(c, 0.0), b.get(c, 0.0)) for c in all_cards)
    union = sum(max(a.get(c, 0.0), b.get(c, 0.0)) for c in all_cards)

    if union == 0.0:
        return 0.0
    return intersection / union


def find_best_match(
    list_weights: dict[str, float],
    archetype_profiles: dict[str, dict[str, float]],
    threshold: float = 0.6,
) -> tuple[str | None, float]:
    """Find the archetype most similar to the given list.

    Returns (archetype_slug, similarity_score) or (None, 0.0) if none above threshold.
    """
    if not archetype_profiles:
        return None, 0.0

    best_slug = None
    best_score = 0.0

    for slug, profile in archetype_profiles.items():
        score = weighted_jaccard(list_weights, profile)
        if score > best_score:
            best_score = score
            best_slug = slug

    if best_score >= threshold:
        return best_slug, best_score
    return None, 0.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_similarity.py -v`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/similarity.py tests/test_similarity.py
git commit -m "feat: weighted Jaccard similarity engine for archetype matching"
```

---

### Task 5: Archetype Manager

**Files:**
- Create: `scripts/archetype_manager.py`
- Create: `tests/test_archetype_manager.py`

Reads existing archetypes from markdown files, computes archetype profiles from assigned lists, and creates new archetype files.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_archetype_manager.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_archetype_manager.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement archetype manager**

```python
# scripts/archetype_manager.py
from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.similarity import card_weights


def read_archetype(path: Path) -> dict:
    """Read an archetype markdown file. Returns dict with name, colors, slug, description."""
    text = path.read_text()
    parts = text.split("---", 2)
    metadata = yaml.safe_load(parts[1]) or {}
    body = parts[2].strip() if len(parts) > 2 else ""
    return {
        "name": metadata.get("name", ""),
        "colors": metadata.get("colors", []),
        "slug": path.stem,
        "description": body,
    }


def write_archetype(directory: Path, slug: str, name: str, colors: list[str], description: str) -> Path:
    """Create a new archetype markdown file."""
    directory = Path(directory)
    path = directory / f"{slug}.md"
    frontmatter = {"name": name, "colors": colors}
    content = "---\n" + yaml.dump(frontmatter, default_flow_style=False) + "---\n" + description + "\n"
    path.write_text(content)
    return path


def list_archetypes(directory: Path) -> list[dict]:
    """Read all archetype files from a directory."""
    directory = Path(directory)
    archetypes = []
    for path in sorted(directory.glob("*.md")):
        archetypes.append(read_archetype(path))
    return archetypes


def compute_archetype_profile(slug: str, lists_dir: Path) -> dict[str, float]:
    """Compute the average card weight profile for an archetype from its assigned lists."""
    lists_dir = Path(lists_dir)
    card_totals: dict[str, float] = {}
    list_count = 0

    for path in lists_dir.glob("*.md"):
        text = path.read_text()
        parsed = parse_decklist(text)
        if parsed["metadata"].get("archetype") != slug:
            continue
        list_count += 1
        weights = card_weights(parsed["mainboard"], parsed["sideboard"])
        for card, weight in weights.items():
            card_totals[card] = card_totals.get(card, 0.0) + weight

    if list_count == 0:
        return {}

    return {card: total / list_count for card, total in card_totals.items()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_archetype_manager.py -v`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/archetype_manager.py tests/test_archetype_manager.py
git commit -m "feat: archetype manager for reading, writing, and profiling archetypes"
```

---

### Task 6: LLM Integration for Archetype Naming

**Files:**
- Create: `scripts/llm.py`

Thin wrapper around the Anthropic API for creating archetype names and descriptions. Kept separate so it can be mocked easily in tests.

- [ ] **Step 1: Implement LLM module**

```python
# scripts/llm.py
import anthropic


def create_archetype(card_names: list[str], colors: list[str]) -> dict:
    """Ask the LLM to name and describe a new archetype based on its cards.

    Returns dict with 'name', 'slug', 'description'.
    """
    color_map = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"}
    color_str = ", ".join(color_map.get(c, c) for c in colors)

    top_cards = card_names[:20]
    cards_str = "\n".join(f"- {name}" for name in top_cards)

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": f"""Name this Modern MTG deck archetype and write a 2-3 sentence description.

Colors: {color_str}
Key cards:
{cards_str}

Respond in exactly this format (no markdown, no extra text):
NAME: <archetype name>
SLUG: <lowercase-hyphenated-slug>
DESCRIPTION: <2-3 sentence description>

Use established MTG archetype naming conventions. If this resembles a known archetype, use that name.""",
            }
        ],
    )

    text = message.content[0].text
    lines = text.strip().splitlines()
    result = {}
    for line in lines:
        if line.startswith("NAME:"):
            result["name"] = line.split(":", 1)[1].strip()
        elif line.startswith("SLUG:"):
            result["slug"] = line.split(":", 1)[1].strip()
        elif line.startswith("DESCRIPTION:"):
            result["description"] = line.split(":", 1)[1].strip()

    return result
```

- [ ] **Step 2: Commit**

```bash
git add scripts/llm.py
git commit -m "feat: LLM integration for archetype naming via Anthropic API"
```

---

### Task 7: Ingestion Pipeline

**Files:**
- Create: `scripts/ingest.py`
- Create: `tests/test_ingest.py`

Orchestrates the full ingestion flow: parse list, ensure card files, classify archetype, save list file.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_ingest.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_ingest.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement ingestion pipeline**

```python
# scripts/ingest.py
from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.scryfall import ensure_card_file, slugify
from scripts.similarity import card_weights, find_best_match
from scripts.archetype_manager import (
    list_archetypes,
    compute_archetype_profile,
    write_archetype,
)
from scripts.llm import create_archetype


def ingest_list(
    raw_text: str,
    knowledge_dir: Path,
    threshold: float = 0.6,
) -> dict:
    """Ingest a raw decklist into the knowledge base.

    Returns dict with archetype slug, whether it's new, and the saved list path.
    """
    knowledge_dir = Path(knowledge_dir)
    cards_dir = knowledge_dir / "cards"
    archetypes_dir = knowledge_dir / "archetypes"
    lists_dir = knowledge_dir / "lists"

    parsed = parse_decklist(raw_text)
    metadata = parsed["metadata"]

    # Ensure card files exist for every card in the list
    for card_name in parsed["all_card_names"]:
        ensure_card_file(card_name, cards_dir)

    # Build weight vector for this list
    list_weights = card_weights(parsed["mainboard"], parsed["sideboard"])

    # Compute profiles for all existing archetypes
    archetypes = list_archetypes(archetypes_dir)
    profiles = {}
    for arch in archetypes:
        profile = compute_archetype_profile(arch["slug"], lists_dir)
        if profile:
            profiles[arch["slug"]] = profile

    # Find best match
    match_slug, score = find_best_match(list_weights, profiles, threshold=threshold)
    is_new = match_slug is None

    if is_new:
        # Derive colors from the cards in the list
        colors = _derive_colors(parsed["mainboard"], cards_dir)
        card_names = list(parsed["mainboard"].keys())
        archetype_info = create_archetype(card_names, colors)
        match_slug = archetype_info["slug"]
        write_archetype(
            archetypes_dir,
            archetype_info["slug"],
            archetype_info["name"],
            colors,
            archetype_info["description"],
        )

    # Save the list file with archetype assigned
    metadata["archetype"] = match_slug
    list_path = _save_list(raw_text, metadata, lists_dir)

    return {
        "archetype": match_slug,
        "is_new_archetype": is_new,
        "list_path": str(list_path),
    }


def _derive_colors(mainboard: dict[str, int], cards_dir: Path) -> list[str]:
    """Read card files to determine deck colors from mainboard cards."""
    colors = set()
    for card_name in mainboard:
        slug = slugify(card_name)
        path = cards_dir / f"{slug}.md"
        if path.exists():
            text = path.read_text()
            parts = text.split("---", 2)
            if len(parts) >= 2:
                fm = yaml.safe_load(parts[1]) or {}
                for c in fm.get("colors", []):
                    colors.add(c)
    color_order = ["W", "U", "B", "R", "G"]
    return [c for c in color_order if c in colors]


def _save_list(raw_text: str, metadata: dict, lists_dir: Path) -> Path:
    """Save the decklist with updated metadata to lists/."""
    date = metadata.get("date", "unknown")
    source = metadata.get("source", "unknown")
    source_slug = slugify(source)

    # Find a unique filename
    base = f"{date}-{source_slug}"
    path = lists_dir / f"{base}.md"
    counter = 1
    while path.exists():
        counter += 1
        path = lists_dir / f"{base}-{counter}.md"

    # Rebuild the file with updated frontmatter
    parsed = parse_decklist(raw_text)
    # Reconstruct body (everything after frontmatter)
    body = raw_text.strip()
    if body.startswith("---"):
        parts = body.split("---", 2)
        body = parts[2] if len(parts) > 2 else ""

    content = "---\n" + yaml.dump(metadata, default_flow_style=False) + "---\n" + body
    path.write_text(content)
    return path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_ingest.py -v`
Expected: all 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest.py tests/test_ingest.py
git commit -m "feat: ingestion pipeline with archetype classification"
```

---

### Task 8: Compute Pipeline

**Files:**
- Create: `scripts/compute.py`
- Create: `tests/test_compute.py`

Reads the entire knowledge base and produces `computed/graph.json` with nodes, edges, and timeline.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_compute.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_compute.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement compute pipeline**

```python
# scripts/compute.py
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

from scripts.parser import parse_decklist
from scripts.similarity import card_weights


def compute_graph(knowledge_dir: Path) -> dict:
    """Read the knowledge base and produce the full graph data structure."""
    knowledge_dir = Path(knowledge_dir)
    cards_dir = knowledge_dir / "cards"
    archetypes_dir = knowledge_dir / "archetypes"
    lists_dir = knowledge_dir / "lists"

    # Read all card files
    cards = _read_all_cards(cards_dir)

    # Read all archetype files
    archetypes = _read_all_archetypes(archetypes_dir)

    # Read and parse all lists, grouped by archetype
    lists_by_archetype = _read_all_lists(lists_dir)

    total_lists = sum(len(ls) for ls in lists_by_archetype.values())

    # Compute edges: for each archetype, compute card frequency and avg copies
    edges = []
    card_archetype_weights = defaultdict(dict)  # card_slug -> {arch_slug: weight}

    for arch_slug, arch_lists in lists_by_archetype.items():
        if not arch_lists:
            continue
        card_appearances = defaultdict(int)     # how many lists contain this card
        card_total_copies = defaultdict(int)    # total copies across lists

        for parsed in arch_lists:
            all_cards = {}
            all_cards.update(parsed["mainboard"])
            all_cards.update(parsed["sideboard"])
            for card_name, copies in all_cards.items():
                card_appearances[card_name] += 1
                card_total_copies[card_name] += copies

        list_count = len(arch_lists)
        for card_name in card_appearances:
            from scripts.scryfall import slugify
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
            continue  # skip cards not in any list
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

    # Build timeline: monthly meta_share per archetype
    timeline = _build_timeline(lists_by_archetype, lists_dir)

    # Determine time range
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


def _build_timeline(lists_by_archetype: dict, lists_dir: Path) -> dict:
    timeline = {}
    # Count lists per archetype per month
    for arch_slug, arch_lists in lists_by_archetype.items():
        monthly_counts = defaultdict(int)
        monthly_totals = defaultdict(int)

        for parsed in arch_lists:
            date_str = str(parsed["metadata"].get("date", ""))
            if len(date_str) >= 7:
                month = date_str[:7]  # "2026-04"
                monthly_counts[month] += 1

        # We need total lists per month across all archetypes
        all_monthly_totals = defaultdict(int)
        for a_slug, a_lists in lists_by_archetype.items():
            for parsed in a_lists:
                date_str = str(parsed["metadata"].get("date", ""))
                if len(date_str) >= 7:
                    month = date_str[:7]
                    all_monthly_totals[month] += 1

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_compute.py -v`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/compute.py tests/test_compute.py
git commit -m "feat: compute pipeline that produces graph.json from knowledge base"
```

---

### Task 9: Web App — HTML Structure and D3.js Graph

**Files:**
- Create: `web/index.html`
- Create: `web/graph.js`
- Create: `web/style.css`

Static web app that reads `computed/graph.json` and renders an interactive force-directed graph with D3.js.

- [ ] **Step 1: Create HTML shell**

```html
<!-- web/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MTG Modern Metagame Graph</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="controls">
        <h1>Modern Metagame</h1>
        <div id="time-filter">
            <label for="date-from">From:</label>
            <input type="month" id="date-from">
            <label for="date-to">To:</label>
            <input type="month" id="date-to">
            <button id="apply-filter">Apply</button>
            <button id="reset-filter">Reset</button>
        </div>
    </div>
    <div id="graph-container">
        <svg id="graph"></svg>
    </div>
    <div id="detail-panel" class="hidden">
        <button id="close-panel">&times;</button>
        <div id="detail-content"></div>
    </div>
    <div id="tooltip" class="hidden"></div>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="graph.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create CSS**

```css
/* web/style.css */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0f;
    color: #e0e0e0;
    overflow: hidden;
    height: 100vh;
}

#controls {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    padding: 12px 20px;
    background: rgba(10, 10, 15, 0.9);
    border-bottom: 1px solid #222;
    display: flex;
    align-items: center;
    gap: 24px;
}

#controls h1 {
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
}

#time-filter {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}

#time-filter input {
    background: #1a1a2e;
    border: 1px solid #333;
    color: #e0e0e0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
}

#time-filter button {
    background: #1a1a2e;
    border: 1px solid #333;
    color: #e0e0e0;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
}

#time-filter button:hover { border-color: #666; }

#graph-container {
    width: 100vw;
    height: 100vh;
    padding-top: 50px;
}

#graph { width: 100%; height: 100%; }

/* Detail panel */
#detail-panel {
    position: fixed;
    top: 50px;
    right: 0;
    width: 360px;
    height: calc(100vh - 50px);
    background: rgba(15, 15, 25, 0.95);
    border-left: 1px solid #222;
    padding: 20px;
    overflow-y: auto;
    z-index: 20;
    transition: transform 0.2s;
}

#detail-panel.hidden { transform: translateX(100%); }

#close-panel {
    position: absolute;
    top: 10px;
    right: 10px;
    background: none;
    border: none;
    color: #888;
    font-size: 20px;
    cursor: pointer;
}

#detail-content h2 {
    font-size: 18px;
    margin-bottom: 8px;
}

#detail-content .meta-share {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 12px;
}

#detail-content .card-list {
    list-style: none;
    padding: 0;
}

#detail-content .card-list li {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid #1a1a2e;
    font-size: 13px;
}

#detail-content .card-list .weight {
    color: #888;
}

/* Tooltip */
#tooltip {
    position: fixed;
    background: rgba(20, 20, 35, 0.95);
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 13px;
    pointer-events: none;
    z-index: 30;
    max-width: 260px;
}

#tooltip.hidden { display: none; }

#tooltip img {
    width: 120px;
    border-radius: 4px;
    margin-top: 6px;
}

/* MTG color coding for nodes */
.node-W { fill: #f9faf4; }
.node-U { fill: #0e68ab; }
.node-B { fill: #6b6b6b; }
.node-R { fill: #d32029; }
.node-G { fill: #00733e; }
.node-multi { fill: #c8a84e; }
.node-colorless { fill: #9e9e9e; }
.node-archetype { fill: #7b2d8e; stroke: #a855f7; stroke-width: 2px; }
```

- [ ] **Step 3: Create D3.js graph script**

```javascript
// web/graph.js

const DATA_PATH = "../computed/graph.json";

let allData = null;
let simulation = null;

async function init() {
    const resp = await fetch(DATA_PATH);
    allData = await resp.json();

    if (allData.time_range.from) {
        document.getElementById("date-from").value = allData.time_range.from.slice(0, 7);
    }
    if (allData.time_range.to) {
        document.getElementById("date-to").value = allData.time_range.to.slice(0, 7);
    }

    renderGraph(allData);
    setupControls();
}

function nodeColor(node) {
    if (node.type === "archetype") return "#7b2d8e";
    const colors = node.colors || [];
    if (colors.length === 0) return "#9e9e9e";
    if (colors.length > 1) return "#c8a84e";
    const map = { W: "#f9faf4", U: "#0e68ab", B: "#6b6b6b", R: "#d32029", G: "#00733e" };
    return map[colors[0]] || "#9e9e9e";
}

function nodeRadius(node) {
    if (node.type === "archetype") {
        return 10 + node.meta_share * 60;
    }
    return 3 + node.meta_presence * 20;
}

function renderGraph(data) {
    const svg = d3.select("#graph");
    svg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight - 50;

    svg.attr("viewBox", [0, 0, width, height]);

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Build node/link data (deep copy to avoid D3 mutation issues)
    const nodes = data.nodes.map(n => ({ ...n }));
    const edges = data.edges.map(e => ({ ...e }));

    // Map node ids for link references
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Filter edges to only include those where both source and target exist
    const validEdges = edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));

    simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(validEdges).id(d => d.id).distance(80).strength(e => e.weight * 0.3))
        .force("charge", d3.forceManyBody().strength(-120))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => nodeRadius(d) + 2));

    // Links
    const link = g.append("g")
        .selectAll("line")
        .data(validEdges)
        .join("line")
        .attr("stroke", "#333")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", d => 0.5 + d.weight * 3);

    // Nodes
    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => nodeRadius(d))
        .attr("fill", d => nodeColor(d))
        .attr("stroke", d => d.type === "archetype" ? "#a855f7" : "none")
        .attr("stroke-width", d => d.type === "archetype" ? 2 : 0)
        .attr("cursor", "pointer")
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded));

    // Labels for archetypes
    const label = g.append("g")
        .selectAll("text")
        .data(nodes.filter(n => n.type === "archetype"))
        .join("text")
        .text(d => d.name)
        .attr("font-size", 11)
        .attr("fill", "#ccc")
        .attr("text-anchor", "middle")
        .attr("dy", d => -nodeRadius(d) - 6)
        .attr("pointer-events", "none");

    // Tooltip
    const tooltip = d3.select("#tooltip");

    node.on("mouseover", (event, d) => {
        tooltip.classed("hidden", false);
        let html = `<strong>${d.name}</strong>`;
        if (d.type === "card" && d.image) {
            html += `<br><img src="${d.image}" alt="${d.name}">`;
        }
        if (d.type === "archetype") {
            html += `<br>Meta share: ${(d.meta_share * 100).toFixed(1)}%`;
            html += `<br>Lists: ${d.list_count}`;
        }
        if (d.type === "card") {
            html += `<br>Meta presence: ${(d.meta_presence * 100).toFixed(1)}%`;
        }
        tooltip.html(html);
    })
    .on("mousemove", (event) => {
        tooltip.style("left", (event.clientX + 15) + "px")
               .style("top", (event.clientY + 15) + "px");
    })
    .on("mouseout", () => {
        tooltip.classed("hidden", true);
    });

    // Click: show detail panel
    node.on("click", (event, d) => {
        event.stopPropagation();
        if (d.type === "archetype") {
            showArchetypeDetail(d, validEdges, nodeMap);
        } else {
            showCardDetail(d, validEdges, nodeMap);
        }
        highlightConnected(d, validEdges, node, link);
    });

    // Click on background: reset
    svg.on("click", () => {
        d3.select("#detail-panel").classed("hidden", true);
        node.attr("opacity", 1);
        link.attr("stroke-opacity", 0.6);
    });

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
        label
            .attr("x", d => d.x)
            .attr("y", d => d.y);
    });
}

function highlightConnected(d, edges, nodeSelection, linkSelection) {
    const connectedIds = new Set();
    connectedIds.add(d.id);

    edges.forEach(e => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        if (sourceId === d.id) connectedIds.add(targetId);
        if (targetId === d.id) connectedIds.add(sourceId);
    });

    nodeSelection.attr("opacity", n => connectedIds.has(n.id) ? 1 : 0.1);
    linkSelection.attr("stroke-opacity", e => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        return (sourceId === d.id || targetId === d.id) ? 0.8 : 0.05;
    });
}

function showArchetypeDetail(d, edges, nodeMap) {
    const panel = d3.select("#detail-panel").classed("hidden", false);
    const connectedEdges = edges.filter(e => {
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        return targetId === d.id;
    });
    connectedEdges.sort((a, b) => b.weight - a.weight);

    let html = `<h2>${d.name}</h2>`;
    html += `<div class="meta-share">${(d.meta_share * 100).toFixed(1)}% meta</div>`;
    if (d.description) html += `<p>${d.description}</p>`;
    html += `<p>${d.list_count} lists</p>`;
    html += `<h3 style="margin-top:16px">Cards</h3>`;
    html += `<ul class="card-list">`;
    for (const edge of connectedEdges) {
        const sourceId = typeof edge.source === "object" ? edge.source.id : edge.source;
        const cardNode = nodeMap.get(sourceId);
        const name = cardNode ? cardNode.name : sourceId;
        html += `<li><span>${name}</span><span class="weight">${edge.avg_copies.toFixed(1)}x (${(edge.weight * 100).toFixed(0)}%)</span></li>`;
    }
    html += `</ul>`;

    d3.select("#detail-content").html(html);
}

function showCardDetail(d, edges, nodeMap) {
    const panel = d3.select("#detail-panel").classed("hidden", false);
    const connectedEdges = edges.filter(e => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        return sourceId === d.id;
    });
    connectedEdges.sort((a, b) => b.weight - a.weight);

    let html = `<h2>${d.name}</h2>`;
    if (d.image) html += `<img src="${d.image}" style="width:200px;border-radius:8px;margin:8px 0">`;
    html += `<div class="meta-share">${(d.meta_presence * 100).toFixed(1)}% presence</div>`;
    html += `<p>CMC: ${d.cmc} | ${d.colors.join("")}</p>`;
    html += `<h3 style="margin-top:16px">Played in</h3>`;
    html += `<ul class="card-list">`;
    for (const edge of connectedEdges) {
        const targetId = typeof edge.target === "object" ? edge.target.id : edge.target;
        const archNode = nodeMap.get(targetId);
        const name = archNode ? archNode.name : targetId;
        html += `<li><span>${name}</span><span class="weight">${edge.avg_copies.toFixed(1)}x (${(edge.weight * 100).toFixed(0)}%)</span></li>`;
    }
    html += `</ul>`;

    d3.select("#detail-content").html(html);
}

function setupControls() {
    d3.select("#close-panel").on("click", () => {
        d3.select("#detail-panel").classed("hidden", true);
    });

    d3.select("#apply-filter").on("click", () => {
        const from = document.getElementById("date-from").value;
        const to = document.getElementById("date-to").value;
        if (!from || !to) return;
        const filtered = filterByDateRange(allData, from, to);
        renderGraph(filtered);
    });

    d3.select("#reset-filter").on("click", () => {
        renderGraph(allData);
    });
}

function filterByDateRange(data, from, to) {
    // For now, return all data. Full temporal filtering requires
    // graph.json to include per-list dates and recomputing on the client,
    // or pre-computing multiple snapshots. This is a placeholder for the
    // time filter UI — the compute pipeline handles the actual filtering.
    // TODO: The compute.py should accept date range params and regenerate.
    return data;
}

function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

init();
```

- [ ] **Step 4: Test manually by serving the web app**

Run: `cd /Users/francescozese/Desktop/DataPizza/Hackapizza/MTGGraph && python -m http.server 8080 --directory web`

Open `http://localhost:8080` in browser. At this stage it will show an empty graph (no data yet). Verify: no JS console errors, page loads, controls render.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/graph.js web/style.css
git commit -m "feat: static D3.js web app for metagame graph visualization"
```

---

### Task 10: End-to-End Integration Test

**Files:**
- Create: `tests/test_integration.py`

A test that runs the full pipeline: parse a list, ingest it (with mocked Scryfall + LLM), compute the graph, and verify the output.

- [ ] **Step 1: Write integration test**

```python
# tests/test_integration.py
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
```

- [ ] **Step 2: Run the integration test**

Run: `pytest tests/test_integration.py -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pytest -v`
Expected: all tests PASS (parser: 5, scryfall: 5, similarity: 9, archetype_manager: 4, compute: 6, integration: 1 = 30 tests)

- [ ] **Step 4: Commit**

```bash
git add tests/test_integration.py
git commit -m "test: end-to-end integration test for full ingestion and compute pipeline"
```

---

### Task 11: CLI Entry Points

**Files:**
- Create: `scripts/__main__.py`

Simple CLI to run ingestion from a file and compute the graph.

- [ ] **Step 1: Create CLI module**

```python
# scripts/__main__.py
"""CLI entry points for MTGGraph.

Usage:
    python -m scripts ingest <file_or_text>    Ingest a decklist
    python -m scripts compute                  Recompute graph.json
    python -m scripts serve                    Serve the web app locally
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
KNOWLEDGE_DIR = ROOT / "knowledge"
COMPUTED_DIR = ROOT / "computed"
WEB_DIR = ROOT / "web"


def cmd_ingest(args):
    from scripts.ingest import ingest_list

    if not args:
        print("Usage: python -m scripts ingest <file_path>")
        sys.exit(1)

    path = Path(args[0])
    if path.exists():
        raw_text = path.read_text()
    else:
        print(f"File not found: {path}")
        sys.exit(1)

    threshold = 0.6
    if "--threshold" in args:
        idx = args.index("--threshold")
        threshold = float(args[idx + 1])

    result = ingest_list(raw_text, KNOWLEDGE_DIR, threshold=threshold)
    status = "NEW archetype" if result["is_new_archetype"] else "matched"
    print(f"Archetype: {result['archetype']} ({status})")
    print(f"List saved: {result['list_path']}")


def cmd_compute(args):
    from scripts.compute import write_graph

    output = COMPUTED_DIR / "graph.json"
    write_graph(KNOWLEDGE_DIR, output)
    print(f"Graph written to {output}")


def cmd_serve(args):
    import http.server
    import functools

    port = 8080
    if args:
        port = int(args[0])

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB_DIR))
    server = http.server.HTTPServer(("", port), handler)
    print(f"Serving at http://localhost:{port}")
    server.serve_forever()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "ingest": cmd_ingest,
        "compute": cmd_compute,
        "serve": cmd_serve,
    }

    if command not in commands:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)

    commands[command](args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify CLI help works**

Run: `cd /Users/francescozese/Desktop/DataPizza/Hackapizza/MTGGraph && python -m scripts`
Expected: prints usage help with available commands

- [ ] **Step 3: Commit**

```bash
git add scripts/__main__.py
git commit -m "feat: CLI entry points for ingest, compute, and serve commands"
```

---

## Summary

| Task | What it builds | Files |
|------|---------------|-------|
| 1 | Project setup | `pyproject.toml`, directories |
| 2 | List parser | `scripts/parser.py`, `tests/test_parser.py` |
| 3 | Scryfall client | `scripts/scryfall.py`, `tests/test_scryfall.py` |
| 4 | Similarity engine | `scripts/similarity.py`, `tests/test_similarity.py` |
| 5 | Archetype manager | `scripts/archetype_manager.py`, `tests/test_archetype_manager.py` |
| 6 | LLM integration | `scripts/llm.py` |
| 7 | Ingestion pipeline | `scripts/ingest.py`, `tests/test_ingest.py` |
| 8 | Compute pipeline | `scripts/compute.py`, `tests/test_compute.py` |
| 9 | Web app | `web/index.html`, `web/graph.js`, `web/style.css` |
| 10 | Integration test | `tests/test_integration.py` |
| 11 | CLI entry points | `scripts/__main__.py` |
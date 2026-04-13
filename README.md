# MTGGraph

Interactive knowledge graph of the Modern MTG metagame.

**[View the live graph](https://francescozese.github.io/MTGGraph/)**

Cards and archetypes are nodes. Edges connect cards to the decks that play them. Node size reflects meta share. The graph updates daily from MTGO tournament results.

---

## How it works

Tournament decklists are ingested from [MTGO](https://www.mtgo.com/decklists) (Challenges and Leagues). A weighted Jaccard similarity algorithm classifies each list into an archetype. Card data comes from [Scryfall](https://scryfall.com/).

The knowledge base is a collection of markdown files — one per card, one per archetype, one per ingested list. A compute pipeline reads them all and produces `graph.json`, which the web app renders as a force-directed graph using D3.js.

```
Tournament list ─→ ingest.py ─→ knowledge/*.md ─→ compute.py ─→ graph.json ─→ D3.js
```

A GitHub Action runs daily at 06:00 CET, fetching new results and updating the graph automatically.

## Features

- Force-directed graph with mana-colored archetype nodes
- Click an archetype to see tournament lists and the average deck composition
- Card image preview on hover
- Meta threshold slider to filter out fringe archetypes
- Challenge / League toggle filters

## Stack

- **Knowledge base**: Markdown + YAML frontmatter (Karpathy LLM Wiki pattern)
- **Pipeline**: Python 3.12 (PyYAML, requests)
- **Visualization**: D3.js v7, vanilla HTML/CSS/JS
- **Data sources**: MTGO official results, Scryfall API
- **Automation**: GitHub Actions (daily cron)

## Local development

```bash
git clone https://github.com/FrancescoZese/MTGGraph.git
cd MTGGraph
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Ingest a tournament
python -m scripts.fetch_tournament <MTGO_URL> --top 16
python -m scripts ingest raw/<file>.md --name 'Archetype' --slug archetype-slug

# Recompute graph
python -m scripts compute

# Serve locally
python -m scripts serve
# Open http://localhost:8080/web/index.html
```

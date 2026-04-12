# MTGGraph

Interactive knowledge graph of the Modern MTG metagame. Inspired by Karpathy's LLM Wiki pattern.

## Project Structure

- `knowledge/` — markdown knowledge base (source of truth)
  - `cards/` — one .md per card (Scryfall data + computed meta presence)
  - `archetypes/` — one .md per archetype (description + computed meta share + top cards)
  - `lists/` — one .md per ingested tournament list (immutable)
  - `META.md` — auto-generated metagame summary (entry point for LLM reading)
- `computed/graph.json` — graph data for the web visualization
- `scripts/` — Python pipeline (parser, scryfall, similarity, ingest, compute)
- `web/` — static D3.js force-directed graph visualization
- `raw/` — temporary staging for lists before ingestion

## Key Commands

```bash
source .venv/bin/activate

# Fetch a tournament's decklists to raw/
python -m scripts.fetch_tournament <MTGO_URL> --top 16

# Update meta: auto-fetch all new events since last ingestion
python -m scripts.update_meta --challenges-only --top 16

# Ingest a single list
python -m scripts ingest raw/file.md --name 'Name' --slug name-slug --desc 'Description'

# Recompute graph.json + enrich markdown + regenerate META.md
python -m scripts compute

# Serve web app
python -m scripts serve
```

## Updating the Meta

Use the `/mtg-ingest` skill or simply ask "aggiorna il meta". The skill handles the full flow: fetch new events from MTGO, ingest lists, name archetypes, recompute.

## Web App

Serve with `python -m scripts serve`, then open `http://localhost:8080/web/index.html`.

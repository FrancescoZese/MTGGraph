# MTGGraph

Interactive knowledge graph of the Modern MTG metagame. Inspired by Karpathy's LLM Wiki pattern.

## Project Structure

- `knowledge/` — markdown knowledge base (source of truth)
  - `cards/` — one .md per card (Scryfall data + computed meta presence + archetype links)
  - `archetypes/` — one .md per archetype (description + computed meta share + top cards)
  - `lists/` — one .md per ingested tournament list (immutable after creation)
  - `META.md` — auto-generated metagame summary (entry point for LLM reading)
- `computed/graph.json` — graph data for the web visualization (nodes, edges, lists, timeline)
- `scripts/` — Python pipeline
  - `parser.py` — parse decklist markdown format
  - `scryfall.py` — Scryfall API client, creates card .md files
  - `similarity.py` — weighted Jaccard similarity for archetype matching
  - `archetype_manager.py` — read/write/profile archetypes
  - `profile_cache.py` — in-memory cache for fast batch ingestion (loads once, O(1) per list)
  - `ingest.py` — ingestion pipeline (parse → Scryfall → similarity → assign archetype)
  - `compute.py` — reads knowledge/, produces graph.json, enriches markdown, generates META.md
  - `fetch_tournament.py` — fetches decklists from MTGO tournament pages (uses cloudscraper)
  - `update_meta.py` — auto-fetch all new events since last ingestion
  - `rename_archetype.py` — rename an archetype across all files
  - `batch_ingest.py` — interactive batch ingestion with archetype naming prompts
- `web/` — static D3.js force-directed graph visualization
- `raw/` — temporary staging for lists before ingestion (gitignored)

## Key Commands

```bash
source .venv/bin/activate

# Update meta (interactive — fetches new events, you name new archetypes)
python -m scripts.update_meta --top 16

# Update meta (automated — names unknowns as Unknown #N)
python -m scripts.update_meta --auto --top 16

# Fetch a specific tournament
python -m scripts.fetch_tournament <MTGO_URL> --top 16

# Ingest a single list
python -m scripts ingest raw/file.md --name 'Name' --slug name-slug --desc 'Description'

# Rename an archetype (updates file + all lists)
python -m scripts.rename_archetype old-slug new-slug "New Name"

# Recompute graph.json + enrich markdown + regenerate META.md
python -m scripts compute

# Serve web app locally
python -m scripts serve
# Open http://localhost:8080/web/index.html
```

## Skills

- `/mtg-ingest` or "aggiorna il meta" — full ingestion flow: fetch, ingest, name archetypes, compute, push
- `/mtg-ingest rinomina archetipi` — rename Unknown archetypes one at a time (show list, user names it)

## Archetype Classification

Lists are matched to archetypes using weighted Jaccard similarity:
- Default threshold: 0.5
- 4-of = weight 1.0, 3-of = 0.75, 2-of = 0.5, 1-of = 0.25
- Sideboard cards get 0.5 multiplier
- `profile_cache.py` loads all profiles once for fast batch processing

## Automation

- GitHub Action runs daily at 06:00 CET (04:00 UTC)
- Uses `cloudscraper` to bypass Cloudflare on MTGO
- Auto-names unmatched archetypes as Unknown #N
- Commits and pushes to update GitHub Pages
- Workflow can be triggered manually from GitHub Actions UI

## Renaming Process

When Unknown archetypes exist, the user asks "rinomina archetipi" and:
1. Show one Unknown at a time with full decklist
2. User provides the name
3. Run `python -m scripts.rename_archetype unknown-N new-slug "New Name"`
4. To merge into existing archetype: update list files' `archetype` field, delete old archetype file
5. After all renames: `python -m scripts compute` then commit and push

## Web App

- GitHub Pages: https://francescozese.github.io/MTGGraph/
- Local: `python -m scripts serve` → http://localhost:8080/web/index.html
- graph.js loads `../computed/graph.json`
- Features: force-directed graph, mana-colored archetype nodes, meta sidebar, tabbed detail panel (Lists/Average Deck), card hover preview, Challenge/League filters, meta threshold slider

## Data Sources

- Tournament data: MTGO (mtgo.com/decklists) — scraped with cloudscraper
- Card data: Scryfall API (cached locally as markdown)

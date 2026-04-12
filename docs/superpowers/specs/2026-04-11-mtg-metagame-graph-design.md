1












# MTG Modern Metagame Knowledge Graph

Design spec per un knowledge graph interattivo del metagame di Modern in Magic: The Gathering. Ispirato dal pattern LLM Wiki di Karpathy, adattato per rappresentare le relazioni tra carte e archetipi del formato.

## Architettura

Il sistema e' composto da tre componenti indipendenti:

1. **Knowledge base** (`knowledge/`) -- file markdown gestiti dall'LLM e dallo script di ingestion. Source of truth del progetto. Versionato con git.
2. **Compute** (`scripts/`) -- Python puro. Legge il knowledge base, calcola pesi, similarita', timeline, e produce `computed/graph.json`. Deterministico e ricalcolabile da zero.
3. **Web app** (`web/`) -- HTML/JS/CSS statico con D3.js. Legge `graph.json` e renderizza il grafo. Zero dipendenze server.

### Struttura filesystem

```
MTGGraph/
├── knowledge/
│   ├── cards/              # un .md per carta, creato da Scryfall + LLM
│   ├── archetypes/         # un .md per archetipo, creato dall'LLM
│   └── lists/              # un .md per lista ingerita, immutabile
├── computed/
│   └── graph.json          # output di compute.py, input della web app
├── scripts/
│   ├── ingest.py           # pipeline di ingestion liste
│   └── compute.py          # calcolo pesi e generazione graph.json
├── web/
│   ├── index.html
│   ├── graph.js
│   └── style.css
└── docs/
```

## Formato dei file

### Lista (`knowledge/lists/2026-04-05-modern-challenge.md`)

Record immutabile di una lista torneo. Mai modificato dopo la creazione.

```markdown
---
date: 2026-04-05
source: MTGO Modern Challenge
pilot: PlayerName123
finish: 3rd
archetype: boros-energy          # assegnato durante ingestion
---

# Mainboard
4 Ragavan, Nimble Pilferer
4 Phlage, Titan of Fire's Fury
4 Guide of Souls
4 Ocelot Pride
4 Galvanic Discharge
2 Ajani, Nacatl Pariah

# Sideboard
2 Wear // Tear
2 Rest in Peace
```

Il formato `N Card Name` e' lo standard MTG. Il campo `archetype` nel frontmatter viene assegnato dallo script di ingestion dopo il calcolo di similarita'.

### Carta (`knowledge/cards/ragavan-nimble-pilferer.md`)

Creata automaticamente la prima volta che una carta viene incontrata. Frontmatter da Scryfall, corpo dall'LLM.

```markdown
---
name: Ragavan, Nimble Pilferer
colors: [R]
cmc: 1
type: Legendary Creature — Monkey Pirate
set: MH2
image: https://cards.scryfall.io/normal/front/...
scryfall_id: 1d9a6a0d-...
---

Il one-drop piu' impattante del formato. Genera vantaggio in mana
(tesori) e carte (esilio dalla cima del mazzo avversario). La dash
a 1R la rende resiliente contro le removal sorcery-speed.
```

Il corpo descrittivo e' opzionale -- il sistema funziona anche senza. L'LLM lo genera quando ha contesto utile da aggiungere.

### Archetipo (`knowledge/archetypes/boros-energy.md`)

Creato dall'LLM quando una lista non corrisponde a nessun archetipo esistente.

```markdown
---
name: Boros Energy
colors: [R, W]
---

Boros Energy e' il deck aggressivo-midrange dominante del formato.
Sfrutta il package energy (Guide of Souls, Galvanic Discharge,
Phlage) per generare value incrementale mentre presenta un clock
veloce con Ragavan e Ocelot Pride.
```

Nessun peso o lista di carte qui. I pesi sono calcolati dallo script e vivono solo in `graph.json`.

## Pipeline di ingestion

### Flusso

```
Lista grezza (copia/incolla o file)
        |
        v
   ingest.py: parsa la lista, estrae nomi carte
        |
        v
   Per ogni carta nuova: chiama Scryfall API -> crea cards/*.md
        |
        v
   Calcola similarita' (Jaccard pesato) con archetipi esistenti
        |
        +-- sopra soglia -> associa la lista all'archetipo esistente
        |
        +-- sotto soglia -> LLM crea nuovo archetipo (nome + descrizione)
        |
        v
   Salva la lista in lists/*.md con archetype nel frontmatter
        |
        v
   compute.py: ricalcola graph.json
```

### Similarita' Jaccard pesata

Ogni archetipo ha un profilo di carte con frequenze derivate dalle liste assegnate (es. Ragavan: 0.95, Phlage: 0.88, ...). Quando arriva una nuova lista:

1. Converti la lista in un vettore pesato: i 4-of hanno peso 1.0, i 3-of 0.75, i 2-of 0.50, i 1-of 0.25. Mainboard e sideboard sono trattati insieme ma il sideboard puo' avere un moltiplicatore ridotto.
2. Calcola la similarita' Jaccard pesata con il profilo di ogni archetipo esistente.
3. Se la similarita' massima supera la soglia configurabile (da tunare empiricamente, punto di partenza ~0.6), la lista viene assegnata a quell'archetipo e il profilo si aggiorna.
4. Se nessun archetipo supera la soglia, l'LLM viene invocato per creare un nuovo archetipo (sceglie il nome, scrive la descrizione). Per il cold start o per evitare nomi fantasiosi, l'LLM puo' usare come riferimento i nomi degli archetipi dei siti di metagame.

### Scryfall API

Chiamata una sola volta per carta, al primo incontro. I dati vengono salvati nel frontmatter del file markdown e non servono piu' chiamate successive. Campi estratti: name, colors, cmc, type_line, set, image_uris, scryfall_id.

### Ruolo dell'LLM

L'LLM interviene solo per:
- Creare nuovi archetipi (nome + descrizione) quando la similarita' e' sotto soglia
- Generare/aggiornare le descrizioni nel corpo dei file markdown (carte e archetipi)
- Interpretare il contesto del meta (es. perche' una carta e' diventata popolare)

L'LLM non fa calcoli numerici. Non assegna pesi. Non decide le similarita'.

## Struttura di `graph.json`

Output di `compute.py`, unico input della web app. Contiene tutto il necessario per renderizzare il grafo.

```json
{
  "generated_at": "2026-04-11T14:00:00Z",
  "time_range": { "from": "2026-01-01", "to": "2026-04-11" },
  "nodes": [
    {
      "id": "card:ragavan-nimble-pilferer",
      "type": "card",
      "name": "Ragavan, Nimble Pilferer",
      "colors": ["R"],
      "cmc": 1,
      "image": "https://cards.scryfall.io/...",
      "meta_presence": 0.42
    },
    {
      "id": "archetype:boros-energy",
      "type": "archetype",
      "name": "Boros Energy",
      "colors": ["R", "W"],
      "description": "Deck aggressivo-midrange che sfrutta...",
      "meta_share": 0.18,
      "list_count": 34
    }
  ],
  "edges": [
    {
      "source": "card:ragavan-nimble-pilferer",
      "target": "archetype:boros-energy",
      "weight": 0.95,
      "avg_copies": 3.8
    }
  ],
  "timeline": {
    "archetype:boros-energy": {
      "meta_share": [
        { "date": "2026-01", "value": 0.15 },
        { "date": "2026-02", "value": 0.20 },
        { "date": "2026-03", "value": 0.18 }
      ]
    }
  }
}
```

### Campi chiave

- **`meta_presence`** (carta): in quale percentuale del meta la carta appare, pesata per meta_share degli archetipi che la giocano.
- **`meta_share`** (archetipo): quale frazione del meta rappresenta, basata sulle liste ingerite nella finestra temporale.
- **`weight`** (arco): frequenza con cui la carta appare nelle liste dell'archetipo (0-1).
- **`avg_copies`** (arco): numero medio di copie della carta nelle liste dell'archetipo.
- **`timeline`**: serie storiche per aggregazione mensile, usate per visualizzazioni temporali.

## Web app e visualizzazione

### Stack

HTML/JS/CSS statico. Nessun framework, nessun build step. D3.js per il grafo force-directed.

### Grafo

- Layout force-directed: posiziona naturalmente i cluster di archetipi separati. Le carte condivise tra piu' archetipi finiscono a meta' strada tra i cluster.
- Nodi carta: colorati per colore MTG, dimensione proporzionale a `meta_presence`.
- Nodi archetipo: colore distinto dalle carte, dimensione proporzionale a `meta_share`.
- Archi: spessore proporzionale a `weight`.

### Interazione

- Zoom e pan sul grafo
- Hover: mostra nome, immagine (carte), stats principali
- Click su archetipo: evidenzia le sue carte, mostra pannello dettaglio con il "deck medio" (carte ordinate per peso/frequenza)
- Click su carta: evidenzia gli archetipi che la giocano
- Slider/date picker per filtrare la finestra temporale

### Deployment

Static site deployabile ovunque: GitHub Pages, Netlify, o apertura locale del file HTML. Nessun server richiesto.

## Scope escluso (per ora)

- Archi archetipo-archetipo (condivisione carte tra deck)
- Query dinamiche o esplorazione LLM-assisted
- Scraping automatico dei siti di metagame (verra' implementato come skill dedicata)
- Onboarding e UX polish per utenti esterni
- Carta-carta correlation

## Decisioni di design

| Decisione | Scelta | Motivazione |
|-----------|--------|-------------|
| Formato dati | Markdown + frontmatter YAML | Leggibile, LLM-native, git-friendly, parsabile |
| Metrica similarita' | Jaccard pesata | Robusta, deterministica, pesa di piu' le carte core |
| Dati carte | Scryfall API -> markdown locale | Scryfall come bootstrap, file locale come source of truth |
| Relazioni carte-archetipi | Calcolate, non scritte a mano | Deterministiche, ricalcolabili, derivate dalle liste |
| Web app | HTML/JS statico + D3.js | Nessuna dipendenza server, deployabile ovunque |
| Evoluzione temporale | Liste con timestamp, aggregazione configurabile | Permette di tracciare l'evoluzione del meta |
| Input liste | Manuale, con skill per scraping da creare dopo | Pragmatico: prima capire il processo, poi automatizzare |
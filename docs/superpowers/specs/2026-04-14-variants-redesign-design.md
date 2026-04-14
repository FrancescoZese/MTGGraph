# Variants Overlay Redesign

## Problem

The current Variants view breaks the editorial language of the main app:
- Two sidebars (diff left + lists right) instead of one
- Raw D3 defaults (dashed concentric rings, plain dots)
- Button style inconsistent with the rest of the UI
- Feels like a different app dropped into the overlay

## Design

### Layout

Fullscreen opaque overlay with `var(--bg)` background. Two zones:
- **Center-left**: radial chart (fills available space minus sidebar)
- **Right**: sidebar 380px (`var(--panel-width)`), same aesthetic as the detail panel — `var(--panel-bg)` background, `var(--border)` left border, shadow

### Header

Top-left of the overlay, above the chart:
- Title: archetype name in `var(--font-display)` 26px (matches `panel-name`)
- Subtitle: "N lists — click a cluster" in `var(--font-mono)` 11px, `var(--ink-faint)`
- Close button (X): top-right, same style as detail panel close (`var(--panel-bg)` circle, `var(--ink-faint)`, hover to `var(--ink)`)

### Radial Chart

Same concept: center = average deck, distance from center = divergence, cluster size = number of lists. Visual refinements:

- **Concentric rings**: solid stroke 1px `var(--border)` at 0.2 opacity (not dashed). Labels inside each ring in `var(--font-mono)` 9px `var(--ink-faint)`.
- **Center dot**: `var(--accent)` 8px circle. Label "avg" below in `var(--font-display)` 12px `var(--ink-faint)`.
- **Connecting lines**: from center to each cluster, `var(--border)` 1px at 0.15 opacity (not accent-colored).
- **Cluster dots**: `var(--bg)` fill with mana-colored segmented arc border (same `createManaArc` pattern as archetype nodes in the graph). Size = `8 + sqrt(lists.length) * 6`. List count as label inside in `var(--font-mono)`.
- **Distance label**: below each cluster dot, `var(--font-mono)` 9px `var(--ink-faint)`, showing "Δ{N}" or "exact".
- **Selected state**: stroke-width increases to 3, stroke-opacity to 1 (same visual language as graph highlight).
- **Entrance animation**: GSAP stagger from center outward — `back.out(1.7)`, 0.06s stagger per cluster, 0.15s initial delay.

### Sidebar (right)

Hidden by default. Slides in from right when a cluster is clicked. Single scrollable panel:

**Header section** (with `panel-header` styling):
- "Cluster" in `var(--font-display)` as `panel-name`
- "N lists · ΔM cards" in `var(--font-mono)` as `panel-meta` / `panel-meta-label`
- Bottom border `var(--border)`

**Diff section**:
- `panel-section-title`: "Diff from average"
- Rows in `var(--font-mono)` 12px: `+N CardName` (color `var(--mana-G)`) and `-N CardName` (color `var(--mana-R)`)
- Rows separated by `1px solid rgba(216,210,200,.3)` (matches existing `cluster-diff` border)

**Lists section**:
- `panel-section-title`: "Lists"
- Same `result-row` pattern as detail panel: finish position, pilot name, collapsible decklist
- Card hover shows image tooltip (reuse `wireCardHover`)

**Animation**: slide-in from right via GSAP `power3.out` 0.55s (matches detail panel open). Content staggers in with `animatePanelContent` pattern.

### Trigger (in detail panel)

Remove the `.variants-btn` button. Instead, add "view variants" as a text link inside the existing `panel-meta-label` span:

```
21.8%
of the meta · 153 lists · view variants
```

- "view variants" styled with `color: var(--accent)`, `cursor: pointer`, `text-decoration: none`
- On hover: `text-decoration: underline`
- Only rendered when `lists.length >= 3`

### Mobile

- Overlay remains fullscreen
- Chart resizes to fill viewport above the bottom sheet
- Sidebar becomes a bottom sheet at 55dvh (same as meta-sidebar mobile), with swipe handle and swipe-to-dismiss
- Close button stays top-right

### What to remove

- `#variants-diff-panel` element and all its CSS (left sidebar)
- `#variants-lists-panel` element and all its CSS (right sidebar as separate element)
- `.variants-btn` CSS and button element
- Three-column flex layout in `#variants-overlay`
- Replace with: two-zone layout (chart area + single `#variants-sidebar`)

## Files affected

- `web/index.html` — restructure `#variants-overlay` children, remove old panels, add `#variants-sidebar`
- `web/style.css` — remove old variants panel styles, add new sidebar + chart styles, update mobile breakpoint
- `web/graph.js` — rewrite `openVariantsOverlay`, `renderVariantsChart`, `showClusterDetail`; update `showArchetypeDetail` to use text link trigger; add mana arcs to cluster dots

# Variants Overlay Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Variants overlay to match the editorial aesthetic of the main app — single right sidebar, polished radial chart, text link trigger.

**Architecture:** Replace the current three-column flex layout with a two-zone layout (chart area + right sidebar panel). Reuse existing visual patterns (mana arcs, panel styles, GSAP animations) for consistency. The trigger changes from a standalone button to an inline text link in the detail panel header.

**Tech Stack:** HTML, CSS, vanilla JS, D3.js, GSAP

---

### Task 1: Restructure HTML — remove old panels, add new sidebar

**Files:**
- Modify: `web/index.html:62-70`

- [ ] **Step 1: Replace the variants overlay HTML**

Replace the current `#variants-overlay` block (lines 62-70) with the new two-zone structure:

```html
<div id="variants-overlay">
    <button id="close-variants" aria-label="Close">&times;</button>
    <div id="variants-center">
        <div id="variants-header"></div>
        <div id="variants-chart"></div>
    </div>
    <div id="variants-sidebar">
        <div id="variants-sidebar-content"></div>
    </div>
</div>
```

This removes `#variants-diff-panel` and `#variants-lists-panel`, and replaces them with a single `#variants-sidebar`.

- [ ] **Step 2: Verify the page loads without JS errors**

Run: Open http://localhost:8080/web/index.html in browser, check console for errors.
Expected: No errors. The variants overlay is hidden by default so nothing visual changes yet.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "refactor: restructure variants overlay HTML to two-zone layout"
```

---

### Task 2: Replace CSS — remove old styles, add new layout + sidebar

**Files:**
- Modify: `web/style.css:558-698` (variants section) and mobile section

- [ ] **Step 1: Replace the variants CSS block**

Remove everything from line 558 (`.variants-btn`) through line 698 (`.cluster-diff .minus`) inclusive. Replace with:

```css
/* ---- Variants Trigger (in detail panel) ---- */

.variants-link {
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
    transition: text-decoration .15s;
}

.variants-link:hover {
    text-decoration: underline;
}

/* ---- Variants Overlay ---- */

#variants-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: row;
    visibility: hidden;
    opacity: 0;
}

#close-variants {
    position: absolute;
    top: 12px; right: 16px;
    background: var(--panel-bg);
    border: none;
    color: var(--ink-faint);
    font-size: 28px;
    cursor: pointer;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    z-index: 2;
    transition: background .15s, color .15s;
}
#close-variants:hover { background: var(--bg-warm); color: var(--ink); }

/* Center: header + chart */
#variants-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

#variants-header {
    padding: 20px 32px 0;
    flex-shrink: 0;
}

#variants-header .variants-title {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.15;
}

#variants-header .variants-subtitle {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-faint);
    margin-top: 4px;
}

#variants-chart {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 0;
    padding: 8px;
}

#variants-chart svg {
    max-width: 100%;
    max-height: 100%;
}

/* Right sidebar */
#variants-sidebar {
    width: var(--panel-width);
    flex-shrink: 0;
    background: var(--panel-bg);
    border-left: 1px solid var(--border);
    box-shadow: -8px 0 32px rgba(42,37,32,.06);
    overflow-y: auto;
    padding: 32px 28px;
    transform: translateX(100%);
    visibility: hidden;
    transition: none;
}

#variants-sidebar.active {
    transform: translateX(0);
    visibility: visible;
}

#variants-sidebar::-webkit-scrollbar { width: 4px; }
#variants-sidebar::-webkit-scrollbar-track { background: transparent; }
#variants-sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* Sidebar content — reuses detail panel visual language */
#variants-sidebar .panel-header {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
}

#variants-sidebar .panel-name {
    font-family: var(--font-display);
    font-size: 22px;
    line-height: 1.15;
    margin-bottom: 4px;
}

#variants-sidebar .panel-meta {
    font-family: var(--font-mono);
    font-size: 22px;
    font-weight: 500;
    color: var(--accent);
    letter-spacing: -0.02em;
}

#variants-sidebar .panel-meta-label {
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-faint);
    display: block;
    margin-top: 2px;
}

/* Diff rows */
.cluster-diff {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-light);
    padding: 3px 0;
    border-bottom: 1px solid rgba(216,210,200,.3);
}

.cluster-diff:last-of-type { border-bottom: none; }

.cluster-diff .plus { color: var(--mana-G); }
.cluster-diff .minus { color: var(--mana-R); }
```

- [ ] **Step 2: Add mobile styles for the variants sidebar**

Inside the `@media (max-width: 600px)` block (starts around line 827), add at the end (before the closing `}`):

```css
    /* Variants sidebar as bottom sheet */
    #variants-sidebar {
        position: fixed;
        top: auto;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        height: 55dvh;
        max-height: 55dvh;
        border-left: none;
        border-top: 1px solid var(--border);
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -8px 32px rgba(42,37,32,.1);
        padding: 8px 16px 24px;
        transform: translateY(100%);
    }

    #variants-sidebar.active {
        transform: translateY(0);
    }

    #variants-overlay {
        flex-direction: column;
    }

    #variants-center {
        flex: 1;
    }
```

- [ ] **Step 3: Verify page loads, no visual regressions on main UI**

Run: Reload http://localhost:8080/web/index.html, click an archetype, confirm detail panel looks correct.
Expected: Everything works as before. Variants overlay not yet wired up in JS so that part is non-functional.

- [ ] **Step 4: Commit**

```bash
git add web/style.css
git commit -m "refactor: replace variants CSS with two-zone layout + editorial sidebar"
```

---

### Task 3: Update the trigger — text link instead of button

**Files:**
- Modify: `web/graph.js` — function `showArchetypeDetail` (around line 1392)

- [ ] **Step 1: Replace the variants button with a text link**

In `showArchetypeDetail`, find the block that builds the header HTML (around lines 1405-1414). Replace the variants button and meta label with:

Find this code:
```javascript
    html += `<div class="panel-meta">${(d.meta_share * 100).toFixed(1)}%`;
    html += `<span class="panel-meta-label">of the meta &middot; ${d.list_count} lists</span></div>`;
    html += `</div>`;

    if (lists.length >= 3) {
        html += `<button class="variants-btn" id="open-variants">Variants Map</button>`;
    }
```

Replace with:
```javascript
    html += `<div class="panel-meta">${(d.meta_share * 100).toFixed(1)}%`;
    html += `<span class="panel-meta-label">of the meta &middot; ${d.list_count} lists`;
    if (lists.length >= 3) {
        html += ` &middot; <span class="variants-link" id="open-variants">view variants</span>`;
    }
    html += `</span></div>`;
    html += `</div>`;
```

- [ ] **Step 2: Update the event listener wiring**

In the same function, find the block that wires the variants button (around lines 1446-1449):

```javascript
    const varBtn = document.getElementById("open-variants");
    if (varBtn) {
        varBtn.addEventListener("click", () => openVariantsOverlay(d.name, lists));
    }
```

Replace with:
```javascript
    const varLink = document.getElementById("open-variants");
    if (varLink) {
        varLink.addEventListener("click", (e) => {
            e.stopPropagation();
            openVariantsOverlay(d.name, lists, d.colors);
        });
    }
```

Note: we now pass `d.colors` so the overlay can use mana colors for cluster arcs.

- [ ] **Step 3: Verify the text link renders in the detail panel**

Run: Reload, click an archetype with 3+ lists (e.g., Boros Energy).
Expected: The header shows "21.8% / of the meta · 153 lists · view variants" where "view variants" is in accent color. Hovering underlines it.

- [ ] **Step 4: Commit**

```bash
git add web/graph.js
git commit -m "refactor: replace variants button with inline text link"
```

---

### Task 4: Rewrite the overlay open/close functions

**Files:**
- Modify: `web/graph.js` — functions `openVariantsOverlay`, `closeVariantsOverlay`

- [ ] **Step 1: Update `openVariantsOverlay` to accept colors and reset sidebar**

Find the current `openVariantsOverlay` function (around line 1109). Replace entirely with:

```javascript
function openVariantsOverlay(name, lists, colors) {
    const overlay = document.getElementById("variants-overlay");
    const header = document.getElementById("variants-header");
    const sidebar = document.getElementById("variants-sidebar");

    header.innerHTML = `<div class="variants-title">${name}</div>` +
        `<div class="variants-subtitle">${lists.length} lists — click a cluster</div>`;

    // Reset sidebar
    sidebar.classList.remove("active");
    document.getElementById("variants-sidebar-content").innerHTML = "";

    const dur = highlightDuration();
    overlay.style.visibility = "visible";
    gsap.to(overlay, { opacity: 1, duration: dur ? 0.3 : 0, ease: "power2.out" });

    document.getElementById("close-variants").onclick = closeVariantsOverlay;

    requestAnimationFrame(() => renderVariantsChart(lists, colors || []));
}
```

- [ ] **Step 2: Update `closeVariantsOverlay` to also close sidebar**

Find the current `closeVariantsOverlay` function (around line 1133). Replace entirely with:

```javascript
function closeVariantsOverlay() {
    const overlay = document.getElementById("variants-overlay");
    const sidebar = document.getElementById("variants-sidebar");
    const dur = highlightDuration();
    gsap.to(overlay, {
        opacity: 0, duration: dur ? 0.25 : 0, ease: "power2.in",
        onComplete: () => {
            overlay.style.visibility = "hidden";
            sidebar.classList.remove("active");
        }
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add web/graph.js
git commit -m "refactor: update variants overlay open/close for new layout"
```

---

### Task 5: Rewrite `renderVariantsChart` with editorial polish

**Files:**
- Modify: `web/graph.js` — function `renderVariantsChart`

- [ ] **Step 1: Replace `renderVariantsChart` with polished version**

Find the current `renderVariantsChart` function (around line 1146). Replace entirely with:

```javascript
function renderVariantsChart(lists, colors) {
    const chartContainer = document.getElementById("variants-chart");
    if (!chartContainer || lists.length < 3) return;

    const avgDeck = computeAvgDeck(lists);
    const clusters = clusterLists(lists, 6);

    for (const cl of clusters) {
        cl.distance = deckDistance(cl.mainboard, avgDeck);
        cl.diff = deckDiff(cl.mainboard, avgDeck);
    }

    const maxDist = Math.max(...clusters.map(c => c.distance), 1);

    // Use full available space
    const rect = chartContainer.getBoundingClientRect();
    const w = rect.width || 400;
    const h = rect.height || 400;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(cx, cy) - 50;

    chartContainer.innerHTML = "";
    const svg = d3.select(chartContainer).append("svg")
        .attr("width", w).attr("height", h)
        .attr("viewBox", `0 0 ${w} ${h}`);

    // Concentric rings — solid, subtle
    const ringCount = 3;
    for (let i = ringCount; i >= 1; i--) {
        const r = (i / ringCount) * maxR;
        svg.append("circle")
            .attr("cx", cx).attr("cy", cy).attr("r", r)
            .attr("fill", "none")
            .attr("stroke", "var(--border)")
            .attr("stroke-opacity", 0.2)
            .attr("stroke-width", 1);

        const label = Math.round((i / ringCount) * maxDist);
        svg.append("text")
            .attr("x", cx + 6).attr("y", cy - r + 14)
            .attr("font-family", "var(--font-mono)")
            .attr("font-size", 9)
            .attr("fill", "var(--ink-faint)")
            .attr("opacity", 0.5)
            .text(label + " cards");
    }

    // Center dot + label
    svg.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", 8)
        .attr("fill", "var(--accent)")
        .attr("opacity", 0.7);
    svg.append("text")
        .attr("x", cx).attr("y", cy + 22)
        .attr("text-anchor", "middle")
        .attr("font-family", "var(--font-display)")
        .attr("font-size", 12)
        .attr("fill", "var(--ink-faint)")
        .text("avg");

    // Connecting lines (behind clusters)
    const angleStep = (2 * Math.PI) / Math.max(clusters.length, 1);
    clusters.forEach((cl, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const dist = (cl.distance / maxDist) * maxR;
        svg.append("line")
            .attr("x1", cx).attr("y1", cy)
            .attr("x2", cx + Math.cos(angle) * dist)
            .attr("y2", cy + Math.sin(angle) * dist)
            .attr("stroke", "var(--border)")
            .attr("stroke-opacity", 0.15)
            .attr("stroke-width", 1);
    });

    // Track selected cluster for highlight
    let selectedG = null;

    // Place clusters with mana-colored arcs
    clusters.forEach((cl, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const dist = (cl.distance / maxDist) * maxR;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        const size = 8 + Math.sqrt(cl.lists.length) * 6;

        const g = svg.append("g")
            .attr("cursor", "pointer")
            .attr("transform", `translate(${x},${y})`);

        // Mana-colored arc border (reuse pattern from graph archetype nodes)
        const clColors = colors.length > 0 ? colors : [];
        const strokeW = 3;

        if (clColors.length === 0) {
            g.append("circle")
                .attr("r", size)
                .attr("fill", "var(--bg)")
                .attr("stroke", "#a09888")
                .attr("stroke-width", strokeW)
                .attr("stroke-opacity", 0.5)
                .attr("class", "cluster-ring");
        } else if (clColors.length === 1) {
            g.append("circle")
                .attr("r", size)
                .attr("fill", "var(--bg)")
                .attr("stroke", MANA_HEX[clColors[0]] || "#a09888")
                .attr("stroke-width", strokeW)
                .attr("stroke-opacity", 0.7)
                .attr("class", "cluster-ring");
        } else {
            g.append("circle")
                .attr("r", size)
                .attr("fill", "var(--bg)")
                .attr("stroke", "none");

            const segAngle = (2 * Math.PI) / clColors.length;
            const gap = 0.08;
            clColors.forEach((c, ci) => {
                const startA = ci * segAngle - Math.PI / 2 + gap / 2;
                const endA = (ci + 1) * segAngle - Math.PI / 2 - gap / 2;
                const x1 = Math.cos(startA) * size;
                const y1 = Math.sin(startA) * size;
                const x2 = Math.cos(endA) * size;
                const y2 = Math.sin(endA) * size;
                const largeArc = segAngle - gap > Math.PI ? 1 : 0;
                g.append("path")
                    .attr("d", `M ${x1} ${y1} A ${size} ${size} 0 ${largeArc} 1 ${x2} ${y2}`)
                    .attr("fill", "none")
                    .attr("stroke", MANA_HEX[c] || "#a09888")
                    .attr("stroke-width", strokeW)
                    .attr("stroke-linecap", "round")
                    .attr("stroke-opacity", 0.75)
                    .attr("class", "cluster-ring");
            });
        }

        // Count label
        g.append("text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-family", "var(--font-mono)")
            .attr("font-size", Math.max(11, Math.min(14, size - 2)))
            .attr("font-weight", 600)
            .attr("fill", "var(--ink)")
            .text(cl.lists.length);

        // Distance label
        g.append("text")
            .attr("y", size + 14)
            .attr("text-anchor", "middle")
            .attr("font-family", "var(--font-mono)")
            .attr("font-size", 9)
            .attr("fill", "var(--ink-faint)")
            .text(cl.distance === 0 ? "exact" : "\u0394" + cl.distance);

        // Click: show cluster detail in sidebar
        g.on("click", () => {
            // Deselect previous
            if (selectedG) {
                selectedG.selectAll(".cluster-ring")
                    .attr("stroke-width", strokeW)
                    .attr("stroke-opacity", function() {
                        return this.tagName === "path" ? 0.75 : (clColors.length === 0 ? 0.5 : 0.7);
                    });
            }
            selectedG = g;
            g.selectAll(".cluster-ring")
                .attr("stroke-width", strokeW + 1.5)
                .attr("stroke-opacity", 1);

            showClusterDetail(cl, avgDeck);
        });

        // Entrance animation
        if (highlightDuration()) {
            g.attr("opacity", 0);
            gsap.fromTo(g.node(),
                { opacity: 0, scale: 0, transformOrigin: "center center" },
                { opacity: 1, scale: 1, duration: 0.4, delay: 0.15 + i * 0.06, ease: "back.out(1.7)" }
            );
        }
    });
}
```

- [ ] **Step 2: Verify the chart renders**

Run: Reload, click Boros Energy (or any archetype with 3+ lists), click "view variants".
Expected: Overlay opens. Chart shows with solid concentric rings, mana-colored cluster dots, "avg" center label. No dashed lines.

- [ ] **Step 3: Commit**

```bash
git add web/graph.js
git commit -m "feat: polished radial chart with mana-colored cluster arcs"
```

---

### Task 6: Rewrite `showClusterDetail` for the unified sidebar

**Files:**
- Modify: `web/graph.js` — function `showClusterDetail`

- [ ] **Step 1: Replace `showClusterDetail` to target the single sidebar**

Find the current `showClusterDetail` function (around line 1284). Replace entirely with:

```javascript
function showClusterDetail(cluster, avgDeck) {
    const sidebar = document.getElementById("variants-sidebar");
    const content = document.getElementById("variants-sidebar-content");

    let html = "";

    // Header
    html += `<div class="panel-header">`;
    html += `<div class="panel-name">Cluster</div>`;
    html += `<div class="panel-meta">${cluster.lists.length}`;
    html += `<span class="panel-meta-label">${cluster.lists.length === 1 ? "list" : "lists"} &middot; &Delta;${cluster.distance} cards</span></div>`;
    html += `</div>`;

    // Diff section
    if (cluster.diff.length > 0) {
        html += `<div class="panel-section-title">Diff from average</div>`;
        for (const d of cluster.diff) {
            const cls = d.delta > 0 ? "plus" : "minus";
            const sign = d.delta > 0 ? "+" : "";
            html += `<div class="cluster-diff"><span class="${cls}">${sign}${d.delta}</span> ${d.card}</div>`;
        }
    } else {
        html += `<div class="panel-section-title">Exact match with average</div>`;
    }

    // Lists section
    html += `<div class="panel-section-title" style="margin-top:24px">Lists</div>`;
    html += `<ul class="results-list">`;

    const baseIdx = clusterDeckIdx;
    clusterDeckIdx += cluster.lists.length;

    for (let i = 0; i < cluster.lists.length; i++) {
        const l = cluster.lists[i];
        const idx = baseIdx + i;
        html += `<li class="result-row" data-idx="${idx}">`;
        html += `<div class="result-header">`;
        html += `<span class="result-finish">${l.finish}</span>`;
        html += `<span class="result-pilot">${l.pilot}</span>`;
        html += `<span class="result-meta">${l.date}</span>`;
        html += `<span class="result-toggle">+</span>`;
        html += `</div>`;
        html += `<div class="result-decklist hidden" id="decklist-${idx}">`;
        html += `<div class="result-section">Mainboard</div>`;
        const mainEntries = Object.entries(l.mainboard).sort((a, b) => b[1] - a[1]);
        for (const [name, qty] of mainEntries) {
            html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
        }
        if (l.sideboard && Object.keys(l.sideboard).length > 0) {
            html += `<div class="result-section">Sideboard</div>`;
            const sideEntries = Object.entries(l.sideboard).sort((a, b) => b[1] - a[1]);
            for (const [name, qty] of sideEntries) {
                html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
            }
        }
        html += `</div></li>`;
    }
    html += `</ul>`;

    content.innerHTML = html;

    // Wire up collapsible toggles + card hover
    content.querySelectorAll(".result-row").forEach(row => {
        let hoverWired = false;
        row.querySelector(".result-header").addEventListener("click", () => {
            const dl = document.getElementById(`decklist-${row.dataset.idx}`);
            const toggle = row.querySelector(".result-toggle");
            dl.classList.toggle("hidden");
            toggle.textContent = dl.classList.contains("hidden") ? "+" : "\u2212";
            if (!dl.classList.contains("hidden") && !hoverWired) {
                wireCardHover(dl);
                hoverWired = true;
            }
        });
    });

    // Show sidebar with animation
    sidebar.scrollTop = 0;
    const dur = highlightDuration();
    if (!sidebar.classList.contains("active")) {
        sidebar.classList.add("active");
        if (dur) {
            gsap.fromTo(sidebar,
                { x: isMobile() ? 0 : 40, autoAlpha: 0 },
                { x: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out" }
            );
        }
    }

    // Animate content in
    if (dur) {
        const header = content.querySelector(".panel-header");
        const titles = content.querySelectorAll(".panel-section-title");
        const rows = content.querySelectorAll(".cluster-diff, .result-row");
        const tl = gsap.timeline();
        if (header) tl.from(header, { y: 14, autoAlpha: 0, duration: 0.35, ease: "power2.out" }, 0);
        if (titles.length) tl.from(titles, { x: -10, autoAlpha: 0, duration: 0.3, stagger: 0.06, ease: "power2.out" }, 0.12);
        if (rows.length) tl.from(rows, { x: -14, autoAlpha: 0, duration: 0.3, stagger: 0.03, ease: "power2.out" }, 0.2);
    }
}
```

- [ ] **Step 2: Verify clicking a cluster opens the sidebar**

Run: Reload, open variants for any archetype, click a cluster dot.
Expected: Right sidebar slides in with header ("Cluster / N lists · ΔM cards"), diff rows, then collapsible lists below. Clicking a different cluster updates the sidebar content.

- [ ] **Step 3: Verify card hover tooltips work in variants sidebar**

Run: In the variants sidebar, expand a list, hover over a card name.
Expected: Card image tooltip appears.

- [ ] **Step 4: Commit**

```bash
git add web/graph.js
git commit -m "feat: unified variants sidebar with diff + lists"
```

---

### Task 7: Final cleanup — remove dead code and verify end-to-end

**Files:**
- Modify: `web/graph.js` — remove any leftover references

- [ ] **Step 1: Search for and remove dead references**

Search `graph.js` for any remaining references to `variants-diff-panel`, `variants-lists-panel`, or `variants-btn`. Remove them if found. These are the old element IDs that no longer exist in the HTML.

- [ ] **Step 2: End-to-end test — desktop**

Run: Reload http://localhost:8080/web/index.html

Test flow:
1. Click Boros Energy in sidebar → detail panel opens
2. Header shows "21.8% / of the meta · 153 lists · view variants"
3. Click "view variants" → fullscreen overlay opens
4. Chart shows: solid concentric rings, mana-colored cluster dots, "avg" center, no dashed lines
5. Click a cluster → right sidebar slides in with diff + lists
6. Click a different cluster → sidebar updates
7. Expand a list → card hover shows image tooltip
8. Click X → overlay closes cleanly
9. Click an archetype with < 3 lists → "view variants" link does NOT appear

Expected: All steps pass.

- [ ] **Step 3: End-to-end test — mobile**

Run: Open Chrome DevTools, toggle device toolbar (responsive mode), set to iPhone 14 Pro (390px).

Test flow:
1. Open an archetype via meta sidebar
2. "view variants" link visible in header
3. Click it → overlay opens fullscreen
4. Chart renders smaller, centered
5. Click a cluster → sidebar appears as bottom sheet
6. Close overlay → clean exit

Expected: All steps pass.

- [ ] **Step 4: Commit**

```bash
git add web/graph.js web/style.css web/index.html
git commit -m "cleanup: remove dead variants code, verify end-to-end"
```

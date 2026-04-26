gsap.registerPlugin(Flip);

const DATA_PATH = "../computed/graph.json";

function isMobile() { return window.innerWidth <= 600; }

let allData = null;
let simulation = null;
let currentZoom = null; // d3 zoom behavior
let currentSvg = null; // d3 svg selection
let cardImageMap = {}; // card name -> image URL
let cardTypeMap = {};  // card name -> type line
let cardColorMap = {}; // card name -> colors array
let currentCardSel, currentArchSel, currentLinkSel, currentValidEdges, currentNodeMap;
let isHighlighted = false;
let metaThreshold = 0.01; // 1% default — derived from thresholdIndex
let rogueMode = false;
let thresholdIndex = -1; // -1 = not yet initialized, set on first sidebar build
let sidebarArchs = []; // cached sorted archetype list for index<->threshold mapping
let lastFilteredData = null; // cache for sidebar rebuild without full refilter

/* ── Colors ── */

const MANA_HEX = {
    W: "#c8b878", U: "#2b7cba", B: "#49433d",
    R: "#d44a2a", G: "#2d8a4e",
};

function cardDotColor(colors) {
    if (!colors || colors.length === 0) return "#b8b0a4";
    if (colors.length > 1) return "#b89a4a";
    return { W: "#c8b878", U: "#6a9ec0", B: "#807478", R: "#d07858", G: "#78a87a" }[colors[0]] || "#b8b0a4";
}

/* ── Sizing ── */

function archRadius(d) { return 10 + Math.sqrt(d.meta_share) * 55; }
function cardRadius(d) { return 1.8 + d.meta_presence * 10; }

/* ── Init ── */

async function init() {
    const resp = await fetch(DATA_PATH);
    allData = await resp.json();
    // Build card name -> image and card name -> type lookups
    allData.nodes.forEach(n => {
        if (n.type === "card") {
            if (n.image) cardImageMap[n.name] = n.image;
            if (n.card_type) cardTypeMap[n.name] = n.card_type;
            cardColorMap[n.name] = n.colors || [];
        }
    });

    // Initial render with filters applied
    applyAllFilters(false);

    document.getElementById("close-panel").addEventListener("click", (e) => {
        e.stopPropagation();
        closePanel();
    });

    document.getElementById("filter-challenge").addEventListener("change", () => applyAllFilters(true));
    document.getElementById("filter-league").addEventListener("change", () => applyAllFilters(true));

    // Sidebar tabs + mobile bottom sheet
    initSidebarTabs();
    initMobileSheet();
}

/* ── Unified filter: rebuilds graph from scratch ── */

function applyAllFilters(skipAnimation) {
    const showChallenge = document.getElementById("filter-challenge").checked;
    const showLeague = document.getElementById("filter-league").checked;
    const minMeta = metaThreshold;

    // Deep copy and filter by source type
    const filtered = JSON.parse(JSON.stringify(allData));

    for (const node of filtered.nodes) {
        if (node.type !== "archetype" || !node.lists) continue;
        node.lists = node.lists.filter(l => {
            const src = l.source || "";
            if (src.includes("Challenge") && !showChallenge) return false;
            if (src.includes("League") && !showLeague) return false;
            return true;
        });
        node.list_count = node.lists.length;
    }

    // Recalculate meta_share
    const totalLists = filtered.nodes
        .filter(n => n.type === "archetype")
        .reduce((s, n) => s + n.list_count, 0);

    for (const node of filtered.nodes) {
        if (node.type === "archetype") {
            node.meta_share = totalLists > 0 ? node.list_count / totalLists : 0;
        }
    }

    // Save source-filtered data (before meta threshold) for sidebar
    lastFilteredData = JSON.parse(JSON.stringify(filtered));

    // Filter by meta threshold + remove empty archetypes
    const activeArchIds = new Set(
        filtered.nodes
            .filter(n => n.type === "archetype" && n.list_count > 0 &&
                (rogueMode ? n.meta_share < 0.01 : n.meta_share >= minMeta))
            .map(n => n.id)
    );
    const activeCardIds = new Set();
    for (const e of filtered.edges) {
        if (activeArchIds.has(e.target)) activeCardIds.add(e.source);
    }
    filtered.nodes = filtered.nodes.filter(n =>
        (n.type === "archetype" && activeArchIds.has(n.id)) ||
        (n.type === "card" && activeCardIds.has(n.id))
    );
    filtered.edges = filtered.edges.filter(e =>
        activeArchIds.has(e.target) && activeCardIds.has(e.source)
    );

    updateStats(filtered);
    updateMetaSidebar(lastFilteredData);
    updateCardsSidebar(lastFilteredData);
    updatePlayersSidebar(lastFilteredData);
    renderGraph(filtered, skipAnimation);
}

function updateMetaSidebar(data) {
    sidebarArchs = data.nodes
        .filter(n => n.type === "archetype" && n.list_count > 0)
        .sort((a, b) => b.meta_share - a.meta_share);

    const maxShare = sidebarArchs.length > 0 ? sidebarArchs[0].meta_share : 1;
    const container = document.getElementById("meta-sidebar-list");

    // Initialize thresholdIndex on first load based on metaThreshold value
    if (thresholdIndex === -1) {
        thresholdIndex = sidebarArchs.length; // default: show all
        for (let i = 0; i < sidebarArchs.length; i++) {
            if (sidebarArchs[i].meta_share < metaThreshold) {
                thresholdIndex = i;
                break;
            }
        }
    }
    // Clamp
    thresholdIndex = Math.max(0, Math.min(thresholdIndex, sidebarArchs.length));

    // Build DOM
    let html = "";
    for (let i = 0; i < sidebarArchs.length; i++) {
        const arch = sidebarArchs[i];
        const pct = (arch.meta_share * 100).toFixed(1);
        const barScale = (arch.meta_share / maxShare).toFixed(4);
        const dimmed = rogueMode ? (arch.meta_share >= 0.01) : (i >= thresholdIndex);

        html += `<div class="meta-row${dimmed ? " dimmed" : ""}" data-arch-id="${arch.id}" data-row-index="${i}">`;
        html += `<div class="meta-row-bar" data-scale="${barScale}"></div>`;
        const pips = (arch.colors || []).map(c =>
            `<img class="meta-mana" src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}">`
        ).join("");
        html += `<span class="meta-row-name">${arch.name}</span>`;
        html += `<span class="meta-row-mana">${pips}</span>`;
        html += `<span class="meta-row-pct">${pct}%</span>`;
        html += `</div>`;
    }
    container.innerHTML = html;

    animateBars(container.querySelectorAll(".meta-row-bar"));
    buildMobileFilterChips();

    container.querySelectorAll(".meta-row").forEach(row => {
        row.addEventListener("click", () => {
            const archId = row.dataset.archId;
            const archNode = data.nodes.find(n => n.id === archId);
            if (archNode) {
                if (sheetOpen) closeMobileSheet();
                removeVariantsPill();
                isHighlighted = false;
                const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
                const edges = data.edges;
                showArchetypeDetail(archNode, edges, nodeMap);
                if (currentCardSel && currentArchSel && currentLinkSel && currentValidEdges) {
                    // Use the D3 simulation node for highlight + pill positioning
                    const simNode = currentNodeMap ? currentNodeMap.get(archId) : null;
                    const hNode = simNode || archNode;
                    highlight(hNode, currentValidEdges, currentCardSel, currentArchSel, currentLinkSel);
                    showVariantsPill(hNode);
                }
            }
        });
    });
}

function updateCardsSidebar(data) {
    const cards = data.nodes
        .filter(n => n.type === "card" && n.meta_presence > 0)
        .sort((a, b) => b.meta_presence - a.meta_presence);

    const maxPresence = cards.length > 0 ? cards[0].meta_presence : 1;
    const container = document.getElementById("meta-sidebar-cards");

    let html = "";
    for (const card of cards) {
        const pct = (card.meta_presence * 100).toFixed(1);
        const barScale = (card.meta_presence / maxPresence).toFixed(4);
        const barColor = card.colors && card.colors.length === 1
            ? `var(--mana-${card.colors[0]})`
            : card.colors && card.colors.length > 1
            ? "var(--mana-multi)"
            : "var(--mana-colorless)";

        html += `<div class="meta-row" data-card-id="${card.id}">`;
        html += `<div class="meta-row-bar" data-scale="${barScale}" style="background:${barColor}"></div>`;
        html += `<span class="meta-row-name">${card.name}</span>`;
        html += `<span class="meta-row-pct">${pct}%</span>`;
        html += `</div>`;
    }
    container.innerHTML = html;

    animateBars(container.querySelectorAll(".meta-row-bar"));

    container.querySelectorAll(".meta-row").forEach(row => {
        row.addEventListener("click", () => {
            const cardId = row.dataset.cardId;
            const cardNode = data.nodes.find(n => n.id === cardId);
            if (cardNode) {
                if (sheetOpen) closeMobileSheet();
                removeVariantsPill();
                isHighlighted = false;
                const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
                const edges = data.edges;
                showCardDetail(cardNode, edges, nodeMap);
                if (currentCardSel && currentArchSel && currentLinkSel && currentValidEdges) {
                    const simNode = currentNodeMap ? currentNodeMap.get(cardId) : null;
                    highlight(simNode || cardNode, currentValidEdges, currentCardSel, currentArchSel, currentLinkSel);
                }
            }
        });
    });
}

function updatePlayersSidebar(data) {
    // Count lists per pilot across all archetypes
    const pilotCounts = {};
    const pilotArchs = {}; // pilot -> {arch: count}
    for (const node of data.nodes) {
        if (node.type !== "archetype" || !node.lists) continue;
        for (const list of node.lists) {
            const pilot = list.pilot || "Unknown";
            pilotCounts[pilot] = (pilotCounts[pilot] || 0) + 1;
            if (!pilotArchs[pilot]) pilotArchs[pilot] = {};
            const archName = node.name;
            pilotArchs[pilot][archName] = (pilotArchs[pilot][archName] || 0) + 1;
        }
    }

    const players = Object.entries(pilotCounts)
        .map(([name, count]) => ({ name, count, archs: pilotArchs[name] }))
        .sort((a, b) => b.count - a.count);

    const maxCount = players.length > 0 ? players[0].count : 1;
    const container = document.getElementById("meta-sidebar-players");

    let html = "";
    for (const player of players) {
        const barScale = (player.count / maxCount).toFixed(4);
        html += `<div class="meta-row" data-player="${player.name}">`;
        html += `<div class="meta-row-bar" data-scale="${barScale}"></div>`;
        html += `<span class="meta-row-name">${player.name}</span>`;
        html += `<span class="meta-row-pct">${player.count}</span>`;
        html += `</div>`;
    }
    container.innerHTML = html;

    animateBars(container.querySelectorAll(".meta-row-bar"));

    container.querySelectorAll(".meta-row").forEach(row => {
        row.addEventListener("click", () => {
            const pilot = row.dataset.player;
            if (sheetOpen) closeMobileSheet();
            removeVariantsPill();
            isHighlighted = false;

            // Find archetype IDs that contain lists by this pilot
            const archIds = new Set();
            if (lastFilteredData) {
                for (const node of lastFilteredData.nodes) {
                    if (node.type !== "archetype" || !node.lists) continue;
                    for (const list of node.lists) {
                        if (list.pilot === pilot) {
                            archIds.add(node.id);
                            break;
                        }
                    }
                }
            }

            if (!archIds.size || !currentCardSel || !currentArchSel || !currentLinkSel) return;

            // Highlight: show connected archetypes + their cards, dim everything else
            const connCards = new Set();
            if (currentValidEdges) {
                for (const e of currentValidEdges) {
                    const t = typeof e.target === "object" ? e.target.id : e.target;
                    const s = typeof e.source === "object" ? e.source.id : e.source;
                    if (archIds.has(t)) connCards.add(s);
                }
            }

            const dur = highlightDuration();
            currentArchSel.each(function(n) {
                gsap.to(this, { attr: { opacity: archIds.has(n.id) ? 1 : 0.1 }, duration: dur, overwrite: true });
            });
            currentCardSel.each(function(n) {
                gsap.to(this, { attr: { opacity: connCards.has(n.id) ? 0.85 : 0.06 }, duration: dur, overwrite: true });
            });
            currentLinkSel.each(function(e) {
                const t = typeof e.target === "object" ? e.target.id : e.target;
                const s = typeof e.source === "object" ? e.source.id : e.source;
                const active = archIds.has(t) && connCards.has(s);
                gsap.to(this, { attr: { "stroke-opacity": active ? 0.5 : 0.01 }, duration: dur, overwrite: true });
            });
            isHighlighted = true;

            // Open detail panel with player's lists
            showPlayerDetail(pilot, lastFilteredData);
        });
    });
}

/* ── Sidebar tab switching ── */

function initSidebarTabs() {
    const panels = {
        archetypes: document.getElementById("meta-sidebar-list"),
        cards: document.getElementById("meta-sidebar-cards"),
        players: document.getElementById("meta-sidebar-players"),
    };

    document.querySelectorAll(".meta-sidebar-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".meta-sidebar-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            const target = tab.dataset.tab;
            for (const [key, el] of Object.entries(panels)) {
                el.classList.toggle("hidden", key !== target);
            }
        });
    });
}

function thresholdLabel() {
    if (thresholdIndex >= sidebarArchs.length || thresholdIndex === 0) return "all";
    const pct = (sidebarArchs[thresholdIndex - 1].meta_share * 100).toFixed(1);
    return "\u2265 " + pct + "%";
}

function buildThresholdLineHTML() {
    const label = thresholdLabel();
    return `<div class="meta-threshold-line" id="threshold-line">` +
        `<span class="meta-threshold-arrows">\u2195</span>` +
        `<span class="meta-threshold-cta">drag to filter</span>` +
        `<span class="meta-threshold-value">${label}</span>` +
        `</div>`;
}

function initThresholdDrag(container) {
    const line = container.querySelector("#threshold-line");
    if (!line) return;
    const sidebar = document.getElementById("meta-sidebar");

    let dragging = false;
    let scrollRAF = null;
    let lastClientY = 0;

    function autoScroll(clientY) {
        const rect = sidebar.getBoundingClientRect();
        const EDGE = 40, SPEED = 5;
        let delta = 0;
        if (clientY > rect.bottom - EDGE)
            delta = SPEED * Math.min(1, (clientY - (rect.bottom - EDGE)) / EDGE);
        else if (clientY < rect.top + EDGE)
            delta = -SPEED * Math.min(1, ((rect.top + EDGE) - clientY) / EDGE);

        if (delta !== 0) {
            sidebar.scrollTop += delta;
            if (!scrollRAF) {
                scrollRAF = requestAnimationFrame(() => {
                    scrollRAF = null;
                    if (dragging) {
                        autoScroll(lastClientY);
                        updatePosition(lastClientY);
                    }
                });
            }
        }
    }

    function updatePosition(clientY) {
        // Read row positions live — no cache, always accurate
        const rows = container.querySelectorAll(".meta-row");
        let newIndex = sidebarArchs.length;
        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                newIndex = parseInt(row.dataset.rowIndex);
                break;
            }
        }

        if (newIndex === thresholdIndex) return;
        thresholdIndex = newIndex;

        // Derive metaThreshold from index
        metaThreshold = thresholdIndex >= sidebarArchs.length
            ? 0
            : sidebarArchs[thresholdIndex].meta_share + 0.0001;

        // Update label
        line.querySelector(".meta-threshold-value").textContent = thresholdLabel();

        // Toggle dimmed
        for (const row of rows) {
            row.classList.toggle("dimmed", parseInt(row.dataset.rowIndex) >= thresholdIndex);
        }

        // Move line in flow — only fires when threshold actually changes
        const firstDimmed = Array.from(rows).find(r => parseInt(r.dataset.rowIndex) >= thresholdIndex);
        if (firstDimmed) container.insertBefore(line, firstDimmed);
        else container.appendChild(line);
    }

    function onPointerDown(e) {
        e.preventDefault();
        dragging = true;
        lastClientY = e.clientY;
        line.classList.add("dragging");
        line.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
        if (!dragging) return;
        lastClientY = e.clientY;
        autoScroll(e.clientY);
        updatePosition(e.clientY);
    }

    function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        line.classList.remove("dragging");
        if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
        applyAllFilters(true);
    }

    line.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
}

function buildMobileFilterChips() {
    const container = document.getElementById("mobile-filter-chips");
    if (!container || !sidebarArchs.length) return;

    const idx1 = sidebarArchs.findIndex(a => a.meta_share < 0.01);
    const idxRogue = sidebarArchs.findIndex(a => a.meta_share < 0.01);

    const presets = [
        { label: "All", index: sidebarArchs.length },
    ];
    if (idx1 > 0 && idx1 < sidebarArchs.length) {
        presets.push({ label: "> 1%", index: idx1 });
    }
    if (idxRogue > 0 && idxRogue < sidebarArchs.length) {
        presets.push({ label: "Rogue", index: idxRogue, rogue: true });
    }

    container.innerHTML = presets.map(p =>
        `<button class="filter-chip${!rogueMode && p.index === thresholdIndex && !p.rogue ? " active" : ""}${rogueMode && p.rogue ? " active" : ""}" data-idx="${p.index}" ${p.rogue ? 'data-rogue="1"' : ""}>${p.label}</button>`
    ).join("");

    container.querySelectorAll(".filter-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const isRogue = chip.dataset.rogue === "1";
            const idx = parseInt(chip.dataset.idx);

            if (isRogue) {
                rogueMode = true;
                metaThreshold = 0;
                thresholdIndex = sidebarArchs.length;
            } else {
                rogueMode = false;
                thresholdIndex = idx;
                metaThreshold = idx >= sidebarArchs.length
                    ? 0
                    : sidebarArchs[idx].meta_share + 0.0001;
            }

            // Update active chip
            container.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");

            // Update dimming in sidebar list
            document.querySelectorAll("#meta-sidebar-list .meta-row").forEach(row => {
                const ri = parseInt(row.dataset.rowIndex);
                if (isRogue) {
                    row.classList.toggle("dimmed", ri < idx);
                } else {
                    row.classList.toggle("dimmed", ri >= thresholdIndex);
                }
            });

            applyAllFilters(true);
        });
    });
}


function updateStats(data) {
    const archs = data.nodes.filter(n => n.type === "archetype");
    const cards = data.nodes.filter(n => n.type === "card");
    const lists = archs.reduce((s, a) => s + a.list_count, 0);
    document.getElementById("stat-archetypes").textContent = archs.length;
    document.getElementById("stat-cards").textContent = cards.length;
    document.getElementById("stat-lists").textContent = lists;
    const from = data.time_range.from || "?";
    const to = data.time_range.to || "?";
    const period = from === to ? from : `${from.slice(5)} — ${to.slice(5)}`;
    document.getElementById("stat-period").textContent = period;

    // Mobile stats strip
    const mobileStats = document.getElementById("mobile-stats");
    if (mobileStats) {
        mobileStats.innerHTML =
            `<span>${archs.length} archetypes</span>` +
            `<span>${cards.length} cards</span>` +
            `<span>${lists} lists</span>`;
    }
}

/* ── Mana-colored arc border ── */

function createManaArc(parentG, d) {
    const r = archRadius(d);
    const colors = d.colors && d.colors.length > 0 ? d.colors : [];
    const strokeW = Math.max(3.5, 3 + d.meta_share * 10);

    if (colors.length === 0) {
        // Colorless: simple gray circle
        parentG.append("circle")
            .attr("r", r)
            .attr("fill", "var(--bg, #f4f1eb)")
            .attr("stroke", "#a09888")
            .attr("stroke-width", strokeW)
            .attr("stroke-opacity", 0.5);
        return;
    }

    // Background fill
    parentG.append("circle")
        .attr("r", r)
        .attr("fill", "var(--bg, #f4f1eb)")
        .attr("stroke", "none");

    if (colors.length === 1) {
        // Mono color: full ring
        parentG.append("circle")
            .attr("r", r)
            .attr("fill", "none")
            .attr("stroke", MANA_HEX[colors[0]] || "#a09888")
            .attr("stroke-width", strokeW)
            .attr("stroke-opacity", 0.7);
        return;
    }

    // Multi-color: segmented arc border
    const segAngle = (2 * Math.PI) / colors.length;
    const gap = 0.08; // small gap between segments

    colors.forEach((c, i) => {
        const startAngle = i * segAngle - Math.PI / 2 + gap / 2;
        const endAngle = (i + 1) * segAngle - Math.PI / 2 - gap / 2;

        const x1 = Math.cos(startAngle) * r;
        const y1 = Math.sin(startAngle) * r;
        const x2 = Math.cos(endAngle) * r;
        const y2 = Math.sin(endAngle) * r;

        const largeArc = segAngle - gap > Math.PI ? 1 : 0;

        parentG.append("path")
            .attr("d", `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`)
            .attr("fill", "none")
            .attr("stroke", MANA_HEX[c] || "#a09888")
            .attr("stroke-width", strokeW)
            .attr("stroke-linecap", "round")
            .attr("stroke-opacity", 0.75);
    });
}

/* ── Render ── */

function renderGraph(data, skipAnimation) {
    const svg = d3.select("#graph");
    svg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight;

    svg.attr("viewBox", [0, 0, width, height]);

    const g = svg.append("g");

    currentZoom = d3.zoom()
        .scaleExtent([0.15, 6])
        .on("zoom", e => g.attr("transform", e.transform));
    svg.call(currentZoom);
    currentSvg = svg;

    const nodes = data.nodes.map(n => ({ ...n }));
    const edges = data.edges.map(e => ({ ...e }));

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const validEdges = edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));

    // ── Progressive build: add nodes/edges over time ──

    const archData = nodes.filter(n => n.type === "archetype")
        .sort((a, b) => b.meta_share - a.meta_share);
    const cardData = nodes.filter(n => n.type === "card");

    // Build addition schedule: archetype, then its cards, then next archetype...
    const schedule = [];
    const addedCardIds = new Set();

    for (const arch of archData) {
        schedule.push({ type: "arch", node: arch });
        // Find cards connected to this archetype, sorted by weight
        const archEdges = validEdges
            .filter(e => e.target === arch.id)
            .sort((a, b) => b.weight - a.weight);
        for (const edge of archEdges) {
            if (!addedCardIds.has(edge.source)) {
                const cardNode = nodeMap.get(edge.source);
                if (cardNode) {
                    schedule.push({ type: "card", node: cardNode });
                    addedCardIds.add(edge.source);
                }
            }
        }
    }

    // Active data arrays that grow over time
    const activeNodes = [];
    const activeEdges = [];
    const activeNodeIds = new Set();

    // SVG groups
    const linkG = g.append("g");
    const cardG = g.append("g");
    const archG = g.append("g");

    simulation = d3.forceSimulation(activeNodes)
        .alphaDecay(skipAnimation ? 0.03 : 0.012)
        .velocityDecay(0.35)
        .force("link", d3.forceLink(activeEdges).id(d => d.id)
            .distance(d => 25 + (1 - d.weight) * 25)
            .strength(d => d.weight * 0.35))
        .force("charge", d3.forceManyBody()
            .strength(d => d.type === "archetype" ? -400 : -8))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide()
            .radius(d => d.type === "archetype" ? archRadius(d) + 3 : cardRadius(d) + 0.5)
            .strength(0.9));

    // Store for filter
    currentEdges = validEdges;
    currentNodeMap = nodeMap;

    // Rebuild selections when data changes
    let cardSel, archSel, link;

    function rebuildSelections() {
        // Edges
        link = linkG.selectAll("line").data(activeEdges, d => d.source.id + "-" + d.target.id);
        link.exit().remove();
        link = link.enter().append("line")
            .attr("stroke", "#c8c0b4")
            .attr("stroke-opacity", d => 0.05 + d.weight * 0.1)
            .attr("stroke-width", d => 0.3 + d.weight * 1)
            .merge(link);

        // Cards
        cardSel = cardG.selectAll("circle").data(
            activeNodes.filter(n => n.type === "card"), d => d.id
        );
        cardSel.exit().remove();
        cardSel = cardSel.enter().append("circle")
            .attr("r", 0)
            .attr("fill", d => cardDotColor(d.colors))
            .attr("opacity", 0.85)
            .attr("stroke", "none")
            .attr("cursor", "pointer")
            .call(makeDraggable())
            .transition().duration(highlightDuration() ? 400 : 0).attr("r", d => cardRadius(d))
            .selection()
            .merge(cardSel);

        // Archetypes
        archSel = archG.selectAll("g.arch-node").data(
            activeNodes.filter(n => n.type === "archetype"), d => d.id
        );
        archSel.exit().remove();
        const archEnter = archSel.enter().append("g")
            .attr("class", "arch-node")
            .attr("cursor", "pointer")
            .attr("opacity", 0)
            .call(makeDraggable());
        archEnter.each(function(d) { createManaArc(d3.select(this), d); });
        archEnter.append("text")
            .text(d => d.name)
            .attr("font-family", "'Instrument Serif', Georgia, serif")
            .attr("font-size", d => Math.max(10, 9 + d.meta_share * 12))
            .attr("fill", "#6b6560")
            .attr("text-anchor", "middle")
            .attr("dy", d => archRadius(d) + 14)
            .attr("pointer-events", "none");
        archEnter.transition().duration(highlightDuration() ? 500 : 0).attr("opacity", 1);
        archSel = archEnter.merge(archSel);

        // Update event handlers
        cardSel
            .on("mouseover", (event, d) => {
                if (isMobile()) return;
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_presence * 100).toFixed(1)}% presence</div>`;
                if (d.image) html += `<img src="${d.image}" alt="${d.name}">`;
                tooltip.innerHTML = html;
                showTooltipEl();
            })
            .on("mousemove", (event) => { if (!isMobile()) moveTooltip(event); })
            .on("mouseout", () => { if (!isMobile()) hideTooltip(); })
            .on("click", (event, d) => {
                event.stopPropagation();
                if (isHighlighted) { resetHighlight(); return; }
                showCardDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
                if (isMobile()) centerOnConnected(d, validEdges);
            });

        archSel
            .on("mouseover", (event, d) => {
                if (isMobile()) return;
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_share * 100).toFixed(1)}% &middot; ${d.list_count} lists</div>`;
                tooltip.innerHTML = html;
                showTooltipEl();
            })
            .on("mousemove", (event) => { if (!isMobile()) moveTooltip(event); })
            .on("mouseout", () => { if (!isMobile()) hideTooltip(); })
            .on("click", (event, d) => {
                event.stopPropagation();
                if (isHighlighted) { resetHighlight(); return; }
                showArchetypeDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
                if (isMobile()) centerOnConnected(d, validEdges);

                showVariantsPill(d);
            });

        // Update stored refs for filter + sidebar
        currentCardSel = cardSel;
        currentArchSel = archSel;
        currentLinkSel = link;
        currentValidEdges = validEdges;
        currentNodeMap = nodeMap;
    }

    const tooltip = document.getElementById("tooltip");
    function showTooltipEl() {
        tooltip.style.display = "block";
        tooltip.style.opacity = "1";
        tooltip.style.visibility = "visible";
    }
    function moveTooltip(event) {
        tooltip.style.left = (event.clientX + 16) + "px";
        tooltip.style.top = (event.clientY + 16) + "px";
    }
    function hideTooltip() {
        tooltip.style.display = "none";
        tooltip.style.opacity = "0";
        tooltip.style.visibility = "hidden";
    }

    if (skipAnimation || !highlightDuration()) {
        // Instant: build all selections at once
        nodes.forEach(n => {
            if (!n.x) n.x = width / 2 + (Math.random() - 0.5) * 200;
            if (!n.y) n.y = height / 2 + (Math.random() - 0.5) * 200;
            activeNodes.push(n);
            activeNodeIds.add(n.id);
        });
        validEdges.forEach(e => activeEdges.push(e));
        rebuildSelections();
        simulation.nodes(activeNodes);
        simulation.force("link").links(activeEdges);
        simulation.alpha(1).restart();
    } else {
        // Progressive build via GSAP timeline
        const BATCH = 3;
        const totalSteps = Math.ceil(schedule.length / BATCH);
        const buildTl = gsap.timeline();
        let stepIdx = 0;

        for (let s = 0; s < totalSteps; s++) {
            buildTl.call(() => {
                let added = false;
                for (let i = 0; i < BATCH && stepIdx < schedule.length; i++, stepIdx++) {
                    const item = schedule[stepIdx];
                    const node = item.node;

                    if (item.type === "card") {
                        const connEdge = validEdges.find(e => e.source === node.id);
                        const parent = connEdge ? activeNodes.find(n => n.id === connEdge.target) : null;
                        if (parent && parent.x) {
                            node.x = parent.x + (Math.random() - 0.5) * 30;
                            node.y = parent.y + (Math.random() - 0.5) * 30;
                        } else {
                            node.x = width / 2 + (Math.random() - 0.5) * 40;
                            node.y = height / 2 + (Math.random() - 0.5) * 40;
                        }
                    } else {
                        node.x = width / 2 + (Math.random() - 0.5) * 80;
                        node.y = height / 2 + (Math.random() - 0.5) * 80;
                    }

                    activeNodes.push(node);
                    activeNodeIds.add(node.id);
                    added = true;

                    for (const edge of validEdges) {
                        const sid = typeof edge.source === "object" ? edge.source.id : edge.source;
                        const tid = typeof edge.target === "object" ? edge.target.id : edge.target;
                        if (activeNodeIds.has(sid) && activeNodeIds.has(tid) && !activeEdges.includes(edge)) {
                            activeEdges.push(edge);
                        }
                    }
                }

                if (added) {
                    rebuildSelections();
                    simulation.nodes(activeNodes);
                    simulation.force("link").links(activeEdges);
                    simulation.alpha(0.5).restart();
                }
            }, null, s * 0.06);
        }

        // Click anywhere to skip: kill timeline, bulk-add remaining nodes
        function skipBuild() {
            if (buildTl.progress() >= 1) return;
            buildTl.kill();

            // Add all remaining nodes in one pass
            for (; stepIdx < schedule.length; stepIdx++) {
                const node = schedule[stepIdx].node;
                if (!activeNodeIds.has(node.id)) {
                    node.x = width / 2 + (Math.random() - 0.5) * 200;
                    node.y = height / 2 + (Math.random() - 0.5) * 200;
                    activeNodes.push(node);
                    activeNodeIds.add(node.id);
                }
            }
            for (const edge of validEdges) {
                const sid = typeof edge.source === "object" ? edge.source.id : edge.source;
                const tid = typeof edge.target === "object" ? edge.target.id : edge.target;
                if (activeNodeIds.has(sid) && activeNodeIds.has(tid) && !activeEdges.includes(edge)) {
                    activeEdges.push(edge);
                }
            }
            rebuildSelections();
            simulation.nodes(activeNodes);
            simulation.force("link").links(activeEdges);
            simulation.alpha(1).restart();
            document.removeEventListener("pointerdown", skipBuild, true);
        }
        document.addEventListener("pointerdown", skipBuild, true);
        buildTl.eventCallback("onComplete", () => {
            document.removeEventListener("pointerdown", skipBuild, true);
        });
    }

    // ── Click background to reset ──
    svg.on("click", () => { resetHighlight(); });

    // ── Tick ──
    simulation.on("tick", () => {
        if (link) link
            .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        if (cardSel) cardSel.attr("cx", d => d.x).attr("cy", d => d.y);
        if (archSel) archSel.attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

/* ── Highlight ── */

function highlight(d, edges, cardSel, archSel, linkSel) {
    const connected = new Set([d.id]);
    edges.forEach(e => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        if (s === d.id) connected.add(t);
        if (t === d.id) connected.add(s);
    });

    // Split nodes into connected / dimmed groups
    const connCards = [], dimCards = [];
    cardSel.each(function(n) { (connected.has(n.id) ? connCards : dimCards).push(this); });

    const connArchs = [], dimArchs = [];
    archSel.each(function(n) { (connected.has(n.id) ? connArchs : dimArchs).push(this); });

    const activeLinks = [], dimLinks = [];
    linkSel.each(function(e) {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        ((s === d.id || t === d.id) ? activeLinks : dimLinks).push(this);
    });

    const dur = highlightDuration();

    // Animate connected elements to full visibility
    if (connCards.length) gsap.to(connCards, { attr: { opacity: 1 }, duration: dur, overwrite: true });
    if (connArchs.length) gsap.to(connArchs, { attr: { opacity: 1 }, duration: dur, overwrite: true });
    if (activeLinks.length) gsap.to(activeLinks, { attr: { "stroke-opacity": 0.5 }, duration: dur, overwrite: true });

    // Dim everything else
    if (dimCards.length) gsap.to(dimCards, { attr: { opacity: 0.06 }, duration: dur, overwrite: true });
    if (dimArchs.length) gsap.to(dimArchs, { attr: { opacity: 0.1 }, duration: dur, overwrite: true });
    if (dimLinks.length) gsap.to(dimLinks, { attr: { "stroke-opacity": 0.01 }, duration: dur, overwrite: true });
    isHighlighted = true;
}

function unhighlight(cardSel, archSel, linkSel) {
    const dur = highlightDuration();
    if (cardSel) gsap.to(cardSel.nodes(), { attr: { opacity: 0.85 }, duration: dur, overwrite: true });
    if (archSel) gsap.to(archSel.nodes(), { attr: { opacity: 1 }, duration: dur, overwrite: true });
    if (linkSel) {
        linkSel.each(function(d) {
            gsap.to(this, { attr: { "stroke-opacity": 0.05 + d.weight * 0.1 }, duration: dur, overwrite: true });
        });
    }
}

let variantsPill = null;
function removeVariantsPill() {
    if (variantsPill) { variantsPill.remove(); variantsPill = null; }
    if (simulation) simulation.on("tick.pill", null);
}

function showVariantsPill(d) {
    removeVariantsPill();
    const lists = d.lists || [];
    if (lists.length < 3 || !currentSvg) return;

    const svgG = currentSvg.select("g");
    variantsPill = svgG.append("g")
        .attr("cursor", "pointer")
        .attr("class", "variants-pill")
        .on("click", (e) => {
            e.stopPropagation();
            openVariantsOverlay(d.name, lists, d.colors, d.medoid_index, d.cluster_threshold);
        });
    variantsPill.append("rect")
        .attr("rx", 12).attr("ry", 12)
        .attr("width", 90).attr("height", 28)
        .attr("x", -45).attr("y", 0)
        .attr("fill", "var(--bg)")
        .attr("stroke", "var(--accent)")
        .attr("stroke-width", 1.5)
        .attr("opacity", 0.95);
    variantsPill.append("text")
        .attr("text-anchor", "middle")
        .attr("y", 19)
        .attr("font-family", "'Instrument Serif', Georgia, serif")
        .attr("font-size", 15)
        .attr("fill", "var(--accent)")
        .attr("pointer-events", "none")
        .text("variants");
    const r = archRadius(d);
    variantsPill.attr("transform", `translate(${d.x},${d.y + r + 18})`);
    if (simulation) {
        simulation.on("tick.pill", () => {
            if (variantsPill) variantsPill.attr("transform", `translate(${d.x},${d.y + r + 18})`);
        });
    }
    gsap.fromTo(variantsPill.node(), { opacity: 0, y: -5 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
}

function resetHighlight() {
    closePanel();
    removeVariantsPill();
    unhighlight(currentCardSel, currentArchSel, currentLinkSel);
    isHighlighted = false;
}

function highlightDuration() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.5;
}

function animateBars(bars) {
    if (!bars.length) return;
    const dur = highlightDuration();
    bars.forEach(bar => {
        const target = parseFloat(bar.dataset.scale) || 0;
        if (dur) {
            gsap.fromTo(bar, { scaleX: 0 }, { scaleX: target, duration: 0.4, ease: "power2.out" });
        } else {
            gsap.set(bar, { scaleX: target });
        }
    });
}

/* ── Mobile bottom sheet ── */

let sheetOpen = false;
let sheetTween = null;

function initMobileSheet() {
    const toggle = document.getElementById("meta-toggle");
    const sidebar = document.getElementById("meta-sidebar");

    toggle.addEventListener("click", () => {
        if (sheetOpen) closeMobileSheet(); else openMobileSheet();
    });

    // Close on backdrop tap (click on graph while sheet is open)
    document.getElementById("graph-container").addEventListener("click", () => {
        if (sheetOpen) closeMobileSheet();
    }, true);

    // Swipe down to dismiss
    if (isMobile()) {
        const handle = document.getElementById("meta-sidebar-handle");
        if (handle) {
            let startY = 0, deltaY = 0;
            handle.addEventListener("touchstart", (e) => {
                startY = e.touches[0].clientY;
                deltaY = 0;
            }, { passive: true });
            handle.addEventListener("touchmove", (e) => {
                deltaY = e.touches[0].clientY - startY;
                if (deltaY > 0) {
                    e.preventDefault();
                    gsap.set(sidebar, { y: deltaY * 0.7 });
                }
            }, { passive: false });
            handle.addEventListener("touchend", () => {
                if (deltaY > 60) {
                    closeMobileSheet();
                } else if (deltaY > 0) {
                    gsap.to(sidebar, { y: 0, duration: 0.2, ease: "power2.out" });
                }
            }, { passive: true });
        }
    }
}

function openMobileSheet() {
    const sidebar = document.getElementById("meta-sidebar");
    const toggle = document.getElementById("meta-toggle");
    const dur = highlightDuration();
    if (sheetTween) sheetTween.kill();
    sidebar.style.visibility = "visible";
    sheetTween = gsap.to(sidebar, {
        y: 0, duration: dur ? 0.45 : 0, ease: "power3.out", overwrite: true
    });
    gsap.to(toggle, { autoAlpha: 0, duration: dur ? 0.2 : 0 });
    sheetOpen = true;
}

function closeMobileSheet() {
    const sidebar = document.getElementById("meta-sidebar");
    const toggle = document.getElementById("meta-toggle");
    const dur = highlightDuration();
    if (sheetTween) sheetTween.kill();
    sheetTween = gsap.to(sidebar, {
        y: "100%", duration: dur ? 0.35 : 0, ease: "power2.in", overwrite: true,
        onComplete: () => { sidebar.style.visibility = "hidden"; }
    });
    gsap.to(toggle, { autoAlpha: 1, duration: dur ? 0.2 : 0, delay: dur ? 0.15 : 0 });
    sheetOpen = false;
}

/* ── Center graph on connected nodes ── */

function centerOnConnected(d, edges) {
    if (!currentZoom || !currentSvg) return;

    // Find all connected node positions
    const connected = new Set([d.id]);
    edges.forEach(e => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        if (s === d.id) connected.add(t);
        if (t === d.id) connected.add(s);
    });

    // Collect positions of connected nodes
    const points = [];
    if (d.x != null && d.y != null) points.push({ x: d.x, y: d.y });
    if (currentNodeMap) {
        for (const id of connected) {
            const n = currentNodeMap.get(id);
            if (n && n.x != null && n.y != null) points.push({ x: n.x, y: n.y });
        }
    }
    if (points.length === 0) return;

    // Use 90th percentile bounding box to exclude outlier nodes
    const xs = points.map(p => p.x).sort((a, b) => a - b);
    const ys = points.map(p => p.y).sort((a, b) => a - b);
    const lo = Math.floor(points.length * 0.15);
    const hi = Math.min(Math.ceil(points.length * 0.85), points.length - 1);
    const minX = xs[lo], maxX = xs[hi];
    const minY = ys[lo], maxY = ys[hi];

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;

    const width = window.innerWidth;
    const height = window.innerHeight;
    // On mobile, visible area is the top half (above the panel)
    const targetH = isMobile() ? height * 0.5 : height;
    const targetCenterX = width / 2;
    const targetCenterY = targetH / 2;

    // Fit bounding box with padding
    const pad = 60;
    const scaleX = (width - pad * 2) / bw;
    const scaleY = (targetH - pad * 2) / bh;
    const scale = Math.min(scaleX, scaleY, 2.5); // cap zoom

    const tx = targetCenterX - cx * scale;
    const ty = targetCenterY - cy * scale;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);

    const dur = highlightDuration();
    if (dur) {
        currentSvg.transition().duration(600).ease(d3.easeCubicInOut)
            .call(currentZoom.transform, transform);
    } else {
        currentSvg.call(currentZoom.transform, transform);
    }
}

/* ── Panel open / close ── */

let panelTween = null;

let panelSwipeSetup = false;

function openPanel() {
    const panel = document.getElementById("detail-panel");
    panel.scrollTop = 0;
    const dur = highlightDuration();
    if (panelTween) panelTween.kill();
    panel.style.visibility = "visible";

    if (isMobile()) {
        gsap.set(panel, { x: 0 });
        panelTween = gsap.to(panel, {
            y: 0, duration: dur ? 0.45 : 0, ease: "power3.out", overwrite: true
        });
        if (!panelSwipeSetup) { initPanelSwipe(panel); panelSwipeSetup = true; }
    } else {
        panelTween = gsap.to(panel, {
            x: 0, duration: dur ? 0.55 : 0, ease: "power3.out", overwrite: true
        });
    }
    if (dur) gsap.delayedCall(0.12, animatePanelContent);
    else animatePanelContent();
}

function closePanel() {
    const panel = document.getElementById("detail-panel");
    if (panelTween) panelTween.kill();

    const dur = highlightDuration();
    if (isMobile()) {
        panelTween = gsap.to(panel, {
            y: "100%", duration: dur ? 0.3 : 0, ease: "power2.in", overwrite: true,
            onComplete: () => { panel.style.visibility = "hidden"; }
        });
    } else {
        panelTween = gsap.to(panel, {
            x: "100%", duration: dur ? 0.3 : 0, ease: "power2.in", overwrite: true,
            onComplete: () => { panel.style.visibility = "hidden"; }
        });
    }
}

function initPanelSwipe(panel) {
    const handle = document.getElementById("panel-swipe-handle");
    if (!handle) return;

    let startY = 0;
    let deltaY = 0;

    handle.addEventListener("touchstart", (e) => {
        startY = e.touches[0].clientY;
        deltaY = 0;
    }, { passive: true });

    handle.addEventListener("touchmove", (e) => {
        deltaY = e.touches[0].clientY - startY;
        if (deltaY > 0) {
            e.preventDefault();
            gsap.set(panel, { y: deltaY * 0.7 });
        }
    }, { passive: false });

    handle.addEventListener("touchend", () => {
        if (deltaY > 60) {
            closePanel();
        } else if (deltaY > 0) {
            gsap.to(panel, { y: 0, duration: 0.2, ease: "power2.out" });
        }
    }, { passive: true });
}

function animatePanelContent() {
    const dur = highlightDuration();
    if (!dur) {
        document.querySelectorAll("#detail-content .deck-bar").forEach(bar => {
            gsap.set(bar, { scaleX: parseFloat(bar.dataset.scale) || 0 });
        });
        return;
    }

    const content = document.getElementById("detail-content");
    const header = content.querySelector(".panel-header");
    const tabs = content.querySelector(".panel-tabs");
    const image = content.querySelector(".panel-card-image");
    // Only animate elements in the visible tab, not hidden ones
    const activeTab = content.querySelector(".tab-content:not(.hidden)") || content;
    const sectionTitles = activeTab.querySelectorAll(".panel-section-title");
    const rows = activeTab.querySelectorAll(".deck-row, .card-list li, .result-row, .meta-row");

    // Build a timeline for staggered entrance
    const tl = gsap.timeline();

    if (header) {
        tl.from(header, { y: 14, autoAlpha: 0, duration: 0.35, ease: "power2.out" }, 0);
    }
    if (tabs) {
        tl.from(tabs, { y: 8, autoAlpha: 0, duration: 0.3, ease: "power2.out" }, 0.12);
    }
    if (image) {
        tl.from(image, { scale: 0.95, autoAlpha: 0, duration: 0.4, ease: "power2.out" }, 0.18);
    }
    if (sectionTitles.length) {
        tl.from(sectionTitles, { x: -10, autoAlpha: 0, duration: 0.3, stagger: 0.06, ease: "power2.out" }, 0.2);
    }
    if (rows.length) {
        tl.from(rows, { x: -14, autoAlpha: 0, duration: 0.3, stagger: 0.03, ease: "power2.out" }, 0.25);
    }
}

function animateTabContent(container) {
    const deckBars = container.querySelectorAll(".deck-bar");
    const dur = highlightDuration();
    if (!dur) {
        animateBars(deckBars);
        return;
    }
    const rows = container.querySelectorAll(".deck-row, .card-list li, .result-row");
    const titles = container.querySelectorAll(".panel-section-title");
    if (titles.length) gsap.from(titles, { x: -10, autoAlpha: 0, duration: 0.3, stagger: 0.05, ease: "power2.out" });
    if (rows.length) gsap.from(rows, { x: -14, autoAlpha: 0, duration: 0.3, stagger: 0.03, ease: "power2.out", delay: 0.06 });
    if (deckBars.length) gsap.delayedCall(0.15, () => animateBars(deckBars));
}

/* ── Variants chart ── */

// Cache land names once
let _landSet = null;
function isLand(cardName) {
    if (!_landSet) {
        _landSet = new Set();
        for (const [name, type] of Object.entries(cardTypeMap)) {
            if (type.toLowerCase().includes("land")) _landSet.add(name);
        }
    }
    return _landSet.has(cardName);
}

// Strip lands from a mainboard dict
function spellsOnly(mb) {
    const out = {};
    for (const [c, n] of Object.entries(mb)) {
        if (!isLand(c)) out[c] = n;
    }
    return out;
}

function deckDistance(a, b) {
    // Number of non-land card slots that differ
    const allCards = new Set([...Object.keys(a), ...Object.keys(b)]);
    let diff = 0;
    for (const c of allCards) diff += Math.abs((a[c] || 0) - (b[c] || 0));
    return diff / 2;
}


function clusterLists(lists, threshold) {
    // Pre-strip lands so deckDistance is fast (no per-card isLand check)
    const clusters = lists.map((l, i) => ({
        lists: [l],
        indices: [i],
        mainboard: spellsOnly(l.mainboard)
    }));

    let merged = true;
    while (merged) {
        merged = false;
        let bestI = -1, bestJ = -1, bestDist = Infinity;
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const d = deckDistance(clusters[i].mainboard, clusters[j].mainboard);
                if (d < bestDist) { bestDist = d; bestI = i; bestJ = j; }
            }
        }
        if (bestDist <= threshold && bestI >= 0) {
            const ci = clusters[bestI], cj = clusters[bestJ];
            ci.lists.push(...cj.lists);
            ci.indices.push(...cj.indices);
            // Recompute centroid (spells only)
            const avg = {};
            for (const l of ci.lists) {
                for (const [card, qty] of Object.entries(l.mainboard)) {
                    if (!isLand(card)) avg[card] = (avg[card] || 0) + qty;
                }
            }
            for (const c in avg) avg[c] = Math.round(avg[c] / ci.lists.length);
            ci.mainboard = avg;
            clusters.splice(bestJ, 1);
            merged = true;
        }
    }
    return clusters;
}

function deckDiff(deck, ref) {
    const diffs = [];
    const allCards = new Set([...Object.keys(deck), ...Object.keys(ref)]);
    for (const card of allCards) {
        const has = deck[card] || 0;
        const expected = ref[card] || 0;
        if (has !== expected) {
            diffs.push({ card, has, expected, delta: has - expected });
        }
    }
    diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return diffs;
}

function openVariantsOverlay(name, lists, colors, medoidIndex, clusterThreshold) {
    const overlay = document.getElementById("variants-overlay");
    const header = document.getElementById("variants-header");
    const sidebar = document.getElementById("variants-sidebar");

    header.innerHTML = `<div class="variants-title">${name}</div>` +
        `<div class="variants-subtitle">${lists.length} lists</div>`;

    // Reset sidebar
    sidebar.classList.remove("active");
    document.getElementById("variants-sidebar-content").innerHTML = "";

    // Show overlay immediately for feedback
    overlay.style.visibility = "visible";
    overlay.style.opacity = "1";

    document.getElementById("close-variants").onclick = closeVariantsOverlay;
    document.getElementById("close-variants-sidebar").onclick = closeVariantsSidebar;

    const midx = medoidIndex || 0;
    const thresh = clusterThreshold || 3;
    // Double rAF: ensures overlay is painted before heavy computation starts
    requestAnimationFrame(() => requestAnimationFrame(() => renderVariantsChart(name, lists, colors || [], midx, thresh)));
}

function closeVariantsSidebar() {
    const sidebar = document.getElementById("variants-sidebar");
    const dur = highlightDuration();
    if (dur) {
        gsap.to(sidebar, {
            x: 40, autoAlpha: 0, duration: 0.3, ease: "power2.in",
            onComplete: () => { sidebar.classList.remove("active"); gsap.set(sidebar, { x: 0 }); }
        });
    } else {
        sidebar.classList.remove("active");
    }
}

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

function renderVariantsChart(archName, lists, colors, medoidIndex, clusterThreshold) {
    const chartContainer = document.getElementById("variants-chart");
    if (!chartContainer || lists.length < 3) return;

    const medoid = lists[medoidIndex] || lists[0];
    const medoidMain = medoid.mainboard;
    const medoidSpells = spellsOnly(medoidMain);
    const clColors = colors.length > 0 ? colors : [];
    const strokeW = 3;

    // ── 1. Cluster + flex cards ──
    const clusters = clusterLists(lists, clusterThreshold);
    let medoidClusterIdx = 0;
    for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].indices && clusters[i].indices.includes(medoidIndex)) { medoidClusterIdx = i; break; }
    }
    for (const cl of clusters) {
        const diff = deckDiff(cl.mainboard, medoidMain).filter(d => !isLand(d.card));
        cl.distance = Math.round(diff.reduce((s, d) => s + Math.abs(d.delta), 0) / 2);
    }
    clusters[medoidClusterIdx].distance = 0;
    clusters[medoidClusterIdx].isReference = true;

    // ── 2. Collect ALL non-land mainboard cards across all clusters ──
    const allCardNames = new Set();
    for (const cl of clusters) {
        for (const card of Object.keys(cl.mainboard)) {
            if (cl.mainboard[card] > 0 && !isLand(card)) allCardNames.add(card);
        }
    }

    // ── 3. Layout ──
    const rect = chartContainer.getBoundingClientRect();
    const w = rect.width || 400, h = rect.height || 400;
    const cx = w / 2, cy = h / 2;

    chartContainer.innerHTML = "";
    const svg = d3.select(chartContainer).append("svg")
        .attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`);
    const g = svg.append("g");

    svg.call(d3.zoom().scaleExtent([0.4, 4]).on("zoom", e => g.attr("transform", e.transform)));

    // ── 4. Build nodes ──
    const variantNodes = clusters.map((cl, i) => {
        const size = 8 + Math.sqrt(cl.lists.length) * 5;
        return {
            id: `var-${i}`, type: "variant", cluster: cl, index: i, size,
            x: cx + (Math.random() - 0.5) * 100, y: cy + (Math.random() - 0.5) * 100,
            ...(cl.isReference ? { fx: cx, fy: cy } : {}),
        };
    });

    // Count how many clusters play each card (for sizing)
    const cardClusterCount = {};
    for (const cl of clusters) {
        for (const card of Object.keys(cl.mainboard)) {
            if (cl.mainboard[card] > 0 && !isLand(card))
                cardClusterCount[card] = (cardClusterCount[card] || 0) + 1;
        }
    }
    const numClusters = clusters.length;

    const cardNodes = [...allCardNames].map((name, i) => {
        const presence = (cardClusterCount[name] || 1) / numClusters;
        return {
            id: `card-${i}`, type: "card", name,
            colors: cardColorMap[name] || [],
            size: 2 + presence * 8,
            x: cx + (Math.random() - 0.5) * 200, y: cy + (Math.random() - 0.5) * 200,
        };
    });

    const allNodes = [...variantNodes, ...cardNodes];
    const cardNodeMap = {};
    cardNodes.forEach(n => { cardNodeMap[n.name] = n; });

    // ── 5. Build edges: card → every cluster that plays it ──
    const linkData = [];
    for (const vn of variantNodes) {
        for (const card of Object.keys(vn.cluster.mainboard)) {
            if (vn.cluster.mainboard[card] > 0 && cardNodeMap[card]) {
                linkData.push({ source: cardNodeMap[card], target: vn, weight: vn.cluster.mainboard[card] / 4 });
            }
        }
    }

    // ── 6. Render ──
    const linkG = g.append("g");
    const linkSel = linkG.selectAll("line").data(linkData).enter().append("line")
        .attr("stroke", "#c8c0b4")
        .attr("stroke-opacity", d => 0.05 + d.weight * 0.1)
        .attr("stroke-width", d => 0.3 + d.weight * 1);

    // Card dots (same style as main graph)
    const cardG = g.append("g");
    const cardSel = cardG.selectAll("circle").data(cardNodes).enter().append("circle")
        .attr("r", d => d.size)
        .attr("fill", d => cardDotColor(d.colors))
        .attr("opacity", 0.85)
        .attr("cursor", "pointer");

    // Variant nodes (archetype-style)
    const archG = g.append("g");
    const archSel = archG.selectAll("g.var-node").data(variantNodes).enter().append("g")
        .attr("class", "var-node")
        .attr("cursor", "pointer");

    archSel.each(function(nd) {
        const el = d3.select(this);

        // Derive colors: stock uses archetype colors, variants derive from their cards
        let nodeColors;
        if (nd.cluster.isReference) {
            nodeColors = clColors;
        } else {
            const colorOrder = ["W", "U", "B", "R", "G"];
            const colorSet = new Set();
            for (const card of Object.keys(nd.cluster.mainboard)) {
                for (const c of (cardColorMap[card] || [])) colorSet.add(c);
            }
            nodeColors = colorOrder.filter(c => colorSet.has(c));
        }

        if (nodeColors.length === 0) {
            el.append("circle").attr("r", nd.size)
                .attr("fill", "var(--bg)").attr("stroke", "#a09888")
                .attr("stroke-width", strokeW).attr("stroke-opacity", 0.5);
        } else if (nodeColors.length === 1) {
            el.append("circle").attr("r", nd.size)
                .attr("fill", "var(--bg)").attr("stroke", MANA_HEX[nodeColors[0]] || "#a09888")
                .attr("stroke-width", strokeW).attr("stroke-opacity", 0.7);
        } else {
            el.append("circle").attr("r", nd.size).attr("fill", "var(--bg)").attr("stroke", "none");
            const segAngle = (2 * Math.PI) / nodeColors.length, gap = 0.08;
            nodeColors.forEach((c, ci) => {
                const sA = ci * segAngle - Math.PI / 2 + gap / 2;
                const eA = (ci + 1) * segAngle - Math.PI / 2 - gap / 2;
                const largeArc = segAngle - gap > Math.PI ? 1 : 0;
                el.append("path")
                    .attr("d", `M ${Math.cos(sA)*nd.size} ${Math.sin(sA)*nd.size} A ${nd.size} ${nd.size} 0 ${largeArc} 1 ${Math.cos(eA)*nd.size} ${Math.sin(eA)*nd.size}`)
                    .attr("fill", "none").attr("stroke", MANA_HEX[c] || "#a09888")
                    .attr("stroke-width", strokeW).attr("stroke-linecap", "round").attr("stroke-opacity", 0.75);
            });
        }
        el.append("text")
            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
            .attr("font-family", nd.cluster.isReference ? "'Instrument Serif', Georgia, serif" : "var(--font-mono)")
            .attr("font-size", nd.cluster.isReference ? Math.max(11, nd.size - 2) : Math.max(10, Math.min(13, nd.size - 2)))
            .attr("font-weight", nd.cluster.isReference ? 400 : 600)
            .attr("fill", nd.cluster.isReference ? "var(--accent)" : "var(--ink)")
            .text(nd.cluster.isReference ? "stock" : "\u0394" + nd.cluster.distance);
    });

    // ── 6. Tooltip (same as main graph) ──
    const tooltip = document.getElementById("tooltip");
    function showTip() { tooltip.style.display = "block"; tooltip.style.opacity = "1"; tooltip.style.visibility = "visible"; }
    function moveTip(event) { tooltip.style.left = (event.clientX + 16) + "px"; tooltip.style.top = (event.clientY + 16) + "px"; }
    function hideTip() { tooltip.style.display = "none"; tooltip.style.opacity = "0"; tooltip.style.visibility = "hidden"; }

    cardSel
        .on("mouseover", (event, d) => {
            let html = `<div class="tt-name">${d.name}</div>`;
            const img = cardImageMap[d.name];
            if (img) html += `<img src="${img}" alt="${d.name}">`;
            tooltip.innerHTML = html;
            showTip();
        })
        .on("mousemove", moveTip)
        .on("mouseout", hideTip)
        .on("click", (event, d) => {
            event.stopPropagation();
            // Find connected variant ids
            const connectedVars = new Set();
            linkData.forEach(l => {
                const src = typeof l.source === "object" ? l.source : l.source;
                if (src === d || src.id === d.id) connectedVars.add(typeof l.target === "object" ? l.target.id : l.target);
            });

            // Dim everything
            cardSel.attr("opacity", 0.1);
            archSel.attr("opacity", 0.15);
            linkSel.attr("stroke-opacity", 0.03);

            // Highlight this card
            cardSel.filter(c => c.id === d.id).attr("opacity", 1);

            // Highlight connected variants
            archSel.filter(v => connectedVars.has(v.id)).attr("opacity", 1);

            // Highlight connected links
            linkSel.filter(l => {
                const src = typeof l.source === "object" ? l.source : l.source;
                return src === d || src.id === d.id;
            }).attr("stroke-opacity", 0.4).attr("stroke-width", 1.5);

            // Sidebar — show all lists that play this card
            const cardInfo = { name: d.name, count: 0, listIndices: new Set() };
            for (let i = 0; i < lists.length; i++) {
                if ((lists[i].mainboard[d.name] || 0) > 0) cardInfo.listIndices.add(i);
            }
            cardInfo.count = cardInfo.listIndices.size;
            showCardListDetail(medoid, cardInfo, lists, medoidIndex);
        });

    // Click background to reset highlight
    svg.on("click", () => {
        cardSel.attr("opacity", 0.85);
        archSel.attr("opacity", 1);
        linkSel.attr("stroke-opacity", 0.15).attr("stroke-width", 0.8);
    });

    archSel
        .on("mouseover", (event, d) => {
            const label = d.cluster.isReference ? "Stock" : `Variant \u0394${d.cluster.distance}`;
            tooltip.innerHTML = `<div class="tt-name">${label}</div><div class="tt-stat">${d.cluster.lists.length} lists</div>`;
            showTip();
        })
        .on("mousemove", moveTip)
        .on("mouseout", hideTip)
        .on("click", (event, d) => {
            event.stopPropagation();

            // Find connected card ids
            const connectedCards = new Set();
            linkData.forEach(l => {
                const tgt = typeof l.target === "object" ? l.target : l.target;
                if (tgt === d || tgt.id === d.id) connectedCards.add(typeof l.source === "object" ? l.source.id : l.source);
            });

            // Dim everything
            cardSel.attr("opacity", 0.1);
            archSel.attr("opacity", 0.15);
            linkSel.attr("stroke-opacity", 0.03);

            // Highlight this cluster
            archSel.filter(v => v.id === d.id).attr("opacity", 1);

            // Highlight connected cards
            cardSel.filter(c => connectedCards.has(c.id)).attr("opacity", 1);

            // Highlight connected links
            linkSel.filter(l => {
                const tgt = typeof l.target === "object" ? l.target : l.target;
                return tgt === d || tgt.id === d.id;
            }).attr("stroke-opacity", 0.4).attr("stroke-width", 1.5);

            showClusterDetail(d.cluster, medoid);
        });

    // ── 7. Live force simulation with drag ──
    const sim = d3.forceSimulation(allNodes)
        .force("link", d3.forceLink(linkData).distance(60).strength(0.15))
        .force("charge", d3.forceManyBody().strength(d => d.type === "variant" ? -150 : -20))
        .force("center", d3.forceCenter(cx, cy).strength(0.03))
        .force("collide", d3.forceCollide(d => (d.type === "variant" ? d.size + 8 : d.size + 3)).strength(0.7));

    sim.on("tick", () => {
        linkSel
            .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        cardSel.attr("cx", d => d.x).attr("cy", d => d.y);
        archSel.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Drag (local sim, not global)
    const drag = d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); if (!d.cluster || !d.cluster.isReference) { d.fx = null; d.fy = null; } });
    cardSel.call(drag);
    archSel.call(drag);

    // ── 8. Nearby archetype nodes (satellites in the simulation) ──
    if (allData) {
        const nearbyArchs = [];
        const otherArchs = allData.nodes.filter(n =>
            n.type === "archetype" && n.name !== archName && n.lists && n.lists.length >= 3
        );
        for (const arch of otherArchs) {
            const otherMedoid = arch.lists[arch.medoid_index || 0];
            if (!otherMedoid) continue;
            const dist = deckDistance(spellsOnly(otherMedoid.mainboard), medoidSpells);
            if (dist < 25) {
                nearbyArchs.push({ name: arch.name, colors: arch.colors || [], distance: Math.round(dist), arch });
            }
        }
        nearbyArchs.sort((a, b) => a.distance - b.distance);

        if (nearbyArchs.length > 0) {
            const edgeR = Math.min(w, h) / 2 - 30;
            const nSize = 16, nStrokeW = 2.5;
            const angleStep = (2 * Math.PI) / nearbyArchs.length;

            // Create simulation nodes for satellites
            const satNodes = nearbyArchs.map((na, i) => {
                const angle = i * angleStep - Math.PI / 2;
                return {
                    na, index: i,
                    x: cx + Math.cos(angle) * edgeR,
                    y: cy + Math.sin(angle) * edgeR,
                };
            });

            // Render satellite visuals
            const satG = g.append("g");
            const satEls = satNodes.map(nd => {
                const ng = satG.append("g").attr("opacity", 0.9).attr("cursor", "pointer");
                const nColors = nd.na.colors;

                ng.append("circle").attr("r", nSize + 6).attr("fill", "transparent");
                ng.append("circle").attr("r", nSize).attr("fill", "var(--bg)");

                if (nColors.length === 0) {
                    ng.append("circle").attr("r", nSize)
                        .attr("fill", "none").attr("stroke", "#a09888")
                        .attr("stroke-width", nStrokeW);
                } else if (nColors.length === 1) {
                    ng.append("circle").attr("r", nSize)
                        .attr("fill", "none").attr("stroke", MANA_HEX[nColors[0]] || "#a09888")
                        .attr("stroke-width", nStrokeW);
                } else {
                    const segAngle = (2 * Math.PI) / nColors.length, gap = 0.12;
                    nColors.forEach((c, ci) => {
                        const sA = ci * segAngle - Math.PI / 2 + gap / 2;
                        const eA = (ci + 1) * segAngle - Math.PI / 2 - gap / 2;
                        const largeArc = segAngle - gap > Math.PI ? 1 : 0;
                        ng.append("path")
                            .attr("d", `M ${Math.cos(sA)*nSize} ${Math.sin(sA)*nSize} A ${nSize} ${nSize} 0 ${largeArc} 1 ${Math.cos(eA)*nSize} ${Math.sin(eA)*nSize}`)
                            .attr("fill", "none").attr("stroke", MANA_HEX[c] || "#a09888")
                            .attr("stroke-width", nStrokeW).attr("stroke-linecap", "round");
                    });
                }

                ng.append("text")
                    .attr("y", nSize + 13).attr("text-anchor", "middle")
                    .attr("font-family", "'Instrument Serif', Georgia, serif").attr("font-size", 10)
                    .attr("fill", "var(--ink-faint)").attr("pointer-events", "none")
                    .text(nd.na.name);
                ng.append("text")
                    .attr("y", nSize + 24).attr("text-anchor", "middle")
                    .attr("font-family", "var(--font-mono)").attr("font-size", 8)
                    .attr("fill", "var(--ink-faint)").attr("pointer-events", "none")
                    .text("\u0394" + nd.na.distance);

                ng.on("mouseover", () => {
                    tooltip.innerHTML = `<div class="tt-name">${nd.na.name}</div><div class="tt-stat">\u0394${nd.na.distance} cards &middot; ${nd.na.arch.list_count} lists</div>`;
                    showTip();
                }).on("mousemove", moveTip).on("mouseout", hideTip);

                ng.on("click", (event) => {
                    event.stopPropagation();
                    const a = nd.na.arch;
                    openVariantsOverlay(a.name, a.lists, a.colors, a.medoid_index, a.cluster_threshold);
                });

                return ng;
            });

            // Floating animation — each satellite drifts independently
            satNodes.forEach((nd, i) => {
                satEls[i].attr("transform", `translate(${nd.x},${nd.y})`);
                // Continuous random float with GSAP
                function drift() {
                    const dx = (Math.random() - 0.5) * 80;
                    const dy = (Math.random() - 0.5) * 80;
                    const dur = 4 + Math.random() * 5;
                    gsap.to(nd, {
                        x: nd.x + dx, y: nd.y + dy, duration: dur,
                        ease: "sine.inOut",
                        onUpdate: () => satEls[i].attr("transform", `translate(${nd.x},${nd.y})`),
                        onComplete: drift,
                    });
                }
                // Stagger start
                gsap.delayedCall(Math.random() * 2, drift);
            });
        }
    }
}

let clusterDeckIdx = 1000;

function showCardListDetail(medoid, card, allLists, medoidIndex) {
    const sidebar = document.getElementById("variants-sidebar");
    const content = document.getElementById("variants-sidebar-content");
    const medoidMain = medoid.mainboard;

    let html = "";

    if (!card) {
        // Clicked the medoid center — show reference decklist
        html += `<div class="panel-header">`;
        html += `<div class="panel-name">Reference List</div>`;
        html += `<div class="panel-meta">${medoid.pilot}`;
        html += `<span class="panel-meta-label"> &middot; ${medoid.finish} &middot; ${medoid.date}</span></div>`;
        html += `</div>`;

        const mainTotal = Object.values(medoid.mainboard).reduce((s, n) => s + n, 0);
        html += `<div class="panel-section-title">Mainboard <span class="avg-deck-count">${mainTotal}</span></div>`;
        for (const [name, qty] of Object.entries(medoid.mainboard).sort((a, b) => b[1] - a[1])) {
            html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
        }
        if (medoid.sideboard && Object.keys(medoid.sideboard).length > 0) {
            const sideTotal = Object.values(medoid.sideboard).reduce((s, n) => s + n, 0);
            html += `<div class="panel-section-title" style="margin-top:24px">Sideboard <span class="avg-deck-count">${sideTotal}</span></div>`;
            for (const [name, qty] of Object.entries(medoid.sideboard).sort((a, b) => b[1] - a[1])) {
                html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
            }
        }
    } else {
        // Clicked a card — show lists that play it (headers only, lazy expand)
        const pct = Math.round(card.count / (allLists.length - 1) * 100);
        html += `<div class="panel-header">`;
        html += `<div class="panel-name">${card.name}</div>`;
        html += `<div class="panel-meta">${card.count}`;
        html += `<span class="panel-meta-label"> ${card.count === 1 ? "list" : "lists"} (${pct}%)</span></div>`;
        html += `</div>`;

        html += `<ul class="results-list">`;
        const baseIdx = clusterDeckIdx;
        const listIndices = [...card.listIndices];
        clusterDeckIdx += listIndices.length;

        for (let i = 0; i < listIndices.length; i++) {
            const l = allLists[listIndices[i]];
            const idx = baseIdx + i;
            html += `<li class="result-row" data-idx="${idx}" data-list-idx="${listIndices[i]}">`;
            html += `<div class="result-header">`;
            html += `<span class="result-finish">${l.finish}</span>`;
            html += `<span class="result-pilot">${l.pilot}</span>`;
            html += `<span class="result-meta">${l.date}</span>`;
            html += `<span class="result-toggle">+</span>`;
            html += `</div>`;
            html += `<div class="result-decklist hidden" id="decklist-${idx}"></div>`;
            html += `</li>`;
        }
        html += `</ul>`;
    }

    content.innerHTML = html;
    wireCardHover(content);

    // Lazy expand: render diff + decklist only on first open
    content.querySelectorAll(".result-row").forEach(row => {
        let rendered = false;
        row.querySelector(".result-header").addEventListener("click", () => {
            const dl = document.getElementById(`decklist-${row.dataset.idx}`);
            const toggle = row.querySelector(".result-toggle");

            if (!rendered && row.dataset.listIdx) {
                const l = allLists[parseInt(row.dataset.listIdx)];
                const diff = deckDiff(l.mainboard, medoidMain).filter(d => !isLand(d.card));
                let inner = "";
                if (diff.length > 0) {
                    const added = diff.filter(d => d.delta > 0);
                    const removed = diff.filter(d => d.delta < 0);
                    inner += `<div class="diff-columns">`;
                    if (removed.length > 0) {
                        inner += `<div class="diff-col"><div class="result-section">Out</div>`;
                        for (const d of removed) inner += `<div class="cluster-diff" data-card="${d.card}"><span class="minus">${d.delta}</span> ${d.card}</div>`;
                        inner += `</div>`;
                    }
                    if (added.length > 0) {
                        inner += `<div class="diff-col"><div class="result-section">In</div>`;
                        for (const d of added) inner += `<div class="cluster-diff" data-card="${d.card}"><span class="plus">+${d.delta}</span> ${d.card}</div>`;
                        inner += `</div>`;
                    }
                    inner += `</div>`;
                }
                inner += `<div class="result-section">Mainboard</div>`;
                for (const [name, qty] of Object.entries(l.mainboard).sort((a, b) => b[1] - a[1]))
                    inner += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
                if (l.sideboard && Object.keys(l.sideboard).length > 0) {
                    inner += `<div class="result-section">Sideboard</div>`;
                    for (const [name, qty] of Object.entries(l.sideboard).sort((a, b) => b[1] - a[1]))
                        inner += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
                }
                dl.innerHTML = inner;
                wireCardHover(dl);
                rendered = true;
            }

            dl.classList.toggle("hidden");
            toggle.textContent = dl.classList.contains("hidden") ? "+" : "\u2212";
        });
    });

    // Show sidebar
    sidebar.scrollTop = 0;
    const dur = highlightDuration();
    const wasHidden = !sidebar.classList.contains("active");
    sidebar.classList.add("active");
    if (wasHidden && dur) {
        gsap.fromTo(sidebar,
            { x: isMobile() ? 0 : 40, autoAlpha: 0 },
            { x: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out" }
        );
    } else if (wasHidden) {
        gsap.set(sidebar, { autoAlpha: 1 });
    }

    if (dur) {
        const header = content.querySelector(".panel-header");
        const titles = content.querySelectorAll(".panel-section-title");
        const rows = content.querySelectorAll(".cluster-diff, .result-row, .result-card");
        const tl = gsap.timeline();
        if (header) tl.from(header, { y: 14, autoAlpha: 0, duration: 0.35, ease: "power2.out" }, 0);
        if (titles.length) tl.from(titles, { x: -10, autoAlpha: 0, duration: 0.3, stagger: 0.06, ease: "power2.out" }, 0.12);
        if (rows.length) tl.from(rows, { x: -14, autoAlpha: 0, duration: 0.3, stagger: 0.02, ease: "power2.out" }, 0.2);
    }
}

function showClusterDetail(cluster, medoid) {
    const sidebar = document.getElementById("variants-sidebar");
    const content = document.getElementById("variants-sidebar-content");

    let html = "";

    // Header
    html += `<div class="panel-header">`;
    if (cluster.isReference) {
        html += `<div class="panel-name">Reference List</div>`;
        html += `<div class="panel-meta">${medoid.pilot}`;
        html += `<span class="panel-meta-label"> &middot; ${medoid.finish} &middot; ${medoid.date}</span></div>`;
    } else {
        html += `<div class="panel-name">Cluster</div>`;
        html += `<div class="panel-meta">${cluster.lists.length}`;
        html += `<span class="panel-meta-label">${cluster.lists.length === 1 ? "list" : "lists"} &middot; &Delta;${cluster.distance} cards</span></div>`;
    }
    html += `</div>`;

    // Reference cluster: show full medoid decklist
    if (cluster.isReference) {
        const mainTotal = Object.values(medoid.mainboard).reduce((s, n) => s + n, 0);
        html += `<div class="panel-section-title">Mainboard <span class="avg-deck-count">${mainTotal}</span></div>`;
        const mainEntries = Object.entries(medoid.mainboard).sort((a, b) => b[1] - a[1]);
        for (const [name, qty] of mainEntries) {
            html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
        }
        if (medoid.sideboard && Object.keys(medoid.sideboard).length > 0) {
            const sideTotal = Object.values(medoid.sideboard).reduce((s, n) => s + n, 0);
            html += `<div class="panel-section-title" style="margin-top:24px">Sideboard <span class="avg-deck-count">${sideTotal}</span></div>`;
            const sideEntries = Object.entries(medoid.sideboard).sort((a, b) => b[1] - a[1]);
            for (const [name, qty] of sideEntries) {
                html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
            }
        }
        if (cluster.lists.length > 1) {
            html += `<div class="panel-section-title" style="margin-top:24px">${cluster.lists.length} lists in this cluster</div>`;
        }
    }

    // Lists section
    if (!cluster.isReference) {
        html += `<div class="panel-section-title" style="margin-top:12px">${cluster.lists.length} ${cluster.lists.length === 1 ? "list" : "lists"}</div>`;
    }
    html += `<ul class="results-list">`;

    const medoidMain = medoid.mainboard;
    const baseIdx = clusterDeckIdx;
    clusterDeckIdx += cluster.lists.length;

    for (let i = 0; i < cluster.lists.length; i++) {
        const l = cluster.lists[i];
        const idx = baseIdx + i;
        const diff = deckDiff(l.mainboard, medoidMain).filter(d => !isLand(d.card));
        const delta = diff.reduce((s, d) => s + Math.abs(d.delta), 0) / 2;
        html += `<li class="result-row" data-idx="${idx}">`;
        html += `<div class="result-header">`;
        html += `<span class="result-finish">${l.finish}</span>`;
        html += `<span class="result-pilot">${l.pilot}</span>`;
        html += `<span class="result-meta">${delta > 0 ? "\u0394" + delta : ""}</span>`;
        html += `<span class="result-toggle">+</span>`;
        html += `</div>`;
        html += `<div class="result-decklist hidden" id="decklist-${idx}">`;
        // Diff from reference (if any)
        if (diff.length > 0) {
            const added = diff.filter(d => d.delta > 0);
            const removed = diff.filter(d => d.delta < 0);
            html += `<div class="diff-columns">`;
            if (removed.length > 0) {
                html += `<div class="diff-col"><div class="result-section">Out</div>`;
                for (const d of removed) {
                    html += `<div class="cluster-diff" data-card="${d.card}"><span class="minus">${d.delta}</span> ${d.card}</div>`;
                }
                html += `</div>`;
            }
            if (added.length > 0) {
                html += `<div class="diff-col"><div class="result-section">In</div>`;
                for (const d of added) {
                    html += `<div class="cluster-diff" data-card="${d.card}"><span class="plus">+${d.delta}</span> ${d.card}</div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        }
        // Full decklist
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

    // Wire card hover on diff rows
    wireCardHover(content);

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
    const wasHidden = !sidebar.classList.contains("active");
    sidebar.classList.add("active");
    if (wasHidden && dur) {
        gsap.fromTo(sidebar,
            { x: isMobile() ? 0 : 40, autoAlpha: 0 },
            { x: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out" }
        );
    } else if (wasHidden) {
        gsap.set(sidebar, { autoAlpha: 1 });
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

function wireCardHover(container) {
    const tooltipEl = document.getElementById("tooltip");
    container.querySelectorAll("[data-card]").forEach(el => {
        const cardName = el.dataset.card;
        const img = cardImageMap[cardName];
        if (!img) return;

        el.addEventListener("mouseenter", (e) => {
            tooltipEl.innerHTML = `<div class="tt-name">${cardName}</div><img src="${img}" alt="${cardName}">`;
            tooltipEl.style.display = "block";
            tooltipEl.style.opacity = "1";
            tooltipEl.style.visibility = "visible";
        });
        el.addEventListener("mousemove", (e) => {
            // Position to the left of the parent panel
            const sidebar = el.closest("#variants-sidebar") || el.closest("#detail-panel");
            if (sidebar) {
                tooltipEl.style.left = (sidebar.getBoundingClientRect().left - 210) + "px";
            } else {
                tooltipEl.style.left = (e.clientX + 16) + "px";
            }
            tooltipEl.style.top = (e.clientY - 60) + "px";
        });
        el.addEventListener("mouseleave", () => {
            tooltipEl.style.display = "none";
            tooltipEl.style.opacity = "0";
            tooltipEl.style.visibility = "hidden";
        });
    });
}

/* ── Detail panels ── */

function showArchetypeDetail(d, edges, nodeMap) {
    openPanel();
    const connected = edges.filter(e => {
        const t = typeof e.target === "object" ? e.target.id : e.target;
        return t === d.id;
    });

    const pips = (d.colors || []).map(c =>
        `<span class="mana-pip mana-pip-${c}"></span>`).join("");

    const lists = d.lists || [];

    // --- Header + Tabs ---
    let html = `<div class="panel-header">`;
    html += `<div class="panel-name">${d.name}</div>`;
    if (pips) html += `<div class="mana-pips">${pips}</div>`;
    html += `<div class="panel-meta">${(d.meta_share * 100).toFixed(1)}%`;
    html += `<span class="panel-meta-label">of the meta &middot; ${d.list_count} lists`;
    if (lists.length >= 3) {
        html += ` &middot; <span class="variants-link" id="open-variants">view variants</span>`;
    }
    html += `</span></div>`;
    html += `</div>`;

    html += `<div class="panel-tabs">`;
    html += `<button class="panel-tab active" data-tab="lists">Lists (${lists.length})</button>`;
    html += `<button class="panel-tab" data-tab="avg">Average Deck</button>`;
    html += `</div>`;

    // --- Tab: Lists (default active) ---
    html += `<div class="tab-content" id="tab-lists">`;
    html += buildListsHTML(lists);
    html += `</div>`;

    // --- Tab: Average Deck ---
    html += `<div class="tab-content hidden" id="tab-avg">`;
    html += buildAvgDeckHTML(connected, nodeMap);
    html += `</div>`;

    d3.select("#detail-content").html(html);

    // Wire up tabs
    document.querySelectorAll(".panel-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".panel-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
            const target = document.getElementById(`tab-${tab.dataset.tab}`);
            target.classList.remove("hidden");
            animateTabContent(target);
        });
    });

    // Wire up variants link
    const varLink = document.getElementById("open-variants");
    if (varLink) {
        varLink.addEventListener("click", (e) => {
            e.stopPropagation();
            openVariantsOverlay(d.name, lists, d.colors, d.medoid_index || 0, d.cluster_threshold || 6);
        });
    }

    // Wire up collapsible list toggles
    document.querySelectorAll(".result-row").forEach(row => {
        row.querySelector(".result-header").addEventListener("click", () => {
            const idx = row.dataset.idx;
            const dl = document.getElementById(`decklist-${idx}`);
            const toggle = row.querySelector(".result-toggle");
            dl.classList.toggle("hidden");
            toggle.textContent = dl.classList.contains("hidden") ? "+" : "\u2212";
        });
    });

    // Wire up card hover for image preview
    const panelTooltip = document.getElementById("tooltip");
    document.querySelectorAll(".result-card").forEach(el => {
        const cardName = el.dataset.card;
        const img = cardImageMap[cardName];
        if (!img) return;

        el.addEventListener("mouseenter", (e) => {
            panelTooltip.innerHTML = `<div class="tt-name">${cardName}</div><img src="${img}" alt="${cardName}">`;
            panelTooltip.style.display = "block";
            panelTooltip.style.opacity = "1";
            panelTooltip.style.visibility = "visible";
        });
        el.addEventListener("mousemove", (e) => {
            const panelLeft = document.getElementById("detail-panel").getBoundingClientRect().left;
            panelTooltip.style.left = (panelLeft - 210) + "px";
            panelTooltip.style.top = (e.clientY - 60) + "px";
        });
        el.addEventListener("mouseleave", () => {
            panelTooltip.style.display = "none";
            panelTooltip.style.opacity = "0";
            panelTooltip.style.visibility = "hidden";
        });
    });
}

function buildAvgDeckHTML(connected, nodeMap) {
    const cards = connected.map(edge => {
        const sid = typeof edge.source === "object" ? edge.source.id : edge.source;
        const card = nodeMap.get(sid);
        return {
            name: card ? card.name : sid,
            mainWeight: edge.main_weight || 0,
            mainAvg: edge.main_avg_copies || 0,
            sideWeight: edge.side_weight || 0,
            sideAvg: edge.side_avg_copies || 0,
        };
    });

    let html = "";
    const CORE_THRESHOLD = 0.5;

    // Mainboard
    const mainCards = cards.filter(c => c.mainWeight > 0);
    const avgMain = mainCards
        .filter(c => c.mainWeight >= CORE_THRESHOLD)
        .sort((a, b) => b.mainWeight - a.mainWeight || b.mainAvg - a.mainAvg);
    const mainTotal = avgMain.reduce((s, c) => s + Math.min(4, Math.round(c.mainAvg)), 0);
    html += `<div class="panel-section-title">Mainboard <span class="avg-deck-count">${mainTotal} cards</span></div>`;
    html += renderDeckSection(avgMain, "main");

    const mainFlex = mainCards
        .filter(c => c.mainWeight < CORE_THRESHOLD && c.mainWeight >= 0.1)
        .sort((a, b) => b.mainWeight - a.mainWeight);
    if (mainFlex.length > 0) {
        html += `<div class="panel-section-title">Main Flex Slots</div>`;
        html += renderDeckSection(mainFlex, "main");
    }

    // Sideboard
    const sideCards = cards.filter(c => c.sideWeight > 0);
    const avgSide = sideCards
        .filter(c => c.sideWeight >= CORE_THRESHOLD)
        .sort((a, b) => b.sideWeight - a.sideWeight || b.sideAvg - a.sideAvg);
    if (avgSide.length > 0) {
        const sideTotal = avgSide.reduce((s, c) => s + Math.min(4, Math.round(c.sideAvg)), 0);
        html += `<div class="panel-section-title">Sideboard <span class="avg-deck-count">${sideTotal} cards</span></div>`;
        html += renderDeckSection(avgSide, "side");
    }

    const sideFlex = sideCards
        .filter(c => c.sideWeight < CORE_THRESHOLD && c.sideWeight >= 0.1)
        .sort((a, b) => b.sideWeight - a.sideWeight);
    if (sideFlex.length > 0) {
        html += `<div class="panel-section-title">Side Flex Slots</div>`;
        html += renderDeckSection(sideFlex, "side");
    }

    return html;
}

function buildListsHTML(lists) {
    if (!lists.length) return `<div class="panel-desc">No lists available.</div>`;

    // Group lists by source (tournament)
    const bySource = {};
    lists.forEach(l => {
        const key = `${l.date} — ${l.source}`;
        if (!bySource[key]) bySource[key] = [];
        bySource[key].push(l);
    });

    let html = "";
    let idx = 0;

    for (const [tournament, tLists] of Object.entries(bySource)) {
        // Clean up tournament name for display
        const displayName = tournament.replace("MTGO ", "");
        html += `<div class="tournament-group">`;
        html += `<div class="tournament-name">${displayName}</div>`;
        html += `<ul class="results-list">`;

        for (const list of tLists) {
            html += `<li class="result-row" data-idx="${idx}">`;
            html += `<div class="result-header">`;
            html += `<span class="result-finish">${list.finish}</span>`;
            html += `<span class="result-pilot">${list.pilot}</span>`;
            html += `<span class="result-toggle">+</span>`;
            html += `</div>`;
            html += `<div class="result-decklist hidden" id="decklist-${idx}">`;
            html += `<div class="result-section">Mainboard</div>`;
            const mainEntries = Object.entries(list.mainboard).sort((a, b) => b[1] - a[1]);
            for (const [name, qty] of mainEntries) {
                html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
            }
            if (Object.keys(list.sideboard).length > 0) {
                html += `<div class="result-section">Sideboard</div>`;
                const sideEntries = Object.entries(list.sideboard).sort((a, b) => b[1] - a[1]);
                for (const [name, qty] of sideEntries) {
                    html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
                }
            }
            html += `</div></li>`;
            idx++;
        }

        html += `</ul></div>`;
    }

    return html;
}

function renderDeckSection(cards, zone) {
    const items = cards.map(card => {
        const weight = zone === "main" ? card.mainWeight : card.sideWeight;
        const avg = zone === "main" ? card.mainAvg : card.sideAvg;
        const copies = Math.min(4, Math.round(avg)); // never more than 4
        return { name: card.name, copies, weight, avg };
    }).filter(c => c.copies > 0);

    // Sort by presence % desc then copies desc
    items.sort((a, b) => b.weight - a.weight || b.copies - a.copies);

    let html = `<ul class="deck-list">`;
    for (const item of items) {
        const pct = item.weight * 100;
        const barColor = pct >= 90 ? "var(--accent)" : pct >= 70 ? "#b89a4a" : "var(--ink-faint)";
        html += `<li class="deck-row">`;
        html += `<div class="deck-bar" data-scale="${pct / 100}" style="background:${barColor}"></div>`;
        html += `<span class="deck-copies">${item.copies}</span>`;
        html += `<span class="deck-name">${item.name}</span>`;
        html += `<span class="deck-pct">${pct.toFixed(0)}%</span>`;
        html += `</li>`;
    }
    html += `</ul>`;
    return html;
}

function showCardDetail(d, edges, nodeMap) {
    openPanel();
    const connected = edges.filter(e => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        return s === d.id;
    }).sort((a, b) => b.weight - a.weight);

    const pips = (d.colors || []).map(c =>
        `<span class="mana-pip mana-pip-${c}"></span>`).join("");

    let html = `<div class="panel-header">`;
    html += `<div class="panel-name">${d.name}</div>`;
    if (pips) html += `<div class="mana-pips">${pips}</div>`;
    html += `<div class="panel-meta">${(d.meta_presence * 100).toFixed(1)}%`;
    html += `<span class="panel-meta-label">presence in the meta</span></div>`;
    html += `</div>`;

    if (d.image) html += `<img class="panel-card-image" src="${d.image}" alt="${d.name}">`;

    html += `<div class="panel-section-title">Played In</div>`;
    html += `<ul class="card-list">`;
    for (const edge of connected) {
        const tid = typeof edge.target === "object" ? edge.target.id : edge.target;
        const arch = nodeMap.get(tid);
        const name = arch ? arch.name : tid;
        html += `<li><span class="card-name">${name}</span>`;
        html += `<span class="card-stat">${edge.avg_copies.toFixed(1)}x &middot; ${(edge.weight * 100).toFixed(0)}%</span></li>`;
    }
    html += `</ul>`;
    d3.select("#detail-content").html(html);
}

function showPlayerDetail(pilot, data) {
    openPanel();

    // Collect all lists by this pilot, grouped by archetype
    const byArch = {};
    for (const node of data.nodes) {
        if (node.type !== "archetype" || !node.lists) continue;
        for (const list of node.lists) {
            if (list.pilot !== pilot) continue;
            if (!byArch[node.name]) byArch[node.name] = [];
            byArch[node.name].push(list);
        }
    }

    const totalLists = Object.values(byArch).reduce((s, l) => s + l.length, 0);
    const archCount = Object.keys(byArch).length;

    let html = `<div class="panel-header">`;
    html += `<div class="panel-name">${pilot}</div>`;
    html += `<div class="panel-meta">${totalLists}`;
    html += `<span class="panel-meta-label">${totalLists === 1 ? "list" : "lists"} &middot; ${archCount} ${archCount === 1 ? "archetype" : "archetypes"}</span></div>`;
    html += `</div>`;

    let idx = 2000 + Math.floor(Math.random() * 10000);

    for (const [archName, lists] of Object.entries(byArch).sort((a, b) => b[1].length - a[1].length)) {
        html += `<div class="tournament-group">`;
        html += `<div class="tournament-name">${archName} (${lists.length})</div>`;
        html += `<ul class="results-list">`;

        for (const list of lists) {
            html += `<li class="result-row" data-idx="${idx}">`;
            html += `<div class="result-header">`;
            html += `<span class="result-finish">${list.finish}</span>`;
            html += `<span class="result-pilot">${list.source || ""}</span>`;
            html += `<span class="result-meta">${list.date}</span>`;
            html += `<span class="result-toggle">+</span>`;
            html += `</div>`;
            html += `<div class="result-decklist hidden" id="decklist-${idx}">`;
            html += `<div class="result-section">Mainboard</div>`;
            const mainEntries = Object.entries(list.mainboard).sort((a, b) => b[1] - a[1]);
            for (const [name, qty] of mainEntries) {
                html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
            }
            if (list.sideboard && Object.keys(list.sideboard).length > 0) {
                html += `<div class="result-section">Sideboard</div>`;
                const sideEntries = Object.entries(list.sideboard).sort((a, b) => b[1] - a[1]);
                for (const [name, qty] of sideEntries) {
                    html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
                }
            }
            html += `</div></li>`;
            idx++;
        }

        html += `</ul></div>`;
    }

    d3.select("#detail-content").html(html);

    // Wire up collapsible toggles + card hover
    document.querySelectorAll("#detail-content .result-row").forEach(row => {
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
}

/* ── Drag ── */

function makeDraggable() {
    return d3.drag()
        .on("start", (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => {
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
        });
}

init();

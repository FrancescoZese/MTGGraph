const DATA_PATH = "../computed/graph.json";

let allData = null;
let simulation = null;
let cardImageMap = {}; // card name -> image URL

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

function archRadius(d) { return 8 + d.meta_share * 85; }
function cardRadius(d) { return 1.8 + d.meta_presence * 10; }

/* ── Init ── */

async function init() {
    const resp = await fetch(DATA_PATH);
    allData = await resp.json();
    // Build card name -> image lookup
    allData.nodes.forEach(n => {
        if (n.type === "card" && n.image) {
            cardImageMap[n.name] = n.image;
        }
    });

    updateStats(allData);
    renderGraph(allData);

    document.getElementById("close-panel").addEventListener("click", (e) => {
        e.stopPropagation();
        document.getElementById("detail-panel").classList.add("hidden");
    });

    const slider = document.getElementById("meta-threshold");
    const sliderLabel = document.getElementById("threshold-value");
    slider.addEventListener("input", () => {
        const pct = parseFloat(slider.value);
        sliderLabel.textContent = pct + "%";
        applyFilter(pct / 100);
    });

    // Source type filters
    document.getElementById("filter-challenge").addEventListener("change", rebuildFromFilters);
    document.getElementById("filter-league").addEventListener("change", rebuildFromFilters);
}

function rebuildFromFilters() {
    const showChallenge = document.getElementById("filter-challenge").checked;
    const showLeague = document.getElementById("filter-league").checked;

    // Filter lists in each archetype node, then recalculate
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

    // Recalculate meta_share based on filtered lists
    const totalLists = filtered.nodes
        .filter(n => n.type === "archetype")
        .reduce((s, n) => s + n.list_count, 0);

    for (const node of filtered.nodes) {
        if (node.type === "archetype") {
            node.meta_share = totalLists > 0 ? node.list_count / totalLists : 0;
        }
    }

    // Remove archetypes with 0 lists and their exclusive cards
    const activeArchIds = new Set(
        filtered.nodes.filter(n => n.type === "archetype" && n.list_count > 0).map(n => n.id)
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
    renderGraph(filtered);

    // Re-apply meta threshold slider
    const pct = parseFloat(document.getElementById("meta-threshold").value);
    if (pct > 0) {
        // Need to wait for graph to build before applying filter
        setTimeout(() => applyFilter(pct / 100), 100);
    }
}

/* ── Filter by meta threshold (opacity-based, no rebuild) ── */

let currentCardSel, currentArchSel, currentLinkSel, currentEdges, currentNodeMap;

function applyFilter(minMetaShare) {
    // Determine which archetypes pass
    const keepArchIds = new Set();
    currentArchSel.each(function(d) {
        if (d.meta_share >= minMetaShare) keepArchIds.add(d.id);
    });

    // Determine which cards are connected to a visible archetype
    const keepCardIds = new Set();
    currentEdges.forEach(e => {
        const tid = typeof e.target === "object" ? e.target.id : e.target;
        const sid = typeof e.source === "object" ? e.source.id : e.source;
        if (keepArchIds.has(tid)) keepCardIds.add(sid);
    });

    const T = 300; // transition ms

    currentArchSel.transition().duration(T)
        .attr("opacity", d => keepArchIds.has(d.id) ? 1 : 0);

    currentCardSel.transition().duration(T)
        .attr("opacity", d => keepCardIds.has(d.id) ? 0.85 : 0);

    currentLinkSel.transition().duration(T)
        .attr("stroke-opacity", d => {
            const tid = typeof d.target === "object" ? d.target.id : d.target;
            const sid = typeof d.source === "object" ? d.source.id : d.source;
            if (!keepArchIds.has(tid) && !keepArchIds.has(sid)) return 0;
            if (!keepCardIds.has(sid) && !keepCardIds.has(tid)) return 0;
            return 0.05 + d.weight * 0.1;
        });

    // Update header stats
    document.getElementById("stat-archetypes").textContent = keepArchIds.size;
    document.getElementById("stat-cards").textContent = keepCardIds.size;
    const lists = allData.nodes
        .filter(n => n.type === "archetype" && keepArchIds.has(n.id))
        .reduce((s, a) => s + a.list_count, 0);
    document.getElementById("stat-lists").textContent = lists;
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
    document.getElementById("stat-period").textContent =
        from === to ? from : `${from.slice(5)} — ${to.slice(5)}`;
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

function renderGraph(data) {
    const svg = d3.select("#graph");
    svg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight;

    svg.attr("viewBox", [0, 0, width, height]);

    const g = svg.append("g");

    svg.call(d3.zoom()
        .scaleExtent([0.15, 6])
        .on("zoom", e => g.attr("transform", e.transform)));

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

    // Simulation starts with empty data
    simulation = d3.forceSimulation(activeNodes)
        .alphaDecay(0.012)
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
            .attr("fill-opacity", 0.85)
            .attr("stroke", "none")
            .attr("cursor", "pointer")
            .call(makeDraggable())
            .transition().duration(400).attr("r", d => cardRadius(d))
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
        archEnter.transition().duration(500).attr("opacity", 1);
        archSel = archEnter.merge(archSel);

        // Update event handlers
        cardSel
            .on("mouseover", (event, d) => {
                tooltip.classed("hidden", false);
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_presence * 100).toFixed(1)}% presence</div>`;
                if (d.image) html += `<img src="${d.image}" alt="${d.name}">`;
                tooltip.html(html);
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip)
            .on("click", (event, d) => {
                event.stopPropagation();
                showCardDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
            });

        archSel
            .on("mouseover", (event, d) => {
                tooltip.classed("hidden", false);
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_share * 100).toFixed(1)}% &middot; ${d.list_count} lists</div>`;
                tooltip.html(html);
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip)
            .on("click", (event, d) => {
                event.stopPropagation();
                showArchetypeDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
            });

        // Update stored refs for filter
        currentCardSel = cardSel;
        currentArchSel = archSel;
        currentLinkSel = link;
    }

    const tooltip = d3.select("#tooltip");
    function moveTooltip(event) {
        tooltip.style("left", (event.clientX + 16) + "px")
               .style("top", (event.clientY + 16) + "px");
    }
    function hideTooltip() { tooltip.classed("hidden", true); }

    // Add nodes progressively
    let scheduleIdx = 0;
    const BATCH = 3;        // nodes per tick
    const INTERVAL = 60;    // ms between batches

    const builder = d3.interval(() => {
        if (scheduleIdx >= schedule.length) {
            builder.stop();
            return;
        }

        let added = false;
        for (let i = 0; i < BATCH && scheduleIdx < schedule.length; i++, scheduleIdx++) {
            const item = schedule[scheduleIdx];
            const node = item.node;

            // Position near a connected archetype if possible, else center
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

            // Add any edges where both endpoints are now active
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
    }, INTERVAL);

    // ── Click background to reset ──
    svg.on("click", () => {
        d3.select("#detail-panel").classed("hidden", true);
        if (cardSel) cardSel.attr("opacity", 0.85);
        if (archSel) archSel.attr("opacity", 1);
        if (link) link.attr("stroke-opacity", d => 0.05 + d.weight * 0.1);
    });

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
    cardSel.attr("opacity", n => connected.has(n.id) ? 1 : 0.06);
    archSel.attr("opacity", n => connected.has(n.id) ? 1 : 0.1);
    linkSel.attr("stroke-opacity", e => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        return (s === d.id || t === d.id) ? 0.5 : 0.01;
    });
}

/* ── Detail panels ── */

function showArchetypeDetail(d, edges, nodeMap) {
    d3.select("#detail-panel").classed("hidden", false);
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
    html += `<span class="panel-meta-label">of the meta &middot; ${d.list_count} lists</span></div>`;
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
            document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
        });
    });

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
            panelTooltip.classList.remove("hidden");
            panelTooltip.innerHTML = `<div class="tt-name">${cardName}</div><img src="${img}" alt="${cardName}">`;
        });
        el.addEventListener("mousemove", (e) => {
            // Position to the left of the panel
            const panelLeft = document.getElementById("detail-panel").getBoundingClientRect().left;
            panelTooltip.style.left = (panelLeft - 210) + "px";
            panelTooltip.style.top = (e.clientY - 60) + "px";
        });
        el.addEventListener("mouseleave", () => {
            panelTooltip.classList.add("hidden");
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
        .sort((a, b) => b.mainAvg - a.mainAvg || b.mainWeight - a.mainWeight);
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
        .sort((a, b) => b.sideAvg - a.sideAvg || b.sideWeight - a.sideWeight);
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

    // Sort by copies desc then weight desc
    items.sort((a, b) => b.copies - a.copies || b.weight - a.weight);

    let html = `<ul class="deck-list">`;
    for (const item of items) {
        const pct = item.weight * 100;
        const barColor = pct >= 90 ? "var(--accent)" : pct >= 70 ? "#b89a4a" : "var(--ink-faint)";
        html += `<li class="deck-row">`;
        html += `<div class="deck-bar" style="width:${pct}%; background:${barColor}"></div>`;
        html += `<span class="deck-copies">${item.copies}</span>`;
        html += `<span class="deck-name">${item.name}</span>`;
        html += `<span class="deck-pct">${pct.toFixed(0)}%</span>`;
        html += `</li>`;
    }
    html += `</ul>`;
    return html;
}

function showCardDetail(d, edges, nodeMap) {
    d3.select("#detail-panel").classed("hidden", false);
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

gsap.registerPlugin(Flip);

const DATA_PATH = "../computed/graph.json";

function isMobile() { return window.innerWidth <= 600; }

let allData = null;
let simulation = null;
let currentZoom = null; // d3 zoom behavior
let currentSvg = null; // d3 svg selection
let cardImageMap = {}; // card name -> image URL
let cardTypeMap = {};  // card name -> type line
let currentCardSel, currentArchSel, currentLinkSel, currentValidEdges, currentNodeMap;
let isHighlighted = false;
let metaThreshold = 0.01; // 1% default — derived from thresholdIndex
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

function archRadius(d) { return 8 + d.meta_share * 85; }
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

    // Mobile bottom sheet toggle
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
            .filter(n => n.type === "archetype" && n.list_count > 0 && n.meta_share >= minMeta)
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
        const dimmed = i >= thresholdIndex;

        if (i === thresholdIndex) html += buildThresholdLineHTML();

        html += `<div class="meta-row${dimmed ? " dimmed" : ""}" data-arch-id="${arch.id}" data-row-index="${i}">`;
        html += `<div class="meta-row-bar" data-scale="${barScale}"></div>`;
        html += `<span class="meta-row-name">${arch.name}</span>`;
        html += `<span class="meta-row-pct">${pct}%</span>`;
        html += `</div>`;
    }
    // If threshold is at the end (show all), line goes at bottom
    if (thresholdIndex >= sidebarArchs.length) html += buildThresholdLineHTML();

    container.innerHTML = html;

    animateBars(container.querySelectorAll(".meta-row-bar"));
    initThresholdDrag(container);
    buildMobileFilterChips();

    container.querySelectorAll(".meta-row").forEach(row => {
        row.addEventListener("click", () => {
            const archId = row.dataset.archId;
            const archNode = data.nodes.find(n => n.id === archId);
            if (archNode) {
                if (sheetOpen) closeMobileSheet();
                const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
                const edges = data.edges;
                showArchetypeDetail(archNode, edges, nodeMap);
                if (currentCardSel && currentArchSel && currentLinkSel && currentValidEdges) {
                    highlight(archNode, currentValidEdges, currentCardSel, currentArchSel, currentLinkSel);
                }
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

    const presets = [
        { label: "All", index: sidebarArchs.length },
        { label: "Top 10", index: Math.min(10, sidebarArchs.length) },
        { label: "Top 20", index: Math.min(20, sidebarArchs.length) },
    ];
    // Add a % preset if there are enough archetypes
    if (sidebarArchs.length > 20) {
        const idx3 = sidebarArchs.findIndex(a => a.meta_share < 0.03);
        if (idx3 > 0 && idx3 < sidebarArchs.length) {
            presets.push({ label: "> 3%", index: idx3 });
        }
    }

    container.innerHTML = presets.map(p =>
        `<button class="filter-chip${p.index === thresholdIndex ? " active" : ""}" data-idx="${p.index}">${p.label}</button>`
    ).join("");

    container.querySelectorAll(".filter-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const idx = parseInt(chip.dataset.idx);
            thresholdIndex = idx;
            metaThreshold = idx >= sidebarArchs.length
                ? 0
                : sidebarArchs[idx].meta_share + 0.0001;

            // Update active chip
            container.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");

            // Update dimming in sidebar list
            document.querySelectorAll("#meta-sidebar-list .meta-row").forEach(row => {
                row.classList.toggle("dimmed", parseInt(row.dataset.rowIndex) >= thresholdIndex);
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
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_presence * 100).toFixed(1)}% presence</div>`;
                if (d.image) html += `<img src="${d.image}" alt="${d.name}">`;
                tooltip.innerHTML = html;
                showTooltipEl();
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip)
            .on("click", (event, d) => {
                event.stopPropagation();
                if (isHighlighted) { resetHighlight(); return; }
                showCardDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
                if (isMobile()) centerOnConnected(d, validEdges);
            });

        archSel
            .on("mouseover", (event, d) => {
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_share * 100).toFixed(1)}% &middot; ${d.list_count} lists</div>`;
                tooltip.innerHTML = html;
                showTooltipEl();
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip)
            .on("click", (event, d) => {
                event.stopPropagation();
                if (isHighlighted) { resetHighlight(); return; }
                showArchetypeDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
                if (isMobile()) centerOnConnected(d, validEdges);
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

function resetHighlight() {
    closePanel();
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

    // Bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

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

function deckDistance(a, b) {
    // Count total card differences (mainboard only)
    const allCards = new Set([...Object.keys(a), ...Object.keys(b)]);
    let diff = 0;
    for (const c of allCards) diff += Math.abs((a[c] || 0) - (b[c] || 0));
    return diff;
}

function computeAvgDeck(lists) {
    const sums = {};
    for (const l of lists) {
        for (const [card, qty] of Object.entries(l.mainboard)) {
            sums[card] = (sums[card] || 0) + qty;
        }
    }
    const avg = {};
    for (const [card, total] of Object.entries(sums)) {
        avg[card] = Math.round(total / lists.length);
    }
    // Drop zero entries so they don't inflate distance calculations
    for (const card of Object.keys(avg)) {
        if (avg[card] === 0) delete avg[card];
    }
    return avg;
}

function clusterLists(lists, threshold) {
    // Simple agglomerative clustering: merge lists within threshold distance
    const clusters = lists.map((l, i) => ({
        lists: [l],
        indices: [i],
        mainboard: { ...l.mainboard }
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
            // Merge j into i
            const ci = clusters[bestI], cj = clusters[bestJ];
            ci.lists.push(...cj.lists);
            ci.indices.push(...cj.indices);
            // Recompute centroid mainboard
            const avg = {};
            for (const l of ci.lists) {
                for (const [card, qty] of Object.entries(l.mainboard)) {
                    avg[card] = (avg[card] || 0) + qty;
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

function deckDiff(deck, avg) {
    // Returns cards that differ from average (avg is already rounded integers)
    const diffs = [];
    const allCards = new Set([...Object.keys(deck), ...Object.keys(avg)]);
    for (const card of allCards) {
        const has = deck[card] || 0;
        const expected = avg[card] || 0;
        if (has !== expected) {
            diffs.push({ card, has, expected, delta: has - expected });
        }
    }
    diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return diffs;
}

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
    document.getElementById("close-variants-sidebar").onclick = closeVariantsSidebar;

    requestAnimationFrame(() => renderVariantsChart(name, lists, colors || []));
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

function renderVariantsChart(archName, lists, colors) {
    const chartContainer = document.getElementById("variants-chart");
    if (!chartContainer || lists.length < 3) return;

    const avgDeck = computeAvgDeck(lists);
    const clusters = clusterLists(lists, 6);

    for (const cl of clusters) {
        cl.distance = Math.round(deckDistance(cl.mainboard, avgDeck));
        cl.diff = deckDiff(cl.mainboard, avgDeck);
    }

    // Compute nearby archetypes — avg decks of other archetypes vs this one
    const nearbyArchs = [];
    if (allData) {
        const otherArchs = allData.nodes.filter(n =>
            n.type === "archetype" && n.name !== archName && n.lists && n.lists.length >= 3
        );
        for (const arch of otherArchs) {
            const otherAvg = computeAvgDeck(arch.lists);
            const dist = Math.round(deckDistance(otherAvg, avgDeck));
            nearbyArchs.push({ name: arch.name, colors: arch.colors || [], distance: dist });
        }
        nearbyArchs.sort((a, b) => a.distance - b.distance);
    }
    // Keep top 5 closest
    const nearby = nearbyArchs.slice(0, 5);

    const clusterMaxDist = Math.max(...clusters.map(c => c.distance), 1);
    // maxDist includes nearby archetypes so they fit in the chart
    const allDists = [...clusters.map(c => c.distance), ...nearby.map(n => n.distance)];
    const maxDist = Math.max(...allDists, 1);

    // sqrt scale: spreads clusters near center, compresses outliers
    const distScale = d3.scaleSqrt().domain([0, maxDist]).range([0, 1]);

    // Use full available space
    const rect = chartContainer.getBoundingClientRect();
    const w = rect.width || 400;
    const h = rect.height || 400;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(cx, cy) - 50;
    const minR = 30; // keep clusters away from center dot

    chartContainer.innerHTML = "";
    const svg = d3.select(chartContainer).append("svg")
        .attr("width", w).attr("height", h)
        .attr("viewBox", `0 0 ${w} ${h}`);

    // Concentric rings — placed at sqrt-scaled distances
    const ringCount = 3;
    for (let i = ringCount; i >= 1; i--) {
        const frac = i / ringCount;
        const r = minR + frac * (maxR - minR);
        svg.append("circle")
            .attr("cx", cx).attr("cy", cy).attr("r", r)
            .attr("fill", "none")
            .attr("stroke", "var(--border)")
            .attr("stroke-opacity", 0.2)
            .attr("stroke-width", 1);

        // Invert sqrt scale to get the distance value at this ring
        const label = Math.round(frac * frac * maxDist);
        svg.append("text")
            .attr("x", cx + 6).attr("y", cy - r + 14)
            .attr("font-family", "var(--font-mono)")
            .attr("font-size", 9)
            .attr("fill", "var(--ink-faint)")
            .attr("opacity", 0.5)
            .text(label + " cards");
    }

    // Prepare cluster node data for force simulation
    const clColors = colors.length > 0 ? colors : [];
    const strokeW = 3;
    const angleStep = (2 * Math.PI) / Math.max(clusters.length, 1);

    const nodes = clusters.map((cl, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const targetR = minR + distScale(cl.distance) * (maxR - minR);
        const size = 8 + Math.sqrt(cl.lists.length) * 6;
        return {
            cluster: cl,
            index: i,
            size,
            targetR,
            // Initial position along the target angle
            x: cx + Math.cos(angle) * targetR,
            y: cy + Math.sin(angle) * targetR,
        };
    });

    // Connecting lines (drawn behind clusters, updated on tick)
    const lineG = svg.append("g");
    const lines = nodes.map(() =>
        lineG.append("line")
            .attr("x1", cx).attr("y1", cy)
            .attr("stroke", "var(--border)")
            .attr("stroke-opacity", 0.15)
            .attr("stroke-width", 1)
    );

    // Track selected cluster for highlight
    let selectedG = null;

    // Build cluster visuals
    const clusterG = svg.append("g");
    const groups = nodes.map((nd) => {
        const g = clusterG.append("g")
            .attr("cursor", "pointer")
            .datum(nd);

        // Mana-colored arc border
        if (clColors.length === 0) {
            g.append("circle")
                .attr("r", nd.size)
                .attr("fill", "var(--bg)")
                .attr("stroke", "#a09888")
                .attr("stroke-width", strokeW)
                .attr("stroke-opacity", 0.5)
                .attr("class", "cluster-ring");
        } else if (clColors.length === 1) {
            g.append("circle")
                .attr("r", nd.size)
                .attr("fill", "var(--bg)")
                .attr("stroke", MANA_HEX[clColors[0]] || "#a09888")
                .attr("stroke-width", strokeW)
                .attr("stroke-opacity", 0.7)
                .attr("class", "cluster-ring");
        } else {
            g.append("circle")
                .attr("r", nd.size)
                .attr("fill", "var(--bg)")
                .attr("stroke", "none");

            const segAngle = (2 * Math.PI) / clColors.length;
            const gap = 0.08;
            clColors.forEach((c, ci) => {
                const startA = ci * segAngle - Math.PI / 2 + gap / 2;
                const endA = (ci + 1) * segAngle - Math.PI / 2 - gap / 2;
                const x1 = Math.cos(startA) * nd.size;
                const y1 = Math.sin(startA) * nd.size;
                const x2 = Math.cos(endA) * nd.size;
                const y2 = Math.sin(endA) * nd.size;
                const largeArc = segAngle - gap > Math.PI ? 1 : 0;
                g.append("path")
                    .attr("d", `M ${x1} ${y1} A ${nd.size} ${nd.size} 0 ${largeArc} 1 ${x2} ${y2}`)
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
            .attr("font-size", Math.max(11, Math.min(14, nd.size - 2)))
            .attr("font-weight", 600)
            .attr("fill", "var(--ink)")
            .text(nd.cluster.lists.length);

        // Distance label
        g.append("text")
            .attr("y", nd.size + 14)
            .attr("text-anchor", "middle")
            .attr("font-family", "var(--font-mono)")
            .attr("font-size", 9)
            .attr("fill", "var(--ink-faint)")
            .text(nd.cluster.distance === 0 ? "exact" : "\u0394" + nd.cluster.distance);

        // Click handler
        g.on("click", () => {
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
            showClusterDetail(nd.cluster, avgDeck);
        });

        return g;
    });

    // Nearby archetype ghost nodes
    const nearbyG = svg.append("g");
    const nearbyNodes = [];
    const nearbyGroups = [];

    nearby.forEach((arch, i) => {
        const angle = (i / nearby.length) * 2 * Math.PI - Math.PI / 2;
        const targetR = minR + distScale(arch.distance) * (maxR - minR);
        const size = 12;

        const nd = {
            size,
            targetR,
            isGhost: true,
            x: cx + Math.cos(angle) * targetR,
            y: cy + Math.sin(angle) * targetR,
        };
        nearbyNodes.push(nd);

        const g = nearbyG.append("g").attr("opacity", 0.35).datum(nd);

        // Mana-colored arc (same pattern, thinner)
        const nColors = arch.colors || [];
        const nStrokeW = 1.5;
        if (nColors.length === 0) {
            g.append("circle").attr("r", size)
                .attr("fill", "none").attr("stroke", "#a09888")
                .attr("stroke-width", nStrokeW).attr("stroke-opacity", 0.6)
                .attr("stroke-dasharray", "3,3");
        } else if (nColors.length === 1) {
            g.append("circle").attr("r", size)
                .attr("fill", "none").attr("stroke", MANA_HEX[nColors[0]] || "#a09888")
                .attr("stroke-width", nStrokeW).attr("stroke-opacity", 0.6)
                .attr("stroke-dasharray", "3,3");
        } else {
            const segAngle = (2 * Math.PI) / nColors.length;
            const gap = 0.12;
            nColors.forEach((c, ci) => {
                const startA = ci * segAngle - Math.PI / 2 + gap / 2;
                const endA = (ci + 1) * segAngle - Math.PI / 2 - gap / 2;
                const x1 = Math.cos(startA) * size, y1 = Math.sin(startA) * size;
                const x2 = Math.cos(endA) * size, y2 = Math.sin(endA) * size;
                const largeArc = segAngle - gap > Math.PI ? 1 : 0;
                g.append("path")
                    .attr("d", `M ${x1} ${y1} A ${size} ${size} 0 ${largeArc} 1 ${x2} ${y2}`)
                    .attr("fill", "none").attr("stroke", MANA_HEX[c] || "#a09888")
                    .attr("stroke-width", nStrokeW).attr("stroke-linecap", "round")
                    .attr("stroke-opacity", 0.6).attr("stroke-dasharray", "3,3");
            });
        }

        // Name label
        g.append("text")
            .attr("y", size + 13)
            .attr("text-anchor", "middle")
            .attr("font-family", "var(--font-display)")
            .attr("font-size", 10)
            .attr("fill", "var(--ink-faint)")
            .text(arch.name);

        // Delta label
        g.append("text")
            .attr("y", size + 24)
            .attr("text-anchor", "middle")
            .attr("font-family", "var(--font-mono)")
            .attr("font-size", 8)
            .attr("fill", "var(--ink-faint)")
            .attr("opacity", 0.6)
            .text("\u0394" + arch.distance);

        nearbyGroups.push(g);
    });

    // Force simulation: cluster nodes + ghost archetype nodes for collision
    const allSimNodes = [...nodes, ...nearbyNodes];
    const sim = d3.forceSimulation(allSimNodes)
        .force("radial", d3.forceRadial(d => d.targetR, cx, cy).strength(0.8))
        .force("collide", d3.forceCollide(d => d.size + (d.isGhost ? 16 : 8)).strength(0.9))
        .alphaDecay(0.05)
        .on("tick", () => {
            nodes.forEach((nd, i) => {
                groups[i].attr("transform", `translate(${nd.x},${nd.y})`);
                lines[i].attr("x2", nd.x).attr("y2", nd.y);
            });
            nearbyNodes.forEach((nd, i) => {
                nearbyGroups[i].attr("transform", `translate(${nd.x},${nd.y})`);
            });
        });

    // Let simulation settle quickly (no visible jitter)
    sim.stop();
    for (let t = 0; t < 120; t++) sim.tick();
    nodes.forEach((nd, i) => {
        groups[i].attr("transform", `translate(${nd.x},${nd.y})`);
        lines[i].attr("x2", nd.x).attr("y2", nd.y);
    });
    nearbyNodes.forEach((nd, i) => {
        nearbyGroups[i].attr("transform", `translate(${nd.x},${nd.y})`);
    });

    if (highlightDuration()) {
        // Animate clusters in
        groups.forEach(g => g.attr("opacity", 0));
        lines.forEach(l => l.attr("opacity", 0));
        nearbyGroups.forEach(g => g.attr("opacity", 0));

        lines.forEach((l, i) => {
            gsap.to(l.node(), { opacity: 1, duration: 0.3, delay: 0.1 + i * 0.04, ease: "power2.out" });
        });
        groups.forEach((g, i) => {
            gsap.fromTo(g.node(),
                { opacity: 0, scale: 0, transformOrigin: "center center" },
                { opacity: 1, scale: 1, duration: 0.4, delay: 0.15 + i * 0.06, ease: "back.out(1.7)" }
            );
        });
        // Ghost archetypes fade in after clusters
        const ghostDelay = 0.15 + clusters.length * 0.06 + 0.2;
        nearbyGroups.forEach((g, i) => {
            gsap.to(g.node(), { opacity: 0.35, duration: 0.5, delay: ghostDelay + i * 0.08, ease: "power2.out" });
        });
    }

    // Center dot + label — appended last so it sits on top of lines/clusters
    const centerG = svg.append("g")
        .attr("cursor", "pointer")
        .on("click", () => {
            if (selectedG) {
                selectedG.selectAll(".cluster-ring")
                    .attr("stroke-width", strokeW)
                    .attr("stroke-opacity", function() {
                        return this.tagName === "path" ? 0.75 : (clColors.length === 0 ? 0.5 : 0.7);
                    });
                selectedG = null;
            }
            showAvgDeckDetail(avgDeck, lists);
        });
    centerG.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", 14)
        .attr("fill", "var(--accent)")
        .attr("opacity", 0.7);
    svg.append("text")
        .attr("x", cx).attr("y", cy + 28)
        .attr("text-anchor", "middle")
        .attr("font-family", "var(--font-display)")
        .attr("font-size", 12)
        .attr("fill", "var(--ink-faint)")
        .attr("pointer-events", "none")
        .text("avg");
}

let clusterDeckIdx = 1000;

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

    // Diff section — two columns (out / in), grouped by card type
    if (cluster.diff.length > 0) {
        const added = cluster.diff.filter(d => d.delta > 0);
        const removed = cluster.diff.filter(d => d.delta < 0);

        // Group helper: simplify type line to broad category
        function cardCategory(name) {
            const t = (cardTypeMap[name] || "").toLowerCase();
            if (t.includes("creature")) return "Creatures";
            if (t.includes("instant")) return "Instants";
            if (t.includes("sorcery")) return "Sorceries";
            if (t.includes("land")) return "Lands";
            if (t.includes("planeswalker")) return "Planeswalkers";
            if (t.includes("artifact")) return "Artifacts";
            if (t.includes("enchantment")) return "Enchantments";
            return "Other";
        }

        function groupByType(cards) {
            const groups = {};
            for (const d of cards) {
                const cat = cardCategory(d.card);
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push(d);
            }
            return groups;
        }

        function renderDiffColumn(cards, label, cls) {
            let col = "";
            const groups = groupByType(cards);
            const order = ["Creatures", "Instants", "Sorceries", "Enchantments", "Artifacts", "Planeswalkers", "Lands", "Other"];
            for (const cat of order) {
                if (!groups[cat]) continue;
                col += `<div class="diff-type-header">${cat}</div>`;
                for (const d of groups[cat]) {
                    const sign = d.delta > 0 ? "+" : "";
                    col += `<div class="cluster-diff" data-card="${d.card}"><span class="${cls}">${sign}${d.delta}</span> ${d.card}</div>`;
                }
            }
            return col;
        }

        html += `<div class="diff-columns">`;
        if (removed.length > 0) {
            html += `<div class="diff-col"><div class="panel-section-title">Out</div>`;
            html += renderDiffColumn(removed, "Out", "minus");
            html += `</div>`;
        }
        if (added.length > 0) {
            html += `<div class="diff-col"><div class="panel-section-title">In</div>`;
            html += renderDiffColumn(added, "In", "plus");
            html += `</div>`;
        }
        html += `</div>`;
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

function showAvgDeckDetail(avgDeck, lists) {
    const sidebar = document.getElementById("variants-sidebar");
    const content = document.getElementById("variants-sidebar-content");

    // Compute sideboard average
    const sideSums = {};
    for (const l of lists) {
        if (!l.sideboard) continue;
        for (const [card, qty] of Object.entries(l.sideboard)) {
            sideSums[card] = (sideSums[card] || 0) + qty;
        }
    }
    const avgSide = {};
    for (const [card, total] of Object.entries(sideSums)) {
        const rounded = Math.round(total / lists.length);
        if (rounded > 0) avgSide[card] = rounded;
    }

    const mainTotal = Object.values(avgDeck).reduce((s, n) => s + n, 0);
    const sideTotal = Object.values(avgSide).reduce((s, n) => s + n, 0);

    let html = "";
    html += `<div class="panel-header">`;
    html += `<div class="panel-name">Average Deck</div>`;
    html += `<div class="panel-meta">${lists.length}<span class="panel-meta-label"> lists</span></div>`;
    html += `</div>`;

    // Mainboard
    html += `<div class="panel-section-title">Mainboard <span class="avg-deck-count">${mainTotal} cards</span></div>`;
    const mainEntries = Object.entries(avgDeck).sort((a, b) => b[1] - a[1]);
    for (const [name, qty] of mainEntries) {
        html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
    }

    // Sideboard
    if (Object.keys(avgSide).length > 0) {
        html += `<div class="panel-section-title" style="margin-top:24px">Sideboard <span class="avg-deck-count">${sideTotal} cards</span></div>`;
        const sideEntries = Object.entries(avgSide).sort((a, b) => b[1] - a[1]);
        for (const [name, qty] of sideEntries) {
            html += `<div class="result-card" data-card="${name}">${qty} ${name}</div>`;
        }
    }

    content.innerHTML = html;
    wireCardHover(content);

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
        const cards = content.querySelectorAll(".result-card");
        const tl = gsap.timeline();
        if (header) tl.from(header, { y: 14, autoAlpha: 0, duration: 0.35, ease: "power2.out" }, 0);
        if (titles.length) tl.from(titles, { x: -10, autoAlpha: 0, duration: 0.3, stagger: 0.06, ease: "power2.out" }, 0.12);
        if (cards.length) tl.from(cards, { x: -14, autoAlpha: 0, duration: 0.3, stagger: 0.02, ease: "power2.out" }, 0.2);
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
            openVariantsOverlay(d.name, lists, d.colors);
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

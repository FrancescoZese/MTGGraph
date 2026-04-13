gsap.registerPlugin(Flip);

const DATA_PATH = "../computed/graph.json";

function isMobile() { return window.innerWidth <= 600; }

let allData = null;
let simulation = null;
let cardImageMap = {}; // card name -> image URL
let currentCardSel, currentArchSel, currentLinkSel, currentValidEdges, currentNodeMap;
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
    // Build card name -> image lookup
    allData.nodes.forEach(n => {
        if (n.type === "card" && n.image) {
            cardImageMap[n.name] = n.image;
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
                tooltip.html(html);
                showTooltipEl();
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
                let html = `<div class="tt-name">${d.name}</div>`;
                html += `<div class="tt-stat">${(d.meta_share * 100).toFixed(1)}% &middot; ${d.list_count} lists</div>`;
                tooltip.html(html);
                showTooltipEl();
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip)
            .on("click", (event, d) => {
                event.stopPropagation();
                showArchetypeDetail(d, validEdges, nodeMap);
                highlight(d, validEdges, cardSel, archSel, link);
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
    svg.on("click", () => {
        closePanel();
        unhighlight(cardSel, archSel, link);
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

/* ── Panel open / close ── */

let panelTween = null;

function openPanel() {
    const panel = document.getElementById("detail-panel");
    panel.scrollTop = 0;
    const dur = highlightDuration();
    if (panelTween) panelTween.kill();
    panel.style.visibility = "visible";

    if (isMobile()) {
        // Slide up from bottom
        gsap.set(panel, { x: 0 });
        panelTween = gsap.to(panel, {
            y: 0, duration: dur ? 0.45 : 0, ease: "power3.out", overwrite: true
        });
    } else {
        // Slide in from right (desktop)
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
            const target = document.getElementById(`tab-${tab.dataset.tab}`);
            target.classList.remove("hidden");
            animateTabContent(target);
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

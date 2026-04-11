// web/graph.js

const DATA_PATH = "../computed/graph.json";

let allData = null;
let simulation = null;

async function init() {
    const resp = await fetch(DATA_PATH);
    allData = await resp.json();

    if (allData.time_range.from) {
        document.getElementById("date-from").value = allData.time_range.from.slice(0, 7);
    }
    if (allData.time_range.to) {
        document.getElementById("date-to").value = allData.time_range.to.slice(0, 7);
    }

    renderGraph(allData);
    setupControls();
}

function nodeColor(node) {
    if (node.type === "archetype") return "#7b2d8e";
    const colors = node.colors || [];
    if (colors.length === 0) return "#9e9e9e";
    if (colors.length > 1) return "#c8a84e";
    const map = { W: "#f9faf4", U: "#0e68ab", B: "#6b6b6b", R: "#d32029", G: "#00733e" };
    return map[colors[0]] || "#9e9e9e";
}

function nodeRadius(node) {
    if (node.type === "archetype") {
        return 10 + node.meta_share * 60;
    }
    return 3 + node.meta_presence * 20;
}

function renderGraph(data) {
    const svg = d3.select("#graph");
    svg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight - 50;

    svg.attr("viewBox", [0, 0, width, height]);

    const g = svg.append("g");

    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const nodes = data.nodes.map(n => ({ ...n }));
    const edges = data.edges.map(e => ({ ...e }));

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const validEdges = edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));

    simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(validEdges).id(d => d.id).distance(80).strength(e => e.weight * 0.3))
        .force("charge", d3.forceManyBody().strength(-120))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => nodeRadius(d) + 2));

    const link = g.append("g")
        .selectAll("line")
        .data(validEdges)
        .join("line")
        .attr("stroke", "#333")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", d => 0.5 + d.weight * 3);

    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => nodeRadius(d))
        .attr("fill", d => nodeColor(d))
        .attr("stroke", d => d.type === "archetype" ? "#a855f7" : "none")
        .attr("stroke-width", d => d.type === "archetype" ? 2 : 0)
        .attr("cursor", "pointer")
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded));

    const label = g.append("g")
        .selectAll("text")
        .data(nodes.filter(n => n.type === "archetype"))
        .join("text")
        .text(d => d.name)
        .attr("font-size", 11)
        .attr("fill", "#ccc")
        .attr("text-anchor", "middle")
        .attr("dy", d => -nodeRadius(d) - 6)
        .attr("pointer-events", "none");

    const tooltip = d3.select("#tooltip");

    node.on("mouseover", (event, d) => {
        tooltip.classed("hidden", false);
        let html = `<strong>${d.name}</strong>`;
        if (d.type === "card" && d.image) {
            html += `<br><img src="${d.image}" alt="${d.name}">`;
        }
        if (d.type === "archetype") {
            html += `<br>Meta share: ${(d.meta_share * 100).toFixed(1)}%`;
            html += `<br>Lists: ${d.list_count}`;
        }
        if (d.type === "card") {
            html += `<br>Meta presence: ${(d.meta_presence * 100).toFixed(1)}%`;
        }
        tooltip.html(html);
    })
    .on("mousemove", (event) => {
        tooltip.style("left", (event.clientX + 15) + "px")
               .style("top", (event.clientY + 15) + "px");
    })
    .on("mouseout", () => {
        tooltip.classed("hidden", true);
    });

    node.on("click", (event, d) => {
        event.stopPropagation();
        if (d.type === "archetype") {
            showArchetypeDetail(d, validEdges, nodeMap);
        } else {
            showCardDetail(d, validEdges, nodeMap);
        }
        highlightConnected(d, validEdges, node, link);
    });

    svg.on("click", () => {
        d3.select("#detail-panel").classed("hidden", true);
        node.attr("opacity", 1);
        link.attr("stroke-opacity", 0.6);
    });

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
        label
            .attr("x", d => d.x)
            .attr("y", d => d.y);
    });
}

function highlightConnected(d, edges, nodeSelection, linkSelection) {
    const connectedIds = new Set();
    connectedIds.add(d.id);

    edges.forEach(e => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        if (sourceId === d.id) connectedIds.add(targetId);
        if (targetId === d.id) connectedIds.add(sourceId);
    });

    nodeSelection.attr("opacity", n => connectedIds.has(n.id) ? 1 : 0.1);
    linkSelection.attr("stroke-opacity", e => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        return (sourceId === d.id || targetId === d.id) ? 0.8 : 0.05;
    });
}

function showArchetypeDetail(d, edges, nodeMap) {
    const panel = d3.select("#detail-panel").classed("hidden", false);
    const connectedEdges = edges.filter(e => {
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        return targetId === d.id;
    });
    connectedEdges.sort((a, b) => b.weight - a.weight);

    let html = `<h2>${d.name}</h2>`;
    html += `<div class="meta-share">${(d.meta_share * 100).toFixed(1)}% meta</div>`;
    if (d.description) html += `<p>${d.description}</p>`;
    html += `<p>${d.list_count} lists</p>`;
    html += `<h3 style="margin-top:16px">Cards</h3>`;
    html += `<ul class="card-list">`;
    for (const edge of connectedEdges) {
        const sourceId = typeof edge.source === "object" ? edge.source.id : edge.source;
        const cardNode = nodeMap.get(sourceId);
        const name = cardNode ? cardNode.name : sourceId;
        html += `<li><span>${name}</span><span class="weight">${edge.avg_copies.toFixed(1)}x (${(edge.weight * 100).toFixed(0)}%)</span></li>`;
    }
    html += `</ul>`;

    d3.select("#detail-content").html(html);
}

function showCardDetail(d, edges, nodeMap) {
    const panel = d3.select("#detail-panel").classed("hidden", false);
    const connectedEdges = edges.filter(e => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        return sourceId === d.id;
    });
    connectedEdges.sort((a, b) => b.weight - a.weight);

    let html = `<h2>${d.name}</h2>`;
    if (d.image) html += `<img src="${d.image}" style="width:200px;border-radius:8px;margin:8px 0">`;
    html += `<div class="meta-share">${(d.meta_presence * 100).toFixed(1)}% presence</div>`;
    html += `<p>CMC: ${d.cmc} | ${d.colors.join("")}</p>`;
    html += `<h3 style="margin-top:16px">Played in</h3>`;
    html += `<ul class="card-list">`;
    for (const edge of connectedEdges) {
        const targetId = typeof edge.target === "object" ? edge.target.id : edge.target;
        const archNode = nodeMap.get(targetId);
        const name = archNode ? archNode.name : targetId;
        html += `<li><span>${name}</span><span class="weight">${edge.avg_copies.toFixed(1)}x (${(edge.weight * 100).toFixed(0)}%)</span></li>`;
    }
    html += `</ul>`;

    d3.select("#detail-content").html(html);
}

function setupControls() {
    d3.select("#close-panel").on("click", () => {
        d3.select("#detail-panel").classed("hidden", true);
    });

    d3.select("#apply-filter").on("click", () => {
        const from = document.getElementById("date-from").value;
        const to = document.getElementById("date-to").value;
        if (!from || !to) return;
        // Time filtering requires regenerating graph.json with date range params.
        // For now, this is a UI placeholder - actual filtering happens in compute.py.
        renderGraph(allData);
    });

    d3.select("#reset-filter").on("click", () => {
        renderGraph(allData);
    });
}

function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

init();

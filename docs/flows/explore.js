(function () {
  var G = window.LECTOR_FLOW_GRAPH;
  if (!G) {
    document.body.textContent = "Graph data failed to load.";
    return;
  }

  var KIND_COLOR = {
    app: "var(--kind-app)",
    layer: "var(--kind-layer)",
    domain: "var(--kind-domain)",
    flow: "var(--kind-flow)",
    file: "var(--kind-file)",
    fn: "var(--kind-fn)",
    route: "var(--kind-route)",
    table: "var(--kind-table)",
  };

  var REL_LABEL = {
    contains: "contains",
    starts: "starts at",
    then: "then",
    calls: "calls",
    uses: "uses",
    opens: "opens",
    reads: "reads",
    writes: "writes",
    http: "HTTP",
    in: "in",
    meters: "meters",
  };

  var KIND_RANK = {
    domain: 0,
    flow: 1,
    route: 2,
    file: 3,
    fn: 4,
    table: 5,
    layer: 6,
    app: 7,
  };

  var byId = Object.create(null);
  G.nodes.forEach(function (n) {
    byId[n.id] = n;
  });

  var outAdj = Object.create(null);
  var inAdj = Object.create(null);
  G.edges.forEach(function (e) {
    (outAdj[e.from] || (outAdj[e.from] = [])).push(e);
    (inAdj[e.to] || (inAdj[e.to] = [])).push(e);
  });

  var state = {
    id: "app:lector",
    trail: ["app:lector"],
    selected: 0,
    pathFlow: null,
    pathIndex: -1,
    hops: 1,
    query: "",
    hitIndex: 0,
  };

  var els = {
    trail: document.getElementById("trail"),
    walk: document.getElementById("walk-body"),
    here: document.getElementById("here-card"),
    detail: document.getElementById("detail-body"),
    svg: document.getElementById("graph"),
    search: document.getElementById("search"),
    hits: document.getElementById("search-hits"),
    path: document.getElementById("path-box"),
  };

  function node(id) {
    return byId[id];
  }

  function neighbors(id) {
    var seen = Object.create(null);
    var list = [];
    function add(edge, dir) {
      var other = dir === "out" ? edge.to : edge.from;
      if (other === id || seen[other + ":" + edge.rel + ":" + dir]) return;
      if (!byId[other]) return;
      seen[other + ":" + edge.rel + ":" + dir] = 1;
      list.push({ id: other, rel: edge.rel, dir: dir, node: byId[other] });
    }
    (outAdj[id] || []).forEach(function (e) {
      add(e, "out");
    });
    (inAdj[id] || []).forEach(function (e) {
      add(e, "in");
    });
    list.sort(function (a, b) {
      var kr = (KIND_RANK[a.node.kind] || 9) - (KIND_RANK[b.node.kind] || 9);
      if (kr) return kr;
      if (a.dir !== b.dir) return a.dir === "out" ? -1 : 1;
      return a.node.label.localeCompare(b.node.label);
    });
    return list;
  }

  function uniqueNeighborIds(id, hops) {
    var out = [];
    var seen = Object.create(null);
    seen[id] = 1;
    var frontier = [id];
    for (var h = 0; h < hops; h++) {
      var next = [];
      frontier.forEach(function (fid) {
        neighbors(fid).forEach(function (n) {
          if (seen[n.id]) return;
          seen[n.id] = 1;
          out.push(n.id);
          next.push(n.id);
        });
      });
      frontier = next;
    }
    return out;
  }

  function buildTrail(id) {
    var n = byId[id];
    var t = ["app:lector"];
    if (!n || id === "app:lector") return t;
    if (n.kind === "domain") return t.concat([id]);
    if (n.domain && byId["domain:" + n.domain]) t.push("domain:" + n.domain);
    if (n.kind === "flow") return t.concat([id]);
    var flow = G.nodes.find(function (x) {
      return x.kind === "flow" && x.steps && x.steps.indexOf(id) >= 0;
    });
    if (flow) t.push(flow.id);
    if (t[t.length - 1] !== id) t.push(id);
    return t;
  }

  function walkTo(id, opts) {
    opts = opts || {};
    if (!byId[id]) return;
    if (opts.replace) {
      state.trail = buildTrail(id);
    } else if (id !== state.id) {
      var cut = state.trail.indexOf(id);
      if (cut >= 0) state.trail = state.trail.slice(0, cut + 1);
      else state.trail.push(id);
    }
    state.id = id;
    state.selected = 0;
    if (opts.keepPath) {
      state.pathFlow = opts.pathFlow || state.pathFlow;
      if (opts.pathIndex != null) state.pathIndex = opts.pathIndex;
    } else {
      state.pathFlow = byId[id] && byId[id].steps ? id : null;
      state.pathIndex = -1;
    }
    location.hash = encodeURIComponent(id);
    render();
  }

  function back() {
    if (state.trail.length < 2) return;
    state.trail.pop();
    state.id = state.trail[state.trail.length - 1];
    state.selected = 0;
    location.hash = encodeURIComponent(state.id);
    render();
  }

  function colorFor(n) {
    return KIND_COLOR[n.kind] || "var(--muted)";
  }

  function groupedWalk(list) {
    var groups = [];
    var map = Object.create(null);
    list.forEach(function (item) {
      var key = item.dir + ":" + item.rel;
      if (!map[key]) {
        map[key] = {
          key: key,
          dir: item.dir,
          rel: item.rel,
          title: item.dir === "out" ? REL_LABEL[item.rel] || item.rel : "from · " + (REL_LABEL[item.rel] || item.rel),
          items: [],
        };
        groups.push(map[key]);
      }
      map[key].items.push(item);
    });
    return groups;
  }

  function renderTrail() {
    els.trail.innerHTML = "";
    state.trail.forEach(function (id, i) {
      var n = node(id);
      if (i) {
        var sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "/";
        els.trail.appendChild(sep);
      }
      var b = document.createElement("button");
      b.textContent = n.label;
      if (i === state.trail.length - 1) b.className = "here";
      b.addEventListener("click", function () {
        walkTo(id);
      });
      els.trail.appendChild(b);
    });
  }

  function renderHere() {
    var n = node(state.id);
    els.here.innerHTML =
      '<div class="kind">' +
      n.kind +
      "</div><h3>" +
      escapeHtml(n.label) +
      "</h3>" +
      (n.summary ? "<p>" + escapeHtml(n.summary) + "</p>" : "");
  }

  function renderWalk() {
    var list = neighbors(state.id);
    var groups = groupedWalk(list);
    var html = "";
    var idx = 0;
    groups.forEach(function (g) {
      html += '<div class="group"><h3>' + escapeHtml(g.title) + "</h3>";
      g.items.forEach(function (item) {
        var sel = idx === state.selected ? " selected" : "";
        html +=
          '<button type="button" class="walk-btn' +
          sel +
          '" data-idx="' +
          idx +
          '" data-id="' +
          escapeAttr(item.id) +
          '" aria-label="' +
          escapeAttr(item.node.label) +
          '">' +
          '<span class="dot" style="background:' +
          colorFor(item.node) +
          '"></span>' +
          "<span>" +
          escapeHtml(item.node.label) +
          "</span>" +
          '<span class="meta">' +
          item.node.kind +
          "</span></button>";
        idx += 1;
      });
      html += "</div>";
    });
    if (!list.length) html = "<p>This node has no neighbors.</p>";
    els.walk.innerHTML = html;
    els.walk.querySelectorAll(".walk-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        walkTo(btn.getAttribute("data-id"));
      });
      btn.addEventListener("mouseenter", function () {
        state.selected = Number(btn.getAttribute("data-idx"));
        highlightSelected();
      });
    });
    renderPath();
  }

  function pathFlowId() {
    if (state.pathFlow && byId[state.pathFlow] && byId[state.pathFlow].steps) return state.pathFlow;
    var n = node(state.id);
    if (n && n.steps) return n.id;
    var app = byId["app:lector"];
    if (app && app.steps && app.steps.indexOf(state.id) >= 0) return "app:lector";
    var flow = G.nodes.find(function (x) {
      return x.kind === "flow" && x.steps && x.steps.indexOf(state.id) >= 0;
    });
    return flow ? flow.id : null;
  }

  function renderPath() {
    var box = els.path;
    var flowId = pathFlowId();
    if (!flowId) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    var flow = node(flowId);
    var steps = flow.steps.filter(function (id) {
      return byId[id];
    });
    box.hidden = false;
    var atEnd = state.pathIndex >= steps.length - 1 && state.pathIndex >= 0;
    var heading = flow.kind === "app" ? "First walk" : "Happy path";
    var html =
      "<h2>" +
      heading +
      "</h2><p class='path-flow'>" +
      escapeHtml(flow.label) +
      "</p><div class='path-row'>" +
      "<button type='button' id='path-prev'" +
      (state.pathIndex < 0 ? " disabled" : "") +
      ">Back one step</button>" +
      "<button type='button' id='path-next'" +
      (atEnd ? " disabled" : "") +
      ">" +
      (state.pathIndex < 0 ? "Start walk" : "Next step") +
      "</button></div>";
    steps.forEach(function (id, i) {
      var sn = node(id);
      var cur = i === state.pathIndex ? " current" : "";
      html +=
        '<button type="button" class="path-btn' +
        cur +
        '" data-step="' +
        i +
        '" data-id="' +
        escapeAttr(id) +
        '"><span class="meta">' +
        (i + 1) +
        '</span><span class="dot" style="background:' +
        colorFor(sn) +
        '"></span><span>' +
        escapeHtml(sn.label) +
        "</span></button>";
    });
    box.innerHTML = html;
    document.getElementById("path-next").addEventListener("click", function () {
      var next = state.pathIndex < 0 ? 0 : Math.min(steps.length - 1, state.pathIndex + 1);
      walkTo(steps[next], { keepPath: true, pathFlow: flowId, pathIndex: next });
    });
    document.getElementById("path-prev").addEventListener("click", function () {
      if (state.pathIndex < 0) return;
      if (state.pathIndex === 0) {
        walkTo(flowId, { keepPath: true, pathFlow: flowId, pathIndex: -1 });
        return;
      }
      var prev = state.pathIndex - 1;
      walkTo(steps[prev], { keepPath: true, pathFlow: flowId, pathIndex: prev });
    });
    box.querySelectorAll(".path-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-step"));
        walkTo(btn.getAttribute("data-id"), { keepPath: true, pathFlow: flowId, pathIndex: i });
      });
    });
  }

  function repoRoot() {
    if (typeof window.LECTOR_REPO_ROOT === "string" && window.LECTOR_REPO_ROOT) {
      return window.LECTOR_REPO_ROOT.replace(/\/$/, "");
    }
    if (location.protocol === "file:") {
      return decodeURIComponent(location.pathname || "").replace(/\/docs\/flows\/[^/]*$/, "");
    }
    return "";
  }

  function editorHref(rel) {
    var root = repoRoot();
    if (!root || !rel) return "";
    return "vscode://file" + encodeURI(root + "/" + rel.replace(/^\//, ""));
  }

  function renderDetail() {
    var n = node(state.id);
    var parts = [];
    if (n.path) {
      var local = editorHref(n.path);
      var remote = G.repo + n.path;
      var main = local || remote;
      var extra = local
        ? " <a class='ext' href='" +
          escapeAttr(remote) +
          "' target='_blank' rel='noreferrer'>GitHub</a>"
        : "";
      parts.push(
        "<dt>Path</dt><dd><a href='" +
          escapeAttr(main) +
          "'" +
          (local ? "" : " target='_blank' rel='noreferrer'") +
          "><code>" +
          escapeHtml(n.path) +
          "</code></a>" +
          extra +
          "</dd>",
      );
    }
    if (n.md) {
      parts.push("<dt>Notes</dt><dd><a href='" + n.md + "'>" + escapeHtml(n.md) + "</a></dd>");
    }
    if (n.domain) {
      parts.push(
        "<dt>App domain</dt><dd><button type='button' class='walk-btn' data-id='domain:" +
          n.domain +
          "'><span class='dot' style='background:var(--kind-domain)'></span>" +
          escapeHtml(n.domain) +
          "</button></dd>",
      );
    }
    var inFiles = (outAdj[state.id] || [])
      .filter(function (e) {
        return e.rel === "in" && byId[e.to] && byId[e.to].kind === "file";
      })
      .map(function (e) {
        return byId[e.to];
      });
    if (n.kind === "fn" && inFiles[0] && inFiles[0].path !== n.path) {
      parts.push(
        "<dt>File</dt><dd><button type='button' class='walk-btn' data-id='" +
          escapeAttr(inFiles[0].id) +
          "'><span class='dot' style='background:var(--kind-file)'></span>" +
          escapeHtml(inFiles[0].label) +
          "</button></dd>",
      );
    }
    var tables = neighbors(state.id).filter(function (x) {
      return x.node.kind === "table";
    });
    if (tables.length) {
      parts.push(
        "<dt>Tables</dt><dd><ul>" +
          tables
            .map(function (t) {
              return "<li>" + escapeHtml(t.node.label) + "</li>";
            })
            .join("") +
          "</ul></dd>",
      );
    }
    var routes = neighbors(state.id).filter(function (x) {
      return x.node.kind === "route";
    });
    if (routes.length) {
      parts.push(
        "<dt>HTTP</dt><dd><ul>" +
          routes
            .map(function (t) {
              return "<li><code>" + escapeHtml(t.node.label) + "</code></li>";
            })
            .join("") +
          "</ul></dd>",
      );
    }
    els.detail.innerHTML = parts.length ? "<dl>" + parts.join("") + "</dl>" : "<p>No extra fields.</p>";
    els.detail.querySelectorAll("[data-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        walkTo(btn.getAttribute("data-id"));
      });
    });
  }

  function renderGraph() {
    var svg = els.svg;
    var wrap = svg.parentElement;
    var w = wrap.clientWidth || 640;
    var h = wrap.clientHeight || 480;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);

    var center = { x: w / 2, y: h / 2 };
    var ids = uniqueNeighborIds(state.id, state.hops);
    var cap = 28;
    var shown = ids.slice(0, cap);
    if (node(state.id).kind === "app") {
      shown = ids.filter(function (id) {
        return byId[id] && byId[id].kind === "domain";
      });
    }
    var pos = Object.create(null);
    pos[state.id] = center;
    var r = Math.min(w, h) * 0.34;
    shown.forEach(function (id, i) {
      var a = (Math.PI * 2 * i) / shown.length - Math.PI / 2;
      pos[id] = { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
    });

    var edgeSet = [];
    shown.concat([state.id]).forEach(function (id) {
      (outAdj[id] || []).forEach(function (e) {
        if (pos[e.from] && pos[e.to]) edgeSet.push(e);
      });
    });

    var ns = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var defs = document.createElementNS(ns, "defs");
    defs.innerHTML =
      '<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path></marker>';
    svg.appendChild(defs);

    var gEdges = document.createElementNS(ns, "g");
    gEdges.setAttribute("stroke", "currentColor");
    gEdges.setAttribute("opacity", "0.28");
    gEdges.setAttribute("fill", "none");
    edgeSet.forEach(function (e) {
      var a = pos[e.from];
      var b = pos[e.to];
      var line = document.createElementNS(ns, "line");
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
      line.setAttribute("stroke-width", e.from === state.id || e.to === state.id ? "2.2" : "1");
      line.setAttribute("marker-end", "url(#arrow)");
      gEdges.appendChild(line);
    });
    svg.appendChild(gEdges);

    function drawNode(id, isCenter) {
      var n = node(id);
      var p = pos[id];
      var g = document.createElementNS(ns, "g");
      g.setAttribute("class", "node");
      g.setAttribute("data-id", id);
      var rw = isCenter ? 128 : 112;
      var rh = isCenter ? 38 : 32;
      var rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", p.x - rw / 2);
      rect.setAttribute("y", p.y - rh / 2);
      rect.setAttribute("rx", 10);
      rect.setAttribute("width", rw);
      rect.setAttribute("height", rh);
      rect.setAttribute("fill", isCenter ? "var(--primary-soft)" : "var(--card)");
      rect.setAttribute("stroke", colorFor(n));
      rect.setAttribute("stroke-width", isCenter ? 3 : 1.6);
      g.appendChild(rect);
      var t = document.createElementNS(ns, "text");
      t.setAttribute("x", p.x);
      t.setAttribute("y", p.y + 4);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", isCenter ? "12.5" : "11");
      t.setAttribute("fill", "var(--fg)");
      t.textContent = truncate(n.label, isCenter ? 22 : 18);
      g.appendChild(t);
      var tip = document.createElementNS(ns, "title");
      tip.textContent = n.label;
      g.appendChild(tip);
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (id !== state.id) walkTo(id);
      });
      svg.appendChild(g);
    }

    shown.forEach(function (id) {
      drawNode(id, false);
    });
    drawNode(state.id, true);
  }

  function highlightSelected() {
    els.walk.querySelectorAll(".walk-btn").forEach(function (btn) {
      btn.classList.toggle("selected", Number(btn.getAttribute("data-idx")) === state.selected);
    });
  }

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var hits = [];
    G.nodes.forEach(function (n) {
      var hay = (n.label + " " + (n.path || "") + " " + (n.summary || "") + " " + n.kind).toLowerCase();
      if (hay.indexOf(q) >= 0) hits.push(n);
    });
    hits.sort(function (a, b) {
      var al = a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      var bl = b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return al - bl || (KIND_RANK[a.kind] || 9) - (KIND_RANK[b.kind] || 9);
    });
    return hits.slice(0, 20);
  }

  function renderHits() {
    var hits = search(els.search.value);
    if (!els.search.value.trim() || !hits.length) {
      els.hits.classList.remove("open");
      els.hits.innerHTML = "";
      return;
    }
    state.hitIndex = Math.min(state.hitIndex, hits.length - 1);
    els.hits.innerHTML = hits
      .map(function (n, i) {
        return (
          "<button type='button' class='" +
          (i === state.hitIndex ? "active" : "") +
          "' data-id='" +
          escapeAttr(n.id) +
          "'><span class='hit-kind'>" +
          n.kind +
          "</span>" +
          escapeHtml(n.label) +
          (n.path ? " <span class='hit-kind'>" + escapeHtml(n.path) + "</span>" : "") +
          "</button>"
        );
      })
      .join("");
    els.hits.classList.add("open");
    els.hits.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        walkTo(btn.getAttribute("data-id"), { replace: false });
        els.search.value = "";
        els.hits.classList.remove("open");
      });
    });
  }

  function render() {
    renderTrail();
    renderHere();
    renderWalk();
    renderDetail();
    renderGraph();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function currentWalkList() {
    return neighbors(state.id);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== els.search) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
      return;
    }
    if (e.key === "Escape") {
      els.search.blur();
      els.hits.classList.remove("open");
      return;
    }
    if (document.activeElement === els.search) {
      var hits = search(els.search.value);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.hitIndex = Math.min(hits.length - 1, state.hitIndex + 1);
        renderHits();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.hitIndex = Math.max(0, state.hitIndex - 1);
        renderHits();
      } else if (e.key === "Enter" && hits[state.hitIndex]) {
        e.preventDefault();
        walkTo(hits[state.hitIndex].id);
        els.search.value = "";
        els.hits.classList.remove("open");
        els.search.blur();
      }
      return;
    }
    var list = currentWalkList();
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      state.selected = Math.min(list.length - 1, state.selected + 1);
      highlightSelected();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      state.selected = Math.max(0, state.selected - 1);
      highlightSelected();
    } else if (e.key === "Enter" && list[state.selected]) {
      e.preventDefault();
      walkTo(list[state.selected].id);
    } else if (e.key === "Backspace" || e.key === "u") {
      e.preventDefault();
      back();
    } else if (e.key === "1") {
      state.hops = 1;
      renderGraph();
    } else if (e.key === "2") {
      state.hops = 2;
      renderGraph();
    }
  });

  els.search.addEventListener("input", function () {
    state.hitIndex = 0;
    renderHits();
  });

  window.addEventListener("hashchange", function () {
    var id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (id && byId[id] && id !== state.id) walkTo(id, { replace: true });
  });

  window.addEventListener("resize", function () {
    renderGraph();
  });

  document.getElementById("btn-back").addEventListener("click", back);
  document.getElementById("btn-home").addEventListener("click", function () {
    walkTo("app:lector", { replace: true });
  });

  var start = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (start && byId[start]) {
    state.id = start;
    state.trail = buildTrail(start);
    state.pathFlow = byId[start].steps ? start : null;
  }

  if (G.errors && G.errors.length) {
    console.warn("Flow graph errors", G.errors);
  }

  render();
})();

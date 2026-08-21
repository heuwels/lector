#!/usr/bin/env node
/**
 * Load graph-data.js in a VM and fail if the graph is broken.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, "graph-data.js"), "utf8");
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInNewContext(code, ctx);

const G = ctx.LECTOR_FLOW_GRAPH;
if (!G) {
  console.error("LECTOR_FLOW_GRAPH is missing");
  process.exit(1);
}

const byId = new Map(G.nodes.map((n) => [n.id, n]));
const errors = [...(G.errors || [])];

if (G.nodes.length < 50) errors.push("Too few nodes: " + G.nodes.length);
if (G.edges.length < 80) errors.push("Too few edges: " + G.edges.length);

const kinds = new Set(["app", "layer", "domain", "flow", "file", "fn", "route", "table"]);
for (const n of G.nodes) {
  if (!kinds.has(n.kind)) errors.push("Bad kind " + n.kind + " on " + n.id);
  if (!n.label) errors.push("Missing label " + n.id);
}

const seenEdge = new Set();
for (const e of G.edges) {
  if (!byId.has(e.from)) errors.push("Edge from missing: " + e.from);
  if (!byId.has(e.to)) errors.push("Edge to missing: " + e.to);
  const k = e.from + "\t" + e.to + "\t" + e.rel;
  if (seenEdge.has(k)) errors.push("Duplicate edge " + k);
  seenEdge.add(k);
}

const degree = new Map();
for (const n of G.nodes) degree.set(n.id, 0);
for (const e of G.edges) {
  degree.set(e.from, (degree.get(e.from) || 0) + 1);
  degree.set(e.to, (degree.get(e.to) || 0) + 1);
}

const orphans = G.nodes.filter((n) => n.kind !== "app" && degree.get(n.id) === 0);
for (const n of orphans) errors.push("Orphan node " + n.id);

for (const n of G.nodes) {
  if (n.kind !== "flow" || !n.steps) continue;
  for (const id of n.steps) {
    if (!byId.has(id)) errors.push("Flow " + n.id + " step missing: " + id);
  }
}

const flows = G.nodes.filter((n) => n.kind === "flow");
for (const f of flows) {
  if (!f.domain) errors.push("Flow has no domain: " + f.id);
  else if (!byId.has("domain:" + f.domain)) errors.push("Flow domain missing: " + f.id);
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error("\n" + errors.length + " error(s). " + G.nodes.length + " nodes, " + G.edges.length + " edges.");
  process.exit(1);
}

console.log("OK " + G.nodes.length + " nodes, " + G.edges.length + " edges, " + flows.length + " flows.");

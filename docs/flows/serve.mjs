#!/usr/bin/env node
/**
 * Serve docs/flows and inject the repo root so Path links open in VS Code.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../..");
const port = Number(process.env.PORT) || 8766;

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/local-root.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end("window.LECTOR_REPO_ROOT = " + JSON.stringify(root) + ";\n");
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(dir, rel));
  if (!file.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("Flow graph: http://127.0.0.1:" + port + "/");
});

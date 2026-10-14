#!/usr/bin/env node
// OpenVAS Console — static server + reverse proxy to openvasd.
//
// openvasd does not send CORS headers, so the browser cannot talk to it
// directly from another origin. This server serves the UI and forwards every
// request under /api/ to openvasd, optionally adding the API key and the
// client certificate (mTLS) so they never have to live in the browser.
//
// Zero dependencies: `node server.mjs`.
//
// Environment:
//   PORT             port of the console              (default 8080)
//   HOST             bind address                     (default 127.0.0.1)
//   OPENVASD_URL     base URL of openvasd             (default http://127.0.0.1:3000)
//   OPENVASD_API_KEY X-API-KEY added to every request (optional)
//   OPENVASD_CERT    client certificate (PEM) for mTLS (optional)
//   OPENVASD_KEY     client key (PEM) for mTLS         (optional)
//   OPENVASD_CA      CA bundle (PEM) of openvasd       (optional)
//   CACHE_DIR        where the VT catalogue is cached   (default ./cache)

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalog } from "./catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "public");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";
const upstream = new URL(process.env.OPENVASD_URL || "http://127.0.0.1:3000");
const apiKey = process.env.OPENVASD_API_KEY || "";

const readOpt = (p) => (p ? fs.readFileSync(p) : undefined);
const tls = {
  cert: readOpt(process.env.OPENVASD_CERT),
  key: readOpt(process.env.OPENVASD_KEY),
  ca: readOpt(process.env.OPENVASD_CA),
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const isHttps = upstream.protocol === "https:";

// Direct request to openvasd from the server itself (used by the catalogue).
function request(method, pathname) {
  return new Promise((resolve, reject) => {
    const out = (isHttps ? https : http).request(
      new URL(pathname, upstream),
      { method, headers: apiKey ? { "x-api-key": apiKey } : {}, ...(isHttps ? tls : {}) },
      resolve,
    );
    out.on("error", reject);
    out.end();
  });
}

const catalog = createCatalog({ cacheDir: process.env.CACHE_DIR || path.join(here, "cache"), request });

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-cache" });
  res.end(JSON.stringify(body));
}

// /console/vts          GET  → the whole compact catalogue
// /console/vts          POST → metadata of the OIDs given as a JSON array
// /console/vts/status   GET  → build state
async function consoleApi(req, res) {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/console/vts/status") {
      await catalog.ensure().catch(() => null);
      return json(res, 200, catalog.status());
    }
    if (url.pathname !== "/console/vts") return json(res, 404, { error: "not found" });
    const map = await catalog.ensure();
    if (!map) return json(res, 503, catalog.status());
    if (req.method === "GET") return json(res, 200, [...map.values()]);
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20e6) return json(res, 413, { error: "too many OIDs" });
    }
    const oids = JSON.parse(body || "[]");
    return json(res, 200, oids.map((o) => map.get(o)).filter(Boolean));
  } catch (err) {
    return json(res, 502, { error: "openvasd unreachable", detail: err.message });
  }
}

function proxy(req, res) {
  const target = new URL(req.url.replace(/^\/api/, "") || "/", upstream);
  const headers = { ...req.headers, host: upstream.host };
  delete headers.origin;
  delete headers.referer;
  if (apiKey) headers["x-api-key"] = apiKey;

  const client = upstream.protocol === "https:" ? https : http;
  const out = client.request(
    target,
    { method: req.method, headers, ...(upstream.protocol === "https:" ? tls : {}) },
    (up) => {
      // Expose openvasd's informational headers to the UI.
      res.writeHead(up.statusCode || 502, {
        ...up.headers,
        "access-control-expose-headers": "api-version, feed-version, authentication",
      });
      up.pipe(res);
    },
  );
  out.on("error", (err) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "openvasd unreachable", detail: err.message }));
  });
  req.pipe(out);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.writeHead(200, {
    "content-type": mime[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/") || req.url === "/api") return proxy(req, res);
    if (req.url.startsWith("/console/")) return consoleApi(req, res);
    return serveStatic(req, res);
  })
  .listen(port, host, () => {
    console.log(`OpenVAS Console  → http://${host}:${port}`);
    console.log(`openvasd backend → ${upstream.href}${apiKey ? " (API key injected)" : ""}`);
    // Warm the VT catalogue so the first page load already has names and scores.
    catalog.ensure().catch((err) => console.error(`openvasd not reachable yet: ${err.message}`));
  });

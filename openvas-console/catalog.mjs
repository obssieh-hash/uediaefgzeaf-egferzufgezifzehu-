// Server-side VT catalogue.
//
// openvasd results only carry the OID of the test that produced them; the
// name, CVSS vector and solution live in the feed metadata
// (GET /vts?information=1, 100 000+ entries). Downloading that into every
// browser is not practical, so the console server fetches it once per feed
// version, keeps a compact copy on disk and answers lookups by OID.

import fs from "node:fs";
import path from "node:path";

const TAGS = [
  "severity_vector", "cvss_base_vector", "summary", "insight", "impact", "affected",
  "vuldetect", "solution", "solution_type", "qod_type", "creation_date", "last_modification",
];

function compact(vt) {
  const tag = {};
  for (const k of TAGS) if (vt.tag?.[k] != null) tag[k] = vt.tag[k];
  return {
    oid: vt.oid,
    name: vt.name,
    family: vt.family,
    category: vt.category,
    filename: vt.filename,
    tag,
    references: (vt.references || []).slice(0, 25),
    dependencies: (vt.dependencies || []).slice(0, 25),
    preferences: (vt.preferences || []).map((p) => ({ id: p.id, name: p.name, default: p.default })),
  };
}

// Feeds the top-level objects of a streamed JSON array to onObject without
// holding the whole document (hundreds of MB) in memory.
function arrayObjects(onObject) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pending = "";
  return (chunk) => {
    let start = depth >= 2 ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === 92) escaped = true; // backslash
        else if (c === 34) inString = false; // quote
        continue;
      }
      if (c === 34) inString = true;
      else if (c === 123 || c === 91) {
        // { or [
        depth++;
        if (depth === 2 && c === 123) start = i;
      } else if (c === 125 || c === 93) {
        // } or ]
        depth--;
        if (depth === 1 && c === 125) {
          onObject(JSON.parse(pending + chunk.slice(start, i + 1)));
          pending = "";
          start = -1;
        }
      }
    }
    if (depth >= 2 && start >= 0) pending += chunk.slice(start);
  };
}

export function createCatalog({ cacheDir, request }) {
  let feed = null;
  let feedCheckedAt = 0;
  let map = null;
  let mapFeed = null;
  let building = null;
  let progress = 0;
  let lastError = null;
  let lastAttempt = 0;

  async function currentFeed() {
    if (Date.now() - feedCheckedAt < 60_000 && feed) return feed;
    const res = await request("HEAD", "/health");
    res.resume();
    feed = res.headers["feed-version"] || "unknown";
    feedCheckedAt = Date.now();
    return feed;
  }

  const fileFor = (f) => path.join(cacheDir, `vts-${String(f).replace(/[^\w.-]/g, "_").slice(0, 80)}.json`);

  function build(f) {
    lastAttempt = Date.now();
    progress = 0;
    building = (async () => {
      const res = await request("GET", "/vts?information=1");
      if (res.statusCode !== 200) {
        res.resume();
        throw new Error(res.statusCode === 503 ? "le scanner charge encore son feed" : `openvasd a répondu ${res.statusCode}`);
      }
      const next = new Map();
      const feedChunk = arrayObjects((vt) => {
        if (vt?.oid) next.set(vt.oid, compact(vt));
        progress = next.size;
      });
      res.setEncoding("utf8");
      for await (const chunk of res) feedChunk(chunk);
      if (!next.size) throw new Error("catalogue vide");
      fs.mkdirSync(cacheDir, { recursive: true });
      for (const old of fs.readdirSync(cacheDir)) if (old.startsWith("vts-")) fs.rmSync(path.join(cacheDir, old));
      fs.writeFileSync(fileFor(f), JSON.stringify([...next.values()]));
      map = next;
      mapFeed = f;
      lastError = null;
      console.log(`VT catalogue ready: ${next.size} VTs (feed ${f})`);
    })()
      .catch((err) => {
        lastError = err.message;
        console.error(`VT catalogue failed: ${err.message}`);
      })
      .finally(() => (building = null));
  }

  // Returns the map when ready, otherwise starts (or waits for) a build.
  async function ensure() {
    const f = await currentFeed();
    if (map && mapFeed === f) return map;
    if (building) return null;
    const file = fileFor(f);
    if (fs.existsSync(file)) {
      map = new Map(JSON.parse(fs.readFileSync(file, "utf8")).map((v) => [v.oid, v]));
      mapFeed = f;
      return map;
    }
    if (Date.now() - lastAttempt > 30_000) build(f);
    return map; // the previous feed's catalogue is still better than nothing
  }

  return {
    ensure,
    status: () => ({
      state: map ? (building ? "updating" : "ready") : building ? "building" : lastError ? "error" : "idle",
      count: map?.size || 0,
      progress,
      feed: mapFeed,
      error: lastError,
    }),
  };
}

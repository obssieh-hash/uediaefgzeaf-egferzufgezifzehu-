// Cached views over the API: scan configs, statuses, incremental results and
// the VT catalogue used to give results a name and a CVSS severity.

import { api, labels } from "./api.js";
import { vtSeverity } from "./util.js";

const configs = new Map();
const results = new Map();
let vtIndex = null;
let vtPromise = null;
let fullCatalog = false;
let catalogInfo = null;
let vtRevision = 0;
const requested = new Set();

export function resetStore() {
  configs.clear();
  results.clear();
  signatures.clear();
  lastIds.clear();
  vtIndex = null;
  vtPromise = null;
  fullCatalog = false;
  catalogInfo = null;
  requested.clear();
}

// Run async jobs with bounded concurrency.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]).catch(() => null);
      }
    }),
  );
  return out;
}

export async function getConfig(id) {
  if (!configs.has(id)) configs.set(id, await api().getScan(id));
  return configs.get(id);
}

// One row per scan: id, label, target and current status.
export async function scanSummaries() {
  const ids = await api().listScans();
  const rows = await pool(ids, 6, async (id) => {
    const [config, status] = await Promise.all([getConfig(id).catch(() => null), api().getStatus(id)]);
    const label = labels.get(id);
    return {
      id,
      name: label.name || `Scan ${id.slice(0, 8)}`,
      created: label.created || status.start_time || 0,
      hosts: config?.target?.hosts || [],
      vts: config?.vts?.length ?? null,
      status,
    };
  });
  return rows
    .filter(Boolean)
    .sort((a, b) => (b.status.start_time || b.created) - (a.status.start_time || a.created));
}

// The scanner can report the same finding twice for one host (for instance
// once for its IP and once for a virtual host name). Identical findings are
// merged into the first one, which counts them in `dup`.
const signature = (r) => [r.type, r.oid, r.ip_address, r.port, r.protocol, r.message, r.detail?.name, r.detail?.value].join("|");
const signatures = new Map();
const lastIds = new Map();

// Fetch only the results produced since the last call (range=<next id>).
export async function getResults(id) {
  const known = results.get(id) || [];
  const from = lastIds.has(id) ? lastIds.get(id) + 1 : 0;
  const fresh = await api().getResults(id, from);
  if (!signatures.has(id)) signatures.set(id, new Map(known.map((r) => [signature(r), r])));
  const seen = signatures.get(id);
  const added = [];
  for (const r of fresh) {
    if (r.id <= (lastIds.get(id) ?? -1)) continue; // a concurrent refresh already took it
    lastIds.set(id, r.id);
    const twin = seen.get(signature(r));
    if (twin) {
      twin.dup = (twin.dup || 1) + 1;
      continue;
    }
    seen.set(signature(r), r);
    added.push(r);
  }
  const all = added.length ? (results.get(id) || known).concat(added) : results.get(id) || known;
  results.set(id, all);
  await enrich(all);
  return all;
}

export const forgetScan = (id) => {
  configs.delete(id);
  results.delete(id);
  signatures.delete(id);
  lastIds.delete(id);
};

// ---- VT catalogue -------------------------------------------------------------

// Full catalogue: only loaded on demand (VT page, family picker) or in demo.
export const vtsLoaded = () => fullCatalog;
export const shouldEnrich = () => api().mode === "demo";
export const catalogState = () => catalogInfo;
export const vtRev = () => vtRevision;

// Ask the console server for the metadata of OIDs we have not seen yet. While
// it is still building its catalogue the request fails with 503 and the OIDs
// are retried on the next refresh.
export async function enrich(list) {
  const oids = [...new Set(list.map((r) => r.oid).filter(Boolean))].filter((o) => !vtIndex?.has(o) && !requested.has(o));
  if (!oids.length) return;
  oids.forEach((o) => requested.add(o));
  try {
    const found = await api().vtLookup(oids);
    vtIndex ||= new Map();
    for (const v of found) vtIndex.set(v.oid, v);
    catalogInfo = { state: "ready" };
    if (found.length) vtRevision++;
  } catch (err) {
    oids.forEach((o) => requested.delete(o));
    catalogInfo = err.status === 503 ? { state: "building", ...(err.body || {}) } : { state: "unavailable", error: err.message };
  }
}

export function loadVts() {
  if (!vtPromise) {
    vtPromise = api()
      .vts()
      .then((list) => {
        vtIndex = new Map([...(vtIndex || []), ...list.filter((v) => v && typeof v === "object").map((v) => [v.oid, v])]);
        fullCatalog = true;
        vtRevision++;
        return vtIndex;
      })
      .catch((err) => {
        vtPromise = null;
        throw err;
      });
  }
  return vtPromise;
}

export const vt = (oid) => vtIndex?.get(oid) || null;

export function resultSeverity(r) {
  if (r.type !== "alarm") return null;
  return vtSeverity(vt(r.oid));
}

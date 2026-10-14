// Cached views over the API: scan configs, statuses, incremental results and
// the VT catalogue used to give results a name and a CVSS severity.

import { api, labels, settings } from "./api.js";
import { vtSeverity } from "./util.js";

const configs = new Map();
const results = new Map();
let vtIndex = null;
let vtPromise = null;

export function resetStore() {
  configs.clear();
  results.clear();
  vtIndex = null;
  vtPromise = null;
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

// Fetch only the results produced since the last call (range=<next id>).
export async function getResults(id) {
  const known = results.get(id) || [];
  const from = known.length ? known[known.length - 1].id + 1 : 0;
  const fresh = await api().getResults(id, from);
  const all = fresh.length ? known.concat(fresh) : known;
  results.set(id, all);
  return all;
}

export const forgetScan = (id) => {
  configs.delete(id);
  results.delete(id);
};

// ---- VT catalogue -------------------------------------------------------------

export const vtsLoaded = () => !!vtIndex;
export const shouldEnrich = () => api().mode === "demo" || settings.enrich;

export function loadVts() {
  if (!vtPromise) {
    vtPromise = api()
      .vts()
      .then((list) => {
        vtIndex = new Map(list.filter((v) => v && typeof v === "object").map((v) => [v.oid, v]));
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

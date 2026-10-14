// Aggregations over scans and results shared by the dashboard, the asset
// inventory, the reports and the scan comparison. Triage decisions (false
// positive, accepted risk…) are not part of the API, so they live locally.

import { getResults, loadVts, resultSeverity, scanSummaries, shouldEnrich, vt } from "./store.js";
import { severityLevel } from "./util.js";

// ---- Triage ---------------------------------------------------------------------

const TRIAGE_KEY = "ovc.triage";
export const TRIAGE = {
  new: { label: "À traiter", tone: "neutral" },
  confirmed: { label: "Confirmée", tone: "danger" },
  in_progress: { label: "En correction", tone: "info" },
  accepted: { label: "Risque accepté", tone: "warn" },
  false_positive: { label: "Faux positif", tone: "neutral" },
};

function loadTriage() {
  try {
    return JSON.parse(localStorage.getItem(TRIAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export const findingKey = (r) => `${r.oid}|${r.ip_address}|${r.port || ""}/${r.protocol || ""}`;
export const triageOf = (r) => loadTriage()[findingKey(r)] || "new";
export function setTriage(r, state) {
  const all = loadTriage();
  if (state === "new") delete all[findingKey(r)];
  else all[findingKey(r)] = state;
  try {
    localStorage.setItem(TRIAGE_KEY, JSON.stringify(all));
  } catch {
    /* triage kept for this session only */
  }
}
// False positives are excluded from every count and chart.
export const counted = (r) => r.type === "alarm" && triageOf(r) !== "false_positive";

// ---- Risk ----------------------------------------------------------------------------

const WEIGHT = { critical: 25, high: 10, medium: 3, low: 1, none: 1 };
export const hostRisk = (sev) => Math.min(100, Object.entries(sev).reduce((a, [k, n]) => a + (WEIGHT[k] || 0) * n, 0));

export function sevCounts(results) {
  const out = {};
  for (const r of results) if (counted(r)) {
    const k = severityLevel(resultSeverity(r)).key;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// ---- Dataset ---------------------------------------------------------------------------

export async function dataset({ limit = 30 } = {}) {
  const rows = await scanSummaries();
  if (shouldEnrich()) await loadVts().catch(() => null);
  const started = rows.filter((r) => r.status.status !== "stored").slice(0, limit);
  const sets = await Promise.all(started.map((r) => getResults(r.id).catch(() => [])));
  started.forEach((r, i) => (r.results = sets[i]));
  return { rows, started };
}

// Collapse the scans into per-host, per-VT and per-port views. A host's
// current state comes from the most recent scan that saw it.
export function aggregate(scans) {
  const chrono = [...scans].sort((a, b) => (a.status.start_time || 0) - (b.status.start_time || 0));
  const hosts = new Map();
  const vulns = new Map();
  const ports = new Map();
  const cvss = Array(11).fill(0);

  for (const s of chrono) {
    const seenHere = new Map();
    for (const r of s.results || []) {
      if (!r.ip_address) continue;
      let h = seenHere.get(r.ip_address);
      if (!h) {
        h = { ip: r.ip_address, name: r.hostname, os: null, ports: new Set(), sev: {}, max: null, findings: [], scan: s };
        seenHere.set(r.ip_address, h);
      }
      if (r.hostname && r.hostname !== r.ip_address) h.name = r.hostname;
      if (r.type === "host_detail" && r.detail?.name === "OS") h.os = r.detail.value;
      if (r.port) h.ports.add(`${r.port}/${r.protocol || "tcp"}`);
      if (!counted(r)) continue;
      const score = resultSeverity(r);
      const k = severityLevel(score).key;
      h.sev[k] = (h.sev[k] || 0) + 1;
      if (score != null && (h.max == null || score > h.max)) h.max = score;
      h.findings.push(r);
    }
    for (const [ip, h] of seenHere) {
      const prev = hosts.get(ip);
      const history = [...(prev?.history || []), { scan: s, sev: h.sev, risk: hostRisk(h.sev) }];
      hosts.set(ip, { ...h, os: h.os || prev?.os || null, name: h.name || prev?.name, firstSeen: prev?.firstSeen || s.status.start_time, lastSeen: s.status.start_time, scans: (prev?.scans || 0) + 1, history, risk: hostRisk(h.sev) });
    }
  }

  // VTs and ports reflect the latest state of each host.
  for (const h of hosts.values()) {
    for (const r of h.findings) {
      const score = resultSeverity(r);
      const v = vulns.get(r.oid) || { oid: r.oid, name: vt(r.oid)?.name || r.oid, family: vt(r.oid)?.family || "—", score, hosts: new Set(), count: 0, cves: (vt(r.oid)?.references || []).filter((x) => x.class === "cve").map((x) => x.id) };
      v.hosts.add(h.ip);
      v.count++;
      vulns.set(r.oid, v);
      if (score != null) cvss[Math.min(10, Math.floor(score))]++;
      if (r.port) {
        const key = `${r.port}/${r.protocol || "tcp"}`;
        const p = ports.get(key) || { port: key, count: 0, hosts: new Set() };
        p.count++;
        p.hosts.add(h.ip);
        ports.set(key, p);
      }
    }
  }

  const hostList = [...hosts.values()].sort((a, b) => b.risk - a.risk || (b.max ?? -1) - (a.max ?? -1));
  const sev = {};
  for (const h of hostList) for (const [k, n] of Object.entries(h.sev)) sev[k] = (sev[k] || 0) + n;
  const risk = hostList.length ? Math.round(hostList.reduce((a, h) => a + h.risk, 0) / hostList.length) : 0;
  const os = new Map();
  for (const h of hostList) {
    const name = (h.os || "Non détecté").replace(/\s+\d.*$/, "") || "Non détecté";
    os.set(name, (os.get(name) || 0) + 1);
  }

  return {
    chrono,
    hosts: hostList,
    vulns: [...vulns.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.hosts.size - a.hosts.size),
    ports: [...ports.values()].sort((a, b) => b.count - a.count),
    os: [...os.entries()].sort((a, b) => b[1] - a[1]),
    cvss,
    sev,
    risk,
  };
}

// Findings of scan B compared with scan A, keyed by VT + host + port.
export function compare(a, b) {
  const map = (s) => new Map((s.results || []).filter(counted).map((r) => [findingKey(r), r]));
  const A = map(a);
  const B = map(b);
  return {
    added: [...B].filter(([k]) => !A.has(k)).map(([, r]) => r),
    fixed: [...A].filter(([k]) => !B.has(k)).map(([, r]) => r),
    kept: [...B].filter(([k]) => A.has(k)).map(([, r]) => r),
  };
}

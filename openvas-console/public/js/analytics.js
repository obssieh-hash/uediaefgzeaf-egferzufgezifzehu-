// Aggregations over scans and results shared by the dashboard, the asset
// inventory, the reports, the remediation plan and the scan comparison.
// Triage and remediation decisions are team data (see team.js).

import { api, labels } from "./api.js";
import { getResults, loadVts, resultSeverity, scanSummaries, shouldEnrich, vt } from "./store.js";
import { call, currentUser, refreshTeam, team } from "./team.js";
import { severityLevel } from "./util.js";

// ---- Triage and remediation ---------------------------------------------------------

export const TRIAGE = {
  new: { label: "À traiter", tone: "neutral", open: true },
  confirmed: { label: "Confirmée", tone: "danger", open: true },
  in_progress: { label: "En correction", tone: "info", open: true },
  fixed: { label: "Corrigée", tone: "ok", open: false },
  accepted: { label: "Risque accepté", tone: "warn", open: false },
  false_positive: { label: "Faux positif", tone: "neutral", open: false },
};

export const findingKey = (r) => `${r.oid}|${r.ip_address}|${r.port || ""}/${r.protocol || ""}`;
export const triageRecord = (r) => {
  const t = team.get("triage", findingKey(r));
  return typeof t === "string" ? { state: t } : t || { state: "new" };
};
export const triageOf = (r) => triageRecord(r).state || "new";
export const isOpen = (r) => TRIAGE[triageOf(r)]?.open !== false;

// Merges a change into the finding's record and keeps a history of state
// changes and comments (who, when) for the audit trail and the MTTR.
export function updateFinding(r, patch, comment) {
  const prev = triageRecord(r);
  const by = currentUser().username;
  const at = new Date().toISOString();
  const next = { ...prev, ...patch, updatedBy: by, updatedAt: at };
  next.history = [...(prev.history || [])];
  if (patch.state && patch.state !== prev.state) next.history.push({ at, by, state: patch.state });
  if (patch.owner !== undefined && patch.owner !== prev.owner) next.history.push({ at, by, owner: patch.owner || null });
  if (patch.due !== undefined && patch.due !== prev.due) next.history.push({ at, by, due: patch.due || null });
  if (comment) next.comments = [...(prev.comments || []), { at, by, text: comment }];
  if (next.state === "fixed" && prev.state !== "fixed") next.fixedAt = at;
  return team.set("triage", findingKey(r), next);
}
export const setTriage = (r, state) => updateFinding(r, { state });

// ---- Fix verification ------------------------------------------------------------------

export const VERIFY = {
  running: { label: "Vérification en cours", tone: "info", icon: "refresh" },
  verified: { label: "Correction vérifiée", tone: "ok", icon: "check" },
  failed: { label: "Toujours présente", tone: "danger", icon: "alert" },
  error: { label: "Vérification impossible", tone: "warn", icon: "alert" },
};

// Asks the console server for a targeted re-scan of this finding. In demo
// mode the outcome is simulated after a few seconds.
export async function requestVerification(r, sourceScan) {
  const key = findingKey(r);
  const v = vt(r.oid);
  if (team.remote()) {
    const out = await call("POST", "/console/verify", {
      key, oid: r.oid, ip: r.ip_address, port: r.port || null, protocol: r.protocol || null,
      sourceScan, family: v?.family || "", name: v?.name || r.oid,
    });
    await refreshTeam().catch(() => null);
    return out;
  }
  const started = { ...triageRecord(r), verification: { status: "running", startedAt: new Date().toISOString(), by: currentUser().username } };
  await team.set("triage", key, started);
  setTimeout(async () => {
    const ok = (r.id * 7 + r.oid.length) % 5 !== 0; // most demo fixes hold
    const rec = triageRecord(r);
    const at = new Date().toISOString();
    const by = "vérification automatique";
    await team.set("triage", key, {
      ...rec,
      state: ok ? "fixed" : "confirmed",
      ...(ok ? { verifiedAt: at } : { fixedAt: undefined }),
      verification: { ...rec.verification, status: ok ? "verified" : "failed", finishedAt: at },
      history: [...(rec.history || []), { at, by, state: ok ? "fixed" : "confirmed", note: ok ? "correction confirmée par un scan ciblé" : "toujours présente : vulnérabilité rouverte" }],
    });
    window.dispatchEvent(new CustomEvent("ovc:team"));
  }, 6000);
  return { scan: null, simulated: true };
}

// False positives are excluded from every count and chart.
export const counted = (r) => r.type === "alarm" && triageOf(r) !== "false_positive";

// ---- Assets ------------------------------------------------------------------------------

export const CRITICALITY = {
  critical: { label: "Critique", factor: 1.4 },
  high: { label: "Haute", factor: 1.2 },
  medium: { label: "Moyenne", factor: 1 },
  low: { label: "Basse", factor: 0.8 },
};
export const assetRecord = (ip) => team.get("assets", ip) || {};
export const assetFactor = (ip) => CRITICALITY[assetRecord(ip).criticality || "medium"].factor;

// ---- Threat intelligence (CISA KEV, EPSS) ---------------------------------------------------

const intelCache = new Map();
const intelAsked = new Set();
let intelRev = 0;
export const intelRevision = () => intelRev;

export const cvesOf = (r) => (vt(r.oid)?.references || []).filter((x) => x.class === "cve").map((x) => x.id);

export async function loadIntel(results) {
  const cves = [...new Set(results.filter((r) => r.type === "alarm").flatMap(cvesOf))].filter((c) => !intelAsked.has(c));
  if (!cves.length || !api().intel) return;
  cves.forEach((c) => intelAsked.add(c));
  try {
    const found = await api().intel(cves);
    for (const [c, v] of Object.entries(found || {})) intelCache.set(c, v);
    intelRev++;
  } catch {
    cves.forEach((c) => intelAsked.delete(c));
  }
}

// Strongest signal among the CVEs of a finding.
export function intelOf(r) {
  let kev = null;
  let epss = null;
  for (const c of cvesOf(r)) {
    const i = intelCache.get(c);
    if (!i) continue;
    if (i.kev && !kev) kev = { cve: c, ...i.kev };
    if (i.epss != null && (epss == null || i.epss > epss)) epss = i.epss;
  }
  return { kev, epss };
}

// ---- Priority and SLA --------------------------------------------------------------------------

// 0-100: CVSS, raised when exploited in the wild (KEV) or likely to be
// (EPSS), weighted by the business criticality of the asset.
export function priorityScore(r) {
  const cvss = resultSeverity(r) ?? 5;
  const { kev, epss } = intelOf(r);
  let p = cvss * 10 + (kev ? 25 : 0) + (epss || 0) * 20;
  p *= assetFactor(r.ip_address);
  return Math.max(0, Math.min(100, Math.round(p)));
}

export function priorityLevel(score, r) {
  if (score >= 85 || (r && intelOf(r).kev && (resultSeverity(r) ?? 0) >= 7)) return { key: "P1", label: "P1 — Immédiate", tone: "danger" };
  if (score >= 65) return { key: "P2", label: "P2 — Haute", tone: "warn" };
  if (score >= 40) return { key: "P3", label: "P3 — Normale", tone: "info" };
  return { key: "P4", label: "P4 — Basse", tone: "neutral" };
}

// Due date: chosen by an analyst, else first detection + SLA of the severity.
export function dueDate(r, firstSeen) {
  const rec = triageRecord(r);
  if (rec.due) return new Date(rec.due).getTime();
  const level = severityLevel(resultSeverity(r)).key;
  const days = team.settings().sla[level] ?? team.settings().sla.low;
  return (firstSeen || Date.now() / 1000) * 1000 + days * 86_400_000;
}

export function slaState(r, firstSeen) {
  if (!isOpen(r)) return { key: "closed", label: "Clôturée", tone: "ok" };
  const left = (dueDate(r, firstSeen) - Date.now()) / 86_400_000;
  if (left < 0) return { key: "overdue", label: `En retard de ${Math.ceil(-left)} j`, tone: "danger", days: left };
  if (left <= 7) return { key: "soon", label: `Échéance dans ${Math.ceil(left)} j`, tone: "warn", days: left };
  return { key: "ok", label: `Dans les délais (${Math.ceil(left)} j)`, tone: "ok", days: left };
}

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
  // Targeted verification scans only re-test one finding: keep them out of
  // the statistics, which describe full scans.
  const started = rows.filter((r) => r.status.status !== "stored" && !labels.get(r.id).verification && !labels.get(r.id).kind).slice(0, limit);
  const sets = await Promise.all(started.map((r) => getResults(r.id).catch(() => [])));
  started.forEach((r, i) => (r.results = sets[i]));
  await loadIntel(sets.flat());
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
      const risk = Math.min(100, Math.round(hostRisk(h.sev) * assetFactor(ip)));
      hosts.set(ip, { ...h, os: h.os || prev?.os || null, name: h.name || prev?.name, firstSeen: prev?.firstSeen || s.status.start_time, lastSeen: s.status.start_time, scans: (prev?.scans || 0) + 1, history, risk });
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

// ---- Remediation plan ----------------------------------------------------------------------------

// Current findings (latest scan of each host) with their first detection,
// priority and SLA, plus findings that disappeared from a later scan of the
// same host (resolved, verified by the scanner).
export function remediation(scans) {
  const chrono = [...scans].sort((a, b) => (a.status.start_time || 0) - (b.status.start_time || 0));
  const firstSeen = new Map();
  const latestByHost = new Map();
  const seenByHost = new Map();
  for (const s of chrono) {
    for (const r of s.results || []) {
      if (!r.ip_address) continue;
      latestByHost.set(r.ip_address, s);
      if (r.type !== "alarm") continue;
      const k = findingKey(r);
      if (!firstSeen.has(k)) firstSeen.set(k, s.status.start_time);
      if (!seenByHost.has(r.ip_address)) seenByHost.set(r.ip_address, new Map());
      seenByHost.get(r.ip_address).set(k, { r, scan: s });
    }
  }
  const items = [];
  const resolved = [];
  for (const [ip, scan] of latestByHost) {
    const current = new Map();
    for (const r of scan.results || []) if (r.type === "alarm" && r.ip_address === ip) current.set(findingKey(r), r);
    for (const [k, r] of current) {
      const first = firstSeen.get(k);
      const score = priorityScore(r);
      items.push({ key: k, r, scan, firstSeen: first, score, priority: priorityLevel(score, r), sla: slaState(r, first), intel: intelOf(r), record: triageRecord(r) });
    }
    for (const [k, seen] of seenByHost.get(ip) || []) {
      if (!current.has(k) && seen.scan !== scan) resolved.push({ key: k, r: seen.r, firstSeen: firstSeen.get(k), resolvedAt: scan.status.start_time, scan });
    }
  }
  items.sort((a, b) => b.score - a.score || (resultSeverity(b.r) ?? -1) - (resultSeverity(a.r) ?? -1));

  // Mean time to remediate, in days: findings marked fixed by an analyst and
  // findings that disappeared from a later scan.
  const durations = [];
  for (const it of items) if (it.record.fixedAt && it.firstSeen) durations.push((Date.parse(it.record.fixedAt) / 1000 - it.firstSeen) / 86400);
  for (const it of resolved) if (it.firstSeen) durations.push((it.resolvedAt - it.firstSeen) / 86400);
  const mttr = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  return { items, resolved, mttr };
}

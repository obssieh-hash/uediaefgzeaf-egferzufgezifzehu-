// Rapport consolidé (tous les scans ou un scan), imprimable en PDF.
import { api } from "../api.js";
import { BRAND } from "../app.js";
import { group } from "../results.js";
import {
  esc, icon, gauge, riskScore, riskLabel, donut, legend, bars, LEVEL_COLOR, LEVEL_LABEL, sevBadge, fmtDate, pct, download, toCSV,
} from "../ui.js";

export async function render(view, _p, ctx) {
  const scanId = ctx.query.get("scan") || "";
  const [scans, info] = await Promise.all([api.get("/scans"), api.get("/info")]);
  const chosen = scanId ? scans.filter((s) => s.id === scanId) : scans.filter((s) => s.status.status !== "stored");
  const bundles = await Promise.all(chosen.map((s) => api.get(`/scans/${s.id}`).catch(() => null)));
  if (!ctx.alive()) return;

  // Dernier résultat par (VT, hôte, port)
  const vulns = new Map(), hosts = new Map();
  for (const b of bundles.filter(Boolean)) {
    for (const h of b.hosts) hosts.set(h.ip, h);
    for (const r of group(b.results)) if (r.type === "alarm") vulns.set(`${r.oid}|${r.ip_address}|${r.port_label}`, r);
  }
  const list = [...vulns.values()].sort((a, b) => b.severity - a.severity);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  list.forEach((r) => counts[r.level]++);
  const total = list.length;
  const maxSev = Math.max(0, ...list.map((r) => r.severity || 0));
  const risk = riskScore(counts, maxSev);
  const [rl, rc] = riskLabel(risk);
  const vulnHosts = new Set(list.map((r) => r.ip_address)).size;
  const top = list[0];
  const topHosts = top ? list.filter((r) => r.oid === top.oid).length : 0;
  const segs = ["critical", "high", "medium", "low"].map((l) => ({ label: LEVEL_LABEL[l], value: counts[l], color: LEVEL_COLOR[l] }));
  segs.push({ label: "Non évaluée", value: list.filter((r) => r.severity == null).length, color: "#94a3b8" });

  // Distribution des scores CVSS (0-10 par pas de 1)
  const dist = [...Array(10)].map((_, i) => ({ label: String(i + 1), values: [{ value: list.filter((r) => Math.min(9, Math.floor(r.severity || 0)) === i && r.severity > 0).length, color: LEVEL_COLOR[i >= 9 ? "critical" : i >= 7 ? "high" : i >= 4 ? "medium" : "low"] }] }));

  // Familles
  const fam = {};
  list.forEach((r) => (fam[r.vt?.family || "Autre"] = (fam[r.vt?.family || "Autre"] || 0) + 1));
  const fams = Object.entries(fam).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Hôtes
  const hostRows = [...hosts.values()].sort((a, b) => b.max_severity - a.max_severity);

  view.className = "view";
  view.innerHTML = `
    <div class="between no-print" style="margin:4px 0 16px">
      <select class="select" data-scan style="min-width:280px"><option value="">Tous les scans (${scans.length})</option>
        ${scans.map((s) => `<option value="${esc(s.id)}" ${s.id === scanId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <div class="actions"><button class="btn" data-csv>${icon("download")}CSV</button><button class="btn btn-primary" onclick="window.print()">${icon("printer")}Imprimer / PDF</button></div>
    </div>
    <div class="hero">
      <div class="between wrap">
        <div>
          <div class="flex" style="gap:10px;margin-bottom:16px"><img src="img/logo.svg" width="38" height="38" alt=""><b style="font-size:20px;letter-spacing:-.02em">${esc(BRAND.name)}</b></div>
          <div class="eyebrow">${icon("chart")}${scanId ? "Rapport de scan" : "Rapport consolidé"}</div>
          <h1 style="font-size:22px;margin:4px 0 10px">Rapport de vulnérabilités${scanId && chosen[0] ? ` — ${esc(chosen[0].name)}` : ""}</h1>
          <div class="muted">Généré le ${fmtDate(Date.now() / 1000)} · ${chosen.length} scan(s) · feed <span class="mono">${esc((info.feed_version || "").slice(0, 10))}…</span></div>
        </div>
        ${gauge(risk, { size: 150, label: rl, color: rc })}
      </div>
    </div>

    <div class="card mt"><div class="card-h"><h3>Synthèse</h3></div><div class="card-b" style="line-height:1.75">
      <p style="margin:0 0 8px">L'ensemble des scans a porté sur <b>${hosts.size} hôte${hosts.size > 1 ? "s" : ""}</b>, dont <b>${vulnHosts}</b> présente${vulnHosts > 1 ? "nt" : ""} au moins une vulnérabilité.
        Au total, <b>${total} vulnérabilité${total > 1 ? "s" : ""}</b> ${total > 1 ? "ont été relevées" : "a été relevée"}, dont <b class="c-crit">${counts.critical} critique${counts.critical > 1 ? "s" : ""}</b> et
        <b class="c-high">${counts.high} élevée${counts.high > 1 ? "s" : ""}</b>. L'indice de risque global est de <b>${risk}/100</b> (niveau <b style="color:${rc}">${rl.toLowerCase()}</b>).</p>
      ${top ? `<p style="margin:0">Priorité n°1 : <b>${esc(top.name)}</b> (CVSS ${top.severity?.toFixed(1)}), présente sur ${topHosts} hôte${topHosts > 1 ? "s" : ""}.</p>` : "<p style='margin:0'>Aucune vulnérabilité à traiter.</p>"}
    </div></div>

    <div class="grid g4 mt">${["critical", "high", "medium", "low"].map((l) => `<div class="card sev-card" style="--c:${LEVEL_COLOR[l]}">
      <div class="kpi-h">${LEVEL_LABEL[l]}</div><div class="kpi-v">${counts[l]}</div><div class="kpi-s">${pct(counts[l], total)} % des vulnérabilités</div></div>`).join("")}</div>

    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>Répartition par sévérité</h3></div><div class="card-b donut-wrap">${donut(segs, { value: total, label: "vulnérabilités", size: 140 })}${legend(segs)}</div></div>
      <div class="card"><div class="card-h"><h3>Distribution des scores CVSS</h3></div><div class="card-b">${bars(dist, { height: 170, width: 460 })}</div></div>
    </div>

    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>Hôtes</h3></div>
        <table class="table"><thead><tr><th>Hôte</th><th>Système</th><th class="num">Vulns</th><th>Sévérité max.</th></tr></thead><tbody>
        ${hostRows.map((h) => `<tr><td class="mono strong">${esc(h.ip)}</td><td class="small">${esc(h.os || "Non détecté")}</td><td class="num">${h.vulns}</td>
          <td>${h.vulns ? sevBadge(h.level, h.max_severity) : '<span class="pill ok">Sain</span>'}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Aucun hôte</td></tr>'}</tbody></table></div>
      <div class="card"><div class="card-h"><h3>Familles les plus représentées</h3></div><div class="card-b">
        ${fams.map(([f, n]) => `<div class="hbar"><div class="hbar-top"><span>${esc(f)}</span><b>${n}</b></div><div class="bar thin"><i style="width:${pct(n, fams[0][1])}%"></i></div></div>`).join("") || '<span class="muted">—</span>'}
      </div></div>
    </div>

    <div class="card mt"><div class="card-h"><h3>Détail des vulnérabilités</h3><span class="hint">${total} entrée(s)</span></div>
      <table class="table"><thead><tr><th>Sévérité</th><th>Vulnérabilité</th><th>Hôte</th><th>Port</th><th>Solution</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td style="width:120px">${sevBadge(r.level, r.severity)}</td><td><div class="name">${esc(r.name)}</div>
        <div class="sub">${esc((r.vt?.cves || []).join(", ") || r.oid)}</div></td><td class="mono">${esc(r.ip_address)}</td><td class="mono">${esc(r.port_label)}</td>
        <td class="small" style="max-width:320px">${esc(r.vt?.solution || "—")}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Aucune vulnérabilité</td></tr>'}</tbody></table></div>`;

  view.querySelector("[data-scan]").onchange = (e) => (location.hash = e.target.value ? `#/reports?scan=${e.target.value}` : "#/reports");
  view.querySelector("[data-csv]").onclick = () => download("rapport-vulnerabilites.csv", toCSV(list, [
    ["Sévérité", (r) => r.severity], ["Niveau", (r) => LEVEL_LABEL[r.level]], ["Vulnérabilité", (r) => r.name], ["OID", (r) => r.oid],
    ["CVE", (r) => r.vt?.cves || []], ["Hôte", (r) => r.ip_address], ["Port", (r) => r.port_label], ["Solution", (r) => r.vt?.solution],
  ]), "text/csv");
}

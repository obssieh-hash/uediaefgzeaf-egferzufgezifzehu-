import { api } from "../api.js";
import { aggregate, dataset, sevCounts } from "../analytics.js";
import { chart, donut, topSlices, gauge, heatmap, hbars, mountCharts, riskLevel, SEV, SEV_NONE } from "../charts.js";
import { vt } from "../store.js";
import { applyTheme } from "../app.js";
import { dateTime, esc, icon, num, severityBadge, shortDate, shortFeed } from "../util.js";
import { empty, skeletonRows } from "../ui.js";
import { catalogNotice } from "./notice.js";

const SEV_ALL = [...SEV, SEV_NONE];
const CVSS_COLOR = (i) => (i >= 9 ? "var(--sev-critical)" : i >= 7 ? "var(--sev-high)" : i >= 4 ? "var(--sev-medium)" : "var(--sev-low)");

function summary(agg, scope) {
  const total = SEV_ALL.reduce((a, k) => a + (agg.sev[k.key] || 0), 0);
  const exposed = agg.hosts.filter((h) => h.findings.length).length;
  const crit = agg.sev.critical || 0;
  const high = agg.sev.high || 0;
  const top = agg.vulns[0];
  const lvl = riskLevel(agg.risk);
  return `<p>${scope} a porté sur <b>${num(agg.hosts.length)} hôte${agg.hosts.length > 1 ? "s" : ""}</b>, dont <b>${num(exposed)}</b> présente${exposed > 1 ? "nt" : ""} au moins une vulnérabilité.
    Au total, <b>${num(total)} vulnérabilité${total > 1 ? "s" : ""}</b> ont été relevées, dont <b style="color:var(--sev-critical)">${num(crit)} critique${crit > 1 ? "s" : ""}</b> et <b style="color:var(--sev-high)">${num(high)} élevée${high > 1 ? "s" : ""}</b>.
    L'indice de risque global est de <b>${agg.risk}/100</b> (niveau <b style="color:${lvl.color}">${lvl.label.toLowerCase()}</b>).</p>
    ${top ? `<p>Priorité n°1 : <b>${esc(top.name)}</b>${top.score != null ? ` (CVSS ${top.score.toFixed(1)})` : ""}, présente sur ${top.hosts.size} hôte${top.hosts.size > 1 ? "s" : ""}.</p>` : ""}`;
}

export default async function reports(root, scanId) {
  root.innerHTML = `<div class="card">${skeletonRows(10, 20)}</div>`;
  let data;
  let info = null;
  try {
    [data, info] = await Promise.all([dataset({ limit: 50 }), api().info().catch(() => null)]);
  } catch (err) {
    root.innerHTML = `<div class="card">${empty("alert", "Chargement impossible", err.message)}</div>`;
    return;
  }
  const selected = scanId ? data.started.find((s) => s.id === decodeURIComponent(scanId)) : null;
  const scope = selected ? [selected] : data.started;
  const agg = aggregate(scope);
  const total = SEV_ALL.reduce((a, k) => a + (agg.sev[k.key] || 0), 0);
  const trend = agg.chrono.map((s) => ({ label: s.name, title: s.name, sub: shortDate(s.status.start_time), values: sevCounts(s.results || []) }));
  const title = selected ? `Rapport — ${selected.name}` : "Rapport de vulnérabilités";
  const osColors = ["var(--accent-2)", "var(--accent)", "#a78bfa", "#f472b6"];

  root.innerHTML = `
    <div class="page-head no-print">
      <div><h1>Rapports</h1><p>Synthèse exécutive et détail technique, prêts à imprimer ou à exporter en PDF.</p></div>
      <div class="actions">
        <select class="select" id="scope" style="width:auto;max-width:300px">
          <option value="">Tous les scans (état actuel)</option>
          ${data.started.map((s) => `<option value="${esc(s.id)}" ${selected?.id === s.id ? "selected" : ""}>${esc(s.name)} · ${shortDate(s.status.start_time)}</option>`).join("")}
        </select>
        <button class="btn btn-primary" id="print">${icon("printer")}Imprimer / PDF</button>
      </div>
    </div>
    ${!data.started.length ? `<div class="card">${empty("chart", "Aucune donnée", "Lancez un scan pour générer un rapport.")}</div>` : `
    ${catalogNotice(agg.sev.none || 0)}
    <section class="card hero" style="margin-bottom:20px">
      <div class="grow">
        <div class="eyebrow">${icon("chart")} ${selected ? "Rapport de scan" : "Rapport consolidé"}</div>
        <h1>${esc(title)}</h1>
        <p>Généré le ${dateTime(Date.now() / 1000)} · ${scope.length} scan${scope.length > 1 ? "s" : ""} · feed <span class="mono">${esc(shortFeed(info?.feedVersion))}</span></p>
      </div>
      ${gauge(agg.risk)}
    </section>

    <section class="card" style="margin-bottom:20px">
      <div class="card-head"><h2>Synthèse</h2></div>
      <div class="card-body" style="font-size:15px;line-height:1.7">${summary(agg, selected ? "Ce scan" : "L'ensemble des scans")}</div>
    </section>

    <div class="grid g-4" style="margin-bottom:20px">
      ${SEV.map((k) => `<div class="card kpi" style="box-shadow:inset 0 3px 0 ${k.color}"><div class="label">${k.label}</div><div class="value">${num(agg.sev[k.key] || 0)}</div>
        <div class="foot">${total ? Math.round(((agg.sev[k.key] || 0) / total) * 100) : 0} % des vulnérabilités</div></div>`).join("")}
    </div>

    <div class="grid g-2" style="margin-bottom:20px">
      <section class="card"><div class="card-head"><h2>Répartition par sévérité</h2></div>
        <div class="card-body">${donut(SEV_ALL.map((k) => ({ label: k.label, value: agg.sev[k.key] || 0, color: k.color })), { sub: "vulnérabilités" })}</div></section>
      <section class="card"><div class="card-head"><h2>Distribution des scores CVSS</h2></div>
        <div class="card-body">${chart("histogram", { bins: agg.cvss.map((v, i) => ({ label: String(i), title: `CVSS ${i}.0 – ${i}.9`, value: v, color: CVSS_COLOR(i) })), unit: "vulnérabilités", height: 190 })}</div></section>
    </div>

    ${!selected && trend.length > 1 ? `<section class="card" style="margin-bottom:20px">
      <div class="card-head"><h2>Évolution dans le temps</h2><span class="sub">vulnérabilités par scan, du plus ancien au plus récent</span></div>
      <div class="card-body">${chart("columns", { columns: trend, keys: SEV_ALL, height: 260 })}
        <div class="chart-foot"><div class="legend">${SEV_ALL.map((k) => `<span><i style="background:${k.color}"></i>${k.label}</span>`).join("")}</div></div></div>
    </section>` : ""}

    <section class="card" style="margin-bottom:20px"><div class="card-head"><h2>Matrice de risque</h2><span class="sub">hôtes × sévérité · 15 hôtes les plus exposés</span></div>
      <div class="card-body">${heatmap(agg.hosts.filter((h) => h.findings.length).slice(0, 15).map((h) => ({ label: h.ip, sub: h.name, values: h.sev, href: `#/assets/${encodeURIComponent(h.ip)}` })), SEV_ALL)}</div></section>

    <div class="grid g-2" style="margin-bottom:20px">
      <section class="card fill"><div class="card-head"><h2>Systèmes</h2></div>
        <div class="card-body">${donut(topSlices(agg.os, 4, osColors), { sub: "hôtes", size: 136 })}</div></section>
      <section class="card fill"><div class="card-head"><h2>Familles de VT</h2></div>
        <div class="card-body">${hbars(familyBars(agg))}</div></section>
    </div>

    <section class="card" style="margin-bottom:20px">
      <div class="card-head"><h2>Vulnérabilités à corriger en priorité</h2><span class="sub">${num(agg.vulns.length)} vulnérabilités distinctes</span></div>
      ${agg.vulns.length ? `<div class="table-wrap"><table class="table"><thead><tr><th style="width:40px">#</th><th style="width:130px">Sévérité</th><th>Vulnérabilité</th><th class="num">Hôtes</th><th class="hide-sm">Solution</th></tr></thead><tbody>
        ${agg.vulns.slice(0, 20).map((v, i) => {
          const tag = vt(v.oid)?.tag || {};
          return `<tr><td class="faint">${i + 1}</td><td>${severityBadge(v.score)}</td>
            <td><div class="cell-title">${esc(v.name)}</div><div class="cell-sub">${esc(v.family)}${v.cves.length ? ` · ${v.cves.map(esc).join(", ")}` : ""}</div></td>
            <td class="num"><b>${v.hosts.size}</b></td>
            <td class="hide-sm muted" style="max-width:360px;font-size:13px">${esc(tag.solution || "—")}</td></tr>`;
        }).join("")}
      </tbody></table></div>` : empty("check", "Aucune vulnérabilité", "Aucune vulnérabilité à corriger dans ce périmètre.")}
    </section>

    <section class="card">
      <div class="card-head"><h2>Hôtes analysés</h2></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Hôte</th><th class="hide-sm">Système</th>${SEV.map((k) => `<th class="num">${k.label}</th>`).join("")}<th class="num">Risque</th></tr></thead><tbody>
        ${agg.hosts.map((h) => `<tr><td><span class="mono">${esc(h.ip)}</span><div class="cell-sub">${esc(h.name && h.name !== h.ip ? h.name : "")}</div></td>
          <td class="hide-sm">${esc(h.os || "—")}</td>
          ${SEV.map((k) => `<td class="num">${h.sev[k.key] || `<span class="faint">0</span>`}</td>`).join("")}
          <td class="num"><b style="color:${riskLevel(h.risk).color}">${h.risk}</b></td></tr>`).join("")}
      </tbody></table></div>
    </section>`}`;

  mountCharts(root);
  root.querySelector("#scope").onchange = (e) => (location.hash = e.target.value ? `#/reports/${encodeURIComponent(e.target.value)}` : "#/reports");
  root.querySelector("#print").onclick = () => {
    const theme = document.documentElement.dataset.theme;
    applyTheme("light");
    setTimeout(() => {
      window.print();
      applyTheme(theme);
    }, 150);
  };
}

function familyBars(agg) {
  const fam = new Map();
  for (const v of agg.vulns) fam.set(v.family, (fam.get(v.family) || 0) + v.count);
  return [...fam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => ({ label: f, value: n }));
}

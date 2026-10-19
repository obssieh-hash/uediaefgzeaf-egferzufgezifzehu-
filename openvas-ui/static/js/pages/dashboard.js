// Tableau de bord : indicateurs globaux.
import { api } from "../api.js";
import { store } from "../app.js";
import {
  esc, icon, pageHead, donut, legend, gauge, bars, riskScore, riskLabel, LEVEL_COLOR, LEVEL_LABEL, statusPill,
  isActive, fmtDate, sevBadge, empty, ago,
} from "../ui.js";

export async function render(view, _p, ctx) {
  const [scans, findings, assets] = await Promise.all([api.get("/scans"), api.get("/findings"), api.get("/assets")]);
  store.scans = scans;
  const open = findings.filter((f) => !["fixed", "accepted", "false_positive"].includes(f.status));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  open.forEach((f) => (counts[f.level] = (counts[f.level] || 0) + 1));
  const maxSev = Math.max(0, ...open.map((f) => f.severity || 0));
  const risk = riskScore(counts, maxSev);
  const active = scans.filter((s) => isActive(s.status.status));
  const segs = ["critical", "high", "medium", "low"].map((l) => ({ label: LEVEL_LABEL[l], value: counts[l], color: LEVEL_COLOR[l] }));

  // Top vulnérabilités (regroupées par VT)
  const byVt = new Map();
  open.forEach((f) => { const v = byVt.get(f.oid) || { ...f, hosts: new Set() }; v.hosts.add(f.host); byVt.set(f.oid, v); });
  const top = [...byVt.values()].sort((a, b) => b.severity - a.severity || b.hosts.size - a.hosts.size).slice(0, 6);

  // Activité : scans par jour sur 14 jours
  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); return d; });
  const activity = days.map((d) => {
    const from = d.getTime() / 1000, to = from + 86400;
    const day = scans.filter((s) => (s.status.start_time || 0) >= from && (s.status.start_time || 0) < to);
    return { label: d.getDate() + "", values: [
      { value: day.filter((s) => s.status.status === "succeeded").length, color: "#10b981", label: "Terminés" },
      { value: day.filter((s) => isActive(s.status.status)).length, color: "#3b82f6", label: "En cours" },
      { value: day.filter((s) => ["failed", "stopped"].includes(s.status.status)).length, color: "#f26b1d", label: "Arrêtés / échec" }] };
  });

  view.innerHTML = pageHead({
    eyebrow: "Supervision", eyeIcon: "dashboard", title: "Tableau de bord",
    sub: "Vue d'ensemble de l'exposition de votre parc, d'après les derniers scans openvasd.",
    actions: `<a class="btn" href="#/reports">${icon("chart")}Rapport</a><a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a>`,
  }) + `
    <div class="grid g4">
      ${kpi("radar", "ico-info", "Scans", scans.length, `${active.length} en cours`)}
      ${kpi("monitor", "ico-ok", "Actifs analysés", assets.length, `${assets.filter((a) => a.vulns).length} vulnérable(s)`)}
      ${kpi("alert", "ico-crit", "Vulnérabilités ouvertes", open.length, `${counts.critical} critique(s) · ${counts.high} élevée(s)`)}
      ${kpi("zap", "ico-warn", "Score CVSS max.", maxSev ? maxSev.toFixed(1) : "—", maxSev ? LEVEL_LABEL[maxSev >= 9 ? "critical" : maxSev >= 7 ? "high" : maxSev >= 4 ? "medium" : "low"] : "aucune vulnérabilité")}
    </div>
    <div class="grid g3 mt">
      <div class="card"><div class="card-h"><h3>Indice de risque global</h3></div>
        <div class="card-b" style="display:grid;place-items:center">${gauge(risk, { label: riskLabel(risk)[0], size: 170 })}
          <div class="muted small" style="text-align:center">Pondéré par le nombre et la gravité des vulnérabilités ouvertes.</div></div></div>
      <div class="card"><div class="card-h"><h3>Répartition par sévérité</h3></div>
        <div class="card-b donut-wrap">${donut(segs, { value: open.length, label: "vulnérabilités" })}${legend(segs)}</div></div>
      <div class="card"><div class="card-h"><h3>Activité</h3><span class="hint">14 derniers jours</span></div>
        <div class="card-b">${bars(activity, { height: 150, width: 360 })}
        <div class="chart-legend"><span><i style="background:#10b981"></i>Terminés</span><span><i style="background:#3b82f6"></i>En cours</span><span><i style="background:#f26b1d"></i>Arrêtés</span></div></div></div>
    </div>
    <div class="grid g-main mt">
      <div class="card"><div class="card-h"><h3>Vulnérabilités les plus graves</h3><div class="right"><a class="btn btn-sm" href="#/remediation">Remédiation</a></div></div>
        ${top.length ? `<table class="table"><tbody>${top.map((v) => `<tr>
          <td style="width:120px">${sevBadge(v.level, v.severity)}</td>
          <td><div class="name trunc" style="max-width:380px">${esc(v.name)}</div><div class="sub">${esc(v.cves.slice(0, 2).join(" · ") || v.oid)}</div></td>
          <td class="num"><span class="chip x">${v.hosts.size} hôte${v.hosts.size > 1 ? "s" : ""}</span></td></tr>`).join("")}</tbody></table>`
          : empty("Aucune vulnérabilité ouverte", "", "shieldCheck")}
      </div>
      <div class="card"><div class="card-h"><h3>Derniers scans</h3><div class="right"><a class="btn btn-sm" href="#/scans">Tous</a></div></div>
        ${scans.length ? `<table class="table"><tbody>${scans.slice(0, 6).map((s) => `<tr class="click" onclick="location.hash='#/scans/${esc(s.id)}'">
          <td><div class="name">${esc(s.name)}</div><div class="sub">${esc(ago(s.status.start_time || s.created))}</div></td>
          <td class="right">${statusPill(s.status.status)}${isActive(s.status.status) ? `<div class="small muted" style="margin-top:3px">${s.progress} %</div>` : ""}</td></tr>`).join("")}</tbody></table>`
          : empty("Aucun scan", "", "radar")}
      </div>
    </div>
    <div class="card mt"><div class="card-h"><h3>Actifs les plus exposés</h3><div class="right"><a class="btn btn-sm" href="#/assets">Tous les actifs</a></div></div>
      ${assets.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Hôte</th><th>Système</th><th>Vulnérabilités</th><th>Dernier scan</th><th style="width:120px">Sévérité max.</th></tr></thead><tbody>
      ${assets.slice(0, 5).map((a) => `<tr><td class="mono strong">${esc(a.ip)}</td><td>${esc(a.os || "Non détecté")}</td>
        <td>${a.vulns}</td><td class="small muted">${fmtDate(a.last_seen)}</td><td>${a.vulns ? sevBadge(a.level, a.max_severity) : '<span class="pill ok">Sain</span>'}</td></tr>`).join("")}
      </tbody></table></div>` : empty("Aucun actif", "", "monitor")}</div>`;

  ctx.hasActive = active.length > 0;
  if (!ctx.polling) {
    ctx.polling = true;
    ctx.every(() => { if (ctx.hasActive) render(view, _p, ctx).catch(() => {}); }, 20000);
  }
}

const kpi = (ic, cls, label, value, sub) => `<div class="card kpi">
  <div class="kpi-h"><span class="kpi-ico ${cls}">${icon(ic)}</span>${esc(label)}</div>
  <div class="kpi-v">${esc(value)}</div><div class="kpi-s">${esc(sub)}</div></div>`;

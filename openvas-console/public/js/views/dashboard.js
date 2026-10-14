import { api, settings } from "../api.js";
import { aggregate, dataset, sevCounts } from "../analytics.js";
import { chart, donut, gauge, hbars, mountCharts, riskLevel, SEV, SEV_NONE } from "../charts.js";
import { ago, duration, esc, icon, num, progress, severityBadge, shortDate, shortFeed, statusChip } from "../util.js";
import { empty, skeletonRows } from "../ui.js";
import { catalogNotice } from "./notice.js";

const SEV_ALL = [...SEV, SEV_NONE];
const CVSS_COLOR = (i) => (i >= 9 ? "var(--sev-critical)" : i >= 7 ? "var(--sev-high)" : i >= 4 ? "var(--sev-medium)" : "var(--sev-low)");

function kpi(tone, ic, label, value, foot, extra = "") {
  return `<div class="card kpi ${tone}">
    <div class="label"><span class="ico">${icon(ic)}</span>${label}</div>
    <div class="value">${value}</div><div class="foot">${foot}</div>${extra}</div>`;
}

function render(root, { rows, started }, info) {
  const running = rows.filter((r) => ["running", "requested"].includes(r.status.status));
  const agg = aggregate(started);
  const total = SEV_ALL.reduce((a, k) => a + (agg.sev[k.key] || 0), 0);
  const critHigh = (agg.sev.critical || 0) + (agg.sev.high || 0);
  const exposed = agg.hosts.filter((h) => h.findings.length).length;
  const trend = agg.chrono.slice(-12).map((s) => ({
    label: s.name,
    title: s.name,
    sub: shortDate(s.status.start_time),
    values: sevCounts(s.results || []),
    href: `#/scans/${encodeURIComponent(s.id)}`,
  }));
  const demo = api().mode === "demo";
  const lvl = riskLevel(agg.risk);

  root.innerHTML = `
    ${demo ? `<div class="banner">${icon("info")}<div class="grow">Vous explorez la console en <b>mode démo</b> : un scanner simulé fournit les données. Connectez votre openvasd dans les <a href="#/settings"><u>paramètres</u></a>.</div></div>` : ""}
    ${catalogNotice(agg.sev.none || 0)}
    <section class="card hero" style="margin-bottom:20px">
      <div>
        <div class="eyebrow">${icon("activity")} Vue d'ensemble</div>
        <h1>${running.length ? `${running.length} scan${running.length > 1 ? "s" : ""} en cours d'exécution` : "Votre surface d'attaque, en un coup d'œil"}</h1>
        <p>${!critHigh && agg.sev.none ? `${num(agg.sev.none)} vulnérabilité${agg.sev.none > 1 ? "s" : ""} en attente de score CVSS sur ${num(exposed)} hôte${exposed > 1 ? "s" : ""}.` : critHigh ? `${num(critHigh)} vulnérabilité${critHigh > 1 ? "s" : ""} critique${critHigh > 1 ? "s" : ""} ou élevée${critHigh > 1 ? "s" : ""} sur ${num(exposed)} hôte${exposed > 1 ? "s" : ""}.` : "Aucune vulnérabilité critique ou élevée sur les derniers scans."}
          Feed <span class="mono" title="${esc(info?.feedVersion || "")}">${esc(shortFeed(info?.feedVersion))}</span>.</p>
      </div>
      <div class="actions">
        <a class="btn" href="#/reports">${icon("chart")}Rapport</a>
        <a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a>
      </div>
    </section>

    <div class="grid g-4" style="margin-bottom:20px">
      ${kpi("accent", "radar", "Scans", num(rows.length), `${running.length} en cours · ${rows.filter((r) => r.status.status === "succeeded").length} terminés`)}
      ${kpi("danger", "alert", "Vulnérabilités", num(total), `${num(agg.sev.critical || 0)} critiques · ${num(agg.sev.high || 0)} élevées`)}
      ${kpi("info", "host", "Hôtes exposés", `${num(exposed)}<span class="faint" style="font-size:18px"> / ${num(agg.hosts.length)}</span>`, "avec au moins une vulnérabilité")}
      ${kpi("warn", "gauge", "Indice de risque", `${agg.risk}<span class="faint" style="font-size:18px"> / 100</span>`, `Niveau ${lvl.label.toLowerCase()}`)}
    </div>

    <div class="grid g-3" style="margin-bottom:20px">
      <section class="card fill">
        <div class="card-head"><h2>Indice de risque</h2><span class="sub">moyenne des hôtes</span></div>
        <div class="card-body stack" style="justify-items:center;gap:10px">
          ${gauge(agg.risk)}
          <p class="muted" style="margin:0;text-align:center;font-size:13px">${num(exposed)} hôte${exposed > 1 ? "s" : ""} exposé${exposed > 1 ? "s" : ""} sur ${num(agg.hosts.length)} · CVSS max ${agg.vulns[0]?.score?.toFixed(1) ?? "—"}</p>
        </div>
      </section>
      <section class="card fill">
        <div class="card-head"><h2>Sévérité</h2></div>
        <div class="card-body">${donut(SEV_ALL.map((k) => ({ label: k.label, value: agg.sev[k.key] || 0, color: k.color })), { sub: "vulnérabilités", size: 140 })}</div>
      </section>
      <section class="card fill">
        <div class="card-head"><h2>Distribution CVSS</h2></div>
        <div class="card-body">${chart("histogram", {
          bins: agg.cvss.map((v, i) => ({ label: String(i), title: `CVSS ${i}.0 – ${i}.9`, value: v, color: CVSS_COLOR(i) })),
          unit: "vulnérabilités",
          height: 170,
        })}</div>
      </section>
    </div>

    <section class="card" style="margin-bottom:20px">
      <div class="card-head"><h2>Vulnérabilités par scan</h2><span class="sub">${trend.length} dernier${trend.length > 1 ? "s" : ""} scan${trend.length > 1 ? "s" : ""}, par sévérité — cliquez sur une barre pour l'ouvrir</span></div>
      <div class="card-body">${trend.length ? chart("columns", { columns: trend, keys: SEV_ALL, height: 240 }) : empty("chart", "Pas encore d'historique", "Les scans terminés apparaîtront ici.")}
        <div class="chart-foot"><div class="legend">${SEV_ALL.map((k) => `<span><i style="background:${k.color}"></i>${k.label}</span>`).join("")}</div></div></div>
    </section>

    <div class="grid g-main" style="margin-bottom:20px">
      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Scans actifs</h2><span class="sub">actualisé toutes les ${settings.poll} s</span>
            <div class="end"><a class="btn btn-sm btn-ghost" href="#/scans">Tout voir ${icon("chevron")}</a></div></div>
          ${running.length
            ? `<div class="list">${running.map((r) => {
                const p = progress(r.status);
                return `<a class="list-item" href="#/scans/${encodeURIComponent(r.id)}">
                  <span class="avatar live">${icon("radar", "spin")}</span>
                  <span class="grow"><span class="row"><b class="ellipsis">${esc(r.name)}</b>${statusChip(r.status.status)}</span>
                    <span class="faint" style="font-size:12.5px">${esc(r.hosts.slice(0, 3).join(", "))} · démarré ${ago(r.status.start_time)}</span>
                    <span class="progress-cell" style="margin-top:8px"><span class="bar live"><i style="width:${p}%"></i></span><span>${p}%</span></span>
                  </span></a>`;
              }).join("")}</div>`
            : `<div class="list-item"><span class="avatar">${icon("radar")}</span><span class="grow muted">Aucun scan en cours. Les scans lancés apparaîtront ici avec leur progression en direct.</span><a class="btn btn-sm" href="#/new">${icon("plus")}Lancer</a></div>`}
        </section>

        <section class="card">
          <div class="card-head"><h2>Vulnérabilités les plus répandues</h2><div class="end"><a class="btn btn-sm btn-ghost" href="#/reports">Rapport complet ${icon("chevron")}</a></div></div>
          ${agg.vulns.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th style="width:130px">Sévérité</th><th>Vulnérabilité</th><th class="num">Hôtes</th></tr></thead><tbody>
              ${agg.vulns.slice(0, 6).map((v) => `<tr><td>${severityBadge(v.score)}</td>
                <td><div class="cell-title ellipsis" style="max-width:460px">${esc(v.name)}</div><div class="cell-sub">${esc(v.family)}${v.cves.length ? ` · ${esc(v.cves[0])}` : ""}</div></td>
                <td class="num"><b>${v.hosts.size}</b></td></tr>`).join("")}
              </tbody></table></div>`
            : empty("shield", "Aucune vulnérabilité", "Rien à signaler sur les derniers scans.")}
        </section>

        <section class="card">
          <div class="card-head"><h2>Activité récente</h2></div>
          ${rows.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Scan</th><th>Statut</th><th class="hide-sm">Vulnérabilités</th><th class="hide-sm">Durée</th><th>Démarré</th></tr></thead><tbody>
              ${rows.slice(0, 6).map((r) => {
                const c = r.results ? sevCounts(r.results) : null;
                return `<tr class="clickable" data-href="#/scans/${encodeURIComponent(r.id)}">
                <td><div class="cell-title">${esc(r.name)}</div><div class="cell-sub">${esc(r.id.slice(0, 8))}</div></td>
                <td>${statusChip(r.status.status)}</td>
                <td class="hide-sm">${c ? `<span class="row" style="gap:6px">${SEV_ALL.filter((k) => c[k.key]).map((k) => `<span class="sev sev-${k.key}" style="padding:0 6px 0 4px"><b style="min-width:26px">${c[k.key]}</b></span>`).join("") || `<span class="faint">0</span>`}</span>` : `<span class="faint">—</span>`}</td>
                <td class="hide-sm muted">${duration(r.status.start_time, r.status.end_time)}</td>
                <td class="muted">${r.status.start_time ? ago(r.status.start_time) : "—"}</td></tr>`;
              }).join("")}
              </tbody></table></div>`
            : empty("radar", "Aucun scan", "Créez votre premier scan pour commencer.")}
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Hôtes les plus exposés</h2><div class="end"><a class="btn btn-sm btn-ghost" href="#/assets">Actifs ${icon("chevron")}</a></div></div>
          <div class="card-body">${hbars(
            agg.hosts.filter((h) => h.risk).slice(0, 6).map((h) => ({
              label: h.ip,
              html: `<span class="mono">${esc(h.ip)}</span> <span class="faint">${esc(h.name && h.name !== h.ip ? h.name : "")}</span>`,
              sub: h.os || "",
              value: h.risk,
              right: `<b style="color:${riskLevel(h.risk).color}">${h.risk}</b>`,
              color: riskLevel(h.risk).color,
              tip: `Risque ${h.risk}/100 · CVSS max ${h.max?.toFixed(1) ?? "—"}`,
              href: `#/assets/${encodeURIComponent(h.ip)}`,
            })),
            { empty: "Aucun hôte vulnérable pour le moment." },
          )}</div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Ports les plus touchés</h2></div>
          <div class="card-body">${hbars(agg.ports.slice(0, 6).map((p) => ({ label: p.port, html: `<span class="mono">${esc(p.port)}</span>`, value: p.count, sub: `${p.hosts.size} hôte(s)` })), { empty: "Aucun port vulnérable." })}</div>
        </section>
      </div>
    </div>`;

  mountCharts(root);
  root.querySelectorAll("tr[data-href]").forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
}

export default async function dashboard(root) {
  root.innerHTML = `<div class="grid g-4" style="margin-bottom:20px">${`<div class="card">${skeletonRows(3)}</div>`.repeat(4)}</div>
    <div class="card">${skeletonRows(6)}</div>`;
  let alive = true;
  let timer;
  const tick = async (first) => {
    try {
      const [data, info] = await Promise.all([dataset({ limit: 12 }), api().info().catch(() => null)]);
      if (!alive) return;
      const y = window.scrollY;
      render(root, data, info);
      if (!first) window.scrollTo(0, y);
      const busy = data.rows.some((r) => ["running", "requested"].includes(r.status.status));
      timer = setTimeout(tick, (busy ? settings.poll : settings.poll * 5) * 1000);
    } catch (err) {
      if (!alive) return;
      if (first) root.innerHTML = `<div class="card">${empty("alert", "Impossible de joindre le scanner", err.message, `<a class="btn" href="#/settings">${icon("settings")}Vérifier la connexion</a>`)}</div>`;
      timer = setTimeout(tick, settings.poll * 5000);
    }
  };
  await tick(true);
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

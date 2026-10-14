import { api, settings } from "../api.js";
import { getResults, loadVts, resultSeverity, scanSummaries, shouldEnrich, vt } from "../store.js";
import { ago, duration, esc, icon, num, progress, severityLevel, statusChip } from "../util.js";
import { empty, skeletonRows } from "../ui.js";

const LEVELS = [
  ["critical", "Critique", "var(--sev-critical)"],
  ["high", "Élevée", "var(--sev-high)"],
  ["medium", "Moyenne", "var(--sev-medium)"],
  ["low", "Faible", "var(--sev-low)"],
  ["none", "Non évaluée", "var(--sev-log)"],
];

function donut(counts) {
  const total = LEVELS.reduce((a, [k]) => a + (counts[k] || 0), 0);
  const r = 62;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total
    ? LEVELS.filter(([k]) => counts[k])
        .map(([k, , color]) => {
          const len = (counts[k] / total) * c;
          const gap = Math.min(3, len / 3);
          const arc = `<circle r="${r}" cx="78" cy="78" fill="none" stroke="${color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-offset}" stroke-linecap="butt" transform="rotate(-90 78 78)"/>`;
          offset += len;
          return arc;
        })
        .join("")
    : "";
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 156 156" role="img" aria-label="Répartition par sévérité">
      <circle r="${r}" cx="78" cy="78" fill="none" stroke="var(--surface-3)" stroke-width="16"/>
      ${arcs}
      <text x="78" y="76" text-anchor="middle" font-size="28" font-weight="700">${num(total)}</text>
      <text x="78" y="98" text-anchor="middle" font-size="11" style="fill:var(--text-3)">vulnérabilités</text>
    </svg>
    <div class="legend" style="display:grid;gap:10px">
      ${LEVELS.map(([k, label, color]) => `<span><i style="background:${color}"></i>${label}<b>${num(counts[k] || 0)}</b></span>`).join("")}
    </div>
  </div>`;
}

function spark(values) {
  if (values.length < 2) return "";
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${46 - (v / max) * 40}`).join(" ");
  return `<svg class="spark" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" opacity=".7"/>
    <polygon points="0,48 ${pts} 120,48" fill="var(--accent)" opacity=".08"/></svg>`;
}

function kpi(tone, ic, label, value, foot, extra = "") {
  return `<div class="card kpi ${tone}">
    <div class="label"><span class="ico">${icon(ic)}</span>${label}</div>
    <div class="value">${value}</div><div class="foot">${foot}</div>${extra}</div>`;
}

async function gather() {
  const rows = await scanSummaries();
  if (shouldEnrich()) await loadVts().catch(() => null);
  const started = rows.filter((r) => r.status.status !== "stored").slice(0, 8);
  const resultSets = await Promise.all(started.map((r) => getResults(r.id).catch(() => [])));
  return { rows, started, resultSets };
}

function render(root, { rows, started, resultSets }, info) {
  const running = rows.filter((r) => ["running", "requested"].includes(r.status.status));
  const alarms = resultSets.flat().filter((r) => r.type === "alarm");
  const counts = {};
  const byHost = new Map();
  const byFamily = new Map();
  for (const a of alarms) {
    const score = resultSeverity(a);
    const lvl = severityLevel(score).key;
    counts[lvl] = (counts[lvl] || 0) + 1;
    const h = byHost.get(a.ip_address) || { ip: a.ip_address, name: a.hostname, n: 0, max: null };
    h.n++;
    if (score != null && (h.max == null || score > h.max)) h.max = score;
    byHost.set(a.ip_address, h);
    const fam = vt(a.oid)?.family;
    if (fam) byFamily.set(fam, (byFamily.get(fam) || 0) + 1);
  }
  const alive = started.reduce((a, r) => a + (r.status.host_info?.alive || 0), 0);
  const dead = started.reduce((a, r) => a + (r.status.host_info?.dead || 0), 0);
  const critHigh = (counts.critical || 0) + (counts.high || 0);
  const perScan = resultSets.map((s) => s.filter((r) => r.type === "alarm").length).reverse();
  const hosts = [...byHost.values()].sort((a, b) => (b.max ?? -1) - (a.max ?? -1) || b.n - a.n).slice(0, 6);
  const families = [...byFamily.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const famMax = families[0]?.[1] || 1;
  const hostMax = Math.max(1, ...hosts.map((h) => h.n));
  const demo = api().mode === "demo";

  root.innerHTML = `
    ${demo ? `<div class="banner">${icon("info")}<div class="grow">Vous explorez la console en <b>mode démo</b> : un scanner simulé fournit les données. Connectez votre openvasd dans les <a href="#/settings"><u>paramètres</u></a>.</div></div>` : ""}
    <section class="card hero" style="margin-bottom:20px">
      <div>
        <div class="eyebrow">${icon("activity")} Vue d'ensemble</div>
        <h1>${running.length ? `${running.length} scan${running.length > 1 ? "s" : ""} en cours d'exécution` : "Votre surface d'attaque, en un coup d'œil"}</h1>
        <p>${critHigh ? `${num(critHigh)} vulnérabilité${critHigh > 1 ? "s" : ""} critique${critHigh > 1 ? "s" : ""} ou élevée${critHigh > 1 ? "s" : ""} détectée${critHigh > 1 ? "s" : ""} sur les derniers scans.` : "Aucune vulnérabilité critique ou élevée sur les derniers scans."} Feed <span class="mono">${esc(info?.feedVersion || "—")}</span>.</p>
      </div>
      <div class="actions">
        <a class="btn" href="#/scans">${icon("radar")}Tous les scans</a>
        <a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a>
      </div>
    </section>

    <div class="grid g-4" style="margin-bottom:20px">
      ${kpi("accent", "radar", "Scans", num(rows.length), `${running.length} en cours · ${rows.filter((r) => r.status.status === "succeeded").length} terminés`)}
      ${kpi("danger", "alert", "Vulnérabilités", num(alarms.length), `${num(critHigh)} critiques ou élevées`, spark(perScan))}
      ${kpi("info", "host", "Hôtes actifs", num(alive), `${num(dead)} injoignables`)}
      ${kpi("warn", "layers", "Feed VT", esc(info?.feedVersion?.slice(0, 8) || "—"), info?.ready ? "Scanner prêt" : "Scanner non prêt")}
    </div>

    <div class="grid g-main">
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
            : empty("radar", "Aucun scan en cours", "Lancez un scan pour suivre sa progression en temps réel.", `<a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a>`)}
        </section>

        <section class="card">
          <div class="card-head"><h2>Activité récente</h2></div>
          ${rows.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Scan</th><th>Statut</th><th class="hide-sm">Cibles</th><th class="hide-sm">Durée</th><th>Démarré</th></tr></thead><tbody>
              ${rows.slice(0, 6).map((r) => `<tr class="clickable" data-href="#/scans/${encodeURIComponent(r.id)}">
                <td><div class="cell-title">${esc(r.name)}</div><div class="cell-sub">${esc(r.id.slice(0, 8))}</div></td>
                <td>${statusChip(r.status.status)}</td>
                <td class="hide-sm"><span class="tag mono">${esc(r.hosts[0] || "—")}</span>${r.hosts.length > 1 ? ` <span class="faint">+${r.hosts.length - 1}</span>` : ""}</td>
                <td class="hide-sm muted">${duration(r.status.start_time, r.status.end_time)}</td>
                <td class="muted">${r.status.start_time ? ago(r.status.start_time) : "—"}</td></tr>`).join("")}
              </tbody></table></div>`
            : empty("radar", "Aucun scan", "Créez votre premier scan pour commencer.")}
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Sévérité</h2><span class="sub">${started.length} derniers scans</span></div>
          <div class="card-body">${shouldEnrich() || alarms.length === 0 ? donut(counts) : `<p class="muted" style="margin:0">Activez l'enrichissement VT dans les <a href="#/settings"><u>paramètres</u></a> pour calculer les scores CVSS.</p>${donut(counts)}`}</div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Hôtes les plus exposés</h2></div>
          <div class="card-body">${hosts.length
            ? `<div class="hbars">${hosts.map((h) => `<div class="hbar" style="--c:var(--sev-${severityLevel(h.max).key})">
                <span class="ellipsis"><span class="mono">${esc(h.ip)}</span> <span class="faint">${esc(h.name && h.name !== h.ip ? h.name : "")}</span></span>
                <span class="muted">${h.n} · <b style="color:var(--c)">${h.max?.toFixed(1) ?? "—"}</b></span>
                <span class="bar"><i style="width:${(h.n / hostMax) * 100}%"></i></span></div>`).join("")}</div>`
            : `<p class="muted" style="margin:0">Aucun hôte vulnérable pour le moment.</p>`}</div>
        </section>
        ${families.length ? `<section class="card">
          <div class="card-head"><h2>Familles de VT</h2></div>
          <div class="card-body"><div class="hbars">${families.map(([f, n]) => `<div class="hbar"><span class="ellipsis">${esc(f)}</span><span class="muted">${n}</span><span class="bar"><i style="width:${(n / famMax) * 100}%"></i></span></div>`).join("")}</div></div>
        </section>` : ""}
      </div>
    </div>`;

  root.querySelectorAll("tr[data-href]").forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
}

export default async function dashboard(root) {
  root.innerHTML = `<div class="grid g-4" style="margin-bottom:20px">${`<div class="card">${skeletonRows(3)}</div>`.repeat(4)}</div>
    <div class="card">${skeletonRows(6)}</div>`;
  let alive = true;
  let timer;
  const tick = async (first) => {
    try {
      const [data, info] = await Promise.all([gather(), api().info().catch(() => null)]);
      if (!alive) return;
      render(root, data, info);
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

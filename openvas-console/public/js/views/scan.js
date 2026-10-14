import { api, labels, settings } from "../api.js";
import { getConfig, getResults, loadVts, resultSeverity, shouldEnrich, vt } from "../store.js";
import { dateTime, debounce, download, duration, esc, icon, num, progress, RESULT_TYPES, severityBadge, severityLevel, statusChip } from "../util.js";
import { copy, empty, jsonHtml, skeletonRows, toast } from "../ui.js";
import { deleteScan, startScan, stopScan } from "../actions.js";
import { setCrumb } from "../app.js";
import { aggregate, counted, setTriage, TRIAGE, triageOf } from "../analytics.js";
import { chart, donut, hbars, mountCharts, riskLevel, SEV, SEV_NONE } from "../charts.js";

const SEV_ALL = [...SEV, SEV_NONE];
const CVSS_COLOR = (i) => (i >= 9 ? "var(--sev-critical)" : i >= 7 ? "var(--sev-high)" : i >= 4 ? "var(--sev-medium)" : "var(--sev-low)");
const PREFILL_KEY = "ovc.prefill";

const PAGE = 50;
const SEV_FILTERS = [
  [0, "Toutes"],
  [4, "≥ Moyenne"],
  [7, "≥ Élevée"],
  [9, "Critiques"],
];

const portsText = (ports = []) =>
  ports
    .map((p) => `${p.protocol ? `${p.protocol.toUpperCase()} ` : ""}${(p.range || []).map((r) => (r.end ? `${r.start}-${r.end}` : r.start)).join(", ")}`)
    .join(" · ") || "—";

function hostStats(status) {
  const h = status.host_info || {};
  const scanning = h.scanning && !Array.isArray(h.scanning) ? Object.keys(h.scanning).length : 0;
  return [
    ["Terminés", h.finished || 0, "var(--ok)"],
    ["En cours", scanning, "var(--info)"],
    ["En attente", h.queued || 0, "var(--surface-3)"],
    ["Injoignables", h.dead || 0, "var(--sev-log)"],
    ["Exclus", h.excluded || 0, "var(--warn)"],
  ];
}

function resultName(r) {
  if (r.type === "host_detail" && r.detail) return `${r.detail.name} : ${r.detail.value}`;
  return vt(r.oid)?.name || (r.oid ? r.oid : (r.message || "").split("\n")[0]);
}

function detailRow(r, cols) {
  const info = vt(r.oid);
  const tag = info?.tag || {};
  const refs = (info?.references || []).filter((x) => x.class === "cve").map((x) => x.id);
  return `<tr class="detail-row"><td colspan="${cols}"><div class="detail">
    <div>
      <h4>Message du scanner</h4>
      <pre class="code">${esc(r.message || (r.detail ? JSON.stringify(r.detail, null, 2) : "—"))}</pre>
      ${tag.insight ? `<h4 style="margin-top:16px">Analyse</h4><p>${esc(tag.insight)}</p>` : ""}
      ${tag.impact ? `<h4>Impact</h4><p>${esc(tag.impact)}</p>` : ""}
    </div>
    <div>
      ${tag.summary ? `<h4>Résumé</h4><p>${esc(tag.summary)}</p>` : ""}
      ${tag.solution ? `<h4>Solution ${tag.solution_type ? `<span class="tag">${esc(tag.solution_type)}</span>` : ""}</h4><p>${esc(tag.solution)}</p>` : ""}
      <dl class="kv">
        ${r.oid ? `<dt>OID</dt><dd><span class="mono">${esc(r.oid)}</span> <button class="icon-btn sm" data-copy="${esc(r.oid)}" title="Copier">${icon("copy")}</button></dd>` : ""}
        ${info?.family ? `<dt>Famille</dt><dd>${esc(info.family)}</dd>` : ""}
        ${tag.severity_vector || tag.cvss_base_vector ? `<dt>Vecteur</dt><dd class="mono">${esc(tag.severity_vector || tag.cvss_base_vector)}</dd>` : ""}
        ${refs.length ? `<dt>CVE</dt><dd>${refs.map((c) => `<a class="tag mono" target="_blank" rel="noopener" href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c)}">${esc(c)}</a>`).join(" ")}</dd>` : ""}
        <dt>Résultat</dt><dd>#${r.id} · ${esc(RESULT_TYPES[r.type]?.label || r.type)}</dd>
        ${r.type === "alarm" ? `<dt>Suivi</dt><dd><select class="triage" data-triage="${r.id}">${Object.entries(TRIAGE).map(([k, t]) => `<option value="${k}" ${triageOf(r) === k ? "selected" : ""}>${t.label}</option>`).join("")}</select></dd>` : ""}
      </dl>
    </div></div></td></tr>`;
}

function hostCards(results) {
  const hosts = new Map();
  for (const r of results) {
    if (!r.ip_address) continue;
    const h = hosts.get(r.ip_address) || { ip: r.ip_address, name: r.hostname, os: null, ports: new Set(), sev: {}, max: null, done: false, errors: 0 };
    if (r.hostname) h.name = r.hostname;
    if (r.type === "host_detail" && r.detail?.name === "OS") h.os = r.detail.value;
    if (r.type === "host_stop") h.done = true;
    if (r.type === "error") h.errors++;
    if (r.port) h.ports.add(`${r.port}/${r.protocol || "tcp"}`);
    if (r.type === "alarm") {
      const s = resultSeverity(r);
      const k = severityLevel(s).key;
      h.sev[k] = (h.sev[k] || 0) + 1;
      if (s != null && (h.max == null || s > h.max)) h.max = s;
    }
    hosts.set(r.ip_address, h);
  }
  if (!hosts.size) return `<div class="card">${empty("host", "Aucun hôte pour l'instant", "Les hôtes apparaîtront dès que le scanner commencera à les analyser.")}</div>`;
  const order = ["critical", "high", "medium", "low", "none"];
  return `<div class="grid g-3">${[...hosts.values()]
    .sort((a, b) => (b.max ?? -1) - (a.max ?? -1))
    .map((h) => {
      const total = order.reduce((a, k) => a + (h.sev[k] || 0), 0);
      return `<section class="card"><div class="card-body stack" style="gap:12px">
        <div class="row"><span class="avatar">${icon("host")}</span><span class="grow"><b class="mono">${esc(h.ip)}</b><div class="faint ellipsis" style="font-size:12.5px">${esc(h.name && h.name !== h.ip ? h.name : "—")}</div></span>${severityBadge(h.max)}</div>
        <div class="stacked">${total ? order.map((k) => (h.sev[k] ? `<i style="flex-grow:${h.sev[k]};background:var(--sev-${k === "none" ? "log" : k})"></i>` : "")).join("") : ""}</div>
        <dl class="kv" style="font-size:13px">
          <dt>Système</dt><dd>${esc(h.os || "Non détecté")}</dd>
          <dt>Vulnérabilités</dt><dd>${total}${h.errors ? ` · <span style="color:var(--warn)">${h.errors} erreur${h.errors > 1 ? "s" : ""}</span>` : ""}</dd>
          <dt>Ports</dt><dd>${[...h.ports].slice(0, 8).map((p) => `<span class="tag mono">${esc(p)}</span>`).join(" ") || "—"}${h.ports.size > 8 ? ` <span class="faint">+${h.ports.size - 8}</span>` : ""}</dd>
          <dt>État</dt><dd>${h.done ? statusChip("succeeded") : statusChip("running")}</dd>
        </dl></div></section>`;
    })
    .join("")}</div>`;
}

function toCsv(results) {
  const cols = ["id", "type", "severity", "name", "ip_address", "hostname", "port", "protocol", "oid", "message"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...results.map((r) => [r.id, r.type, resultSeverity(r) ?? "", resultName(r), r.ip_address, r.hostname, r.port, r.protocol, r.oid, r.message].map(cell).join(","))].join("\n");
}

export default async function scan(root, id) {
  let alive = true;
  let timer;
  let status = null;
  let config = null;
  let results = [];
  let tab = "overview";
  let triage = "all";
  let query = "";
  let type = "all";
  let minSev = 0;
  let page = 0;
  const open = new Set();
  const label = labels.get(id);
  const name = label.name || `Scan ${id.slice(0, 8)}`;
  setCrumb(name);

  root.innerHTML = `<div class="card">${skeletonRows(8, 20)}</div>`;
  try {
    [config, status] = await Promise.all([getConfig(id), api().getStatus(id)]);
    if (shouldEnrich()) await loadVts().catch(() => null);
    results = await getResults(id);
  } catch (err) {
    root.innerHTML = `<div class="card">${empty("alert", err.status === 404 ? "Scan introuvable" : "Chargement impossible", err.message, `<a class="btn" href="#/scans">${icon("back")}Retour aux scans</a>`)}</div>`;
    return;
  }
  if (!alive) return;

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <div class="eyebrow" id="chip"></div>
        <h1>${esc(name)}</h1>
        <p class="row wrap"><span class="mono faint">${esc(id)}</span><button class="icon-btn sm" data-copy="${esc(id)}" title="Copier l'identifiant">${icon("copy")}</button></p>
      </div>
      <div class="actions" id="actions"></div>
    </div>
    <div class="grid g-main" style="margin-bottom:20px">
      <section class="card" id="progress"></section>
      <section class="card"><div class="card-head"><h2>Configuration</h2></div><div class="card-body" id="summary"></div></section>
    </div>
    <div class="tabs" id="tabs"></div>
    <div id="tab"></div>`;

  function drawHeader() {
    const s = status.status;
    const live = s === "running" || s === "requested";
    root.querySelector("#chip").innerHTML = statusChip(s);
    root.querySelector("#actions").innerHTML = `
      ${s === "stored" ? `<button class="btn btn-primary" data-act="start">${icon("play")}Démarrer</button>` : ""}
      ${live ? `<button class="btn btn-danger" data-act="stop">${icon("stop")}Arrêter</button>` : ""}
      <a class="btn" href="#/reports/${encodeURIComponent(id)}">${icon("chart")}Rapport</a>
      <button class="btn" data-act="duplicate" title="Créer un nouveau scan avec la même configuration">${icon("repeat")}Dupliquer</button>
      <button class="btn" data-act="csv" ${results.length ? "" : "disabled"}>${icon("download")}CSV</button>
      <button class="btn" data-act="json" ${results.length ? "" : "disabled"}>${icon("download")}JSON</button>
      <button class="btn btn-danger" data-act="delete" ${live ? "disabled" : ""}>${icon("trash")}Supprimer</button>`;

    const p = progress(status);
    const stats = hostStats(status);
    const scanning = status.host_info?.scanning && !Array.isArray(status.host_info.scanning) ? Object.entries(status.host_info.scanning) : [];
    root.querySelector("#progress").innerHTML = `
      <div class="card-head"><h2>Progression</h2><span class="sub">${s === "stored" ? "en attente de démarrage" : `${num(status.host_info?.all || 0)} hôtes ciblés`}</span>
        <div class="end"><b style="font-size:22px;font-variant-numeric:tabular-nums">${s === "stored" ? "—" : `${p}%`}</b></div></div>
      <div class="card-body stack">
        <div class="bar ${live ? "live" : ""}" style="height:10px"><i style="width:${p}%"></i></div>
        ${status.host_info ? `<div class="host-tiles">
          <div class="host-tile"><b>${num(status.host_info.alive || 0)}</b><span>Actifs</span></div>
          ${stats.map(([l, n, c]) => `<div class="host-tile" style="box-shadow:inset 3px 0 0 ${c}"><b>${num(n)}</b><span>${l}</span></div>`).join("")}
        </div>` : `<p class="muted" style="margin:0">Démarrez le scan pour voir l'avancement hôte par hôte.</p>`}
        ${scanning.length ? `<div><h4 class="faint" style="margin:4px 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Hôtes en cours d'analyse</h4>
          <div class="scanning">${scanning.map(([h, v]) => `<div class="row"><span>${esc(h)}</span><span class="bar thin live grow"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span><span class="faint" style="width:40px;text-align:right">${v}%</span></div>`).join("")}</div></div>` : ""}
        <dl class="kv"><dt>Début</dt><dd>${dateTime(status.start_time)}</dd><dt>Fin</dt><dd>${dateTime(status.end_time)}</dd><dt>Durée</dt><dd>${duration(status.start_time, status.end_time)}</dd></dl>
      </div>`;
  }

  function drawSummary() {
    const t = config.target || {};
    const creds = (t.credentials || []).map((c) => `${c.service}${c.port ? `:${c.port}` : ""}`);
    root.querySelector("#summary").innerHTML = `<dl class="kv">
      <dt>Cibles</dt><dd>${(t.hosts || []).map((h) => `<span class="tag mono">${esc(h)}</span>`).join(" ")}</dd>
      ${t.excluded_hosts?.length ? `<dt>Exclus</dt><dd>${t.excluded_hosts.map((h) => `<span class="tag mono">${esc(h)}</span>`).join(" ")}</dd>` : ""}
      <dt>Ports</dt><dd class="mono" style="font-size:12.5px">${esc(portsText(t.ports))}</dd>
      <dt>Détection</dt><dd>${esc((t.alive_test_methods || []).join(", ") || "par défaut")}</dd>
      <dt>Identifiants</dt><dd>${creds.length ? creds.map((c) => `<span class="tag">${esc(c)}</span>`).join(" ") : "aucun"}</dd>
      <dt>VTs</dt><dd>${num(config.vts?.length || 0)} sélectionnés</dd>
      <dt>Préférences</dt><dd>${num(config.scan_preferences?.length || 0)} personnalisées</dd>
    </dl>`;
  }

  function filtered() {
    const q = query.toLowerCase();
    return results.filter((r) => {
      if (tab === "vulns" && r.type !== "alarm") return false;
      if (tab === "vulns" && triage !== "all" && triageOf(r) !== triage) return false;
      if (tab === "all" && type !== "all" && r.type !== type) return false;
      if (minSev && (resultSeverity(r) ?? -1) < minSev) return false;
      if (q && !`${resultName(r)} ${r.ip_address} ${r.hostname} ${r.oid} ${r.port} ${r.message}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function drawTabs() {
    const vulns = results.filter((r) => r.type === "alarm").length;
    const hosts = new Set(results.map((r) => r.ip_address).filter(Boolean)).size;
    const tabs = [
      ["overview", "Aperçu", null],
      ["vulns", "Vulnérabilités", vulns],
      ["all", "Tous les résultats", results.length],
      ["hosts", "Hôtes", hosts],
      ["config", "Requête JSON", null],
    ];
    root.querySelector("#tabs").innerHTML = tabs
      .map(([k, l, n]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${l}${n != null ? `<span class="count">${num(n)}</span>` : ""}</button>`)
      .join("");
  }

  function drawTab() {
    const el = root.querySelector("#tab");
    if (tab === "hosts") return (el.innerHTML = hostCards(results));
    if (tab === "overview") {
      el.innerHTML = overview();
      return mountCharts(el);
    }
    if (tab === "config") return (el.innerHTML = `<section class="card"><div class="card-body"><pre class="code">${jsonHtml(config)}</pre></div></section>`);

    const rows = filtered().sort((a, b) => (resultSeverity(b) ?? -1) - (resultSeverity(a) ?? -1) || a.id - b.id);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
    const types = ["all", ...Object.keys(RESULT_TYPES)];
    const focused = document.activeElement?.id === "rq";

    el.innerHTML = `<section class="card">
      <div class="toolbar">
        <label class="input-icon">${icon("search")}<input class="input" id="rq" placeholder="Filtrer les résultats…" value="${esc(query)}" /></label>
        ${tab === "all"
          ? `<select class="select" id="rtype" style="width:auto">${types.map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t === "all" ? "Tous les types" : RESULT_TYPES[t].label}</option>`).join("")}</select>`
          : `<div class="seg">${SEV_FILTERS.map(([v, l]) => `<button data-sev="${v}" class="${minSev === v ? "on" : ""}">${l}</button>`).join("")}</div>
             <select class="select" id="rtriage" style="width:auto"><option value="all">Tous les suivis</option>${Object.entries(TRIAGE).map(([k, t]) => `<option value="${k}" ${triage === k ? "selected" : ""}>${t.label}</option>`).join("")}</select>`}
        <span class="faint" style="margin-left:auto">${num(rows.length)} résultat${rows.length > 1 ? "s" : ""}</span>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th style="width:130px">Sévérité</th><th>Nom</th><th>Hôte</th><th class="hide-sm">Port</th>${tab === "all" ? `<th class="hide-sm">Type</th>` : ""}</tr></thead>
        <tbody>${slice.map((r) => {
          const t = RESULT_TYPES[r.type] || { label: r.type, tone: "neutral" };
          const row = `<tr class="clickable ${open.has(r.id) ? "open" : ""}" data-rid="${r.id}">
            <td>${r.type === "alarm" ? severityBadge(resultSeverity(r)) : `<span class="faint">—</span>`}</td>
            <td><div class="row" style="gap:8px"><span class="cell-title ellipsis" style="max-width:480px">${esc(resultName(r))}</span>${r.type === "alarm" && triageOf(r) !== "new" ? `<span class="chip chip-${TRIAGE[triageOf(r)].tone}">${TRIAGE[triageOf(r)].label}</span>` : ""}</div>${r.oid && vt(r.oid) ? `<div class="cell-sub">${esc(r.oid)}</div>` : ""}</td>
            <td><span class="mono">${esc(r.ip_address || "—")}</span>${r.hostname && r.hostname !== r.ip_address ? `<div class="cell-sub">${esc(r.hostname)}</div>` : ""}</td>
            <td class="hide-sm mono">${r.port ? `${r.port}/${esc(r.protocol || "tcp")}` : "—"}</td>
            ${tab === "all" ? `<td class="hide-sm"><span class="chip chip-${t.tone}">${esc(t.label)}</span></td>` : ""}</tr>`;
          return open.has(r.id) ? row + detailRow(r, tab === "all" ? 5 : 4) : row;
        }).join("")}</tbody></table></div>
        ${pages > 1 ? `<div class="pager"><span class="grow">Page ${page + 1} / ${pages}</span>
          <button class="btn btn-sm" data-page="-1" ${page ? "" : "disabled"}>${icon("back")}Précédent</button>
          <button class="btn btn-sm" data-page="1" ${page < pages - 1 ? "" : "disabled"}>Suivant${icon("chevron")}</button></div>` : ""}`
        : empty(tab === "vulns" ? "shield" : "search", status.status === "stored" ? "Scan non démarré" : results.length ? "Aucun résultat ne correspond" : "Aucun résultat pour l'instant", status.status === "stored" ? "Les résultats apparaîtront ici dès le démarrage du scan." : results.length ? "Ajustez la recherche ou les filtres." : "Les résultats s'afficheront en direct pendant l'analyse.")}
    </section>`;
    if (focused) {
      const input = el.querySelector("#rq");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function overview() {
    if (status.status === "stored") return `<section class="card">${empty("chart", "Scan non démarré", "Les graphiques apparaîtront dès que le scanner produira des résultats.")}</section>`;
    const agg = aggregate([{ id, name, status, results }]);
    const total = SEV_ALL.reduce((a, k) => a + (agg.sev[k.key] || 0), 0);
    const fp = results.filter((r) => r.type === "alarm" && !counted(r)).length;
    const families = new Map();
    for (const v of agg.vulns) families.set(v.family, (families.get(v.family) || 0) + v.count);
    return `
      <div class="grid g-4" style="margin-bottom:16px">
        ${SEV.map((k) => `<div class="card kpi" style="box-shadow:inset 0 3px 0 ${k.color}"><div class="label">${k.label}</div><div class="value">${num(agg.sev[k.key] || 0)}</div><div class="foot">${total ? Math.round(((agg.sev[k.key] || 0) / total) * 100) : 0} %</div></div>`).join("")}
      </div>
      <div class="grid g-2" style="margin-bottom:16px">
        <section class="card"><div class="card-head"><h2>Sévérité</h2>${fp ? `<span class="sub">${fp} faux positif${fp > 1 ? "s" : ""} exclu${fp > 1 ? "s" : ""}</span>` : ""}</div>
          <div class="card-body">${donut(SEV_ALL.map((k) => ({ label: k.label, value: agg.sev[k.key] || 0, color: k.color })), { sub: "vulnérabilités" })}</div></section>
        <section class="card"><div class="card-head"><h2>Scores CVSS</h2></div>
          <div class="card-body">${chart("histogram", { bins: agg.cvss.map((v, i) => ({ label: String(i), title: `CVSS ${i}.0 – ${i}.9`, value: v, color: CVSS_COLOR(i) })), unit: "vulnérabilités", height: 180 })}</div></section>
      </div>
      <div class="grid g-3">
        <section class="card"><div class="card-head"><h2>Hôtes à risque</h2></div>
          <div class="card-body">${hbars(agg.hosts.filter((h) => h.risk).slice(0, 6).map((h) => ({ label: h.ip, html: `<span class="mono">${esc(h.ip)}</span>`, sub: h.os || "", value: h.risk, right: `<b style="color:${riskLevel(h.risk).color}">${h.risk}</b>`, color: riskLevel(h.risk).color, tip: `Risque ${h.risk}/100`, href: `#/assets/${encodeURIComponent(h.ip)}` })), { empty: "Aucun hôte vulnérable." })}</div></section>
        <section class="card"><div class="card-head"><h2>Ports</h2></div>
          <div class="card-body">${hbars(agg.ports.slice(0, 6).map((p) => ({ label: p.port, html: `<span class="mono">${esc(p.port)}</span>`, value: p.count, sub: `${p.hosts.size} hôte(s)` })), { empty: "Aucun port vulnérable." })}</div></section>
        <section class="card"><div class="card-head"><h2>Familles</h2></div>
          <div class="card-body">${hbars([...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => ({ label: f, value: n })), { empty: "—" })}</div></section>
      </div>`;
  }

  const drawAll = () => {
    drawHeader();
    drawSummary();
    drawTabs();
    drawTab();
  };

  async function poll() {
    clearTimeout(timer);
    try {
      const prevCount = results.length;
      const prevStatus = status.status;
      [status, results] = await Promise.all([api().getStatus(id), getResults(id)]);
      if (!alive) return;
      drawHeader();
      if (results.length !== prevCount || status.status !== prevStatus) {
        drawTabs();
        drawTab();
      }
    } catch {
      /* transient errors: keep polling */
    }
    if (alive && ["running", "requested"].includes(status.status)) timer = setTimeout(poll, settings.poll * 1000);
  }

  root.oninput = debounce((e) => {
    if (e.target.id === "rq") {
      query = e.target.value.trim();
      page = 0;
      drawTab();
    }
  }, 150);
  root.onchange = (e) => {
    if (e.target.dataset.triage) {
      setTriage(results.find((r) => r.id === Number(e.target.dataset.triage)), e.target.value);
      toast("Suivi mis à jour", TRIAGE[e.target.value].label);
      return drawTab();
    }
    if (e.target.id === "rtriage") {
      triage = e.target.value;
      page = 0;
      return drawTab();
    }
    if (e.target.id === "rtype") {
      type = e.target.value;
      page = 0;
      drawTab();
    }
  };
  root.onclick = async (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) return copy(c.dataset.copy);
    const t = e.target.closest("[data-tab]");
    if (t) {
      tab = t.dataset.tab;
      page = 0;
      drawTabs();
      return drawTab();
    }
    const sv = e.target.closest("[data-sev]");
    if (sv) return ((minSev = Number(sv.dataset.sev)), (page = 0), drawTab());
    const pg = e.target.closest("[data-page]");
    if (pg) return ((page += Number(pg.dataset.page)), drawTab(), root.querySelector("#tabs").scrollIntoView({ behavior: "smooth" }));
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (a === "csv") return download(`openvas-${id.slice(0, 8)}-resultats.csv`, toCsv(results), "text/csv");
    if (a === "json") return download(`openvas-${id.slice(0, 8)}-resultats.json`, JSON.stringify(results, null, 2));
    if (a === "start" && (await startScan(id, name))) return poll();
    if (a === "stop" && (await stopScan(id, name))) return poll();
    if (a === "delete" && (await deleteScan(id, name))) return (location.hash = "#/scans");
    if (a === "duplicate") {
      try {
        sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ name: `${name} (copie)`, config }));
      } catch {
        /* prefill unavailable */
      }
      return (location.hash = "#/new");
    }
    if (e.target.closest("select")) return;
    const tr = e.target.closest("tr[data-rid]");
    if (tr) {
      const rid = Number(tr.dataset.rid);
      open.has(rid) ? open.delete(rid) : open.add(rid);
      drawTab();
    }
  };

  drawAll();
  poll();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

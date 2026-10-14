import { settings } from "../api.js";
import { scanSummaries } from "../store.js";
import { ago, debounce, duration, esc, icon, progress, statusChip } from "../util.js";
import { empty, skeletonRows } from "../ui.js";
import { deleteScan, startScan, stopScan } from "../actions.js";

const FILTERS = [
  ["all", "Tous"],
  ["active", "En cours"],
  ["stored", "Enregistrés"],
  ["succeeded", "Terminés"],
  ["issues", "Arrêtés / échecs"],
];

const matches = (f, s) =>
  f === "all" ||
  (f === "active" && ["running", "requested"].includes(s)) ||
  (f === "issues" && ["stopped", "failed"].includes(s)) ||
  f === s;

export default async function scans(root) {
  let rows = null;
  let filter = "all";
  let query = "";
  let alive = true;
  let timer;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Scans</h1><p>Créez, lancez et suivez les scans exécutés par openvasd.</p></div>
      <div class="actions"><a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a></div>
    </div>
    <section class="card">
      <div class="toolbar">
        <label class="input-icon">${icon("search")}<input class="input" id="q" placeholder="Nom, identifiant ou hôte…" /></label>
        <div class="pills" id="filters"></div>
        <button class="icon-btn" id="refresh" title="Actualiser" style="margin-left:auto">${icon("refresh")}</button>
      </div>
      <div id="list">${skeletonRows(6, 22)}</div>
    </section>`;

  const list = root.querySelector("#list");

  function draw() {
    if (!rows) return;
    const q = query.toLowerCase();
    const shown = rows.filter(
      (r) => matches(filter, r.status.status) && (!q || `${r.name} ${r.id} ${r.hosts.join(" ")}`.toLowerCase().includes(q)),
    );
    root.querySelector("#filters").innerHTML = FILTERS.map(([k, label]) => {
      const n = rows.filter((r) => matches(k, r.status.status)).length;
      return `<button class="pill ${filter === k ? "on" : ""}" data-f="${k}">${label}<span class="n">${n}</span></button>`;
    }).join("");

    if (!rows.length) {
      list.innerHTML = empty("radar", "Aucun scan pour l'instant", "Définissez une cible et des tests, puis lancez votre premier scan.", `<a class="btn btn-primary" href="#/new">${icon("plus")}Créer un scan</a>`);
      return;
    }
    if (!shown.length) {
      list.innerHTML = empty("search", "Aucun scan ne correspond", "Modifiez la recherche ou le filtre de statut.");
      return;
    }
    list.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Scan</th><th>Statut</th><th>Progression</th><th class="hide-sm">Cibles</th><th class="hide-sm">Démarré</th><th class="hide-sm">Durée</th><th></th></tr></thead>
      <tbody>${shown.map((r) => {
        const s = r.status.status;
        const p = progress(r.status);
        const live = s === "running" || s === "requested";
        return `<tr class="clickable" data-id="${esc(r.id)}">
          <td><div class="cell-title">${esc(r.name)}</div><div class="cell-sub">${esc(r.id)}</div></td>
          <td>${statusChip(s)}</td>
          <td><div class="progress-cell"><span class="bar thin ${live ? "live" : ""}"><i style="width:${p}%"></i></span><span>${s === "stored" ? "—" : `${p}%`}</span></div></td>
          <td class="hide-sm"><span class="tag mono">${esc(r.hosts[0] || "—")}</span>${r.hosts.length > 1 ? ` <span class="faint">+${r.hosts.length - 1}</span>` : ""}</td>
          <td class="hide-sm muted" title="${r.status.start_time ? new Date(r.status.start_time * 1000).toLocaleString("fr-FR") : ""}">${r.status.start_time ? ago(r.status.start_time) : "—"}</td>
          <td class="hide-sm muted">${duration(r.status.start_time, r.status.end_time)}</td>
          <td class="actions-cell">
            ${s === "stored" ? `<button class="icon-btn sm" data-act="start" title="Démarrer">${icon("play")}</button>` : ""}
            ${live ? `<button class="icon-btn sm danger" data-act="stop" title="Arrêter">${icon("stop")}</button>` : ""}
            <button class="icon-btn sm danger" data-act="delete" title="Supprimer" ${live ? "disabled" : ""}>${icon("trash")}</button>
          </td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  async function load() {
    clearTimeout(timer);
    try {
      rows = await scanSummaries();
      if (!alive) return;
      draw();
      const busy = rows.some((r) => ["running", "requested"].includes(r.status.status));
      timer = setTimeout(load, (busy ? settings.poll : settings.poll * 5) * 1000);
    } catch (err) {
      if (!alive) return;
      list.innerHTML = empty("alert", "Impossible de charger les scans", err.message, `<a class="btn" href="#/settings">${icon("settings")}Paramètres</a>`);
    }
  }

  root.querySelector("#q").oninput = debounce((e) => ((query = e.target.value.trim()), draw()), 120);
  root.querySelector("#refresh").onclick = load;
  root.onclick = async (e) => {
    const pill = e.target.closest("[data-f]");
    if (pill) return ((filter = pill.dataset.f), draw());
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const row = rows.find((r) => r.id === tr.dataset.id);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return (location.hash = `#/scans/${encodeURIComponent(row.id)}`);
    const done = await { start: startScan, stop: stopScan, delete: deleteScan }[act](row.id, row.name);
    if (done) load();
  };

  await load();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}


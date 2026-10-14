// Scheduled scans. The console server runs them (no browser needs to stay
// open); in demo mode they are only listed.

import { call, can, team } from "../team.js";
import { esc, icon } from "../util.js";
import { confirmDialog, empty, fail, skeletonRows, toast } from "../ui.js";

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export const frequencyLabel = (s) =>
  s.frequency === "daily" ? `Tous les jours à ${s.time}` : s.frequency === "monthly" ? `Le ${s.monthday === 1 ? "1er" : s.monthday} de chaque mois à ${s.time}` : `Chaque ${DAYS[s.weekday ?? 1]} à ${s.time}`;

const when = (t) => (t ? new Date(t).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

// Demo mode keeps schedules for this tab only.
const demoSchedules = [];

export async function createSchedule(body) {
  if (team.remote()) return call("POST", "/console/schedules", body);
  demoSchedules.push({ id: crypto.randomUUID?.() || String(Date.now()), ...body, targets: body.config.target.hosts, enabled: true, createdBy: "démo", next: Date.now() + 86_400_000 });
  return { id: demoSchedules.at(-1).id };
}

export default async function schedules(root) {
  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon("refresh")} Automatisation</div><h1>Scans planifiés</h1>
        <p>Scans récurrents exécutés automatiquement par le serveur de la console, même navigateur fermé. Les résultats déclenchent les alertes configurées.</p></div>
      <div class="actions">${can("analyste") ? `<a class="btn btn-primary needs-analyste" href="#/new">${icon("plus")}Nouvelle planification</a>` : ""}</div>
    </div>
    ${team.remote() ? "" : `<div class="banner">${icon("info")}<div class="grow">En mode démo, les planifications sont affichées mais pas exécutées : c'est le serveur de la console qui les lance.</div></div>`}
    <section class="card" id="list">${skeletonRows(5, 20)}</section>`;

  async function load() {
    const list = team.remote() ? await call("GET", "/console/schedules") : demoSchedules;
    const el = root.querySelector("#list");
    if (!list.length) {
      el.innerHTML = empty("refresh", "Aucun scan planifié", "Dans « Nouveau scan », l'étape 5 permet de répéter un scan chaque jour, chaque semaine ou chaque mois.", can("analyste") ? `<a class="btn btn-primary needs-analyste" href="#/new">${icon("plus")}Créer une planification</a>` : "");
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Planification</th><th class="hide-sm">Cibles</th><th>Fréquence</th><th class="hide-sm">Prochaine exécution</th><th class="hide-sm">Dernière exécution</th><th>Active</th><th></th></tr></thead>
      <tbody>${list.map((s) => `<tr data-id="${esc(s.id)}">
        <td><div class="cell-title">${esc(s.name)}</div><div class="cell-sub">par ${esc(s.createdBy || "?")}</div></td>
        <td class="hide-sm">${(s.targets || []).slice(0, 2).map((h) => `<span class="tag mono">${esc(h)}</span>`).join(" ")}${(s.targets || []).length > 2 ? ` <span class="faint">+${s.targets.length - 2}</span>` : ""}</td>
        <td>${esc(frequencyLabel(s))}</td>
        <td class="hide-sm">${s.enabled ? esc(when(s.next)) : `<span class="faint">suspendue</span>`}</td>
        <td class="hide-sm">${s.lastError ? `<span class="chip chip-danger" data-tip="${esc(s.lastError)}">Échec</span>` : s.lastScan ? `<a href="#/scans/${encodeURIComponent(s.lastScan)}"><u>${esc(when(s.lastRun))}</u></a>` : `<span class="faint">jamais</span>`}</td>
        <td><label class="toggle"><input type="checkbox" data-toggle ${s.enabled ? "checked" : ""} ${can("analyste") ? "" : "disabled"} /></label></td>
        <td class="actions-cell">${can("analyste") ? `<button class="icon-btn sm" data-run title="Exécuter maintenant">${icon("play")}</button><button class="icon-btn sm danger" data-del title="Supprimer">${icon("trash")}</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  root.onchange = async (e) => {
    if (!e.target.matches("[data-toggle]")) return;
    const id = e.target.closest("tr").dataset.id;
    try {
      if (team.remote()) await call("PUT", `/console/schedules/${id}`, { enabled: e.target.checked });
      else demoSchedules.find((s) => s.id === id).enabled = e.target.checked;
      toast(e.target.checked ? "Planification activée" : "Planification suspendue");
      load();
    } catch (err) {
      fail("Modification impossible")(err);
    }
  };
  root.onclick = async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    const name = tr.querySelector(".cell-title").textContent;
    try {
      if (e.target.closest("[data-run]")) {
        if (!team.remote()) return toast("Exécution simulée", "En démo, utilisez « Nouveau scan ».", "info");
        const { scan } = await call("POST", `/console/schedules/${id}/run`);
        toast("Scan lancé", name);
        location.hash = `#/scans/${encodeURIComponent(scan)}`;
      } else if (e.target.closest("[data-del]")) {
        if (!(await confirmDialog({ title: "Supprimer la planification ?", body: `« ${name} » ne sera plus exécutée. Les scans déjà réalisés sont conservés.`, confirm: "Supprimer", danger: true }))) return;
        if (team.remote()) await call("DELETE", `/console/schedules/${id}`);
        else demoSchedules.splice(demoSchedules.findIndex((s) => s.id === id), 1);
        toast("Planification supprimée", name);
        load();
      }
    } catch (err) {
      fail("Action impossible")(err);
    }
  };

  try {
    await load();
  } catch (err) {
    root.querySelector("#list").innerHTML = empty("alert", "Chargement impossible", err.message);
  }
}

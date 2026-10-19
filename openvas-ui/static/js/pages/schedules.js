// Scans planifiés (exécutés par le planificateur de server.py).
import { api } from "../api.js";
import { PORT_PRESETS, parsePorts } from "./newscan.js";
import { esc, icon, pageHead, modal, toast, empty, fmtDate, confirmDialog } from "../ui.js";

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const FREQ = { once: "Une fois", daily: "Quotidien", weekly: "Hebdomadaire", monthly: "Mensuel" };

export const describe = (s) => s.frequency === "weekly" ? `Chaque ${DAYS[s.weekday || 0]} à ${s.time}`
  : s.frequency === "monthly" ? `Le ${s.day} de chaque mois à ${s.time}` : s.frequency === "once" ? `Le ${s.date} à ${s.time}` : `Tous les jours à ${s.time}`;

export async function render(view, _p, ctx) {
  let items = await api.get("/schedules");
  const draw = () => {
    view.innerHTML = pageHead({ eyebrow: "Supervision", eyeIcon: "refresh", title: "Scans planifiés",
      sub: "Lancez automatiquement des scans récurrents ; chaque exécution crée un nouveau scan dans openvasd.",
      actions: `<button class="btn btn-primary" data-new data-write>${icon("plus")}Nouvelle planification</button>` }) +
      `<div class="card">${items.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Nom</th><th>Cibles</th><th>Fréquence</th><th>Dernière exécution</th><th>Actif</th><th></th></tr></thead><tbody>
      ${items.map((s) => `<tr><td class="name">${esc(s.name)}</td><td class="mono">${esc((s.scan?.target?.hosts || []).join(", "))}</td>
        <td><span class="pill info no-dot">${FREQ[s.frequency]}</span><div class="small muted" style="margin-top:3px">${esc(describe(s))}</div></td>
        <td class="small">${s.last_run ? fmtDate(s.last_run) : "—"}${s.last_scan ? ` · <a href="#/scans/${esc(s.last_scan)}">voir</a>` : ""}${s.last_error ? `<div class="c-crit">${esc(s.last_error)}</div>` : ""}</td>
        <td><button class="toggle ${s.enabled ? "on" : ""}" data-toggle="${s.id}"></button></td>
        <td class="right"><button class="btn btn-sm btn-icon btn-danger" data-del="${s.id}" title="Supprimer">${icon("trash")}</button></td></tr>`).join("")}
      </tbody></table></div>` : empty("Aucune planification", "Créez une planification pour surveiller votre parc en continu.", "calendar")}</div>`;
    view.querySelector("[data-new]").onclick = create;
    view.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = async () => {
      const s = items.find((x) => x.id === b.dataset.toggle);
      await api.put(`/schedules/${s.id}`, { enabled: !s.enabled }); s.enabled = !s.enabled; draw();
    }));
    view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog("Supprimer la planification ?", "Les scans déjà exécutés sont conservés.", "Supprimer"))) return;
      await api.del(`/schedules/${b.dataset.del}`); items = items.filter((x) => x.id !== b.dataset.del); draw();
    }));
  };

  const create = () => {
    const today = new Date().toISOString().slice(0, 10);
    modal("Nouvelle planification", `<div class="form-grid">
      <div class="field full"><label>Nom</label><input class="input" name="name" placeholder="Audit hebdomadaire DMZ"></div>
      <div class="field full"><label>Hôtes</label><textarea class="input" name="hosts" rows="3" placeholder="10.0.0.0/24"></textarea></div>
      <div class="field"><label>Ports</label><select class="select" name="ports">${Object.entries(PORT_PRESETS).filter(([k]) => k !== "custom").map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <div class="field"><label>Fréquence</label><select class="select" name="frequency">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${k === "weekly" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label>Heure</label><input class="input" type="time" name="time" value="02:00"></div>
      <div class="field" data-w><label>Jour de la semaine</label><select class="select" name="weekday">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("")}</select></div>
      <div class="field" data-m hidden><label>Jour du mois</label><input class="input" type="number" min="1" max="28" name="day" value="1"></div>
      <div class="field" data-o hidden><label>Date</label><input class="input" type="date" name="date" value="${today}"></div>
    </div>`, {
      ok: "Planifier",
      onOk: async (m) => {
        const v = (n) => m.querySelector(`[name=${n}]`).value;
        const hosts = v("hosts").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
        if (!hosts.length) throw new Error("Indiquez au moins un hôte.");
        const sched = { name: v("name") || hosts.join(", "), frequency: v("frequency"), time: v("time"), weekday: +v("weekday"), day: +v("day"), date: v("date"),
          scan: { target: { hosts, ports: parsePorts(PORT_PRESETS[v("ports")][2]), alive_test_methods: ["icmp", "tcp_syn", "consider_alive"] }, vts: [], scan_preferences: [] },
          vt_selection: { mode: "all" } };
        items.push(await api.post("/schedules", sched));
        toast("Planification créée"); draw();
      },
    });
    const m = document.querySelector(".modal-bg");
    const sync = () => { const f = m.querySelector("[name=frequency]").value; m.querySelector("[data-w]").hidden = f !== "weekly"; m.querySelector("[data-m]").hidden = f !== "monthly"; m.querySelector("[data-o]").hidden = f !== "once"; };
    m.querySelector("[name=frequency]").onchange = sync; sync();
  };
  draw();
  if (ctx.query.get("new")) create();
}

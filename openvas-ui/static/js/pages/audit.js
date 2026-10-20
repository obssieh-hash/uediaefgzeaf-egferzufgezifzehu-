// Journal d'activité : connexions, actions sur les scans, utilisateurs, suivi.
import { api } from "../api.js";
import { esc, icon, pageHead, fmtDate, ago, empty, download, toCSV } from "../ui.js";

const ACTIONS = {
  "login": ["Connexion", "ok"], "login.fail": ["Échec de connexion", "crit"],
  "scan.create": ["Scan créé", "info"], "scan.start": ["Scan démarré", "info"], "scan.stop": ["Scan arrêté", "warn"],
  "scan.pause": ["Scan mis en pause", "warn"], "scan.resume": ["Scan repris", "info"], "scan.duplicate": ["Scan dupliqué", "info"],
  "scan.delete": ["Scan supprimé", "crit"], "scan.rename": ["Scan renommé", ""],
  "user.create": ["Utilisateur créé", "violet"], "user.update": ["Utilisateur modifié", "violet"], "user.delete": ["Utilisateur supprimé", "crit"],
  "user.password": ["Mot de passe changé", "violet"], "tracking.update": ["Suivi de vulnérabilité", ""],
  "schedule.create": ["Planification créée", ""], "schedule.put": ["Planification modifiée", ""], "schedule.delete": ["Planification supprimée", "warn"],
};
const GROUPS = [["all", "Tout"], ["login", "Connexions"], ["scan", "Scans"], ["user", "Utilisateurs"], ["tracking", "Remédiation"], ["schedule", "Planifications"]];

export async function render(view, _p, ctx) {
  let items = await api.get("/audit?limit=2000");
  let group = "all", q = "";

  const draw = () => {
    const rows = items.filter((e) => (group === "all" || e.action.split(".")[0] === group)
      && (!q || `${e.user} ${e.ip} ${e.detail} ${ACTIONS[e.action]?.[0] || e.action}`.toLowerCase().includes(q)));
    const fails = items.filter((e) => e.action === "login.fail" && e.time > Date.now() / 1000 - 86400).length;
    view.innerHTML = pageHead({
      eyebrow: "Système", eyeIcon: "list", title: "Journal d'activité",
      sub: "Qui a fait quoi, quand et depuis quelle adresse (2 000 dernières actions).",
      actions: `<button class="btn" data-csv>${icon("download")}Exporter CSV</button>`,
    }) + `
      ${fails ? `<div class="banner info">${icon("alert")}<span><b>${fails}</b> échec(s) de connexion ces dernières 24 h.</span></div>` : ""}
      <div class="card"><div class="filters">
        <div class="search-in">${icon("search")}<input class="input" placeholder="Utilisateur, IP, scan…" value="${esc(q)}" data-q></div>
        <div class="seg" data-seg>${GROUPS.map(([k, l]) => `<button data-g="${k}" class="${group === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <span class="right">${rows.length} événement(s)</span></div>
      <div class="table-scroll"><table class="table"><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détail</th><th>Adresse IP</th></tr></thead><tbody>
      ${rows.slice(0, 500).map((e) => { const [l, c] = ACTIONS[e.action] || [e.action, ""]; return `<tr>
        <td class="small" style="white-space:nowrap">${fmtDate(e.time)}<div class="muted">${ago(e.time)}</div></td>
        <td class="strong">${esc(e.user)}</td><td><span class="pill ${c} no-dot">${esc(l)}</span></td>
        <td class="small">${esc(e.detail)}</td><td class="mono small">${esc(e.ip)}</td></tr>`; }).join("")
        || `<tr><td colspan="5">${empty("Aucun événement", "", "list")}</td></tr>`}</tbody></table></div></div>`;
    const input = view.querySelector("[data-q]");
    input.oninput = (e) => { q = e.target.value.toLowerCase(); draw(); const i = view.querySelector("[data-q]"); i.focus(); i.setSelectionRange(q.length, q.length); };
    view.querySelector("[data-seg]").onclick = (e) => { const b = e.target.closest("button"); if (b) { group = b.dataset.g; draw(); } };
    view.querySelector("[data-csv]").onclick = () => download("journal-activite.csv", toCSV(rows, [
      ["Date", (e) => new Date(e.time * 1000).toISOString()], ["Utilisateur", (e) => e.user], ["Action", (e) => ACTIONS[e.action]?.[0] || e.action],
      ["Détail", (e) => e.detail], ["IP", (e) => e.ip]]), "text/csv");
  };
  draw();
  ctx.every(async () => {
    if (document.activeElement?.matches("[data-q]")) return;
    items = await api.get("/audit?limit=2000");
    if (ctx.alive()) draw();
  }, 20000);
}

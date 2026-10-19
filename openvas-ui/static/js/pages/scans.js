// Liste des scans.
import { api } from "../api.js";
import { store } from "../app.js";
import { esc, icon, statusPill, isActive, fmtDate, pageHead, empty, sevBadge, levelOf } from "../ui.js";

export async function render(view, _p, ctx) {
  let filter = "all", q = "";
  let scans = await api.get("/scans");
  store.scans = scans;

  const draw = () => {
    const counts = { all: scans.length, active: scans.filter((s) => isActive(s.status.status)).length,
      done: scans.filter((s) => s.status.status === "succeeded").length,
      other: scans.filter((s) => ["stopped", "failed", "stored"].includes(s.status.status)).length };
    const rows = scans.filter((s) => {
      const st = s.status.status;
      if (filter === "active" && !isActive(st)) return false;
      if (filter === "done" && st !== "succeeded") return false;
      if (filter === "other" && !["stopped", "failed", "stored"].includes(st)) return false;
      const ql = q.toLowerCase();
      return !ql || s.name.toLowerCase().includes(ql) || s.id.includes(ql) || (s.targets || []).some((t) => t.includes(ql));
    });
    view.innerHTML = pageHead({
      eyebrow: "Supervision", eyeIcon: "radar", title: "Scans",
      sub: "Tous les scans connus d'openvasd, avec leur progression et leurs résultats.",
      actions: `<a class="btn btn-primary" href="#/new" data-write>${icon("plus")}Nouveau scan</a>`,
    }) + `<div class="card">
      <div class="filters">
        <div class="search-in">${icon("search")}<input class="input" placeholder="Nom, cible, identifiant…" value="${esc(q)}" data-q></div>
        <div class="seg" data-seg>${[["all", "Tous"], ["active", "En cours"], ["done", "Terminés"], ["other", "Arrêtés / en attente"]]
          .map(([k, l]) => `<button data-f="${k}" class="${filter === k ? "on" : ""}">${l} <span class="muted">${counts[k]}</span></button>`).join("")}</div>
        <span class="right">${rows.length} scan(s)</span>
      </div>
      <div class="table-scroll"><table class="table"><thead><tr>
        <th>Nom</th><th>Cibles</th><th>Statut</th><th style="width:200px">Progression</th><th>Vulnérabilités</th><th>Début</th></tr></thead>
      <tbody>${rows.length ? rows.map(row).join("") : `<tr><td colspan="6">${empty("Aucun scan", "Lancez votre premier scan depuis « Nouveau scan ».", "radar")}</td></tr>`}</tbody></table></div></div>`;
    const input = view.querySelector("[data-q]");
    input.oninput = (e) => { q = e.target.value; draw(); const i = view.querySelector("[data-q]"); i.focus(); i.setSelectionRange(q.length, q.length); };
    view.querySelector("[data-seg]").onclick = (e) => { const b = e.target.closest("button"); if (b) { filter = b.dataset.f; draw(); } };
    view.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = `#/scans/${tr.dataset.id}`)));
  };
  draw();
  ctx.every(async () => {
    if (!scans.some((s) => isActive(s.status.status))) return;
    if (document.activeElement?.matches("[data-q]")) return;
    scans = await api.get("/scans"); store.scans = scans;
    if (ctx.alive()) draw();
  }, 6000);
}

function row(s) {
  const sum = s.summary || { counts: {} }, c = sum.counts;
  const lvl = levelOf(sum.max_severity);
  return `<tr class="click" data-id="${esc(s.id)}">
    <td><div class="name">${esc(s.name)}</div><div class="sub">${esc(s.id.slice(0, 18))}…</div></td>
    <td class="mono">${esc((s.targets || []).slice(0, 2).join(", "))}${(s.targets || []).length > 2 ? ` <span class="muted">+${s.targets.length - 2}</span>` : ""}</td>
    <td>${statusPill(s.status.status)}${s.kind === "container" ? ' <span class="pill violet no-dot">Docker</span>' : ""}${s.kind === "web" ? ' <span class="pill info no-dot">Web</span>' : ""}</td>
    <td><div class="flex"><div class="bar thin" style="flex:1"><i style="width:${s.progress}%"></i></div><span class="small muted" style="width:34px;text-align:right">${s.progress}%</span></div></td>
    <td><div class="flex" style="gap:6px">${sum.vulns ? sevBadge(lvl, sum.max_severity) : '<span class="muted">—</span>'}
      ${["critical", "high", "medium", "low"].filter((l) => c[l]).map((l) => `<span class="pill ${{ critical: "crit", high: "high", medium: "med", low: "low" }[l]} no-dot" title="${l}">${c[l]}</span>`).join("")}</div></td>
    <td class="small muted">${fmtDate(s.status.start_time || s.created)}</td></tr>`;
}

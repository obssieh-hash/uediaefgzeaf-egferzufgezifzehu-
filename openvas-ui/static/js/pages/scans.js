// Liste des scans : filtres, actions par ligne (pause, reprise, suppression)
// et suppression groupée.
import { api } from "../api.js";
import { store, refreshInfo } from "../app.js";
import { esc, icon, statusPill, isActive, fmtDate, pageHead, empty, sevBadge, levelOf, toast, confirmDialog } from "../ui.js";

const STOPPED = ["stopped", "failed", "stored", "paused"];

export async function render(view, _p, ctx) {
  let filter = "all", q = "";
  let scans = await api.get("/scans");
  const selected = new Set();
  store.scans = scans;
  const isAdmin = document.body.classList.contains("role-admin");
  const isDev = document.body.classList.contains("role-developer");

  const reload = async () => {
    scans = await api.get("/scans"); store.scans = scans;
    for (const id of [...selected]) if (!scans.some((s) => s.id === id)) selected.delete(id);
    if (ctx.alive()) draw();
  };

  const draw = () => {
    const counts = { all: scans.length, active: scans.filter((s) => isActive(s.status.status)).length,
      done: scans.filter((s) => s.status.status === "succeeded").length,
      other: scans.filter((s) => STOPPED.includes(s.status.status)).length };
    const rows = scans.filter((s) => {
      const st = s.status.status;
      if (filter === "active" && !isActive(st)) return false;
      if (filter === "done" && st !== "succeeded") return false;
      if (filter === "other" && !STOPPED.includes(st)) return false;
      const ql = q.toLowerCase();
      return !ql || s.name.toLowerCase().includes(ql) || s.id.includes(ql) || (s.targets || []).some((t) => t.includes(ql));
    });
    const allSel = rows.length && rows.every((s) => selected.has(s.id));
    view.innerHTML = pageHead({
      eyebrow: "Supervision", eyeIcon: "radar", title: isDev ? "Mes scans" : "Scans",
      sub: isDev ? "Les scans qui vous sont attribués par un administrateur." : "Tous les scans connus d'openvasd, avec leur progression et leurs résultats.",
      actions: `<a class="btn btn-primary" href="#/new" data-write>${icon("plus")}Nouveau scan</a>`,
    }) + `<div class="card">
      <div class="filters">
        <div class="search-in">${icon("search")}<input class="input" placeholder="Nom, cible, identifiant…" value="${esc(q)}" data-q></div>
        <div class="seg" data-seg>${[["all", "Tous"], ["active", "En cours"], ["done", "Terminés"], ["other", "Arrêtés / en pause"]]
          .map(([k, l]) => `<button data-f="${k}" class="${filter === k ? "on" : ""}">${l} <span class="muted">${counts[k]}</span></button>`).join("")}</div>
        <span class="right">${rows.length} scan(s)</span>
      </div>
      ${selected.size ? `<div class="bulk-bar" data-write><b>${selected.size} scan(s) sélectionné(s)</b>
        <button class="btn btn-sm btn-danger" data-bulk-delete>${icon("trash")}Supprimer la sélection</button>
        <button class="btn btn-sm btn-ghost" data-bulk-clear>Annuler</button></div>` : ""}
      <div class="table-scroll"><table class="table"><thead><tr>
        ${isAdmin ? `<th class="chk"><input type="checkbox" data-all ${allSel ? "checked" : ""} aria-label="Tout sélectionner"></th>` : ""}
        <th>Nom</th><th>Cibles</th><th>Statut</th><th style="width:200px">Progression</th><th>Vulnérabilités</th><th>Début</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map((s) => row(s, isAdmin, selected.has(s.id))).join("")
        : `<tr><td colspan="8">${empty(isDev ? "Aucun scan attribué" : "Aucun scan", isDev ? "Demandez à un administrateur de vous attribuer des scans." : "Lancez votre premier scan depuis « Nouveau scan ».", "radar")}</td></tr>`}</tbody></table></div></div>`;
    const input = view.querySelector("[data-q]");
    input.oninput = (e) => { q = e.target.value; draw(); const i = view.querySelector("[data-q]"); i.focus(); i.setSelectionRange(q.length, q.length); };
    view.querySelector("[data-seg]").onclick = (e) => { const b = e.target.closest("button"); if (b) { filter = b.dataset.f; draw(); } };
    view.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = (e) => {
      if (e.target.closest("button, input, .chk")) return;
      location.hash = `#/scans/${tr.dataset.id}`;
    }));
    view.querySelectorAll("[data-sel]").forEach((c) => (c.onchange = () => {
      c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); draw();
    }));
    view.querySelector("[data-all]")?.addEventListener("change", (e) => {
      rows.forEach((s) => (e.target.checked ? selected.add(s.id) : selected.delete(s.id))); draw();
    });
    view.querySelector("[data-bulk-clear]")?.addEventListener("click", () => { selected.clear(); draw(); });
    view.querySelector("[data-bulk-delete]")?.addEventListener("click", async () => {
      const running = scans.filter((s) => selected.has(s.id) && isActive(s.status.status)).length;
      if (!(await confirmDialog(`Supprimer ${selected.size} scan(s) ?`, `Les scans sélectionnés et leurs résultats seront supprimés d'openvasd.${running ? ` ${running} scan(s) en cours seront d'abord arrêtés.` : ""} Cette action est irréversible.`, "Supprimer"))) return;
      try {
        const r = await api.post("/scans/delete", { ids: [...selected] });
        toast(`${r.deleted} scan(s) supprimé(s)`);
        selected.clear(); refreshInfo(); await reload();
      } catch (err) { toast(err.message, "err"); }
    });
    view.querySelectorAll("[data-row-act]").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const [act, id] = b.dataset.rowAct.split(":");
      const s = scans.find((x) => x.id === id);
      if (act === "delete" && !(await confirmDialog("Supprimer le scan ?", `Le scan « ${esc(s.name)} » et ses résultats seront supprimés.${isActive(s.status.status) ? " Il est en cours : il sera d'abord arrêté." : ""}`, "Supprimer"))) return;
      if (act === "stop" && !(await confirmDialog("Arrêter le scan ?", "Les résultats déjà collectés sont conservés.", "Arrêter"))) return;
      b.disabled = true;
      try {
        if (act === "delete") { await api.del(`/scans/${id}`); toast("Scan supprimé"); refreshInfo(); return reload(); }
        const r = await api.post(`/scans/${id}/${act}`);
        if (act === "resume") { toast("Scan repris : les hôtes déjà terminés sont ignorés"); location.hash = `#/scans/${r.id}`; return; }
        toast({ pause: "Scan mis en pause", stop: "Scan arrêté", start: "Scan démarré" }[act]);
        await reload();
      } catch (err) { toast(err.message, "err"); b.disabled = false; }
    }));
  };
  draw();
  ctx.every(async () => {
    if (!scans.some((s) => isActive(s.status.status))) return;
    if (document.activeElement?.matches("[data-q]")) return;
    await reload();
  }, 6000);
}

function row(s, isAdmin, checked) {
  const sum = s.summary || { counts: {} }, c = sum.counts;
  const lvl = levelOf(sum.max_severity);
  const st = s.status.status;
  const btn = (act, ic, title, attr = "data-op", cls = "btn-ghost") =>
    `<button class="btn btn-sm btn-icon ${cls}" data-row-act="${act}:${esc(s.id)}" ${attr} title="${title}" aria-label="${title}">${icon(ic)}</button>`;
  const acts = [
    isActive(st) ? btn("pause", "pause", "Mettre en pause") + btn("stop", "stop", "Arrêter") : "",
    st === "stored" ? btn("start", "play", "Démarrer") : "",
    ["failed", "stopped", "paused"].includes(st) && !s.resumed_by ? btn("resume", st === "paused" ? "play" : "refresh", "Reprendre (hôtes terminés ignorés)") : "",
    btn("delete", "trash", "Supprimer", "data-write"),
  ].join("");
  return `<tr class="click" data-id="${esc(s.id)}">
    ${isAdmin ? `<td class="chk"><input type="checkbox" data-sel="${esc(s.id)}" ${checked ? "checked" : ""} aria-label="Sélectionner"></td>` : ""}
    <td><div class="name">${esc(s.name)}</div><div class="sub">${esc(s.id.slice(0, 18))}…</div></td>
    <td class="mono">${esc((s.targets || []).slice(0, 2).join(", "))}${(s.targets || []).length > 2 ? ` <span class="muted">+${s.targets.length - 2}</span>` : ""}</td>
    <td>${statusPill(st)}${s.kind === "container" ? ' <span class="pill violet no-dot">Docker</span>' : ""}${s.kind === "web" ? ' <span class="pill info no-dot">Web</span>' : ""}</td>
    <td><div class="flex"><div class="bar thin" style="flex:1"><i style="width:${s.progress}%"></i></div><span class="small muted" style="width:34px;text-align:right">${s.progress}%</span></div></td>
    <td><div class="flex" style="gap:6px">${sum.vulns ? sevBadge(lvl, sum.max_severity) : '<span class="muted">—</span>'}
      ${["critical", "high", "medium", "low"].filter((l) => c[l]).map((l) => `<span class="pill ${{ critical: "crit", high: "high", medium: "med", low: "low" }[l]} no-dot" title="${l}">${c[l]}</span>`).join("")}</div></td>
    <td class="small muted">${fmtDate(s.status.start_time || s.created)}</td>
    <td><div class="flex" style="gap:2px;justify-content:flex-end;white-space:nowrap">${acts}</div></td></tr>`;
}

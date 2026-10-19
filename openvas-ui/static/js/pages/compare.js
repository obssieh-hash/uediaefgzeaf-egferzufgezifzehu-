// Comparaison de deux scans : nouvelles, corrigées et persistantes.
import { api } from "../api.js";
import { group } from "../results.js";
import { esc, icon, pageHead, sevBadge, fmtDate, empty, $ } from "../ui.js";

export async function render(view, _p, ctx) {
  const scans = (await api.get("/scans")).filter((s) => s.status.status !== "stored");
  let a = ctx.query.get("a") || scans[1]?.id || "", b = ctx.query.get("b") || scans[0]?.id || "";
  let tab = "new";

  const opts = (sel) => scans.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)} — ${fmtDate(s.status.start_time)}</option>`).join("");
  view.innerHTML = pageHead({ eyebrow: "Analyse", eyeIcon: "compare", title: "Comparer", sub: "Mesurez l'évolution entre deux scans : ce qui est apparu, ce qui a été corrigé, ce qui persiste." }) +
    `<div class="card"><div class="card-b flex wrap" style="gap:14px">
      <div class="field" style="flex:1;min-width:240px"><label>Scan de référence (avant)</label><select class="select" data-a>${opts(a)}</select></div>
      <span style="margin-top:20px">${icon("chevRight")}</span>
      <div class="field" style="flex:1;min-width:240px"><label>Scan comparé (après)</label><select class="select" data-b>${opts(b)}</select></div>
    </div></div><div data-out class="mt"></div>`;
  $("[data-a]", view).onchange = (e) => { a = e.target.value; run(); };
  $("[data-b]", view).onchange = (e) => { b = e.target.value; run(); };

  async function run() {
    const out = $("[data-out]", view);
    if (!a || !b) { out.innerHTML = `<div class="card">${empty("Il faut au moins deux scans", "", "compare")}</div>`; return; }
    out.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const [A, B] = await Promise.all([api.get(`/scans/${a}`), api.get(`/scans/${b}`)]);
    const key = (r) => `${r.oid}|${r.ip_address}|${r.port_label}`;
    const va = new Map(group(A.results).filter((r) => r.type === "alarm").map((r) => [key(r), r]));
    const vb = new Map(group(B.results).filter((r) => r.type === "alarm").map((r) => [key(r), r]));
    const sets = {
      new: [...vb].filter(([k]) => !va.has(k)).map(([, r]) => r),
      fixed: [...va].filter(([k]) => !vb.has(k)).map(([, r]) => r),
      same: [...vb].filter(([k]) => va.has(k)).map(([, r]) => r),
    };
    const delta = vb.size - va.size;
    const draw = () => {
      const list = sets[tab].sort((x, y) => y.severity - x.severity);
      out.innerHTML = `<div class="grid g4">
        ${[["Avant", va.size, "clock", "ico-info", A.name], ["Après", vb.size, "activity", "ico-info", `${delta > 0 ? "+" : ""}${delta} vulnérabilité(s)`],
           ["Nouvelles", sets.new.length, "arrowUp", "ico-crit", "apparues depuis la référence"], ["Corrigées", sets.fixed.length, "arrowDown", "ico-ok", "disparues depuis la référence"]]
          .map(([l, v, ic, c, s]) => `<div class="card kpi"><div class="kpi-h"><span class="kpi-ico ${c}">${icon(ic)}</span>${l}</div><div class="kpi-v">${v}</div><div class="kpi-s">${esc(s)}</div></div>`).join("")}
      </div>
      <nav class="tabs">${[["new", "Nouvelles"], ["fixed", "Corrigées"], ["same", "Persistantes"]].map(([k, l]) => `<a data-t="${k}" class="${tab === k ? "active" : ""}">${l}<span class="cnt">${sets[k].length}</span></a>`).join("")}</nav>
      <div class="card">${list.length ? `<table class="table"><thead><tr><th>Sévérité</th><th>Vulnérabilité</th><th>Hôte</th><th>Port</th></tr></thead><tbody>
        ${list.map((r) => `<tr><td style="width:120px">${sevBadge(r.level, r.severity)}</td><td><div class="name">${esc(r.name)}</div><div class="sub">${esc(r.oid)}</div></td>
        <td class="mono">${esc(r.ip_address)}</td><td class="mono">${esc(r.port_label)}</td></tr>`).join("")}</tbody></table>` : empty("Aucune entrée", "", tab === "fixed" ? "check" : "search")}</div>`;
      out.querySelectorAll("[data-t]").forEach((t) => (t.onclick = () => { tab = t.dataset.t; draw(); }));
    };
    draw();
  }
  run();
}

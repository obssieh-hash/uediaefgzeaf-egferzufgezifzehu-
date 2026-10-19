// Tests de vulnérabilité : exploration du flux de VTs.
import { api } from "../api.js";
import { esc, icon, pageHead, sevBadge, levelOf, fmtNum, empty, modal, $ } from "../ui.js";

const SOLUTION = { VendorFix: "Correctif éditeur", Mitigation: "Atténuation", Workaround: "Contournement", WillNotFix: "Pas de correctif", NoneAvailable: "Aucune" };

export async function render(view, _p, ctx) {
  const st = { q: ctx.query.get("q") || "", family: "", severity: "", page: 0 };
  let timer;
  view.innerHTML = pageHead({ eyebrow: "Connaissances", eyeIcon: "shield", title: "Tests de vulnérabilité",
    sub: "Parcourez les VTs (Vulnerability Tests) du flux chargé par openvasd." }) + `<div class="card"><div class="filters">
      <div class="search-in">${icon("search")}<input class="input" placeholder="Nom, OID ou CVE…" value="${esc(st.q)}" data-q></div>
      <select class="select" data-fam style="max-width:260px"><option value="">Toutes les familles</option></select>
      <div class="seg" data-sev>${[["", "Toutes"], ["critical", "Critiques"], ["high", "Élevées"], ["medium", "Moyennes"], ["low", "Faibles"]].map(([k, l]) => `<button data-s="${k}" class="${k === "" ? "on" : ""}">${l}</button>`).join("")}</div>
      <span class="right" data-total></span></div><div data-body></div></div>`;
  let famsLoaded = false;

  const load = async () => {
    const qs = new URLSearchParams({ q: st.q, family: st.family, severity: st.severity, page: st.page, size: 50 });
    const r = await api.get(`/vts?${qs}`);
    if (!ctx.alive()) return;
    if (!famsLoaded && r.families.length) {
      famsLoaded = true;
      $("[data-fam]", view).innerHTML += r.families.map(([f, n]) => `<option value="${esc(f)}">${esc(f)} (${fmtNum(n)})</option>`).join("");
    }
    $("[data-total]", view).textContent = `${fmtNum(r.total)} VT(s)`;
    const pages = Math.ceil(r.total / 50);
    $("[data-body]", view).innerHTML = r.state !== "ready" && !r.total
      ? `<div class="loading"><div class="spinner"></div>Chargement des métadonnées des VTs depuis openvasd (${esc(r.state)})…</div>`
      : r.items.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Sévérité</th><th>Nom</th><th>Famille</th><th>Solution</th><th>Modifié</th></tr></thead><tbody>
        ${r.items.map((v) => `<tr class="click" data-oid="${esc(v.oid)}"><td style="width:120px">${sevBadge(levelOf(v.score), v.score)}</td>
          <td><div class="name trunc">${esc(v.name)}</div><div class="sub">${esc(v.oid)}${v.cves.length ? " · " + esc(v.cves.slice(0, 3).join(", ")) : ""}</div></td>
          <td class="small">${esc(v.family)}</td><td class="small">${esc(SOLUTION[v.solution_type] || v.solution_type || "—")}</td><td class="small muted">${esc((v.modified || "").slice(0, 10))}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="between" style="padding:12px 14px;border-top:1px solid var(--border)"><span class="muted small">Page ${st.page + 1} / ${pages}</span>
          <div class="actions"><button class="btn btn-sm" data-prev ${st.page ? "" : "disabled"}>Précédent</button><button class="btn btn-sm" data-next ${st.page + 1 < pages ? "" : "disabled"}>Suivant</button></div></div>`
        : empty("Aucun VT trouvé");
    view.querySelector("[data-prev]")?.addEventListener("click", () => { st.page--; load(); });
    view.querySelector("[data-next]")?.addEventListener("click", () => { st.page++; load(); });
    view.querySelectorAll("tr[data-oid]").forEach((tr) => (tr.onclick = () => show(tr.dataset.oid)));
    if (r.state !== "ready" && !r.total) setTimeout(() => ctx.alive() && load(), 5000);
  };
  $("[data-q]", view).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value; st.page = 0; load(); }, 250); };
  $("[data-fam]", view).onchange = (e) => { st.family = e.target.value; st.page = 0; load(); };
  $("[data-sev]", view).onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    st.severity = b.dataset.s; st.page = 0;
    view.querySelectorAll("[data-sev] button").forEach((x) => x.classList.toggle("on", x === b));
    load();
  };
  await load();
}

async function show(oid) {
  const v = await api.get(`/vts/${encodeURIComponent(oid)}`);
  const m = modal(v.name, `<div class="grid" style="gap:12px">
    <div class="flex wrap">${sevBadge(levelOf(v.score), v.score)}<span class="chip">${esc(v.family)}</span>${v.qod ? `<span class="chip x">QoD ${esc(v.qod)} %</span>` : ""}</div>
    ${[["Résumé", v.summary], ["Analyse", v.insight], ["Logiciels affectés", v.affected], ["Impact", v.impact], ["Méthode de détection", v.vuldetect], ["Solution", v.solution]]
      .filter(([, t]) => t).map(([h, t]) => `<div><div class="label" style="margin-bottom:4px">${h}</div><div style="color:var(--text-2);line-height:1.6">${esc(t)}</div></div>`).join("")}
    <dl class="kv"><dt>OID</dt><dd class="mono">${esc(v.oid)}</dd>${v.vector ? `<dt>Vecteur</dt><dd class="mono">${esc(v.vector)}</dd>` : ""}
      ${v.cves.length ? `<dt>CVE</dt><dd class="chips">${v.cves.map((c) => `<a class="chip" target="_blank" rel="noopener" href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c)}">${esc(c)}</a>`).join("")}</dd>` : ""}
      ${v.created ? `<dt>Créé</dt><dd>${esc(v.created.slice(0, 10))}</dd>` : ""}</dl></div>`, { ok: null, cancel: "Fermer" });
  m.querySelector(".modal").style.width = "min(720px, 100%)";
}

import { loadVts, shouldEnrich, vtsLoaded } from "../store.js";
import { debounce, esc, icon, num, severityBadge, severityLevel, vtSeverity } from "../util.js";
import { drawer, empty, fail, skeletonRows } from "../ui.js";

const PAGE = 50;
const SEV = [
  ["all", "Toutes"],
  ["critical", "Critique"],
  ["high", "Élevée"],
  ["medium", "Moyenne"],
  ["low", "Faible"],
  ["log", "Info"],
];

const date = (ts) => (ts ? new Date(Number(ts) * 1000).toLocaleDateString("fr-FR", { dateStyle: "medium" }) : "—");

function vtDrawer(v, score) {
  const tag = v.tag || {};
  const section = (title, text) => (text ? `<div><h4>${title}</h4><p>${esc(text)}</p></div>` : "");
  const refs = v.references || [];
  drawer(
    `<div class="row" style="margin-bottom:8px">${severityBadge(score)}<span class="tag">${esc(v.family)}</span></div>
     <h3>${esc(v.name)}</h3><div class="row"><span class="mono faint" style="font-size:12.5px">${esc(v.oid)}</span>
     <button class="icon-btn sm" data-copy="${esc(v.oid)}">${icon("copy")}</button></div>`,
    `${section("Résumé", tag.summary)}${section("Analyse", tag.insight)}${section("Impact", tag.impact)}${section("Méthode de détection", tag.vuldetect)}
     ${tag.solution ? `<div><h4>Solution ${tag.solution_type ? `<span class="tag">${esc(tag.solution_type)}</span>` : ""}</h4><p>${esc(tag.solution)}</p></div>` : ""}
     ${section("Produits concernés", tag.affected)}
     <dl class="kv">
       ${tag.severity_vector || tag.cvss_base_vector ? `<dt>Vecteur CVSS</dt><dd class="mono">${esc(tag.severity_vector || tag.cvss_base_vector)}</dd>` : ""}
       <dt>Catégorie</dt><dd>${esc(v.category || "—")}</dd>
       <dt>Fichier</dt><dd class="mono">${esc(v.filename || "—")}</dd>
       ${tag.qod_type ? `<dt>QoD</dt><dd>${esc(tag.qod_type)}</dd>` : ""}
       <dt>Créé</dt><dd>${date(tag.creation_date)}</dd>
       <dt>Modifié</dt><dd>${date(tag.last_modification)}</dd>
       ${v.dependencies?.length ? `<dt>Dépendances</dt><dd>${v.dependencies.map((d) => `<span class="tag mono">${esc(d)}</span>`).join(" ")}</dd>` : ""}
     </dl>
     ${refs.length ? `<div><h4>Références</h4><div class="pills">${refs.map((r) => r.class === "cve"
        ? `<a class="tag mono" target="_blank" rel="noopener" href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(r.id)}">${esc(r.id)}</a>`
        : `<span class="tag mono" title="${esc(r.class)}">${esc(r.id)}</span>`).join(" ")}</div></div>` : ""}
     ${v.preferences?.length ? `<div><h4>Paramètres du VT</h4><dl class="kv">${v.preferences.map((p) => `<dt>${esc(p.id)} · ${esc(p.name)}</dt><dd class="mono">${esc(p.default ?? "")}</dd>`).join("")}</dl></div>` : ""}`,
  );
}

export default async function vts(root) {
  let rows = null;
  let query = "";
  let family = "";
  let sev = "all";
  let page = 0;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Tests de vulnérabilité</h1><p>Parcourez le feed de VTs chargé par le scanner : sévérité, famille, références et solutions.</p></div>
    </div>
    <div id="body"></div>`;
  const body = root.querySelector("#body");

  async function load(btn) {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${icon("refresh", "spin")}Téléchargement du catalogue…`;
    } else body.innerHTML = `<div class="card">${skeletonRows(8, 20)}</div>`;
    try {
      const index = await loadVts();
      rows = [...index.values()].map((v) => {
        const score = vtSeverity(v);
        return { v, score, lvl: severityLevel(score).key, text: `${v.name} ${v.oid} ${v.family} ${(v.references || []).map((r) => r.id).join(" ")}`.toLowerCase() };
      });
      rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      layout();
    } catch (err) {
      fail("Catalogue indisponible")(err);
      body.innerHTML = `<div class="card">${empty("alert", "Impossible de charger les VTs", err.message)}</div>`;
    }
  }

  function layout() {
    const families = [...new Set(rows.map((r) => r.v.family))].sort();
    const count = (k) => rows.filter((r) => r.lvl === k).length;
    body.innerHTML = `
      <div class="grid g-4" style="margin-bottom:20px">
        <div class="card kpi accent"><div class="label"><span class="ico">${icon("shield")}</span>VTs</div><div class="value">${num(rows.length)}</div><div class="foot">dans le feed</div></div>
        <div class="card kpi"><div class="label"><span class="ico">${icon("layers")}</span>Familles</div><div class="value">${num(families.length)}</div><div class="foot">catégories de tests</div></div>
        <div class="card kpi danger"><div class="label"><span class="ico">${icon("alert")}</span>Critiques</div><div class="value">${num(count("critical"))}</div><div class="foot">CVSS ≥ 9.0</div></div>
        <div class="card kpi warn"><div class="label"><span class="ico">${icon("bolt")}</span>Élevées</div><div class="value">${num(count("high"))}</div><div class="foot">CVSS 7.0 – 8.9</div></div>
      </div>
      <section class="card">
        <div class="toolbar">
          <label class="input-icon">${icon("search")}<input class="input" id="vq" placeholder="Nom, OID, CVE…" /></label>
          <select class="select" id="vf" style="width:auto;max-width:260px"><option value="">Toutes les familles</option>${families.map((f) => `<option>${esc(f)}</option>`).join("")}</select>
          <div class="seg" id="vs">${SEV.map(([k, l]) => `<button data-sev="${k}" class="${sev === k ? "on" : ""}">${l}</button>`).join("")}</div>
        </div>
        <div id="vlist"></div>
      </section>`;
    draw();
  }

  function draw() {
    const q = query.toLowerCase();
    const shown = rows.filter((r) => (!q || r.text.includes(q)) && (!family || r.v.family === family) && (sev === "all" || r.lvl === sev));
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = shown.slice(page * PAGE, page * PAGE + PAGE);
    root.querySelectorAll("#vs [data-sev]").forEach((b) => b.classList.toggle("on", b.dataset.sev === sev));
    root.querySelector("#vlist").innerHTML = shown.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th style="width:130px">Sévérité</th><th>Nom</th><th class="hide-sm">Famille</th><th class="hide-sm">Modifié</th></tr></thead>
        <tbody>${slice.map((r) => `<tr class="clickable" data-oid="${esc(r.v.oid)}">
          <td>${severityBadge(r.score)}</td>
          <td><div class="cell-title">${esc(r.v.name)}</div><div class="cell-sub">${esc(r.v.oid)}</div></td>
          <td class="hide-sm"><span class="tag">${esc(r.v.family)}</span></td>
          <td class="hide-sm muted">${date(r.v.tag?.last_modification)}</td></tr>`).join("")}</tbody></table></div>
        <div class="pager"><span class="grow">${num(shown.length)} VT${shown.length > 1 ? "s" : ""} · page ${page + 1} / ${pages}</span>
          <button class="btn btn-sm" data-page="-1" ${page ? "" : "disabled"}>${icon("back")}Précédent</button>
          <button class="btn btn-sm" data-page="1" ${page < pages - 1 ? "" : "disabled"}>Suivant${icon("chevron")}</button></div>`
      : empty("search", "Aucun VT ne correspond", "Essayez un autre terme, une autre famille ou une autre sévérité.");
  }

  root.oninput = debounce((e) => {
    if (e.target.id === "vq") ((query = e.target.value.trim()), (page = 0), draw());
  }, 150);
  root.onchange = (e) => {
    if (e.target.id === "vf") ((family = e.target.value), (page = 0), draw());
  };
  root.onclick = (e) => {
    const s = e.target.closest("[data-sev]");
    if (s) return ((sev = s.dataset.sev), (page = 0), draw());
    const p = e.target.closest("[data-page]");
    if (p) return ((page += Number(p.dataset.page)), draw(), window.scrollTo({ top: 0, behavior: "smooth" }));
    const l = e.target.closest("[data-load]");
    if (l) return load(l);
    const tr = e.target.closest("tr[data-oid]");
    if (tr) {
      const r = rows.find((x) => x.v.oid === tr.dataset.oid);
      vtDrawer(r.v, r.score);
    }
  };

  if (vtsLoaded() || shouldEnrich()) return void (await load());

  // Live scanners ship 100 000+ VTs: only download the full catalogue on request.
  body.innerHTML = `<div class="card">${empty(
    "shield",
    "Catalogue de VTs",
    "Le feed complet (métadonnées de plus de 100 000 tests) représente un téléchargement volumineux. Chargez-le pour l'explorer et enrichir vos résultats avec les scores CVSS.",
    `<button class="btn btn-primary" data-load>${icon("download")}Charger le catalogue</button>`,
  )}</div>`;
}

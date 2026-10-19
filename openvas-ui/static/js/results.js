// Tableau de résultats partagé (vulnérabilités / tous les résultats), avec
// regroupement des doublons et lignes dépliables.
import { esc, icon, sevBadge, LEVEL_RANK, LEVEL_LABEL, copy, empty } from "./ui.js";

const RTYPE = {
  alarm: ["Vulnérabilité", "crit"], log: ["Journal", "info"], error: ["Erreur", "warn"],
  host_detail: ["Détail d'hôte", ""], host_start: ["Début d'hôte", ""], host_stop: ["Fin d'hôte", ""],
};
const SOLUTION = { VendorFix: "Correctif éditeur", Mitigation: "Atténuation", Workaround: "Contournement", WillNotFix: "Pas de correctif", NoneAvailable: "Aucune solution" };

/** Regroupe les résultats identiques (même VT, hôte, port). */
export function group(results) {
  const map = new Map();
  for (const r of results) {
    if (["host_start", "host_stop"].includes(r.type)) continue;
    const k = r.type === "host_detail" ? `d${r.id}` : `${r.type}|${r.oid}|${r.ip_address}|${r.port_label}`;
    const cur = map.get(k);
    if (cur) { cur.count++; if (r.message && !cur.message.includes(r.message)) cur.message += "\n\n" + r.message; }
    else map.set(k, { ...r, count: 1, message: r.message || "" });
  }
  return [...map.values()].sort((a, b) => (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || ((b.severity || 0) - (a.severity || 0)) || String(a.name).localeCompare(b.name));
}

export function trackingKey(r) { return `${r.oid}|${r.ip_address}|${r.port_label}`; }

/**
 * Monte un tableau de résultats filtrable dans `root`.
 * opts: { mode: "vulns"|"all", tracking }
 */
export function mountResults(root, results, opts = {}) {
  const mode = opts.mode || "vulns";
  const state = { q: "", min: "all", type: "", open: new Set() };
  const all = group(results).filter((r) => mode !== "vulns" || r.type === "alarm");

  root.innerHTML = `<div class="card">
    <div class="filters">
      <div class="search-in">${icon("search")}<input class="input" placeholder="Filtrer les résultats…" data-q></div>
      ${mode === "vulns" ? `<div class="seg" data-seg>
        <button data-min="all" class="on">Toutes</button><button data-min="medium">≥ Moyenne</button>
        <button data-min="high">≥ Élevée</button><button data-min="critical">Critiques</button></div>`
      : `<select class="select" data-type><option value="">Tous les types</option>
        ${Object.entries(RTYPE).filter(([k]) => !k.startsWith("host_s")).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join("")}</select>`}
      <span class="right" data-count></span>
    </div>
    <div class="table-scroll"><table class="table">
      <thead><tr><th style="width:120px">Sévérité</th><th>Nom</th><th>Hôte</th><th>Port</th>${mode === "all" ? "<th>Type</th>" : ""}</tr></thead>
      <tbody data-body></tbody></table></div></div>`;

  const body = root.querySelector("[data-body]");
  const draw = () => {
    const q = state.q.toLowerCase();
    const rows = all.filter((r) => {
      if (state.min !== "all" && LEVEL_RANK[r.level] < LEVEL_RANK[state.min]) return false;
      if (state.type && r.type !== state.type) return false;
      if (q && ![r.name, r.oid, r.ip_address, r.port_label, r.message, ...(r.vt?.cves || [])].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
    root.querySelector("[data-count]").textContent = `${rows.length} résultat${rows.length > 1 ? "s" : ""}`;
    body.innerHTML = rows.length ? rows.map((r, i) => row(r, i, state.open.has(rowKey(r)), mode, opts)).join("")
      : `<tr><td colspan="5">${empty("Aucun résultat", mode === "vulns" ? "Aucune vulnérabilité ne correspond aux filtres." : "")}</td></tr>`;
  };
  root.querySelector("[data-q]").oninput = (e) => { state.q = e.target.value; draw(); };
  root.querySelector("[data-seg]")?.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.min = b.dataset.min;
    root.querySelectorAll("[data-seg] button").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  });
  root.querySelector("[data-type]")?.addEventListener("change", (e) => { state.type = e.target.value; draw(); });
  body.addEventListener("click", (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) { e.stopPropagation(); copy(cp.dataset.copy); return; }
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-k]"); if (!tr) return;
    const k = tr.dataset.k;
    state.open.has(k) ? state.open.delete(k) : state.open.add(k);
    draw();
  });
  draw();
}

const rowKey = (r) => `${r.type}|${r.oid}|${r.ip_address}|${r.port_label}|${r.id}`;

function row(r, i, open, mode, opts) {
  const [tlabel, tcls] = RTYPE[r.type] || [r.type, ""];
  const head = `<tr class="click ${open ? "open" : ""}" data-k="${esc(rowKey(r))}">
    <td>${r.type === "alarm" ? sevBadge(r.level, r.severity) : r.type === "error" ? sevBadge("error") : sevBadge("log")}</td>
    <td><div class="flex" style="gap:8px"><span class="name trunc">${esc(r.type === "host_detail" ? (r.detail?.name || "Détail") : r.name)}</span>
      ${r.count > 1 ? `<span class="chip x">×${r.count}</span>` : ""}
      ${(r.vt?.cves || []).slice(0, 1).map((c) => `<span class="pill ${r.level === "critical" || r.level === "high" ? "crit" : ""}">${esc(c)}</span>`).join("")}</div>
      <div class="sub">${esc(r.type === "host_detail" ? (r.detail?.value || "") : (r.oid || ""))}</div></td>
    <td class="mono">${esc(r.ip_address || "—")}${r.hostname ? `<div class="sub">${esc(r.hostname)}</div>` : ""}</td>
    <td class="mono">${esc(r.port_label || "—")}</td>
    ${mode === "all" ? `<td><span class="pill ${tcls}">${tlabel}</span></td>` : ""}</tr>`;
  if (!open) return head;
  const vt = r.vt || {};
  const tr = opts.tracking?.[trackingKey(r)];
  const trackStatus = { todo: "À traiter", confirmed: "Confirmée", in_progress: "En correction", fixed: "Corrigée", accepted: "Risque accepté", false_positive: "Faux positif" };
  return head + `<tr><td colspan="${mode === "all" ? 5 : 4}" style="padding:0"><div class="detail">
    <div>
      <h5>Message du scanner</h5><pre class="pre">${esc(r.message || "—")}</pre>
      ${vt.insight ? `<h5>Analyse</h5><p>${esc(vt.insight)}</p>` : ""}
      ${vt.affected ? `<h5>Logiciels affectés</h5><p>${esc(vt.affected)}</p>` : ""}
      ${vt.impact ? `<h5>Impact</h5><p>${esc(vt.impact)}</p>` : ""}
    </div>
    <div>
      ${vt.summary ? `<h5>Résumé</h5><p>${esc(vt.summary)}</p>` : ""}
      ${vt.solution ? `<h5>Solution ${vt.solution_type ? `<span class="chip">${esc(SOLUTION[vt.solution_type] || vt.solution_type)}</span>` : ""}</h5><p>${esc(vt.solution)}</p>` : ""}
      <dl class="kv" style="margin-top:14px">
        ${r.oid ? `<dt>OID</dt><dd class="flex"><span class="mono">${esc(r.oid)}</span><button class="btn btn-icon btn-sm" data-copy="${esc(r.oid)}" title="Copier">${icon("copy")}</button></dd>` : ""}
        ${vt.family ? `<dt>Famille</dt><dd>${esc(vt.family)}</dd>` : ""}
        ${vt.vector ? `<dt>Vecteur</dt><dd class="mono">${esc(vt.vector)}</dd>` : ""}
        ${vt.cves?.length ? `<dt>CVE</dt><dd class="chips">${vt.cves.map((c) => `<a class="chip" target="_blank" rel="noopener" href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c)}">${esc(c)}</a>`).join("")}</dd>` : ""}
        ${vt.qod ? `<dt>QoD</dt><dd>${esc(vt.qod)} %${vt.qod_type ? ` <span class="muted">· ${esc(vt.qod_type)}</span>` : ""}</dd>` : ""}
        <dt>Résultat</dt><dd>#${r.id} · ${esc((RTYPE[r.type] || [r.type])[0])}</dd>
        ${r.type === "alarm" ? `<dt>Suivi</dt><dd class="flex wrap"><span class="pill">${esc(trackStatus[tr?.status || "todo"])}</span>
          <a class="btn btn-sm" href="#/remediation?q=${encodeURIComponent(r.oid || "")}">${icon("check")}Suivi et remédiation</a></dd>` : ""}
      </dl>
    </div></div></td></tr>`;
}

export { LEVEL_LABEL };

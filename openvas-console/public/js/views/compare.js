import { compare, dataset, sevCounts } from "../analytics.js";
import { chart, mountCharts, SEV, SEV_NONE } from "../charts.js";
import { resultSeverity, vt } from "../store.js";
import { esc, icon, num, severityBadge, shortDate } from "../util.js";
import { empty, skeletonRows } from "../ui.js";

const SEV_ALL = [...SEV, SEV_NONE];
const TABS = [
  ["added", "Nouvelles", "danger"],
  ["fixed", "Corrigées", "ok"],
  ["kept", "Persistantes", "warn"],
];

export default async function comparePage(root) {
  root.innerHTML = `<div class="card">${skeletonRows(8, 20)}</div>`;
  let scans;
  try {
    scans = (await dataset({ limit: 50 })).started;
  } catch (err) {
    root.innerHTML = `<div class="card">${empty("alert", "Chargement impossible", err.message)}</div>`;
    return;
  }
  const head = `<div class="page-head"><div><h1>Comparer deux scans</h1><p>Mesurez l'évolution entre deux analyses : vulnérabilités apparues, corrigées et persistantes.</p></div></div>`;
  if (scans.length < 2) {
    root.innerHTML = `${head}<div class="card">${empty("diff", "Il faut au moins deux scans", "Lancez un second scan sur la même cible pour suivre l'évolution des vulnérabilités.", `<a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a>`)}</div>`;
    return;
  }

  // Newest first: compare the latest scan with the previous one by default.
  let b = scans[0];
  let a = scans[1];
  let tab = "added";
  const opt = (sel) => scans.map((s) => `<option value="${esc(s.id)}" ${s === sel ? "selected" : ""}>${esc(s.name)} · ${shortDate(s.status.start_time)}</option>`).join("");

  root.innerHTML = `${head}
    <section class="card" style="margin-bottom:20px"><div class="card-body form-grid" style="align-items:end">
      <label class="field"><span>Scan de référence (avant)</span><select class="select" id="ca">${opt(a)}</select></label>
      <label class="field"><span>Scan à comparer (après)</span><select class="select" id="cb">${opt(b)}</select></label>
    </div></section>
    <div id="out"></div>`;

  function draw() {
    const d = compare(a, b);
    const ca = sevCounts(a.results || []);
    const cb = sevCounts(b.results || []);
    const totalA = Object.values(ca).reduce((x, y) => x + y, 0);
    const totalB = Object.values(cb).reduce((x, y) => x + y, 0);
    const delta = totalB - totalA;
    const rows = [...d[tab]].sort((x, y) => (resultSeverity(y) ?? -1) - (resultSeverity(x) ?? -1));
    root.querySelector("#out").innerHTML = `
      ${a === b ? `<div class="banner warn">${icon("alert")}<span>Vous comparez un scan avec lui-même.</span></div>` : ""}
      <div class="grid g-4" style="margin-bottom:20px">
        <div class="card diff-card added"><span class="muted">Nouvelles</span><span class="value">${num(d.added.length)}</span><span class="faint">apparues depuis la référence</span></div>
        <div class="card diff-card fixed"><span class="muted">Corrigées</span><span class="value">${num(d.fixed.length)}</span><span class="faint">disparues depuis la référence</span></div>
        <div class="card diff-card kept"><span class="muted">Persistantes</span><span class="value">${num(d.kept.length)}</span><span class="faint">toujours présentes</span></div>
        <div class="card diff-card"><span class="muted">Évolution</span><span class="value" style="color:${delta > 0 ? "var(--danger)" : delta < 0 ? "var(--ok)" : "inherit"}">${delta > 0 ? "+" : ""}${num(delta)}</span><span class="faint">${num(totalA)} → ${num(totalB)} vulnérabilités</span></div>
      </div>
      <section class="card" style="margin-bottom:20px">
        <div class="card-head"><h2>Par sévérité</h2><div class="end legend"><span><i style="background:var(--sev-log);opacity:.6"></i>Avant</span><span><i style="background:var(--accent)"></i>Après</span></div></div>
        <div class="card-body">${chart("grouped", {
          groups: SEV_ALL.map((k) => ({ label: k.label, values: [ca[k.key] || 0, cb[k.key] || 0] })),
          series: [{ label: `Avant · ${a.name}`, color: "var(--sev-log)", texture: true }, { label: `Après · ${b.name}`, color: "var(--accent)" }],
          height: 230,
        })}</div>
      </section>
      <div class="tabs">${TABS.map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${l}<span class="count">${num(d[k].length)}</span></button>`).join("")}</div>
      <section class="card">${rows.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th style="width:130px">Sévérité</th><th>Vulnérabilité</th><th>Hôte</th><th class="hide-sm">Port</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${severityBadge(resultSeverity(r))}</td>
            <td><div class="cell-title">${esc(vt(r.oid)?.name || r.oid)}</div><div class="cell-sub">${esc(r.oid)}</div></td>
            <td class="mono">${esc(r.ip_address)}</td><td class="hide-sm mono">${r.port ? `${r.port}/${esc(r.protocol || "tcp")}` : "—"}</td></tr>`).join("")}
          </tbody></table></div>`
        : empty(tab === "fixed" ? "check" : "shield", "Rien dans cette catégorie", tab === "added" ? "Aucune nouvelle vulnérabilité : bonne nouvelle !" : "Aucune vulnérabilité ici.")}</section>`;
    mountCharts(root);
  }

  root.onchange = (e) => {
    if (e.target.id === "ca") a = scans.find((s) => s.id === e.target.value);
    else if (e.target.id === "cb") b = scans.find((s) => s.id === e.target.value);
    else return;
    draw();
  };
  root.onclick = (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) ((tab = t.dataset.tab), draw());
  };
  draw();
}

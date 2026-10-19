// Actifs : hôtes vus par l'ensemble des scans.
import { api } from "../api.js";
import { esc, icon, pageHead, sevBadge, fmtDate, empty, download, toCSV, LEVEL_LABEL, $ } from "../ui.js";

export async function render(view) {
  const assets = await api.get("/assets");
  let q = "", only = false;
  const draw = () => {
    const ql = q.toLowerCase();
    const rows = assets.filter((a) => (!only || a.vulns) && (!ql || [a.ip, a.hostname, a.os, ...a.ports].some((v) => String(v).toLowerCase().includes(ql))));
    const osCount = {};
    assets.forEach((a) => (osCount[a.os || "Non détecté"] = (osCount[a.os || "Non détecté"] || 0) + 1));
    view.innerHTML = pageHead({
      eyebrow: "Analyse", eyeIcon: "monitor", title: "Actifs",
      sub: "Inventaire des hôtes découverts par les scans, avec leur exposition actuelle.",
      actions: `<button class="btn" data-csv>${icon("download")}CSV</button>`,
    }) + `<div class="grid g4">
        ${[["Actifs", assets.length, "monitor", "ico-info"], ["Vulnérables", assets.filter((a) => a.vulns).length, "alert", "ico-crit"],
           ["Critiques", assets.filter((a) => a.level === "critical").length, "zap", "ico-high"], ["Sains", assets.filter((a) => !a.vulns).length, "shieldCheck", "ico-ok"]]
          .map(([l, v, ic, c]) => `<div class="card kpi"><div class="kpi-h"><span class="kpi-ico ${c}">${icon(ic)}</span>${l}</div><div class="kpi-v">${v}</div></div>`).join("")}
      </div>
      <div class="card mt"><div class="filters">
        <div class="search-in">${icon("search")}<input class="input" placeholder="IP, nom, système, port…" value="${esc(q)}" data-q></div>
        <label class="check"><input type="checkbox" data-only ${only ? "checked" : ""}>Uniquement les actifs vulnérables</label>
        <span class="right">${rows.length} actif(s) · ${Object.keys(osCount).length} système(s)</span></div>
      <div class="table-scroll"><table class="table"><thead><tr><th>Hôte</th><th>Système</th><th>Ports ouverts</th><th>Vulnérabilités</th><th>Dernier scan</th><th>Sévérité max.</th></tr></thead>
      <tbody>${rows.map((a) => `<tr class="click" data-scan="${esc(a.last_scan)}">
        <td><div class="mono strong">${esc(a.ip)}</div><div class="sub">${esc(a.hostname || "")}</div></td>
        <td>${esc(a.os || "Non détecté")}</td>
        <td><div class="chips">${a.ports.slice(0, 5).map((p) => `<span class="chip">${esc(p)}</span>`).join("")}${a.ports.length > 5 ? `<span class="chip x">+${a.ports.length - 5}</span>` : ""}</div></td>
        <td><div class="flex" style="gap:5px">${["critical", "high", "medium", "low"].filter((l) => a.counts[l]).map((l) => `<span class="pill no-dot ${{ critical: "crit", high: "high", medium: "med", low: "low" }[l]}" title="${LEVEL_LABEL[l]}">${a.counts[l]}</span>`).join("") || '<span class="muted">0</span>'}</div></td>
        <td><div class="small">${esc(a.last_scan_name)}</div><div class="sub">${fmtDate(a.last_seen)}</div></td>
        <td>${a.vulns ? sevBadge(a.level, a.max_severity) : '<span class="pill ok">Sain</span>'}</td></tr>`).join("") || `<tr><td colspan="6">${empty("Aucun actif", "Les hôtes apparaissent ici après un premier scan.", "monitor")}</td></tr>`}</tbody></table></div></div>`;
    const i = $("[data-q]", view);
    i.oninput = (e) => { q = e.target.value; draw(); const n = $("[data-q]", view); n.focus(); n.setSelectionRange(q.length, q.length); };
    $("[data-only]", view).onchange = (e) => { only = e.target.checked; draw(); };
    view.querySelectorAll("tr[data-scan]").forEach((tr) => (tr.onclick = () => (location.hash = `#/scans/${tr.dataset.scan}?tab=hosts`)));
    $("[data-csv]", view).onclick = () => download("actifs.csv", toCSV(rows, [["IP", (a) => a.ip], ["Nom", (a) => a.hostname], ["Système", (a) => a.os],
      ["Ports", (a) => a.ports], ["Vulnérabilités", (a) => a.vulns], ["Sévérité max.", (a) => a.max_severity], ["Dernier scan", (a) => fmtDate(a.last_seen)]]), "text/csv");
  };
  draw();
}

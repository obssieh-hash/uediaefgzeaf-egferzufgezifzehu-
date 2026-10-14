import { aggregate, dataset } from "../analytics.js";
import { chart, donut, topSlices, hbars, miniStack, mountCharts, riskLevel, SEV, SEV_NONE } from "../charts.js";
import { resultSeverity, vt } from "../store.js";
import { ago, debounce, download, esc, icon, num, severityBadge, shortDate } from "../util.js";
import { drawer, empty, skeletonRows } from "../ui.js";

const SEV_ALL = [...SEV, SEV_NONE];
const COLS = [
  ["risk", "Risque", (h) => h.risk],
  ["ip", "Hôte", (h) => h.ip.split(/[.:]/).map((p) => p.padStart(5, "0")).join(".")],
  ["os", "Système", (h) => h.os || "~"],
  ["vulns", "Vulnérabilités", (h) => h.findings.length],
  ["ports", "Ports", (h) => h.ports.size],
  ["seen", "Dernier scan", (h) => h.lastSeen || 0],
];

function riskCell(score) {
  const l = riskLevel(score);
  return `<div class="risk-cell" style="--c:${l.color}" data-tip="Risque ${score}/100\n${l.label}"><span class="bar"><i style="width:${score}%"></i></span><b>${score}</b></div>`;
}

function hostDrawer(h) {
  const history = h.history.map((x) => ({ label: shortDate(x.scan.status.start_time), title: x.scan.name, values: x.sev }));
  const lvl = riskLevel(h.risk);
  const findings = [...h.findings].sort((a, b) => (resultSeverity(b) ?? -1) - (resultSeverity(a) ?? -1));
  const d = drawer(
    `<div class="row" style="margin-bottom:8px"><span class="chip" style="--c:${lvl.color}">Risque ${h.risk}/100 · ${lvl.label}</span></div>
     <h3 class="mono">${esc(h.ip)}</h3><div class="faint">${esc(h.name && h.name !== h.ip ? h.name : "")}</div>`,
    `<dl class="kv">
       <dt>Système</dt><dd>${esc(h.os || "Non détecté")}</dd>
       <dt>Vu pour la 1re fois</dt><dd>${ago(h.firstSeen)}</dd>
       <dt>Dernier scan</dt><dd><a href="#/scans/${encodeURIComponent(h.scan.id)}"><u>${esc(h.scan.name)}</u></a> · ${ago(h.lastSeen)}</dd>
       <dt>Ports</dt><dd>${[...h.ports].map((p) => `<span class="tag mono">${esc(p)}</span>`).join(" ") || "—"}</dd>
     </dl>
     ${donut(SEV_ALL.map((k) => ({ label: k.label, value: h.sev[k.key] || 0, color: k.color })), { sub: "vulnérabilités", size: 136 })}
     ${history.length > 1 ? `<div><h4>Historique</h4>${chart("columns", { columns: history, keys: SEV_ALL, height: 180 })}</div>` : ""}
     <div><h4>Vulnérabilités actuelles (${findings.length})</h4>
       ${findings.length ? `<div class="list">${findings.map((r) => `<div class="list-item" style="padding:10px 0">${severityBadge(resultSeverity(r))}
         <span class="grow"><b class="ellipsis" style="display:block">${esc(vt(r.oid)?.name || r.oid)}</b><span class="faint mono" style="font-size:12px">${r.port ? `${r.port}/${esc(r.protocol || "tcp")}` : "général"}</span></span></div>`).join("")}</div>`
         : `<p class="muted">Aucune vulnérabilité sur le dernier scan.</p>`}
     </div>`,
  );
  mountCharts(d.host);
}

export default async function assets(root, focusIp) {
  let agg = null;
  let query = "";
  let risk = "all";
  let sort = "risk";
  let desc = true;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Actifs</h1><p>Inventaire des hôtes découverts par vos scans, avec leur état le plus récent et leur niveau de risque.</p></div>
      <div class="actions"><button class="btn" id="export" disabled>${icon("download")}Exporter CSV</button></div>
    </div>
    <div id="body"><div class="card">${skeletonRows(8, 20)}</div></div>`;

  try {
    agg = aggregate((await dataset()).started);
  } catch (err) {
    root.querySelector("#body").innerHTML = `<div class="card">${empty("alert", "Chargement impossible", err.message)}</div>`;
    return;
  }

  const hosts = agg.hosts;
  const levels = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const h of hosts) {
    const l = h.risk >= 70 ? "critical" : h.risk >= 40 ? "high" : h.risk >= 15 ? "medium" : "low";
    h.level = l;
    levels[l]++;
  }
  const osColors = ["var(--accent-2)", "var(--accent)", "#a78bfa", "#f472b6"];

  root.querySelector("#body").innerHTML = hosts.length ? `
    <div class="grid g-4" style="margin-bottom:20px">
      <div class="card kpi accent"><div class="label"><span class="ico">${icon("host")}</span>Hôtes</div><div class="value">${num(hosts.length)}</div><div class="foot">découverts</div></div>
      <div class="card kpi danger"><div class="label"><span class="ico">${icon("alert")}</span>Risque critique</div><div class="value">${num(levels.critical)}</div><div class="foot">indice ≥ 70</div></div>
      <div class="card kpi warn"><div class="label"><span class="ico">${icon("bolt")}</span>Risque élevé</div><div class="value">${num(levels.high)}</div><div class="foot">indice 40 – 69</div></div>
      <div class="card kpi info"><div class="label"><span class="ico">${icon("check")}</span>Sains</div><div class="value">${num(hosts.filter((h) => !h.findings.length).length)}</div><div class="foot">aucune vulnérabilité</div></div>
    </div>
    <div class="grid g-2" style="margin-bottom:20px">
      <section class="card"><div class="card-head"><h2>Systèmes d'exploitation</h2></div>
        <div class="card-body">${donut(topSlices(agg.os, 4, osColors), { sub: "hôtes" })}</div></section>
      <section class="card"><div class="card-head"><h2>Services exposés</h2><span class="sub">ports avec vulnérabilités</span></div>
        <div class="card-body">${hbars(agg.ports.slice(0, 6).map((p) => ({ label: p.port, html: `<span class="mono">${esc(p.port)}</span>`, value: p.hosts.size, right: `${p.hosts.size} hôte${p.hosts.size > 1 ? "s" : ""}`, tip: `${p.count} vulnérabilités` })))}</div></section>
    </div>
    <section class="card">
      <div class="toolbar">
        <label class="input-icon">${icon("search")}<input class="input" id="aq" placeholder="IP, nom, système, port…" /></label>
        <div class="pills" id="risk">${[["all", "Tous"], ["critical", "Critique"], ["high", "Élevé"], ["medium", "Modéré"], ["low", "Faible"]].map(([k, l]) => `<button class="pill ${k === risk ? "on" : ""}" data-risk="${k}">${l}<span class="n">${k === "all" ? hosts.length : levels[k]}</span></button>`).join("")}</div>
      </div>
      <div id="table"></div>
    </section>` : `<div class="card">${empty("host", "Aucun actif", "Les hôtes apparaîtront après votre premier scan.", `<a class="btn btn-primary" href="#/new">${icon("plus")}Nouveau scan</a>`)}</div>`;

  function filtered() {
    const q = query.toLowerCase();
    const get = COLS.find((c) => c[0] === sort)[2];
    return hosts
      .filter((h) => (risk === "all" || h.level === risk) && (!q || `${h.ip} ${h.name} ${h.os} ${[...h.ports].join(" ")}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = get(a);
        const y = get(b);
        return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
      });
  }

  function drawTable() {
    const el = root.querySelector("#table");
    if (!el) return;
    const list = filtered();
    root.querySelectorAll("[data-risk]").forEach((b) => b.classList.toggle("on", b.dataset.risk === risk));
    el.innerHTML = list.length
      ? `<div class="table-wrap"><table class="table"><thead><tr>${COLS.map(([k, l]) => `<th class="sortable ${sort === k ? "sorted" : ""} ${["os", "ports", "seen"].includes(k) ? "hide-sm" : ""}" data-sort="${k}">${l}${sort === k ? (desc ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
        <tbody>${list.map((h) => `<tr class="clickable" data-ip="${esc(h.ip)}">
          <td>${riskCell(h.risk)}</td>
          <td><div class="cell-title mono">${esc(h.ip)}</div><div class="cell-sub">${esc(h.name && h.name !== h.ip ? h.name : "")}</div></td>
          <td class="hide-sm">${esc(h.os || "—")}</td>
          <td><span class="row" style="gap:10px">${miniStack(h.sev, { width: 90 })}<b>${h.findings.length}</b></span></td>
          <td class="hide-sm num">${h.ports.size}</td>
          <td class="hide-sm muted">${ago(h.lastSeen)}</td></tr>`).join("")}</tbody></table></div>`
      : empty("search", "Aucun hôte ne correspond", "Modifiez la recherche ou le filtre.");
  }

  drawTable();
  const exp = root.querySelector("#export");
  exp.disabled = !hosts.length;
  exp.onclick = () => {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["ip", "hostname", "os", "risk", "critical", "high", "medium", "low", "ports", "last_scan"].join(",")];
    for (const h of filtered()) lines.push([h.ip, h.name, h.os, h.risk, h.sev.critical || 0, h.sev.high || 0, h.sev.medium || 0, h.sev.low || 0, [...h.ports].join(" "), h.scan.name].map(cell).join(","));
    download("openvas-actifs.csv", lines.join("\n"), "text/csv");
  };

  root.oninput = debounce((e) => e.target.id === "aq" && ((query = e.target.value.trim()), drawTable()), 120);
  root.onclick = (e) => {
    const r = e.target.closest("[data-risk]");
    if (r) return ((risk = r.dataset.risk), drawTable());
    const s = e.target.closest("[data-sort]");
    if (s) {
      desc = sort === s.dataset.sort ? !desc : s.dataset.sort !== "ip" && s.dataset.sort !== "os";
      sort = s.dataset.sort;
      return drawTable();
    }
    const tr = e.target.closest("tr[data-ip]");
    if (tr) hostDrawer(hosts.find((h) => h.ip === tr.dataset.ip));
  };

  if (focusIp) {
    const h = hosts.find((x) => x.ip === decodeURIComponent(focusIp));
    if (h) hostDrawer(h);
  }
}

// Remediation plan: every current finding, prioritised (CVSS, KEV, EPSS,
// asset criticality), with its owner, due date (SLA) and status, so the
// team knows what to fix first and what is late.

import { CRITICALITY, assetRecord, dataset, intelRevision, remediation, TRIAGE, triageOf, isOpen } from "../analytics.js";
import { chart, donut, hbars, mountCharts, SEV } from "../charts.js";
import { resultSeverity, vt } from "../store.js";
import { currentUser, refreshTeam, team } from "../team.js";
import { debounce, download, esc, icon, num, severityBadge, severityLevel } from "../util.js";
import { empty, skeletonRows } from "../ui.js";
import { epssBadge, kevBadge, openFinding, priorityChip } from "./finding.js";
import { catalogNotice } from "./notice.js";

const PAGE = 40;
const VIEWS = [
  ["open", "Ouvertes"],
  ["mine", "Mes vulnérabilités"],
  ["overdue", "En retard"],
  ["kev", "Exploitées (KEV)"],
  ["unassigned", "Non assignées"],
  ["closed", "Clôturées"],
  ["all", "Toutes"],
];

const STATE_COLORS = {
  new: "var(--sev-log)",
  confirmed: "var(--sev-critical)",
  in_progress: "var(--info)",
  fixed: "var(--ok)",
  accepted: "var(--warn)",
  false_positive: "#a78bfa",
};

export default async function remediationView(root) {
  let data;
  let view = "open";
  let query = "";
  let page = 0;
  let alive = true;
  let scans = [];

  root.innerHTML = `<div class="card">${skeletonRows(10, 20)}</div>`;

  async function load() {
    scans = (await dataset({ limit: 50 })).started;
    data = remediation(scans);
  }
  try {
    await load();
  } catch (err) {
    root.innerHTML = `<div class="card">${empty("alert", "Chargement impossible", err.message)}</div>`;
    return;
  }

  const me = currentUser().username;
  const matches = (it, v = view) => {
    const open = isOpen(it.r);
    if (v === "open" && !open) return false;
    if (v === "mine" && (!open || it.record.owner !== me)) return false;
    if (v === "overdue" && it.sla.key !== "overdue") return false;
    if (v === "kev" && (!open || !it.intel.kev)) return false;
    if (v === "unassigned" && (!open || it.record.owner)) return false;
    if (v === "closed" && open) return false;
    if (query) {
      const text = `${vt(it.r.oid)?.name || it.r.oid} ${it.r.ip_address} ${it.r.port} ${it.record.owner || ""} ${TRIAGE[triageOf(it.r)].label}`.toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  };

  function layout() {
    const items = data.items;
    const open = items.filter((i) => isOpen(i.r));
    const overdue = open.filter((i) => i.sla.key === "overdue");
    const kev = open.filter((i) => i.intel.kev);
    const p1 = open.filter((i) => i.priority.key === "P1");
    const states = Object.entries(TRIAGE).map(([k, t]) => ({ label: t.label, value: items.filter((i) => triageOf(i.r) === k).length, color: STATE_COLORS[k] }));
    const load = new Map();
    for (const i of open) load.set(i.record.owner || "Non assigné", (load.get(i.record.owner || "Non assigné") || 0) + 1);
    const slaCols = [...SEV].map((k) => {
      const of = open.filter((i) => severityLevel(resultSeverity(i.r)).key === k.key);
      return {
        label: k.label,
        values: {
          ok: of.filter((i) => i.sla.key === "ok").length,
          soon: of.filter((i) => i.sla.key === "soon").length,
          overdue: of.filter((i) => i.sla.key === "overdue").length,
        },
      };
    });
    const sla = team.settings().sla;

    root.innerHTML = `
      ${catalogNotice(items.filter((i) => resultSeverity(i.r) == null).length)}
      <div class="page-head">
        <div><div class="eyebrow">${icon("check")} Équipe SSI</div><h1>Remédiation</h1>
          <p>Plan de traitement des vulnérabilités : priorité, responsable, échéance et suivi jusqu'à la correction.</p></div>
        <div class="actions"><button class="btn" id="export">${icon("download")}Exporter le plan</button></div>
      </div>
      <div class="grid g-4" style="margin-bottom:20px">
        <div class="card kpi danger"><div class="label"><span class="ico">${icon("alert")}</span>Ouvertes</div><div class="value">${num(open.length)}</div><div class="foot">${num(p1.length)} en priorité P1</div></div>
        <div class="card kpi warn"><div class="label"><span class="ico">${icon("activity")}</span>En retard</div><div class="value">${num(overdue.length)}</div><div class="foot">SLA : ${sla.critical} j critique · ${sla.high} j élevée</div></div>
        <div class="card kpi danger"><div class="label"><span class="ico">${icon("bolt")}</span>Exploitées (KEV)</div><div class="value">${num(kev.length)}</div><div class="foot">activement exploitées, à traiter d'abord</div></div>
        <div class="card kpi accent"><div class="label"><span class="ico">${icon("check")}</span>Délai moyen de correction</div><div class="value">${data.mttr == null ? "—" : `${Math.round(data.mttr)}<span class="faint" style="font-size:18px"> j</span>`}</div><div class="foot">${num(data.resolved.length)} résolue(s) vérifiée(s) par un scan</div></div>
      </div>
      <div class="grid g-3" style="margin-bottom:20px">
        <section class="card fill"><div class="card-head"><h2>Statut</h2></div>
          <div class="card-body">${donut(states, { sub: "vulnérabilités", size: 136 })}</div></section>
        <section class="card fill"><div class="card-head"><h2>Respect des échéances</h2><span class="sub">vulnérabilités ouvertes</span></div>
          <div class="card-body">${chart("columns", { columns: slaCols, keys: [{ key: "ok", label: "Dans les délais", color: "var(--ok)" }, { key: "soon", label: "Échéance < 7 j", color: "var(--warn)" }, { key: "overdue", label: "En retard", color: "var(--danger)" }], height: 190 })}
            <div class="chart-foot"><div class="legend"><span><i style="background:var(--ok)"></i>Dans les délais</span><span><i style="background:var(--warn)"></i>&lt; 7 j</span><span><i style="background:var(--danger)"></i>En retard</span></div></div></div></section>
        <section class="card fill"><div class="card-head"><h2>Charge par analyste</h2></div>
          <div class="card-body">${hbars([...load.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([who, n]) => ({ label: who, value: n, color: who === "Non assigné" ? "var(--sev-log)" : "var(--accent)" })), { empty: "Aucune vulnérabilité ouverte." })}</div></section>
      </div>
      <section class="card">
        <div class="toolbar">
          <label class="input-icon">${icon("search")}<input class="input" id="q" placeholder="Vulnérabilité, hôte, responsable…" value="${esc(query)}" /></label>
          <div class="pills" id="views"></div>
        </div>
        <div id="table"></div>
      </section>`;
    mountCharts(root);
    drawTable();
  }

  function drawTable() {
    const rows = data.items.filter(matches);
    const counts = Object.fromEntries(VIEWS.map(([k]) => [k, data.items.filter((it) => matches(it, k)).length]));
    root.querySelector("#views").innerHTML = VIEWS.map(([k, l]) => `<button class="pill ${view === k ? "on" : ""}" data-view="${k}">${l}<span class="n">${counts[k]}</span></button>`).join("");
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages - 1);
    root.querySelector("#table").innerHTML = rows.length
      ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Priorité</th><th style="width:120px">Sévérité</th><th>Vulnérabilité</th><th>Actif</th><th class="hide-sm">Responsable</th><th class="hide-sm">Échéance</th><th>Statut</th></tr></thead>
        <tbody>${rows.slice(page * PAGE, page * PAGE + PAGE).map((it) => {
          const t = TRIAGE[triageOf(it.r)];
          const asset = assetRecord(it.r.ip_address);
          return `<tr class="clickable" data-key="${esc(it.key)}">
            <td>${priorityChip(it.score, it.r)}</td>
            <td>${severityBadge(resultSeverity(it.r))}</td>
            <td><div class="cell-title ellipsis" style="max-width:420px">${esc(vt(it.r.oid)?.name || it.r.oid)}</div>
              <div class="row" style="gap:6px;margin-top:4px">${kevBadge(it.intel)}${epssBadge(it.intel)}${it.record.comments?.length ? `<span class="tag">${icon("info")} ${it.record.comments.length}</span>` : ""}</div></td>
            <td><span class="mono">${esc(it.r.ip_address)}</span><div class="cell-sub">${it.r.port ? `${it.r.port}/${esc(it.r.protocol || "tcp")}` : ""}${asset.criticality && asset.criticality !== "medium" ? ` · ${esc(CRITICALITY[asset.criticality].label)}` : ""}</div></td>
            <td class="hide-sm">${it.record.owner ? `<span class="avatar-chip">${esc(it.record.owner.slice(0, 2).toUpperCase())}</span> ${esc(it.record.owner)}` : `<span class="faint">Non assigné</span>`}</td>
            <td class="hide-sm"><span class="chip chip-${it.sla.tone}">${esc(it.sla.label)}</span></td>
            <td><span class="chip chip-${t.tone}">${esc(t.label)}</span></td></tr>`;
        }).join("")}</tbody></table></div>
        ${pages > 1 ? `<div class="pager"><span class="grow">${num(rows.length)} vulnérabilités · page ${page + 1} / ${pages}</span>
          <button class="btn btn-sm" data-page="-1" ${page ? "" : "disabled"}>${icon("back")}Précédent</button>
          <button class="btn btn-sm" data-page="1" ${page < pages - 1 ? "" : "disabled"}>Suivant${icon("chevron")}</button></div>` : ""}`
      : empty(view === "overdue" ? "check" : "shield", view === "overdue" ? "Aucun retard" : "Rien dans cette vue", view === "mine" ? "Aucune vulnérabilité ouverte ne vous est assignée." : "Modifiez la recherche ou la vue.");
  }

  function exportCsv() {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["priorite", "score", "cvss", "kev", "epss", "vulnerabilite", "oid", "hote", "port", "criticite_actif", "statut", "responsable", "echeance", "sla", "premiere_detection", "solution"].join(",")];
    for (const it of data.items.filter(matches)) {
      lines.push([
        it.priority.key, it.score, resultSeverity(it.r) ?? "", it.intel.kev ? it.intel.kev.cve : "", it.intel.epss ?? "",
        vt(it.r.oid)?.name || it.r.oid, it.r.oid, it.r.ip_address, it.r.port ? `${it.r.port}/${it.r.protocol || "tcp"}` : "",
        CRITICALITY[assetRecord(it.r.ip_address).criticality || "medium"].label, TRIAGE[triageOf(it.r)].label, it.record.owner || "",
        it.record.due ? it.record.due.slice(0, 10) : "", it.sla.label, it.firstSeen ? new Date(it.firstSeen * 1000).toISOString().slice(0, 10) : "",
        vt(it.r.oid)?.tag?.solution || "",
      ].map(cell).join(","));
    }
    download(`plan-remediation-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv");
  }

  layout();

  root.oninput = debounce((e) => {
    if (e.target.id !== "q") return;
    query = e.target.value.trim().toLowerCase();
    page = 0;
    drawTable();
  }, 150);
  root.onclick = (e) => {
    const v = e.target.closest("[data-view]");
    if (v) {
      view = v.dataset.view;
      page = 0;
      return drawTable();
    }
    const p = e.target.closest("[data-page]");
    if (p) return ((page += Number(p.dataset.page)), drawTable());
    if (e.target.closest("#export")) return exportCsv();
    const tr = e.target.closest("tr[data-key]");
    if (tr) {
      const it = data.items.find((x) => x.key === tr.dataset.key);
      openFinding(it.r, { firstSeen: it.firstSeen, onChange: () => ((data = remediation(scans)), layout()) });
    }
  };

  // Refresh when teammates change something or new intel arrives.
  let rev = team.revision() + intelRevision();
  const timer = setInterval(async () => {
    if (!alive || document.querySelector(".drawer")) return;
    await refreshTeam().catch(() => null);
    if (team.revision() + intelRevision() !== rev) {
      rev = team.revision() + intelRevision();
      await load();
      layout();
    }
  }, 20000);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}

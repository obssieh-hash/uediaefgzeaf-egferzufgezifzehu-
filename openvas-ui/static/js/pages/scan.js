// Détail d'un scan : progression, configuration, onglets de résultats.
import { api } from "../api.js";
import { setCrumbs, refreshInfo } from "../app.js";
import { mountResults, group } from "../results.js";
import {
  esc, icon, statusPill, isActive, fmtDate, fmtDuration, copy, download, toCSV, toast, confirmDialog,
  sevBadge, donut, legend, LEVEL_COLOR, LEVEL_LABEL, riskScore, gauge, riskLabel, fmtNum, empty,
} from "../ui.js";

const TABS = [["overview", "Aperçu"], ["vulns", "Vulnérabilités"], ["all", "Tous les résultats"], ["hosts", "Hôtes"], ["json", "Requête JSON"]];

export async function render(view, [id], ctx) {
  let tab = ctx.query.get("tab") || "overview";
  let data, tracking = {};
  let lastResultCount = -1;

  const load = async () => {
    data = await api.get(`/scans/${id}`);
    setCrumbs([["Scans", "#/scans"], [data.name]]);
  };
  await load();
  if (!ctx.alive()) return;
  api.get("/findings").then((f) => { tracking = Object.fromEntries(f.map((x) => [x.key, x])); }).catch(() => {});

  const draw = () => {
    const s = data.status, st = s.status, hi = s.host_info || {};
    const active = isActive(st);
    const end = s.end_time || (active ? Date.now() / 1000 : null);
    const vulns = group(data.results).filter((r) => r.type === "alarm");
    view.innerHTML = `
      <div class="page-head">
        <div class="grow">
          <div style="margin-bottom:6px">${statusPill(st, true)}</div>
          <h1 data-rename>${esc(data.name)}</h1>
          <div class="id-line">${esc(id)}<button class="btn btn-icon btn-sm" data-copy-id title="Copier l'identifiant">${icon("copy")}</button>
            ${data.kind === "container" ? '<span class="pill violet no-dot">Images Docker</span>' : ""}
            ${data.kind === "web" ? '<span class="pill info no-dot">Site web</span>' : ""}</div>
        </div>
        <div class="actions">
          ${active ? `<button class="btn btn-danger" data-act="stop" data-write>${icon("stop")}Arrêter</button>`
            : st === "stored" ? `<button class="btn btn-primary" data-act="start" data-write>${icon("play")}Démarrer</button>` : ""}
          <a class="btn" href="#/reports?scan=${encodeURIComponent(id)}">${icon("chart")}Rapport</a>
          <button class="btn" data-act="duplicate" data-write>${icon("dup")}Dupliquer</button>
          <button class="btn" data-act="csv">${icon("download")}CSV</button>
          <button class="btn" data-act="json">${icon("download")}JSON</button>
          <button class="btn btn-danger" data-act="delete" data-write ${active ? "disabled" : ""}>${icon("trash")}Supprimer</button>
        </div>
      </div>

      <div class="grid g-main">
        <div class="card">
          <div class="card-h"><h3>Progression</h3><span class="hint">${fmtNum(hi.all ?? (data.config?.target?.hosts || []).length)} hôte(s) ciblé(s)</span>
            <div class="right" style="font-size:20px;font-weight:700">${data.progress} %</div></div>
          <div class="card-b">
            <div class="bar" style="margin-bottom:16px"><i style="width:${data.progress}%"></i></div>
            <div class="tiles">
              ${[["Actifs", hi.alive, "#2563eb"], ["Terminés", hi.finished, "#10b981"], ["En cours", Object.keys(hi.scanning || {}).length, "#3b82f6"],
                 ["En attente", hi.queued, "#94a3b8"], ["Injoignables", hi.dead, "#64748b"], ["Exclus", hi.excluded, "#f26b1d"]]
                .map(([l, v, c]) => `<div class="tile" style="--c:${c}"><b>${v ?? 0}</b><span>${l}</span></div>`).join("")}
            </div>
            ${Object.keys(hi.scanning || {}).length ? `<h5 class="label" style="margin:18px 0 10px;text-transform:uppercase;letter-spacing:.07em;font-size:10.5px;color:var(--muted)">Hôtes en cours d'analyse</h5>
              ${Object.entries(hi.scanning).map(([h, p]) => `<div class="flex" style="gap:16px;margin-bottom:8px">
                <span class="mono" style="width:120px">${esc(h)}</span><div class="bar thin" style="flex:1"><i style="width:${Math.max(0, p)}%"></i></div>
                <span class="muted small" style="width:36px;text-align:right">${p < 0 ? "mort" : p + " %"}</span></div>`).join("")}` : ""}
            <dl class="kv" style="margin-top:16px;grid-template-columns:80px 1fr">
              <dt>Début</dt><dd>${fmtDate(s.start_time)}</dd>
              <dt>Fin</dt><dd>${s.end_time ? fmtDate(s.end_time) : "—"}</dd>
              <dt>Durée</dt><dd>${s.start_time ? fmtDuration(end - s.start_time) : "—"}</dd>
            </dl>
          </div>
        </div>
        ${configCard(data.config, data.kind, data.site)}
      </div>

      <nav class="tabs" data-tabs>
        ${TABS.map(([k, l]) => `<a data-tab="${k}" class="${k === tab ? "active" : ""}">${l}${
          k === "vulns" ? `<span class="cnt">${vulns.length}</span>` : k === "all" ? `<span class="cnt">${group(data.results).length}</span>`
          : k === "hosts" ? `<span class="cnt">${data.hosts.length}</span>` : ""}</a>`).join("")}
      </nav>
      <div data-pane></div>`;
    bind();
    drawPane();
  };

  const drawPane = () => {
    const pane = view.querySelector("[data-pane]");
    if (tab === "vulns") mountResults(pane, data.results, { mode: "vulns", tracking });
    else if (tab === "all") mountResults(pane, data.results, { mode: "all", tracking });
    else if (tab === "hosts") pane.innerHTML = hostsPane(data.hosts);
    else if (tab === "json") pane.innerHTML = `<div class="card"><div class="card-h"><h3>Requête envoyée à openvasd</h3><span class="hint">POST /scans — les secrets sont masqués</span>
        <div class="right"><button class="btn btn-sm" data-copy-json>${icon("copy")}Copier</button></div></div>
        <div class="card-b"><pre class="pre" style="max-height:none">${esc(JSON.stringify(data.config, null, 2))}</pre></div></div>`;
    else pane.innerHTML = overviewPane(data);
    pane.querySelector("[data-copy-json]")?.addEventListener("click", () => copy(JSON.stringify(data.config, null, 2)));
  };

  const bind = () => {
    view.querySelector("[data-copy-id]").onclick = () => copy(id);
    view.querySelector("[data-tabs]").onclick = (e) => {
      const a = e.target.closest("[data-tab]"); if (!a) return;
      tab = a.dataset.tab;
      history.replaceState(null, "", `#/scans/${id}?tab=${tab}`);
      view.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === a));
      drawPane();
    };
    if (!document.body.classList.contains("readonly")) view.querySelector("[data-rename]").onclick = async (e) => {
      const name = prompt("Nom du scan", data.name);
      if (!name || name === data.name) return;
      await api.put(`/scans/${id}`, { name });
      data.name = name; e.target.textContent = name; setCrumbs([["Scans", "#/scans"], [name]]);
      refreshInfo();
    };
    view.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => action(b.dataset.act)));
  };

  const action = async (act) => {
    try {
      if (act === "start" || act === "stop") {
        if (act === "stop" && !(await confirmDialog("Arrêter le scan ?", "Les résultats déjà collectés sont conservés.", "Arrêter"))) return;
        await api.post(`/scans/${id}/${act}`);
        toast(act === "start" ? "Scan démarré" : "Scan arrêté");
        await load(); draw(); refreshInfo();
      } else if (act === "duplicate") {
        const r = await api.post(`/scans/${id}/duplicate`);
        toast("Scan dupliqué et démarré");
        location.hash = `#/scans/${r.id}`;
      } else if (act === "delete") {
        if (!(await confirmDialog("Supprimer le scan ?", `Le scan « ${esc(data.name)} » et ses résultats seront supprimés d'openvasd.`, "Supprimer"))) return;
        await api.del(`/scans/${id}`);
        toast("Scan supprimé"); refreshInfo();
        location.hash = "#/scans";
      } else if (act === "csv") {
        const rows = group(data.results).filter((r) => ["alarm", "log", "error"].includes(r.type));
        download(`${slug(data.name)}-resultats.csv`, toCSV(rows, [
          ["Sévérité", (r) => r.severity ?? ""], ["Niveau", (r) => LEVEL_LABEL[r.level]], ["Nom", (r) => r.name], ["OID", (r) => r.oid],
          ["Hôte", (r) => r.ip_address], ["Port", (r) => r.port_label], ["Type", (r) => r.type], ["CVE", (r) => r.vt?.cves || []],
          ["Solution", (r) => r.vt?.solution || ""], ["Occurrences", (r) => r.count], ["Message", (r) => r.message],
        ]), "text/csv");
      } else if (act === "json") {
        download(`${slug(data.name)}.json`, JSON.stringify({ id, name: data.name, status: data.status, config: data.config, results: data.results }, null, 2), "application/json");
      }
    } catch (e) { toast(e.message, "err"); }
  };

  draw();
  ctx.every(async () => {
    if (!isActive(data.status.status)) return;
    try {
      await load();
      if (!ctx.alive()) return;
      const done = !isActive(data.status.status);
      // Sur les onglets filtrables, on ne redessine que si de nouveaux résultats
      // sont arrivés, pour ne pas perdre la saisie de l'utilisateur.
      if (!["vulns", "all"].includes(tab) || data.results.length !== lastResultCount || done) draw();
      lastResultCount = data.results.length;
      if (done) { toast("Scan terminé"); refreshInfo(); }
    } catch { /* openvasd momentanément indisponible */ }
  }, 5000);
}

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scan";

export function portsText(ports) {
  if (!ports?.length) return "Liste par défaut";
  return ports.map((p) => `${(p.protocol || "tcp").toUpperCase()} ${p.range.map((r) => (r.end && r.end !== r.start ? `${r.start}-${r.end}` : r.start)).join(", ")}`).join(" · ");
}

function configCard(cfg = {}, kind, site) {
  const t = cfg.target || {};
  const creds = (t.credentials || []).map((c) => c.service?.toUpperCase()).join(", ");
  const prefs = (cfg.scan_preferences || []).length;
  return `<div class="card"><div class="card-h"><h3>Configuration</h3></div><div class="card-b">
    <dl class="kv">
      ${site?.length ? `<dt>Sites</dt><dd class="chips">${site.map((u) => `<span class="chip">${esc(u)}</span>`).join("")}</dd>` : ""}
      <dt>${kind === "container" ? "Images" : "Cibles"}</dt><dd class="chips">${(t.hosts || []).map((h) => `<span class="chip">${esc(h)}</span>`).join("") || "—"}</dd>
      ${t.excluded_hosts?.length ? `<dt>Exclus</dt><dd class="chips">${t.excluded_hosts.map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</dd>` : ""}
      ${kind !== "container" ? `<dt>Ports</dt><dd class="mono" style="font-size:11.5px;line-height:1.6">${esc(portsText(t.ports))}</dd>
      <dt>Détection</dt><dd>${esc((t.alive_test_methods || []).join(", ") || "par défaut")}</dd>` : ""}
      <dt>Identifiants</dt><dd>${esc(creds || "aucun")}</dd>
      <dt>VTs</dt><dd>${cfg._vt_selection ? `${fmtNum(cfg._vt_selection.count)} sélectionné(s)${cfg._vt_selection.mode === "web" ? ' <span class="muted small">(profil web)</span>' : ""}${cfg._vt_selection.mode === "families" ? ` <span class="muted small">(${esc(cfg._vt_selection.families.join(", "))})</span>` : ""}`
        : cfg.vts?.length ? `${fmtNum(cfg.vts.length)} sélectionné(s)` : "Tous (flux complet)"}</dd>
      <dt>Préférences</dt><dd>${prefs} personnalisée(s)</dd>
    </dl></div></div>`;
}

function overviewPane(d) {
  const sum = d.summary, c = sum.counts;
  const segs = ["critical", "high", "medium", "low"].map((l) => ({ label: LEVEL_LABEL[l], value: c[l] || 0, color: LEVEL_COLOR[l] }));
  const risk = riskScore(c, sum.max_severity);
  const top = group(d.results).filter((r) => r.type === "alarm").slice(0, 5);
  return `<div class="grid g3">
      <div class="card"><div class="card-h"><h3>Répartition par sévérité</h3></div>
        <div class="card-b donut-wrap">${donut(segs, { value: sum.vulns, label: "vulnérabilités" })}${legend(segs)}</div></div>
      <div class="card"><div class="card-h"><h3>Indice de risque</h3></div>
        <div class="card-b" style="display:grid;place-items:center">${gauge(risk, { label: riskLabel(risk)[0], size: 150 })}
        <div class="muted small">Score CVSS maximal : <b style="color:var(--text)">${sum.max_severity ? sum.max_severity.toFixed(1) : "—"}</b></div></div></div>
      <div class="card"><div class="card-h"><h3>Synthèse</h3></div><div class="card-b"><dl class="kv">
        <dt>Hôtes</dt><dd>${sum.hosts}</dd><dt>Vulnérabilités</dt><dd>${sum.vulns}</dd>
        <dt>Journaux</dt><dd>${c.log || 0}</dd><dt>Erreurs</dt><dd>${c.error || 0}</dd><dt>Résultats</dt><dd>${sum.results}</dd></dl></div></div>
    </div>
    <div class="card mt"><div class="card-h"><h3>Vulnérabilités prioritaires</h3><div class="right"><a class="btn btn-sm" data-tab="vulns" href="#/scans/${d.id}?tab=vulns">Tout voir</a></div></div>
      ${top.length ? `<table class="table"><tbody>${top.map((r) => `<tr><td style="width:130px">${sevBadge(r.level, r.severity)}</td>
        <td><div class="name">${esc(r.name)}</div><div class="sub">${esc(r.oid)}</div></td><td class="mono">${esc(r.ip_address)}</td><td class="mono">${esc(r.port_label)}</td></tr>`).join("")}</tbody></table>`
        : empty("Aucune vulnérabilité", isActive(d.status.status) ? "Le scan est en cours…" : "Aucune vulnérabilité détectée.", "shieldCheck")}
    </div>`;
}

function hostsPane(hosts) {
  if (!hosts.length) return `<div class="card">${empty("Aucun hôte analysé pour le moment", "", "monitor")}</div>`;
  return `<div class="grid g2" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">${hosts.map((h) => `
    <div class="card"><div class="card-b">
      <div class="flex" style="align-items:flex-start">
        <span class="kpi-ico" style="background:var(--surface-3);width:32px;height:32px">${icon("monitor")}</span>
        <div style="flex:1;min-width:0"><div class="mono strong" style="font-size:13px">${esc(h.ip)}</div><div class="muted small">${esc(h.hostname || "—")}</div></div>
        ${h.vulns ? sevBadge(h.level, h.max_severity) : '<span class="pill ok">Sain</span>'}
      </div>
      <div class="bar ${h.level === "medium" ? "yellow" : ""}" style="margin:14px 0;${h.vulns ? "" : "opacity:.5"}"><i style="width:${Math.min(100, h.max_severity * 10)}%;background:${LEVEL_COLOR[h.level]}"></i></div>
      <dl class="kv">
        <dt>Système</dt><dd>${esc(h.os || "Non détecté")}</dd>
        <dt>Vulnérabilités</dt><dd>${h.vulns} ${h.vulns ? `<span class="muted small">(${["critical", "high", "medium", "low"].filter((l) => h.counts[l]).map((l) => `${h.counts[l]} ${LEVEL_LABEL[l].toLowerCase()}`).join(", ")})</span>` : ""}</dd>
        <dt>Ports</dt><dd class="chips">${h.ports.map((p) => `<span class="chip">${esc(p)}</span>`).join("") || "—"}</dd>
        <dt>État</dt><dd>${h.state === "done" ? '<span class="pill ok">Terminé</span>' : '<span class="pill info live">En cours</span>'}</dd>
      </dl></div></div>`).join("")}</div>`;
}

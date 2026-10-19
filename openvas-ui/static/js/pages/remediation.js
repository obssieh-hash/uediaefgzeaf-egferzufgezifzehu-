// Remédiation : plan de traitement des vulnérabilités (priorité, responsable,
// échéance, statut), persisté par server.py.
import { api } from "../api.js";
import {
  esc, icon, pageHead, sevBadge, donut, legend, bars, toast, modal, download, toCSV, LEVEL_LABEL, fmtDay, empty, $,
} from "../ui.js";

export const STATUS = {
  todo: ["À traiter", "", "#94a3b8"], confirmed: ["Confirmée", "crit", "#be123c"], in_progress: ["En correction", "info", "#0284c7"],
  fixed: ["Corrigée", "ok", "#10b981"], accepted: ["Risque accepté", "warn", "#c2410c"], false_positive: ["Faux positif", "violet", "#8b5cf6"],
};
const SLA_DAYS = { critical: 7, high: 30, medium: 90, low: 180 };
const CLOSED = ["fixed", "accepted", "false_positive"];

export const priority = (f) => f.level === "critical" || (f.level === "high" && f.severity >= 8) ? "P1" : f.level === "high" ? "P2" : f.level === "medium" ? "P3" : "P4";
export const dueOf = (f) => f.due ? new Date(f.due).getTime() / 1000 : (f.first_seen || Date.now() / 1000) + (SLA_DAYS[f.level] || 180) * 86400;

export async function render(view, _p, ctx) {
  let items = await api.get("/findings");
  const me = "admin";
  let filter = "open", q = ctx.query.get("q") || "";

  const draw = () => {
    const now = Date.now() / 1000;
    const open = items.filter((f) => !CLOSED.includes(f.status));
    const late = open.filter((f) => dueOf(f) < now);
    const p1 = open.filter((f) => priority(f) === "P1");
    const fixed = items.filter((f) => f.status === "fixed" && f.updated && f.first_seen);
    const mttr = fixed.length ? fixed.reduce((a, f) => a + (f.updated - f.first_seen), 0) / fixed.length / 86400 : null;
    const filters = {
      open: ["Ouvertes", (f) => !CLOSED.includes(f.status)],
      mine: ["Mes vulnérabilités", (f) => f.assignee === me && !CLOSED.includes(f.status)],
      late: ["En retard", (f) => !CLOSED.includes(f.status) && dueOf(f) < now],
      p1: ["Priorité P1", (f) => !CLOSED.includes(f.status) && priority(f) === "P1"],
      unassigned: ["Non assignées", (f) => !f.assignee && !CLOSED.includes(f.status)],
      verify: ["À vérifier", (f) => f.status === "confirmed"],
      closed: ["Clôturées", (f) => CLOSED.includes(f.status)],
      all: ["Toutes", () => true],
    };
    const ql = q.toLowerCase();
    const rows = items.filter(filters[filter][1]).filter((f) => !ql || [f.name, f.host, f.assignee, f.oid, ...(f.cves || [])].some((v) => String(v || "").toLowerCase().includes(ql)))
      .sort((a, b) => priority(a).localeCompare(priority(b)) || b.severity - a.severity || dueOf(a) - dueOf(b));

    const segs = Object.entries(STATUS).map(([k, [l, , c]]) => ({ label: l, value: items.filter((f) => f.status === k).length, color: c }));
    const slaGroups = ["critical", "high", "medium", "low"].map((l) => {
      const g = open.filter((f) => f.level === l);
      return { label: LEVEL_LABEL[l], values: [
        { value: g.filter((f) => dueOf(f) - now > 7 * 86400).length, color: "#059669", label: "Dans les délais" },
        { value: g.filter((f) => dueOf(f) >= now && dueOf(f) - now <= 7 * 86400).length, color: "#c2410c", label: "< 7 j" },
        { value: g.filter((f) => dueOf(f) < now).length, color: "#dc2626", label: "En retard" }] };
    });
    const load = {};
    open.forEach((f) => (load[f.assignee || "Non assigné"] = (load[f.assignee || "Non assigné"] || 0) + 1));
    const loadMax = Math.max(1, ...Object.values(load));

    view.innerHTML = pageHead({
      eyebrow: "Équipe SSI", eyeIcon: "check", title: "Remédiation",
      sub: "Plan de traitement des vulnérabilités : priorité, responsable, échéance et suivi jusqu'à la correction.",
      actions: `<button class="btn" data-export>${icon("download")}Exporter le plan</button>`,
    }) + `
    <div class="grid g4">
      ${kpi("alert", "ico-crit", "Ouvertes", open.length, `${p1.length} en priorité P1`)}
      ${kpi("activity", "ico-warn", "En retard", late.length, "SLA : 7 j critique · 30 j élevée")}
      ${kpi("zap", "ico-crit", "Critiques non traitées", open.filter((f) => f.level === "critical" && f.status === "todo").length, "à traiter en premier")}
      ${kpi("check", "ico-info", "Délai moyen de correction", mttr == null ? "—" : `${mttr.toFixed(1)} j`, `${fixed.length} correction(s) vérifiée(s) par un scan`)}
    </div>
    <div class="grid g3 mt">
      <div class="card"><div class="card-h"><h3>Statut</h3></div><div class="card-b donut-wrap">${donut(segs, { value: items.length, label: "vulnérabilités", size: 140 })}${legend(segs)}</div></div>
      <div class="card"><div class="card-h"><h3>Respect des échéances</h3><span class="hint">vulnérabilités ouvertes</span></div><div class="card-b">
        ${bars(slaGroups, { height: 150, width: 340 })}
        <div class="chart-legend"><span><i style="background:#059669"></i>Dans les délais</span><span><i style="background:#c2410c"></i>&lt; 7 j</span><span><i style="background:#dc2626"></i>En retard</span></div></div></div>
      <div class="card"><div class="card-h"><h3>Charge par analyste</h3></div><div class="card-b" style="display:flex;flex-direction:column;justify-content:center;min-height:200px">
        ${Object.entries(load).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div class="hbar"><div class="hbar-top"><span>${esc(n)}</span><b>${v}</b></div>
          <div class="bar thin"><i style="width:${(v / loadMax) * 100}%;background:${n === "Non assigné" ? "#94a3b8" : "var(--primary)"}"></i></div></div>`).join("") || '<div class="muted">Aucune vulnérabilité ouverte</div>'}
      </div></div>
    </div>
    <div class="card mt">
      <div class="filters">
        <div class="search-in">${icon("search")}<input class="input" placeholder="Vulnérabilité, hôte, responsable…" value="${esc(q)}" data-q></div>
        ${Object.entries(filters).map(([k, [l, fn]]) => `<button class="chip-btn ${filter === k ? "on" : ""}" data-f="${k}">${l} <span class="cnt">${items.filter(fn).length}</span></button>`).join("")}
      </div>
      <div class="table-scroll"><table class="table"><thead><tr><th>Priorité</th><th>Sévérité</th><th>Vulnérabilité</th><th>Actif</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr></thead>
      <tbody>${rows.length ? rows.map((f) => row(f, now)).join("") : `<tr><td colspan="7">${empty("Rien à afficher", "Aucune vulnérabilité ne correspond à ce filtre.", "shieldCheck")}</td></tr>`}</tbody></table></div>
    </div>`;

    $("[data-q]", view).oninput = (e) => { q = e.target.value; draw(); const i = $("[data-q]", view); i.focus(); i.setSelectionRange(q.length, q.length); };
    view.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    view.querySelectorAll("tr[data-key]").forEach((tr) => (tr.onclick = () => edit(items.find((f) => f.key === tr.dataset.key))));
    $("[data-export]", view).onclick = () => download("plan-de-remediation.csv", toCSV(rows, [
      ["Priorité", priority], ["Sévérité", (f) => f.severity], ["Niveau", (f) => LEVEL_LABEL[f.level]], ["Vulnérabilité", (f) => f.name], ["OID", (f) => f.oid],
      ["CVE", (f) => f.cves || []], ["Hôte", (f) => f.host], ["Port", (f) => f.port], ["Responsable", (f) => f.assignee], ["Échéance", (f) => fmtDay(dueOf(f))],
      ["Statut", (f) => STATUS[f.status]?.[0]], ["Note", (f) => f.note],
    ]), "text/csv");
  };

  const edit = (f) => {
    modal(f.name, `<div class="grid" style="gap:14px">
      <div class="flex wrap">${sevBadge(f.level, f.severity)}<span class="chip">${esc(f.host)}</span><span class="chip">${esc(f.port)}</span><span class="pill crit no-dot">${priority(f)}</span></div>
      <div class="form-grid">
        <div class="field"><label>Statut</label><select class="select" name="status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Responsable</label><input class="input" name="assignee" value="${esc(f.assignee)}" list="analysts" placeholder="Non assigné">
          <datalist id="analysts">${[...new Set(items.map((x) => x.assignee).filter(Boolean).concat(["admin"]))].map((a) => `<option value="${esc(a)}">`).join("")}</datalist></div>
        <div class="field"><label>Échéance</label><input class="input" type="date" name="due" value="${new Date(dueOf(f) * 1000).toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Détectée</label><input class="input" disabled value="${fmtDay(f.first_seen)}"></div>
        <div class="field full"><label>Note</label><textarea class="input" name="note" rows="3" style="font-family:var(--font)">${esc(f.note)}</textarea></div>
      </div>
      <a href="#/scans/${esc(f.scan_id)}?tab=vulns">${icon("radar", "")} Voir dans le scan « ${esc(f.scan_name || "")} »</a></div>`, {
      ok: "Enregistrer",
      onOk: async (m) => {
        const val = (n) => m.querySelector(`[name=${n}]`).value;
        const upd = { status: val("status"), assignee: val("assignee").trim(), due: val("due") || null, note: val("note"),
          name: f.name, severity: f.severity, level: f.level, host: f.host, port: f.port, oid: f.oid, first_seen: f.first_seen, cves: f.cves };
        await api.put("/tracking", { [f.key]: upd });
        Object.assign(f, upd, { updated: Date.now() / 1000 });
        toast("Suivi mis à jour");
        draw();
      },
    });
  };
  draw();
}

const kpi = (ic, cls, label, value, sub) => `<div class="card kpi"><div class="kpi-h"><span class="kpi-ico ${cls}">${icon(ic)}</span>${esc(label)}</div>
  <div class="kpi-v">${esc(value)}</div><div class="kpi-s">${esc(sub)}</div></div>`;

function row(f, now) {
  const due = dueOf(f), days = Math.round((due - now) / 86400);
  const closed = CLOSED.includes(f.status);
  const dueCls = closed ? "" : days < 0 ? "crit" : days <= 7 ? "warn" : "ok";
  const dueTxt = closed ? fmtDay(due) : days < 0 ? `En retard de ${-days} j` : days <= 7 ? `Échéance dans ${days} j` : `Dans les délais (${days} j)`;
  const [sl, sc] = STATUS[f.status] || STATUS.todo;
  const p = priority(f);
  return `<tr class="click" data-key="${esc(f.key)}">
    <td><span class="pill no-dot ${p === "P1" ? "crit" : p === "P2" ? "high" : p === "P3" ? "med" : "low"}" style="border-radius:6px">${p}</span></td>
    <td>${sevBadge(f.level, f.severity)}</td>
    <td><div class="name trunc" style="max-width:360px">${esc(f.name)}</div>${f.cves?.length ? `<div style="margin-top:3px"><span class="pill ${f.level === "critical" ? "crit" : ""}">${esc(f.cves[0])}</span></div>` : ""}</td>
    <td class="mono">${esc(f.host)}<div class="sub">${esc(f.port)}</div></td>
    <td class="${f.assignee ? "" : "muted"}">${esc(f.assignee || "Non assigné")}</td>
    <td><span class="pill ${dueCls}">${dueTxt}</span></td>
    <td><span class="pill ${sc}">${sl}</span></td></tr>`;
}

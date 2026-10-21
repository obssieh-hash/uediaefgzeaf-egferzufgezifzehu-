// Rapport consolidé (tous les scans ou un scan), imprimable en PDF.
import { api } from "../api.js";
import { BRAND } from "../app.js";
import { group } from "../results.js";
import {
  esc, icon, gauge, riskScore, riskLabel, donut, legend, bars, LEVEL_COLOR, LEVEL_LABEL, sevBadge, fmtDate, pct, download, toCSV,
  SCAN_STATUS, toast,
} from "../ui.js";
import { buildDocx, p, run, h1, h2, h3, table, pageBreak } from "../docx.js";

export async function render(view, _p, ctx) {
  const scanId = ctx.query.get("scan") || "";
  const [scans, info] = await Promise.all([api.get("/scans"), api.get("/info")]);
  const chosen = scanId ? scans.filter((s) => s.id === scanId) : scans.filter((s) => s.status.status !== "stored");
  const bundles = await Promise.all(chosen.map((s) => api.get(`/scans/${s.id}`).catch(() => null)));
  if (!ctx.alive()) return;

  // Dernier résultat par (VT, hôte, port)
  const vulns = new Map(), hosts = new Map();
  for (const b of bundles.filter(Boolean)) {
    for (const h of b.hosts) hosts.set(h.ip, h);
    for (const r of group(b.results)) if (r.type === "alarm") vulns.set(`${r.oid}|${r.ip_address}|${r.port_label}`, r);
  }
  const list = [...vulns.values()].sort((a, b) => b.severity - a.severity);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  list.forEach((r) => counts[r.level]++);
  const total = list.length;
  const maxSev = Math.max(0, ...list.map((r) => r.severity || 0));
  const risk = riskScore(counts, maxSev);
  const [rl, rc] = riskLabel(risk);
  const vulnHosts = new Set(list.map((r) => r.ip_address)).size;
  const top = list[0];
  const topHosts = top ? list.filter((r) => r.oid === top.oid).length : 0;
  const segs = ["critical", "high", "medium", "low"].map((l) => ({ label: LEVEL_LABEL[l], value: counts[l], color: LEVEL_COLOR[l] }));
  segs.push({ label: "Non évaluée", value: list.filter((r) => r.severity == null).length, color: "#94a3b8" });

  // Distribution des scores CVSS (0-10 par pas de 1)
  const dist = [...Array(10)].map((_, i) => ({ label: String(i + 1), values: [{ value: list.filter((r) => Math.min(9, Math.floor(r.severity || 0)) === i && r.severity > 0).length, color: LEVEL_COLOR[i >= 9 ? "critical" : i >= 7 ? "high" : i >= 4 ? "medium" : "low"] }] }));

  // Familles
  const fam = {};
  list.forEach((r) => (fam[r.vt?.family || "Autre"] = (fam[r.vt?.family || "Autre"] || 0) + 1));
  const fams = Object.entries(fam).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Hôtes
  const hostRows = [...hosts.values()].sort((a, b) => b.max_severity - a.max_severity);

  view.className = "view";
  view.innerHTML = `
    <div class="between no-print" style="margin:4px 0 16px">
      <select class="select" data-scan style="min-width:280px"><option value="">Tous les scans (${scans.length})</option>
        ${scans.map((s) => `<option value="${esc(s.id)}" ${s.id === scanId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <div class="actions"><button class="btn" data-csv>${icon("download")}CSV</button><button class="btn" data-docx>${icon("file")}Word</button><button class="btn btn-primary" onclick="window.print()">${icon("printer")}Imprimer / PDF</button></div>
    </div>
    <div class="hero">
      <div class="between wrap">
        <div>
          <div class="flex" style="gap:10px;margin-bottom:16px"><img src="img/logo.svg" width="38" height="38" alt=""><b style="font-size:20px;letter-spacing:-.02em">${esc(BRAND.name)}</b></div>
          <div class="eyebrow">${icon("chart")}${scanId ? "Rapport de scan" : "Rapport consolidé"}</div>
          <h1 style="font-size:22px;margin:4px 0 10px">Rapport de vulnérabilités${scanId && chosen[0] ? ` — ${esc(chosen[0].name)}` : ""}</h1>
          <div class="muted">Généré le ${fmtDate(Date.now() / 1000)} · ${chosen.length} scan(s) · feed <span class="mono">${esc((info.feed_version || "").slice(0, 10))}…</span></div>
        </div>
        ${gauge(risk, { size: 150, label: rl, color: rc })}
      </div>
    </div>

    <div class="card mt"><div class="card-h"><h3>Synthèse</h3></div><div class="card-b" style="line-height:1.75">
      <p style="margin:0 0 8px">L'ensemble des scans a porté sur <b>${hosts.size} hôte${hosts.size > 1 ? "s" : ""}</b>, dont <b>${vulnHosts}</b> présente${vulnHosts > 1 ? "nt" : ""} au moins une vulnérabilité.
        Au total, <b>${total} vulnérabilité${total > 1 ? "s" : ""}</b> ${total > 1 ? "ont été relevées" : "a été relevée"}, dont <b class="c-crit">${counts.critical} critique${counts.critical > 1 ? "s" : ""}</b> et
        <b class="c-high">${counts.high} élevée${counts.high > 1 ? "s" : ""}</b>. L'indice de risque global est de <b>${risk}/100</b> (niveau <b style="color:${rc}">${rl.toLowerCase()}</b>).</p>
      ${top ? `<p style="margin:0">Priorité n°1 : <b>${esc(top.name)}</b> (CVSS ${top.severity?.toFixed(1)}), présente sur ${topHosts} hôte${topHosts > 1 ? "s" : ""}.</p>` : "<p style='margin:0'>Aucune vulnérabilité à traiter.</p>"}
    </div></div>

    <div class="grid g4 mt">${["critical", "high", "medium", "low"].map((l) => `<div class="card sev-card" style="--c:${LEVEL_COLOR[l]}">
      <div class="kpi-h">${LEVEL_LABEL[l]}</div><div class="kpi-v">${counts[l]}</div><div class="kpi-s">${pct(counts[l], total)} % des vulnérabilités</div></div>`).join("")}</div>

    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>Répartition par sévérité</h3></div><div class="card-b donut-wrap">${donut(segs, { value: total, label: "vulnérabilités", size: 140 })}${legend(segs)}</div></div>
      <div class="card"><div class="card-h"><h3>Distribution des scores CVSS</h3></div><div class="card-b">${bars(dist, { height: 170, width: 460 })}</div></div>
    </div>

    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>Hôtes</h3></div>
        <table class="table"><thead><tr><th>Hôte</th><th>Système</th><th class="num">Vulns</th><th>Sévérité max.</th></tr></thead><tbody>
        ${hostRows.map((h) => `<tr><td class="mono strong">${esc(h.ip)}</td><td class="small">${esc(h.os || "Non détecté")}</td><td class="num">${h.vulns}</td>
          <td>${h.vulns ? sevBadge(h.level, h.max_severity) : '<span class="pill ok">Sain</span>'}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Aucun hôte</td></tr>'}</tbody></table></div>
      <div class="card"><div class="card-h"><h3>Familles les plus représentées</h3></div><div class="card-b">
        ${fams.map(([f, n]) => `<div class="hbar"><div class="hbar-top"><span>${esc(f)}</span><b>${n}</b></div><div class="bar thin"><i style="width:${pct(n, fams[0][1])}%"></i></div></div>`).join("") || '<span class="muted">—</span>'}
      </div></div>
    </div>

    <div class="card mt"><div class="card-h"><h3>Détail des vulnérabilités</h3><span class="hint">${total} entrée(s)</span></div>
      <table class="table"><thead><tr><th>Sévérité</th><th>Vulnérabilité</th><th>Hôte</th><th>Port</th><th>Solution</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td style="width:120px">${sevBadge(r.level, r.severity)}</td><td><div class="name">${esc(r.name)}</div>
        <div class="sub">${esc((r.vt?.cves || []).join(", ") || r.oid)}</div></td><td class="mono">${esc(r.ip_address)}</td><td class="mono">${esc(r.port_label)}</td>
        <td class="small" style="max-width:320px">${esc(r.vt?.solution || "—")}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Aucune vulnérabilité</td></tr>'}</tbody></table></div>`;

  view.querySelector("[data-scan]").onchange = (e) => (location.hash = e.target.value ? `#/reports?scan=${e.target.value}` : "#/reports");
  view.querySelector("[data-docx]").onclick = () => {
    try {
      const name = scanId && chosen[0] ? chosen[0].name : "Tous les scans";
      const blob = wordReport({ name, scanId, chosen, bundles: bundles.filter(Boolean), info, list, counts, total, risk, rl, rc, hostRows, vulnHosts, top, topHosts, fams: Object.entries(fam).sort((a, b) => b[1] - a[1]) });
      const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      download(`rapport-${slug || "vulnerabilites"}-${new Date().toISOString().slice(0, 10)}.docx`, blob,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch (e) { console.error(e); toast("Impossible de générer le document Word : " + e.message, "err"); }
  };
  view.querySelector("[data-csv]").onclick = () => download("rapport-vulnerabilites.csv", toCSV(list, [
    ["Sévérité", (r) => r.severity], ["Niveau", (r) => LEVEL_LABEL[r.level]], ["Vulnérabilité", (r) => r.name], ["OID", (r) => r.oid],
    ["CVE", (r) => r.vt?.cves || []], ["Hôte", (r) => r.ip_address], ["Port", (r) => r.port_label], ["Solution", (r) => r.vt?.solution],
  ]), "text/csv");
}

// ---------------------------------------------------------------------------
// Export Word (.docx)
// ---------------------------------------------------------------------------
const W = 9638; // largeur utile d'une page A4 (marges de 2 cm), en twips
const FG = { critical: "FFFFFF", high: "FFFFFF", medium: "1F2937", low: "FFFFFF" };
const DELAY = { critical: "Immédiat (sous 7 jours)", high: "Sous 15 jours", medium: "Sous 30 jours", low: "Sous 90 jours" };
const SOLUTION_TYPE = { VendorFix: "Correctif éditeur", Mitigation: "Atténuation", Workaround: "Contournement", WillNotFix: "Pas de correctif prévu", NoneAvailable: "Aucune solution disponible" };
const sevCell = (r) => ({ text: r.severity != null ? `${Number(r.severity).toFixed(1)} ${LEVEL_LABEL[r.level]}` : "—", fill: LEVEL_COLOR[r.level], color: FG[r.level] || "FFFFFF", b: true, align: "center" });
const dt = (ts) => (ts ? fmtDate(ts) : "—");
const plural = (n, one, many = one + "s") => `${n} ${n > 1 ? many : one}`;

function wordReport(d) {
  const { list, counts, total } = d;
  const B = [];
  const now = Date.now() / 1000;

  // Page de garde
  B.push(p(run("OpenVAS", { b: true, size: 14, color: "FFFFFF" }), { shade: "0F172A", after: 0, before: 0 }));
  B.push(p(run("Gestion des vulnérabilités", { size: 9, color: "93C5FD" }), { shade: "0F172A", after: 0 }));
  B.push(p("", { after: 1800 }));
  B.push(p(run(d.scanId ? "RAPPORT DE SCAN" : "RAPPORT CONSOLIDÉ", { b: true, size: 11, color: "2563EB" }), { after: 60 }));
  B.push(p("Rapport de vulnérabilités", { style: "Title" }));
  B.push(p(run(d.name, { size: 18, color: "475569" }), { after: 600 }));
  B.push(table([{ w: 3200 }, { w: W - 3200 }], [
    [{ text: "Indice de risque", b: true, fill: "F1F5F9" }, { text: `${d.risk}/100 — ${d.rl}`, b: true, fill: d.rc, color: d.risk >= 30 && d.risk < 55 ? "1F2937" : "FFFFFF", size: 12 }],
    [{ text: "Vulnérabilités", b: true, fill: "F1F5F9" }, `${total} (critiques : ${counts.critical}, élevées : ${counts.high}, moyennes : ${counts.medium}, faibles : ${counts.low})`],
    [{ text: "Hôtes analysés", b: true, fill: "F1F5F9" }, `${d.hostRows.length} (dont ${d.vulnHosts} vulnérable${d.vulnHosts > 1 ? "s" : ""})`],
    [{ text: "Scans inclus", b: true, fill: "F1F5F9" }, d.chosen.map((s) => s.name).join(", ") || "—"],
    [{ text: "Date du rapport", b: true, fill: "F1F5F9" }, dt(now)],
    [{ text: "Flux de VTs", b: true, fill: "F1F5F9" }, d.info.feed_version || "—"],
  ], { size: 10 }));
  B.push(p(run("Document confidentiel — contient des informations sur les faiblesses de sécurité du système d'information. Diffusion restreinte.", { i: true, size: 8, color: "64748B" }), { before: 1200 }));
  B.push(pageBreak());

  // 1. Synthèse
  B.push(h1("1. Synthèse"));
  B.push(p([
    run(`L'analyse a porté sur ${plural(d.hostRows.length, "hôte")}, dont ${d.vulnHosts} présente${d.vulnHosts > 1 ? "nt" : ""} au moins une vulnérabilité. Au total, `),
    run(plural(total, "vulnérabilité"), { b: true }), run(` ${total > 1 ? "ont été relevées" : "a été relevée"}, dont `),
    run(plural(counts.critical, "critique"), { b: true, color: LEVEL_COLOR.critical }), run(" et "),
    run(plural(counts.high, "élevée"), { b: true, color: LEVEL_COLOR.high }),
    run(`. L'indice de risque global est de `), run(`${d.risk}/100`, { b: true }), run(` (niveau ${d.rl.toLowerCase()}).`),
  ]));
  if (d.top) B.push(p([run("Priorité n°1 : "), run(d.top.name, { b: true }), run(` (CVSS ${Number(d.top.severity).toFixed(1)}), présente sur ${plural(d.topHosts, "hôte")}.`)]));
  const lv = ["critical", "high", "medium", "low"];
  B.push(h2("Répartition par sévérité"));
  B.push(table(lv.map(() => ({ w: W / 4 })), [
    lv.map((l) => ({ text: LEVEL_LABEL[l], fill: LEVEL_COLOR[l], color: FG[l], b: true, align: "center" })),
    lv.map((l) => ({ text: `${counts[l]}  (${pct(counts[l], total)} %)`, b: true, align: "center", size: 12 })),
  ]));

  // 2. Périmètre
  B.push(h1("2. Périmètre et déroulement"));
  B.push(table([{ w: 2600 }, { w: 2700 }, { w: 1300 }, { w: 1519 }, { w: 1519 }], [
    ["Scan", "Cibles", "Statut", "Début", "Fin"],
    ...d.bundles.map((b) => [{ text: b.name, b: true }, ((b.config?.target?.hosts) || []).join(", ") || "—",
      (SCAN_STATUS[b.status.status] || [b.status.status])[0], dt(b.status.start_time), dt(b.status.end_time)]),
  ], { header: true, zebra: true }));

  // 3. Hôtes
  B.push(h1("3. Hôtes analysés"));
  B.push(table([{ w: 1900 }, { w: 3600 }, { w: 1500 }, { w: 2638 }], [
    ["Hôte", "Système détecté", "Vulnérabilités", "Sévérité maximale"],
    ...d.hostRows.map((h) => [{ text: h.ip, b: true }, h.os || "Non détecté", { text: String(h.vulns), align: "center" },
      h.vulns ? sevCell({ severity: h.max_severity, level: h.level }) : { text: "Aucune", fill: "DCFCE7", color: "166534", align: "center" }]),
  ], { header: true, zebra: true }));
  if (d.fams.length) {
    B.push(h2("Familles de vulnérabilités"));
    B.push(table([{ w: 7638 }, { w: 2000 }], [["Famille", "Nombre"], ...d.fams.map(([f, n]) => [f, { text: String(n), align: "center" }])], { header: true, zebra: true }));
  }

  // 4. Liste
  B.push(h1("4. Liste des vulnérabilités"));
  if (!list.length) B.push(p("Aucune vulnérabilité n'a été relevée."));
  else B.push(table([{ w: 1500 }, { w: 4738 }, { w: 1900 }, { w: 1500 }], [
    ["Sévérité", "Vulnérabilité", "Hôte", "Port"],
    ...list.map((r) => [sevCell(r), r.name, r.ip_address, r.port_label]),
  ], { header: true, zebra: true }));

  // 5. Détail et recommandations (une fiche par VT)
  B.push(pageBreak());
  B.push(h1("5. Détail et recommandations"));
  const byVt = new Map();
  for (const r of list) {
    const cur = byVt.get(r.oid) || { r, where: [] };
    cur.where.push(`${r.ip_address} (${r.port_label})`);
    byVt.set(r.oid, cur);
  }
  let n = 0;
  for (const { r, where } of byVt.values()) {
    n++;
    const vt = r.vt || {};
    B.push(h2(`5.${n}  ${r.name}`));
    const rows = [
      [{ text: "Sévérité", b: true, fill: "F1F5F9" }, sevCell(r)],
      [{ text: "Hôte(s) concerné(s)", b: true, fill: "F1F5F9" }, where.join(", ")],
      [{ text: "CVE", b: true, fill: "F1F5F9" }, (vt.cves || []).join(", ") || "—"],
      [{ text: "Famille", b: true, fill: "F1F5F9" }, vt.family || "—"],
      [{ text: "OID", b: true, fill: "F1F5F9" }, r.oid || "—"],
    ];
    if (vt.vector) rows.push([{ text: "Vecteur CVSS", b: true, fill: "F1F5F9" }, vt.vector]);
    B.push(table([{ w: 2400 }, { w: W - 2400 }], rows));
    for (const [label, txt] of [["Description", vt.summary], ["Analyse", vt.insight], ["Impact", vt.impact], ["Systèmes affectés", vt.affected], ["Méthode de détection", vt.vuldetect]]) {
      if (!txt) continue;
      B.push(h3(label));
      B.push(p(txt));
    }
    if (r.message) {
      B.push(h3("Résultat de la détection"));
      B.push(p(run(r.message.length > 1500 ? r.message.slice(0, 1500) + "…" : r.message, { font: "Consolas", size: 8.5 }), { shade: "F1F5F9" }));
    }
    B.push(h3(`Recommandation${vt.solution_type ? ` — ${SOLUTION_TYPE[vt.solution_type] || vt.solution_type}` : ""}`));
    B.push(p(vt.solution || "Aucune solution n'est fournie par le test : consultez l'éditeur du produit concerné.", { shade: "EFF6FF" }));
    B.push(p(run(`Délai de traitement conseillé : ${DELAY[r.level] || "—"}`, { b: true, size: 9, color: LEVEL_COLOR[r.level] === "#facc15" ? "A16207" : LEVEL_COLOR[r.level] })));
  }

  // 6. Plan d'action
  B.push(h1("6. Plan d'action"));
  B.push(p("Les vulnérabilités sont à traiter par ordre de sévérité, en commençant par les hôtes exposés sur Internet. Après correction, relancer un scan pour vérifier leur disparition."));
  B.push(table([{ w: 2200 }, { w: 1400 }, { w: 3000 }, { w: 3038 }], [
    ["Niveau", "Nombre", "Délai conseillé", "Action"],
    ...lv.map((l) => [{ text: LEVEL_LABEL[l], fill: LEVEL_COLOR[l], color: FG[l], b: true }, { text: String(counts[l]), align: "center" }, DELAY[l],
      { critical: "Corriger en urgence ou isoler l'hôte", high: "Planifier la correction en priorité", medium: "Intégrer au cycle de mise à jour", low: "Traiter lors de la maintenance" }[l]]),
  ], { header: true }));

  return buildDocx(B, { title: `Rapport de vulnérabilités — ${d.name}`, footer: `OpenVAS — Rapport de vulnérabilités — ${d.name}` });
}

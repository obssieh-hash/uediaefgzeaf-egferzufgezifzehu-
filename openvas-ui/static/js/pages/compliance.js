// Conformité ISO/IEC 27001:2022 (annexe A) et guide d'hygiène de l'ANSSI,
// évaluée à partir des preuves collectées par les scans.
import { api } from "../api.js";
import { esc, icon, gauge, download, toCSV, $$ } from "../ui.js";

// Chaque exigence s'évalue sur les vulnérabilités ouvertes (findings) et les actifs.
const has = (fs, re) => fs.filter((f) => re.test(f.name + " " + (f.port || "")));
const sevAtLeast = (fs, lvl) => fs.filter((f) => ({ critical: 4, high: 3, medium: 2, low: 1 }[f.level] >= lvl));

const ISO = [
  ["A.5.9", "Inventaire des informations et autres actifs associés", (fs, as, sc) => sc.length ? (as.some((a) => !a.os) ? ["partial", as.filter((a) => !a.os).map((a) => `${a.ip} : système non identifié`)] : ["ok", [`${as.length} actif(s) inventorié(s)`]]) : ["na", []]],
  ["A.8.8", "Gestion des vulnérabilités techniques", (fs) => { const c = sevAtLeast(fs, 3); return [c.length ? "ko" : fs.length ? "partial" : "ok", c.map(ev)]; }],
  ["A.8.19", "Correctifs de sécurité appliqués (logiciels à jour)", (fs) => { const c = has(fs, /< ?\d|version|mise à jour|update|outdated|obsol/i); return [c.length ? "ko" : "ok", c.map(ev)]; }],
  ["A.8.16", "Activités de surveillance", (fs, as, sc) => sc.some((s) => s.age < 30 * 86400) ? ["ok", ["Scan réalisé au cours des 30 derniers jours"]] : ["ko", ["Aucun scan récent (> 30 jours)"]]],
  ["A.8.24", "Utilisation de la cryptographie", (fs) => { const c = has(fs, /SSL|TLS|chiffr|cipher|crypt|MAC faible|Diffie|certificat/i); return [c.length ? "ko" : "ok", c.map(ev)]; }],
  ["A.5.15 · A.5.18", "Contrôle d'accès et droits d'accès", (fs) => { const c = has(fs, /authenti|accès sans|anonymous|anonyme|NLA/i); return [c.length ? (sevAtLeast(c, 3).length ? "ko" : "partial") : "ok", c.map(ev)]; }],
  ["A.8.5", "Authentification sécurisée", (fs) => { const c = has(fs, /défaut|default|mot de passe|password|brute/i); return [c.length ? "ko" : "ok", c.map(ev)]; }],
  ["A.8.9", "Gestion de la configuration (identifiants par défaut)", (fs) => { const c = has(fs, /défaut|default|TRACE|bannière|banner|SMBv1/i); return [c.length ? "partial" : "ok", c.map(ev)]; }],
  ["A.8.20", "Sécurité des réseaux", (fs) => { const c = has(fs, /accessible depuis Internet|exposé|Redis|MySQL|RDP|SMB/i); return [c.length ? "partial" : "ok", c.map(ev)]; }],
  ["A.5.7", "Renseignement sur les menaces", (fs, as, sc, info) => info.feed_version ? ["ok", [`Flux de VTs à jour (${info.feed_version})`]] : ["partial", ["Version du flux inconnue"]]],
  ["A.8.15", "Journalisation", () => ["na", ["Non évaluable par un scan réseau"]]],
];

const ANSSI = [
  ["R.13", "Utiliser des mots de passe robustes / changer les identifiants par défaut", ISO[6][2]],
  ["R.19", "Chiffrer les flux sensibles transitant sur des réseaux non maîtrisés", (fs) => { const c = has(fs, /clair|HTTP\)|TLSv1\.[01]|SSL/i); return [c.length ? "ko" : "ok", c.map(ev)]; }],
  ["R.20", "Utiliser des protocoles réseau sécurisés", ISO[4][2]],
  ["R.27", "Désactiver les services inutiles et exposés", ISO[8][2]],
  ["R.34", "Appliquer les mises à jour de sécurité sans délai", ISO[1][2]],
  ["R.33", "Définir une politique de mise à jour", ISO[2][2]],
  ["R.6", "Disposer d'un inventaire exhaustif des systèmes", ISO[0][2]],
  ["R.40", "Auditer régulièrement la sécurité du SI", ISO[3][2]],
  ["R.32", "Journaliser les événements", ISO[10][2]],
];

const ev = (f) => `${f.host} ${f.port} — ${f.name}`;
const LABEL = { ok: ["Conformité", "ok"], partial: ["Partiel", "warn"], ko: ["Non conforme", "crit"], na: ["Non évaluable", ""] };

function evaluate(rules, fs, as, sc, info) {
  return rules.map(([id, title, fn]) => { const [st, evidence] = fn(fs, as, sc, info); return { id, title, st, evidence }; })
    .sort((a, b) => ["ko", "partial", "ok", "na"].indexOf(a.st) - ["ko", "partial", "ok", "na"].indexOf(b.st));
}
function score(items) {
  const ev = items.filter((i) => i.st !== "na");
  if (!ev.length) return 0;
  return Math.round((ev.reduce((a, i) => a + (i.st === "ok" ? 1 : i.st === "partial" ? 0.5 : 0), 0) / ev.length) * 100);
}

export async function render(view) {
  const [findings, assets, scans, info] = await Promise.all([api.get("/findings"), api.get("/assets"), api.get("/scans"), api.get("/info")]);
  const fs = findings.filter((f) => !["fixed", "accepted", "false_positive"].includes(f.status));
  const now = Date.now() / 1000;
  const sc = scans.filter((s) => s.status.status === "succeeded").map((s) => ({ ...s, age: now - (s.status.end_time || 0) }));
  const iso = evaluate(ISO, fs, assets, sc, info);
  const anssi = evaluate(ANSSI, fs, assets, sc, info);
  let current = "iso";

  const card = (key, eyebrow, title, items) => {
    const n = (st) => items.filter((i) => i.st === st).length;
    const s = score(items);
    return `<div class="card std ${current === key ? "accent" : ""}" data-std="${key}" style="cursor:pointer"><div class="grow">
      <div class="std-eyebrow">${eyebrow}</div><h2>${title}</h2>
      <div class="chips"><span class="pill ok">${n("ok")} conformité(s)</span><span class="pill warn">${n("partial")} partiel(s)</span>
      <span class="pill crit">${n("ko")} non-conforme(s)</span>${n("na") ? `<span class="pill">${n("na")} non évaluable(s)</span>` : ""}</div></div>
      ${gauge(s, { size: 140, label: s >= 80 ? "Satisfaisant" : "À améliorer", color: s >= 80 ? "#10b981" : s >= 50 ? "#facc15" : "#f26b1d" })}</div>`;
  };

  const draw = () => {
    const items = current === "iso" ? iso : anssi;
    view.innerHTML = `<div class="page-head"><div class="grow"><div class="eyebrow">${icon("shield")}Gouvernance</div><h1>Conformité</h1>
      <p>Où en êtes-vous vis-à-vis de l'ISO 27001 et du guide d'hygiène de l'ANSSI, d'après les preuves collectées par openvasd.</p></div>
      <div class="actions"><button class="btn" data-csv>${icon("download")}CSV</button><button class="btn btn-primary" onclick="window.print()">${icon("printer")}Imprimer / PDF</button></div></div>
      <div class="grid g2">
        ${card("iso", "Annexe A — mesures liées à la gestion des vulnérabilités et à l'accès", "ISO/IEC 27001:2022", iso)}
        ${card("anssi", `Guide d'hygiène informatique — ${ANSSI.length} mesures évaluées`, "ANSSI", anssi)}
      </div>
      <div class="card mt"><div class="card-h"><h3>${current === "iso" ? "ISO/IEC 27001:2022 — Annexe A" : "ANSSI — Guide d'hygiène informatique"}</h3>
        <span class="hint">${items.length} exigences évaluées · cliquez pour voir les preuves</span></div>
        <div class="rows">${items.map((i, n) => `<div class="row" data-row="${n}">${icon("chevRight", "chev")}
          <span class="pill ${LABEL[i.st][1]}" style="min-width:108px;justify-content:center">${LABEL[i.st][0]}</span>
          <span class="chip">${esc(i.id)}</span><b>${esc(i.title)}</b><span class="right">${i.st === "ko" || i.st === "partial" ? i.evidence.length : ""}</span></div>
          <div class="row-detail" data-detail="${n}" hidden>${i.evidence.length ? `<ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">${i.evidence.slice(0, 30).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>${i.evidence.length > 30 ? `<div class="muted small">… et ${i.evidence.length - 30} autre(s)</div>` : ""}` : '<span class="muted">Aucun écart relevé.</span>'}</div>`).join("")}</div></div>`;
    $$("[data-std]", view).forEach((c) => (c.onclick = () => { current = c.dataset.std; draw(); }));
    $$("[data-row]", view).forEach((r) => (r.onclick = () => { r.classList.toggle("open"); view.querySelector(`[data-detail="${r.dataset.row}"]`).hidden ^= 1; }));
    view.querySelector("[data-csv]").onclick = () => download(`conformite-${current}.csv`, toCSV(items, [["Exigence", (i) => i.id], ["Titre", (i) => i.title], ["Statut", (i) => LABEL[i.st][0]], ["Preuves", (i) => i.evidence.join(" | ")]]), "text/csv");
  };
  draw();
}


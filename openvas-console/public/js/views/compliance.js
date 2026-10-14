// Compliance view: maps what Sentrovyx knows (open findings, asset
// inventory, accounts and MFA, audit log, scan cadence, remediation SLAs,
// threat intelligence) to ISO/IEC 27001:2022 Annex A controls and to the
// ANSSI "guide d'hygiène informatique" (42 mesures). It is an aid to
// prepare an audit, not a certification.

import { api } from "../api.js";
import { aggregate, assetRecord, dataset, isOpen, remediation } from "../analytics.js";
import { complianceLevel, gauge } from "../charts.js";
import { resultSeverity, vt } from "../store.js";
import { call, team } from "../team.js";
import { applyTheme } from "../app.js";
import { download, esc, icon, num, severityBadge } from "../util.js";
import { empty, skeletonRows } from "../ui.js";

const STATUS = {
  ok: { label: "Conforme", tone: "ok", weight: 1 },
  partial: { label: "Partiel", tone: "warn", weight: 0.5 },
  ko: { label: "Non conforme", tone: "danger", weight: 0 },
  na: { label: "Non évaluable", tone: "neutral", weight: null },
};

// ---- Finding categories -------------------------------------------------------------

const text = (it) => `${vt(it.r.oid)?.name || ""} ${vt(it.r.oid)?.family || ""} ${it.r.message || ""}`;
const CATEGORIES = {
  defaultCreds: (it) => /default (credential|account|password|community)|brute.?force|no password|without password|anonymous .*login|identifiants par défaut/i.test(text(it)) || /Default Accounts|Brute force/i.test(vt(it.r.oid)?.family || ""),
  cleartext: (it) => /cleartext|clear text|unencrypted|telnet|\bftp\b|http debugging|trace\/track|snmp.*(community|public)|en clair/i.test(text(it)),
  crypto: (it) => /SSL and TLS/i.test(vt(it.r.oid)?.family || "") || /\bssl\b|\btls\b|cipher|certificate|terrapin|diffie|chiffrement/i.test(vt(it.r.oid)?.name || ""),
  eol: (it) => /end.of.life|\beol\b|unsupported|obsolete|fin de (vie|support)/i.test(text(it)),
  patch: (it) =>
    /Local Security Checks/i.test(vt(it.r.oid)?.family || "") || vt(it.r.oid)?.tag?.solution_type === "VendorFix" || /security advisory|multiple vulnerabilities|<\s*\d|update|mise à jour/i.test(vt(it.r.oid)?.name || ""),
};

function bySeverity(items) {
  const high = items.filter((i) => (resultSeverity(i.r) ?? 0) >= 7).length;
  return { high, total: items.length };
}

// Status from open findings of a category: none → ok, only medium/low → partial.
function findingsStatus(items, what) {
  const { high, total } = bySeverity(items);
  if (!total) return { status: "ok", evidence: `Aucune vulnérabilité ouverte de type « ${what} ».` };
  return {
    status: high ? "ko" : "partial",
    evidence: `${num(total)} vulnérabilité(s) ouverte(s) de type « ${what} », dont ${num(high)} critique(s) ou élevée(s).`,
    items,
  };
}

// ---- Controls ---------------------------------------------------------------------------

function controls(ctx) {
  const { open, hosts, facts, lastScanDays, overdue, mttr, kevOpen } = ctx;
  const cat = (k) => open.filter(CATEGORIES[k]);
  const inventoried = hosts.filter((h) => assetRecord(h.ip).owner && assetRecord(h.ip).criticality).length;
  const inventory = !hosts.length
    ? { status: "na", evidence: "Aucun actif découvert : lancez un premier scan." }
    : {
        status: inventoried / hosts.length >= 0.9 ? "ok" : inventoried / hosts.length >= 0.3 ? "partial" : "ko",
        evidence: `${num(inventoried)} actif(s) sur ${num(hosts.length)} ont un propriétaire et une criticité renseignés (page Actifs).`,
      };
  const accounts = !facts
    ? { status: "na", evidence: "Nécessite le serveur de la console." }
    : !facts.authEnabled
      ? { status: "ko", evidence: "La console est ouverte : aucun compte nominatif n'existe." }
      : { status: facts.roles.length > 1 ? "ok" : "partial", evidence: `${num(facts.users)} compte(s) nominatif(s), rôles utilisés : ${facts.roles.join(", ")}. Actions tracées dans le journal d'audit.` };
  const mfa = !facts
    ? { status: "na", evidence: "Nécessite le serveur de la console." }
    : !facts.authEnabled
      ? { status: "ko", evidence: "Pas d'authentification sur la console." }
      : {
          status: facts.requireMfa || facts.mfaUsers === facts.users ? "ok" : facts.mfaUsers > 0 && !facts.adminsWithoutMfa ? "partial" : "ko",
          evidence: `${num(facts.mfaUsers)} compte(s) sur ${num(facts.users)} protégé(s) par double authentification${facts.requireMfa ? " (obligatoire)" : ""}${facts.adminsWithoutMfa ? ` · ${facts.adminsWithoutMfa} administrateur(s) sans MFA` : ""}.`,
        };
  const defaults = findingsStatus(cat("defaultCreds"), "identifiants par défaut / mots de passe faibles");
  const strongAuth = mfa.status === "ko" || defaults.status === "ko" ? { ...mfa, status: "ko", evidence: `${mfa.evidence} ${defaults.evidence}`, items: defaults.items } : { ...mfa, evidence: `${mfa.evidence} ${defaults.evidence}`, items: defaults.items, status: mfa.status === "ok" && defaults.status === "ok" ? "ok" : mfa.status === "na" ? "na" : "partial" };
  const cadence =
    lastScanDays == null
      ? { status: "ko", evidence: "Aucun scan réalisé." }
      : {
          status: lastScanDays <= 30 && (facts ? facts.schedules > 0 : true) && !overdue.length ? "ok" : lastScanDays <= 90 ? "partial" : "ko",
          evidence: `Dernier scan il y a ${num(Math.round(lastScanDays))} j${facts ? ` · ${num(facts.schedules)} scan(s) planifié(s) actif(s)` : ""} · ${num(overdue.length)} vulnérabilité(s) en retard sur le SLA${mttr != null ? ` · délai moyen de correction ${Math.round(mttr)} j` : ""}${facts?.verifications ? ` · ${num(facts.verifications)} correction(s) vérifiée(s) par scan` : ""}.`,
          items: overdue,
        };
  const patches = findingsStatus(cat("patch"), "correctif de sécurité manquant");
  const eol = findingsStatus(cat("eol"), "logiciel en fin de support");
  const cleartext = findingsStatus(cat("cleartext"), "protocole non chiffré");
  const crypto = findingsStatus(cat("crypto"), "chiffrement faible ou certificat invalide");
  const logging = !facts
    ? { status: "na", evidence: "Nécessite le serveur de la console." }
    : { status: facts.authEnabled ? "ok" : "partial", evidence: `Journal d'audit actif : ${num(facts.auditEvents30d)} événement(s) sur 30 jours${facts.authEnabled ? ", attribués à des comptes nominatifs" : " (non attribuables : console ouverte)"}.` };
  const monitoring = !facts
    ? { status: "na", evidence: "Nécessite le serveur de la console." }
    : { status: facts.webhook && facts.schedules ? "ok" : facts.webhook || facts.schedules ? "partial" : "ko", evidence: `${facts.webhook ? "Alertes de fin de scan configurées" : "Aucune alerte configurée"} · ${num(facts.schedules)} scan(s) planifié(s).` };
  const intel = !facts?.intel?.kev && api().mode !== "demo"
    ? { status: "partial", evidence: "Catalogue CISA KEV indisponible : la VM doit pouvoir joindre cisa.gov.", items: kevOpen }
    : { status: kevOpen.some((i) => i.sla.key === "overdue") ? "ko" : kevOpen.length ? "partial" : "ok", evidence: `${num(kevOpen.length)} vulnérabilité(s) activement exploitée(s) (CISA KEV) encore ouverte(s)${kevOpen.some((i) => i.sla.key === "overdue") ? ", dont certaines en retard" : ""}.`, items: kevOpen };
  const dmzItems = open.filter((i) => /DMZ|Internet/i.test(assetRecord(i.r.ip_address).environment || "") && (resultSeverity(i.r) ?? 0) >= 7);
  const dmz = hosts.some((h) => /DMZ|Internet/i.test(assetRecord(h.ip).environment || ""))
    ? { status: dmzItems.length ? "ko" : "ok", evidence: `${num(dmzItems.length)} vulnérabilité(s) critique(s) ou élevée(s) sur des actifs exposés (DMZ / Internet).`, items: dmzItems }
    : { status: "na", evidence: "Aucun actif marqué « DMZ / exposé Internet » dans la page Actifs." };

  return {
    iso: [
      { ref: "A.5.7", title: "Renseignement sur les menaces", ...intel },
      { ref: "A.5.9", title: "Inventaire des informations et autres actifs associés", ...inventory },
      { ref: "A.5.15 · A.5.18", title: "Contrôle d'accès et droits d'accès", ...accounts },
      { ref: "A.8.5", title: "Authentification sécurisée", ...strongAuth },
      { ref: "A.8.8", title: "Gestion des vulnérabilités techniques", ...cadence },
      { ref: "A.8.8", title: "Correctifs de sécurité appliqués", ...patches },
      { ref: "A.8.9", title: "Gestion de la configuration (identifiants par défaut)", ...defaults },
      { ref: "A.8.15", title: "Journalisation", ...logging },
      { ref: "A.8.16", title: "Activités de surveillance", ...monitoring },
      { ref: "A.8.20 · A.8.21", title: "Sécurité des réseaux et des services réseau", ...cleartext },
      { ref: "A.8.24", title: "Utilisation de la cryptographie", ...crypto },
    ],
    anssi: [
      { ref: "Mesure 4", title: "Identifier les informations et serveurs les plus sensibles", ...inventory },
      { ref: "Mesure 8", title: "Identifier nommément chaque personne et distinguer les rôles", ...accounts },
      { ref: "Mesure 12", title: "Changer les éléments d'authentification par défaut", ...defaults },
      { ref: "Mesure 13", title: "Privilégier une authentification forte", ...mfa },
      { ref: "Mesure 21", title: "Utiliser des protocoles réseaux sécurisés", ...cleartext },
      { ref: "Mesure 23", title: "Cloisonner les services visibles depuis Internet", ...dmz },
      { ref: "Mesure 34", title: "Définir une politique de mise à jour des composants", ...patches },
      { ref: "Mesure 35", title: "Anticiper la fin de la maintenance des logiciels", ...eol },
      { ref: "Mesure 36", title: "Activer et configurer les journaux", ...logging },
      { ref: "Mesure 38", title: "Contrôles et audits réguliers, actions correctives", ...cadence },
      { ref: "Mesure 40", title: "Procédure de gestion des incidents (alertes, menaces actives)", ...(monitoring.status === "ok" && intel.status !== "ko" ? monitoring : { ...monitoring, status: monitoring.status === "na" ? "na" : intel.status === "ko" ? "ko" : "partial", evidence: `${monitoring.evidence} ${intel.evidence}`, items: intel.items }) },
    ],
  };
}

const score = (list) => {
  const rated = list.filter((c) => STATUS[c.status].weight != null);
  return rated.length ? Math.round((rated.reduce((a, c) => a + STATUS[c.status].weight, 0) / rated.length) * 100) : 0;
};

function controlRow(c, i) {
  const s = STATUS[c.status];
  const items = (c.items || []).slice(0, 8);
  return `<details class="control">
    <summary>${icon("chevron")}<span class="chip chip-${s.tone}">${s.label}</span><span class="tag mono">${esc(c.ref)}</span><b class="grow">${esc(c.title)}</b>${c.items?.length ? `<span class="faint">${num(c.items.length)}</span>` : ""}</summary>
    <div class="control-body"><p>${esc(c.evidence)}</p>
      ${items.length ? `<div class="table-wrap"><table class="table"><tbody>${items.map((it) => `<tr><td style="width:120px">${severityBadge(resultSeverity(it.r))}</td><td>${esc(vt(it.r.oid)?.name || it.r.oid)}</td><td class="mono">${esc(it.r.ip_address)}${it.r.port ? `:${it.r.port}` : ""}</td></tr>`).join("")}</tbody></table></div>
        ${c.items.length > items.length ? `<p class="faint" style="margin-top:8px">… et ${num(c.items.length - items.length)} autre(s) dans la page <a href="#/remediation"><u>Remédiation</u></a>.</p>` : ""}` : ""}
    </div></details>`;
}

export default async function compliance(root) {
  root.innerHTML = `<div class="card">${skeletonRows(10, 20)}</div>`;
  let ctx;
  try {
    const { started } = await dataset({ limit: 50 });
    const agg = aggregate(started);
    const plan = remediation(started);
    const open = plan.items.filter((i) => isOpen(i.r));
    const facts = team.remote()
      ? await call("GET", "/console/facts").catch(() => null)
      : { authEnabled: true, users: 4, roles: ["admin", "analyste", "lecteur"], mfaUsers: 2, adminsWithoutMfa: 0, requireMfa: false, schedules: 1, webhook: true, auditEvents30d: 128, verifications: 3, intel: { kev: 1200 } };
    const last = Math.max(0, ...started.map((s) => s.status.end_time || s.status.start_time || 0));
    ctx = {
      open,
      hosts: agg.hosts,
      facts,
      lastScanDays: last ? (Date.now() / 1000 - last) / 86400 : null,
      overdue: open.filter((i) => i.sla.key === "overdue"),
      mttr: plan.mttr,
      kevOpen: open.filter((i) => i.intel.kev),
    };
  } catch (err) {
    root.innerHTML = `<div class="card">${empty("alert", "Chargement impossible", err.message)}</div>`;
    return;
  }
  const sets = controls(ctx);
  let tab = "iso";
  const tally = (list) => Object.fromEntries(Object.keys(STATUS).map((k) => [k, list.filter((c) => c.status === k).length]));

  function draw() {
    const list = sets[tab];
    root.innerHTML = `
      <div class="page-head no-print">
        <div><div class="eyebrow">${icon("shield")} Gouvernance</div><h1>Conformité</h1>
          <p>Où en êtes-vous vis-à-vis de l'ISO 27001 et du guide d'hygiène de l'ANSSI, d'après les preuves collectées par Sentrovyx.</p></div>
        <div class="actions"><button class="btn" id="csv">${icon("download")}CSV</button><button class="btn btn-primary" id="print">${icon("printer")}Imprimer / PDF</button></div>
      </div>
      <div class="report-logo report-only"><img class="wm-light" src="brand/sentrovyx-horizontal.svg" alt="Sentrovyx" /></div>
      <div class="grid g-2" style="margin-bottom:20px">
        ${[["iso", "ISO/IEC 27001:2022", "Annexe A — mesures liées à la gestion des vulnérabilités et à l'accès"], ["anssi", "ANSSI", "Guide d'hygiène informatique — 42 mesures"]].map(([k, name, sub]) => {
          const t = tally(sets[k]);
          return `<button class="card compliance-card ${tab === k ? "on" : ""}" data-tab="${k}">
            <div class="grow" style="text-align:left"><div class="eyebrow">${esc(sub)}</div><h2 style="margin:0 0 10px;font-size:20px">${name}</h2>
              <div class="pills"><span class="chip chip-ok">${t.ok} conforme(s)</span><span class="chip chip-warn">${t.partial} partiel(s)</span><span class="chip chip-danger">${t.ko} non conforme(s)</span>${t.na ? `<span class="chip chip-neutral">${t.na} non évaluable(s)</span>` : ""}</div></div>
            ${gauge(score(sets[k]), "Taux de conformité", complianceLevel)}
          </button>`;
        }).join("")}
      </div>
      <section class="card">
        <div class="card-head"><h2>${tab === "iso" ? "ISO/IEC 27001:2022 — Annexe A" : "ANSSI — Guide d'hygiène informatique"}</h2><span class="sub">${list.length} exigences évaluées · cliquez pour voir les preuves</span></div>
        <div class="controls">${list.sort((a, b) => ["ko", "partial", "na", "ok"].indexOf(a.status) - ["ko", "partial", "na", "ok"].indexOf(b.status)).map(controlRow).join("")}</div>
      </section>
      <p class="faint" style="font-size:12.5px;margin-top:14px">Indicateurs d'aide à la préparation d'audit, calculés automatiquement à partir des scans, de la remédiation, des actifs et de la configuration de la console. Ils ne remplacent ni un audit ni une certification, et ne couvrent que les exigences mesurables par Sentrovyx.</p>`;
  }

  root.onclick = (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) return ((tab = t.dataset.tab), draw());
    if (e.target.closest("#print")) {
      const theme = document.documentElement.dataset.theme;
      root.querySelectorAll("details.control").forEach((d) => (d.open = true));
      applyTheme("light");
      return setTimeout(() => (window.print(), applyTheme(theme)), 150);
    }
    if (e.target.closest("#csv")) {
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["referentiel", "reference", "exigence", "statut", "preuves", "vulnerabilites"].join(",")];
      for (const [k, list] of Object.entries(sets)) for (const c of list) lines.push([k === "iso" ? "ISO 27001:2022" : "ANSSI hygiène", c.ref, c.title, STATUS[c.status].label, c.evidence, c.items?.length || 0].map(cell).join(","));
      download(`sentrovyx-conformite-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv");
    }
  };
  draw();
}

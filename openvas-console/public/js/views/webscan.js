// Web application scanning (OWASP ZAP). openvasd tests the server; ZAP crawls
// the web application and attacks its pages (SQL injection, XSS, CSRF, missing
// security headers…). The console drives a ZAP daemon server-side: a scan
// spiders the site, then actively tests it, and the alerts are grouped here by
// risk. Needs a configured ZAP server (ZAP_URL); otherwise a notice explains how.

import { api, settings } from "../api.js";
import { can } from "../team.js";
import { chart, donut, mountCharts } from "../charts.js";
import { ago, download, downloadDoc, esc, icon, num, printReport, shareReport, svgToPng, svgUrlToPng } from "../util.js";
import { confirmDialog, empty, fail, skeletonRows, toast } from "../ui.js";

// ZAP risk levels, on the console's severity palette.
const WEB_SEV = [
  { key: "high", label: "Élevée", color: "var(--sev-high)" },
  { key: "medium", label: "Moyenne", color: "var(--sev-medium)" },
  { key: "low", label: "Faible", color: "var(--sev-low)" },
  { key: "none", label: "Information", color: "var(--sev-log)" },
];
const sevOf = (k) => WEB_SEV.find((s) => s.key === k) || WEB_SEV[3];

const PHASES = {
  spider: { label: "Exploration", tone: "info", live: true },
  ajax: { label: "Exploration JS", tone: "info", live: true },
  active: { label: "Analyse active", tone: "info", live: true },
  done: { label: "Terminé", tone: "ok", live: false },
  stopped: { label: "Arrêté", tone: "neutral", live: false },
  error: { label: "Échec", tone: "danger", live: false },
};

// Recommendation per alert, used when ZAP gives no solution, so every finding
// tells the analyst what to do.
const RECO = [
  [/sql injection/i, "Utilisez des requêtes paramétrées (préparées), validez et typez les entrées, et limitez les droits du compte de base de données."],
  [/cross site scripting|\bxss\b/i, "Échappez toute donnée affichée dans le HTML selon son contexte et activez une Content-Security-Policy stricte."],
  [/content security policy|\bcsp\b/i, "Ajoutez un en-tête Content-Security-Policy restrictif (ex. default-src 'self')."],
  [/clickjacking|x-frame-options|frame-ancestors/i, "Ajoutez Content-Security-Policy: frame-ancestors 'none' (ou X-Frame-Options: DENY)."],
  [/strict-transport-security|\bhsts\b/i, "Servez le site en HTTPS et ajoutez l'en-tête Strict-Transport-Security."],
  [/x-content-type-options/i, "Ajoutez l'en-tête X-Content-Type-Options: nosniff."],
  [/cookie|secure flag|httponly/i, "Ajoutez les attributs Secure, HttpOnly et SameSite aux cookies de session."],
  [/server.*(leak|version)|version information/i, "Masquez la bannière du serveur (ServerTokens Prod sur Apache, server_tokens off sur nginx)."],
  [/path traversal|directory traversal/i, "Rejetez les séquences « ../ » et servez les fichiers depuis une liste blanche."],
  [/command injection|remote os command|code injection/i, "N'exécutez jamais d'entrée utilisateur ; utilisez des API sûres et une liste blanche stricte."],
  [/directory browsing|directory listing/i, "Désactivez le listing des répertoires sur le serveur web."],
  [/user agent fuzzer/i, "Information : le site répond différemment selon le navigateur. Vérifiez qu'aucune version mobile ou ancienne n'expose de contenu sensible. Pas d'action urgente."],
  [/information disclosure|suspicious comments/i, "Retirez les commentaires et informations techniques du code livré en production."],
  [/timestamp|cacheable|cache control/i, "Ajoutez des en-têtes de cache adaptés (Cache-Control: no-store) sur les réponses sensibles."],
];
function recoFor(name, existing) {
  if (existing && existing.trim()) return existing.trim();
  const hit = RECO.find(([re]) => re.test(name || ""));
  return hit ? hit[1] : "Consultez la fiche OWASP correspondante et corrigez selon le contexte de l'application.";
}
function phaseChip(job) {
  const p = PHASES[job.phase] || PHASES.error;
  return `<span class="chip chip-${p.tone}">${p.label}${p.live ? ` ${job.progress || 0}%` : ""}</span>`;
}

const badge = (level) => {
  const s = sevOf(level);
  return `<span class="sev sev-${level === "none" ? "log" : level}">${s.label}</span>`;
};

// Group alerts by type (same name), most critical first.
function groupAlerts(alerts) {
  const byType = new Map();
  for (const a of alerts) {
    if (!byType.has(a.name)) byType.set(a.name, { name: a.name, level: a.level, cweid: a.cweid, solution: a.solution, hits: [] });
    byType.get(a.name).hits.push(a);
  }
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  return [...byType.values()].sort((a, b) => order[a.level] - order[b.level] || b.hits.length - a.hits.length);
}

// Build a full report (title + HTML body + a short text summary) for Word,
// print/PDF and sharing.
function buildReport(job, alerts, imgs = {}) {
  const groups = groupAlerts(alerts);
  const counts = { high: 0, medium: 0, low: 0, none: 0 };
  for (const a of alerts) counts[a.level] = (counts[a.level] || 0) + 1;
  const when = new Date(job.endedAt || job.startedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  const title = `Rapport de scan web — ${job.name}`;
  const summaryTable = `<table class="cards"><tr>${WEB_SEV.map((s) => `<td class="c-${s.key}"><span class="n">${counts[s.key] || 0}</span><span class="l">${s.label}</span></td>`).join("")}</tr></table>`;
  const groupsHtml = groups.map((g) => `
    <h3 class="sev sev-${g.level}">${esc(sevOf(g.level).label.toUpperCase())} · ${esc(g.name)}</h3>
    <p class="muted">${g.hits.length} occurrence(s)${g.cweid ? ` · CWE-${esc(g.cweid)}` : ""}</p>
    <table><tr><th style="width:70px">Méthode</th><th>URL</th><th style="width:120px">Paramètre</th></tr>
    ${g.hits.slice(0, 50).map((a) => `<tr><td>${esc(a.method || "GET")}</td><td>${esc(a.url)}</td><td>${esc(a.param || "—")}</td></tr>`).join("")}
    ${g.hits.length > 50 ? `<tr><td colspan="3" class="muted">… et ${g.hits.length - 50} autre(s)</td></tr>` : ""}</table>
    <p class="reco"><b>Recommandation :</b> ${esc(recoFor(g.name, g.solution))}</p>`).join("");
  const body = `
    <div class="meta"><b>Cible :</b> ${esc(job.target)} &nbsp;·&nbsp; <b>Date :</b> ${when} &nbsp;·&nbsp;
      <b>Type :</b> ${job.mode === "spider" ? "Exploration seule" : "Complète"}${job.deep ? " (approfondie)" : ""}${job.authenticated ? " · authentifié" : ""} &nbsp;·&nbsp;
      <b>Outil :</b> OWASP ZAP via Sentrovyx</div>
    <h2>Synthèse</h2>
    <p>${alerts.length} alerte(s) sur la cible, réparties comme suit :</p>
    ${imgs.donutImg ? `<table><tr><td style="border:none;width:220px;text-align:center"><img src="${imgs.donutImg}" height="150"></td><td style="border:none;vertical-align:middle">${summaryTable}</td></tr></table>` : summaryTable}
    <h2>Détail des alertes</h2>
    ${groups.length ? groupsHtml : "<p class=\"muted\">Aucune alerte : ZAP n'a trouvé aucune faille sur cette cible.</p>"}`;
  const summaryText = `Sentrovyx — scan web « ${job.name} » (${job.target}) : ${counts.high} élevée(s), ${counts.medium} moyenne(s), ${counts.low} faible(s), ${counts.none} info.`;
  return { title, body, summaryText };
}

function detail(root, job, alerts) {
  const counts = { high: 0, medium: 0, low: 0, none: 0 };
  for (const a of alerts) counts[a.level] = (counts[a.level] || 0) + 1;
  // Group identical alert types (same name), keeping each occurrence (URL/param).
  const byType = new Map();
  for (const a of alerts) {
    if (!byType.has(a.name)) byType.set(a.name, { name: a.name, level: a.level, cweid: a.cweid, solution: a.solution, reference: a.reference, hits: [] });
    byType.get(a.name).hits.push(a);
  }
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  const groups = [...byType.values()].sort((a, b) => order[a.level] - order[b.level] || b.hits.length - a.hits.length);
  const live = PHASES[job.phase]?.live;
  // Many "Hidden File Found" on one site usually means the server answers 200
  // to every path (single-page app): those hits are almost all false positives.
  const fpGroup = groups.find((g) => /hidden file found/i.test(g.name) && g.hits.length >= 10);

  root.querySelector("#detail").innerHTML = `
    <div class="page-head" style="margin-top:8px">
      <div class="grow"><div class="eyebrow">${phaseChip(job)}${job.authenticated ? ` <span class="chip chip-ok">${icon("key")}Authentifié${job.authUser ? ` · ${esc(job.authUser)}` : ""}</span>` : ""}${job.deep ? ` <span class="chip chip-neutral">Approfondi</span>` : ""}</div><h1 style="font-size:22px">${esc(job.name)}</h1>
        <p class="mono faint" style="font-size:12px"><a href="${esc(job.target)}" target="_blank" rel="noopener noreferrer">${esc(job.target)}</a></p></div>
      <div class="actions">
        ${live ? `<button class="btn needs-analyste" data-stop>${icon("x")}Arrêter</button>` : ""}
        <button class="btn" data-word ${alerts.length ? "" : "disabled"}>${icon("file")}Word</button>
        <button class="btn" data-print ${alerts.length ? "" : "disabled"}>${icon("printer")}Imprimer / PDF</button>
        <button class="btn" data-share ${alerts.length ? "" : "disabled"}>${icon("share")}Partager</button>
        <button class="btn" data-csv ${alerts.length ? "" : "disabled"}>${icon("download")}CSV</button>
        <button class="btn btn-danger needs-analyste" data-delete ${live ? "disabled" : ""}>${icon("trash")}Supprimer</button>
      </div>
    </div>
    ${job.phase === "error" ? `<div class="banner danger">${icon("alert")}<div class="grow">Le scan a échoué : ${esc(job.error || "erreur inconnue")}</div></div>` : ""}
    ${live ? `<div class="banner">${icon("refresh", "spin")}<div class="grow">${{ spider: "Exploration du site (découverte des pages)", ajax: "Exploration JavaScript (pages dynamiques)", active: "Analyse active des pages (injection, XSS, en-têtes…)" }[job.phase] || "Analyse en cours"} — ${job.progress || 0}%.</div></div>` : ""}
    ${!live && fpGroup ? `<div class="banner warn">${icon("alert")}<div class="grow"><b>Faux positifs probables.</b> Le site renvoie « page trouvée » pour presque toutes les adresses (typique d'une application monopage). Les ${fpGroup.hits.length} « ${esc(fpGroup.name)} » sont donc très probablement faux — vérifiez-en quelques-unes manuellement avant de conclure.</div></div>` : ""}
    <div class="grid g-3" style="margin-bottom:16px">
      <section class="card fill"><div class="card-head"><h2>Risque</h2></div>
        <div class="card-body" id="web-donut">${donut(WEB_SEV.map((s) => ({ label: s.label, value: counts[s.key] || 0, color: s.color })), { sub: "alertes", size: 136 })}</div></section>
      <section class="card fill span-2"><div class="card-head"><h2>Alertes par type</h2></div>
        <div class="card-body">${groups.length
          ? chart("columns", { columns: groups.slice(0, 10).map((g) => ({ label: g.name.split(" ").slice(0, 2).join(" "), title: `${g.name} (${g.hits.length})`, values: { [g.level]: g.hits.length } })), keys: WEB_SEV, height: 200 })
          : empty("check", live ? "Résultats à venir" : "Aucune alerte", live ? "Les alertes apparaîtront à la fin de l'analyse." : "ZAP n'a trouvé aucune faille sur ce site.")}</div></section>
    </div>
    ${groups.map((g) => `<section class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="avatar">${badge(g.level)}</span>
        <div class="grow" style="min-width:0"><h3 class="ellipsis">${esc(g.name)}</h3>
          <div class="sub">${g.hits.length} occurrence(s)${g.cweid ? ` · CWE-${esc(g.cweid)}` : ""}${g === fpGroup ? ` · <span style="color:var(--warn)">faux positifs probables (SPA)</span>` : ""}</div></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th style="width:90px">Méthode</th><th>URL</th><th>Paramètre</th><th class="hide-sm">Attaque / preuve</th></tr></thead><tbody>
        ${g.hits.map((a) => `<tr>
          <td><span class="tag mono">${esc(a.method || "GET")}</span></td>
          <td class="cell-title mono"><div class="ellipsis" style="max-width:420px">${esc(a.url)}</div></td>
          <td class="mono">${esc(a.param || "—")}</td>
          <td class="hide-sm"><div class="ellipsis mono" style="max-width:280px">${esc(a.attack || a.evidence || "—")}</div></td></tr>`).join("")}
      </tbody></table></div>
      <div class="card-body" style="padding-top:8px"><div class="sub" style="margin-bottom:2px">Recommandation</div><p style="margin:0">${esc(recoFor(g.name, g.solution))}</p></div>
    </section>`).join("")}`;
  mountCharts(root);
}

function unavailableNotice() {
  return `<section class="card"><div class="card-body">${empty("globe", "Scan web non configuré",
    "Le scan d'applications web s'appuie sur OWASP ZAP, lancé à côté de Sentrovyx. Démarrez un démon ZAP et indiquez son adresse au serveur de la console (variable d'environnement ZAP_URL), puis rechargez la page.")}
    <pre class="code" style="margin:0 16px 16px"><code>zap.sh -daemon -host 127.0.0.1 -port 8090 \\
  -config api.key=CHANGEZ_MOI -config api.addrs.addr.name=127.0.0.1

# puis au lancement de Sentrovyx :
ZAP_URL=http://127.0.0.1:8090 ZAP_API_KEY=CHANGEZ_MOI node server.mjs</code></pre></section>`;
}

export default async function webscan(root, param) {
  let timer;
  let alive = true;
  const editable = can("analyste");

  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon("globe")} Scan web</div><h1>Applications web (OWASP ZAP)</h1>
        <p>Pendant qu'openvasd teste le serveur, ZAP explore votre site et attaque ses pages : injection SQL, XSS, CSRF, en-têtes de sécurité manquants. À n'utiliser que sur des sites qui vous appartiennent ou que vous êtes autorisé à tester.</p></div>
    </div>
    <div id="body"><div class="card">${skeletonRows(3)}</div></div>`;

  const body = root.querySelector("#body");

  // ZAP configured? Otherwise show how to set it up (live mode only; demo is always on).
  let zap = { enabled: true };
  if (api().mode !== "demo") {
    zap = await api().webscan.status().catch((err) => ({ enabled: false, error: err.message }));
  }
  if (!alive) return;
  if (!zap.enabled) {
    body.innerHTML = unavailableNotice();
    return () => { alive = false; clearTimeout(timer); };
  }

  body.innerHTML = `
    <div class="grid g-main" style="margin-bottom:20px">
      <section class="card">
        <div class="card-head"><span class="step-num">${icon("plus")}</span><div><h2>Nouveau scan web</h2><div class="sub">ZAP ${esc(zap.version || "")}</div></div></div>
        ${editable ? `<form class="card-body stack" id="wform">
          <label class="field"><span>Nom du scan</span><input class="input" name="name" placeholder="ex. Portail client" /></label>
          <label class="field"><span>Adresse du site</span><input class="input" name="target" placeholder="https://www.monsite.fr/" required />
            <small>L'adresse de départ de l'exploration. ZAP suivra les liens à partir d'elle.</small></label>
          <label class="field"><span>Type d'analyse</span>
            <select class="input" name="mode">
              <option value="active">Complète (exploration + analyse active)</option>
              <option value="spider">Exploration seule (passive, sans attaque)</option>
            </select>
            <small>L'analyse active envoie des requêtes offensives : réservez-la aux sites autorisés.</small></label>
          <label class="toggle"><input type="checkbox" name="ajax" /><span>Site très dynamique (JavaScript) : utiliser le spider AJAX</span></label>
          <label class="toggle"><input type="checkbox" name="deep" /><span>Analyse approfondie : exploration en profondeur, tous les tests, force d'attaque maximale (plus lent)</span></label>
          <details class="auth-box">
            <summary class="muted" style="cursor:pointer">Scan authentifié (tester les pages derrière un login)</summary>
            <div class="form-grid" style="margin-top:12px">
              <label class="field full"><span>URL de connexion (où le formulaire envoie les identifiants)</span><input class="input" name="loginUrl" placeholder="https://www.monsite.fr/login" autocomplete="off" /></label>
              <label class="field"><span>Nom du champ utilisateur</span><input class="input mono" name="userField" placeholder="username" autocomplete="off" /></label>
              <label class="field"><span>Nom du champ mot de passe</span><input class="input mono" name="passField" placeholder="password" autocomplete="off" /></label>
              <label class="field"><span>Utilisateur</span><input class="input" name="authUser" autocomplete="off" /></label>
              <label class="field"><span>Mot de passe</span><input class="input" type="password" name="authPass" autocomplete="new-password" /></label>
              <label class="field full"><span>Indicateur « connecté » (texte ou regex présent une fois connecté)</span><input class="input mono" name="loggedInRegex" placeholder="Déconnexion|Mon compte" autocomplete="off" /></label>
              <small class="full">Les noms de champs sont ceux du formulaire HTML (attribut <span class="mono">name</span>). Le mot de passe sert uniquement à configurer ZAP : il n'est pas enregistré. Authentification par formulaire uniquement.</small>
            </div>
          </details>
          <button class="btn btn-primary" style="justify-self:start">${icon("play")}Lancer le scan</button>
        </form>` : `<div class="card-body muted">Votre rôle permet de consulter les scans web, pas d'en lancer.</div>`}
      </section>
      <section class="card"><div class="card-head"><h2>Scans web</h2></div><div id="wlist">${skeletonRows(4)}</div></section>
    </div>
    <div id="detail"></div>`;

  async function drawList() {
    const el = root.querySelector("#wlist");
    if (!el) return;
    let list = [];
    try {
      list = await api().webscan.list();
    } catch (err) {
      el.innerHTML = empty("alert", "Liste indisponible", err.message);
      return;
    }
    if (!alive) return;
    if (!list.length) {
      el.innerHTML = empty("globe", "Aucun scan web", "Indiquez l'adresse d'un site à gauche pour lancer le premier scan.");
      return;
    }
    el.innerHTML = `<div class="list">${list.map((s) => `<a class="list-item" href="#/webscan/${encodeURIComponent(s.id)}" style="${param === s.id ? "background:var(--accent-soft)" : ""}">
      <span class="avatar ${PHASES[s.phase]?.live ? "live" : ""}">${icon("globe")}</span>
      <span class="grow"><b class="ellipsis" style="display:block">${esc(s.name)}</b><span class="faint mono" style="font-size:12px">${esc((s.target || "").replace(/^https?:\/\//, ""))}</span><span class="faint" style="font-size:12.5px"> · ${ago(Math.floor(Date.parse(s.startedAt) / 1000))}</span></span>
      ${phaseChip(s)}</a>`).join("")}</div>`;
  }

  async function drawDetail() {
    clearTimeout(timer);
    if (!param) return;
    try {
      const job = await api().webscan.get(param);
      const alerts = PHASES[job.phase]?.live ? [] : await api().webscan.alerts(param).catch(() => []);
      if (!alive) return;
      detail(root, job, alerts);
      if (PHASES[job.phase]?.live) timer = setTimeout(() => (drawDetail(), drawList()), (settings.poll || 3) * 1000);
    } catch (err) {
      root.querySelector("#detail").innerHTML = `<div class="card">${empty("alert", "Scan web introuvable", err.message)}</div>`;
    }
  }

  root.onsubmit = async (e) => {
    if (e.target.id !== "wform") return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const auth = f.loginUrl && f.authUser && f.authPass
        ? { loginUrl: f.loginUrl.trim(), userField: (f.userField || "").trim() || "username", passField: (f.passField || "").trim() || "password", username: f.authUser.trim(), password: f.authPass, loggedInRegex: (f.loggedInRegex || "").trim() }
        : null;
      const { id } = await api().webscan.create({ name: (f.name || "").trim(), target: f.target.trim(), mode: f.mode, ajax: !!f.ajax, deep: !!f.deep, auth });
      toast("Scan web lancé", f.target.trim());
      location.hash = `#/webscan/${encodeURIComponent(id)}`;
    } catch (err) {
      fail("Scan impossible")(err);
      btn.disabled = false;
    }
  };

  root.onclick = async (e) => {
    if (e.target.closest("[data-stop]")) {
      try {
        await api().webscan.stop(param);
        toast("Scan arrêté");
        drawDetail();
        drawList();
      } catch (err) {
        fail("Arrêt impossible")(err);
      }
    }
    if (e.target.closest("[data-csv]")) {
      const alerts = await api().webscan.alerts(param).catch(() => []);
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["risque", "alerte", "cwe", "methode", "url", "parametre", "attaque", "recommandation"].join(",")];
      for (const a of alerts) lines.push([sevOf(a.level).label, a.name, a.cweid, a.method, a.url, a.param, a.attack, recoFor(a.name, a.solution)].map(cell).join(","));
      return download(`sentrovyx-web-${param.slice(0, 8)}.csv`, lines.join("\n"), "text/csv");
    }
    if (e.target.closest("[data-word]") || e.target.closest("[data-print]") || e.target.closest("[data-share]")) {
      const [job, alerts] = await Promise.all([api().webscan.get(param).catch(() => null), api().webscan.alerts(param).catch(() => [])]);
      if (!job) return fail("Rapport impossible")(new Error("Scan introuvable"));
      const file = `sentrovyx-web-${param.slice(0, 8)}`;
      if (e.target.closest("[data-word]")) {
        const [logo, donutImg] = await Promise.all([
          svgUrlToPng("brand/sentrovyx-horizontal-dark.svg", 150, 52),
          svgToPng(root.querySelector("#web-donut svg")),
        ]);
        const rep = buildReport(job, alerts, { donutImg });
        downloadDoc(file, rep.title, rep.body, { logo });
        return toast("Rapport Word téléchargé", "Ouvrez-le dans Word, LibreOffice ou Google Docs.");
      }
      const { title, body, summaryText } = buildReport(job, alerts);
      if (e.target.closest("[data-print]")) {
        const ok = printReport(title, body, () => toast("Fenêtre bloquée", "Autorisez les pop-ups pour imprimer, ou utilisez le bouton Word.", "error"));
        if (ok) toast("Impression", "Choisissez « Enregistrer au format PDF » dans la boîte d'impression.");
        return;
      }
      const res = await shareReport(file, title, body, summaryText);
      return toast(
        res === "shared" ? "Rapport partagé" : res === "copied" ? "Résumé copié" : "Partage indisponible",
        res === "copied" ? "Un résumé du scan est dans le presse-papiers." : res === "none" ? "Utilisez le bouton Word pour partager le fichier." : "",
        res === "none" ? "error" : "info",
      );
    }
    if (e.target.closest("[data-delete]")) {
      const job = await api().webscan.get(param).catch(() => ({ name: param }));
      if (!(await confirmDialog({ title: "Supprimer le scan web ?", body: `« ${job.name} » et ses alertes seront supprimés.`, confirm: "Supprimer", danger: true }))) return;
      try {
        await api().webscan.remove(param);
        toast("Scan supprimé", job.name);
        location.hash = "#/webscan";
      } catch (err) {
        fail("Suppression impossible")(err);
      }
    }
  };

  await drawList();
  await drawDetail();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

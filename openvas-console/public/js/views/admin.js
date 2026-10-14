// Administration: accounts and roles, alerts (webhook), remediation SLAs,
// audit log and service status. Admin role only.

import { call, can, currentUser, team, refreshTeam } from "../team.js";
import { debounce, esc, icon, num } from "../util.js";
import { confirmDialog, empty, fail, skeletonRows, toast } from "../ui.js";

const ROLE_LABELS = {
  admin: "Administrateur — tout, y compris comptes et réglages",
  analyste: "Analyste — scans, triage, remédiation, planifications",
  lecteur: "Lecteur — consultation et rapports",
};

const ACTIONS = {
  login: "Connexion",
  "scan.create": "Création de scan",
  "scan.start": "Démarrage de scan",
  "scan.stop": "Arrêt de scan",
  "scan.delete": "Suppression de scan",
  "triage.update": "Suivi de vulnérabilité",
  "assets.update": "Fiche actif",
  "labels.update": "Nom de scan",
  "schedule.create": "Planification créée",
  "schedule.update": "Planification modifiée",
  "schedule.delete": "Planification supprimée",
  "schedule.run": "Scan planifié lancé",
  "settings.update": "Réglages",
  "user.create": "Compte créé",
  "user.update": "Compte modifié",
  "user.delete": "Compte supprimé",
  "user.password": "Mot de passe changé",
  "mfa.enable": "Double authentification activée",
  "mfa.disable": "Double authentification désactivée",
  "login.recovery": "Connexion avec un code de secours",
  "verify.start": "Vérification de correction lancée",
  "verify.result": "Résultat de vérification",
  "container.scan": "Scan d'images Docker",
};

export default async function admin(root) {
  if (!can("admin")) {
    root.innerHTML = `<div class="card">${empty("key", "Accès réservé", "Cette page est réservée aux administrateurs.")}</div>`;
    return;
  }
  let tab = "users";
  let auditFilter = "";
  let audit = [];

  root.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">${icon("key")} Administration</div><h1>Équipe et sécurité</h1>
      <p>Comptes et rôles, alertes, délais de remédiation et journal d'audit de la console.</p></div></div>
    ${team.remote() ? "" : `<div class="banner">${icon("info")}<div class="grow">Mode démo ou console servie sans <span class="mono">server.mjs</span> : les comptes, alertes et journal d'audit nécessitent le serveur de la console.</div></div>`}
    <div class="tabs" id="tabs"></div>
    <div id="tab"></div>`;

  const tabs = [
    ["users", "Comptes"],
    ["alerts", "Alertes et SLA"],
    ["audit", "Journal d'audit"],
    ["system", "État du service"],
  ];

  async function draw() {
    root.querySelector("#tabs").innerHTML = tabs.map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("");
    const el = root.querySelector("#tab");
    el.innerHTML = `<div class="card">${skeletonRows(5)}</div>`;
    try {
      if (tab === "users") el.innerHTML = await usersTab();
      if (tab === "alerts") el.innerHTML = alertsTab();
      if (tab === "audit") {
        audit = team.remote() ? await call("GET", "/console/audit?limit=500") : [];
        el.innerHTML = auditTab();
      }
      if (tab === "system") el.innerHTML = await systemTab();
    } catch (err) {
      el.innerHTML = `<div class="card">${empty("alert", "Chargement impossible", err.message)}</div>`;
    }
  }

  async function usersTab() {
    const users = team.remote() ? await call("GET", "/console/users") : [];
    const open = !currentUser().authEnabled;
    return `
      ${open && team.remote() ? `<div class="banner warn">${icon("alert")}<div class="grow"><b>La console est ouverte sans connexion.</b> Créez un premier compte administrateur ci-dessous : la connexion deviendra obligatoire pour tous.</div></div>` : ""}
      <div class="grid g-main">
        <section class="card">
          <div class="card-head"><h2>Comptes</h2><span class="sub">${num(users.length)} utilisateur(s)</span></div>
          ${users.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>MFA</th><th class="hide-sm">Créé le</th><th></th></tr></thead><tbody>
            ${users.map((u) => `<tr data-user="${esc(u.username)}">
              <td><span class="avatar-chip">${esc(u.username.slice(0, 2).toUpperCase())}</span> <b>${esc(u.username)}</b>${u.username === currentUser().username ? ` <span class="tag">vous</span>` : ""}</td>
              <td><select class="select" data-role style="width:auto">${Object.keys(ROLE_LABELS).map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
              <td>${u.mfa ? `<span class="chip chip-ok">${icon("check")}Activée</span>` : `<span class="chip chip-warn">Non</span>`}</td>
              <td class="hide-sm muted">${new Date(u.created).toLocaleDateString("fr-FR")}</td>
              <td class="actions-cell">${u.mfa ? `<button class="icon-btn sm" data-mfareset title="Réinitialiser la double authentification (téléphone perdu)">${icon("refresh")}</button>` : ""}<button class="icon-btn sm" data-reset title="Nouveau mot de passe">${icon("key")}</button><button class="icon-btn sm danger" data-deluser title="Supprimer">${icon("trash")}</button></td>
            </tr>`).join("")}</tbody></table></div>` : empty("key", "Aucun compte", "La console est accessible sans connexion tant qu'aucun compte n'existe.")}
        </section>
        <section class="card">
          <div class="card-head"><h2>Ajouter un compte</h2></div>
          <form class="card-body stack" id="adduser" autocomplete="off">
            <label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" required pattern="[\\w.@-]{2,40}" /></label>
            <label class="field"><span>Mot de passe</span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password" /><small>8 caractères minimum.</small></label>
            <label class="field"><span>Rôle</span><select class="select" name="role">${Object.entries(ROLE_LABELS).map(([r, l]) => `<option value="${r}" ${r === (users.length ? "analyste" : "admin") ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <button class="btn btn-primary" ${team.remote() ? "" : "disabled"}>${icon("plus")}Créer le compte</button>
          </form>
        </section>
      </div>`;
  }

  function alertsTab() {
    const s = team.settings();
    return `<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Sécurité des comptes</h2></div>
      <div class="card-body"><label class="toggle"><input type="checkbox" id="requiremfa" ${s.requireMfa ? "checked" : ""} />
        <span><b>Exiger la double authentification pour tous les comptes</b><br /><small class="faint">Les utilisateurs sans MFA devront l'activer (QR code à scanner) avant d'accéder à la console. Recommandé par l'ANSSI (mesure 13) et l'ISO 27001 (A.8.5).</small></span></label></div></section>
    <div class="grid g-2">
      <section class="card"><div class="card-head"><h2>Alertes de fin de scan</h2></div>
        <form class="card-body stack" id="webhook">
          <label class="field"><span>URL du webhook</span><input class="input mono" name="webhook" value="${esc(s.webhook)}" placeholder="https://hooks.slack.com/services/…" />
            <small>Slack, Microsoft Teams, Mattermost, Rocket.Chat ou Discord. À la fin de chaque scan, le serveur envoie le nombre de vulnérabilités par sévérité et les 3 priorités.</small></label>
          <div class="row"><button class="btn btn-primary">${icon("check")}Enregistrer</button><button type="button" class="btn" id="testhook">${icon("bell")}Envoyer un test</button></div>
        </form></section>
      <section class="card"><div class="card-head"><h2>Délais de remédiation (SLA)</h2></div>
        <form class="card-body stack" id="sla">
          <p class="muted" style="margin:0">Nombre de jours après la première détection pour corriger une vulnérabilité, selon sa sévérité. Au-delà, elle apparaît « en retard ».</p>
          <div class="form-grid">${[["critical", "Critique"], ["high", "Élevée"], ["medium", "Moyenne"], ["low", "Faible"]].map(([k, l]) => `<label class="field"><span>${l}</span><input class="input" type="number" min="1" name="${k}" value="${s.sla[k]}" /></label>`).join("")}</div>
          <button class="btn btn-primary" style="justify-self:start">${icon("check")}Enregistrer</button>
        </form></section>
    </div>`;
  }

  function auditTab() {
    const q = auditFilter.toLowerCase();
    const rows = audit.filter((a) => !q || `${a.user} ${a.action} ${ACTIONS[a.action] || ""} ${a.target} ${JSON.stringify(a.detail || {})}`.toLowerCase().includes(q));
    return `<section class="card">
      <div class="toolbar"><label class="input-icon">${icon("search")}<input class="input" id="auditq" placeholder="Utilisateur, action, cible…" value="${esc(auditFilter)}" /></label>
        <span class="faint" style="margin-left:auto">${num(rows.length)} événement(s)</span></div>
      ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Cible</th><th class="hide-sm">Détail</th></tr></thead><tbody>
        ${rows.slice(0, 300).map((a) => `<tr><td class="muted" style="white-space:nowrap">${new Date(a.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })}</td>
          <td><b>${esc(a.user || "?")}</b></td><td>${esc(ACTIONS[a.action] || a.action)}</td>
          <td class="mono ellipsis" style="max-width:260px;font-size:12px">${esc(typeof a.target === "string" ? a.target : JSON.stringify(a.target ?? ""))}</td>
          <td class="hide-sm faint mono" style="font-size:11.5px">${a.detail ? esc(Object.entries(a.detail).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")) : ""}</td></tr>`).join("")}
      </tbody></table></div>` : empty("search", "Aucun événement", team.remote() ? "Les actions des utilisateurs apparaîtront ici." : "Le journal d'audit est tenu par le serveur de la console.")}
    </section>`;
  }

  async function systemTab() {
    const st = team.remote() ? await call("GET", "/console/status") : null;
    if (!st) return `<div class="card">${empty("server", "Serveur de la console absent", "Lancez la console avec server.mjs pour ces fonctions.")}</div>`;
    const row = (label, ok, text) => `<div class="list-item"><span class="dot ${ok ? "ok" : "warn"}"></span><span class="grow"><b>${label}</b><div class="faint" style="font-size:12.5px">${text}</div></span></div>`;
    return `<section class="card"><div class="list">
      ${row("Authentification", st.authEnabled, st.authEnabled ? `${st.users} compte(s), connexion obligatoire` : "Désactivée : aucun compte n'existe")}
      ${row("Catalogue des tests (VT)", st.catalog.state === "ready", `${esc(st.catalog.state)} · ${num(st.catalog.count)} tests${st.catalog.error ? ` · ${esc(st.catalog.error)}` : ""}`)}
      ${row("Renseignement CISA KEV / EPSS", st.intel.kev > 0, st.intel.kev ? `${num(st.intel.kev)} CVE exploitées connues · mis à jour ${new Date(st.intel.updated).toLocaleString("fr-FR")}` : `Indisponible${st.intel.error ? ` (${esc(st.intel.error)})` : ""} — la VM doit pouvoir joindre cisa.gov et api.first.org`)}
      ${row("Alertes", !!team.settings().webhook, team.settings().webhook ? "Webhook configuré" : "Aucun webhook")}
    </div></section>`;
  }

  root.onclick = async (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) return ((tab = t.dataset.tab), draw());
    const tr = e.target.closest("tr[data-user]");
    try {
      if (tr && e.target.closest("[data-deluser]")) {
        const name = tr.dataset.user;
        if (!(await confirmDialog({ title: "Supprimer le compte ?", body: `« ${name} » ne pourra plus se connecter.`, confirm: "Supprimer", danger: true }))) return;
        await call("DELETE", `/console/users/${encodeURIComponent(name)}`);
        toast("Compte supprimé", name);
        return draw();
      }
      if (tr && e.target.closest("[data-reset]")) {
        const name = tr.dataset.user;
        const password = prompt(`Nouveau mot de passe pour ${name} (8 caractères minimum) :`);
        if (!password) return;
        await call("PUT", `/console/users/${encodeURIComponent(name)}`, { password });
        return toast("Mot de passe modifié", name);
      }
      if (tr && e.target.closest("[data-mfareset]")) {
        const name = tr.dataset.user;
        if (!(await confirmDialog({ title: "Réinitialiser la double authentification ?", body: `« ${name} » pourra se connecter avec son seul mot de passe, puis réactiver la MFA avec un nouveau téléphone.`, confirm: "Réinitialiser" }))) return;
        await call("PUT", `/console/users/${encodeURIComponent(name)}`, { resetMfa: true });
        toast("Double authentification réinitialisée", name);
        return draw();
      }
      if (e.target.closest("#testhook")) {
        await call("POST", "/console/settings/test-webhook");
        return toast("Alerte de test envoyée", "Vérifiez votre canal.");
      }
    } catch (err) {
      fail("Action impossible")(err);
    }
  };
  root.onchange = async (e) => {
    if (e.target.id === "requiremfa") {
      try {
        await call("PUT", "/console/settings", { requireMfa: e.target.checked });
        await refreshTeam();
        toast(e.target.checked ? "Double authentification obligatoire" : "Double authentification facultative", e.target.checked ? "Les comptes sans MFA devront l'activer à leur prochaine action." : "");
      } catch (err) {
        fail("Modification impossible")(err);
      }
      return;
    }
    if (!e.target.matches("[data-role]")) return;
    const name = e.target.closest("tr").dataset.user;
    try {
      await call("PUT", `/console/users/${encodeURIComponent(name)}`, { role: e.target.value });
      toast("Rôle modifié", `${name} : ${e.target.value}`);
    } catch (err) {
      fail("Modification impossible")(err);
      draw();
    }
  };
  root.oninput = debounce((e) => {
    if (e.target.id !== "auditq") return;
    auditFilter = e.target.value.trim();
    root.querySelector("#tab").innerHTML = auditTab();
    const input = root.querySelector("#auditq");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 150);
  root.onsubmit = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target));
    try {
      if (e.target.id === "adduser") {
        const first = !currentUser().authEnabled;
        await call("POST", "/console/users", form);
        toast("Compte créé", `${form.username} (${form.role})`);
        if (first) {
          toast("Connexion désormais obligatoire", "Reconnectez-vous avec ce compte.", "info");
          setTimeout(() => location.reload(), 1500);
        }
        return draw();
      }
      if (e.target.id === "webhook") await call("PUT", "/console/settings", { webhook: form.webhook });
      if (e.target.id === "sla") await call("PUT", "/console/settings", { sla: form });
      await refreshTeam();
      toast("Réglages enregistrés");
      draw();
    } catch (err) {
      fail("Enregistrement impossible")(err);
    }
  };

  draw();
}

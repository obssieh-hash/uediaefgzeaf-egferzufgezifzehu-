// Application shell: navigation, routing, theme, connection status and the
// Ctrl+K command palette. Each view lives in ./views and returns a cleanup
// function so polling stops when the user navigates away.

import { api, detectMode, labels, settings } from "./api.js";
import { scanSummaries } from "./store.js";
import { $, esc, icon, shortFeed } from "./util.js";
import { drawer, palette, toast } from "./ui.js";
import { AuthError, call, can, currentUser, loadTeam, login, loginMfa, logout, refreshTeam, team } from "./team.js";
import { mfaEnrol } from "./views/mfa.js";

import dashboard from "./views/dashboard.js";
import scans from "./views/scans.js";
import scan from "./views/scan.js";
import newScan from "./views/new-scan.js";
import vts from "./views/vts.js";
import notus from "./views/notus.js";
import settingsView from "./views/settings.js";
import assets from "./views/assets.js";
import reports from "./views/reports.js";
import compare from "./views/compare.js";
import remediation from "./views/remediation.js";
import schedules from "./views/schedules.js";
import admin from "./views/admin.js";
import containers from "./views/containers.js";
import compliance from "./views/compliance.js";

const NAV = [
  { group: "Supervision" },
  { path: "dashboard", label: "Tableau de bord", icon: "dashboard" },
  { path: "scans", label: "Scans", icon: "radar", count: true },
  { path: "new", label: "Nouveau scan", icon: "plus", role: "analyste" },
  { path: "schedules", label: "Scans planifiés", icon: "refresh" },
  { path: "containers", label: "Images Docker", icon: "package" },
  { group: "Analyse" },
  { path: "remediation", label: "Remédiation", icon: "check" },
  { path: "assets", label: "Actifs", icon: "host" },
  { path: "reports", label: "Rapports", icon: "chart" },
  { path: "compare", label: "Comparer", icon: "diff" },
  { path: "compliance", label: "Conformité", icon: "shield" },
  { group: "Connaissances" },
  { path: "vts", label: "Tests de vulnérabilité", icon: "shield" },
  { path: "notus", label: "Analyse de paquets", icon: "package" },
  { group: "Système" },
  { path: "admin", label: "Administration", icon: "key", role: "admin" },
  { path: "settings", label: "Paramètres", icon: "settings" },
];

const ROUTES = {
  dashboard: { view: dashboard, title: "Tableau de bord" },
  scans: { view: scans, title: "Scans" },
  scan: { view: scan, title: "Scan", parent: "scans" },
  new: { view: newScan, title: "Nouveau scan", parent: "scans" },
  vts: { view: vts, title: "Tests de vulnérabilité" },
  notus: { view: notus, title: "Analyse de paquets" },
  settings: { view: settingsView, title: "Paramètres" },
  assets: { view: assets, title: "Actifs" },
  reports: { view: reports, title: "Rapports" },
  compare: { view: compare, title: "Comparer" },
  remediation: { view: remediation, title: "Remédiation" },
  schedules: { view: schedules, title: "Scans planifiés" },
  admin: { view: admin, title: "Administration" },
  containers: { view: containers, title: "Images Docker" },
  compliance: { view: compliance, title: "Conformité" },
};

let cleanup = null;
let renderId = 0;

function parseHash() {
  const [name = "dashboard", ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  if (name === "scans" && rest[0]) return { name: "scan", param: decodeURIComponent(rest[0]) };
  return { name: ROUTES[name] ? name : "dashboard", param: rest[0] && decodeURIComponent(rest[0]) };
}

export function navigate(path) {
  location.hash = `#/${path}`;
}

export function setCrumb(label) {
  const last = $("#crumbs b");
  if (last) last.textContent = label;
}

function renderNav(active) {
  $("#nav").innerHTML = NAV.filter((n) => !n.role || can(n.role)).map((n) =>
    n.group
      ? `<div class="nav-label">${n.group}</div>`
      : `<a href="#/${n.path}" class="${n.path === active ? "active" : ""}">${icon(n.icon)}<span>${n.label}</span>${n.count ? `<span class="count" id="nav-count">·</span>` : ""}</a>`,
  ).join("");
}

async function render() {
  const id = ++renderId;
  const { name, param } = parseHash();
  const route = ROUTES[name];
  cleanup?.();
  cleanup = null;
  document.body.classList.remove("nav-open");
  renderNav(route.parent || name);
  $("#crumbs").innerHTML = route.parent
    ? `<a href="#/${route.parent}">${ROUTES[route.parent].title}</a>${icon("chevron")}<b>${esc(route.title)}</b>`
    : `<b>${esc(route.title)}</b>`;
  document.title = `${route.title} · Sentrovyx`;
  // Each page renders into its own element: a page still loading when the
  // user navigates away writes into a detached node instead of the new page.
  const view = $("#view");
  const root = document.createElement("div");
  view.replaceChildren(root);
  view.style.animation = "none";
  void view.offsetWidth;
  view.style.animation = "";
  window.scrollTo(0, 0);
  const result = await route.view(root, param);
  if (id === renderId) cleanup = result || null;
  else result?.();
  refreshCount();
}

// ---- Sidebar connection card ------------------------------------------------

export async function refreshStatus() {
  const el = $("#conn");
  const demo = api().mode === "demo";
  try {
    const info = await api().info();
    const tone = info.alive && info.ready ? "ok" : info.alive ? "warn" : "danger";
    el.innerHTML = `<div class="conn-card">
      <div class="row"><span class="row"><span class="dot ${tone}"></span><b>${demo ? "Mode démo" : "openvasd"}</b></span>
        <span class="tag">${info.ready ? "Prêt" : "Non prêt"}</span></div>
      <div class="row faint"><span>Feed</span><span class="mono" title="${esc(info.feedVersion)}">${esc(shortFeed(info.feedVersion))}</span></div>
      <div class="row faint"><span>API</span><span class="mono">v${esc(info.apiVersion)}</span></div>
    </div>`;
    return info;
  } catch (err) {
    el.innerHTML = `<a class="conn-card" href="#/settings">
      <div class="row"><span class="row"><span class="dot danger"></span><b>Hors ligne</b></span>${icon("settings")}</div>
      <div class="faint">${esc(err.message)}</div>
    </a>`;
    return null;
  }
}

async function refreshCount() {
  try {
    const ids = await api().listScans();
    const el = $("#nav-count");
    if (el) el.textContent = ids.length;
  } catch {
    /* sidebar badge is best effort */
  }
}

// ---- Scan completion notifications -------------------------------------------

const lastStatus = new Map();
const DONE = { succeeded: "terminé", failed: "en échec", stopped: "arrêté" };

async function watchScans() {
  try {
    const ids = await api().listScans();
    const check = ids.filter((id) => !lastStatus.has(id) || ["running", "requested"].includes(lastStatus.get(id)));
    await Promise.all(
      check.map(async (id) => {
        const st = (await api().getStatus(id)).status;
        const prev = lastStatus.get(id);
        lastStatus.set(id, st);
        if (!["running", "requested"].includes(prev) || !DONE[st]) return;
        const name = labels.get(id).name || `Scan ${id.slice(0, 8)}`;
        toast(`Scan ${DONE[st]}`, name, st === "succeeded" ? "ok" : "error");
        if (settings.notify && "Notification" in window && Notification.permission === "granted") {
          const n = new Notification(`Sentrovyx — scan ${DONE[st]}`, { body: name, icon: "favicon.svg", tag: id });
          n.onclick = () => {
            window.focus();
            navigate(`scans/${encodeURIComponent(id)}`);
          };
        }
      }),
    );
  } catch {
    /* best effort */
  }
}

// ---- Account, login and team notifications ----------------------------------------

function lockScreen(inner) {
  document.querySelector(".login-screen")?.remove();
  const el = document.createElement("div");
  el.className = "login-screen";
  el.innerHTML = `<div class="login-card">
      <div class="login-logo">
        <img class="wm-light" src="brand/sentrovyx-vertical.svg" alt="Sentrovyx" />
        <img class="wm-dark" src="brand/sentrovyx-vertical-dark.svg" alt="Sentrovyx" />
      </div>${inner}</div>`;
  document.body.append(el);
  document.body.classList.add("locked");
  return el;
}

function showLogin(message) {
  if (document.querySelector(".login-screen")) return;
  const el = lockScreen(`<form class="stack" data-step="password" autocomplete="on">
      <h1>Connexion</h1>
      <p class="muted">${esc(message || "Identifiez-vous pour accéder aux scans et au plan de remédiation.")}</p>
      <label class="field"><span>Utilisateur</span><input class="input" name="username" autocomplete="username" required autofocus /></label>
      <label class="field"><span>Mot de passe</span><input class="input" name="password" type="password" autocomplete="current-password" required /></label>
      <div class="login-error hidden"></div>
      <button class="btn btn-primary">${icon("key")}Se connecter</button>
    </form>`);
  const card = el.querySelector(".login-card");
  const fail = (err) => {
    const box = card.querySelector(".login-error");
    box.textContent = err.message;
    box.classList.remove("hidden");
  };
  card.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const out = await login(f.username, f.password);
      if (!out?.mfa) return location.reload();
      // Second step: code from the authenticator app.
      card.querySelector("form").outerHTML = `<form class="stack" data-step="mfa">
          <h1>Double authentification</h1>
          <p class="muted">Saisissez le code à 6 chiffres de votre application d'authentification pour <b>${esc(f.username)}</b>.</p>
          <label class="field"><span>Code de vérification</span>
            <input class="input mono otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="11" placeholder="123 456" required style="font-size:20px;letter-spacing:.25em;text-align:center" /></label>
          <small class="faint">Téléphone perdu ? Saisissez un de vos codes de secours (format XXXXX-XXXXX).</small>
          <div class="login-error hidden"></div>
          <button class="btn btn-primary">${icon("check")}Vérifier</button>
        </form>`;
      const form = card.querySelector("form");
      form.code.focus();
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const done = await loginMfa(out.ticket, form.code.value);
          if (done.usedRecovery) sessionStorage.setItem("ovc.recovery", String(done.recoveryLeft));
          location.reload();
        } catch (err) {
          fail(err);
          form.code.select();
        }
      };
    } catch (err) {
      fail(err);
    }
  };
  card.querySelector("input").focus();
}

// Organisation requires 2FA and this account has none yet: enrol first.
function showMfaEnrolment(username) {
  const el = lockScreen(`<div class="stack"><h1>Activez la double authentification</h1>
      <p class="muted">Votre organisation l'exige pour tous les comptes. Cela ne prend qu'une minute.</p>
      <div data-enrol></div>
      <button class="btn btn-ghost" data-logout>${icon("x")}Se déconnecter</button></div>`);
  el.querySelector("[data-logout]").onclick = logout;
  mfaEnrol(el.querySelector("[data-enrol]"), { username, onDone: () => location.reload() });
}

const ROLE_NAMES = { admin: "Administrateur", analyste: "Analyste", lecteur: "Lecteur" };

function renderUser() {
  const me = currentUser();
  document.body.dataset.role = me.role;
  $("#user").innerHTML = `<span class="avatar-chip">${esc(me.username.slice(0, 2).toUpperCase())}</span><span class="user-meta"><b>${esc(me.username)}</b><small>${ROLE_NAMES[me.role] || me.role}</small></span>`;
  $("#openwarn").innerHTML =
    team.remote() && !me.authEnabled ? `<a class="chip chip-warn" href="#/admin" data-tip="Aucun compte n'existe : n'importe qui sur le réseau peut utiliser la console.&#10;Créez un administrateur.">${icon("alert")}Console ouverte</a>` : "";
  $("#user").onclick = () => {
    const d = drawer(
      `<h3>${esc(me.username)}</h3><div class="faint">${ROLE_NAMES[me.role] || me.role}${me.authEnabled ? "" : " · connexion désactivée"}</div>`,
      `${me.authEnabled ? `<section class="stack" id="mfa-box"><h4>Double authentification</h4>
          ${me.mfa
            ? `<div class="row"><span class="chip chip-ok">${icon("check")}Activée</span><span class="faint" style="font-size:12.5px">Un code est demandé à chaque connexion.</span></div>
               <form class="row" id="mfa-off"><input class="input mono" name="code" inputmode="numeric" placeholder="Code actuel" style="max-width:150px" required /><button class="btn btn-danger">Désactiver</button></form>`
            : `<p class="muted" style="margin:0">Protégez votre compte avec un code à usage unique généré par votre téléphone.</p>
               <button class="btn btn-primary" id="mfa-on" style="justify-self:start">${icon("key")}Activer la double authentification</button>`}
          <div id="mfa-enrol"></div></section>
        <form class="stack" id="pw"><h4>Changer mon mot de passe</h4>
          <label class="field"><span>Mot de passe actuel</span><input class="input" type="password" name="current" required autocomplete="current-password" /></label>
          <label class="field"><span>Nouveau mot de passe</span><input class="input" type="password" name="password" minlength="8" required autocomplete="new-password" /></label>
          <button class="btn">${icon("key")}Modifier</button></form>
        <button class="btn btn-danger" id="logout">${icon("x")}Se déconnecter</button>`
        : `<p class="muted">${team.remote() ? "La console est ouverte : aucun compte n'existe encore. Un administrateur peut en créer depuis la page Administration." : "Mode démo : pas de comptes."}</p>`}`,
    );
    const panel = d.host.querySelector(".drawer");
    panel.querySelector("#logout")?.addEventListener("click", logout);
    panel.querySelector("#mfa-on")?.addEventListener("click", (e) => {
      e.target.remove();
      mfaEnrol(panel.querySelector("#mfa-enrol"), { username: me.username, onDone: () => location.reload() });
    });
    panel.querySelector("#mfa-off")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await call("POST", "/console/me/mfa/disable", { code: e.target.code.value });
        toast("Double authentification désactivée");
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        toast("Désactivation impossible", err.message, "error");
      }
    });
    panel.querySelector("#pw")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await call("POST", "/console/me/password", Object.fromEntries(new FormData(e.target)));
        toast("Mot de passe modifié");
        d.close();
      } catch (err) {
        toast("Modification impossible", err.message, "error");
      }
    });
  };
}

function renderBell() {
  const events = team.events();
  const seen = Number(localStorage.getItem("ovc.seen") || 0);
  const fresh = events.filter((e) => Date.parse(e.at) > seen).length;
  $("#bell").innerHTML = `${icon("bell")}${fresh ? `<span class="badge">${fresh}</span>` : ""}`;
  $("#bell").onclick = () => {
    try {
      localStorage.setItem("ovc.seen", String(Date.now()));
    } catch {
      /* not persisted */
    }
    renderBell();
    drawer(
      `<h3>Activité de l'équipe</h3><div class="faint">Scans terminés, planifiés ou lancés</div>`,
      events.length
        ? `<div class="list">${events.map((e) => {
            const c = e.counts || {};
            return `<a class="list-item" style="padding:12px 0" href="#/scans/${encodeURIComponent(e.scan)}" data-close>
              <span class="avatar ${e.status === "succeeded" ? "" : "live"}">${icon(e.status === "succeeded" ? "check" : "alert")}</span>
              <span class="grow"><b>${esc(e.name)}</b><div class="faint" style="font-size:12.5px">${e.total ?? 0} vulnérabilité(s) · ${c.critical || 0} critique(s) · ${c.high || 0} élevée(s)</div>
              <small class="faint">${new Date(e.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</small></span></a>`;
          }).join("")}</div>`
        : `<p class="muted">${team.remote() ? "Aucune activité récente. Les fins de scan apparaîtront ici." : "Le fil d'activité est tenu par le serveur de la console."}</p>`,
    );
  };
}

// ---- Theme ------------------------------------------------------------------------

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme").innerHTML = icon(theme === "light" ? "moon" : "sun");
  try {
    localStorage.setItem("ovc.theme", theme);
  } catch {
    /* not persisted */
  }
}

// ---- Command palette ----------------------------------------------------------

async function openPalette() {
  const pages = NAV.filter((n) => n.path && (!n.role || can(n.role))).map((n) => ({ group: "Pages", label: n.label, icon: n.icon, go: n.path }));
  const actions = [
    { group: "Actions", label: "Lancer un nouveau scan", icon: "bolt", go: "new" },
    { group: "Actions", label: "Basculer le thème clair / sombre", icon: "sun", run: () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light") },
  ];
  let scanItems = [];
  try {
    scanItems = (await scanSummaries()).map((s) => ({ group: "Scans", label: s.name, hint: s.id.slice(0, 8), icon: "radar", go: `scans/${s.id}` }));
  } catch {
    /* palette still works without scans */
  }
  palette([...actions, ...pages, ...scanItems], (it) => (it.run ? it.run() : navigate(it.go)));
}

// ---- Boot --------------------------------------------------------------------------

async function boot() {
  const stored = document.documentElement.dataset.theme;
  applyTheme(stored || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  $("#theme").onclick = () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  $("#menu").innerHTML = icon("menu");
  $("#menu").onclick = () => document.body.classList.toggle("nav-open");
  $("#scrim").onclick = () => document.body.classList.remove("nav-open");
  $(".search-trigger .si").outerHTML = icon("search");
  $("#palette-open").onclick = openPalette;
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (!$("#overlay").children.length) openPalette();
    }
  });

  await detectMode();
  let signedIn = false;
  window.addEventListener("ovc:auth", () => showLogin(signedIn ? "Votre session a expiré : reconnectez-vous." : undefined));
  try {
    await loadTeam(api().mode);
  } catch (err) {
    if (err instanceof AuthError) return showLogin();
    throw err;
  }
  signedIn = true;
  if (currentUser().mfaRequired) return showMfaEnrolment(currentUser().username);
  const left = sessionStorage.getItem("ovc.recovery");
  if (left !== null) {
    sessionStorage.removeItem("ovc.recovery");
    toast("Code de secours utilisé", `Il vous en reste ${left}. Pensez à reconfigurer votre application si vous avez perdu votre téléphone.`, "info");
  }
  renderUser();
  renderBell();
  setInterval(async () => {
    if (await refreshTeam().catch(() => false)) {
      renderBell();
      window.dispatchEvent(new CustomEvent("ovc:team"));
    }
  }, 10000);
  window.addEventListener("hashchange", render);
  render();
  refreshStatus();
  setInterval(refreshStatus, 30000);
  watchScans();
  setInterval(watchScans, 10000);
  // Chart columns link to their scan.
  document.addEventListener("click", (e) => {
    const link = e.target.closest?.(".hit[data-href]");
    if (link) location.hash = link.dataset.href;
  });
}

boot();

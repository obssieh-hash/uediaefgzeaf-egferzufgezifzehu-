// Coquille de l'application : barre latérale, barre supérieure, routeur.
import { api } from "./api.js";
import { $, $$, esc, icon, ago, toast } from "./ui.js";

export const BRAND = { name: "OpenVAS", sub: "Gestion des vulnérabilités" };

const NAV = [
  ["Supervision", [
    ["#/", "dashboard", "Tableau de bord", "dashboard"],
    ["#/scans", "radar", "Scans", "scans"],
    ["#/new", "plus", "Nouveau scan", "new"],
    ["#/schedules", "refresh", "Scans planifiés", "schedules"],
    ["#/web", "web", "Sites web", "web"],
    ["#/containers", "box", "Images Docker", "containers"],
    ["#/network", "globe", "Toile de balayage", "network"],
  ]],
  ["Analyse", [
    ["#/remediation", "check", "Remédiation", "remediation"],
    ["#/assets", "monitor", "Actifs", "assets"],
    ["#/reports", "chart", "Rapports", "reports"],
    ["#/compare", "compare", "Comparer", "compare"],
    ["#/compliance", "shield", "Conformité", "compliance"],
  ]],
  ["Connaissances", [
    ["#/vts", "shield", "Tests de vulnérabilité", "vts"],
    ["#/notus", "package", "Analyse de paquets", "notus"],
  ]],
  ["Système", [
    ["#/admin", "key", "Administration", "admin"],
  ]],
];

const ROUTES = [
  [/^\/$/, "dashboard", "Tableau de bord"],
  [/^\/scans$/, "scans", "Scans"],
  [/^\/scans\/([^/]+)$/, "scan", null],
  [/^\/new$/, "newscan", "Nouveau scan"],
  [/^\/schedules$/, "schedules", "Scans planifiés"],
  [/^\/web$/, "web", "Sites web"],
  [/^\/containers$/, "containers", "Images Docker"],
  [/^\/network$/, "network", "Toile de balayage"],
  [/^\/remediation$/, "remediation", "Remédiation"],
  [/^\/assets$/, "assets", "Actifs"],
  [/^\/reports$/, "reports", "Rapports"],
  [/^\/compare$/, "compare", "Comparer"],
  [/^\/compliance$/, "compliance", "Conformité"],
  [/^\/vts$/, "vts", "Tests de vulnérabilité"],
  [/^\/notus$/, "notus", "Analyse de paquets"],
  [/^\/admin$/, "admin", "Administration"],
];

export const store = { info: null, scans: [], me: { user: "admin", role: "admin", auth: false } };

// ---------------------------------------------------------------------------
// Barre latérale
// ---------------------------------------------------------------------------
function renderSidebar() {
  $("#sidebar").innerHTML = `
    <a class="brand" href="#/">
      <img class="brand-logo" src="img/logo.svg" alt="">
      <div><div class="brand-name">${esc(BRAND.name)}<sup>®</sup></div><div class="brand-sub">${esc(BRAND.sub)}</div></div>
    </a>
    <nav class="nav">
      ${NAV.map(([title, items]) => `<div class="nav-section">${title}</div>` + items.map(([href, ic, label, key]) =>
        `<a href="${href}" data-key="${key}" ${["new", "schedules", "containers", "web"].includes(key) ? "data-write" : ""}>${icon(ic)}<span>${label}</span>${key === "scans" ? '<span class="count" id="nav-scans" hidden></span>' : ""}</a>`).join("")).join("")}
    </nav>
    <div class="engine" id="engine"></div>`;
}

function renderEngine() {
  const i = store.info;
  const el = $("#engine");
  if (!el) return;
  if (!i) { el.innerHTML = `<div class="engine-row"><b><span class="dot"></span>openvasd</b><span class="tag">…</span></div>`; return; }
  const ready = i.connected;
  el.innerHTML = `
    <div class="engine-row"><b><span class="dot ${ready ? "on" : "off"}"></span>openvasd</b><span class="tag">${ready ? (i.demo ? "Démo" : "Prêt") : "Hors ligne"}</span></div>
    <div class="engine-row"><span>Feed</span><span class="mono" title="${esc(i.feed_version)}">${esc(i.feed_version || "—")}</span></div>
    <div class="engine-row"><span>API</span><span class="mono">v${esc(i.api_version || "1")}</span></div>`;
  const active = store.scans.filter((s) => ["running", "requested"].includes(s.status?.status)).length;
  const badge = $("#nav-scans");
  if (badge) { badge.hidden = !store.scans.length; badge.textContent = active || store.scans.length; }
}

function setActiveNav(key) {
  const map = { scan: "scans" };
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.key === (map[key] || key)));
}

// ---------------------------------------------------------------------------
// Barre supérieure
// ---------------------------------------------------------------------------
function renderTopbar() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#topbar").innerHTML = `
    <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">${icon("menu")}</button>
    <div class="crumbs" id="crumbs"></div>
    <div class="top-actions">
      <label class="search" id="search-open">${icon("search")}<input placeholder="Rechercher un scan, une page…" readonly><span class="kbd">Ctrl K</span></label>
      <div style="position:relative">
        <button class="icon-btn" id="notif-btn" aria-label="Notifications">${icon("bell")}<span class="badge-dot" id="notif-count" hidden></span></button>
        <div class="popover" id="notif-pop" hidden></div>
      </div>
      <button class="icon-btn" id="theme-btn" aria-label="Thème">${icon(dark ? "sun" : "moon")}</button>
      <div class="user"><span class="avatar">${esc(store.me.user.slice(0, 2).toUpperCase())}</span><div><b>${esc(store.me.user)}</b><span>${store.me.role === "admin" ? "Administrateur" : "Lecture seule"}</span></div></div>
      ${store.me.auth ? `<button class="icon-btn" id="logout-btn" aria-label="Se déconnecter" title="Se déconnecter">${icon("logout")}</button>` : ""}
    </div>`;
  $("#menu-btn").onclick = () => $("#sidebar").classList.toggle("open");
  $("#theme-btn").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ov-theme", next); } catch { /* stockage indisponible */ }
    renderTopbar(); setCrumbs(currentCrumbs);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  $("#search-open").onclick = openPalette;
  $("#logout-btn")?.addEventListener("click", async () => {
    await api.post("/logout").catch(() => {});
    location.href = "/login.html";
  });
  $("#notif-btn").onclick = toggleNotifications;
  updateNotifCount();
}

let currentCrumbs = [];
export function setCrumbs(items) {
  currentCrumbs = items;
  const el = $("#crumbs");
  if (!el) return;
  el.innerHTML = items.map((c, i) => i === items.length - 1
    ? `<b>${esc(c[0])}</b>`
    : `<a href="${c[1]}" style="color:inherit">${esc(c[0])}</a>${icon("chevRight")}`).join("");
}

function updateNotifCount() {
  const el = $("#notif-count");
  if (!el || !store.info) return;
  el.hidden = !store.info.unread;
  el.textContent = store.info.unread;
}

async function toggleNotifications(e) {
  e.stopPropagation();
  const pop = $("#notif-pop");
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.hidden = false;
  pop.innerHTML = `<div class="card-h"><h3>Notifications</h3></div><div class="loading"><div class="spinner"></div></div>`;
  const list = await api.post("/notifications").catch(() => []);
  const ic = { critical: ["alert", "ico-crit"], error: ["alert", "ico-crit"], warning: ["alert", "ico-warn"], info: ["info", "ico-info"] };
  pop.innerHTML = `<div class="card-h"><h3>Notifications</h3><span class="hint">${list.length}</span></div>` +
    (list.length ? list.slice(0, 8).map((n) => `<a class="item" href="${esc(n.link || "#/")}">
      <span class="kpi-ico ${ic[n.level]?.[1] || "ico-info"}">${icon(ic[n.level]?.[0] || "info")}</span>
      <span>${esc(n.title)}<small>${ago(n.time)}</small></span></a>`).join("")
      : `<div class="empty">Aucune notification</div>`);
  if (store.info) { store.info.unread = 0; updateNotifCount(); }
  const close = (ev) => { if (!pop.contains(ev.target)) { pop.hidden = true; document.removeEventListener("click", close); } };
  document.addEventListener("click", close);
}

// ---------------------------------------------------------------------------
// Palette de commandes (Ctrl K)
// ---------------------------------------------------------------------------
function openPalette() {
  if ($(".palette")) return;
  const pages = NAV.flatMap(([, items]) => items.map(([href, ic, label]) => ({ href, ic, label, hint: "Page" })));
  const scans = store.scans.map((s) => ({ href: `#/scans/${s.id}`, ic: "radar", label: s.name, hint: (s.targets || []).join(", ") }));
  const el = document.createElement("div");
  el.className = "palette";
  el.innerHTML = `<div class="palette-box"><input placeholder="Rechercher un scan, une page, un hôte…" autofocus><div class="palette-list"></div></div>`;
  document.body.append(el);
  const input = $("input", el), list = $(".palette-list", el);
  let sel = 0, items = [];
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    items = [...pages, ...scans].filter((i) => !q || i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)).slice(0, 12);
    if (/^[\d.:/a-f-]+$/i.test(q) && q.length > 2) items.push({ href: `#/vts?q=${encodeURIComponent(q)}`, ic: "search", label: `Rechercher « ${q} » dans les VTs`, hint: "" });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.map((i, n) => `<a href="${i.href}" class="${n === sel ? "sel" : ""}">${icon(i.ic)}${esc(i.label)}<small>${esc(i.hint)}</small></a>`).join("") || `<div class="empty">Aucun résultat</div>`;
  };
  const close = () => el.remove();
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === "Enter" && items[sel]) { location.hash = items[sel].href.slice(1); close(); }
    if (e.key === "Escape") close();
  };
  el.onclick = (e) => { if (e.target === el || e.target.closest("a")) close(); };
  draw();
  input.focus();
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
});

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------
let cleanup = [];
let navToken = 0;

export function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  return { path, query: new URLSearchParams(qs || "") };
}

async function route() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  const token = ++navToken;
  const { path, query } = parseHash();
  const match = ROUTES.map(([re, mod, title]) => [path.match(re), mod, title]).find(([m]) => m);
  const view = $("#view");
  $("#sidebar").classList.remove("open");
  $$(".modal-bg, .palette").forEach((el) => el.remove());
  if (!match) { view.innerHTML = `<div class="empty"><b>Page introuvable</b><a href="#/">Retour au tableau de bord</a></div>`; return; }
  const [m, mod, title] = match;
  setActiveNav(mod);
  if (title) setCrumbs([[title]]);
  view.className = "view";
  view.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const ctx = {
    query,
    alive: () => token === navToken,
    every(fn, ms) { const id = setInterval(() => token === navToken && fn(), ms); cleanup.push(() => clearInterval(id)); },
    onLeave(fn) { cleanup.push(fn); },
  };
  try {
    const page = await import(`./pages/${mod}.js`);
    if (token !== navToken) return;
    await page.render(view, m.slice(1), ctx);
  } catch (err) {
    if (token !== navToken) return;
    console.error(err);
    view.innerHTML = `<div class="card"><div class="empty">${icon("alert")}<b>Impossible d'afficher la page</b>${esc(err.message)}</div></div>`;
  }
  window.scrollTo(0, 0);
}

export async function refreshInfo() {
  try {
    const [info, scans] = await Promise.all([api.get("/info"), api.get("/scans")]);
    store.info = info; store.scans = scans;
  } catch (e) {
    store.info = { connected: false };
  }
  renderEngine();
  updateNotifCount();
}

try {
  store.me = await api.get("/me");
} catch {
  // api.get redirige déjà vers la page de connexion si nécessaire
}
document.body.classList.toggle("readonly", store.me.role !== "admin");
renderSidebar();
renderTopbar();
renderEngine();
window.addEventListener("hashchange", route);
refreshInfo().then(() => {
  if (store.info && !store.info.connected) toast("openvasd est injoignable : vérifiez l'URL et la clé API", "err");
});
setInterval(refreshInfo, 15000);
route();

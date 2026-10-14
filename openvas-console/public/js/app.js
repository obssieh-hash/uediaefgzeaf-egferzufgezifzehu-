// Application shell: navigation, routing, theme, connection status and the
// Ctrl+K command palette. Each view lives in ./views and returns a cleanup
// function so polling stops when the user navigates away.

import { api, detectMode, labels, settings } from "./api.js";
import { scanSummaries } from "./store.js";
import { $, esc, icon, shortFeed } from "./util.js";
import { palette, toast } from "./ui.js";

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

const NAV = [
  { group: "Supervision" },
  { path: "dashboard", label: "Tableau de bord", icon: "dashboard" },
  { path: "scans", label: "Scans", icon: "radar", count: true },
  { path: "new", label: "Nouveau scan", icon: "plus" },
  { group: "Analyse" },
  { path: "assets", label: "Actifs", icon: "host" },
  { path: "reports", label: "Rapports", icon: "chart" },
  { path: "compare", label: "Comparer", icon: "diff" },
  { group: "Connaissances" },
  { path: "vts", label: "Tests de vulnérabilité", icon: "shield" },
  { path: "notus", label: "Analyse de paquets", icon: "package" },
  { group: "Système" },
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
};

let cleanup = null;
let renderId = 0;

function parseHash() {
  const [name = "dashboard", ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  if (name === "scans" && rest[0]) return { name: "scan", param: decodeURIComponent(rest[0]) };
  return { name: ROUTES[name] ? name : "dashboard", param: rest[0] };
}

export function navigate(path) {
  location.hash = `#/${path}`;
}

export function setCrumb(label) {
  const last = $("#crumbs b");
  if (last) last.textContent = label;
}

function renderNav(active) {
  $("#nav").innerHTML = NAV.map((n) =>
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
  document.title = `${route.title} · OpenVAS Console`;
  const root = $("#view");
  root.innerHTML = "";
  root.onclick = root.oninput = root.onchange = null;
  root.style.animation = "none";
  void root.offsetWidth;
  root.style.animation = "";
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
          const n = new Notification(`OpenVAS — scan ${DONE[st]}`, { body: name, icon: "favicon.svg", tag: id });
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
  const pages = NAV.filter((n) => n.path).map((n) => ({ group: "Pages", label: n.label, icon: n.icon, go: n.path }));
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

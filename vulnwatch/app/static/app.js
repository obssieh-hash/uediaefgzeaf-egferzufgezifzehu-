/* CERT-ANSIE — interface web (vanilla JS, aucune dépendance externe) */
(() => {
  "use strict";

  // ------------------------------------------------------------------ utilitaires
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (s, withTime = false) => {
    if (!s) return "—";
    const d = new Date(s.length === 10 ? s + "T00:00:00Z" : s);
    if (isNaN(d)) return esc(s);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) +
      (withTime ? " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
  };
  const ago = (s) => {
    if (!s) return "jamais";
    const diff = (Date.now() - new Date(s).getTime()) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    return `il y a ${Math.floor(diff / 86400)} j`;
  };
  const nf = (n) => (n ?? 0).toLocaleString("fr-FR");
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const ICONS = {
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.4-7 9.5-4-1.1-7-5-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
    dash: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    bug: '<path d="M8 8a4 4 0 118 0v1H8z"/><rect x="6" y="9" width="12" height="11" rx="6"/><path d="M12 13v7M3 13h3M18 13h3M4 7l2.5 2M20 7l-2.5 2M4 20l2.5-2.5M20 20l-2.5-2.5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    news: '<path d="M4 5h13v14H6a2 2 0 01-2-2z"/><path d="M17 9h3v8a2 2 0 01-2 2h-1M8 9h5M8 13h5M8 17h3"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    refresh: '<path d="M20 11a8 8 0 00-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.9L20 16M20 20v-4h-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
    logout: '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
    fire: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 004 0"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    report: '<path d="M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/>',
    print: '<path d="M7 9V3h10v6M7 18H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6"/>',
    audit: '<path d="M9 4h6M9 4a2 2 0 00-2 2v0H5v15h14V6h-2a2 2 0 00-2-2M9 4a2 2 0 012-2h2a2 2 0 012 2"/><path d="M9 12l2 2 4-4M9 17h6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    patch: '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 10h.01M14 14h.01M10 14h.01M14 10h.01"/>',
    word: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M8.5 11l1.2 5 1.3-4 1.3 4 1.2-5"/>',
    slides: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8M7 8h6M7 11h10"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 17v-4h1.5a1.5 1.5 0 010 3H9"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
    code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  };
  const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>`;

  const SEV_FR = { CRITICAL: "Critique", HIGH: "Haute", MEDIUM: "Moyenne", LOW: "Basse", NONE: "Aucune" };
  const SEV_COLOR = { CRITICAL: "var(--crit)", HIGH: "var(--high)", MEDIUM: "var(--med)", LOW: "var(--low)", NONE: "var(--none)" };
  const STATUS = { new: "Nouveau", analysis: "En analyse", action: "Action requise", done: "Traité", na: "Non applicable" };
  const PRIO_FR = { 1: "Critique — traiter immédiatement", 2: "Haute — sous 7 jours", 3: "Moyenne — sous 30 jours", 4: "Basse — cycle normal" };

  const sevBadge = (s) => s ? `<span class="badge sev-${esc(s)}">${esc(SEV_FR[s] || s)}</span>` : '<span class="badge sev-NONE">N/A</span>';
  const prioBadge = (p) => `<span class="prio prio-${p}" title="${esc(PRIO_FR[p])}">P${p}</span>`;
  const kevBadge = (v) => v.kev ? `<span class="badge kev" title="Exploitée activement (CISA KEV)">${icon("fire")} KEV</span>` : "";
  const statusBadge = (s) => `<span class="badge st-${esc(s || "new")}">${esc(STATUS[s] || STATUS.new)}</span>`;
  const scoreCell = (v) => {
    if (v.cvss_score == null) return `<span class="badge na-badge" title="Non évaluée : aucun score CVSS publié pour l'instant. Le NVD a un fort retard d'analyse ; le score sera complété automatiquement (NVD, éditeur ou CISA) dès sa publication. En attendant, la priorité tient compte de l'exploitation (KEV) et de l'EPSS.">Non évaluée</span>`;
    const c = SEV_COLOR[v.severity] || "var(--none)";
    return `<span class="score">${v.cvss_score.toFixed(1)}<span class="meter"><i style="width:${v.cvss_score * 10}%;background:${c}"></i></span></span>`;
  };
  const epssCell = (v) => v.epss == null ? `<span class="badge na-badge" title="Pas encore de score EPSS : CVE très récente (score calculé sous 24-48 h) ou synchronisation EPSS en cours.">En attente</span>` :
    `<span class="mono" title="Percentile ${(v.epss_percentile * 100).toFixed(0)}">${(v.epss * 100).toFixed(v.epss < 0.01 ? 2 : 1)} %</span>`;

  const tlpClass = (t) => { const m = /TLP\s*:?\s*(RED|AMBER\+STRICT|AMBER|GREEN|CLEAR|WHITE)/i.exec(t || ""); return m ? "tlp-" + m[1].toLowerCase().replace("+strict", "").replace("white", "clear") : "tlp-none"; };
  const classifBar = () => ME?.classification ? `<div class="classif ${tlpClass(ME.classification)}">${icon("lock")}<span>${esc(ME.classification)}</span></div>` : "";

  function toast(msg, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  async function api(path, opts = {}) {
    const o = { credentials: "same-origin", ...opts, headers: { "X-Requested-With": "CERT-ANSIE", ...(opts.headers || {}) } };
    if (o.body && typeof o.body !== "string") { o.body = JSON.stringify(o.body); o.headers["Content-Type"] = "application/json"; }
    const r = await fetch(path, o);
    if (r.status === 401 && path !== "/api/login") { showLogin(); throw new Error("Session expirée"); }
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
    if (r.status === 403 && typeof data?.detail === "string" && data.detail.includes("changer votre mot de passe")) { showForceChange(); throw new Error("Session expirée"); }
    if (!r.ok) {
      const d = data?.detail;
      throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : `Erreur ${r.status}`);
    }
    return data;
  }

  // ------------------------------------------------------------------ droits & identité
  const can = (p) => !!ME?.user?.perms?.includes(p);
  const initials = (n) => String(n || "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
  const avatar = (n, cls = "") => `<span class="avatar ${cls}">${esc(initials(n))}</span>`;
  const roleBadge = (role, label) => `<span class="badge role role-${esc(role)}">${esc(label || ME?.roles?.[role] || role)}</span>`;
  const DUE_DAYS = { 1: 2, 2: 7, 3: 30, 4: 90 };
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const statusCell = (v) => `${statusBadge(v.status)}${v.checklist_progress ? `<div class="assignee" title="Actions de remédiation réalisées">${icon("check")}${v.checklist_progress.done}/${v.checklist_progress.total} actions</div>` : ""}${v.assignee_name ? `<div class="assignee">${icon("user")}${esc(v.assignee_name)}</div>` : ""}${v.due_date && !["done", "na"].includes(v.status) ? `<div class="due ${v.overdue ? "late" : ""}">${icon("clock")}${v.overdue ? "En retard · " : ""}${fmtDate(v.due_date)}</div>` : ""}`;
  const pwChecks = (pw, user = "") => [
    [pw.length >= 12, "12 caractères minimum"],
    [[/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length >= 3, "3 types parmi : minuscules, majuscules, chiffres, symboles"],
    [!(user && user.length >= 3 && pw.toLowerCase().includes(user.toLowerCase())), "ne contient pas l'identifiant"],
  ];
  const pwMeter = (pw, user) => {
    const checks = pwChecks(pw, user);
    const score = checks.filter((c) => c[0]).length + (pw.length >= 16 ? 1 : 0);
    const lvl = !pw ? 0 : score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4;
    return `<div class="pw-meter lvl-${lvl}"><i></i><i></i><i></i><i></i></div>
      <ul class="pw-checks">${checks.map(([ok, l]) => `<li class="${ok ? "ok" : ""}">${ok ? "✓" : "•"} ${l}</li>`).join("")}</ul>`;
  };
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast("Copié dans le presse-papiers", "ok"); }
    catch { toast("Copie impossible : sélectionnez le texte manuellement", "err"); }
  }

  // ------------------------------------------------------------------ thème
  const getTheme = () => { try { return localStorage.getItem("vw-theme") || "dark"; } catch { return "dark"; } };
  const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem("vw-theme", t); } catch {} };
  setTheme(getTheme());

  // ------------------------------------------------------------------ session
  let ME = null;

  function showLogin(err = "") {
    const app = ME?.app || "CERT-ANSIE";
    $("#root").innerHTML = `
      <div class="login-split">
        <section class="login-hero" aria-hidden="true">
          <img src="/static/login-banner.jpg" alt="">
        </section>
        <section class="login-side">
          <div class="login-box">
            <div class="brand"><div class="brand-logo">${icon("shield")}</div>
              <div><div class="brand-name">${esc(app)}</div><div class="brand-org">${esc(ME?.org || "ANSIE · Djibouti")}</div></div></div>
            <div class="login-kicker">Plateforme de veille des vulnérabilités</div>
            <h1>Connexion</h1>
            <p class="muted" style="margin:6px 0 22px">Espace réservé à l'équipe SSI de l'ANSIE. Identifiez-vous pour accéder au tableau de bord.</p>
            <form id="login-form" autocomplete="on">
              <div class="field-icon"><label for="lu">Utilisateur</label>${icon("user")}<input id="lu" name="username" autocomplete="username" required autofocus></div>
              <div class="field-icon"><label for="lp">Mot de passe</label>${icon("lock")}<input id="lp" name="password" type="password" autocomplete="current-password" required></div>
              <div class="error" id="login-err">${esc(err)}</div>
              <button class="btn primary lg" type="submit">Se connecter</button>
            </form>
            <div class="login-foot">
              ${ME?.classification ? `<span class="tlp-chip ${tlpClass(ME.classification)}">${esc(ME.classification)}</span>` : ""}
              <span>Accès réservé et journalisé · Toute tentative d'accès non autorisé est enregistrée.</span>
            </div>
          </div>
        </section>
      </div>`;
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api("/api/login", { method: "POST", body: { username: f.get("username"), password: f.get("password") } });
        await boot();
      } catch (er) { $("#login-err").textContent = er.message; }
    });
  }

  // ------------------------------------------------------------------ layout
  const NAV = [
    ["dashboard", "Tableau de bord", "dash"],
    ["vulns", "Vulnérabilités", "bug"],
    ["watch", "Périmètre surveillé", "eye"],
    ["bulletins", "Bulletins CERT", "news"],
    ["patches", "Correctifs", "patch"],
    ["report", "Rapport de veille", "report"],
    ["sources", "Sources & API", "db"],
  ];

  function renderLayout() {
    $("#root").innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="brand"><div class="brand-logo">${icon("shield")}</div>
            <div><div class="brand-name">${esc(ME.app)}</div><div class="brand-org">${esc(ME.org)}</div></div></div>
          <div class="nav-label">Veille</div>
          <nav class="nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${icon(i)}<span>${l}</span>${k === "dashboard" ? '<span class="count hidden" id="nav-p1"></span>' : ""}</a>`).join("")}</nav>
          ${can("users.manage") ? `<div class="nav-label">Administration</div><nav class="nav">
            <a href="#/users" data-nav="users">${icon("users")}<span>Utilisateurs & rôles</span></a>
            <a href="#/audit" data-nav="audit">${icon("audit")}<span>Journal d'audit</span></a></nav>` : ""}
          <div class="sidebar-foot">
            <div class="sync-pill" id="sync-pill"><span class="dot"></span><span>…</span></div>
            <a class="user-card" href="#/account" data-nav="account" title="Mon compte">
              ${avatar(ME.user.full_name)}<div style="min-width:0"><div class="uc-name">${esc(ME.user.full_name)}</div><div class="uc-role">${esc(ME.user.role_label)}</div></div></a>
            <div style="display:flex;gap:6px">
              <button class="btn ghost sm" data-action="theme" title="Thème clair / sombre">${icon(getTheme() === "dark" ? "sun" : "moon")}</button>
              <button class="btn ghost sm" data-action="logout" title="Déconnexion">${icon("logout")} Déconnexion</button>
            </div>
            <div class="faint" style="font-size:11px">${esc(ME.app)} v${esc(ME.version || "")}</div>
          </div>
        </aside>
        <main class="main">
          ${classifBar()}
          <div class="topbar">
            <form class="search" id="gsearch">${icon("search")}<input id="gq" placeholder="Rechercher une CVE, un produit (php, openssh…), un mot-clé…" autocomplete="off"></form>
            <div style="margin-left:auto;display:flex;gap:8px">
              ${can("sync") ? `<button class="btn sm" data-action="sync">${icon("refresh")}<span class="hide-sm">Synchroniser</span></button>` : ""}
            </div>
          </div>
          <div class="content" id="content"></div>
        </main>
      </div>`;
    $("#gsearch").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#gq").value.trim();
      if (/^(CVE-\d{4}-\d+|GHSA-[\w-]+)$/i.test(q)) { openVuln(q.toUpperCase().startsWith("CVE") ? q.toUpperCase() : q); return; }
      location.hash = `#/vulns?scope=all&q=${encodeURIComponent(q)}`;
    });
  }

  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-action]");
    if (!a) return;
    const act = a.dataset.action;
    if (act === "theme") { setTheme(getTheme() === "dark" ? "light" : "dark"); a.innerHTML = icon(getTheme() === "dark" ? "sun" : "moon"); }
    else if (act === "logout") { await api("/api/logout", { method: "POST" }); ME.authenticated = false; ME.user = null; showLogin(); }
    else if (act === "sync") { triggerSync(); }
    else if (act === "close-drawer") { closeDrawer(); }
    else if (act === "close-modal") { closeModal(); }
  });

  async function triggerSync() {
    try {
      const r = await api("/api/sync", { method: "POST" });
      toast(r.started ? "Synchronisation lancée — les données se mettent à jour en arrière-plan" : r.info, r.started ? "ok" : "");
      pollStatus(true);
    } catch (e) { toast(e.message, "err"); }
  }

  let statusTimer = null, wasRunning = false;
  async function pollStatus(force = false) {
    clearTimeout(statusTimer);
    try {
      const s = await api("/api/health");
      const st = s.sync;
      const pill = $("#sync-pill");
      if (pill) {
        pill.innerHTML = st.running
          ? `<span class="dot run"></span><span>Synchro : ${esc(st.current || "…")}</span>`
          : `<span class="dot"></span><span>Synchro ${esc(ago(s.last_sync))}</span>`;
      }
      if (wasRunning && !st.running) { toast("Synchronisation terminée", "ok"); route(); }
      else if (st.running && parseHash().page === "dashboard" && !$("#drawer") && !$("#modal")) route();
      wasRunning = st.running;
      statusTimer = setTimeout(pollStatus, st.running || force ? 4000 : 60000);
    } catch { statusTimer = setTimeout(pollStatus, 60000); }
  }

  // ------------------------------------------------------------------ routeur
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, qs] = h.split("?");
    const params = Object.fromEntries(new URLSearchParams(qs || ""));
    const parts = path.split("/").filter(Boolean);
    return { page: parts[0] || "dashboard", arg: parts.slice(1).join("/"), params };
  }

  async function route() {
    if (!ME?.authenticated) return;
    const { page, arg, params } = parseHash();
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (page === "vuln" ? "vulns" : page)));
    const c = $("#content");
    if (!c) return;
    c.onclick = null;
    try {
      if (page === "vuln") { if (!$("#vtable")) await pageVulns(c, {}); openVuln(decodeURIComponent(arg), false); return; }
      const pages = { dashboard: pageDashboard, vulns: pageVulns, watch: pageWatch, bulletins: pageBulletins, sources: pageSources,
        report: pageReport, account: pageAccount, users: pageUsers, audit: pageAudit, patches: pagePatches };
      await (pages[page] || pageDashboard)(c, params);
    } catch (e) {
      if (e.message !== "Session expirée") c.innerHTML = `<div class="card empty">${icon("alert")}<div>${esc(e.message)}</div></div>`;
    }
  }
  window.addEventListener("hashchange", route);

  // ------------------------------------------------------------------ tableau de bord
  async function pageDashboard(c) {
    c.innerHTML = `<div class="page-head"><div><h1>Tableau de bord</h1><p>Vue d'ensemble de la menace sur votre périmètre</p></div></div>
      <div class="grid kpis">${'<div class="card kpi"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="height:28px;margin-top:12px;width:40%"></div></div>'.repeat(5)}</div>`;
    const d = await api("/api/stats");
    const k = d.kpi;
    const p1 = $("#nav-p1");
    if (p1) { p1.textContent = k.scope_p1; p1.classList.toggle("hidden", !k.scope_p1); }

    const kpi = (label, value, sub, color, href, ic) => `
      <a class="card kpi" href="${href}" style="--kpi-color:${color};color:inherit;text-decoration:none">
        <span class="bar"></span><div class="label">${icon(ic)}${label}</div>
        <div class="value">${nf(value)}</div><div class="sub">${sub}</div></a>`;

    const days = Object.keys(d.timeline);
    const totals = days.map((x) => Object.values(d.timeline[x]).reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...totals);
    const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"];
    const chart = days.map((day, i) => {
      const t = d.timeline[day];
      const segs = order.map((s) => t[s] ? `<i style="height:${(t[s] / max) * 160}px;background:${SEV_COLOR[s]}"></i>` : "").join("");
      const tip = `${fmtDate(day)} — ${totals[i]} CVE\n` + order.filter((s) => t[s]).map((s) => `${SEV_FR[s]} : ${t[s]}`).join("\n");
      const lbl = new Date(day + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
      return `<div class="col" title="${esc(tip)}"><span class="faint" style="font-size:10.5px">${totals[i] || ""}</span><div class="stack">${segs}</div><span class="lbl">${lbl}</span></div>`;
    }).join("");

    const vulnLine = (v) => `
      <div class="list-item" data-vuln="${esc(v.id)}">
        <div>${prioBadge(v.priority)}</div>
        <div style="min-width:0;flex:1">
          <div class="li-title"><span class="vid">${esc(v.id)}</span> ${v.title ? `<span class="muted">· ${esc(v.title)}</span>` : ""}</div>
          <div class="vdesc">${esc(v.description)}</div>
          <div class="li-meta">${sevBadge(v.severity)} ${kevBadge(v)} ${v.watches.map((w) => `<span class="badge tag accent">${esc(w)}</span>`).join("")}
            <span>CVSS ${v.cvss_score ?? "—"}</span><span>EPSS ${v.epss != null ? (v.epss * 100).toFixed(1) + " %" : "—"}</span><span>${fmtDate(v.published)}</span></div>
        </div>
      </div>`;

    c.innerHTML = `
      <div class="page-head"><div><h1>Tableau de bord</h1><p>Vue d'ensemble de la menace sur votre périmètre · dernière synchro ${esc(ago(d.last_sync))}</p></div>
        <a class="btn" href="/api/export.csv?scope=watch&days=30">${icon("download")} Export 30 j (CSV)</a></div>
      ${!d.first_sync_done ? `<div class="card" style="padding:14px 18px;margin-bottom:16px;border-color:var(--accent)">
        <b>${icon("refresh", d.sync.running ? "spin" : "")} Première synchronisation ${d.sync.running ? `en cours (étape : ${esc(d.sync.current || "…")})` : "pas encore terminée"}.</b>
        <span class="muted">Les données arrivent progressivement (KEV et bulletins en premier, puis NVD : 10 à 40 min sans clé NVD). La page se met à jour toute seule.</span></div>` : ""}
      ${d.errors.length ? `<div class="alert-kev" style="margin-bottom:16px"><b>${icon("alert")} ${d.errors.length} source(s) en erreur</b> — vérifiez l'accès Internet / proxy de la VM (commande <code>sudo vulnwatch-diag</code>).
        ${d.errors.map((e) => `<div class="muted" style="font-size:12.5px;margin-top:4px"><b>${esc(e.source)}</b> : ${esc(e.message)}</div>`).join("")}
        <div style="margin-top:6px"><a href="#/sources">Voir les sources →</a></div></div>` : ""}
      <div class="grid kpis">
        ${kpi("P1 à traiter", k.scope_p1, "Périmètre · KEV ou critique exploitable", "var(--crit)", "#/vulns?priority=1&status=new,analysis,action", "alert")}
        ${kpi("À qualifier", k.to_triage, "P1/P2 au statut « Nouveau »", "var(--high)", "#/vulns?priority=1,2&status=new", "bell")}
        ${kpi("Périmètre — 7 jours", k.scope_7d, `${nf(k.scope_total)} au total sur le périmètre`, "var(--accent)", "#/vulns?days=7", "eye")}
        ${kpi("Exploitées (KEV) — 30 j", k.kev_30d, `${nf(k.kev_total)} dans le catalogue CISA`, "#e5484d", "#/vulns?scope=all&kev=1&sort=kev", "fire")}
        ${kpi("Nouvelles CVE — 24 h", k.new_24h, `${nf(k.critical_7d)} critiques sur 7 j · ${nf(k.total)} en base`, "var(--accent-2)", "#/vulns?scope=all&days=1", "clock")}
        ${kpi("Mes actions", k.my_open, k.my_overdue ? `<span style="color:var(--crit)">${nf(k.my_overdue)} en retard</span>` : (can("assign") ? `${nf(k.overdue_total)} en retard (équipe)` : "Actions de remédiation assignées"), "#8b5cf6", "#/vulns?assignee=me&status=new,analysis,action", "user")}
      </div>
      ${d.my_tasks.length ? `<div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>${icon("user")} Mes actions de remédiation</h2><a class="btn ghost sm" href="#/vulns?assignee=me">Tout voir</a></div>
        <div class="table-wrap"><table><thead><tr><th>Prio.</th><th>Identifiant</th><th>Description</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>
        ${d.my_tasks.map((v) => `<tr data-vuln="${esc(v.id)}"><td>${prioBadge(v.priority)}</td><td><div class="vid">${esc(v.id)}</div>${kevBadge(v)}</td>
          <td><div class="vdesc">${v.title ? `<b>${esc(v.title)}</b> — ` : ""}${esc(v.description)}</div></td>
          <td class="nowrap"><span class="due ${v.overdue ? "late" : ""}">${v.due_date ? fmtDate(v.due_date) : "—"}</span></td><td>${statusBadge(v.status)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      <div class="grid cols-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2>Publications CVE — 14 derniers jours</h2>
            <div class="legend">${order.slice(0, 4).map((s) => `<span><i style="background:${SEV_COLOR[s]}"></i>${SEV_FR[s]}</span>`).join("")}</div></div>
          <div class="card-body"><div class="chart">${chart}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Périmètre surveillé</h2><a class="btn ghost sm" href="#/watch">${can("watch.edit") ? "Gérer" : "Voir"}</a></div>
          <div class="card-body">
            <div class="watch-row faint" style="cursor:default;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;padding-top:0">
              <span>Produit</span><span class="num">30 j</span><span class="num">P1</span><span class="num">Total</span></div>
            ${d.watches.map((w) => `
              <a class="watch-row" href="#/vulns?watch=${w.id}" style="color:inherit;text-decoration:none">
                <span class="li-title">${esc(w.name)} ${w.kev ? `<span class="badge kev" style="margin-left:4px">${w.kev} KEV</span>` : ""}</span>
                <span class="num">${nf(w.recent)}</span>
                <span class="num" style="color:${w.p1 ? "var(--crit)" : "var(--faint)"}">${nf(w.p1)}</span>
                <span class="num faint">${nf(w.total)}</span></a>`).join("") || '<div class="empty">Aucun produit surveillé</div>'}
          </div>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>Priorités du périmètre — 30 jours</h2><a class="btn ghost sm" href="#/vulns?sort=priority&days=30">Tout voir</a></div>
          <div class="card-body">${d.top.map(vulnLine).join("") || `<div class="empty">${icon("inbox")}<div>Aucune vulnérabilité ouverte sur le périmètre.<br><span class="faint">Lancez une synchronisation si c'est le premier démarrage.</span></div></div>`}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-head"><h2>Derniers ajouts CISA KEV</h2><a class="btn ghost sm" href="#/vulns?scope=all&kev=1&sort=kev">Tout voir</a></div>
            <div class="card-body">${d.kev_recent.map((v) => `
              <div class="list-item" data-vuln="${esc(v.id)}"><div style="min-width:0">
                <div class="li-title"><span class="vid">${esc(v.id)}</span></div>
                <div class="vdesc">${esc(v.title || v.description)}</div>
                <div class="li-meta">${sevBadge(v.severity)}<span>Ajout ${fmtDate(v.kev_added)}</span>${v.kev_due ? `<span>Échéance ${fmtDate(v.kev_due)}</span>` : ""}
                ${v.watches.length ? `<span class="badge tag accent">${esc(v.watches.join(", "))}</span>` : ""}</div></div></div>`).join("") || '<div class="empty">—</div>'}</div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Derniers bulletins</h2><a class="btn ghost sm" href="#/bulletins">Tout voir</a></div>
            <div class="card-body">${d.bulletins.map((b) => `
              <a class="list-item" href="${esc(b.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none"><div style="min-width:0">
                <div class="li-title">${esc(b.title)}</div>
                <div class="li-meta"><span class="badge tag">${esc(b.source)} · ${esc(b.kind)}</span><span>${fmtDate(b.published)}</span>${b.cves.length ? `<span>${b.cves.length} CVE</span>` : ""}</div></div></a>`).join("") || '<div class="empty">—</div>'}</div>
          </div>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ liste des vulnérabilités
  let watchCache = null;
  async function getWatches(force = false) {
    if (!watchCache || force) watchCache = await api("/api/watchlist");
    return watchCache;
  }

  async function pageVulns(c, params) {
    const p = { scope: "watch", sort: "published", page: "1", ...params };
    const watches = await getWatches();
    const setP = (patch) => {
      const np = { ...p, ...patch };
      if (!("page" in patch)) np.page = "1";
      Object.keys(np).forEach((k) => (np[k] === "" || np[k] == null) && delete np[k]);
      location.hash = "#/vulns?" + new URLSearchParams(np).toString();
    };
    const chip = (key, val, label) => `<button data-k="${key}" data-v="${esc(val)}" class="${(p[key] || "") === val ? "on" : ""}">${label}</button>`;

    c.innerHTML = `
      <div class="page-head"><div><h1>Vulnérabilités</h1><p id="vcount">Chargement…</p></div>
        <div style="display:flex;gap:8px"><a class="btn" id="vexport">${icon("download")} Export CSV</a></div></div>
      <div class="filters">
        <div class="chips" data-group="scope">${chip("scope", "watch", "Mon périmètre")}${chip("scope", "all", "Toutes")}</div>
        <div class="chips" data-group="days">${chip("days", "", "Toutes dates")}${chip("days", "1", "24 h")}${chip("days", "7", "7 j")}${chip("days", "30", "30 j")}${chip("days", "90", "90 j")}</div>
        <div class="chips" data-group="priority">${chip("priority", "", "Toutes priorités")}${chip("priority", "1", "P1")}${chip("priority", "1,2", "P1-P2")}${chip("priority", "1,2,3", "P1-P3")}</div>
        <div class="chips" data-group="assignee">${chip("assignee", "", "Tous")}${chip("assignee", "me", "Assignées à moi")}${can("assign") ? chip("assignee", "none", "Non assignées") : ""}</div>
        <label class="toggle"><input type="checkbox" id="fkev" ${p.kev ? "checked" : ""}> Exploitées (KEV)</label>
        <label class="toggle"><input type="checkbox" id="foverdue" ${p.overdue ? "checked" : ""}> En retard</label>
      </div>
      <div class="filters">
        <input id="fq" placeholder="Filtrer (id, produit, texte)…" value="${esc(p.q || "")}" style="min-width:260px">
        <select id="fwatch"><option value="">Tous les produits surveillés</option>${watches.map((w) => `<option value="${w.id}" ${String(w.id) === p.watch ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select>
        <select id="fsev"><option value="">Toutes sévérités</option>${Object.entries(SEV_FR).slice(0, 4).map(([k, l]) => `<option value="${k}" ${p.severity === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="fstatus"><option value="">Tous statuts</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}
          <option value="new,analysis,action" ${p.status === "new,analysis,action" ? "selected" : ""}>Ouverts</option></select>
        <select id="fsource"><option value="">Toutes sources</option>${["nvd", "github", "kev"].map((s) => `<option ${p.source === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select id="fsort">${[["published", "Plus récentes"], ["priority", "Priorité"], ["cvss", "CVSS"], ["epss", "EPSS"], ["kev", "Ajout KEV"], ["first_seen", "Détection"]].map(([k, l]) => `<option value="${k}" ${p.sort === k ? "selected" : ""}>Tri : ${l}</option>`).join("")}</select>
      </div>
      <div class="card"><div class="table-wrap"><table id="vtable">
        <thead><tr><th>Prio.</th><th>Identifiant</th><th>Description</th><th>CVSS</th><th>EPSS</th><th>Publiée</th><th>Statut</th></tr></thead>
        <tbody>${'<tr><td colspan="7"><div class="skeleton"></div></td></tr>'.repeat(6)}</tbody></table></div>
        <div class="pager" id="vpager"></div></div>`;

    $$(".chips button", c).forEach((b) => b.addEventListener("click", () => setP({ [b.dataset.k]: b.dataset.v })));
    $("#fkev").addEventListener("change", (e) => setP({ kev: e.target.checked ? "1" : "" }));
    $("#foverdue").addEventListener("change", (e) => setP({ overdue: e.target.checked ? "1" : "" }));
    $("#fq").addEventListener("input", debounce((e) => setP({ q: e.target.value })));
    [["#fwatch", "watch"], ["#fsev", "severity"], ["#fstatus", "status"], ["#fsource", "source"], ["#fsort", "sort"]].forEach(([s, k]) =>
      $(s).addEventListener("change", (e) => setP({ [k]: e.target.value })));
    if (p.q) { const i = $("#fq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }

    const qp = { ...p, kev: p.kev ? "true" : "", overdue: p.overdue ? "true" : "", per_page: 50 };
    Object.keys(qp).forEach((k) => qp[k] === "" && delete qp[k]);
    const qs = new URLSearchParams(qp).toString();
    $("#vexport").href = "/api/export.csv?" + qs;
    const d = await api("/api/vulns?" + qs);
    $("#vcount").textContent = `${nf(d.total)} résultat${d.total > 1 ? "s" : ""}${p.scope === "watch" && !p.watch ? " sur le périmètre surveillé" : ""}`;
    $("#vtable tbody").innerHTML = d.items.map((v) => `
      <tr data-vuln="${esc(v.id)}">
        <td>${prioBadge(v.priority)}</td>
        <td><div class="vid">${esc(v.id)}</div><div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">${kevBadge(v)}${sevBadge(v.severity)}</div></td>
        <td>${v.title ? `<div class="vtitle">${esc(v.title)}</div>` : ""}<div class="vdesc">${esc(v.description)}</div>
          ${v.watches.length ? `<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">${v.watches.map((w) => `<span class="badge tag accent">${esc(w)}</span>`).join("")}</div>` : ""}</td>
        <td>${scoreCell(v)}</td><td>${epssCell(v)}</td>
        <td class="nowrap muted">${v.published ? fmtDate(v.published) : `${fmtDate(v.first_seen)}<div class="faint" style="font-size:11px" title="Date de publication inconnue : date à laquelle la plateforme l'a détectée">détectée</div>`}</td>
        <td>${statusCell(v)}</td>
      </tr>`).join("") || `<tr><td colspan="7"><div class="empty">${icon("inbox")}<div>Aucun résultat pour ces filtres.</div></div></td></tr>`;
    const pages = Math.max(1, Math.ceil(d.total / d.per_page));
    const page = +p.page;
    $("#vpager").innerHTML = `<span>Page ${page} / ${pages}</span><div style="display:flex;gap:6px">
      <button class="btn sm" ${page <= 1 ? "disabled" : ""} id="pprev">← Précédent</button>
      <button class="btn sm" ${page >= pages ? "disabled" : ""} id="pnext">Suivant →</button></div>`;
    $("#pprev").addEventListener("click", () => setP({ page: String(page - 1) }));
    $("#pnext").addEventListener("click", () => setP({ page: String(page + 1) }));
  }

  let assigneeCache = null;
  async function getAssignees() { if (!assigneeCache) assigneeCache = await api("/api/assignees"); return assigneeCache; }

  // ------------------------------------------------------------------ détail (tiroir)
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-vuln]");
    if (el && !e.target.closest("a[href^='http']")) openVuln(el.dataset.vuln);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeDrawer(); } });

  function closeDrawer() {
    $("#drawer")?.remove(); $("#drawer-ov")?.remove();
    if (location.hash.startsWith("#/vuln/")) history.replaceState(null, "", "#/vulns");
  }

  async function openVuln(id) {
    closeDrawer();
    const ov = document.createElement("div"); ov.className = "overlay"; ov.id = "drawer-ov"; ov.dataset.action = "close-drawer";
    const dr = document.createElement("div"); dr.className = "drawer"; dr.id = "drawer";
    dr.innerHTML = `<div class="drawer-body"><div class="skeleton" style="height:28px;width:50%"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div></div>`;
    document.body.append(ov, dr);
    let v;
    try { v = await api("/api/vulns/" + encodeURIComponent(id)); }
    catch (e) { dr.innerHTML = `<div class="drawer-head" style="display:flex;justify-content:space-between"><h1 class="mono">${esc(id)}</h1><button class="btn ghost icon-btn" data-action="close-drawer">${icon("x")}</button></div>
      <div class="drawer-body"><div class="empty">${icon("alert")}<div>${esc(e.message)}<br><span class="faint">Cette vulnérabilité n'est pas (encore) en base locale.</span></div>
      ${/^CVE-/.test(id) ? `<a class="btn" href="https://nvd.nist.gov/vuln/detail/${esc(id)}" target="_blank" rel="noopener noreferrer">${icon("ext")} Voir sur NVD</a>` : ""}</div></div>`; return; }

    const isCve = v.id.startsWith("CVE-");
    const extLinks = [
      isCve && ["NVD", `https://nvd.nist.gov/vuln/detail/${v.id}`],
      isCve && ["CVE.org", `https://www.cve.org/CVERecord?id=${v.id}`],
      isCve && ["CIRCL", `https://vulnerability.circl.lu/vuln/${v.id.toLowerCase()}`],
      isCve && ["Exploit-DB", `https://www.exploit-db.com/search?cve=${v.id.replace("CVE-", "")}`],
      isCve && ["GitHub PoC", `https://github.com/search?q=${v.id}&type=repositories`],
      [...v.aliases, v.id].find((a) => a.startsWith("GHSA")) && ["GitHub Advisory", `https://github.com/advisories/${[...v.aliases, v.id].find((a) => a.startsWith("GHSA"))}`],
    ].filter(Boolean);

    dr.innerHTML = `
      <div class="drawer-head">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div style="min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${prioBadge(v.priority)}<h1 class="mono">${esc(v.id)}</h1>${kevBadge(v)}${sevBadge(v.severity)}
              ${v.ssvc_exploitation === "active" && !v.kev ? '<span class="badge sev-CRITICAL" title="Décision SSVC de la CISA">Exploitation active (CISA)</span>' : ""}
              ${v.ssvc_exploitation === "poc" ? '<span class="badge sev-HIGH" title="Décision SSVC de la CISA">Preuve de concept publique</span>' : ""}</div>
            ${v.title ? `<div style="margin-top:6px;font-weight:600">${esc(v.title)}</div>` : ""}
            <div class="li-meta" style="margin-top:6px">${v.aliases.map((a) => `<span class="badge tag">${esc(a)}</span>`).join("")}
              <span>Publiée ${fmtDate(v.published)}</span><span>Modifiée ${fmtDate(v.modified)}</span><span>Sources : ${esc(v.sources.join(", "))}</span>${v.vuln_status ? `<span>NVD : ${esc(v.vuln_status)}</span>` : ""}</div>
          </div>
          <button class="btn ghost icon-btn" data-action="close-drawer" title="Fermer (Échap)">${icon("x")}</button>
        </div>
      </div>
      <div class="drawer-body">
        ${v.kev ? `<div class="alert-kev"><b>${icon("fire", "")} Exploitation active confirmée (CISA KEV)</b> — ajoutée le ${fmtDate(v.kev_added)}${v.kev_due ? `, échéance de correction US-fédérale : <b>${fmtDate(v.kev_due)}</b>` : ""}${v.kev_ransomware === "Known" ? " · <b>utilisée par des rançongiciels</b>" : ""}
          ${v.kev_action ? `<div class="muted" style="margin-top:6px">Action requise : ${esc(v.kev_action)}</div>` : ""}</div>` : ""}
        <div class="metrics">
          <div class="metric"><div class="label">Priorité ${esc(ME.org)}</div><div class="value">P${v.priority}</div><div class="sub">${esc(PRIO_FR[v.priority])}</div></div>
          <div class="metric"><div class="label">CVSS ${esc(v.cvss_version || "")}</div><div class="value" style="color:${SEV_COLOR[v.severity] || "inherit"}">${v.cvss_score ?? "N/É"}</div><div class="sub ${v.cvss_vector ? "mono" : ""}">${v.cvss_vector ? esc(v.cvss_vector) : "Non évaluée : le NVD n'a pas encore analysé cette CVE. Le score sera complété automatiquement."}</div></div>
          <div class="metric"><div class="label">EPSS</div><div class="value">${v.epss != null ? (v.epss * 100).toFixed(2) + " %" : "—"}</div><div class="sub">${v.epss != null ? `Percentile ${(v.epss_percentile * 100).toFixed(0)} · ${fmtDate(v.epss_date)}` : "Probabilité d'exploitation à 30 j"}</div></div>
        </div>
        <div><div class="section-title">Description</div><div class="desc">${esc(v.description || "—")}</div></div>
        <div class="card reco-card" id="reco" style="box-shadow:none"></div>
        ${v.watches.length ? `<div><div class="section-title">Périmètre concerné</div>${v.watches.map((w) => `<span class="badge tag accent" style="margin-right:4px">${esc(w)}</span>`).join("")}</div>` : ""}
        <div class="card" style="box-shadow:none"><div class="card-body" style="padding-top:16px">
          <div class="section-title" style="display:flex;justify-content:space-between;gap:8px"><span>Qualification & remédiation</span>
            <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">${v.triage_at ? `Mis à jour ${ago(v.triage_at)} par ${esc(v.triage_by)}` : ""}</span></div>
          ${v.can_edit ? `
          <div class="triage-grid">
            <div><label>Statut</label><select id="tstatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            ${v.can_assign ? `<div><label>Assigné à</label><select id="tassignee"><option value="">— Non assignée —</option></select></div>
            <div><label>Échéance</label><input type="date" id="tdue" value="${esc(v.due_date || "")}"></div>` :
              `<div><label>Assigné à</label><div class="ro">${esc(v.assignee_name || "—")}</div></div><div><label>Échéance</label><div class="ro ${v.overdue ? "late" : ""}">${v.due_date ? fmtDate(v.due_date) : "—"}</div></div>`}
          </div>
          <label>Note d'analyse / compte rendu de remédiation</label>
          <textarea id="tnote" placeholder="Analyse, systèmes impactés, correctif appliqué, ticket associé…">${esc(v.note)}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px">
            <span class="faint" style="font-size:12px">${v.assigned_by ? `Assignée par ${esc(v.assigned_by)} ${ago(v.assigned_at)}` : ""}</span>
            <button class="btn primary sm" id="tsave">${icon("check")} Enregistrer</button></div>` : `
          <div class="triage-grid">
            <div><label>Statut</label><div class="ro">${statusBadge(v.status)}</div></div>
            <div><label>Assigné à</label><div class="ro">${esc(v.assignee_name || "—")}</div></div>
            <div><label>Échéance</label><div class="ro ${v.overdue ? "late" : ""}">${v.due_date ? fmtDate(v.due_date) : "—"}</div></div>
          </div>
          ${v.note ? `<label>Note</label><div class="desc ro" style="padding:10px 12px">${esc(v.note)}</div>` : ""}
          <div class="faint" style="font-size:12px;margin-top:8px">${icon("lock")} Lecture seule : seuls les analystes et la personne assignée peuvent modifier cette fiche.</div>`}
          ${v.history.length ? `<div class="section-title" style="margin-top:18px">Historique</div><div class="timeline">${v.history.map((h) => `
            <div class="tl-item"><span class="tl-dot ${h.action === "triage.assign" ? "assign" : ""}"></span><div><b>${esc(h.username)}</b> — ${esc(h.details)}<div class="faint" style="font-size:11.5px">${fmtDate(h.ts, true)}</div></div></div>`).join("")}</div>` : ""}
        </div></div>
        ${v.bulletins.length ? `<div><div class="section-title">Bulletins associés</div>${v.bulletins.map((b) => `
          <a class="list-item" href="${esc(b.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none"><div>
            <div class="li-title">${esc(b.title)}</div><div class="li-meta"><span class="badge tag">${esc(b.source)} · ${esc(b.kind)}</span><span>${fmtDate(b.published)}</span></div></div></a>`).join("")}</div>` : ""}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
          <div><div class="section-title">Produits affectés</div><div style="display:flex;gap:4px;flex-wrap:wrap">${v.products.slice(0, 40).map((p) => `<span class="badge tag mono">${esc(p)}</span>`).join("") || '<span class="faint">—</span>'}</div></div>
          <div><div class="section-title">Faiblesses (CWE)</div><div style="display:flex;gap:4px;flex-wrap:wrap">${v.cwe.map((w) => /^CWE-\d+$/.test(w) ? `<a class="badge tag" href="https://cwe.mitre.org/data/definitions/${w.slice(4)}.html" target="_blank" rel="noopener noreferrer">${esc(w)}</a>` : `<span class="badge tag">${esc(w)}</span>`).join("") || '<span class="faint">—</span>'}</div></div>
        </div>
        <div><div class="section-title">Liens d'analyse</div><div style="display:flex;gap:6px;flex-wrap:wrap">${extLinks.map(([l, u]) => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon("ext")} ${l}</a>`).join("")}</div></div>
        <div><div class="section-title">Références (${v.refs.length})</div><div class="refs">${v.refs.map((r) => `<div><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a> ${(r.tags || []).map((t) => `<span class="badge tag" style="font-size:10.5px">${esc(t)}</span>`).join(" ")}</div>`).join("") || '<span class="faint">—</span>'}</div></div>
      </div>`;
    renderReco(v, v.checklist);
    if (v.can_assign) {
      const people = await getAssignees();
      const sel = $("#tassignee");
      const groups = {};
      people.forEach((p) => (groups[p.role_label] ||= []).push(p));
      sel.innerHTML += Object.entries(groups).map(([g, ps]) => `<optgroup label="${esc(g)}">${ps.map((p) => `<option value="${p.id}" ${p.id === v.assignee_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
      sel.addEventListener("change", () => { if (sel.value && !$("#tdue").value) $("#tdue").value = addDays(DUE_DAYS[v.priority] || 30); });
    }
    $("#tsave")?.addEventListener("click", async () => {
      const body = { status: $("#tstatus").value, note: $("#tnote").value };
      if (v.can_assign) { body.assignee_id = $("#tassignee").value ? +$("#tassignee").value : null; body.due_date = $("#tdue").value || null; }
      try {
        await api(`/api/vulns/${encodeURIComponent(v.id)}/triage`, { method: "PUT", body });
        toast("Fiche enregistrée", "ok");
        openVuln(v.id);
        if ($("#vtable") && parseHash().page === "vulns") route();
      } catch (e) { toast(e.message, "err"); }
    });
  }

  // ------------------------------------------------------------------ recommandations (liste d'actions à cocher)
  function renderReco(v, cl) {
    const box = $("#reco");
    if (!box) return;
    const pct = cl.total ? Math.round((cl.done / cl.total) * 100) : 0;
    box.innerHTML = `<div class="card-body" style="padding-top:16px">
      <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${icon("check")} Recommandations — actions à réaliser</span>
        <span class="reco-count ${cl.done === cl.total && cl.total ? "all" : ""}">${cl.done} / ${cl.total}</span></div>
      <div class="reco-bar"><i style="width:${pct}%"></i></div>
      <ul class="reco-list">${cl.items.map((it) => `
        <li class="${it.done ? "done" : ""} ${it.urgent && !it.done ? "urgent" : ""}">
          <label class="reco-check"><input type="checkbox" data-ck="${esc(it.key)}" ${it.done ? "checked" : ""} ${v.can_edit ? "" : "disabled"}>
            <span><span class="reco-label">${it.urgent ? '<span class="badge sev-CRITICAL" style="margin-right:6px">Urgent</span>' : ""}${esc(it.label)}</span>
              ${it.detail ? `<span class="reco-detail">${esc(it.detail)}</span>` : ""}
              ${it.link ? `<a class="reco-detail" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${icon("ext")} ${esc(it.link.length > 70 ? it.link.slice(0, 70) + "…" : it.link)}</a>` : ""}
              ${it.done && it.by ? `<span class="reco-by">${icon("check")} ${esc(it.by)} · ${fmtDate(it.at, true)}</span>` : ""}</span></label>
          ${it.custom && v.can_edit ? `<button class="btn ghost sm" data-ckdel="${esc(it.key)}" title="Supprimer cette action">${icon("x")}</button>` : ""}
        </li>`).join("")}</ul>
      ${v.can_edit ? `<form class="reco-add" id="reco-add"><input name="label" placeholder="Ajouter une action spécifique (ex : redémarrer le service sshd sur srv-bastion-01)" maxlength="300" required>
        <button class="btn sm">${icon("plus")} Ajouter</button></form>`
        : `<div class="faint" style="font-size:12px;margin-top:10px">${icon("lock")} Seuls les analystes et la personne assignée peuvent cocher ces actions.</div>`}
    </div>`;
    if (!v.can_edit) return;
    const update = async (fn) => {
      try { const nv = await fn(); v.checklist = nv; renderReco(v, nv); } catch (e) { toast(e.message, "err"); renderReco(v, v.checklist); }
    };
    $$("[data-ck]", box).forEach((cb) => cb.addEventListener("change", () => update(() =>
      api(`/api/vulns/${encodeURIComponent(v.id)}/checklist`, { method: "PUT", body: { key: cb.dataset.ck, done: cb.checked } }))));
    $$("[data-ckdel]", box).forEach((b) => b.addEventListener("click", () => update(() =>
      api(`/api/vulns/${encodeURIComponent(v.id)}/checklist/${encodeURIComponent(b.dataset.ckdel)}`, { method: "DELETE" }))));
    $("#reco-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const label = new FormData(e.target).get("label");
      update(() => api(`/api/vulns/${encodeURIComponent(v.id)}/checklist`, { method: "POST", body: { label } }));
    });
  }

  // ------------------------------------------------------------------ modal
  function closeModal() { $("#modal")?.remove(); $("#modal-ov")?.remove(); }
  function modal(title, bodyHtml, onSave, saveLabel = "Enregistrer") {
    closeModal();
    const ov = document.createElement("div"); ov.className = "overlay"; ov.id = "modal-ov"; ov.style.zIndex = 30; ov.dataset.action = "close-modal";
    const m = document.createElement("form"); m.className = "modal"; m.id = "modal";
    m.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2></div><div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button><button class="btn primary" type="submit">${esc(saveLabel)}</button></div>`;
    document.body.append(ov, m);
    m.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await onSave(new FormData(m)); closeModal(); } catch (er) { toast(er.message, "err"); }
    });
    $("input", m)?.focus();
  }

  // ------------------------------------------------------------------ périmètre surveillé
  const PRESETS = [
    ["PHP", "PHP versions,php-fpm,php-cgi", "php:php"], ["OpenSSH", "OpenSSH", "openbsd:openssh"],
    ["OpenSSL", "OpenSSL", "openssl:openssl"], ["Apache HTTP Server", "Apache HTTP Server", "apache:http_server"],
    ["Nginx", "nginx", "f5:nginx,nginx:nginx"], ["Apache Tomcat", "Apache Tomcat", "apache:tomcat"],
    ["WordPress", "WordPress", "wordpress:wordpress"], ["MySQL", "MySQL Server", "oracle:mysql"],
    ["PostgreSQL", "PostgreSQL", "postgresql:postgresql"], ["Microsoft Windows", "Windows Server,Microsoft Windows", "microsoft:windows_server_2022,microsoft:windows_server_2019,microsoft:windows_11_24h2"],
    ["VMware ESXi", "VMware ESXi", "vmware:esxi"], ["Cisco ASA / FTD", "Cisco Adaptive Security Appliance,Firepower Threat Defense", "cisco:adaptive_security_appliance_software,cisco:firepower_threat_defense"],
    ["Ivanti Connect Secure", "Ivanti Connect Secure,Pulse Connect Secure", "ivanti:connect_secure"], ["Palo Alto PAN-OS", "PAN-OS,GlobalProtect", "paloaltonetworks:pan-os"],
    ["Citrix NetScaler", "NetScaler,Citrix ADC", "citrix:netscaler_application_delivery_controller"], ["Microsoft SharePoint", "SharePoint Server", "microsoft:sharepoint_server"],
    ["Zimbra", "Zimbra Collaboration", "zimbra:collaboration"], ["GitLab", "GitLab", "gitlab:gitlab"], ["Jenkins", "Jenkins", "jenkins:jenkins"],
    ["Sudo", "sudo", "sudo_project:sudo"], ["glibc", "glibc,GNU C Library", "gnu:glibc"], ["Docker", "Docker Engine,Moby", "docker:docker,mobyproject:moby"],
  ];

  function watchForm(w = {}) {
    return `
      ${!w.id ? `<div><label>Modèles rapides</label><select id="preset"><option value="">— Choisir un produit courant —</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Nom affiché</label><input name="name" required value="${esc(w.name || "")}" placeholder="ex : PHP"></div>
      <div class="field"><label>Identifiants CPE (vendor:product)</label><input name="cpes" class="mono" value="${esc(w.cpes || "")}" placeholder="ex : php:php, openbsd:openssh">
        <div class="hint">Correspondance exacte avec les produits NVD. Trouvez-les sur <a href="https://nvd.nist.gov/products/cpe/search" target="_blank" rel="noopener noreferrer">nvd.nist.gov/products/cpe</a> (format cpe:2.3:a:<b>vendor</b>:<b>product</b>). Pour GitHub : ecosystème:paquet (ex : composer:laravel/framework).</div></div>
      <div class="field"><label>Mots-clés (dans la description)</label><input name="keywords" value="${esc(w.keywords || "")}" placeholder="ex : OpenSSH, sshd">
        <div class="hint">Séparés par des virgules. Utile pour les CVE récentes que le NVD n'a pas encore enrichies.</div></div>
      <div class="field" style="display:flex;gap:16px;align-items:flex-end">
        <div style="flex:1"><label>CVSS minimal</label><input name="min_cvss" type="number" min="0" max="10" step="0.1" value="${w.min_cvss ?? 0}"></div>
        <label class="toggle" style="margin-bottom:10px"><input type="checkbox" name="enabled" ${w.enabled === 0 ? "" : "checked"}> Actif</label>
      </div>`;
  }
  const watchBody = (f) => ({ name: f.get("name"), cpes: f.get("cpes"), keywords: f.get("keywords"), min_cvss: parseFloat(f.get("min_cvss") || 0), enabled: f.get("enabled") === "on" });

  function bindPreset() {
    $("#preset")?.addEventListener("change", (e) => {
      const p = PRESETS[e.target.value]; if (!p) return;
      const m = $("#modal"); m.name.value = p[0]; m.keywords.value = p[1]; m.cpes.value = p[2];
    });
  }

  async function pageWatch(c) {
    const ws = await getWatches(true);
    c.innerHTML = `
      <div class="page-head"><div><h1>Périmètre surveillé</h1><p>Produits et technologies de votre SI. Chaque nouvelle vulnérabilité correspondante est priorisée et notifiée.</p></div>
        ${can("watch.edit") ? `<button class="btn primary" id="wadd">${icon("plus")} Ajouter un produit</button>` : ""}</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Produit</th><th>CPE</th><th>Mots-clés</th><th>CVSS min.</th><th>Vulnérabilités</th><th>P1-P2</th><th>KEV</th><th>Dernière</th><th></th></tr></thead>
        <tbody>${ws.map((w) => `
          <tr data-watch="${w.id}" style="${w.enabled ? "" : "opacity:.5"}">
            <td><div class="li-title">${esc(w.name)}</div>${!w.backfilled ? '<span class="badge tag" title="Historique NVD récupéré à la prochaine synchro">historique en attente</span>' : ""}</td>
            <td class="mono muted" style="font-size:12px">${esc(w.cpes || "—")}</td>
            <td class="muted" style="font-size:12.5px;max-width:260px">${esc(w.keywords || "—")}</td>
            <td class="mono">${w.min_cvss || "—"}</td>
            <td class="num" style="text-align:left">${nf(w.total)}</td>
            <td class="num" style="text-align:left;color:${w.high ? "var(--high)" : "inherit"}">${nf(w.high)}</td>
            <td class="num" style="text-align:left;color:${w.kev ? "var(--crit)" : "inherit"}">${nf(w.kev)}</td>
            <td class="muted nowrap">${fmtDate(w.last)}</td>
            <td class="nowrap">${can("watch.edit") ? `<button class="btn ghost sm" data-wedit="${w.id}" title="Modifier">${icon("edit")}</button><button class="btn ghost sm danger" data-wdel="${w.id}" title="Supprimer">${icon("trash")}</button>` : ""}</td>
          </tr>`).join("") || `<tr><td colspan="9"><div class="empty">Aucun produit. Ajoutez par exemple PHP et OpenSSH.</div></td></tr>`}</tbody></table></div></div>
      <p class="faint" style="margin-top:14px;font-size:12.5px">Astuce : une correspondance est établie si l'un des CPE figure dans les produits affectés <b>ou</b> si un mot-clé apparaît dans la description. Cliquez une ligne pour voir ses vulnérabilités.</p>`;

    $("#wadd")?.addEventListener("click", () => {
      modal("Ajouter un produit à surveiller", watchForm(), async (f) => {
        const r = await api("/api/watchlist", { method: "POST", body: watchBody(f) });
        toast(r.info, "ok"); watchCache = null; setTimeout(route, 800);
      }, "Ajouter");
      bindPreset();
    });
    c.onclick = async (e) => {
      const ed = e.target.closest("[data-wedit]"), del = e.target.closest("[data-wdel]");
      if (ed) {
        const w = ws.find((x) => x.id === +ed.dataset.wedit);
        modal(`Modifier « ${w.name} »`, watchForm(w), async (f) => {
          await api(`/api/watchlist/${w.id}`, { method: "PUT", body: watchBody(f) });
          toast("Produit mis à jour", "ok"); watchCache = null; setTimeout(route, 800);
        });
      } else if (del) {
        const w = ws.find((x) => x.id === +del.dataset.wdel);
        if (confirm(`Supprimer « ${w.name} » du périmètre ?`)) {
          await api(`/api/watchlist/${w.id}`, { method: "DELETE" }); toast("Supprimé"); watchCache = null; route();
        }
      } else {
        const tr = e.target.closest("tr[data-watch]");
        if (tr) location.hash = `#/vulns?watch=${tr.dataset.watch}`;
      }
    };
  }

  // ------------------------------------------------------------------ bulletins
  async function pageBulletins(c, params) {
    const p = { page: "1", ...params };
    const qs = new URLSearchParams(p).toString();
    const d = await api("/api/bulletins?" + qs);
    const setP = (patch) => { const np = { ...p, page: "1", ...patch }; Object.keys(np).forEach((k) => !np[k] && delete np[k]); location.hash = "#/bulletins?" + new URLSearchParams(np); };
    c.innerHTML = `
      <div class="page-head"><div><h1>Bulletins CERT & éditeurs</h1><p>${nf(d.total)} bulletins · CERT-FR (ANSSI), Ubuntu, CISA, ZDI…</p></div></div>
      <div class="filters">
        <div class="chips">${["", ...d.sources].map((s) => `<button data-src="${esc(s)}" class="${(p.source || "") === s ? "on" : ""}">${esc(s || "Toutes")}</button>`).join("")}</div>
        <input id="bq" placeholder="Rechercher (titre, CVE…)" value="${esc(p.q || "")}" style="min-width:260px">
      </div>
      <div class="card"><div class="card-body" id="blist">${d.items.map((b) => `
        <div class="list-item" data-bul style="cursor:pointer"><div style="min-width:0;flex:1">
          <div style="display:flex;justify-content:space-between;gap:10px">
            <div class="li-title">${esc(b.title)}</div>
            <a class="btn ghost sm" href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">${icon("ext")}</a></div>
          <div class="li-meta"><span class="badge tag ${b.kind === "alerte" ? "sev-CRITICAL" : ""}">${esc(b.source)} · ${esc(b.kind)}</span><span>${fmtDate(b.published, true)}</span>
            ${b.cves.length ? `<span>${b.cves.length} CVE</span>` : ""}${b.in_scope ? `<span class="badge tag accent">${b.in_scope} sur le périmètre</span>` : ""}</div>
          <div class="bul-summary">${esc(b.summary)}${b.cves.length ? `\n\n<b>CVE :</b> ${b.cves.slice(0, 80).map((x) => `<a href="#" data-cve="${esc(x)}">${esc(x)}</a>`).join(", ")}` : ""}</div>
        </div></div>`).join("") || '<div class="empty">Aucun bulletin. Lancez une synchronisation.</div>'}</div>
        <div class="pager"><span>Page ${p.page} / ${Math.max(1, Math.ceil(d.total / 30))}</span><div style="display:flex;gap:6px">
          <button class="btn sm" id="bprev" ${+p.page <= 1 ? "disabled" : ""}>← Précédent</button>
          <button class="btn sm" id="bnext" ${+p.page * 30 >= d.total ? "disabled" : ""}>Suivant →</button></div></div></div>`;
    $$("[data-src]", c).forEach((b) => b.addEventListener("click", () => setP({ source: b.dataset.src })));
    $("#bq").addEventListener("input", debounce((e) => setP({ q: e.target.value }), 400));
    if (p.q) { const i = $("#bq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    $("#bprev").addEventListener("click", () => setP({ page: String(+p.page - 1) }));
    $("#bnext").addEventListener("click", () => setP({ page: String(+p.page + 1) }));
    $("#blist").addEventListener("click", (e) => {
      const cv = e.target.closest("[data-cve]");
      if (cv) { e.preventDefault(); openVuln(cv.dataset.cve); return; }
      if (e.target.closest("a")) return;
      e.target.closest("[data-bul]")?.classList.toggle("open");
    });
  }

  // ------------------------------------------------------------------ sources
  async function pageSources(c) {
    const d = await api("/api/sources");
    const stDot = (l) => !l ? '<span class="dot" style="background:var(--none)"></span>' : `<span class="dot ${l.status === "running" ? "run" : l.status === "error" ? "err" : ""}"></span>`;
    c.innerHTML = `
      <div class="page-head"><div><h1>Sources & API</h1><p>Synchronisation automatique toutes les ${d.interval_min} min · base locale ${d.db_size_mb} Mo</p></div>
        <div style="display:flex;gap:8px">${can("notify.test") ? `<button class="btn" id="ntest">${icon("bell")} Tester les notifications</button>` : ""}<button class="btn primary ${can("sync") ? "" : "hidden"}" data-action="sync">${icon("refresh", d.state.running ? "spin" : "")} ${d.state.running ? "En cours : " + esc(d.state.current || "") : "Synchroniser maintenant"}</button></div></div>
      <div class="src-grid">${d.sources.map((s) => `
        <div class="card src-card">
          <div class="row"><h2>${esc(s.name)}</h2>${s.enabled ? stDot(s.last) : '<span class="badge tag">désactivée</span>'}</div>
          <div class="muted" style="font-size:13px">${esc(s.desc)}</div>
          <dl class="kv">
            <dt>Dernier succès</dt><dd>${s.last_ok ? `${fmtDate(s.last_ok, true)} <span class="faint">(${ago(s.last_ok)})</span>` : "—"}</dd>
            ${s.last ? `<dt>Dernier passage</dt><dd>${esc(s.last.status)} · ${nf(s.last.items)} élément(s) ${s.last.message ? `<span class="faint">· ${esc(s.last.message)}</span>` : ""}</dd>` : ""}
            ${s.key_env ? `<dt>Clé API</dt><dd>${s.has_key ? '<span class="badge st-done">configurée</span>' : `<span class="badge st-analysis">absente</span> <a href="${esc(s.key_url)}" target="_blank" rel="noopener noreferrer">obtenir</a> → <code>${esc(s.key_env)}</code>`}</dd>` : '<dt>Clé API</dt><dd class="faint">non nécessaire</dd>'}
          </dl>
        </div>`).join("")}
        <div class="card src-card">
          <div class="row"><h2>Notifications</h2>${d.notify_channels.length ? '<span class="dot"></span>' : '<span class="badge st-analysis">aucun canal</span>'}</div>
          <div class="muted" style="font-size:13px">Alerte quand une vulnérabilité du périmètre atteint P${d.notify_min_priority} ou plus, ou quand sa priorité s'aggrave (ex. ajout au KEV).</div>
          <dl class="kv"><dt>Canaux actifs</dt><dd>${d.notify_channels.map((x) => `<span class="badge tag accent">${esc(x)}</span>`).join(" ") || "—"}</dd>
          <dt>Disponibles</dt><dd class="faint">Telegram, Discord, Slack/Mattermost, Teams, e-mail</dd></dl>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>Journal de synchronisation</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Source</th><th>Début</th><th>Durée</th><th>Statut</th><th>Éléments</th><th>Message</th></tr></thead>
        <tbody>${d.logs.map((l) => `<tr style="cursor:default"><td class="mono">${esc(l.source)}</td><td class="nowrap muted">${fmtDate(l.started_at, true)}</td>
          <td class="mono muted">${l.finished_at ? Math.round((new Date(l.finished_at) - new Date(l.started_at)) / 1000) + " s" : "…"}</td>
          <td>${l.status === "ok" ? '<span class="badge st-done">ok</span>' : l.status === "error" ? '<span class="badge sev-CRITICAL">erreur</span>' : '<span class="badge st-new">en cours</span>'}</td>
          <td class="mono">${nf(l.items)}</td><td class="muted" style="font-size:12.5px;max-width:520px;word-break:break-word">${esc(l.message)}</td></tr>`).join("") || '<tr><td colspan="6"><div class="empty">Aucune synchronisation pour le moment.</div></td></tr>'}</tbody></table></div>
      </div>`;
    $("#ntest")?.addEventListener("click", async () => {
      try { const r = await api("/api/notify/test", { method: "POST" }); toast(r.ok ? "Notification envoyée" : "Erreurs : " + r.errors.join(" ; "), r.ok ? "ok" : "err"); }
      catch (e) { toast(e.message, "err"); }
    });
  }

  // ------------------------------------------------------------------ rapport de veille (sélection des produits, exports, envoi)
  const RPT_KEY = "certansie-report-watches";
  const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const EXPORTS = [
    ["docx", "Word", "word", "Document Word modifiable (.docx)"],
    ["pptx", "PowerPoint", "slides", "Présentation pour réunion (.pptx)"],
    ["pdf", "PDF", "pdf", "Document PDF prêt à diffuser"],
    ["xlsx", "Excel", "sheet", "Tableaux exploitables (.xlsx)"],
    ["html", "HTML", "code", "Page web autonome (.html)"],
  ];

  async function pageReport(c, params) {
    const days = ["7", "14", "30", "90"].includes(params.days) ? params.days : "7";
    // Sélection des produits : URL > dernière sélection mémorisée > tout le périmètre
    let watches = params.watches;
    if (watches == null) { try { const sv = localStorage.getItem(RPT_KEY); watches = sv === null ? "all" : sv; } catch { watches = "all"; } }
    const general = params.general !== "0";
    c.innerHTML = `<div class="page-head"><div><h1>Rapport de veille</h1><p>Préparation…</p></div></div><div class="card" style="padding:24px"><div class="skeleton"></div></div>`;
    const qs = new URLSearchParams({ days, watches, general: general ? "true" : "false" }).toString();
    const d = await api(`/api/report?${qs}`);
    const selected = new Set(d.selected);
    const k = d.kpi;
    const tri = d.triage || {};
    const triTotal = Object.values(tri).reduce((a, b) => a + b, 0);
    const tile = (label, value, color, extra = "") => `<div class="rep-tile" style="--c:${color}"><div class="v">${nf(value)}</div><div class="l">${label}${extra}</div></div>`;
    const go = (patch) => {
      const np = { days, watches, general: general ? "1" : "0", ...patch };
      if (np.watches !== undefined) { try { localStorage.setItem(RPT_KEY, np.watches); } catch {} }
      location.hash = "#/report?" + new URLSearchParams(np);
    };
    const setSel = (ids) => go({ watches: ids.length === d.watches.filter((w) => w.enabled).length && ids.every((id) => d.watches.find((w) => w.id === id)?.enabled) ? "all" : ids.join(",") });
    const statusBar = Object.keys(STATUS).map((s) => tri[s] ? `<i class="st-${s}" style="flex:${tri[s]}" title="${STATUS[s]} : ${tri[s]}"></i>` : "").join("");
    const notSel = d.watches.filter((w) => !selected.has(w.id));

    c.innerHTML = `
      <div class="page-head no-print"><div><h1>Rapport de veille</h1><p>Choisissez les produits, vérifiez l'aperçu, puis exportez ou envoyez le bulletin à l'équipe</p></div>
        <div class="chips">${[["7", "7 jours"], ["14", "14 jours"], ["30", "30 jours"], ["90", "90 jours"]].map(([v, l]) => `<button data-days="${v}" class="${v === days ? "on" : ""}">${l}</button>`).join("")}</div></div>

      <div class="card rpt-panel no-print">
        <div class="rpt-step"><span class="rpt-num">1</span><div style="flex:1;min-width:0">
          <div class="rpt-title">Produits inclus dans le rapport <span class="faint">(${selected.size} sur ${d.watches.length})</span></div>
          <div class="rpt-chips">${d.watches.filter((w) => selected.has(w.id)).map((w) => `
            <span class="rpt-chip">${esc(w.name)}<button data-rm="${w.id}" title="Retirer ${esc(w.name)} du rapport">${icon("x")}</button></span>`).join("") || '<span class="faint">Aucun produit sélectionné : le rapport ne contiendra que la veille générale.</span>'}
            ${notSel.length ? `<select id="rpt-add" class="rpt-add"><option value="">+ Ajouter un produit…</option>${notSel.map((w) => `<option value="${w.id}">${esc(w.name)}${w.enabled ? "" : " (inactif)"}</option>`).join("")}</select>` : ""}
          </div>
          <div class="rpt-links">
            <button class="btn ghost sm" id="rpt-all">Tout le périmètre</button>
            <button class="btn ghost sm" id="rpt-none">Tout retirer</button>
            ${can("watch.edit") ? `<button class="btn ghost sm" id="rpt-new">${icon("plus")} Nouveau produit à surveiller</button>` : ""}
            <label class="toggle" style="margin-left:auto"><input type="checkbox" id="rpt-general" ${general ? "checked" : ""}> Inclure la veille générale (tous les ajouts KEV, tous les bulletins CERT-FR)</label>
          </div>
        </div></div>
        <div class="rpt-step"><span class="rpt-num">2</span><div style="flex:1;min-width:0">
          <div class="rpt-title">Exporter ou partager</div>
          <div class="rpt-actions">
            ${EXPORTS.map(([f, l, ic, tip]) => `<a class="btn rpt-btn rpt-${f}" href="/api/report/export?format=${f}&${qs}" title="${tip}">${icon(ic)} ${l}</a>`).join("")}
            <button class="btn rpt-btn" id="rprint" title="Imprimer l'aperçu ci-dessous">${icon("print")} Imprimer</button>
            ${can("report.send") ? `<button class="btn primary rpt-btn" id="rsend">${icon("mail")} Envoyer à l'équipe</button>` : ""}
          </div>
        </div></div>
      </div>

      <article class="report">
        <div class="classif ${tlpClass(d.classification)} rep-classif">${icon("lock")}<span>${esc(d.classification)}</span></div>
        <header class="rep-head">
          <div class="brand" style="padding:0"><div class="brand-logo">${icon("shield")}</div>
            <div><div class="brand-name">${esc(d.app)}</div><div class="brand-org">${esc(d.org)} · Équipe SSI</div></div></div>
          <div class="rep-meta">Édité le ${fmtDate(d.generated_at, true)}<br>par ${esc(d.generated_by)}</div>
        </header>
        <h1 class="rep-title">Bulletin de veille des vulnérabilités</h1>
        <div class="rep-period">Période du ${fmtDate(d.start)} au ${fmtDate(d.end)} (${d.days} jours)</div>
        <div class="rep-period" style="font-size:13px">Produits couverts : <b>${esc(d.products.join(", ") || "aucun")}</b></div>

        <section><h2 class="rep-h">1. Synthèse</h2>
          <div class="rep-tiles">
            ${tile("Vulnérabilités sur les produits", k.scope_new, "var(--accent)")}${tile("Priorité P1", k.p1, "var(--crit)")}${tile("Priorité P2", k.p2, "var(--high)")}
            ${tile("Ajouts KEV", k.kev_new, "#b3261e", `<span class="faint"> (dont ${nf(k.kev_new_scope)} sur les produits)</span>`)}
            ${tile("Alertes CERT-FR", k.certfr_alertes, "var(--accent-2)")}${tile("Nouvelles CVE (monde)", k.cve_new, "var(--none)")}
          </div>
          <ul class="rep-facts">${d.facts.map((f) => `<li>${rich(f)}</li>`).join("")}</ul>
        </section>

        <section><h2 class="rep-h">2. Actions recommandées</h2>
          <ol class="rep-facts">${d.actions.map((a) => `<li>${rich(a)}</li>`).join("")}</ol></section>

        <section><h2 class="rep-h">3. Vulnérabilités prioritaires (P1 / P2)</h2>
          ${d.priority_items.length ? `<table class="rep-table"><thead><tr><th>Prio.</th><th>Identifiant</th><th>Produit</th><th>CVSS</th><th>EPSS</th><th>Description</th><th>Statut</th></tr></thead><tbody>
            ${d.priority_items.map((v) => `<tr data-vuln="${esc(v.id)}"><td>${prioBadge(v.priority)}</td><td class="vid">${esc(v.id)}${v.kev ? `<div>${kevBadge(v)}</div>` : ""}</td>
              <td>${esc(v.watches.join(", "))}</td><td class="mono">${v.cvss_score ?? "N/É"}</td><td class="mono">${v.epss != null ? (v.epss * 100).toFixed(1) + " %" : "—"}</td>
              <td class="rep-desc">${v.title ? `<b>${esc(v.title)}</b> — ` : ""}${esc(v.description)}</td><td>${statusCell(v)}</td></tr>`).join("")}</tbody></table>`
            : '<p class="muted">Aucune vulnérabilité P1/P2 sur les produits sélectionnés pour cette période.</p>'}</section>

        <section class="rep-cols">
          <div><h2 class="rep-h">4. Répartition par produit</h2>
            ${d.by_watch.length ? `<table class="rep-table"><thead><tr><th>Produit</th><th>Total</th><th>P1</th><th>P2</th><th>KEV</th><th>CVSS max</th></tr></thead><tbody>
              ${d.by_watch.map((w) => `<tr><td><b>${esc(w.name)}</b></td><td class="mono">${w.total}</td><td class="mono" style="color:${w.p1 ? "var(--crit)" : "inherit"}">${w.p1}</td><td class="mono">${w.p2}</td><td class="mono">${w.kev}</td><td class="mono">${w.max_cvss ?? "—"}</td></tr>`).join("")}</tbody></table>`
              : '<p class="muted">Aucune nouveauté sur les produits sélectionnés.</p>'}</div>
          <div><h2 class="rep-h">5. Suivi du traitement (P1/P2)</h2>
            ${triTotal ? `<div class="rep-statusbar">${statusBar}</div>
              <table class="rep-table"><tbody>${Object.entries(STATUS).map(([s, l]) => `<tr><td>${statusBadge(s)}</td><td class="mono">${nf(tri[s] || 0)}</td></tr>`).join("")}</tbody></table>`
              : '<p class="muted">Aucune vulnérabilité P1/P2 suivie.</p>'}</div>
        </section>

        <section><h2 class="rep-h">6. Nouvelles vulnérabilités exploitées (CISA KEV)</h2>
          ${d.kev_new.length ? `<table class="rep-table"><thead><tr><th>Identifiant</th><th>Vulnérabilité</th><th>Ajout</th><th>Échéance</th><th>Produit</th></tr></thead><tbody>
            ${d.kev_new.map((v) => `<tr data-vuln="${esc(v.id)}"><td class="vid">${esc(v.id)}</td><td>${esc(v.title || v.description)}</td><td class="nowrap">${fmtDate(v.kev_added)}</td><td class="nowrap">${fmtDate(v.kev_due)}</td>
              <td>${v.watches.length ? `<span class="badge tag accent">${esc(v.watches.join(", "))}</span>` : '<span class="faint">—</span>'}</td></tr>`).join("")}</tbody></table>`
            : '<p class="muted">Aucun ajout au catalogue sur la période.</p>'}</section>

        <section><h2 class="rep-h">7. Bulletins CERT-FR</h2>
          ${d.bulletins.length ? `<ul class="rep-bul">${d.bulletins.map((b) => `<li><span class="badge ${b.kind === "alerte" ? "sev-CRITICAL" : "tag"}">${esc(b.kind)}</span>
            <a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">${esc(b.title)}</a> <span class="faint">· ${fmtDate(b.published)}</span></li>`).join("")}</ul>`
            : '<p class="muted">Aucun bulletin CERT-FR sur la période.</p>'}</section>

        <footer class="rep-foot"><span>${esc(d.classification)}</span><span>Document généré automatiquement par ${esc(d.app)} — sources : NVD, CISA KEV, FIRST EPSS, CVE.org, CERT-FR, GitHub</span></footer>
      </article>`;

    $$("[data-days]", c).forEach((b) => b.addEventListener("click", () => go({ days: b.dataset.days })));
    $$("[data-rm]", c).forEach((b) => b.addEventListener("click", () => setSel([...selected].filter((id) => id !== +b.dataset.rm))));
    $("#rpt-add")?.addEventListener("change", (e) => { if (e.target.value) setSel([...selected, +e.target.value]); });
    $("#rpt-all").addEventListener("click", () => go({ watches: "all" }));
    $("#rpt-none").addEventListener("click", () => go({ watches: "" }));
    $("#rpt-general").addEventListener("change", (e) => go({ general: e.target.checked ? "1" : "0" }));
    $("#rprint").addEventListener("click", () => window.print());
    $$(".rpt-btn[href]", c).forEach((a) => a.addEventListener("click", () => toast(`Génération du fichier ${a.textContent.trim()}…`, "ok")));
    $("#rpt-new")?.addEventListener("click", () => {
      modal("Nouveau produit à surveiller", watchForm(), async (f) => {
        const r = await api("/api/watchlist", { method: "POST", body: watchBody(f) });
        watchCache = null;
        toast("Produit ajouté au périmètre et au rapport. L'historique sera récupéré à la prochaine synchronisation.", "ok");
        setTimeout(() => setSel([...selected, r.id]), 900);
      }, "Ajouter");
      bindPreset();
    });
    $("#rsend")?.addEventListener("click", () => openSendDialog(d, qs));
  }

  async function openSendDialog(d, qs) {
    let info;
    try { info = await api("/api/report/recipients"); } catch (e) { toast(e.message, "err"); return; }
    const defaults = new Set(info.default_to.map((x) => x.toLowerCase()));
    modal("Envoyer le rapport à l'équipe", `
      ${!info.smtp ? `<div class="alert-kev" style="font-size:13px">${icon("alert")} <b>Aucun serveur e-mail configuré.</b> Renseignez <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> et <code>SMTP_FROM</code> dans <code>/etc/vulnwatch/vulnwatch.env</code>, puis redémarrez le service. En attendant, téléchargez le fichier et joignez-le à votre messagerie.</div>` : ""}
      <div class="field"><label>Format de la pièce jointe</label>
        <div class="fmt-pick">${EXPORTS.map(([f, l, ic], i) => `<label class="fmt-opt"><input type="radio" name="format" value="${f}" ${f === "pdf" ? "checked" : ""}><span>${icon(ic)} ${l}</span></label>`).join("")}</div></div>
      <div class="field"><label>Destinataires</label>
        <div class="rcpt-list">${info.users.map((u) => `<label class="rcpt"><input type="checkbox" name="to" value="${esc(u.email)}" ${defaults.has(u.email.toLowerCase()) ? "checked" : ""}>
          ${avatar(u.name)}<span><b>${esc(u.name)}</b><span class="faint">${esc(u.role_label)} · ${esc(u.email)}</span></span></label>`).join("") || '<div class="faint" style="font-size:12.5px">Aucun compte avec une adresse e-mail. Renseignez les e-mails dans Administration › Utilisateurs.</div>'}</div></div>
      <div class="field"><label>Autres adresses <span class="faint">(séparées par des virgules)</span></label>
        <input name="extra" placeholder="rssi@ansie.dj, equipe-reseau@ansie.dj" value="${esc(info.default_to.filter((a) => !info.users.some((u) => u.email.toLowerCase() === a.toLowerCase())).join(", "))}"></div>
      <div class="field"><label>Message d'accompagnement <span class="faint">(facultatif)</span></label>
        <textarea name="message" placeholder="Bonjour, veuillez trouver ci-joint le bulletin de veille de la semaine. Merci de traiter en priorité les vulnérabilités P1.">${esc(`Bonjour,\n\nVeuillez trouver ci-joint le bulletin de veille des vulnérabilités (${d.days} jours) couvrant : ${d.products.join(", ") || "veille générale"}.\n\nCordialement,\n${ME.user.full_name}\n${ME.org}`)}</textarea></div>
      <div class="hint">${icon("lock")} Le rapport porte le marquage <b>${esc(d.classification)}</b> : vérifiez que les destinataires sont autorisés à le recevoir.</div>`,
      async (f) => {
        const recipients = [...f.getAll("to"), ...String(f.get("extra") || "").split(/[,;\s]+/)].map((x) => x.trim()).filter(Boolean);
        if (!recipients.length) throw new Error("Choisissez au moins un destinataire");
        const p = Object.fromEntries(new URLSearchParams(qs));
        const r = await api("/api/report/send", { method: "POST", body: { format: f.get("format"), days: +p.days, watches: p.watches, general: p.general === "true", recipients, message: f.get("message") } });
        toast(`Rapport envoyé à ${r.sent_to.length} destinataire(s)`, "ok");
      }, "Envoyer");
  }

  // ------------------------------------------------------------------ correctifs & nouveautés (jour par jour)
  const PERIODS = [["today", "Aujourd'hui"], ["yesterday", "Hier"], ["week", "Cette semaine"], ["lastweek", "Semaine dernière"], ["7d", "7 jours"], ["30d", "30 jours"]];
  const KIND_STYLE = { alerte: ["alert", "var(--crit)"], avis: ["news", "var(--accent)"], correctif: ["patch", "var(--ok)"], usn: ["patch", "#e95420"],
    version: ["download", "#8b5cf6"], advisory: ["news", "var(--high)"] };
  const dayTitle = (d) => {
    const s = new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const t = new Date(); const iso = (x) => x.toISOString().slice(0, 10);
    const y = new Date(t); y.setDate(t.getDate() - 1);
    const tag = d === iso(new Date(t.getTime() - t.getTimezoneOffset() * 60000)) ? "Aujourd'hui · " : d === iso(new Date(y.getTime() - y.getTimezoneOffset() * 60000)) ? "Hier · " : "";
    return tag + s.charAt(0).toUpperCase() + s.slice(1);
  };

  async function pagePatches(c, params) {
    const p = { period: "today", scope: "watch", ...params };
    const go = (patch) => {
      const np = { ...p, ...patch };
      if (patch.period && patch.period !== "custom") { delete np.start; delete np.end; }
      Object.keys(np).forEach((k) => (np[k] === "" || np[k] == null) && delete np[k]);
      location.hash = "#/patches?" + new URLSearchParams(np);
    };
    c.innerHTML = `<div class="page-head"><div><h1>Correctifs & nouveautés</h1><p>Chargement…</p></div></div><div class="card" style="padding:24px"><div class="skeleton"></div></div>`;
    const d = await api("/api/patches?" + new URLSearchParams(p));
    const k = d.counts;
    const tile = (label, value, sub, color, ic) => `<div class="card kpi" style="--kpi-color:${color};cursor:default"><span class="bar"></span>
      <div class="label">${icon(ic)}${label}</div><div class="value">${nf(value)}</div><div class="sub">${sub}</div></div>`;
    const prodBadges = (ps) => ps.map((x) => `<span class="badge tag accent">${esc(x)}</span>`).join("");
    const item = (i) => {
      if (i.type === "bulletin") {
        const [ic, col] = KIND_STYLE[i.kind] || ["news", "var(--muted)"];
        return `<a class="pt-item" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer" style="--pt:${col}">
          <span class="pt-ic">${icon(ic)}</span>
          <div class="pt-body"><div class="pt-title">${esc(i.title)}</div>
            ${i.summary ? `<div class="pt-sum">${esc(i.summary)}</div>` : ""}
            <div class="li-meta"><span class="badge tag">${esc(i.source)}</span><span class="badge" style="color:${col};background:color-mix(in srgb, ${col} 13%, transparent)">${esc(i.kind_label)}</span>
              ${i.priority ? prioBadge(i.priority) : ""}${i.kev ? kevBadge(i) : ""}${prodBadges(i.products)}
              ${i.cve_count ? `<span>${i.cve_count} CVE</span>` : ""}<span>${fmtDate(i.date, true)}</span></div></div>
          <span class="pt-go">${icon("ext")}</span></a>`;
      }
      if (i.type === "kev") {
        return `<div class="pt-item" data-vuln="${esc(i.id)}" style="--pt:#e5484d"><span class="pt-ic">${icon("fire")}</span>
          <div class="pt-body"><div class="pt-title"><span class="vid">${esc(i.id)}</span> · ${esc(i.title)}</div>
            <div class="li-meta"><span class="badge kev">${icon("fire")} Ajout CISA KEV</span>${prioBadge(i.priority)}${prodBadges(i.products)}
              ${i.due ? `<span>Échéance CISA ${fmtDate(i.due)}</span>` : ""}${statusBadge(i.status)}</div></div></div>`;
      }
      return `<div class="pt-item" data-vuln="${esc(i.id)}" style="--pt:var(--accent)"><span class="pt-ic">${icon("bug")}</span>
        <div class="pt-body"><div class="pt-title">${prioBadge(i.priority)} <span class="vid">${esc(i.id)}</span> · ${esc(i.title)}</div>
          <div class="li-meta">${i.patch ? `<span class="badge st-done">${icon("check")} Correctif disponible</span>` : '<span class="badge na-badge" title="Aucune référence de correctif ou d\'avis éditeur pour l\'instant">Correctif non référencé</span>'}
            ${prodBadges(i.products)}<span>CVSS ${i.cvss ?? "N/É"}</span>${i.kev ? kevBadge(i) : ""}${statusBadge(i.status)}</div></div></div>`;
    };
    const total = d.days.reduce((n, x) => n + x.items.length, 0);
    c.innerHTML = `
      <div class="page-head"><div><h1>Correctifs & nouveautés</h1>
        <p>Ce qui est sorti : correctifs des éditeurs, avis et alertes CERT-FR, nouvelles vulnérabilités et ajouts KEV — <b>${esc(d.label)}</b>
        <span class="faint">(${fmtDate(d.start)}${d.label === "Aujourd'hui" ? "" : ` → ${fmtDate(d.end)}`})</span></p></div></div>
      <div class="filters">
        <div class="chips">${PERIODS.map(([v, l]) => `<button data-period="${v}" class="${p.period === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <form class="pt-custom" id="pt-custom"><span class="faint">Du</span><input type="date" name="start" value="${esc(p.start || "")}" required>
          <span class="faint">au</span><input type="date" name="end" value="${esc(p.end || "")}"><button class="btn sm ${p.period === "custom" ? "primary" : ""}">OK</button></form>
      </div>
      <div class="filters">
        <div class="chips">${[["watch", "Mon périmètre"], ["all", "Tout"]].map(([v, l]) => `<button data-scope="${v}" class="${p.scope === v ? "on" : ""}">${l}</button>`).join("")}</div>
        ${d.sources.length > 1 || p.source ? `<div class="chips">${["", ...(p.source && !d.sources.includes(p.source) ? [p.source, ...d.sources] : d.sources)].map((s) => `<button data-src="${esc(s)}" class="${(p.source || "") === s ? "on" : ""}">${esc(s || "Toutes sources")}</button>`).join("")}</div>` : ""}
      </div>
      <div class="grid kpis">
        ${tile("Correctifs & avis éditeurs", k.patches, "Microsoft, Fortinet, Cisco, Ubuntu, Debian, CERT-FR…", "var(--ok)", "patch")}
        ${tile("Alertes CERT-FR", k.alerts, `${nf(k.certfr)} publication(s) CERT-FR au total`, "var(--crit)", "alert")}
        ${tile("Nouvelles vulnérabilités", k.vulns, `dont ${nf(k.vulns_patch)} avec correctif disponible`, "var(--accent)", "bug")}
        ${tile("Ajouts CISA KEV", k.kev, "Exploitation active confirmée", "#e5484d", "fire")}
        ${tile("Priorité P1", k.p1, "À traiter immédiatement", "var(--high)", "bell")}
      </div>
      ${d.truncated ? `<div class="faint" style="margin:-4px 0 12px;font-size:12.5px">${icon("alert")} Affichage limité aux 400 vulnérabilités les plus prioritaires de la période.</div>` : ""}
      ${total ? d.days.map((day) => `
        <section class="pt-day">
          <div class="pt-day-head"><h2>${esc(dayTitle(day.date))}</h2><span class="faint">${day.items.length} élément(s)</span></div>
          <div class="pt-list">${day.items.map(item).join("")}</div>
        </section>`).join("") : `
        <div class="card empty">${icon("inbox")}<div><b>Rien de publié pour cette période${p.scope === "watch" ? " sur votre périmètre" : ""}.</b><br>
          <span class="faint">${p.scope === "watch" ? "Essayez « Tout » pour voir l'ensemble des publications, ou une période plus large." : "Lancez une synchronisation ou choisissez une période plus large."}</span></div></div>`}
      <p class="faint" style="font-size:12px;margin-top:16px">${icon("clock")} Heures affichées dans votre fuseau ; journées calculées en heure de ${esc(d.timezone)}. L'historique des correctifs éditeurs s'accumule depuis l'installation de la plateforme (les flux des éditeurs ne conservent que leurs dernières publications).</p>`;

    $$("[data-period]", c).forEach((b) => b.addEventListener("click", () => go({ period: b.dataset.period })));
    $$("[data-scope]", c).forEach((b) => b.addEventListener("click", () => go({ scope: b.dataset.scope })));
    $$("[data-src]", c).forEach((b) => b.addEventListener("click", () => go({ source: b.dataset.src })));
    $("#pt-custom").addEventListener("submit", (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      go({ period: "custom", start: f.get("start"), end: f.get("end") || f.get("start") });
    });
  }

  // ------------------------------------------------------------------ changement de mot de passe obligatoire
  function showForceChange() {
    const u = ME?.user || {};
    $("#root").innerHTML = `
      <div class="login-split">
        <section class="login-hero" aria-hidden="true"><img src="/static/login-banner.jpg" alt=""></section>
        <section class="login-side"><div class="login-box">
          <div class="brand"><div class="brand-logo">${icon("shield")}</div>
            <div><div class="brand-name">${esc(ME?.app || "CERT-ANSIE")}</div><div class="brand-org">${esc(ME?.org || "")}</div></div></div>
          <div class="login-kicker">Première connexion</div>
          <h1>Définissez votre mot de passe</h1>
          <p class="muted" style="margin:6px 0 22px">Bonjour ${esc(u.full_name || "")}, pour des raisons de sécurité vous devez remplacer le mot de passe temporaire fourni par l'administrateur.</p>
          <form id="fc-form">
            <div class="field-icon"><label>Mot de passe temporaire</label>${icon("key")}<input type="password" name="current" required autocomplete="current-password" autofocus></div>
            <div class="field-icon"><label>Nouveau mot de passe</label>${icon("lock")}<input type="password" name="new" id="fc-new" required autocomplete="new-password"></div>
            <div id="fc-meter">${pwMeter("", u.username)}</div>
            <div class="field-icon"><label>Confirmation</label>${icon("lock")}<input type="password" name="confirm" required autocomplete="new-password"></div>
            <div class="error" id="fc-err"></div>
            <button class="btn primary lg" type="submit">Valider et accéder à la plateforme</button>
          </form>
          <div class="login-foot"><a href="#" data-action="logout">Se déconnecter</a></div>
        </div></section>
      </div>`;
    $("#fc-new").addEventListener("input", (e) => { $("#fc-meter").innerHTML = pwMeter(e.target.value, u.username); });
    $("#fc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get("new") !== f.get("confirm")) { $("#fc-err").textContent = "La confirmation ne correspond pas"; return; }
      try {
        await api("/api/me/password", { method: "POST", body: { current: f.get("current"), new: f.get("new") } });
        toast("Mot de passe défini. Bienvenue !", "ok");
        await boot();
      } catch (er) { $("#fc-err").textContent = er.message; }
    });
  }

  // ------------------------------------------------------------------ mon compte
  async function pageAccount(c) {
    ME = await api("/api/me");
    const u = ME.user;
    c.innerHTML = `
      <div class="page-head"><div><h1>Mon compte</h1><p>Profil, sécurité et droits associés à votre rôle</p></div></div>
      <div class="grid cols-2-eq">
        <div class="card"><div class="card-body" style="padding-top:20px">
          <div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">${avatar(u.full_name, "xl")}
            <div><h2 style="font-size:18px">${esc(u.full_name)}</h2><div class="muted mono" style="font-size:12.5px">${esc(u.username)}</div><div style="margin-top:6px">${roleBadge(u.role, u.role_label)}</div></div></div>
          <form id="prof-form" style="display:flex;flex-direction:column;gap:14px">
            <div class="field"><label>Nom complet</label><input name="full_name" value="${esc(u.full_name)}" maxlength="120"></div>
            <div class="field"><label>E-mail (pour recevoir les actions assignées)</label><input name="email" type="email" value="${esc(u.email)}" maxlength="200"></div>
            <div style="display:flex;justify-content:flex-end"><button class="btn primary sm">Enregistrer le profil</button></div>
          </form>
          <dl class="kv" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
            <dt>Dernière connexion</dt><dd>${fmtDate(u.last_login, true)} ${u.last_ip ? `<span class="faint">depuis ${esc(u.last_ip)}</span>` : ""}</dd>
            <dt>Compte créé</dt><dd>${fmtDate(u.created_at)} <span class="faint">par ${esc(u.created_by || "—")}</span></dd>
            <dt>Droits</dt><dd>${u.perms.length ? u.perms.map((p) => `<span class="badge tag mono" style="margin:0 4px 4px 0">${esc(p)}</span>`).join("") : "lecture seule"}</dd>
          </dl>
        </div></div>
        <div class="card"><div class="card-body" style="padding-top:20px">
          <h2 style="margin-bottom:4px">${icon("key")} Changer de mot de passe</h2>
          <p class="muted" style="margin:0 0 16px;font-size:13px">Toutes vos autres sessions ouvertes seront déconnectées.</p>
          <form id="pw-form" style="display:flex;flex-direction:column;gap:14px">
            <div class="field"><label>Mot de passe actuel</label><input type="password" name="current" required autocomplete="current-password"></div>
            <div class="field"><label>Nouveau mot de passe</label><input type="password" name="new" id="pw-new" required autocomplete="new-password"></div>
            <div id="pw-meter">${pwMeter("", u.username)}</div>
            <div class="field"><label>Confirmation</label><input type="password" name="confirm" required autocomplete="new-password"></div>
            <div style="display:flex;justify-content:flex-end"><button class="btn primary sm">Mettre à jour le mot de passe</button></div>
          </form>
        </div></div>
      </div>`;
    $("#pw-new").addEventListener("input", (e) => { $("#pw-meter").innerHTML = pwMeter(e.target.value, u.username); });
    $("#prof-form").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      try { await api("/api/me", { method: "PUT", body: { full_name: f.get("full_name"), email: f.get("email") } }); toast("Profil mis à jour", "ok"); ME = await api("/api/me"); renderLayout(); route(); }
      catch (er) { toast(er.message, "err"); }
    });
    $("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      if (f.get("new") !== f.get("confirm")) { toast("La confirmation ne correspond pas", "err"); return; }
      try { await api("/api/me/password", { method: "POST", body: { current: f.get("current"), new: f.get("new") } }); toast("Mot de passe modifié", "ok"); e.target.reset(); $("#pw-meter").innerHTML = pwMeter("", u.username); }
      catch (er) { toast(er.message, "err"); }
    });
  }

  // ------------------------------------------------------------------ administration : utilisateurs
  function showSecret(title, username, pw) {
    modal(title, `
      <p style="margin:0">Communiquez ce mot de passe temporaire à <b>${esc(username)}</b> par un canal sûr (en main propre, téléphone). Il ne sera <b>plus jamais affiché</b>. L'utilisateur devra le changer à sa première connexion.</p>
      <div class="secret"><code id="secret-pw">${esc(pw)}</code><button type="button" class="btn sm" id="secret-copy">${icon("copy")} Copier</button></div>`,
      async () => {}, "J'ai transmis le mot de passe");
    $("#modal .modal-foot .btn.ghost")?.remove();
    $("#secret-copy").addEventListener("click", () => copyText(pw));
  }

  function userForm(u, roles) {
    const isNew = !u;
    u = u || { role: "analyst", active: true };
    return `
      ${isNew ? `<div class="field"><label>Identifiant de connexion</label><input name="username" required pattern="[A-Za-z0-9._@\\-]+" maxlength="60" placeholder="ex : a.hassan" autocomplete="off"></div>` : `<div class="field"><label>Identifiant</label><div class="ro mono">${esc(u.username)}</div></div>`}
      <div class="field"><label>Nom complet</label><input name="full_name" value="${esc(u.full_name || "")}" maxlength="120" placeholder="ex : Ahmed Hassan" required></div>
      <div class="field"><label>E-mail</label><input name="email" type="email" value="${esc(u.email || "")}" maxlength="200" placeholder="prenom.nom@ansie.dj"></div>
      <div class="field"><label>Rôle</label>
        <div class="role-pick">${Object.entries(roles).map(([k, r]) => `
          <label class="role-opt"><input type="radio" name="role" value="${k}" ${u.role === k ? "checked" : ""}>
            <span><b>${esc(r.label)}</b><span class="faint">${esc(r.desc)}</span></span></label>`).join("")}</div></div>
      ${isNew ? `<div class="hint">${icon("key")} Un mot de passe temporaire robuste sera généré ; l'utilisateur devra le changer à sa première connexion.</div>` :
        `<label class="toggle"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Compte actif <span class="faint">(décocher révoque immédiatement l'accès)</span></label>`}`;
  }

  async function pageUsers(c) {
    if (!can("users.manage")) { c.innerHTML = `<div class="card empty">${icon("lock")}<div>Accès réservé aux administrateurs.</div></div>`; return; }
    const d = await api("/api/users");
    const counts = {};
    d.users.forEach((u) => { if (u.active) counts[u.role] = (counts[u.role] || 0) + 1; });
    const stateBadge = (u) => !u.active ? '<span class="badge st-na">Désactivé</span>' : u.locked ? '<span class="badge sev-CRITICAL">Verrouillé</span>'
      : u.must_change ? '<span class="badge st-analysis">Mot de passe à définir</span>' : '<span class="badge st-done">Actif</span>';
    c.innerHTML = `
      <div class="page-head"><div><h1>Utilisateurs & rôles</h1><p>${d.users.length} compte(s) · gérez les accès de l'équipe SSI, des administrateurs réseau et des développeurs</p></div>
        <button class="btn primary" id="uadd">${icon("plus")} Nouveau compte</button></div>
      <div class="role-cards">${Object.entries(d.roles).map(([k, r]) => `
        <div class="card role-card"><div style="display:flex;justify-content:space-between;align-items:center">${roleBadge(k, r.label)}<span class="num">${counts[k] || 0}</span></div>
          <div class="faint" style="font-size:12px;margin-top:8px">${esc(r.desc)}</div></div>`).join("")}</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Utilisateur</th><th>Rôle</th><th>État</th><th>Dernière connexion</th><th>Actions ouvertes</th><th></th></tr></thead>
        <tbody>${d.users.map((u) => `
          <tr style="cursor:default;${u.active ? "" : "opacity:.55"}">
            <td><div style="display:flex;gap:10px;align-items:center">${avatar(u.full_name)}<div><div class="li-title">${esc(u.full_name)} ${u.id === ME.user.id ? '<span class="badge tag">vous</span>' : ""}</div>
              <div class="faint mono" style="font-size:12px">${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ""}</div></div></div></td>
            <td>${roleBadge(u.role, u.role_label)}</td>
            <td>${stateBadge(u)}</td>
            <td class="muted nowrap">${u.last_login ? `${fmtDate(u.last_login, true)}<div class="faint" style="font-size:11.5px">${esc(u.last_ip || "")}</div>` : '<span class="faint">jamais</span>'}</td>
            <td><a href="#/vulns?assignee=${u.id}&status=new,analysis,action" class="num" style="text-align:left">${nf(u.open_tasks)}</a></td>
            <td class="nowrap" style="text-align:right">
              <button class="btn ghost sm" data-uedit="${u.id}" title="Modifier">${icon("edit")}</button>
              <button class="btn ghost sm" data-ureset="${u.id}" title="Réinitialiser le mot de passe">${icon("key")}</button>
              ${u.locked ? `<button class="btn ghost sm" data-uunlock="${u.id}" title="Déverrouiller">${icon("unlock")}</button>` : ""}
              ${u.id !== ME.user.id ? `<button class="btn ghost sm danger" data-udel="${u.id}" title="Supprimer">${icon("trash")}</button>` : ""}
            </td></tr>`).join("")}</tbody></table></div></div>
      <p class="faint" style="margin-top:14px;font-size:12.5px">${icon("lock")} Mots de passe stockés de façon irréversible (scrypt) · verrouillage automatique après 5 échecs · toutes les actions sont tracées dans le <a href="#/audit">journal d'audit</a>.</p>`;

    $("#uadd").addEventListener("click", () => {
      modal("Nouveau compte", userForm(null, d.roles), async (f) => {
        const r = await api("/api/users", { method: "POST", body: { username: f.get("username"), full_name: f.get("full_name"), email: f.get("email"), role: f.get("role") } });
        assigneeCache = null;
        setTimeout(() => { showSecret("Compte créé", f.get("username"), r.temp_password); route(); }, 50);
      }, "Créer le compte");
    });
    c.onclick = async (e) => {
      const b = e.target.closest("[data-uedit],[data-ureset],[data-uunlock],[data-udel]");
      if (!b) return;
      const id = +(b.dataset.uedit || b.dataset.ureset || b.dataset.uunlock || b.dataset.udel);
      const u = d.users.find((x) => x.id === id);
      try {
        if (b.dataset.uedit) {
          modal(`Modifier — ${u.full_name}`, userForm(u, d.roles), async (f) => {
            await api(`/api/users/${id}`, { method: "PUT", body: { full_name: f.get("full_name"), email: f.get("email"), role: f.get("role"), active: f.get("active") === "on" } });
            toast("Compte mis à jour", "ok"); assigneeCache = null; route();
          });
        } else if (b.dataset.ureset) {
          if (!confirm(`Réinitialiser le mot de passe de ${u.full_name} ? Ses sessions ouvertes seront fermées.`)) return;
          const r = await api(`/api/users/${id}/reset-password`, { method: "POST" });
          showSecret("Mot de passe réinitialisé", u.username, r.temp_password); route();
        } else if (b.dataset.uunlock) {
          await api(`/api/users/${id}/unlock`, { method: "POST" }); toast("Compte déverrouillé", "ok"); route();
        } else if (b.dataset.udel) {
          if (!confirm(`Supprimer définitivement le compte de ${u.full_name} ?\nSes ${u.open_tasks} action(s) ouverte(s) seront désassignées. Préférez « désactiver » pour conserver l'historique.`)) return;
          await api(`/api/users/${id}`, { method: "DELETE" }); toast("Compte supprimé"); assigneeCache = null; route();
        }
      } catch (er) { toast(er.message, "err"); }
    };
  }

  // ------------------------------------------------------------------ administration : journal d'audit
  const ACTION_FR = {
    "login.ok": ["Connexion", "st-done"], "login.fail": ["Échec de connexion", "sev-HIGH"], "login.locked": ["Compte verrouillé", "sev-CRITICAL"],
    "logout": ["Déconnexion", "tag"], "password.change": ["Mot de passe modifié", "tag"], "password.change_fail": ["Échec changement mot de passe", "sev-HIGH"],
    "profile.update": ["Profil modifié", "tag"], "user.create": ["Compte créé", "st-new"], "user.update": ["Compte modifié", "st-new"],
    "user.reset_password": ["Mot de passe réinitialisé", "st-analysis"], "user.unlock": ["Compte déverrouillé", "st-analysis"], "user.delete": ["Compte supprimé", "sev-CRITICAL"],
    "triage.update": ["Qualification", "tag accent"], "triage.checklist": ["Action de remédiation", "st-done"], "triage.assign": ["Assignation", "tag accent"], "watch.create": ["Périmètre : ajout", "tag"],
    "watch.update": ["Périmètre : modification", "tag"], "watch.delete": ["Périmètre : suppression", "sev-HIGH"], "sync.start": ["Synchronisation", "tag"],
    "export.csv": ["Export CSV", "st-analysis"], "report.export": ["Export du rapport", "st-analysis"], "report.send": ["Rapport envoyé", "st-new"],
  };
  async function pageAudit(c, params) {
    if (!can("audit.read")) { c.innerHTML = `<div class="card empty">${icon("lock")}<div>Accès réservé aux administrateurs.</div></div>`; return; }
    const p = { page: "1", ...params };
    const d = await api("/api/audit?" + new URLSearchParams(p));
    const setP = (patch) => { const np = { ...p, page: "1", ...patch }; Object.keys(np).forEach((k) => !np[k] && delete np[k]); location.hash = "#/audit?" + new URLSearchParams(np); };
    const groups = [["", "Toutes les actions"], ["login", "Connexions"], ["user", "Comptes"], ["password", "Mots de passe"], ["triage", "Qualification"], ["watch", "Périmètre"], ["export", "Exports"], ["report", "Rapports"], ["sync", "Synchronisations"]];
    c.innerHTML = `
      <div class="page-head"><div><h1>Journal d'audit</h1><p>${nf(d.total)} événement(s) · traçabilité des accès et des actions (conservation illimitée)</p></div></div>
      <div class="filters">
        <select id="aaction">${groups.map(([k, l]) => `<option value="${k}" ${(p.action || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="auser"><option value="">Tous les utilisateurs</option>${d.usernames.map((n) => `<option ${p.username === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
        <input id="aq" placeholder="Rechercher (cible, détail, IP)…" value="${esc(p.q || "")}" style="min-width:260px">
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Cible</th><th>Détails</th><th>Adresse IP</th></tr></thead>
        <tbody>${d.items.map((a) => { const [l, cls] = ACTION_FR[a.action] || [a.action, "tag"]; const isVuln = /^(CVE|GHSA)-/.test(a.target);
          return `<tr style="cursor:default"><td class="nowrap muted">${fmtDate(a.ts, true)}</td><td><b>${esc(a.username)}</b></td><td><span class="badge ${cls}">${esc(l)}</span></td>
            <td class="mono" style="font-size:12.5px">${isVuln ? `<a href="#" data-vuln="${esc(a.target)}">${esc(a.target)}</a>` : esc(a.target)}</td>
            <td class="muted" style="font-size:12.5px;max-width:420px">${esc(a.details)}</td><td class="mono faint" style="font-size:12px">${esc(a.ip)}</td></tr>`; }).join("")
          || '<tr><td colspan="6"><div class="empty">Aucun événement</div></td></tr>'}</tbody></table></div>
        <div class="pager"><span>Page ${p.page} / ${Math.max(1, Math.ceil(d.total / 50))}</span><div style="display:flex;gap:6px">
          <button class="btn sm" id="aprev" ${+p.page <= 1 ? "disabled" : ""}>← Précédent</button>
          <button class="btn sm" id="anext" ${+p.page * 50 >= d.total ? "disabled" : ""}>Suivant →</button></div></div></div>`;
    $("#aaction").addEventListener("change", (e) => setP({ action: e.target.value }));
    $("#auser").addEventListener("change", (e) => setP({ username: e.target.value }));
    $("#aq").addEventListener("input", debounce((e) => setP({ q: e.target.value }), 400));
    if (p.q) { const i = $("#aq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    $("#aprev").addEventListener("click", () => setP({ page: String(+p.page - 1) }));
    $("#anext").addEventListener("click", () => setP({ page: String(+p.page + 1) }));
  }

  // raccourci clavier : « / » pour rechercher
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { const q = $("#gq"); if (q) { e.preventDefault(); q.focus(); } }
  });

  // ------------------------------------------------------------------ démarrage
  async function boot() {
    ME = await api("/api/me");
    document.title = ME.app;
    if (!ME.authenticated) { showLogin(); return; }
    if (ME.user.must_change) { showForceChange(); return; }
    renderLayout();
    route();
    pollStatus();
  }
  boot().catch((e) => { $("#root").innerHTML = `<div class="empty">Impossible de joindre le serveur : ${esc(e.message)}</div>`; });
})();

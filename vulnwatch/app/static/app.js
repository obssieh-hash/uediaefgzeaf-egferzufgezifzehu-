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
    if (v.cvss_score == null) return '<span class="faint">—</span>';
    const c = SEV_COLOR[v.severity] || "var(--none)";
    return `<span class="score">${v.cvss_score.toFixed(1)}<span class="meter"><i style="width:${v.cvss_score * 10}%;background:${c}"></i></span></span>`;
  };
  const epssCell = (v) => v.epss == null ? '<span class="faint">—</span>' :
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
    const o = { credentials: "same-origin", headers: {}, ...opts };
    if (o.body && typeof o.body !== "string") { o.body = JSON.stringify(o.body); o.headers["Content-Type"] = "application/json"; }
    const r = await fetch(path, o);
    if (r.status === 401 && path !== "/api/login") { showLogin(); throw new Error("Session expirée"); }
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
    if (!r.ok) {
      const d = data?.detail;
      throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : `Erreur ${r.status}`);
    }
    return data;
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
    ["report", "Rapport de veille", "report"],
    ["sources", "Sources & API", "db"],
  ];

  function renderLayout() {
    $("#root").innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="brand"><div class="brand-logo">${icon("shield")}</div>
            <div><div class="brand-name">${esc(ME.app)}</div><div class="brand-org">${esc(ME.org)}</div></div></div>
          <nav class="nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${icon(i)}<span>${l}</span>${k === "dashboard" ? '<span class="count hidden" id="nav-p1"></span>' : ""}</a>`).join("")}</nav>
          <div class="sidebar-foot">
            <div class="sync-pill" id="sync-pill"><span class="dot"></span><span>…</span></div>
            <div style="display:flex;gap:6px">
              <button class="btn ghost sm" data-action="theme" title="Thème">${icon(getTheme() === "dark" ? "sun" : "moon")}</button>
              ${ME.auth_required ? `<button class="btn ghost sm" data-action="logout" title="Déconnexion">${icon("logout")} ${esc(ME.user)}</button>` : ""}
            </div>
          </div>
        </aside>
        <main class="main">
          ${classifBar()}
          <div class="topbar">
            <form class="search" id="gsearch">${icon("search")}<input id="gq" placeholder="Rechercher une CVE, un produit (php, openssh…), un mot-clé…" autocomplete="off"></form>
            <div style="margin-left:auto;display:flex;gap:8px">
              <button class="btn sm" data-action="sync">${icon("refresh")}<span class="hide-sm">Synchroniser</span></button>
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
    else if (act === "logout") { await api("/api/logout", { method: "POST" }); ME.user = null; showLogin(); }
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
    if (!ME?.user) return;
    const { page, arg, params } = parseHash();
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (page === "vuln" ? "vulns" : page)));
    const c = $("#content");
    if (!c) return;
    c.onclick = null;
    try {
      if (page === "vuln") { if (!$("#vtable")) await pageVulns(c, {}); openVuln(decodeURIComponent(arg), false); return; }
      const pages = { dashboard: pageDashboard, vulns: pageVulns, watch: pageWatch, bulletins: pageBulletins, sources: pageSources, report: pageReport };
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
      </div>
      <div class="grid cols-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2>Publications CVE — 14 derniers jours</h2>
            <div class="legend">${order.slice(0, 4).map((s) => `<span><i style="background:${SEV_COLOR[s]}"></i>${SEV_FR[s]}</span>`).join("")}</div></div>
          <div class="card-body"><div class="chart">${chart}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Périmètre surveillé</h2><a class="btn ghost sm" href="#/watch">Gérer</a></div>
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
        <label class="toggle"><input type="checkbox" id="fkev" ${p.kev ? "checked" : ""}> Exploitées (KEV)</label>
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
    $("#fq").addEventListener("input", debounce((e) => setP({ q: e.target.value })));
    [["#fwatch", "watch"], ["#fsev", "severity"], ["#fstatus", "status"], ["#fsource", "source"], ["#fsort", "sort"]].forEach(([s, k]) =>
      $(s).addEventListener("change", (e) => setP({ [k]: e.target.value })));
    if (p.q) { const i = $("#fq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }

    const qp = { ...p, kev: p.kev ? "true" : "", per_page: 50 };
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
        <td class="nowrap muted">${fmtDate(v.published || v.first_seen)}</td>
        <td>${statusBadge(v.status)}</td>
      </tr>`).join("") || `<tr><td colspan="7"><div class="empty">${icon("inbox")}<div>Aucun résultat pour ces filtres.</div></div></td></tr>`;
    const pages = Math.max(1, Math.ceil(d.total / d.per_page));
    const page = +p.page;
    $("#vpager").innerHTML = `<span>Page ${page} / ${pages}</span><div style="display:flex;gap:6px">
      <button class="btn sm" ${page <= 1 ? "disabled" : ""} id="pprev">← Précédent</button>
      <button class="btn sm" ${page >= pages ? "disabled" : ""} id="pnext">Suivant →</button></div>`;
    $("#pprev").addEventListener("click", () => setP({ page: String(page - 1) }));
    $("#pnext").addEventListener("click", () => setP({ page: String(page + 1) }));
  }

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
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${prioBadge(v.priority)}<h1 class="mono">${esc(v.id)}</h1>${kevBadge(v)}${sevBadge(v.severity)}</div>
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
          <div class="metric"><div class="label">CVSS ${esc(v.cvss_version || "")}</div><div class="value" style="color:${SEV_COLOR[v.severity] || "inherit"}">${v.cvss_score ?? "—"}</div><div class="sub mono">${esc(v.cvss_vector || "Pas encore évaluée")}</div></div>
          <div class="metric"><div class="label">EPSS</div><div class="value">${v.epss != null ? (v.epss * 100).toFixed(2) + " %" : "—"}</div><div class="sub">${v.epss != null ? `Percentile ${(v.epss_percentile * 100).toFixed(0)} · ${fmtDate(v.epss_date)}` : "Probabilité d'exploitation à 30 j"}</div></div>
        </div>
        <div><div class="section-title">Description</div><div class="desc">${esc(v.description || "—")}</div></div>
        ${v.watches.length ? `<div><div class="section-title">Périmètre concerné</div>${v.watches.map((w) => `<span class="badge tag accent" style="margin-right:4px">${esc(w)}</span>`).join("")}</div>` : ""}
        <div class="card" style="box-shadow:none"><div class="card-body" style="padding-top:16px">
          <div class="section-title">Qualification ${esc(ME.org)}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <select id="tstatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            <span class="faint" style="font-size:12px">${v.triage_at ? `Mis à jour ${ago(v.triage_at)} par ${esc(v.triage_by)}` : ""}</span>
          </div>
          <textarea id="tnote" placeholder="Analyse, systèmes impactés, actions de remédiation, ticket associé…">${esc(v.note)}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary sm" id="tsave">Enregistrer</button></div>
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
    $("#tsave").addEventListener("click", async () => {
      try {
        await api(`/api/vulns/${encodeURIComponent(v.id)}/triage`, { method: "PUT", body: { status: $("#tstatus").value, note: $("#tnote").value } });
        toast("Qualification enregistrée", "ok");
        const row = $(`#vtable tr[data-vuln="${CSS.escape(v.id)}"] td:last-child`);
        if (row) row.innerHTML = statusBadge($("#tstatus").value);
      } catch (e) { toast(e.message, "err"); }
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
        <button class="btn primary" id="wadd">${icon("plus")} Ajouter un produit</button></div>
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
            <td class="nowrap"><button class="btn ghost sm" data-wedit="${w.id}" title="Modifier">${icon("edit")}</button><button class="btn ghost sm danger" data-wdel="${w.id}" title="Supprimer">${icon("trash")}</button></td>
          </tr>`).join("") || `<tr><td colspan="9"><div class="empty">Aucun produit. Ajoutez par exemple PHP et OpenSSH.</div></td></tr>`}</tbody></table></div></div>
      <p class="faint" style="margin-top:14px;font-size:12.5px">Astuce : une correspondance est établie si l'un des CPE figure dans les produits affectés <b>ou</b> si un mot-clé apparaît dans la description. Cliquez une ligne pour voir ses vulnérabilités.</p>`;

    $("#wadd").addEventListener("click", () => {
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
        <div style="display:flex;gap:8px"><button class="btn" id="ntest">${icon("bell")} Tester les notifications</button><button class="btn primary" data-action="sync">${icon("refresh", d.state.running ? "spin" : "")} ${d.state.running ? "En cours : " + esc(d.state.current || "") : "Synchroniser maintenant"}</button></div></div>
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
    $("#ntest").addEventListener("click", async () => {
      try { const r = await api("/api/notify/test", { method: "POST" }); toast(r.ok ? "Notification envoyée" : "Erreurs : " + r.errors.join(" ; "), r.ok ? "ok" : "err"); }
      catch (e) { toast(e.message, "err"); }
    });
  }

  // ------------------------------------------------------------------ rapport de veille (imprimable / PDF)
  async function pageReport(c, params) {
    const days = ["7", "14", "30"].includes(params.days) ? params.days : "7";
    c.innerHTML = `<div class="page-head"><div><h1>Rapport de veille</h1><p>Préparation…</p></div></div><div class="card" style="padding:24px"><div class="skeleton"></div></div>`;
    const d = await api(`/api/report?days=${days}`);
    const k = d.kpi;
    const tri = d.triage || {};
    const triTotal = Object.values(tri).reduce((a, b) => a + b, 0);
    const p1Items = d.priority_items.filter((v) => v.priority === 1);
    const tile = (label, value, color) => `<div class="rep-tile" style="--c:${color}"><div class="v">${nf(value)}</div><div class="l">${label}</div></div>`;
    const period = `du ${fmtDate(d.start)} au ${fmtDate(d.end)}`;

    const facts = [];
    facts.push(`<b>${nf(k.scope_new)}</b> vulnérabilité(s) nouvelle(s) ou nouvellement exploitée(s) concernent le périmètre surveillé, dont <b>${nf(k.p1)} de priorité P1</b> et <b>${nf(k.p2)} de priorité P2</b>.`);
    facts.push(`<b>${nf(k.kev_new)}</b> vulnérabilité(s) ajoutée(s) au catalogue CISA KEV (exploitation active confirmée)${k.kev_new_scope ? `, dont <b>${nf(k.kev_new_scope)} sur notre périmètre</b>` : ", aucune sur notre périmètre"}.`);
    facts.push(`Le CERT-FR a publié <b>${nf(k.certfr_alertes)}</b> alerte(s) et <b>${nf(k.certfr_avis)}</b> avis de sécurité.`);
    facts.push(`Au niveau mondial : <b>${nf(k.cve_new)}</b> nouvelles CVE publiées, dont <b>${nf(k.critical_new)}</b> critiques.`);
    if (triTotal) facts.push(`Suivi des P1/P2 du périmètre : <b>${nf((tri.done || 0) + (tri.na || 0))}</b> clôturée(s) sur ${nf(triTotal)} (${Math.round((((tri.done || 0) + (tri.na || 0)) / triTotal) * 100)} %), <b>${nf(tri.new || 0)}</b> encore à qualifier.`);

    const recos = [];
    p1Items.slice(0, 5).forEach((v) => recos.push(`<b class="mono">${esc(v.id)}</b> (${esc(v.watches.join(", ") || "périmètre")}) : ${v.kev ? "exploitée activement, " : ""}appliquer le correctif ou une mesure de contournement <b>sans délai</b>.`));
    if (!recos.length && k.p2) recos.push("Planifier sous 7 jours le traitement des vulnérabilités P2 listées ci-dessous.");
    if (!recos.length) recos.push("Aucune action urgente identifiée sur la période. Maintenir le cycle normal de mise à jour.");

    const statusBar = Object.keys(STATUS).map((s) => tri[s] ? `<i class="st-${s}" style="flex:${tri[s]}" title="${STATUS[s]} : ${tri[s]}"></i>` : "").join("");

    c.innerHTML = `
      <div class="page-head no-print"><div><h1>Rapport de veille</h1><p>Bulletin de synthèse à diffuser à la direction et aux équipes d'exploitation</p></div>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="chips">${[["7", "7 jours"], ["14", "14 jours"], ["30", "30 jours"]].map(([v, l]) => `<button data-days="${v}" class="${v === days ? "on" : ""}">${l}</button>`).join("")}</div>
          <button class="btn primary" id="rprint">${icon("print")} Imprimer / PDF</button></div></div>
      <article class="report">
        <div class="classif ${tlpClass(d.classification)} rep-classif">${icon("lock")}<span>${esc(d.classification)}</span></div>
        <header class="rep-head">
          <div class="brand" style="padding:0"><div class="brand-logo">${icon("shield")}</div>
            <div><div class="brand-name">${esc(d.app)}</div><div class="brand-org">${esc(d.org)} · Équipe SSI</div></div></div>
          <div class="rep-meta">Édité le ${fmtDate(new Date().toISOString(), true)}<br>par ${esc(d.generated_by)}</div>
        </header>
        <h1 class="rep-title">Bulletin de veille des vulnérabilités</h1>
        <div class="rep-period">Période ${period} (${d.days} jours)</div>

        <section><h2 class="rep-h">1. Synthèse</h2>
          <div class="rep-tiles">
            ${tile("Périmètre concerné", k.scope_new, "var(--accent)")}${tile("Priorité P1", k.p1, "var(--crit)")}${tile("Priorité P2", k.p2, "var(--high)")}
            ${tile("Ajouts KEV (dont périmètre)", k.kev_new, "#b3261e").replace("</div></div>", `<span class="faint"> (${nf(k.kev_new_scope)})</span></div></div>`)}
            ${tile("Alertes CERT-FR", k.certfr_alertes, "var(--accent-2)")}${tile("Nouvelles CVE (monde)", k.cve_new, "var(--none)")}
          </div>
          <ul class="rep-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
        </section>

        <section><h2 class="rep-h">2. Actions recommandées</h2>
          <ol class="rep-facts">${recos.map((r) => `<li>${r}</li>`).join("")}</ol></section>

        <section><h2 class="rep-h">3. Vulnérabilités prioritaires du périmètre (P1 / P2)</h2>
          ${d.priority_items.length ? `<table class="rep-table"><thead><tr><th>Prio.</th><th>Identifiant</th><th>Produit</th><th>CVSS</th><th>EPSS</th><th>Description</th><th>Statut</th></tr></thead><tbody>
            ${d.priority_items.map((v) => `<tr data-vuln="${esc(v.id)}"><td>${prioBadge(v.priority)}</td><td class="vid">${esc(v.id)}${v.kev ? `<div>${kevBadge(v)}</div>` : ""}</td>
              <td>${esc(v.watches.join(", "))}</td><td class="mono">${v.cvss_score ?? "—"}</td><td class="mono">${v.epss != null ? (v.epss * 100).toFixed(1) + " %" : "—"}</td>
              <td class="rep-desc">${v.title ? `<b>${esc(v.title)}</b> — ` : ""}${esc(v.description)}</td><td>${statusBadge(v.status)}</td></tr>`).join("")}</tbody></table>`
            : '<p class="muted">Aucune vulnérabilité P1/P2 sur le périmètre pour cette période.</p>'}</section>

        <section class="rep-cols">
          <div><h2 class="rep-h">4. Répartition par produit</h2>
            ${d.by_watch.length ? `<table class="rep-table"><thead><tr><th>Produit</th><th>Total</th><th>P1</th><th>P2</th><th>KEV</th><th>CVSS max</th></tr></thead><tbody>
              ${d.by_watch.map((w) => `<tr><td><b>${esc(w.name)}</b></td><td class="mono">${w.total}</td><td class="mono" style="color:${w.p1 ? "var(--crit)" : "inherit"}">${w.p1}</td><td class="mono">${w.p2}</td><td class="mono">${w.kev}</td><td class="mono">${w.max_cvss ?? "—"}</td></tr>`).join("")}</tbody></table>`
              : '<p class="muted">Aucune nouveauté sur le périmètre.</p>'}</div>
          <div><h2 class="rep-h">5. Suivi du traitement (P1/P2)</h2>
            ${triTotal ? `<div class="rep-statusbar">${statusBar}</div>
              <table class="rep-table"><tbody>${Object.entries(STATUS).map(([s, l]) => `<tr><td>${statusBadge(s)}</td><td class="mono">${nf(tri[s] || 0)}</td></tr>`).join("")}</tbody></table>`
              : '<p class="muted">Aucune vulnérabilité P1/P2 suivie.</p>'}</div>
        </section>

        <section><h2 class="rep-h">6. Nouvelles vulnérabilités exploitées (CISA KEV)</h2>
          ${d.kev_new.length ? `<table class="rep-table"><thead><tr><th>Identifiant</th><th>Vulnérabilité</th><th>Ajout</th><th>Échéance</th><th>Périmètre</th></tr></thead><tbody>
            ${d.kev_new.map((v) => `<tr data-vuln="${esc(v.id)}"><td class="vid">${esc(v.id)}</td><td>${esc(v.title || v.description)}</td><td class="nowrap">${fmtDate(v.kev_added)}</td><td class="nowrap">${fmtDate(v.kev_due)}</td>
              <td>${v.watches.length ? `<span class="badge tag accent">${esc(v.watches.join(", "))}</span>` : '<span class="faint">—</span>'}</td></tr>`).join("")}</tbody></table>`
            : '<p class="muted">Aucun ajout au catalogue sur la période.</p>'}</section>

        <section><h2 class="rep-h">7. Bulletins CERT-FR</h2>
          ${d.bulletins.length ? `<ul class="rep-bul">${d.bulletins.map((b) => `<li><span class="badge ${b.kind === "alerte" ? "sev-CRITICAL" : "tag"}">${esc(b.kind)}</span>
            <a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">${esc(b.title)}</a> <span class="faint">· ${fmtDate(b.published)}</span></li>`).join("")}</ul>`
            : '<p class="muted">Aucun bulletin CERT-FR sur la période.</p>'}</section>

        <footer class="rep-foot"><span>${esc(d.classification)}</span><span>Document généré automatiquement par ${esc(d.app)} — sources : NVD, CISA KEV, FIRST EPSS, CERT-FR, GitHub</span></footer>
      </article>`;
    $$("[data-days]", c).forEach((b) => b.addEventListener("click", () => { location.hash = `#/report?days=${b.dataset.days}`; }));
    $("#rprint").addEventListener("click", () => window.print());
  }

  // ------------------------------------------------------------------ démarrage
  async function boot() {
    ME = await api("/api/me");
    document.title = ME.app;
    if (!ME.user) { showLogin(); return; }
    renderLayout();
    route();
    pollStatus();
  }
  boot().catch((e) => { $("#root").innerHTML = `<div class="empty">Impossible de joindre le serveur : ${esc(e.message)}</div>`; });
})();

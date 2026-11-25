/* InvestPilot – comptes utilisateurs et alertes baleines persistantes */
const AUTH = { user: null };
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const ipKeys = () => { try { return Object.keys(localStorage).filter(k => k.startsWith("ip_")); } catch { return []; } };
async function apost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "InvestPilot" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Erreur " + r.status);
  return j;
}
async function aget(path) { const r = await fetch(path); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Erreur " + r.status); return j; }

/* ---------- synchronisation des réglages du compte ---------- */
let syncTimer;
function syncSettings() {
  if (!AUTH.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const data = {};
    ipKeys().filter(k => k !== "ip_user").forEach(k => { try { data[k] = JSON.parse(localStorage.getItem(k)); } catch {} });
    apost("/api/user/settings", data).catch(e => console.warn("sync", e));
  }, 1500);
}
async function loadAccountSettings(username) {
  const st = await aget("/api/user/settings");
  ipKeys().forEach(k => { try { localStorage.removeItem(k); } catch {} });
  Object.entries(st).forEach(([k, v]) => ls.set(k, JSON.stringify(v)));
  ls.set("ip_user", JSON.stringify(username));
}

/* ---------- écran de connexion ---------- */
function showAuth(hasUsers, msg = "") {
  const el = document.getElementById("auth");
  el.classList.add("open");
  el.innerHTML = `<form class="auth-box" id="authForm" autocomplete="on">
    <div class="brand" style="justify-content:center;margin-bottom:6px"><div class="logo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg></div><span>Invest<b>Pilot</b></span></div>
    <h2>${hasUsers ? "Connexion" : "Crée ton compte"}</h2>
    <p class="sub">${hasUsers ? "Connecte-toi pour retrouver tes traders suivis, ton plan et tes alertes." : "Premier lancement : ce compte sera <b>administrateur</b>. Tu pourras ensuite créer des comptes pour d'autres personnes."}</p>
    <label>Nom d'utilisateur<input name="username" required minlength="3" maxlength="20" autocomplete="username" autofocus></label>
    <label>Mot de passe<input name="password" type="password" required minlength="6" autocomplete="${hasUsers ? "current-password" : "new-password"}"></label>
    ${hasUsers ? "" : `<label>Confirmer le mot de passe<input name="password2" type="password" required minlength="6" autocomplete="new-password"></label>`}
    <div class="auth-err" id="authErr">${msg}</div>
    <button class="btn" type="submit">${hasUsers ? "Se connecter" : "Créer mon compte"}</button>
    ${hasUsers ? `<p class="sub" style="font-size:12px;text-align:center">Pas de compte ? Demande à l'administrateur de t'en créer un.</p>` : ""}
  </form>`;
  document.getElementById("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target), err = document.getElementById("authErr");
    if (!hasUsers && f.get("password") !== f.get("password2")) { err.textContent = "Les mots de passe ne correspondent pas."; return; }
    err.textContent = "…";
    try {
      const r = await apost(hasUsers ? "/api/auth/login" : "/api/auth/register", { username: f.get("username"), password: f.get("password") });
      if (!hasUsers) { const keep = {}; ipKeys().forEach(k => keep[k] = localStorage.getItem(k)); AUTH.user = r.user; Object.entries(keep).forEach(([k, v]) => ls.set(k, v)); ls.set("ip_user", JSON.stringify(r.user.username)); syncSettings(); setTimeout(() => location.reload(), 1700); return; }
      await loadAccountSettings(r.user.username);
      location.reload();
    } catch (x) { err.textContent = x.message; }
  });
}

async function logout() {
  try { await apost("/api/auth/logout"); } catch {}
  ipKeys().forEach(k => { try { localStorage.removeItem(k); } catch {} });
  location.reload();
}

/* ---------- alertes ---------- */
const NOTIF = { items: [], filter: "Tout" };
const EVTXT = {
  open: e => [`ouvre un <b>${e.side}</b> sur <b>${esc(e.coin)}</b>`, e.side === "LONG" ? "🟢" : "🔴"],
  close: e => [`ferme son ${e.side} sur <b>${esc(e.coin)}</b>`, "✅"],
  flip: e => [`se retourne sur <b>${esc(e.coin)}</b> : ${e.prevSide} → <b>${e.side}</b>`, "🔄"],
  increase: e => [`renforce son <b>${e.side}</b> sur <b>${esc(e.coin)}</b>`, "➕"],
  reduce: e => [`allège son ${e.side} sur <b>${esc(e.coin)}</b>`, "➖"],
};
const whoOf = e => e.rank ? `Baleine #${e.rank}` : e.addr.slice(0, 6) + "…" + e.addr.slice(-4);
function evHtml(e, cls = "") {
  const [t, ic] = (EVTXT[e.type] || (() => [e.type, "•"]))(e);
  const bg = e.type === "open" ? (e.side === "LONG" ? "#16c78422" : "#ea394322") : "#ffffff10";
  return `<div class="fi ${cls}" data-trader="${esc(e.addr)}"><div class="ico" style="background:${bg}">${ic}</div><div class="tx">${e.followed ? "⭐ " : ""}<b>${whoOf(e)}</b> ${t}<br>
    <small>${usdBig(e.value)} · entrée ${usd(e.entry)} · ${ago(e.ts * 1000)}</small></div></div>`;
}
function unreadCount() { const seen = +(JSON.parse(ls.get("ip_notif_seen") || "0")); return NOTIF.items.filter(e => e.id > seen && (e.followed || e.value >= 250000)).length; }
function renderBell() { const n = unreadCount(), b = document.getElementById("bellBadge"); b.textContent = n > 99 ? "99+" : n; b.style.display = n ? "" : "none"; }
function renderNotifPanel() {
  const F = NOTIF.filter;
  const list = NOTIF.items.slice().reverse().filter(e => F === "Tout" || (F === "Mes suivis" && e.followed) || (F === "Achats" && e.type === "open" && e.side === "LONG") || (F === "Ventes" && (e.side === "SHORT" && e.type === "open" || e.type === "close")));
  document.getElementById("notifChips").innerHTML = ["Tout", "Mes suivis", "Achats", "Ventes"].map(f => `<button class="chip ${f === F ? "on" : ""}" data-nfil="${f}">${f}</button>`).join("");
  document.getElementById("notifList").innerHTML = list.map(e => evHtml(e)).join("") || `<div class="empty">Aucune alerte pour l'instant.<br><small>Le serveur vérifie les baleines toutes les 60 secondes et garde l'historique, même quand la page est fermée.</small></div>`;
}
async function pollNotifs(first = false) {
  if (!AUTH.user) return;
  try {
    const after = NOTIF.items.length ? NOTIF.items[NOTIF.items.length - 1].id : 0;
    const d = await aget("/api/notifications?after=" + after);
    if (d.items.length) NOTIF.items.push(...d.items);
    NOTIF.items = NOTIF.items.slice(-300);
    const lastNotified = +(JSON.parse(ls.get("ip_notif_last") || "0"));
    if (!first || lastNotified) {
      const fresh = d.items.filter(e => e.id > lastNotified && (e.followed || e.value >= 250000)).slice(-5);
      fresh.forEach(e => { const [t] = EVTXT[e.type](e); stickyToast(e, `${whoOf(e)} ${t.replace(/<[^>]+>/g, "")}`); });
      if (fresh.length && S.notif) { beep(); if ("Notification" in window && Notification.permission === "granted") fresh.forEach(e => { try { new Notification("🐋 " + whoOf(e), { body: EVTXT[e.type](e)[0].replace(/<[^>]+>/g, "") + " · " + usdBig(e.value) }); } catch {} }); }
    }
    if (d.last) { ls.set("ip_notif_last", JSON.stringify(d.last)); }
    renderBell();
    if (document.getElementById("notifPanel").classList.contains("open")) renderNotifPanel();
  } catch (e) { console.warn("alertes", e); }
}
function stickyToast(e, text) {
  const box = document.getElementById("toasts");
  while (box.children.length >= 5) box.lastChild.remove();
  const el = document.createElement("div");
  el.className = "toast sticky";
  el.innerHTML = `<button class="tclose" title="Fermer">✕</button><b>🐋 Alerte baleine</b>${esc(text)}<br><small style="color:var(--muted)">${usdBig(e.value)} · entrée ${usd(e.entry)}</small>`;
  el.querySelector(".tclose").onclick = ev => { ev.stopPropagation(); el.remove(); };
  el.onclick = () => openTrader(e.addr);
  box.prepend(el);
}

/* ---------- onglet Compte ---------- */
async function renderAccount() {
  const u = AUTH.user; if (!u) return;
  const el = document.getElementById("accountBody");
  el.innerHTML = `<div class="two" style="margin:0">
    <div class="card"><h3>👤 Mon compte</h3>
      <div class="lv"><span>Nom d'utilisateur</span><b>${esc(u.username)}</b></div>
      <div class="lv"><span>Rôle</span><b>${u.admin ? "Administrateur" : "Utilisateur"}</b></div>
      <p class="sub" style="font-size:12.5px;margin:10px 0">Tes traders suivis, ton plan, ton portefeuille, ton profil et tes alertes sont enregistrés dans ton compte.</p>
      <form id="pwForm" class="acc-form"><h4>Changer mon mot de passe</h4><input name="old" type="password" placeholder="Mot de passe actuel" required autocomplete="current-password"><input name="new" type="password" placeholder="Nouveau mot de passe (6 caractères min.)" required minlength="6" autocomplete="new-password"><button class="btn small">Changer</button><span class="acc-msg" id="pwMsg"></span></form>
      <button class="btn ghost" id="logoutBtn" style="margin-top:14px">🚪 Se déconnecter</button></div>
    <div class="card"><h3>📱 Utiliser InvestPilot sur d'autres appareils</h3>
      <p class="sub" style="line-height:1.7">Pour que d'autres personnes (ou ton téléphone) utilisent le logiciel avec leur propre compte :</p>
      <ol class="rules" style="list-style:decimal;padding-left:18px;margin-top:8px">
        <li>Lance InvestPilot avec <b>lancer-reseau-windows.bat</b> au lieu de lancer-windows.bat.</li>
        <li>La fenêtre noire affiche une adresse du type <b>http://192.168.1.20:8765</b>.</li>
        <li>Sur l'autre appareil, connecté au <b>même Wi-Fi</b>, ouvre cette adresse dans le navigateur.</li>
        <li>Si Windows demande l'autorisation du pare-feu, accepte pour les <b>réseaux privés</b> uniquement.</li>
      </ol>
      <p class="sub" style="font-size:12px;margin-top:8px">Ton ordinateur doit rester allumé avec la fenêtre noire ouverte. Ne l'utilise que sur un réseau de confiance (chez toi), pas sur un Wi-Fi public.</p></div></div>
    ${u.admin ? `<div class="card" style="margin-top:16px"><h3>👥 Gérer les comptes</h3>
      <form id="newUser" class="acc-form row"><input name="username" placeholder="Nom d'utilisateur" required minlength="3" maxlength="20" autocomplete="off"><input name="password" type="password" placeholder="Mot de passe (6 car. min.)" required minlength="6" autocomplete="new-password"><label class="chk"><input type="checkbox" name="admin"> Administrateur</label><button class="btn small">+ Créer le compte</button><span class="acc-msg" id="nuMsg"></span></form>
      <div id="userList" style="margin-top:12px"><div class="empty">Chargement…</div></div></div>` : ""}`;
  document.getElementById("logoutBtn").onclick = logout;
  document.getElementById("pwForm").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), m = document.getElementById("pwMsg");
    try { await apost("/api/user/password", { old: f.get("old"), new: f.get("new") }); m.textContent = "✅ Mot de passe changé"; e.target.reset(); } catch (x) { m.textContent = "❌ " + x.message; } };
  if (!u.admin) return;
  const loadUsers = async () => {
    const list = await aget("/api/admin/users");
    document.getElementById("userList").innerHTML = `<table class="ptbl big"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Créé le</th><th>Dernière connexion</th><th></th></tr></thead><tbody>${list.map(x => `<tr><td><b>${esc(x.username)}</b>${x.username === u.username ? " (toi)" : ""}</td><td>${x.admin ? "Admin" : "Utilisateur"}</td><td>${x.created ? new Date(x.created * 1000).toLocaleDateString("fr-FR") : "—"}</td><td>${x.lastLogin ? ago(x.lastLogin * 1000) : "jamais"}</td>
      <td style="white-space:nowrap"><button class="btn ghost small" data-reset="${esc(x.username)}">🔑 Mot de passe</button> ${x.username !== u.username ? `<button class="btn ghost small" data-del="${esc(x.username)}">🗑️ Supprimer</button>` : ""}</td></tr>`).join("")}</tbody></table>`;
    document.querySelectorAll("[data-reset]").forEach(b => b.onclick = async () => { const p = prompt(`Nouveau mot de passe pour ${b.dataset.reset} (6 caractères min.) :`); if (!p) return; try { await apost("/api/admin/reset", { username: b.dataset.reset, password: p }); alert("Mot de passe modifié ✅"); } catch (x) { alert(x.message); } });
    document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm(`Supprimer définitivement le compte « ${b.dataset.del} » et ses réglages ?`)) return; try { await apost("/api/admin/delete", { username: b.dataset.del }); loadUsers(); } catch (x) { alert(x.message); } });
  };
  document.getElementById("newUser").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), m = document.getElementById("nuMsg");
    try { const r = await apost("/api/admin/create", { username: f.get("username"), password: f.get("password"), admin: !!f.get("admin") }); m.textContent = `✅ Compte « ${r.user.username} » créé`; e.target.reset(); loadUsers(); } catch (x) { m.textContent = "❌ " + x.message; } };
  loadUsers().catch(x => document.getElementById("userList").innerHTML = `<div class="empty">${esc(x.message)}</div>`);
}

/* ---------- démarrage ---------- */
const AUTH_READY = (async () => {
  let me;
  try { me = await aget("/api/auth/me"); } catch { return; }
  if (!me.user) { ipKeys().forEach(k => { try { localStorage.removeItem(k); } catch {} }); showAuth(me.hasUsers); return; }
  AUTH.user = me.user;
  const stored = (() => { try { return JSON.parse(ls.get("ip_user")); } catch { return null; } })();
  if (stored !== me.user.username) { await loadAccountSettings(me.user.username); location.reload(); return; }
})();

document.addEventListener("DOMContentLoaded", () => {
  AUTH_READY.then(() => {
    if (!AUTH.user) return;
    document.getElementById("userChip").textContent = "👤 " + AUTH.user.username;
    document.getElementById("bellBtn").style.display = "";
    pollNotifs(true);
    setInterval(() => pollNotifs(), 30000);
  });
  document.getElementById("bellBtn").addEventListener("click", () => { const p = document.getElementById("notifPanel"); p.classList.toggle("open"); if (p.classList.contains("open")) { renderNotifPanel(); } });
  document.getElementById("notifPanel").addEventListener("click", e => {
    const c = e.target.closest("[data-nfil]"); if (c) { NOTIF.filter = c.dataset.nfil; renderNotifPanel(); }
    if (e.target.closest("#notifRead")) { const last = NOTIF.items.length ? NOTIF.items[NOTIF.items.length - 1].id : 0; ls.set("ip_notif_seen", JSON.stringify(last)); syncSettings(); renderBell(); }
    if (e.target.closest("#notifClose")) document.getElementById("notifPanel").classList.remove("open");
  });
});

// Gestion des utilisateurs (administrateurs) : comptes, rôles, scans attribués.
import { api } from "../api.js";
import { store } from "../app.js";
import { esc, icon, pageHead, fmtDate, ago, toast, modal, confirmDialog, empty, ROLE_LABEL, ROLE_PILL, statusPill } from "../ui.js";

const RIGHTS = {
  admin: "Tous les droits : créer, lancer, mettre en pause et supprimer des scans, gérer les utilisateurs et consulter le journal.",
  developer: "Voit et pilote uniquement les scans que vous lui attribuez (démarrer, pause, arrêter, reprendre) et suit leurs vulnérabilités.",
  viewer: "Lecture seule : consulte tous les scans, résultats et rapports, sans rien modifier.",
};

export async function render(view) {
  let data, scans;
  const load = async () => { [data, scans] = await Promise.all([api.get("/users"), api.get("/scans")]); };
  await load();

  const draw = () => {
    const by = (r) => data.users.filter((u) => u.role === r).length;
    view.innerHTML = pageHead({
      eyebrow: "Système", eyeIcon: "users", title: "Utilisateurs",
      sub: "Créez des comptes visiteur, développeur ou administrateur et attribuez des scans précis aux développeurs.",
      actions: `<button class="btn btn-primary" data-new>${icon("plus")}Nouvel utilisateur</button>`,
    }) + `
      ${data.auth ? "" : `<div class="banner info">${icon("alert")}<span>L'authentification est désactivée (pas de <code>UI_ADMIN_PASSWORD</code> dans <code>.env</code>) : les comptes créés ici ne seront utilisés qu'une fois l'authentification activée.</span></div>`}
      <div class="grid g3">${Object.keys(RIGHTS).map((r) => `<div class="card kpi"><div class="kpi-h"><span class="pill ${ROLE_PILL[r]} no-dot role-pill">${ROLE_LABEL[r]}</span></div>
        <div class="kpi-v">${by(r)}</div><div class="kpi-s">${RIGHTS[r]}</div></div>`).join("")}</div>
      <div class="card mt"><div class="table-scroll"><table class="table"><thead><tr>
        <th>Utilisateur</th><th>Rôle</th><th>Scans attribués</th><th>Dernière connexion</th><th>Statut</th><th></th></tr></thead><tbody>
        ${data.users.map(row).join("") || `<tr><td colspan="6">${empty("Aucun utilisateur")}</td></tr>`}</tbody></table></div></div>`;
    view.querySelector("[data-new]").onclick = () => edit(null);
    view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => edit(data.users.find((u) => u.username === b.dataset.edit))));
    view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      const name = b.dataset.del;
      if (!(await confirmDialog("Supprimer l'utilisateur ?", `Le compte « ${esc(name)} » sera supprimé et ses sessions fermées.`, "Supprimer"))) return;
      try { await api.del(`/users/${encodeURIComponent(name)}`); toast("Utilisateur supprimé"); await load(); draw(); } catch (e) { toast(e.message, "err"); }
    }));
  };

  const row = (u) => {
    const assigned = u.role === "developer"
      ? (u.scans.length ? u.scans.map((id) => scans.find((s) => s.id === id)).filter(Boolean)
        .map((s) => `<a class="chip" href="#/scans/${esc(s.id)}">${esc(s.name)}</a>`).join(" ") || '<span class="muted">—</span>' : '<span class="muted">Aucun</span>')
      : `<span class="muted small">${u.role === "admin" ? "Tous (modification)" : "Tous (lecture)"}</span>`;
    const me = u.username === store.me.user;
    return `<tr>
      <td><div class="flex" style="gap:10px"><span class="avatar">${esc(u.username.slice(0, 2).toUpperCase())}</span>
        <div><div class="name">${esc(u.username)}${me ? ' <span class="muted small">(vous)</span>' : ""}</div><div class="sub">${esc(u.fullname || "")}${u.email ? " · " + esc(u.email) : ""}</div></div></div></td>
      <td><span class="pill ${ROLE_PILL[u.role]} no-dot role-pill">${ROLE_LABEL[u.role] || u.role}</span>${u.system ? ' <span class="chip" title="Défini dans .env">système</span>' : ""}</td>
      <td><div class="flex wrap" style="gap:4px">${assigned}</div></td>
      <td class="small muted">${u.last_login ? `${fmtDate(u.last_login)}<br>${ago(u.last_login)}` : u.system ? "—" : "Jamais"}</td>
      <td>${u.disabled ? '<span class="pill">Désactivé</span>' : '<span class="pill ok">Actif</span>'}${u.sessions ? ` <span class="small muted">${u.sessions} session(s)</span>` : ""}</td>
      <td style="text-align:right;white-space:nowrap">${u.system ? '<span class="small muted">via .env</span>'
        : `<button class="btn btn-sm" data-edit="${esc(u.username)}">${icon("edit")}Modifier</button>
           ${me ? "" : `<button class="btn btn-sm btn-icon btn-ghost" data-del="${esc(u.username)}" title="Supprimer">${icon("trash")}</button>`}`}</td></tr>`;
  };

  const edit = (u) => {
    const isNew = !u;
    u = u || { username: "", role: "viewer", fullname: "", email: "", scans: [], disabled: false };
    const me = u.username === store.me.user;
    const bg = modal(isNew ? "Nouvel utilisateur" : `Modifier « ${u.username} »`, `<div class="form-grid">
      <div class="field"><label>Identifiant</label><input class="input" name="username" value="${esc(u.username)}" ${isNew ? "" : "disabled"} autocomplete="off" placeholder="ex. j.dupont"></div>
      <div class="field"><label>Nom complet</label><input class="input" name="fullname" value="${esc(u.fullname)}" placeholder="facultatif"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(u.email)}" placeholder="facultatif"></div>
      <div class="field"><label>${isNew ? "Mot de passe" : "Nouveau mot de passe"}</label><input class="input" name="password" type="password" autocomplete="new-password" placeholder="${isNew ? "8 caractères minimum" : "laisser vide pour ne pas changer"}"></div>
      <div class="field full"><label>Rôle</label><div class="grid g3" style="gap:8px">${Object.keys(RIGHTS).map((r) => `
        <label class="card" style="padding:10px 12px;cursor:pointer;display:block"><input type="radio" name="role" value="${r}" ${u.role === r ? "checked" : ""} ${me && r !== "admin" ? "disabled" : ""}>
          <b>${ROLE_LABEL[r]}</b><div class="small muted" style="margin-top:4px">${RIGHTS[r]}</div></label>`).join("")}</div></div>
      <div class="field full" data-scans-field><label>Scans attribués <span class="muted small">(développeur uniquement)</span></label>
        <input class="input" data-filter placeholder="Filtrer les scans…" style="margin-bottom:6px">
        <div data-scan-list style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px">
          ${scans.map((s) => `<label class="flex" style="gap:8px;padding:4px 0" data-name="${esc((s.name + " " + (s.targets || []).join(" ")).toLowerCase())}">
            <input type="checkbox" value="${esc(s.id)}" ${u.scans.includes(s.id) ? "checked" : ""}>
            <span style="flex:1">${esc(s.name)} <span class="muted small mono">${esc((s.targets || []).slice(0, 2).join(", "))}</span></span>${statusPill(s.status.status)}</label>`).join("")
            || '<div class="muted small">Aucun scan</div>'}</div></div>
      ${isNew || me ? "" : `<div class="field full"><label class="flex" style="gap:8px"><input type="checkbox" name="disabled" ${u.disabled ? "checked" : ""}> Compte désactivé (connexion impossible, sessions fermées)</label></div>`}
    </div>`, {
      ok: isNew ? "Créer" : "Enregistrer",
      onOk: async (m) => {
        const v = (n) => m.querySelector(`[name=${n}]`)?.value.trim() ?? "";
        const role = m.querySelector("[name=role]:checked").value;
        const payload = { fullname: v("fullname"), email: v("email"), role,
          scans: role === "developer" ? [...m.querySelectorAll("[data-scan-list] input:checked")].map((c) => c.value) : [] };
        const pw = m.querySelector("[name=password]").value;
        if (pw) payload.password = pw;
        const dis = m.querySelector("[name=disabled]");
        if (dis) payload.disabled = dis.checked;
        if (isNew) await api.post("/users", { ...payload, username: v("username") });
        else await api.put(`/users/${encodeURIComponent(u.username)}`, payload);
        toast(isNew ? "Utilisateur créé" : "Utilisateur mis à jour");
        await load(); draw();
      },
    });
    bg.querySelector(".modal").style.width = "min(780px, 100%)";
    const sync = () => { bg.querySelector("[data-scans-field]").style.display = bg.querySelector("[name=role]:checked").value === "developer" ? "" : "none"; };
    bg.querySelectorAll("[name=role]").forEach((r) => (r.onchange = sync));
    bg.querySelector("[data-filter]").oninput = (e) => {
      const q = e.target.value.toLowerCase();
      bg.querySelectorAll("[data-scan-list] [data-name]").forEach((l) => (l.style.display = l.dataset.name.includes(q) ? "" : "none"));
    };
    sync();
  };
  draw();
}

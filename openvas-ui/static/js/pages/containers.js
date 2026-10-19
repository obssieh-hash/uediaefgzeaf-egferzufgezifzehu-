// Scans d'images Docker / OCI (container-image-scanner d'openvasd).
import { api } from "../api.js";
import { refreshInfo } from "../app.js";
import { esc, icon, pageHead, statusPill, sevBadge, levelOf, fmtDate, empty, toast } from "../ui.js";

export async function render(view) {
  const scans = (await api.get("/scans")).filter((s) => s.kind === "container");
  view.innerHTML = pageHead({ eyebrow: "Supervision", eyeIcon: "box", title: "Images Docker",
    sub: "Analysez les paquets des images de conteneurs d'un registre, sans les exécuter." }) + `
    <div class="grid g-main">
      <div class="card"><div class="card-h"><h3>Images analysées</h3></div>
        ${scans.length ? `<table class="table"><thead><tr><th>Scan</th><th>Images</th><th>Statut</th><th>Vulnérabilités</th></tr></thead><tbody>
        ${scans.map((s) => `<tr class="click" onclick="location.hash='#/scans/${esc(s.id)}'"><td><div class="name">${esc(s.name)}</div><div class="sub">${fmtDate(s.status.start_time || s.created)}</div></td>
          <td class="mono small">${esc((s.targets || []).join(", "))}</td><td>${statusPill(s.status.status)}</td>
          <td>${s.summary?.vulns ? sevBadge(levelOf(s.summary.max_severity), s.summary.max_severity) + ` <span class="muted small">${s.summary.vulns}</span>` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table>`
          : empty("Aucune image analysée", "Ajoutez une image à droite.", "box")}</div>
      <div class="card"><div class="card-h"><h3>Analyser une image</h3></div><form class="card-b grid" style="gap:14px" data-form autocomplete="off">
        <div class="field"><label>Nom</label><input class="input" name="name" placeholder="Images de production"></div>
        <div class="field"><label>Images *</label><textarea class="input" name="images" rows="4" placeholder="oci://registry.exemple.fr/app/api:1.4.2\noci://docker.io/library/nginx:1.27"></textarea>
          <span class="help">Préfixe <span class="mono">oci://</span> ; un registre ou un dépôt entier peut aussi être indiqué.</span></div>
        <div class="form-grid"><div class="field"><label>Utilisateur du registre</label><input class="input" name="user"></div>
          <div class="field"><label>Mot de passe / jeton</label><input class="input" type="password" name="pass"></div></div>
        <button class="btn btn-primary" type="submit">${icon("play")}Lancer l'analyse</button>
      </form></div>
    </div>`;
  view.querySelector("[data-form]").onsubmit = async (e) => {
    e.preventDefault();
    const v = (n) => e.target.querySelector(`[name=${n}]`).value.trim();
    const hosts = v("images").split(/\s+/).filter(Boolean).map((h) => (h.startsWith("oci://") ? h : "oci://" + h));
    if (!hosts.length) return toast("Indiquez au moins une image.", "err");
    const target = { hosts };
    if (v("user")) target.credentials = [{ service: "generic", up: { username: v("user"), password: v("pass") } }];
    try {
      const r = await api.post("/scans", { name: v("name") || hosts[0].replace("oci://", ""), kind: "container", scan: { target, vts: [], scan_preferences: [] } });
      toast("Analyse lancée"); refreshInfo();
      location.hash = `#/scans/${r.id}`;
    } catch (err) { toast(err.message, "err"); }
  };
}

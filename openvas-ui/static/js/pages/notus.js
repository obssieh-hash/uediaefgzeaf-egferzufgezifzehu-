// Analyse de paquets via Notus (POST /notus/{os}).
import { api } from "../api.js";
import { esc, icon, pageHead, sevBadge, empty, toast, download, toCSV, $ } from "../ui.js";

const HELP = {
  deb: "dpkg-query -W -f='${Package}-${Version}\\n'",
  rpm: "rpm -qa --qf '%{NAME}-%{VERSION}-%{RELEASE}.%{ARCH}\\n'",
  apk: "apk info -v",
};

export async function render(view) {
  const oses = await api.get("/notus").catch(() => []);
  view.innerHTML = pageHead({ eyebrow: "Connaissances", eyeIcon: "package", title: "Analyse de paquets",
    sub: "Vérifiez une liste de paquets installés contre les avis de sécurité Notus, sans scanner la machine." }) + `
    <div class="grid g-main">
      <div class="card"><div class="card-h"><h3>Paquets installés</h3></div><div class="card-b grid" style="gap:14px">
        <div class="field"><label>Système d'exploitation</label><select class="select" data-os>${oses.map((o) => `<option>${esc(o)}</option>`).join("") || "<option value=''>Aucun produit Notus disponible</option>"}</select></div>
        <div class="field"><label>Liste des paquets (un par ligne)</label>
          <textarea class="input" rows="12" data-pkgs placeholder="openssl-3.0.13-0ubuntu3.1\nopenssh-server-1:9.6p1-3ubuntu13\ncurl-8.5.0-2ubuntu10.1"></textarea></div>
        <div class="actions"><button class="btn btn-primary" data-run>${icon("search")}Analyser</button><label class="btn">${icon("file")}Importer un fichier<input type="file" hidden data-file accept=".txt,.list"></label></div>
      </div></div>
      <div class="card"><div class="card-h"><h3>Obtenir la liste</h3></div><div class="card-b grid" style="gap:12px">
        ${Object.entries({ "Debian / Ubuntu": HELP.deb, "RHEL / SUSE / Fedora": HELP.rpm, Alpine: HELP.apk }).map(([k, v]) => `<div><div class="label" style="margin-bottom:4px">${k}</div><pre class="pre">${esc(v)}</pre></div>`).join("")}
        <p class="muted small" style="margin:0">Notus compare les versions installées aux versions corrigées publiées dans les avis de sécurité du flux.</p>
      </div></div>
    </div>
    <div data-out class="mt"></div>`;

  $("[data-file]", view).onchange = async (e) => { const f = e.target.files[0]; if (f) $("[data-pkgs]", view).value = await f.text(); };
  $("[data-run]", view).onclick = async () => {
    const packages = $("[data-pkgs]", view).value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const os = $("[data-os]", view).value;
    if (!packages.length || !os) return toast("Choisissez un système et collez la liste des paquets.", "err");
    const out = $("[data-out]", view);
    out.innerHTML = '<div class="loading"><div class="spinner"></div>Analyse en cours…</div>';
    try {
      const res = await api.post("/notus", { os, packages });
      out.innerHTML = `<div class="card"><div class="card-h"><h3>Résultats</h3><span class="hint">${packages.length} paquet(s) analysé(s) · ${res.length} vulnérable(s)</span>
        ${res.length ? `<div class="right"><button class="btn btn-sm" data-csv>${icon("download")}CSV</button></div>` : ""}</div>
        ${res.length ? `<table class="table"><thead><tr><th>Sévérité</th><th>Avis</th><th>Paquet</th><th>Installé</th><th>Corrigé</th></tr></thead><tbody>
        ${res.map((r) => `<tr><td style="width:120px">${sevBadge(r.level, r.score)}</td><td><div class="name">${esc(r.name)}</div><div class="sub">${esc(r.oid)}</div></td>
          <td class="strong">${esc(r.package)}</td><td class="mono">${esc(r.installed)}</td>
          <td class="mono">${esc(typeof r.fixed === "string" ? r.fixed : `${r.fixed.start || ""} – ${r.fixed.end || ""}`)}</td></tr>`).join("")}</tbody></table>`
          : empty("Aucun paquet vulnérable", "Tous les paquets sont à jour au regard du flux Notus.", "shieldCheck")}</div>`;
      out.querySelector("[data-csv]")?.addEventListener("click", () => download("notus.csv", toCSV(res, [["OID", (r) => r.oid], ["Avis", (r) => r.name], ["Paquet", (r) => r.package], ["Installé", (r) => r.installed], ["Corrigé", (r) => (typeof r.fixed === "string" ? r.fixed : JSON.stringify(r.fixed))]]), "text/csv"));
    } catch (e) { out.innerHTML = ""; toast(e.message, "err"); }
  };
}

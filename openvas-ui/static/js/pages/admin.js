// Administration : état de la connexion à openvasd, flux, préférences.
import { api } from "../api.js";
import { refreshInfo } from "../app.js";
import { esc, icon, pageHead, fmtNum, toast } from "../ui.js";

export async function render(view) {
  const [info, prefs, perf] = await Promise.all([api.get("/info"), api.get("/preferences").catch(() => []), api.get("/performance").catch(() => [])]);
  const vtState = { ready: ["Chargées", "ok"], loading: ["Chargement…", "info live"], pending: ["En attente", ""], error: ["Erreur", "crit"] }[info.vts_state] || [info.vts_state, ""];
  view.innerHTML = pageHead({ eyebrow: "Système", eyeIcon: "key", title: "Administration", sub: "Connexion au scanner openvasd et paramètres par défaut.",
    actions: `<button class="btn" data-refresh>${icon("refresh")}Actualiser</button>` }) + `
    ${info.demo ? `<div class="banner info">${icon("info")}Mode démonstration : un openvasd simulé est utilisé. Lancez <code>python3 server.py --openvasd URL --api-key CLÉ</code> pour vous connecter à un vrai scanner.</div>` : ""}
    <div class="grid g3">
      <div class="card"><div class="card-h"><h3>Scanner</h3><div class="right"><span class="pill ${info.connected ? "ok" : "crit"}">${info.connected ? "Connecté" : "Injoignable"}</span></div></div>
        <div class="card-b"><dl class="kv"><dt>Service</dt><dd>openvasd</dd><dt>URL</dt><dd class="mono">${esc(info.url)}</dd><dt>API</dt><dd>v${esc(info.api_version || "1")}</dd>
        <dt>Authentification</dt><dd>${info.demo ? "—" : "X-API-KEY / mTLS (côté serveur)"}</dd></dl></div></div>
      <div class="card"><div class="card-h"><h3>Flux de VTs</h3><div class="right"><span class="pill ${vtState[1]}">${vtState[0]}</span></div></div>
        <div class="card-b"><dl class="kv"><dt>Version</dt><dd class="mono">${esc(info.feed_version || "—")}</dd><dt>VTs</dt><dd>${fmtNum(info.vts_count)}</dd>
        <dt>Mise à jour</dt><dd class="muted small">Gérée par openvasd (greenbone-feed-sync)</dd></dl></div></div>
      <div class="card"><div class="card-h"><h3>Interface</h3></div><div class="card-b"><dl class="kv">
        <dt>Thème</dt><dd><div class="seg" data-theme><button data-t="light">Clair</button><button data-t="dark">Sombre</button></div></dd>
        <dt>Données</dt><dd class="small muted">Noms des scans, suivi de remédiation et planifications : <span class="mono">data/state.json</span></dd></dl></div></div>
    </div>
    ${perf.length ? `<div class="card mt"><div class="card-h"><h3>Performances des VTs</h3><span class="hint">/health/performance</span></div>
      <pre class="pre" style="margin:16px;max-height:300px">${esc(JSON.stringify(perf, null, 2))}</pre></div>` : ""}
    <div class="card mt"><div class="card-h"><h3>Préférences du scanner</h3><span class="hint">${prefs.length} préférence(s) · GET /scans/preferences</span></div>
      <div class="table-scroll"><table class="table"><thead><tr><th>Identifiant</th><th>Nom</th><th>Description</th><th>Défaut</th></tr></thead><tbody>
      ${prefs.map((p) => `<tr><td class="mono">${esc(p.id)}</td><td class="strong">${esc(p.name || "")}</td><td class="small muted">${esc(p.description || "")}</td>
        <td><span class="chip">${esc(String(p.default))}</span></td></tr>`).join("") || '<tr><td colspan="4" class="muted">Indisponible</td></tr>'}</tbody></table></div></div>`;

  const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  view.querySelectorAll("[data-t]").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === cur);
    b.onclick = () => { if (b.dataset.t !== cur) document.getElementById("theme-btn").click(); };
  });
  view.querySelector("[data-refresh]").onclick = async () => { await refreshInfo(); toast("État actualisé"); render(view); };
}

import { api, saveSettings, settings } from "../api.js";
import { resetStore } from "../store.js";
import { esc, icon } from "../util.js";
import { toast } from "../ui.js";
import { applyTheme, refreshStatus } from "../app.js";

export default async function settingsView(root) {
  const draft = { ...settings };

  root.innerHTML = `
    <div class="page-head"><div><h1>Paramètres</h1><p>Connexion au scanner et préférences de la console.</p></div></div>
    <div class="grid g-2" style="align-items:start">
      <section class="card">
        <div class="card-head"><span class="step-num">${icon("server")}</span><div><h2>Connexion</h2><div class="sub">openvasd — API HTTP</div></div></div>
        <div class="card-body stack">
          <div class="field"><span>Source des données</span>
            <div class="seg" id="mode"><button data-mode="live">Scanner réel</button><button data-mode="demo">Démo simulée</button></div></div>
          <label class="field"><span>URL de l'API</span><input class="input mono" id="base" value="${esc(draft.base)}" />
            <small><span class="mono">/api</span> passe par le proxy de <span class="mono">server.mjs</span> (recommandé : openvasd n'envoie pas d'en-têtes CORS).</small></label>
          <label class="field"><span>Clé API <span class="faint">(X-API-KEY)</span></span>
            <span class="input-icon">${icon("key")}<input class="input" id="key" type="password" autocomplete="off" value="${esc(draft.apiKey)}" placeholder="optionnelle" /></span>
            <small>Conservée dans ce navigateur. Préférez <span class="mono">OPENVASD_API_KEY</span> côté proxy en production.</small></label>
          <div class="row"><button class="btn" id="test">${icon("activity")}Tester</button><span id="result" class="muted"></span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><span class="step-num">${icon("settings")}</span><div><h2>Console</h2><div class="sub">Affichage et actualisation</div></div></div>
        <div class="card-body stack">
          <label class="field"><span>Intervalle d'actualisation des scans en cours</span>
            <select class="select" id="poll">${[2, 3, 5, 10, 30].map((s) => `<option value="${s}" ${draft.poll === s ? "selected" : ""}>${s} secondes</option>`).join("")}</select></label>
          <label class="toggle"><input type="checkbox" id="enrich" ${draft.enrich ? "checked" : ""} />
            <span><b>Enrichir les résultats avec le catalogue VT</b><br /><small class="faint">Télécharge les métadonnées du feed pour afficher noms, scores CVSS et solutions. Volumineux sur un feed complet.</small></span></label>
          <label class="toggle"><input type="checkbox" id="notify" ${draft.notify ? "checked" : ""} />
            <span><b>Notifications du navigateur</b><br /><small class="faint">Prévient quand un scan se termine, même si l'onglet est en arrière-plan.</small></span></label>
          <div class="field"><span>Thème</span><div class="seg" id="theme-seg"><button data-theme="dark">Sombre</button><button data-theme="light">Clair</button></div></div>
        </div>
      </section>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:20px">
      <button class="btn btn-primary" id="save">${icon("check")}Enregistrer</button>
    </div>`;

  const seg = () => {
    root.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === draft.mode));
    root.querySelectorAll("#theme-seg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === (document.documentElement.dataset.theme || "dark")));
    root.querySelector("#base").disabled = root.querySelector("#key").disabled = draft.mode === "demo";
  };
  seg();

  const read = () => {
    draft.base = root.querySelector("#base").value.trim() || "/api";
    draft.apiKey = root.querySelector("#key").value;
    draft.poll = Number(root.querySelector("#poll").value);
    draft.enrich = root.querySelector("#enrich").checked;
    draft.notify = root.querySelector("#notify").checked;
  };

  root.onclick = async (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) return ((draft.mode = m.dataset.mode), seg());
    const t = e.target.closest("[data-theme]");
    if (t) {
      applyTheme(t.dataset.theme);
      return seg();
    }
    if (e.target.closest("#test")) {
      read();
      const prev = { ...settings };
      saveSettings(draft);
      const out = root.querySelector("#result");
      out.textContent = "Connexion…";
      try {
        const info = await api().info();
        out.innerHTML = `<span style="color:var(--ok)">Connecté</span> · API v${esc(info.apiVersion)} · feed <span class="mono">${esc(info.feedVersion)}</span> · ${info.ready ? "prêt" : "non prêt"}`;
      } catch (err) {
        out.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
      } finally {
        saveSettings(prev);
      }
      return;
    }
    if (e.target.closest("#save")) {
      read();
      if (draft.notify && "Notification" in window && Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          draft.notify = false;
          root.querySelector("#notify").checked = false;
          toast("Notifications refusées", "Autorisez-les dans les réglages du navigateur.", "error");
        }
      }
      saveSettings(draft);
      resetStore();
      toast("Paramètres enregistrés", draft.mode === "demo" ? "Mode démo actif" : `Scanner : ${draft.base}`);
      refreshStatus();
    }
  };
}

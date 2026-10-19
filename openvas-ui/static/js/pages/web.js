// Scan de sites web : à partir d'une URL, prépare un scan openvasd ciblant le
// nom d'hôte, les ports HTTP(S) et les familles de VTs web.
import { api } from "../api.js";
import { refreshInfo } from "../app.js";
import { esc, icon, pageHead, statusPill, sevBadge, levelOf, fmtDate, empty, toast, $ } from "../ui.js";

const PROFILES = {
  web: ["Web (recommandé)", "Serveur web, applications, SSL/TLS, comptes par défaut"],
  full: ["Complet", "Tout le flux sur l'hôte du site : plus long et plus intrusif"],
};

/** Découpe une URL saisie par l'utilisateur ; lève une erreur si elle est invalide. */
export function parseSite(raw) {
  let text = raw.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = "https://" + text;
  let u;
  try { u = new URL(text); } catch { throw new Error(`Adresse invalide : ${raw}`); }
  if (!u.hostname) throw new Error(`Adresse invalide : ${raw}`);
  const https = u.protocol === "https:";
  const port = u.port ? +u.port : https ? 443 : 80;
  return { url: `${u.protocol}//${u.host}${u.pathname}`, host: u.hostname, port, https, path: u.pathname.replace(/\/+$/, "") };
}

export async function render(view) {
  const scans = (await api.get("/scans")).filter((s) => s.kind === "web");
  let profile = "web";

  view.innerHTML = pageHead({
    eyebrow: "Supervision", eyeIcon: "web", title: "Scan de site web",
    sub: "Analysez un site ou une application web : serveur, configuration HTTPS, vulnérabilités connues des produits détectés.",
  }) + `
  <div class="grid g-main">
    <form class="card" data-form autocomplete="off" data-write>
      <div class="card-h"><h3>Nouveau scan de site</h3></div>
      <div class="card-b grid" style="gap:16px">
        <div class="field"><label>Adresses des sites *</label>
          <textarea class="input" name="urls" rows="4" placeholder="https://www.exemple.fr\nhttps://intranet.exemple.local:8443/app"></textarea>
          <span class="help">Une adresse par ligne. Le chemin (ex. <span class="mono">/app</span>) est ajouté aux répertoires analysés.</span></div>
        <div class="field"><label>Nom du scan</label><input class="input" name="sitename" placeholder="Site institutionnel"></div>
        <div class="field"><label>Profil</label>
          <div class="option-cards" data-profiles>${Object.entries(PROFILES).map(([k, [l, d]]) => `<div class="option-card ${k === profile ? "on" : ""}" data-p="${k}"><b>${l}</b><span>${d}</span></div>`).join("")}</div></div>
        <label class="check"><input type="checkbox" name="both"> Tester aussi l'autre protocole (HTTP 80 et HTTPS 443)</label>
        <div class="banner" style="margin:0">${icon("alert")}<span>Ne scannez que des sites dont vous êtes responsable ou pour lesquels vous avez une autorisation écrite. Le scan envoie de nombreuses requêtes et peut être détecté comme une attaque (WAF, hébergeur).</span></div>
        <label class="check"><input type="checkbox" name="authorized"> Je confirme être autorisé à scanner ces sites</label>
        <div data-preview class="muted small"></div>
        <button class="btn btn-primary" type="submit" style="height:40px">${icon("play")}Lancer le scan</button>
      </div>
    </form>
    <div class="card"><div class="card-h"><h3>Ce qui est vérifié</h3></div><div class="card-b">
      <ul style="margin:0;padding-left:18px;line-height:1.9;color:var(--text-2)">
        <li>Version du serveur web et des produits détectés (Apache, Nginx, IIS, PHP, CMS…) et leurs CVE</li>
        <li>Certificat et configuration SSL/TLS (protocoles obsolètes, chiffrements faibles, expiration)</li>
        <li>Méthodes HTTP dangereuses, répertoires et fichiers exposés</li>
        <li>Comptes et pages d'administration par défaut</li>
        <li>Failles applicatives connues (CGI, injections, XSS) des produits reconnus</li>
      </ul>
      <p class="muted small" style="margin:12px 0 0">OpenVAS n'est pas un scanner applicatif complet (comme OWASP ZAP) : il ne parcourt pas les formulaires authentifiés de votre application.</p>
    </div></div>
  </div>
  <div class="card mt"><div class="card-h"><h3>Sites analysés</h3></div>
    ${scans.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Scan</th><th>Site</th><th>Statut</th><th>Vulnérabilités</th><th>Début</th></tr></thead><tbody>
    ${scans.map((s) => `<tr class="click" data-id="${esc(s.id)}"><td class="name">${esc(s.name)}</td>
      <td class="mono small">${esc((s.site || []).join(", ") || (s.targets || []).join(", "))}</td>
      <td>${statusPill(s.status.status)}</td>
      <td>${s.summary?.vulns ? sevBadge(levelOf(s.summary.max_severity), s.summary.max_severity) + ` <span class="muted small">${s.summary.vulns}</span>` : '<span class="muted">—</span>'}</td>
      <td class="small muted">${fmtDate(s.status.start_time || s.created)}</td></tr>`).join("")}</tbody></table></div>`
      : empty("Aucun site analysé", "Saisissez une adresse ci-dessus pour lancer le premier scan.", "web")}</div>`;

  view.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = `#/scans/${tr.dataset.id}`)));
  const form = $("[data-form]", view);

  const build = () => {
    const sites = form.urls.value.split(/\n+/).map(parseSite).filter(Boolean);
    const hosts = [...new Set(sites.map((s) => s.host))];
    const ports = new Set(sites.map((s) => s.port));
    if (form.both.checked) { ports.add(80); ports.add(443); }
    const paths = [...new Set(sites.map((s) => s.path).filter(Boolean))];
    const prefs = [{ id: "expand_vhosts", value: "true" }, { id: "test_empty_vhost", value: "false" }];
    if (paths.length) prefs.push({ id: "cgi_path", value: [...paths, "/cgi-bin", "/scripts"].join(":") });
    return {
      sites,
      scan: {
        target: {
          hosts,
          ports: [{ protocol: "tcp", range: [...ports].sort((a, b) => a - b).map((p) => ({ start: p })) }],
          // Les sites web filtrent souvent le ping : on les considère joignables.
          alive_test_methods: ["consider_alive"],
        },
        vts: [],
        scan_preferences: prefs,
      },
    };
  };

  const preview = () => {
    const el = $("[data-preview]", form);
    try {
      const { scan } = build();
      el.textContent = scan.target.hosts.length
        ? `Cible : ${scan.target.hosts.join(", ")} — ports TCP ${scan.target.ports[0].range.map((r) => r.start).join(", ")}`
        : "";
      el.style.color = "";
    } catch (e) { el.textContent = e.message; el.style.color = "var(--crit-fg)"; }
  };
  form.addEventListener("input", preview);
  $("[data-profiles]", form).onclick = (e) => {
    const c = e.target.closest("[data-p]"); if (!c) return;
    profile = c.dataset.p;
    form.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === c));
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { sites, scan } = build();
      if (!sites.length) throw new Error("Indiquez au moins une adresse.");
      if (!form.authorized.checked) throw new Error("Confirmez que vous êtes autorisé à scanner ces sites.");
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      const r = await api.post("/scans", {
        name: form.elements.sitename.value.trim() || sites[0].host, kind: "web", site: sites.map((s) => s.url),
        scan, vt_selection: { mode: profile === "web" ? "web" : "all" },
      }).finally(() => (btn.disabled = false));
      toast("Scan du site lancé");
      refreshInfo();
      location.hash = `#/scans/${r.id}`;
    } catch (err) { toast(err.message, "err"); }
  };
}

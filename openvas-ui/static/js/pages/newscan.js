// Création d'un scan (construit la requête POST /scans d'openvasd).
import { api } from "../api.js";
import { refreshInfo } from "../app.js";
import { esc, icon, pageHead, toast, copy, $ } from "../ui.js";

const COMMON = "21-23,25,53,80,110-111,135,139,143,443,445,993,995,1723,3306,3389,5432,5900,6379,8080,8443";
export const PORT_PRESETS = {
  common: ["Ports usuels", "TCP et UDP des services courants", `T:${COMMON},U:53,123,161,500`],
  tcp1024: ["TCP 1-1024", "Ports systèmes TCP", "T:1-1024"],
  alltcp: ["Tous les ports TCP", "1-65535, plus long", "T:1-65535"],
  alltcpudp: ["TCP complet + UDP top", "1-65535 TCP et 100 UDP", "T:1-65535,U:7,9,17,19,49,53,67-69,80,88,111,120,123,135-139,158,161-162,177,427,443,445,497,500,514-515,518,520,593,623,626,631,996-999,1022-1023,1025-1030,1433-1434,1645-1646,1701,1718-1719,1812-1813,1900,2000,2048-2049,2222-2223,3283,3456,3703,4444,4500,5000,5060,5353,5632,9200,10000,17185,20031,30718,31337,32768-32769,32771,32815,33281,49152-49154,49156,49181-49182,49185-49186,49188,49190-49194,49200-49201,65024"],
  custom: ["Personnalisée", "Syntaxe T:…,U:…", ""],
};
const ALIVE = [["icmp", "ICMP", "Ping ICMP"], ["tcp_syn", "TCP SYN", "Ping TCP SYN"], ["tcp_ack", "TCP ACK", "Ping TCP ACK"], ["arp", "ARP", "Réseau local"], ["consider_alive", "Considérer actif", "Pas de test"]];

export function parsePorts(spec) {
  const out = { tcp: [], udp: [] };
  let proto = "tcp";
  for (let tok of spec.split(/[,\s]+/).filter(Boolean)) {
    const m = tok.match(/^([TU]):(.*)$/i);
    if (m) { proto = m[1].toUpperCase() === "U" ? "udp" : "tcp"; tok = m[2]; }
    if (!tok) continue;
    const [a, b] = tok.split("-").map((x) => parseInt(x, 10));
    if (!a || a > 65535 || (b && (b > 65535 || b < a))) throw new Error(`Port invalide : ${tok}`);
    out[proto].push(b && b !== a ? { start: a, end: b } : { start: a });
  }
  return ["tcp", "udp"].filter((p) => out[p].length).map((p) => ({ protocol: p, range: out[p] }));
}

const lines = (v) => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export async function render(view, _p, ctx) {
  const dup = ctx.query.get("from");
  const [prefs, vts] = await Promise.all([api.get("/preferences").catch(() => []), api.get("/vts?size=1").catch(() => ({ families: [], total: 0 }))]);
  const f = {
    name: "", hosts: "", excluded: "", preset: "common", custom: "T:22,80,443", alive: new Set(["icmp", "tcp_syn", "consider_alive"]),
    sshOn: false, sshUser: "", sshPass: "", sshKey: "", sshPort: 22, smbOn: false, smbUser: "", smbPass: "",
    snmpOn: false, snmpCommunity: "", vtMode: "all", families: new Set(), prefs: {}, start: true,
  };
  if (dup) {
    try {
      const s = await api.get(`/scans/${dup}`);
      f.name = s.name + " (copie)";
      f.hosts = (s.config.target?.hosts || []).join("\n");
      f.excluded = (s.config.target?.excluded_hosts || []).join("\n");
    } catch { /* ignoré */ }
  }

  const buildReq = () => {
    const target = { hosts: lines(f.hosts) };
    if (lines(f.excluded).length) target.excluded_hosts = lines(f.excluded);
    target.ports = parsePorts(f.preset === "custom" ? f.custom : PORT_PRESETS[f.preset][2]);
    target.alive_test_methods = [...f.alive];
    const creds = [];
    if (f.sshOn && f.sshUser) creds.push(f.sshKey
      ? { service: "ssh", port: +f.sshPort || 22, usk: { username: f.sshUser, password: f.sshPass, private: f.sshKey } }
      : { service: "ssh", port: +f.sshPort || 22, up: { username: f.sshUser, password: f.sshPass } });
    if (f.smbOn && f.smbUser) creds.push({ service: "smb", up: { username: f.smbUser, password: f.smbPass } });
    if (f.snmpOn && f.snmpCommunity) creds.push({ service: "snmp", snmp: { username: "", password: "", community: f.snmpCommunity, auth_algorithm: "", privacy_password: "", privacy_algorithm: "" } });
    if (creds.length) target.credentials = creds;
    const scan_preferences = Object.entries(f.prefs).map(([id, value]) => ({ id, value: String(value) }));
    return { target, vts: [], scan_preferences };
  };

  const preview = () => {
    let txt;
    try {
      const req = buildReq();
      req.vts = f.vtMode === "all" ? [`… ${vts.total || "tous les"} VTs du flux`] : [`… VTs des familles : ${[...f.families].join(", ")}`];
      for (const c of req.target.credentials || []) for (const v of Object.values(c)) if (v && typeof v === "object") for (const k of ["password", "private", "community"]) if (v[k]) v[k] = "••••••";
      txt = JSON.stringify(req, null, 2);
    } catch (e) { txt = "⚠ " + e.message; }
    const el = $("[data-preview]", view); if (el) el.textContent = txt;
  };

  view.innerHTML = pageHead({
    eyebrow: "Supervision", eyeIcon: "plus", title: "Nouveau scan",
    sub: "Définissez la cible, les ports et les identifiants ; la requête est envoyée à openvasd.",
  }) + `
  <form class="grid g-main" data-form autocomplete="off">
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-h"><h3>Cible</h3></div><div class="card-b form-grid">
        <div class="field full"><label>Nom du scan</label><input class="input" data-k="name" placeholder="ex. Serveurs DMZ — hebdomadaire" value="${esc(f.name)}"></div>
        <div class="field"><label>Hôtes à analyser *</label><textarea class="input" rows="5" data-k="hosts" placeholder="192.168.1.10\n10.0.5.0/24\n192.168.0.1-15\nserveur.exemple.fr">${esc(f.hosts)}</textarea>
          <span class="help">Un par ligne : IPv4/IPv6, plage, CIDR ou nom d'hôte.</span></div>
        <div class="field"><label>Hôtes exclus</label><textarea class="input" rows="5" data-k="excluded" placeholder="192.168.1.1">${esc(f.excluded)}</textarea></div>
      </div></div>

      <div class="card"><div class="card-h"><h3>Ports</h3></div><div class="card-b">
        <div class="option-cards" data-presets>${Object.entries(PORT_PRESETS).map(([k, [l, d]]) => `<div class="option-card ${f.preset === k ? "on" : ""}" data-preset="${k}"><b>${l}</b><span>${d}</span></div>`).join("")}</div>
        <div class="field" style="margin-top:12px" data-custom ${f.preset === "custom" ? "" : "hidden"}><label>Liste personnalisée</label>
          <input class="input mono" data-k="custom" value="${esc(f.custom)}"><span class="help">Exemple : T:1-1024,3306,U:53,161</span></div>
      </div></div>

      <div class="card"><div class="card-h"><h3>Détection des hôtes actifs</h3></div><div class="card-b">
        <div class="option-cards">${ALIVE.map(([k, l, d]) => `<div class="option-card ${f.alive.has(k) ? "on" : ""}" data-alive="${k}"><b>${l}</b><span>${d}</span></div>`).join("")}</div>
      </div></div>

      <div class="card"><div class="card-h"><h3>Identifiants (scan authentifié)</h3><span class="hint">facultatif — améliore fortement la détection</span></div><div class="card-b grid">
        ${credBlock("ssh", "SSH", f.sshOn, `
          <div class="field"><label>Utilisateur</label><input class="input" data-k="sshUser"></div>
          <div class="field"><label>Mot de passe / phrase secrète</label><input class="input" type="password" data-k="sshPass"></div>
          <div class="field"><label>Port</label><input class="input" type="number" data-k="sshPort" value="22"></div>
          <div class="field full"><label>Clé privée (facultatif)</label><textarea class="input" rows="3" data-k="sshKey" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></div>`)}
        ${credBlock("smb", "SMB (Windows)", f.smbOn, `
          <div class="field"><label>Utilisateur</label><input class="input" data-k="smbUser" placeholder="DOMAINE\\utilisateur"></div>
          <div class="field"><label>Mot de passe</label><input class="input" type="password" data-k="smbPass"></div>`)}
        ${credBlock("snmp", "SNMP v1/v2c", f.snmpOn, `<div class="field"><label>Communauté</label><input class="input" type="password" data-k="snmpCommunity"></div>`)}
      </div></div>

      <div class="card"><div class="card-h"><h3>Tests de vulnérabilité</h3><span class="hint">${vts.total || 0} VTs disponibles</span></div><div class="card-b">
        <div class="seg" data-vtmode><button type="button" data-m="all" class="on">Flux complet</button><button type="button" data-m="families">Par famille</button></div>
        <div data-families hidden style="margin-top:12px;max-height:260px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px">
          ${(vts.families || []).map(([fam, n]) => `<label class="check"><input type="checkbox" value="${esc(fam)}" data-fam>${esc(fam)} <span class="muted small">${n}</span></label>`).join("") || '<span class="muted">Métadonnées des VTs en cours de chargement…</span>'}
        </div>
      </div></div>

      ${prefs.length ? `<div class="card"><div class="card-h"><h3>Préférences du scanner</h3><span class="hint">valeurs par défaut d'openvasd</span></div>
        <div class="table-scroll"><table class="table"><tbody>${prefs.map((p) => `<tr><td><div class="name">${esc(p.name || p.id)}</div><div class="muted small">${esc(p.description || "")}</div></td>
          <td class="right" style="width:140px">${typeof p.default === "boolean"
            ? `<button type="button" class="toggle ${p.default ? "on" : ""}" data-pref="${esc(p.id)}" data-bool="${p.default}"></button>`
            : `<input class="input" style="width:110px" data-pref="${esc(p.id)}" value="${esc(p.default)}" data-default="${esc(p.default)}">`}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    </div>

    <div style="position:sticky;top:76px;align-self:start" class="grid">
      <div class="card"><div class="card-h"><h3>Lancement</h3></div><div class="card-b grid" style="gap:12px">
        <label class="check"><input type="checkbox" data-k="start" checked>Démarrer immédiatement</label>
        <button class="btn btn-primary" type="submit" style="height:40px">${icon("play")}Créer le scan</button>
        <a class="btn" href="#/schedules?new=1">${icon("calendar")}Planifier plutôt</a>
      </div></div>
      <div class="card"><div class="card-h"><h3>Aperçu de la requête</h3><div class="right"><button type="button" class="btn btn-sm" data-copy>${icon("copy")}</button></div></div>
        <div class="card-b"><pre class="pre" data-preview style="max-height:420px"></pre></div></div>
    </div>
  </form>`;

  const form = $("[data-form]", view);
  form.addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (k) f[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (e.target.dataset.pref) { const v = e.target.value; v === e.target.dataset.default ? delete f.prefs[e.target.dataset.pref] : (f.prefs[e.target.dataset.pref] = v); }
    if (e.target.dataset.fam !== undefined) e.target.checked ? f.families.add(e.target.value) : f.families.delete(e.target.value);
    preview();
  });
  form.addEventListener("click", (e) => {
    const t = e.target.closest("[data-preset],[data-alive],[data-cred],[data-pref][data-bool],[data-m],[data-copy]");
    if (!t) return;
    if (t.dataset.preset) {
      f.preset = t.dataset.preset;
      form.querySelectorAll("[data-preset]").forEach((x) => x.classList.toggle("on", x === t));
      $("[data-custom]", form).hidden = f.preset !== "custom";
    } else if (t.dataset.alive) {
      const k = t.dataset.alive;
      f.alive.has(k) ? f.alive.delete(k) : f.alive.add(k);
      t.classList.toggle("on", f.alive.has(k));
    } else if (t.dataset.cred) {
      const k = t.dataset.cred + "On"; f[k] = !f[k];
      t.classList.toggle("on", f[k]);
      $(`[data-credbody="${t.dataset.cred}"]`, form).hidden = !f[k];
    } else if (t.dataset.bool !== undefined) {
      const on = !t.classList.contains("on"); t.classList.toggle("on", on);
      String(on) === t.dataset.bool ? delete f.prefs[t.dataset.pref] : (f.prefs[t.dataset.pref] = on);
    } else if (t.dataset.m) {
      f.vtMode = t.dataset.m;
      form.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === t));
      $("[data-families]", form).hidden = f.vtMode !== "families";
    } else if (t.dataset.copy !== undefined) copy($("[data-preview]", form).textContent);
    preview();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const scan = buildReq();
      if (!scan.target.hosts.length) throw new Error("Indiquez au moins un hôte à analyser.");
      if (f.vtMode === "families" && !f.families.size) throw new Error("Sélectionnez au moins une famille de VTs.");
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      const r = await api.post("/scans", {
        name: f.name || `Scan ${scan.target.hosts.slice(0, 2).join(", ")}`, scan, start: f.start,
        vt_selection: f.vtMode === "all" ? { mode: "all" } : { mode: "families", families: [...f.families] },
      }).finally(() => (btn.disabled = false));
      toast(f.start ? "Scan créé et démarré" : "Scan créé");
      refreshInfo();
      location.hash = `#/scans/${r.id}`;
    } catch (err) { toast(err.message, "err"); }
  });
  preview();
}

const credBlock = (k, label, on, body) => `<div>
  <div class="between"><b>${label}</b><button type="button" class="toggle ${on ? "on" : ""}" data-cred="${k}"></button></div>
  <div class="form-grid" style="margin-top:12px" data-credbody="${k}" ${on ? "" : "hidden"}>${body}</div></div>`;

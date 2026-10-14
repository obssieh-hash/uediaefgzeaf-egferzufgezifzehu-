import { api, labels } from "../api.js";
import { loadVts, shouldEnrich, vtsLoaded } from "../store.js";
import { esc, icon, num } from "../util.js";
import { fail, jsonHtml, skeletonRows, toast } from "../ui.js";

const ALIVE = [
  ["icmp", "ICMP ping"],
  ["tcp_syn", "TCP SYN"],
  ["tcp_ack", "TCP ACK"],
  ["arp", "ARP"],
  ["consider_alive", "Considérer actif"],
];

const SERVICES = [
  ["ssh", "SSH", 22],
  ["smb", "SMB", 445],
  ["esxi", "ESXi", 443],
  ["snmp", "SNMP", 161],
];

const PORT_PRESETS = [
  ["Courants", "21-23,25,53,80,110,111,135,139,143,443,445,993,995,1723,3306,3389,5432,5900,6379,8080,8443"],
  ["TCP 1-1024", "1-1024"],
  ["Tous TCP", "1-65535"],
];

const lines = (text) => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

function parsePorts(text) {
  const range = [];
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Port invalide : « ${part} »`);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : undefined;
    if (start < 1 || start > 65535 || (end && (end < start || end > 65535))) throw new Error(`Plage invalide : « ${part} »`);
    range.push(end && end !== start ? { start, end } : { start });
  }
  return range;
}

export default async function newScan(root) {
  const form = {
    name: "",
    hosts: "",
    excluded: "",
    ports: PORT_PRESETS[0][1],
    protocol: "tcp",
    alive: new Set(["icmp", "tcp_syn"]),
    creds: [],
    families: new Set(),
    full: true,
    oids: "",
    prefs: {},
  };
  let prefs = [];
  let catalog = null;
  let allOids = null;
  let oidsError = null;

  // "Dupliquer" on a scan page leaves its configuration here. openvasd
  // redacts passwords, so credentials come back without them.
  let prefill = null;
  try {
    prefill = JSON.parse(sessionStorage.getItem("ovc.prefill"));
    sessionStorage.removeItem("ovc.prefill");
  } catch {
    /* nothing to prefill */
  }
  if (prefill?.config) {
    const t = prefill.config.target || {};
    const p = t.ports || [];
    const protos = new Set(p.map((x) => x.protocol || "tcp"));
    form.name = prefill.name || "";
    form.hosts = (t.hosts || []).join("\n");
    form.excluded = (t.excluded_hosts || []).join("\n");
    if (p[0]?.range) form.ports = p[0].range.map((r) => (r.end ? `${r.start}-${r.end}` : r.start)).join(",");
    form.protocol = protos.size > 1 ? "both" : [...protos][0] || "tcp";
    if (t.alive_test_methods?.length) form.alive = new Set(t.alive_test_methods);
    form.creds = (t.credentials || []).map((c) => ({ service: c.service, port: c.port ? String(c.port) : "", username: (c.up || c.usk || c.snmp || c.krb5 || {}).username || "", password: "" }));
    form.oids = (prefill.config.vts || []).map((v) => v.oid).join("\n");
    form.full = false;
    for (const sp of prefill.config.scan_preferences || []) form.prefs[sp.id] = String(sp.value);
  }

  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon("bolt")} Assistant</div><h1>${prefill ? "Dupliquer un scan" : "Nouveau scan"}</h1>
      <p>Décrivez la cible, choisissez les tests, puis créez le scan dans openvasd.</p></div>
    </div>
    <div class="wizard">
      <div class="stack" id="steps">${`<div class="card">${skeletonRows(4)}</div>`.repeat(3)}</div>
      <aside class="sticky stack" id="side"></aside>
    </div>`;

  try {
    prefs = await api().preferences();
  } catch (err) {
    fail("Préférences indisponibles")(err);
  }
  if (shouldEnrich() || vtsLoaded()) catalog = await loadVts().catch(() => null);

  const families = () => {
    const map = new Map();
    for (const v of catalog?.values() || []) map.set(v.family, (map.get(v.family) || 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  function selectedOids() {
    if (form.full) return allOids || [];
    const set = new Set(lines(form.oids));
    if (catalog) for (const v of catalog.values()) if (form.families.has(v.family)) set.add(v.oid);
    return [...set];
  }

  function build() {
    const hosts = lines(form.hosts);
    if (!hosts.length) throw new Error("Indiquez au moins un hôte cible.");
    const range = parsePorts(form.ports);
    const target = {
      hosts,
      ports: form.protocol === "both" ? [{ protocol: "tcp", range }, { protocol: "udp", range }] : [{ protocol: form.protocol, range }],
      alive_test_methods: [...form.alive],
    };
    const excluded = lines(form.excluded);
    if (excluded.length) target.excluded_hosts = excluded;
    const creds = form.creds
      .filter((c) => c.username)
      .map((c) => {
        const base = { service: c.service, ...(c.port ? { port: Number(c.port) } : {}) };
        if (c.service === "snmp") return { ...base, snmp: { username: c.username, password: c.password, community: c.community || "public", auth_algorithm: "sha1", privacy_password: "", privacy_algorithm: "" } };
        return { ...base, up: { username: c.username, password: c.password } };
      });
    if (creds.length) target.credentials = creds;
    const body = { target, vts: selectedOids().map((oid) => ({ oid })) };
    const sp = Object.entries(form.prefs).map(([id, value]) => ({ id, value: String(value) }));
    if (sp.length) body.scan_preferences = sp;
    return body;
  }

  function drawSide() {
    let body;
    let error = null;
    try {
      body = build();
    } catch (err) {
      error = err.message;
    }
    const vtsPreview = body && body.vts.length > 5 ? [...body.vts.slice(0, 3), `… et ${num(body.vts.length - 3)} autres OIDs`] : body?.vts;
    const preview = body ? { ...body, vts: vtsPreview, target: { ...body.target, credentials: body.target.credentials?.map((c) => JSON.parse(JSON.stringify(c).replace(/"password":"[^"]*"/g, '"password":"••••"'))) } } : null;
    const vtsCount = body?.vts.length || 0;
    root.querySelector("#side").innerHTML = `
      <section class="card">
        <div class="card-head"><h3>Récapitulatif</h3></div>
        <div class="card-body stack" style="gap:12px">
          <dl class="kv">
            <dt>Cibles</dt><dd>${num(lines(form.hosts).length)} entrée(s)</dd>
            <dt>Ports</dt><dd>${esc(form.protocol.toUpperCase())} · ${esc(form.ports.length > 40 ? form.ports.slice(0, 40) + "…" : form.ports || "—")}</dd>
            <dt>Identifiants</dt><dd>${form.creds.filter((c) => c.username).length}</dd>
            <dt>Tests (VTs)</dt><dd>${form.full && allOids ? `Tous (${num(vtsCount)})` : num(vtsCount)}</dd>
            <dt>Préférences</dt><dd>${Object.keys(form.prefs).length} modifiée(s)</dd>
          </dl>
          ${error ? `<div class="banner warn" style="margin:0">${icon("alert")}<span>${esc(error)}</span></div>` : ""}
          ${!error && !vtsCount && form.full && !allOids && !oidsError ? `<div class="banner" style="margin:0">${icon("refresh", "spin")}<span>Récupération de la liste des tests du scanner…</span></div>` : ""}
          ${!error && !vtsCount && (!form.full || allOids || oidsError) ? `<div class="banner warn" style="margin:0">${icon("alert")}<span>${oidsError ? `Liste des tests indisponible : ${esc(oidsError)}` : "Aucun test de vulnérabilité (VT) sélectionné : le scan ne chercherait aucune faille. Choisissez « Scan complet » à l'étape 3."}</span></div>` : ""}
          <button class="btn btn-primary" data-create="start" ${error ? "disabled" : ""}>${icon("play")}Créer et démarrer</button>
          <button class="btn" data-create="store" ${error ? "disabled" : ""}>${icon("check")}Créer sans démarrer</button>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>Requête <span class="mono faint">POST /scans</span></h3></div>
        <div class="card-body"><pre class="code" style="max-height:340px">${preview ? jsonHtml(preview) : "—"}</pre></div>
      </section>`;
  }

  function drawCreds() {
    root.querySelector("#creds").innerHTML = form.creds.length
      ? form.creds.map((c, i) => `<div class="cred" data-i="${i}">
          <label class="field"><span>Service</span><select class="select" data-c="service">${SERVICES.map(([v, l]) => `<option value="${v}" ${c.service === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Utilisateur</span><input class="input" data-c="username" value="${esc(c.username)}" autocomplete="off" /></label>
          <label class="field"><span>Mot de passe</span><input class="input" type="password" data-c="password" value="${esc(c.password)}" autocomplete="new-password" /></label>
          <label class="field"><span>Port</span><input class="input" data-c="port" inputmode="numeric" value="${esc(c.port)}" /></label>
          <button class="icon-btn danger" data-del-cred="${i}" title="Retirer" style="margin-bottom:2px">${icon("trash")}</button>
        </div>`).join("")
      : `<p class="muted" style="margin:0">Sans identifiants, seuls les tests distants non authentifiés seront exécutés. Ajoutez un accès SSH ou SMB pour un audit local plus complet.</p>`;
  }

  // A VT (Vulnerability Test) is one check of the feed; openvasd runs only the
  // VTs listed in the request, so "full scan" sends every OID it knows.
  function drawMode() {
    root.querySelectorAll("[data-vtmode]").forEach((b) => b.classList.toggle("on", (b.dataset.vtmode === "full") === form.full));
    root.querySelector("#custom").classList.toggle("hidden", form.full);
    const info = root.querySelector("#fullinfo");
    info.classList.toggle("hidden", !form.full);
    info.innerHTML = allOids
      ? `${icon("check")} Les <b>${num(allOids.length)}</b> tests du feed seront exécutés. C'est le plus complet, mais aussi le plus long.`
      : oidsError ? `<span style="color:var(--danger)">${esc(oidsError)}</span>` : "Récupération de la liste des tests…";
    if (form.full && !allOids && !oidsError) {
      api()
        .oids()
        .then((list) => (allOids = list))
        .catch((err) => (oidsError = err.message))
        .finally(() => {
          drawMode();
          drawSide();
        });
    }
  }

  function drawFamilies() {
    const el = root.querySelector("#families");
    if (!el) return;
    if (!catalog) {
      el.innerHTML = `<div class="banner" style="margin:0">${icon("info")}<span class="grow">Chargez le catalogue de VTs du scanner pour sélectionner des familles entières.</span><button class="btn btn-sm" data-load-vts>${icon("download")}Charger</button></div>`;
      return;
    }
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted grow">${num(catalog.size)} VTs disponibles</span>
      <button class="btn btn-sm btn-ghost" data-fam-all>Tout sélectionner</button><button class="btn btn-sm btn-ghost" data-fam-none>Aucun</button></div>
      <div class="check-grid">${families().map(([f, n]) => `<label class="check ${form.families.has(f) ? "on" : ""}"><input type="checkbox" data-fam="${esc(f)}" ${form.families.has(f) ? "checked" : ""} /><span class="ellipsis">${esc(f)}</span><span class="n">${n}</span></label>`).join("")}</div>`;
  }

  root.querySelector("#steps").innerHTML = `
    <section class="card">
      <div class="card-head"><span class="step-num">1</span><div><h2>Cible</h2><div class="sub">Hôtes, réseaux et ports à analyser</div></div></div>
      <div class="card-body form-grid">
        <label class="field full"><span>Nom du scan</span><input class="input" data-f="name" placeholder="ex. Serveurs web — production" /><small>Le nom est conservé dans ce navigateur ; openvasd n'identifie les scans que par leur UUID.</small></label>
        <label class="field"><span>Hôtes</span><textarea class="textarea" data-f="hosts" placeholder="192.168.1.0/24&#10;10.0.0.5-20&#10;srv.example.com"></textarea><small>IP, plages, CIDR (IPv4/IPv6) ou noms d'hôtes — un par ligne.</small></label>
        <label class="field"><span>Hôtes exclus</span><textarea class="textarea" data-f="excluded" placeholder="192.168.1.1"></textarea><small>Optionnel.</small></label>
        <label class="field"><span>Ports</span><input class="input mono" data-f="ports" value="${esc(form.ports)}" /><span class="pills" style="margin-top:4px">${PORT_PRESETS.map(([l, v]) => `<button class="pill" data-ports="${v}">${l}</button>`).join("")}</span></label>
        <label class="field"><span>Protocole</span><select class="select" data-f="protocol"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="both">TCP + UDP</option></select></label>
        <div class="field full"><span>Détection des hôtes actifs</span><div class="pills" id="alive">${ALIVE.map(([v, l]) => `<button class="pill ${form.alive.has(v) ? "on" : ""}" data-alive="${v}">${l}</button>`).join("")}</div></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><span class="step-num">2</span><div><h2>Identifiants</h2><div class="sub">Scan authentifié (optionnel)</div></div>
        <div class="end"><button class="btn btn-sm" data-add-cred>${icon("plus")}Ajouter</button></div></div>
      <div class="card-body stack" id="creds"></div>
    </section>

    <section class="card">
      <div class="card-head"><span class="step-num">3</span><div><h2>Tests de vulnérabilité</h2><div class="sub">Familles du feed et OIDs spécifiques</div></div></div>
      <div class="card-body stack">
        <div class="seg" id="vtmode"><button data-vtmode="full">Scan complet (tous les tests)</button><button data-vtmode="custom">Sélection personnalisée</button></div>
        <p class="muted hidden" id="fullinfo" style="margin:0"></p>
        <div id="custom" class="stack">
        <div id="families"></div>
        <label class="field"><span>OIDs supplémentaires</span><textarea class="textarea" data-f="oids" placeholder="1.3.6.1.4.1.25623.1.0.10662"></textarea><small>Un OID par ligne. Les dépendances sont ajoutées automatiquement si « auto_enable_dependencies » est actif.</small></label>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><span class="step-num">4</span><div><h2>Préférences du scanner</h2><div class="sub">${prefs.length} options · seules les valeurs modifiées sont envoyées</div></div></div>
      <div class="card-body flush">${prefs.length
        ? prefs.map((p) => {
            const def = String(p.default ?? "");
            const bool = def === "true" || def === "false";
            return `<details class="pref"><summary>${icon("chevron")}<span class="grow"><b>${esc(p.name || p.id)}</b> <span class="mono faint" style="font-size:12px">${esc(p.id)}</span></span><span class="pref-changed hidden" data-changed="${esc(p.id)}">modifié</span><span class="tag mono">${esc(def || "—")}</span></summary>
              <div class="pref-body"><p class="muted" style="margin:0;font-size:13px">${esc(p.description || "")}</p>
              ${bool
                ? `<label class="toggle"><input type="checkbox" data-pref="${esc(p.id)}" data-default="${def}" ${def === "true" ? "checked" : ""} /><span>Activé</span></label>`
                : `<input class="input" data-pref="${esc(p.id)}" data-default="${esc(def)}" value="${esc(def)}" style="max-width:420px" />`}
              </div></details>`;
          }).join("")
        : `<div class="card-body muted">Aucune préférence exposée par le scanner.</div>`}</div>
    </section>`;

  root.querySelectorAll("[data-f]").forEach((el) => (el.value = form[el.dataset.f]));
  for (const [id, value] of Object.entries(form.prefs)) {
    const el = root.querySelector(`[data-pref="${CSS.escape(id)}"]`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = value === "true";
    else el.value = value;
    root.querySelector(`[data-changed="${CSS.escape(id)}"]`)?.classList.remove("hidden");
  }
  if (prefill) toast("Configuration reprise", form.creds.length ? "Ressaisissez les mots de passe des identifiants." : prefill.name, "info");
  drawCreds();
  drawFamilies();
  drawMode();
  drawSide();

  root.oninput = (e) => {
    const t = e.target;
    if (t.dataset.f) form[t.dataset.f] = t.value;
    else if (t.dataset.c) form.creds[Number(t.closest("[data-i]").dataset.i)][t.dataset.c] = t.value;
    else if (t.dataset.pref) {
      const v = t.type === "checkbox" ? String(t.checked) : t.value;
      if (v === t.dataset.default) delete form.prefs[t.dataset.pref];
      else form.prefs[t.dataset.pref] = v;
      root.querySelector(`[data-changed="${CSS.escape(t.dataset.pref)}"]`)?.classList.toggle("hidden", v === t.dataset.default);
    } else return;
    drawSide();
  };
  root.onchange = (e) => {
    const t = e.target;
    if (t.dataset.fam !== undefined) {
      t.checked ? form.families.add(t.dataset.fam) : form.families.delete(t.dataset.fam);
      t.closest(".check").classList.toggle("on", t.checked);
      drawSide();
    } else if (t.dataset.c === "service") {
      // Switching service also proposes its default port.
      const c = form.creds[Number(t.closest("[data-i]").dataset.i)];
      c.service = t.value;
      c.port = String(SERVICES.find(([v]) => v === c.service)?.[2] || "");
      drawCreds();
      drawSide();
    } else if ((t.dataset.pref || t.dataset.f || t.dataset.c) && (t.tagName === "SELECT" || t.type === "checkbox")) {
      // Text fields are already handled on input; redrawing again on blur
      // would replace the button the user is clicking.
      root.oninput(e);
    }
  };
  root.onclick = async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.ports) {
      form.ports = t.dataset.ports;
      root.querySelector('[data-f="ports"]').value = form.ports;
    } else if (t.dataset.alive) {
      const v = t.dataset.alive;
      form.alive.has(v) ? form.alive.delete(v) : form.alive.add(v);
      t.classList.toggle("on");
    } else if (t.hasAttribute("data-add-cred")) {
      form.creds.push({ service: "ssh", username: "", password: "", port: "22" });
      drawCreds();
    } else if (t.dataset.delCred) {
      form.creds.splice(Number(t.dataset.delCred), 1);
      drawCreds();
    } else if (t.hasAttribute("data-load-vts")) {
      t.disabled = true;
      t.innerHTML = `${icon("refresh", "spin")}Chargement…`;
      catalog = await loadVts().catch((err) => (fail("Catalogue indisponible")(err), null));
      drawFamilies();
    } else if (t.hasAttribute("data-fam-all") || t.hasAttribute("data-fam-none")) {
      form.families = new Set(t.hasAttribute("data-fam-all") ? families().map(([f]) => f) : []);
      drawFamilies();
    } else if (t.dataset.vtmode) {
      form.full = t.dataset.vtmode === "full";
      drawMode();
    } else if (t.dataset.create) {
      return create(t.dataset.create === "start", t);
    } else return;
    drawSide();
  };

  async function create(start, btn) {
    let body;
    try {
      body = build();
    } catch (err) {
      return fail("Formulaire incomplet")(err);
    }
    root.querySelectorAll("[data-create]").forEach((b) => (b.disabled = true));
    btn.innerHTML = `${icon("refresh", "spin")}Création…`;
    try {
      const id = await api().createScan(body);
      labels.set(id, { name: form.name.trim() || `Scan ${lines(form.hosts)[0]}`, created: Math.floor(Date.now() / 1000), demo: api().mode === "demo" });
      if (start) await api().action(id, "start");
      toast(start ? "Scan créé et démarré" : "Scan créé", id);
      location.hash = `#/scans/${encodeURIComponent(id)}`;
    } catch (err) {
      fail("Création impossible")(err);
      drawSide();
    }
  }
}

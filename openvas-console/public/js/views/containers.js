// Container image scanning (openvasd /container-image-scanner): images are
// pulled from their registry, their packages listed and checked against
// the Notus advisories. Results are grouped by image and package.

import { api, labels, settings } from "../api.js";
import { enrich, resultSeverity, vt } from "../store.js";
import { can } from "../team.js";
import { chart, donut, mountCharts, SEV, SEV_NONE } from "../charts.js";
import { ago, download, esc, icon, num, severityBadge, severityLevel, statusChip } from "../util.js";
import { confirmDialog, empty, fail, skeletonRows, toast } from "../ui.js";
import { catalogNotice } from "./notice.js";

const SEV_ALL = [...SEV, SEV_NONE];

// "nginx:1.25" → "oci://docker.io/library/nginx:1.25"
export function normalizeImage(raw) {
  let ref = raw.trim().replace(/^oci:\/\//, "");
  if (!ref) return null;
  const first = ref.split("/")[0];
  const hasRegistry = ref.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost");
  if (!hasRegistry) ref = `docker.io/${ref.includes("/") ? ref : `library/${ref}`}`;
  if (!/[:@][^/]+$/.test(ref.split("/").slice(1).join("/"))) ref += ":latest";
  return `oci://${ref}`;
}

const shortImage = (img) => (img || "").replace(/^oci:\/\//, "").replace(/^docker\.io\/(library\/)?/, "");

function parsePackage(message = "") {
  const get = (k) => message.match(new RegExp(`${k}:\\s*(.+)`))?.[1]?.trim() || "";
  const name = get("Vulnerable package");
  const strip = (v) => (name && v.includes(`${name}-`) ? v.replace(`${name}-`, "") : v);
  return { name, installed: strip(get("Installed version")), fixed: strip(get("Fixed version")) };
}

function containerScans() {
  return Object.entries(labels.all())
    .filter(([, l]) => l.kind === "container")
    .map(([id, l]) => ({ id, ...l }))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
}

function detail(root, scan, status, results) {
  const byImage = new Map();
  for (const r of results.filter((x) => x.type === "alarm")) {
    const img = r.hostname || r.ip_address;
    if (!byImage.has(img)) byImage.set(img, { image: img, digest: r.ip_address, findings: [], sev: {} });
    const g = byImage.get(img);
    g.findings.push(r);
    const k = severityLevel(resultSeverity(r)).key;
    g.sev[k] = (g.sev[k] || 0) + 1;
  }
  const images = [...byImage.values()].sort((a, b) => b.findings.length - a.findings.length);
  const total = {};
  for (const g of images) for (const [k, n] of Object.entries(g.sev)) total[k] = (total[k] || 0) + n;
  const scanned = scan.imagesList || [];
  const clean = scanned.filter((img) => !byImage.has(img));
  const live = ["running", "requested"].includes(status.status);

  root.querySelector("#detail").innerHTML = `
    <div class="page-head" style="margin-top:8px">
      <div class="grow"><div class="eyebrow">${statusChip(status.status)}</div><h1 style="font-size:22px">${esc(scan.name)}</h1>
        <p class="mono faint" style="font-size:12px">${esc(scan.id)}</p></div>
      <div class="actions">
        <button class="btn" data-csv ${results.length ? "" : "disabled"}>${icon("download")}CSV</button>
        <button class="btn btn-danger needs-analyste" data-delete ${live ? "disabled" : ""}>${icon("trash")}Supprimer</button>
      </div>
    </div>
    ${catalogNotice(results.filter((r) => r.type === "alarm" && resultSeverity(r) == null).length)}
    ${live ? `<div class="banner">${icon("refresh", "spin")}<div class="grow">Analyse en cours : téléchargement des images et inventaire des paquets (${status.host_info?.finished || 0}/${status.host_info?.all || "?"} images).</div></div>` : ""}
    <div class="grid g-3" style="margin-bottom:16px">
      <section class="card fill"><div class="card-head"><h2>Sévérité</h2></div>
        <div class="card-body">${donut(SEV_ALL.map((k) => ({ label: k.label, value: total[k.key] || 0, color: k.color })), { sub: "paquets", size: 136 })}</div></section>
      <section class="card fill span-2"><div class="card-head"><h2>Vulnérabilités par image</h2></div>
        <div class="card-body">${images.length ? chart("columns", { columns: images.slice(0, 10).map((g) => ({ label: shortImage(g.image).split("/").pop(), title: shortImage(g.image), values: g.sev })), keys: SEV_ALL, height: 200 }) : empty("check", live ? "Résultats à venir" : "Aucune vulnérabilité", live ? "Les paquets vulnérables apparaîtront à la fin de l'analyse." : "Aucun paquet vulnérable connu dans ces images.")}</div></section>
    </div>
    ${images.map((g) => `<section class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="avatar">${icon("package")}</span><div class="grow" style="min-width:0"><h3 class="mono ellipsis">${esc(shortImage(g.image))}</h3><div class="sub mono ellipsis">${esc(g.digest || "")}</div></div>
        <div class="end">${SEV.filter((k) => g.sev[k.key]).map((k) => `<span class="sev sev-${k.key}" style="padding:0 6px 0 4px"><b style="min-width:26px">${g.sev[k.key]}</b></span>`).join("")}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th style="width:120px">Sévérité</th><th>Paquet</th><th>Installé</th><th>Corrigé</th><th class="hide-sm">Avis de sécurité</th></tr></thead><tbody>
        ${g.findings.sort((a, b) => (resultSeverity(b) ?? -1) - (resultSeverity(a) ?? -1)).map((r) => {
          const p = parsePackage(r.message);
          const cves = (vt(r.oid)?.references || []).filter((x) => x.class === "cve").map((x) => x.id);
          return `<tr><td>${severityBadge(resultSeverity(r))}</td><td class="cell-title mono">${esc(p.name || "?")}</td>
            <td><span class="tag mono" style="color:var(--danger)">${esc(p.installed || "—")}</span></td>
            <td><span class="tag mono" style="color:var(--ok)">${esc(p.fixed || "—")}</span></td>
            <td class="hide-sm"><div class="ellipsis" style="max-width:340px">${esc(vt(r.oid)?.name || r.oid)}</div><div class="cell-sub">${cves.map(esc).join(", ") || esc(r.oid)}</div></td></tr>`;
        }).join("")}
      </tbody></table></div></section>`).join("")}
    ${clean.length && !live ? `<section class="card"><div class="card-head"><h3>Images sans vulnérabilité connue</h3></div><div class="card-body pills">${clean.map((i) => `<span class="tag mono">${esc(shortImage(i))}</span>`).join("")}</div></section>` : ""}`;
  mountCharts(root);
}

export default async function containers(root, param) {
  let timer;
  let alive = true;
  const editable = can("analyste");

  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon("package")} Conteneurs</div><h1>Images Docker</h1>
        <p>Analysez des images de conteneurs (Docker Hub ou registre privé) : Sentrovyx inventorie leurs paquets et signale ceux qui ont des vulnérabilités connues, avant même leur déploiement.</p></div>
    </div>
    <div class="grid g-main" style="margin-bottom:20px">
      <section class="card">
        <div class="card-head"><span class="step-num">${icon("plus")}</span><div><h2>Nouvelle analyse</h2><div class="sub">Une image par ligne</div></div></div>
        ${editable ? `<form class="card-body stack" id="cform">
          <label class="field"><span>Nom de l'analyse</span><input class="input" name="name" placeholder="ex. Images de production" /></label>
          <label class="field"><span>Images</span><textarea class="textarea" name="images" rows="4" placeholder="nginx:1.25&#10;docker.io/library/ubuntu:22.04&#10;registry.entreprise.local/app/api:2.4.1" required></textarea>
            <small>Un nom court (<span class="mono">nginx:1.25</span>) désigne Docker Hub. Sans tag, <span class="mono">:latest</span> est utilisé.</small></label>
          <details><summary class="muted" style="cursor:pointer">Registre privé (identifiants, HTTP, certificats)</summary>
            <div class="form-grid" style="margin-top:12px">
              <label class="field"><span>Utilisateur du registre</span><input class="input" name="username" autocomplete="off" /></label>
              <label class="field"><span>Mot de passe ou jeton</span><input class="input" type="password" name="password" autocomplete="new-password" /></label>
              <label class="toggle full"><input type="checkbox" name="insecure" /><span>Autoriser HTTP si le registre n'a pas HTTPS</span></label>
              <label class="toggle full"><input type="checkbox" name="certs" checked /><span>Accepter les certificats auto-signés</span></label>
            </div></details>
          <button class="btn btn-primary" style="justify-self:start">${icon("play")}Lancer l'analyse</button>
        </form>` : `<div class="card-body muted">Votre rôle permet de consulter les analyses, pas d'en lancer.</div>`}
      </section>
      <section class="card"><div class="card-head"><h2>Analyses</h2></div><div id="clist">${skeletonRows(4)}</div></section>
    </div>
    <div id="detail"></div>`;

  async function drawList() {
    const list = containerScans();
    const el = root.querySelector("#clist");
    if (!list.length) {
      el.innerHTML = empty("package", "Aucune analyse", "Indiquez des images à gauche pour lancer la première analyse.");
      return;
    }
    const statuses = await Promise.all(list.map((s) => api().containers.status(s.id).catch(() => null)));
    el.innerHTML = `<div class="list">${list.map((s, i) => `<a class="list-item" href="#/containers/${encodeURIComponent(s.id)}" style="${param === s.id ? "background:var(--accent-soft)" : ""}">
      <span class="avatar ${["running", "requested"].includes(statuses[i]?.status) ? "live" : ""}">${icon("package")}</span>
      <span class="grow"><b class="ellipsis" style="display:block">${esc(s.name)}</b><span class="faint" style="font-size:12.5px">${num(s.images || 0)} image(s) · ${ago(s.created)}</span></span>
      ${statuses[i] ? statusChip(statuses[i].status) : `<span class="chip chip-neutral">Supprimée</span>`}</a>`).join("")}</div>`;
  }

  async function drawDetail() {
    clearTimeout(timer);
    if (!param) return;
    const scan = { id: param, ...labels.get(param) };
    try {
      const status = await api().containers.status(param);
      const results = await api().containers.results(param);
      await enrich(results);
      if (!alive) return;
      detail(root, scan, status, results);
      if (["running", "requested"].includes(status.status)) timer = setTimeout(() => (drawDetail(), drawList()), settings.poll * 1000);
    } catch (err) {
      root.querySelector("#detail").innerHTML = `<div class="card">${empty("alert", "Analyse introuvable", err.message)}</div>`;
    }
  }

  root.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const images = f.images.split(/[\s,]+/).map(normalizeImage).filter(Boolean);
    if (!images.length) return fail("Analyse impossible")(new Error("Indiquez au moins une image."));
    const body = {
      target: { hosts: images, ...(f.username ? { credentials: [{ service: "generic", up: { username: f.username, password: f.password || "" } }] } : {}) },
      scan_preferences: [
        { id: "registry_allow_insecure", value: f.insecure ? "true" : "false" },
        { id: "accept_invalid_certs", value: f.certs ? "true" : "false" },
      ],
    };
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const id = await api().containers.create(body);
      await labels.set(id, { name: f.name.trim() || `Images · ${images.map(shortImage).slice(0, 2).join(", ")}`, kind: "container", images: images.length, imagesList: images, created: Math.floor(Date.now() / 1000), demo: api().mode === "demo" });
      await api().containers.action(id, "start");
      toast("Analyse lancée", `${images.length} image(s)`);
      location.hash = `#/containers/${encodeURIComponent(id)}`;
    } catch (err) {
      fail("Analyse impossible")(err);
      btn.disabled = false;
    }
  };

  root.onclick = async (e) => {
    if (e.target.closest("[data-csv]")) {
      const results = await api().containers.results(param);
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["image", "digest", "paquet", "installe", "corrige", "cvss", "avis", "oid"].join(",")];
      for (const r of results.filter((x) => x.type === "alarm")) {
        const p = parsePackage(r.message);
        lines.push([shortImage(r.hostname), r.ip_address, p.name, p.installed, p.fixed, resultSeverity(r) ?? "", vt(r.oid)?.name || "", r.oid].map(cell).join(","));
      }
      return download(`sentrovyx-images-${param.slice(0, 8)}.csv`, lines.join("\n"), "text/csv");
    }
    if (e.target.closest("[data-delete]")) {
      const name = labels.get(param).name;
      if (!(await confirmDialog({ title: "Supprimer l'analyse ?", body: `« ${name} » et ses résultats seront supprimés.`, confirm: "Supprimer", danger: true }))) return;
      try {
        await api().containers.remove(param).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
        await labels.remove(param);
        toast("Analyse supprimée", name);
        location.hash = "#/containers";
      } catch (err) {
        fail("Suppression impossible")(err);
      }
    }
  };

  await drawList();
  await drawDetail();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

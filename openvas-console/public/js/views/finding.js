// Finding sheet shared by the remediation plan and the scan page: what it
// is, how urgent (CVSS, KEV, EPSS, asset criticality), who handles it, by
// when, and the discussion and history around it.

import { CRITICALITY, assetRecord, intelOf, priorityLevel, priorityScore, requestVerification, slaState, TRIAGE, triageRecord, updateFinding, dueDate, VERIFY } from "../analytics.js";
import { resultSeverity, vt } from "../store.js";
import { can, teamMembers } from "../team.js";
import { esc, icon, severityBadge } from "../util.js";
import { drawer, fail, toast } from "../ui.js";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—");
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export function kevBadge(intel) {
  if (!intel?.kev) return "";
  return `<span class="chip chip-danger" data-tip="Exploitée activement (CISA KEV)&#10;Ajoutée le ${esc(intel.kev.added)}${intel.kev.ransomware ? "&#10;Utilisée par des rançongiciels" : ""}">${icon("bolt")}KEV${intel.kev.ransomware ? " · rançongiciel" : ""}</span>`;
}

export function epssBadge(intel) {
  if (intel?.epss == null) return "";
  const pct = Math.round(intel.epss * 1000) / 10;
  const tone = intel.epss >= 0.5 ? "danger" : intel.epss >= 0.1 ? "warn" : "neutral";
  return `<span class="chip chip-${tone}" data-tip="EPSS : probabilité d'exploitation dans les 30 jours&#10;${pct} %">EPSS ${pct} %</span>`;
}

export function priorityChip(score, r) {
  const p = priorityLevel(score, r);
  return `<span class="prio prio-${p.key}" data-tip="${esc(p.label)}&#10;Score de priorité ${score}/100">${p.key}</span>`;
}

function historyLine(h) {
  if (h.note) return `${h.state ? `<b>${esc(TRIAGE[h.state]?.label || h.state)}</b> — ` : ""}${esc(h.note)}`;
  if (h.state) return `a passé le statut à <b>${esc(TRIAGE[h.state]?.label || h.state)}</b>`;
  if ("owner" in h) return h.owner ? `a assigné à <b>${esc(h.owner)}</b>` : "a retiré l'assignation";
  if ("due" in h) return h.due ? `a fixé l'échéance au <b>${new Date(h.due).toLocaleDateString("fr-FR")}</b>` : "a retiré l'échéance";
  return "a modifié la fiche";
}

export function verifyChip(rec) {
  const v = rec?.verification && VERIFY[rec.verification.status];
  return v ? `<span class="chip chip-${v.tone}">${icon(v.icon)}${v.label}</span>` : "";
}

export function openFinding(r, { firstSeen, onChange, scanId } = {}) {
  const v = vt(r.oid);
  const tag = v?.tag || {};
  const score = resultSeverity(r);
  const editable = can("analyste");

  const render = () => {
    const rec = triageRecord(r);
    const intel = intelOf(r);
    const prio = priorityScore(r);
    const sla = slaState(r, firstSeen);
    const asset = assetRecord(r.ip_address);
    const refs = (v?.references || []).filter((x) => x.class === "cve").map((x) => x.id);
    const timeline = [
      ...(rec.history || []).map((h) => ({ at: h.at, by: h.by, html: historyLine(h) })),
      ...(rec.comments || []).map((c) => ({ at: c.at, by: c.by, html: `<span class="comment">${esc(c.text)}</span>`, comment: true })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    return {
      head: `<div class="row wrap" style="margin-bottom:8px;gap:6px">${severityBadge(score)}${priorityChip(prio, r)}${kevBadge(intel)}${epssBadge(intel)}</div>
        <h3>${esc(v?.name || r.oid)}</h3>
        <div class="faint mono" style="font-size:12px">${esc(r.ip_address)}${r.port ? ` · ${r.port}/${esc(r.protocol || "tcp")}` : ""} · ${esc(r.oid)}</div>`,
      body: `
        <section class="finding-form">
          <label class="field"><span>Statut</span>
            <select class="select" data-f="state" ${editable ? "" : "disabled"}>${Object.entries(TRIAGE).map(([k, t]) => `<option value="${k}" ${(rec.state || "new") === k ? "selected" : ""}>${t.label}</option>`).join("")}</select></label>
          <label class="field"><span>Responsable</span>
            <input class="input" data-f="owner" list="members" value="${esc(rec.owner || "")}" placeholder="Non assigné" ${editable ? "" : "disabled"} />
            <datalist id="members">${teamMembers().map((m) => `<option value="${esc(m.username)}">`).join("")}</datalist></label>
          <label class="field"><span>Échéance</span>
            <input class="input" type="date" data-f="due" value="${day(dueDate(r, firstSeen))}" ${editable ? "" : "disabled"} />
            <small><span class="chip chip-${sla.tone}">${esc(sla.label)}</span>${rec.due ? "" : " · calculée selon le SLA"}</small></label>
        </section>
        ${rec.verification || rec.state === "fixed" ? `<div class="verify-box">
            <div class="row wrap"><b>Vérification de la correction</b>${verifyChip(rec)}</div>
            <p class="muted" style="margin:6px 0 0;font-size:13px">${rec.verification?.status === "running" ? "Un scan ciblé (cet hôte, ce port, ce test) est en cours. Le résultat s'affichera ici automatiquement."
              : rec.verification?.status === "verified" ? `Le scan ciblé du ${new Date(rec.verification.finishedAt || rec.verifiedAt).toLocaleString("fr-FR")} ne détecte plus la vulnérabilité.`
              : rec.verification?.status === "failed" ? "Le scan ciblé détecte toujours la vulnérabilité : elle a été rouverte."
              : rec.verification?.status === "error" ? "Le scan de vérification n'a pas pu aboutir."
              : "Pas encore vérifiée par un scan."}
              ${rec.verification?.scan ? ` <a href="#/scans/${encodeURIComponent(rec.verification.scan)}" data-close><u>Voir le scan</u></a>` : ""}</p>
            ${editable && rec.verification?.status !== "running" ? `<button class="btn btn-sm" data-verify style="margin-top:10px">${icon("refresh")}${rec.verification ? "Relancer la vérification" : "Vérifier maintenant"}</button>` : ""}
          </div>` : ""}
        ${intel.kev ? `<div class="banner warn" style="margin:0">${icon("bolt")}<div class="grow"><b>Exploitée activement</b> (${esc(intel.kev.cve)}, catalogue CISA KEV depuis le ${esc(intel.kev.added)}). ${esc(intel.kev.action || "")}</div></div>` : ""}
        ${tag.summary ? `<div><h4>Résumé</h4><p>${esc(tag.summary)}</p></div>` : ""}
        ${tag.solution ? `<div><h4>Solution ${tag.solution_type ? `<span class="tag">${esc(tag.solution_type)}</span>` : ""}</h4><p>${esc(tag.solution)}</p></div>` : ""}
        <div><h4>Constat du scanner</h4><pre class="code">${esc(r.message || "—")}</pre></div>
        <dl class="kv">
          <dt>Actif</dt><dd><a href="#/assets/${encodeURIComponent(r.ip_address)}"><u>${esc(r.ip_address)}</u></a> · criticité ${esc(CRITICALITY[asset.criticality || "medium"].label.toLowerCase())}${asset.owner ? ` · propriétaire ${esc(asset.owner)}` : ""}</dd>
          ${firstSeen ? `<dt>1re détection</dt><dd>${new Date(firstSeen * 1000).toLocaleDateString("fr-FR", { dateStyle: "medium" })}</dd>` : ""}
          ${refs.length ? `<dt>CVE</dt><dd>${refs.map((c) => `<a class="tag mono" target="_blank" rel="noopener" href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c)}">${esc(c)}</a>`).join(" ")}</dd>` : ""}
          ${v?.family ? `<dt>Famille</dt><dd>${esc(v.family)}</dd>` : ""}
          <dt>Score de priorité</dt><dd>${prio}/100 <span class="faint">(CVSS × criticité de l'actif, + KEV, + EPSS)</span></dd>
        </dl>
        <div>
          <h4>Commentaires et historique</h4>
          ${editable ? `<div class="row" style="align-items:flex-start;margin-bottom:12px"><textarea class="textarea grow" data-comment rows="2" placeholder="Ajouter un commentaire (constat, ticket, correctif appliqué…)" style="min-height:60px;font-family:var(--font)"></textarea>
            <button class="btn btn-primary" data-send>${icon("check")}Publier</button></div>` : ""}
          ${timeline.length ? `<ul class="timeline">${timeline.map((t) => `<li class="${t.comment ? "is-comment" : ""}"><b>${esc(t.by || "?")}</b> ${t.html}<small>${fmt(t.at)}</small></li>`).join("")}</ul>` : `<p class="muted">Aucune activité pour l'instant.</p>`}
        </div>`,
    };
  };

  const view = render();
  const d = drawer(`<div id="fhead">${view.head}</div>`, `<div id="fbody" class="stack" style="gap:20px">${view.body}</div>`);
  const redraw = () => {
    const next = render();
    d.host.querySelector("#fhead").innerHTML = next.head;
    d.host.querySelector("#fbody").innerHTML = next.body;
  };
  const save = async (patch, comment) => {
    try {
      await updateFinding(r, patch, comment);
      redraw();
      onChange?.();
    } catch (err) {
      fail("Enregistrement impossible")(err);
    }
  };
  const panel = d.host.querySelector(".drawer");
  panel.addEventListener("change", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const value = e.target.value;
    if (f === "state")
      save({ state: value }).then(() => {
        toast("Statut mis à jour", TRIAGE[value].label);
        if (value === "fixed") verify();
      });
    if (f === "owner") save({ owner: value.trim() }).then(() => toast("Responsable mis à jour", value.trim() || "Non assigné"));
    if (f === "due") save({ due: value ? new Date(`${value}T23:59:00`).toISOString() : "" });
  });
  async function verify() {
    try {
      const out = await requestVerification(r, scanId);
      if (out.manual) toast("Vérification manuelle nécessaire", out.manual, "info");
      else toast("Vérification lancée", out.simulated ? "Scan ciblé simulé (mode démo)." : out.partial ? "Scan ciblé sans identifiants : résultat indicatif." : "Scan ciblé : cet hôte, ce port, ce test.");
      redraw();
      onChange?.();
    } catch (err) {
      fail("Vérification impossible")(err);
    }
  }
  const onTeam = () => (document.body.contains(panel) ? (redraw(), onChange?.()) : window.removeEventListener("ovc:team", onTeam));
  window.addEventListener("ovc:team", onTeam);

  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-verify]")) return verify();
    if (!e.target.closest("[data-send]")) return;
    const box = d.host.querySelector("[data-comment]");
    const text = box.value.trim();
    if (text) save({}, text).then(() => toast("Commentaire publié"));
  });
  return d;
}

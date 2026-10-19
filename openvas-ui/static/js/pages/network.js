// Toile de balayage : carte radiale scanner → sous-réseaux → hôtes.
import { api } from "../api.js";
import { esc, icon, pageHead, LEVEL_COLOR, LEVEL_LABEL, sevBadge, empty, fmtDate } from "../ui.js";

const subnetOf = (ip) => (ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip.split(".").slice(0, 3).join(".") + ".0/24");

export async function render(view) {
  const assets = await api.get("/assets");
  const W = 1000, H = 560, cx = W / 2, cy = H / 2;
  const nets = {};
  assets.forEach((a) => (nets[subnetOf(a.ip)] ||= []).push(a));
  const names = Object.keys(nets).sort();
  let svg = "";
  const R1 = Math.min(150, 60 + names.length * 18), R2 = Math.min(H / 2 - 40, R1 + 110);
  names.forEach((net, i) => {
    const a0 = (i / names.length) * Math.PI * 2 - Math.PI / 2;
    const span = (Math.PI * 2) / names.length;
    const nx = cx + R1 * Math.cos(a0), ny = cy + R1 * Math.sin(a0);
    svg += `<line class="link" x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}"/>`;
    const hosts = nets[net];
    hosts.forEach((h, j) => {
      const a = names.length === 1 ? (j / hosts.length) * Math.PI * 2 : a0 + span * ((j + 0.5) / hosts.length - 0.5) * 0.9;
      const r = R2 + (hosts.length > 14 ? (j % 2) * 40 : 0);
      const hx = cx + r * Math.cos(a), hy = cy + r * Math.sin(a);
      const col = h.vulns ? LEVEL_COLOR[h.level] : "#10b981";
      svg += `<line class="link" x1="${nx}" y1="${ny}" x2="${hx}" y2="${hy}" style="stroke-opacity:.6"/>
        <g class="node" data-ip="${esc(h.ip)}"><circle cx="${hx}" cy="${hy}" r="${8 + Math.min(10, h.vulns)}" fill="${col}" fill-opacity=".18" stroke="${col}" stroke-width="2"/>
        <text x="${hx}" y="${hy + 24 + Math.min(10, h.vulns)}" text-anchor="middle">${esc(h.ip)}</text><title>${esc(h.ip)} — ${h.vulns} vulnérabilité(s)</title></g>`;
    });
    svg += `<g><rect x="${nx - 62}" y="${ny - 13}" width="124" height="26" rx="13" fill="var(--surface)" stroke="var(--border-strong)"/>
      <text x="${nx}" y="${ny + 4}" text-anchor="middle" style="font-size:11px;fill:var(--text);font-family:var(--mono)">${esc(net)}</text></g>`;
  });
  svg += `<g><circle cx="${cx}" cy="${cy}" r="30" fill="var(--primary)"/><image href="img/logo.svg" x="${cx - 14}" y="${cy - 14}" width="28" height="28" style="filter:brightness(0) invert(1)"/>
    <text x="${cx}" y="${cy + 48}" text-anchor="middle" style="font-size:12px;font-weight:600;fill:var(--text)">openvasd</text></g>`;

  view.className = "view wide";
  view.innerHTML = pageHead({ eyebrow: "Supervision", eyeIcon: "globe", title: "Toile de balayage",
    sub: "Cartographie des hôtes découverts, regroupés par sous-réseau et colorés selon leur sévérité maximale." }) +
    `<div class="grid g-main" style="grid-template-columns:minmax(0,2.4fr) minmax(0,1fr)">
      <div class="card"><div class="card-h"><h3>Carte</h3><span class="hint">${assets.length} hôte(s) · ${names.length} sous-réseau(x)</span></div>
        ${assets.length ? `<svg class="netmap" viewBox="0 0 ${W} ${H}">${svg}</svg>
        <div class="chart-legend" style="padding:0 18px 16px">${["critical", "high", "medium", "low"].map((l) => `<span><i style="background:${LEVEL_COLOR[l]}"></i>${LEVEL_LABEL[l]}</span>`).join("")}<span><i style="background:#10b981"></i>Sain</span></div>`
        : empty("Aucun hôte découvert", "Lancez un scan pour alimenter la carte.", "globe")}</div>
      <div class="card"><div class="card-h"><h3>Détail</h3></div><div class="card-b" data-side><span class="muted">Sélectionnez un hôte sur la carte.</span></div></div>
    </div>`;
  view.querySelectorAll(".node").forEach((n) => (n.onclick = () => {
    const h = assets.find((a) => a.ip === n.dataset.ip);
    view.querySelector("[data-side]").innerHTML = `<div class="flex" style="margin-bottom:14px"><span class="kpi-ico" style="background:var(--surface-3)">${icon("monitor")}</span>
      <div><div class="mono strong">${esc(h.ip)}</div><div class="muted small">${esc(h.hostname || subnetOf(h.ip))}</div></div></div>
      <dl class="kv"><dt>Sévérité</dt><dd>${h.vulns ? sevBadge(h.level, h.max_severity) : '<span class="pill ok">Sain</span>'}</dd>
      <dt>Système</dt><dd>${esc(h.os || "Non détecté")}</dd><dt>Vulnérabilités</dt><dd>${h.vulns}</dd>
      <dt>Ports</dt><dd class="chips">${h.ports.map((p) => `<span class="chip">${esc(p)}</span>`).join("") || "—"}</dd>
      <dt>Vu le</dt><dd>${fmtDate(h.last_seen)}</dd></dl>
      <a class="btn mt" style="width:100%" href="#/scans/${esc(h.last_scan)}?tab=hosts">${icon("radar")}Ouvrir le scan</a>`;
  }));
}

// Fonctions utilitaires partagées : échappement, icônes, formats, graphiques SVG.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Icônes (tracés inspirés de Lucide, trait 2px)
// ---------------------------------------------------------------------------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  radar: '<path d="M19.07 4.93A10 10 0 1 0 22 12"/><path d="M16.24 7.76A6 6 0 1 0 18 12"/><circle cx="12" cy="12" r="2"/><path d="m13.4 10.6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M11 16V8M15 16v-6M19 16V5"/>',
  compare: '<path d="M12 4v10M7 9h10M7 20h10"/>',
  shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/>',
  shieldCheck: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  package: '<path d="M16.5 9.4 7.5 4.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8M16 6l3 3M14 8l2 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  play: '<path d="M6 4v16l14-8Z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  dup: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  equal: '<path d="M5 9h14M5 15h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  web: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/><path d="m10 13-2 2 2 2M14 13l2 2-2 2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
};

export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;

// ---------------------------------------------------------------------------
// Sévérités
// ---------------------------------------------------------------------------
export const LEVELS = ["critical", "high", "medium", "low", "log"];
export const LEVEL_LABEL = { critical: "Critique", high: "Élevée", medium: "Moyenne", low: "Faible", log: "Info", error: "Erreur" };
export const LEVEL_COLOR = { critical: "#be123c", high: "#f26b1d", medium: "#facc15", low: "#0284c7", log: "#94a3b8", error: "#94a3b8" };
export const LEVEL_PILL = { critical: "crit", high: "high", medium: "med", low: "low", log: "", error: "" };
export const LEVEL_RANK = { critical: 4, high: 3, medium: 2, low: 1, log: 0, error: -1 };

export const levelOf = (score) => score == null || score <= 0 ? "log" : score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";

export const sevBadge = (level, score) =>
  `<span class="sev ${level}"><b>${score != null && level !== "log" && level !== "error" ? fmtScore(score) : "—"}</b>${LEVEL_LABEL[level] || level}</span>`;

export const fmtScore = (s) => (s == null ? "—" : Number(s).toFixed(1));

// ---------------------------------------------------------------------------
// Statuts de scan
// ---------------------------------------------------------------------------
export const SCAN_STATUS = {
  stored: ["En attente", "", "Stocké"],
  requested: ["Demandé", "info live", "Demandé"],
  running: ["En cours", "info live", "En cours"],
  stopped: ["Arrêté", "warn", "Arrêté"],
  paused: ["En pause", "warn", "En pause"],
  failed: ["Échec", "crit", "Échec"],
  succeeded: ["Terminé", "ok", "Terminé"],
};
export const statusPill = (st, upper = false) => {
  const [label, cls] = SCAN_STATUS[st] || [st, ""];
  return `<span class="pill ${cls} ${upper ? "upper" : ""}">${esc(label)}</span>`;
};
export const ROLE_LABEL = { admin: "Administrateur", developer: "Développeur", viewer: "Visiteur" };
export const ROLE_PILL = { admin: "crit", developer: "info", viewer: "" };
export const isActive = (st) => st === "running" || st === "requested";

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------
const dtf = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const nf = new Intl.NumberFormat("fr-FR");
export const fmtDate = (ts) => (ts ? dtf.format(new Date(ts * 1000)) : "—");
export const fmtDay = (ts) => (ts ? df.format(new Date(ts * 1000)) : "—");
export const fmtNum = (n) => nf.format(n || 0);
export const fmtDuration = (sec) => {
  if (sec == null || sec < 0) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s} s`;
  return `${s} s`;
};
export const ago = (ts) => {
  if (!ts) return "—";
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return `il y a ${Math.floor(d / 86400)} j`;
};
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---------------------------------------------------------------------------
// Graphiques
// ---------------------------------------------------------------------------
export function donut(segments, { size = 130, stroke = 16, label = "", value = "" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  let off = 0;
  const arcs = total
    ? segments.filter((s) => s.value > 0).map((s) => {
        const len = (s.value / total) * c;
        const gap = segments.filter((x) => x.value > 0).length > 1 ? 2 : 0;
        const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
          stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(s.label)} : ${s.value}</title></circle>`;
        off += len;
        return el;
      }).join("")
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#94a3b8" stroke-opacity=".6" stroke-width="${stroke}"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="chart">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>${arcs}
    <text x="50%" y="${size / 2 + 2}" text-anchor="middle" style="font-size:${size / 5}px;font-weight:700;fill:var(--text)">${esc(value)}</text>
    <text x="50%" y="${size / 2 + size / 7}" text-anchor="middle" style="font-size:10.5px">${esc(label)}</text></svg>`;
}

export function legend(segments) {
  return `<div class="legend">${segments.map((s) => `<div><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${s.value}</b></div>`).join("")}</div>`;
}

export function riskLabel(score) {
  if (score >= 75) return ["Critique", "#be123c"];
  if (score >= 55) return ["Élevé", "#f26b1d"];
  if (score >= 30) return ["À améliorer", "#facc15"];
  return ["Bon", "#10b981"];
}

export function gauge(value, { size = 140, label = "", color } = {}) {
  const r = size / 2 - 12, cx = size / 2, cy = size / 2 + 4;
  const a0 = Math.PI * 0.82, a1 = Math.PI * 2.18;
  const pt = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arc = (from, to) => {
    const [x0, y0] = pt(from), [x1, y1] = pt(to);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const v = Math.max(0, Math.min(100, value));
  const col = color || riskLabel(v)[1];
  return `<svg width="${size}" height="${size * 0.82}" viewBox="0 0 ${size} ${size * 0.82}" class="chart">
    <path d="${arc(a0, a1)}" stroke="var(--surface-3)" stroke-width="12" fill="none" stroke-linecap="round"/>
    ${v > 0 ? `<path d="${arc(a0, a0 + (a1 - a0) * (v / 100))}" stroke="${col}" stroke-width="12" fill="none" stroke-linecap="round"/>` : ""}
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" style="font-size:${size / 5}px;font-weight:700;fill:var(--text)">${Math.round(v)}</text>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" style="font-size:10.5px">${esc(label)}</text></svg>`;
}

/** Histogramme vertical. groups: [{label, values:[{value,color,label}]}] (empilé). */
export function bars(groups, { height = 170, width = 420 } = {}) {
  const pad = { l: 28, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...groups.map((g) => g.values.reduce((a, v) => a + v.value, 0)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const bw = Math.min(46, (iw / groups.length) * 0.56);
  let out = "";
  for (let y = 0; y <= top; y += step) {
    const py = pad.t + ih - (y / top) * ih;
    out += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${py}" y2="${py}"/><text x="${pad.l - 6}" y="${py + 3}" text-anchor="end">${y}</text>`;
  }
  groups.forEach((g, i) => {
    const cx = pad.l + (iw / groups.length) * (i + 0.5);
    let acc = 0;
    g.values.forEach((v) => {
      if (!v.value) return;
      const h = (v.value / top) * ih;
      const y = pad.t + ih - ((acc + v.value) / top) * ih;
      out += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${h}" fill="${v.color}" rx="2"><title>${esc(g.label)} — ${esc(v.label || "")} : ${v.value}</title></rect>`;
      acc += v.value;
    });
    out += `<text x="${cx}" y="${height - 6}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="chart axis" preserveAspectRatio="none">${out}</svg>`;
}

function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
export function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "err" ? " err" : "");
  el.innerHTML = icon(type === "err" ? "alert" : "check") + `<span>${esc(msg)}</span>`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), type === "err" ? 6000 : 3200);
}

export function modal(title, body, { ok = "Valider", cancel = "Annuler", danger = false, onOk } = {}) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="card-h"><h3>${esc(title)}</h3><div class="right"><button class="btn btn-ghost btn-icon" data-x>${icon("x")}</button></div></div>
    <div class="card-b">${body}</div>
    <div class="modal-f"><button class="btn" data-x>${esc(cancel)}</button>${ok ? `<button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(ok)}</button>` : ""}</div></div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-x]")) close(); });
  bg.querySelector("[data-ok]")?.addEventListener("click", async () => {
    try { if ((await onOk?.(bg)) !== false) close(); } catch (e) { toast(e.message, "err"); }
  });
  document.body.append(bg);
  bg.querySelector("input,select,textarea")?.focus();
  return bg;
}

export const confirmDialog = (title, text, okLabel = "Confirmer") =>
  new Promise((resolve) => {
    const m = modal(title, `<p style="margin:0">${text}</p>`, { ok: okLabel, danger: true, onOk: () => resolve(true) });
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) resolve(false); });
  });

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copié dans le presse-papiers"); }
  catch { toast("Copie impossible", "err"); }
}

export function download(name, content, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows, cols) {
  const q = (v) => {
    const s = Array.isArray(v) ? v.join(" ") : String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.map((c) => q(c[0])).join(";"), ...rows.map((r) => cols.map((c) => q(c[1](r))).join(";"))].join("\n");
}

export const loading = (text = "Chargement…") => `<div class="loading"><div class="spinner"></div>${esc(text)}</div>`;
export const empty = (title, text = "", ic = "search") => `<div class="empty">${icon(ic)}<b>${esc(title)}</b>${esc(text)}</div>`;

export function pageHead({ eyebrow, eyeIcon, title, sub, actions = "" }) {
  return `<div class="page-head"><div class="grow">
    ${eyebrow ? `<div class="eyebrow">${eyeIcon ? icon(eyeIcon) : ""}${esc(eyebrow)}</div>` : ""}
    <h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
    <div class="actions">${actions}</div></div>`;
}

/** Score de risque global 0-100 à partir des comptes par sévérité. */
export function riskScore(counts, maxSev = 0) {
  const c = counts || {};
  const raw = (c.critical || 0) * 10 + (c.high || 0) * 6 + (c.medium || 0) * 2.5 + (c.low || 0) * 0.5;
  if (!raw) return 0;
  const base = 100 * (1 - Math.exp(-raw / 60));
  return Math.round(Math.max(base, (maxSev || 0) * 6.5));
}

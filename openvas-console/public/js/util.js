// Shared helpers: HTML escaping, formatting, CVSS scoring and icons.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

export function ago(ts) {
  if (!ts) return "—";
  const s = Math.round(ts - Date.now() / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export function dateTime(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function duration(start, end) {
  if (!start) return "—";
  const s = Math.max(0, Math.round((end || Date.now() / 1000) - start));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${s} s`;
}

export const num = (n) => new Intl.NumberFormat("fr-FR").format(n ?? 0);

// Progress as described in rust/doc/progress-calculation.md:
// finished + dead hosts over all hosts that are not excluded.
export function progress(status) {
  if (!status) return 0;
  if (status.status === "succeeded") return 100;
  const h = status.host_info;
  if (!h || !h.all) return 0;
  const total = h.all - (h.excluded || 0);
  if (total <= 0) return 0;
  let done = (h.finished || 0) + (h.dead || 0);
  const scanning = h.scanning && !Array.isArray(h.scanning) ? Object.values(h.scanning) : [];
  done += scanning.reduce((a, p) => a + Math.max(0, Math.min(100, p)) / 100, 0);
  return Math.min(100, Math.round((done / total) * 100));
}

export const STATUS = {
  stored: { label: "Enregistré", tone: "neutral" },
  requested: { label: "Demandé", tone: "info" },
  running: { label: "En cours", tone: "info" },
  stopped: { label: "Arrêté", tone: "warn" },
  failed: { label: "Échec", tone: "danger" },
  succeeded: { label: "Terminé", tone: "ok" },
};

export function statusChip(status) {
  const s = STATUS[status] || { label: status || "Inconnu", tone: "neutral" };
  return `<span class="chip chip-${s.tone}${status === "running" || status === "requested" ? " chip-live" : ""}">${esc(s.label)}</span>`;
}

export const RESULT_TYPES = {
  alarm: { label: "Vulnérabilité", tone: "danger" },
  log: { label: "Journal", tone: "info" },
  error: { label: "Erreur", tone: "warn" },
  host_start: { label: "Début hôte", tone: "neutral" },
  host_stop: { label: "Fin hôte", tone: "neutral" },
  host_detail: { label: "Détail hôte", tone: "neutral" },
};

// ---- CVSS -----------------------------------------------------------------

function roundUp(x) {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
}

function cvss3(vector) {
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":")));
  const W = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 },
  };
  const changed = m.S === "C";
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
  const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A]);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const expl = 8.22 * W.AV[m.AV] * W.AC[m.AC] * PR * W.UI[m.UI];
  if ([impact, expl].some(Number.isNaN)) return null;
  if (impact <= 0) return 0;
  return roundUp(Math.min(changed ? 1.08 * (impact + expl) : impact + expl, 10));
}

function cvss2(vector) {
  const m = Object.fromEntries(vector.split("/").map((p) => p.split(":")));
  const AV = { L: 0.395, A: 0.646, N: 1 }[m.AV];
  const AC = { H: 0.35, M: 0.61, L: 0.71 }[m.AC];
  const Au = { M: 0.45, S: 0.56, N: 0.704 }[m.Au];
  const CIA = { N: 0, P: 0.275, C: 0.66 };
  const impact = 10.41 * (1 - (1 - CIA[m.C]) * (1 - CIA[m.I]) * (1 - CIA[m.A]));
  const expl = 20 * AV * AC * Au;
  const score = (0.6 * impact + 0.4 * expl - 1.5) * (impact === 0 ? 0 : 1.176);
  return Number.isNaN(score) ? null : Math.round(score * 10) / 10;
}

export function cvssScore(vector) {
  if (!vector || typeof vector !== "string") return null;
  try {
    return vector.startsWith("CVSS:3") ? cvss3(vector) : cvss2(vector);
  } catch {
    return null;
  }
}

export function vtSeverity(vt) {
  const tag = vt?.tag || {};
  return cvssScore(tag.severity_vector || tag.cvss_base_vector);
}

export function severityLevel(score) {
  if (score == null) return { key: "none", label: "N/D" };
  if (score >= 9) return { key: "critical", label: "Critique" };
  if (score >= 7) return { key: "high", label: "Élevée" };
  if (score >= 4) return { key: "medium", label: "Moyenne" };
  if (score > 0) return { key: "low", label: "Faible" };
  return { key: "log", label: "Info" };
}

export function severityBadge(score) {
  const lvl = severityLevel(score);
  const value = score == null ? "—" : score.toFixed(1);
  return `<span class="sev sev-${lvl.key}" title="CVSS ${value}"><b>${value}</b>${lvl.label}</span>`;
}

// ---- Icons (Lucide-style strokes, inlined) -------------------------------

const paths = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  radar: '<path d="M19.07 4.93A10 10 0 1 0 22 12"/><path d="M16.24 7.76A6 6 0 1 0 18 12"/><circle cx="12" cy="12" r="2"/><path d="m13.4 10.6 6.6-6.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  host: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  bolt: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="12" y="8" width="3" height="9" rx="1"/><rect x="17" y="5" width="3" height="12" rx="1"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  diff: '<path d="M12 3v14M5 10h14M5 21h14"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
};

export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A self-contained HTML document styled for Word / print, from a title and a
// body of HTML. Word and LibreOffice open it as an editable document.
export function reportDocument(title, bodyHtml, opts = {}) {
  const { logo, hero } = opts;
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1a2233;font-size:11pt;line-height:1.4;margin:36px}
  h2{font-size:14pt;color:#1d47e0;margin:22px 0 8px;border-bottom:2px solid #dde3ee;padding-bottom:4px} h3{font-size:12pt;margin:16px 0 4px}
  .meta{color:#5a6478;font-size:10pt;margin:10px 0 18px}
  table{border-collapse:collapse;width:100%;margin:8px 0}
  td,th{border:1px solid #d5dbe6;padding:5px 9px;font-size:9.5pt;text-align:left;vertical-align:top}
  th{background:#14234a;color:#fff}
  .sev{font-weight:bold;white-space:nowrap} .sev-high{color:#b42318} .sev-medium{color:#b45309} .sev-low{color:#1d6f42} .sev-none{color:#5a6478}
  .muted{color:#5a6478} .reco{background:#eef2fa;padding:6px 10px;border-left:3px solid #1d47e0;font-size:9.5pt}
  .band{width:100%;border-collapse:collapse;margin:0 0 6px} .band td{border:none;background:#14234a;color:#fff;padding:22px 26px}
  .brand{font-size:13pt;font-weight:bold;letter-spacing:1px;color:#8fb0ff} .rtitle{font-size:21pt;font-weight:bold;color:#fff;margin-top:4px}
  .cards{width:100%;border-collapse:collapse;margin:10px 0;text-align:center} .cards td{border:1px solid #d5dbe6;padding:12px}
  .cards .n{font-size:20pt;font-weight:bold;display:block} .cards .l{font-size:9pt;text-transform:uppercase;letter-spacing:1px}
  .c-critical{background:#fde8e8} .c-high{background:#fde3d3} .c-medium{background:#fdf6d6} .c-low{background:#dcefe4} .c-none{background:#eef1f6}
  .footer{margin-top:28px;color:#8c9ab8;font-size:9pt;border-top:1px solid #dde3ee;padding-top:8px}
  .band td.h{width:160px;text-align:right;vertical-align:middle}
</style></head><body>
<table class="band"><tr><td>${logo ? `<img src="${logo}" height="34" alt="Sentrovyx" style="margin-bottom:6px">` : `<div class="brand">SENTROVYX</div>`}<div class="rtitle">${esc(title)}</div></td>${hero ? `<td class="h"><img src="${hero}" height="96" alt=""></td>` : ""}</tr></table>
${bodyHtml}
<div class="footer">Rapport généré par Sentrovyx — ${new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}</div>
</body></html>`;
}

// Download that document as a .doc (opens in Word / LibreOffice / Google Docs).
export function downloadDoc(filename, title, bodyHtml, opts) {
  const name = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  download(name, reportDocument(title, bodyHtml, opts), "application/msword");
}

// Rasterise a live SVG chart to a PNG data URL so it can be embedded in a Word
// document (Word renders <img> reliably, inline SVG not). CSS variables used
// for colours are resolved to their computed hex first.
export async function svgToPng(svg, scale = 2) {
  if (!svg) return null;
  try {
    const root = getComputedStyle(document.documentElement);
    let s = new XMLSerializer().serializeToString(svg);
    s = s.replace(/var\((--[a-z0-9-]+)\)/gi, (_, v) => root.getPropertyValue(v).trim() || "#888");
    if (!/xmlns=/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width || svg.viewBox?.baseVal?.width || 180);
    const h = Math.round(box.height || svg.viewBox?.baseVal?.height || 104);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, w * scale);
    canvas.height = Math.max(1, h * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// Load an SVG file (e.g. the logo) and convert it to a PNG data URL.
export async function svgUrlToPng(url, w, h, scale = 2) {
  try {
    const s = await (await fetch(url)).text();
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// Open the document in a new window and print it (the user picks "Save as PDF").
// Falls back to downloading the HTML when a popup is blocked.
export function printReport(title, bodyHtml, onFail) {
  const w = window.open("", "_blank");
  if (!w) {
    onFail?.();
    return false;
  }
  w.document.write(reportDocument(title, bodyHtml));
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 300);
  return true;
}

// Share the report file where the browser allows it (mobile, HTTPS); otherwise
// copy a text summary to the clipboard. Returns the action taken.
export async function shareReport(filename, title, bodyHtml, textSummary) {
  const name = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  try {
    const file = new File([reportDocument(title, bodyHtml)], name, { type: "application/msword" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
  } catch {
    /* share cancelled or unsupported: fall back */
  }
  try {
    await navigator.clipboard.writeText(textSummary);
    return "copied";
  } catch {
    return "none";
  }
}

// Feed versions are either a date stamp or a 64-char SHA-256: keep them short.
export const shortFeed = (v) => (!v || v === "—" ? "—" : v.length > 14 ? `${v.slice(0, 10)}…` : v);

export const shortDate = (ts) =>
  ts ? new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

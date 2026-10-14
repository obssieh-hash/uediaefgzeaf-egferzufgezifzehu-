// SVG charts sized to their container. Views insert placeholders with chart()
// and call mountCharts(root) once the HTML is in the DOM; a ResizeObserver
// redraws each chart at its real width so text never scales or blurs.
// Every mark (or its larger hit area) carries data-tip for the shared tooltip.

import { esc, num } from "./util.js";

export const SEV = [
  { key: "critical", label: "Critique", color: "var(--sev-critical)" },
  { key: "high", label: "Élevée", color: "var(--sev-high)" },
  { key: "medium", label: "Moyenne", color: "var(--sev-medium)" },
  { key: "low", label: "Faible", color: "var(--sev-low)" },
];
export const SEV_NONE = { key: "none", label: "Non évaluée", color: "var(--sev-log)" };

const tip = (lines) => esc(lines.filter((l) => l != null && l !== "").join("\n"));

// ---- Registry ---------------------------------------------------------------

let seq = 0;
const pending = new Map();
const renderers = {};

export function chart(type, spec, height) {
  const id = `c${++seq}`;
  pending.set(id, { type, spec });
  return `<div class="chart" data-cid="${id}" style="min-height:${height || spec.height || 200}px"></div>`;
}

const observer = new ResizeObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    const w = Math.round(e.contentRect.width);
    if (w && w !== el._w) draw(el, w);
  }
});

function draw(el, w) {
  el._w = w;
  el.innerHTML = renderers[el._chart.type](el._chart.spec, w);
}

export function mountCharts(root) {
  root.querySelectorAll(".chart[data-cid]").forEach((el) => {
    const def = pending.get(el.dataset.cid);
    if (!def) return;
    pending.delete(el.dataset.cid);
    el._chart = def;
    el.removeAttribute("data-cid");
    draw(el, el.clientWidth || 320);
    observer.observe(el);
  });
}

// ---- Tooltip -----------------------------------------------------------------

function initTooltip() {
  const box = document.createElement("div");
  box.className = "tooltip";
  box.setAttribute("role", "tooltip");
  document.body.append(box);
  let current = null;
  const place = (x, y) => {
    const r = box.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    box.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  };
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) {
      if (current) box.classList.remove("on");
      current = null;
      return;
    }
    if (t !== current) {
      current = t;
      const [head, ...rest] = t.dataset.tip.split("\n");
      box.innerHTML = `<b>${esc(head)}</b>${rest.map((l) => `<span>${esc(l)}</span>`).join("")}`;
      box.classList.add("on");
    }
    place(e.clientX, e.clientY);
  });
  const hide = () => {
    box.classList.remove("on");
    current = null;
  };
  document.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("hashchange", hide);
  document.addEventListener("pointerleave", hide);
}
initTooltip();

// ---- Helpers -------------------------------------------------------------------

function niceMax(v) {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 4, 5, 10]) if (m * p >= v) return m * p;
  return v;
}

// Bar with only its data-end (top) rounded, anchored flat on the baseline.
function topRounded(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function yAxis(max, plotTop, plotH, left, right) {
  return (max % 2 === 0 ? [0, 0.5, 1] : [0, 1])
    .map((f) => {
      const y = plotTop + plotH - f * plotH;
      return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" class="grid"/>
        <text x="${left - 8}" y="${y + 4}" text-anchor="end" class="axis">${num(Math.round(max * f))}</text>`;
    })
    .join("");
}

// ---- Stacked columns (e.g. severity per scan) -----------------------------------

renderers.columns = ({ columns, keys, height = 240 }, W) => {
  if (!columns.length) return `<div class="chart-empty">Pas encore de données</div>`;
  const left = 40;
  const right = W - 8;
  const top = 12;
  const bottom = 44;
  const plotH = height - top - bottom;
  const totals = columns.map((c) => keys.reduce((a, k) => a + (c.values[k.key] || 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const step = (right - left) / columns.length;
  const bw = Math.max(6, Math.min(40, step * 0.56));
  const labelEvery = Math.ceil(columns.length / Math.max(1, Math.floor((right - left) / 64)));
  const bars = columns
    .map((c, i) => {
      const x = left + step * i + (step - bw) / 2;
      let y = top + plotH;
      const segs = keys.filter((k) => c.values[k.key]);
      const parts = segs.map((k, j) => {
        const h = (c.values[k.key] / max) * plotH;
        y -= h;
        const gap = j < segs.length - 1 && h > 3 ? 2 : 0;
        return j === segs.length - 1
          ? `<path d="${topRounded(x, y, bw, h)}" fill="${k.color}"/>`
          : `<rect x="${x}" y="${y + gap}" width="${bw}" height="${Math.max(0, h - gap)}" fill="${k.color}"/>`;
      });
      const label = i % labelEvery === 0 ? `<text x="${x + bw / 2}" y="${top + plotH + 18}" text-anchor="middle" class="axis">${esc(trunc(c.label, 12))}</text>
        ${c.sub ? `<text x="${x + bw / 2}" y="${top + plotH + 32}" text-anchor="middle" class="axis faint">${esc(c.sub)}</text>` : ""}` : "";
      const tipText = tip([c.title || c.label, c.sub, ...keys.map((k) => `${k.label} : ${num(c.values[k.key] || 0)}`), `Total : ${num(totals[i])}`]);
      const hit = `<rect x="${left + step * i}" y="${top}" width="${step}" height="${plotH}" class="hit" data-tip="${tipText}" ${c.href ? `data-href="${esc(c.href)}"` : ""}/>`;
      return `<g>${parts.join("")}${label}${hit}</g>`;
    })
    .join("");
  return `<svg width="${W}" height="${height}" class="svg-chart">${yAxis(max, top, plotH, left, right)}
    <line x1="${left}" x2="${right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/>${bars}</svg>`;
};

// ---- Histogram (single series, colored by band) -----------------------------------

renderers.histogram = ({ bins, height = 200, unit = "" }, W) => {
  const left = 36;
  const right = W - 8;
  const top = 12;
  const bottom = 28;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...bins.map((b) => b.value), 1));
  const step = (right - left) / bins.length;
  const bw = Math.max(4, step - 4);
  const bars = bins
    .map((b, i) => {
      const x = left + step * i + (step - bw) / 2;
      const h = (b.value / max) * plotH;
      return `<path d="${topRounded(x, top + plotH - h, bw, h)}" fill="${b.color}"/>
        <text x="${x + bw / 2}" y="${top + plotH + 18}" text-anchor="middle" class="axis">${esc(b.label)}</text>
        <rect x="${left + step * i}" y="${top}" width="${step}" height="${plotH}" class="hit" data-tip="${tip([b.title || b.label, `${num(b.value)} ${unit}`])}"/>`;
    })
    .join("");
  return `<svg width="${W}" height="${height}" class="svg-chart">${yAxis(max, top, plotH, left, right)}
    <line x1="${left}" x2="${right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/>${bars}</svg>`;
};

// ---- Grouped columns (comparison A vs B) ---------------------------------------------

renderers.grouped = ({ groups, series, height = 220 }, W) => {
  const left = 36;
  const right = W - 8;
  const top = 12;
  const bottom = 30;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...groups.flatMap((g) => g.values), 1));
  const step = (right - left) / groups.length;
  const bw = Math.min(28, (step * 0.7) / series.length);
  const bars = groups
    .map((g, i) => {
      const x0 = left + step * i + (step - bw * series.length - 2 * (series.length - 1)) / 2;
      return (
        series
          .map((s, j) => {
            const h = (g.values[j] / max) * plotH;
            const x = x0 + j * (bw + 2);
            return `<path d="${topRounded(x, top + plotH - h, bw, h)}" fill="${s.color}" ${s.texture ? `fill-opacity=".45" stroke="${s.color}" stroke-width="1.5"` : ""}/>`;
          })
          .join("") +
        `<text x="${left + step * i + step / 2}" y="${top + plotH + 19}" text-anchor="middle" class="axis">${esc(g.label)}</text>
         <rect x="${left + step * i}" y="${top}" width="${step}" height="${plotH}" class="hit" data-tip="${tip([g.label, ...series.map((s, j) => `${s.label} : ${num(g.values[j])}`)])}"/>`
      );
    })
    .join("");
  return `<svg width="${W}" height="${height}" class="svg-chart">${yAxis(max, top, plotH, left, right)}
    <line x1="${left}" x2="${right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/>${bars}</svg>`;
};

// ---- Area line (cumulative over time) -------------------------------------------------

renderers.area = ({ points, height = 180, color = "var(--accent)", label = "Valeur" }, W) => {
  if (points.length < 2) return `<div class="chart-empty">Pas assez de points</div>`;
  const left = 40;
  const right = W - 12;
  const top = 12;
  const bottom = 28;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...points.map((p) => p.y), 1));
  const x = (i) => left + ((right - left) * i) / (points.length - 1);
  const y = (v) => top + plotH - (v / max) * plotH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const labelEvery = Math.ceil(points.length / Math.max(1, Math.floor((right - left) / 70)));
  const step = (right - left) / (points.length - 1);
  return `<svg width="${W}" height="${height}" class="svg-chart">
    <defs><linearGradient id="ag${W}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${yAxis(max, top, plotH, left, right)}
    <path d="${line}L${x(points.length - 1)},${top + plotH}L${left},${top + plotH}Z" fill="url(#ag${W})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${points.map((p, i) => `${i % labelEvery === 0 ? `<text x="${x(i)}" y="${top + plotH + 18}" text-anchor="middle" class="axis">${esc(p.label)}</text>` : ""}
      <g class="pt"><circle cx="${x(i)}" cy="${y(p.y)}" r="4" fill="${color}" stroke="var(--surface-solid)" stroke-width="2"/>
      <rect x="${x(i) - step / 2}" y="${top}" width="${step}" height="${plotH}" class="hit" data-tip="${tip([p.title || p.label, `${label} : ${num(p.y)}`])}"/></g>`).join("")}
  </svg>`;
};

// ---- Donut ------------------------------------------------------------------------------

export function donut(segments, { center, sub, size = 156 } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total
    ? segments
        .filter((s) => s.value)
        .map((s) => {
          const len = (s.value / total) * c;
          const gap = segments.filter((x) => x.value).length > 1 ? Math.min(3, len / 3) : 0;
          const arc = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.color}" stroke-width="16"
            stroke-dasharray="${Math.max(0.1, len - gap)} ${c}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"
            data-tip="${tip([s.label, `${num(s.value)} · ${Math.round((s.value / total) * 100)} %`])}" class="arc"/>`;
          offset += len;
          return arc;
        })
        .join("")
    : "";
  return `<div class="donut-wrap">
    <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(sub || "")}">
      <circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--surface-3)" stroke-width="16"/>${arcs}
      <text x="${size / 2}" y="${size / 2 - 2}" text-anchor="middle" font-size="26" font-weight="700" class="ink">${esc(center ?? num(total))}</text>
      <text x="${size / 2}" y="${size / 2 + 18}" text-anchor="middle" font-size="11" class="axis">${esc(sub || "")}</text>
    </svg>
    <div class="legend legend-col">${segments.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}<b>${num(s.value)}</b></span>`).join("")}</div>
  </div>`;
}

// ---- Gauge (0-100) ------------------------------------------------------------------------

export function riskLevel(score) {
  if (score >= 70) return { label: "Critique", color: "var(--sev-critical)" };
  if (score >= 40) return { label: "Élevé", color: "var(--sev-high)" };
  if (score >= 15) return { label: "Modéré", color: "var(--sev-medium)" };
  return { label: "Faible", color: "var(--ok)" };
}

export function gauge(score, caption = "Indice de risque") {
  const lvl = riskLevel(score);
  const r = 70;
  const len = Math.PI * r;
  const v = Math.max(0, Math.min(100, score)) / 100;
  return `<div class="gauge" data-tip="${tip([caption, `${score} / 100 — ${lvl.label}`, "Pondération : critique 25, élevée 10, moyenne 3, faible 1 par hôte"])}">
    <svg width="180" height="104" viewBox="0 0 180 104" role="img" aria-label="${esc(caption)} ${score}">
      <path d="M20,94 A70,70 0 0 1 160,94" fill="none" stroke="var(--surface-3)" stroke-width="14" stroke-linecap="round"/>
      ${v > 0 ? `<path d="M20,94 A70,70 0 0 1 160,94" fill="none" stroke="${lvl.color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${len * v} ${len}"/>` : ""}
      <text x="90" y="80" text-anchor="middle" font-size="32" font-weight="700" class="ink">${score}</text>
      <text x="90" y="99" text-anchor="middle" font-size="11" class="axis">${esc(lvl.label)}</text>
    </svg></div>`;
}

// ---- HTML helpers -------------------------------------------------------------------------

export function hbars(items, { empty = "Aucune donnée" } = {}) {
  if (!items.length) return `<p class="muted" style="margin:0">${esc(empty)}</p>`;
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items
    .map(
      (i) => `<${i.href ? `a href="${esc(i.href)}"` : "div"} class="hbar" style="--c:${i.color || "var(--accent)"}" data-tip="${tip([i.label, i.sub, i.tip || `${num(i.value)}`])}">
        <span class="ellipsis">${i.html || esc(i.label)}</span><span class="muted">${i.right ?? num(i.value)}</span>
        <span class="bar"><i style="width:${(i.value / max) * 100}%"></i></span></${i.href ? "a" : "div"}>`,
    )
    .join("")}</div>`;
}

export function miniStack(counts, { width = 120 } = {}) {
  const keys = [...SEV, SEV_NONE];
  const total = keys.reduce((a, k) => a + (counts[k.key] || 0), 0);
  if (!total) return `<span class="faint">—</span>`;
  return `<span class="ministack" style="width:${width}px" data-tip="${tip(["Vulnérabilités", ...keys.filter((k) => counts[k.key]).map((k) => `${k.label} : ${counts[k.key]}`)])}">${keys
    .filter((k) => counts[k.key])
    .map((k) => `<i style="flex-grow:${counts[k.key]};background:${k.color}"></i>`)
    .join("")}</span>`;
}

// Hosts × severity matrix; each column is its own single-hue intensity scale.
export function heatmap(rows, keys = SEV) {
  if (!rows.length) return `<p class="muted" style="margin:0">Aucune donnée</p>`;
  const max = Object.fromEntries(keys.map((k) => [k.key, Math.max(1, ...rows.map((r) => r.values[k.key] || 0))]));
  return `<div class="heatmap-wrap"><div class="heatmap" style="grid-template-columns:minmax(120px,1.4fr) repeat(${keys.length},minmax(44px,1fr))">
    <span></span>${keys.map((k) => `<span class="hm-head">${esc(k.label)}</span>`).join("")}
    ${rows
      .map(
        (r) => `<span class="hm-label ellipsis" title="${esc(r.sub || "")}">${r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label)}</span>
        ${keys
          .map((k) => {
            const v = r.values[k.key] || 0;
            const pct = v ? 18 + Math.round((v / max[k.key]) * 70) : 0;
            return `<span class="hm-cell ${v ? "" : "zero"}" style="background:${v ? `color-mix(in srgb, ${k.color} ${pct}%, var(--surface-2))` : "var(--surface-2)"}" data-tip="${tip([r.label, `${k.label} : ${v}`])}">${v || ""}</span>`;
          })
          .join("")}`,
      )
      .join("")}
  </div></div>`;
}

// Top n slices plus an "Autres" slice so the total stays honest.
export function topSlices(entries, n, colors) {
  const top = entries.slice(0, n).map(([label, value], i) => ({ label, value, color: colors[i] }));
  const rest = entries.slice(n).reduce((a, [, v]) => a + v, 0);
  if (rest) top.push({ label: "Autres", value: rest, color: "var(--sev-log)" });
  return top;
}

export function legend(keys) {
  return `<div class="legend">${keys.map((k) => `<span><i style="background:${k.color}"></i>${esc(k.label)}</span>`).join("")}</div>`;
}

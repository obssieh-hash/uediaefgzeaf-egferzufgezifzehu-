const $ = (s) => document.querySelector(s);
let market = "crypto";
let status = {};

const placeholders = {
  crypto: "ex : BTC, ETH, SOL, cardano",
  us: "ex : AAPL, NVDA, TSLA, MSFT",
  bvmt: "ex : SFBT, BIAT, Poulina, Délice",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n, d = 2) => (n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { maximumFractionDigits: d }));
const pct = (n) => (n == null ? "—" : `<span class="${n >= 0 ? "pos" : "neg"}">${n >= 0 ? "+" : ""}${num(n, 1)} %</span>`);
const price = (n) => num(n, n != null && n < 1 ? 6 : 2);

function headers() {
  const h = { "content-type": "application/json" };
  const pwd = $("#password").value || localStorageGet("pwd");
  if (pwd) h["x-app-password"] = pwd;
  return h;
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

async function loadStatus() {
  status = await fetch("/api/status").then((r) => r.json()).catch(() => ({}));
  $("#status").innerHTML = [
    `<span class="pill ${status.ai ? "on" : ""}">IA Claude ${status.ai ? "active" : "désactivée"}</span>`,
    `<span class="pill ${status.stocks ? "on" : ""}">Actions US ${status.stocks ? "actives" : "sans clé"}</span>`,
  ].join("");
  if (status.passwordRequired) {
    $("#password").hidden = false;
    $("#password").value = localStorageGet("pwd") || "";
  }
}

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    market = btn.dataset.market;
    $("#symbol").placeholder = placeholders[market];
  }),
);

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  analyze(market, $("#symbol").value.trim(), $("#question").value.trim());
});

async function analyze(m, symbol, question) {
  if (!symbol) return;
  if ($("#password").value) localStorageSet("pwd", $("#password").value);
  const box = $("#result");
  box.hidden = false;
  box.innerHTML = `<p><span class="spinner"></span>Analyse de <b>${esc(symbol)}</b> en cours… ${
    status.ai ? "L'IA lit l'actualité, cela peut prendre 30 à 90 secondes." : ""
  }</p>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#go").disabled = true;
  try {
    const res = await fetch("/api/analyze", { method: "POST", headers: headers(), body: JSON.stringify({ market: m, symbol, question }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur inconnue");
    renderResult(data);
  } catch (err) {
    box.innerHTML = `<p class="error">❌ ${esc(err.message)}</p>`;
  } finally {
    $("#go").disabled = false;
  }
}

const verdictText = {
  ACHETER: "Prendre / acheter",
  CONSERVER: "Conserver / attendre",
  VENDRE: "Laisser / vendre",
};

function renderResult(d) {
  const ind = d.indicators;
  const t = d.technical;
  const v = d.finalVerdict;
  let html = `<div class="verdict">
    ${v ? `<span class="badge ${v}">${v}</span>` : ""}
    <div>
      <h2 style="margin:0">${esc(d.name)} <span class="muted">${esc(d.symbol)}</span></h2>
      <div class="muted">${v ? verdictText[v] : ""}${d.ai?.confidence ? ` · confiance ${esc(d.ai.confidence)}` : ""}${
        t ? ` · score technique ${t.score > 0 ? "+" : ""}${t.score}/100` : ""
      }</div>
    </div>
  </div>`;

  if (ind) {
    html += `<div class="grid">
      <div class="stat"><span>Prix (${esc(d.currency)})</span><b>${price(ind.price)}</b></div>
      <div class="stat"><span>7 jours</span><b>${pct(ind.change7d)}</b></div>
      <div class="stat"><span>30 jours</span><b>${pct(ind.change30d)}</b></div>
      <div class="stat"><span>90 jours</span><b>${pct(ind.change90d)}</b></div>
      <div class="stat"><span>RSI 14</span><b>${num(ind.rsi14, 0)}</b></div>
      <div class="stat"><span>Volatilité/an</span><b>${num(ind.volatility30d, 0)} %</b></div>
    </div>`;
  }
  if (d.chart) html += `<canvas id="chart"></canvas>`;

  if (d.ai) {
    const raw = window.marked ? marked.parse(d.ai.analysis) : esc(d.ai.analysis);
    html += `<div class="analysis">${window.DOMPurify ? DOMPurify.sanitize(raw) : raw}</div>`;
    if (d.ai.sources?.length) {
      html += `<h2 style="margin-top:18px">Sources consultées</h2><ul class="sources">${d.ai.sources
        .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`)
        .join("")}</ul>`;
    }
  } else if (d.aiError) {
    html += `<p class="error">L'analyse IA a échoué : ${esc(d.aiError)}. Verdict basé uniquement sur les indicateurs techniques.</p>`;
  } else if (!status.ai) {
    html += `<p class="muted">Ajoutez une clé ANTHROPIC_API_KEY pour obtenir l'analyse complète avec l'actualité.</p>`;
  }

  if (t) {
    html += `<h2 style="margin-top:18px">Détail du score technique</h2><ul class="reasons">${t.reasons
      .map((r) => `<li><span class="${r.pts >= 0 ? "pos" : "neg"}">${r.pts >= 0 ? "+" : ""}${r.pts}</span> ${esc(r.txt)}</li>`)
      .join("")}</ul>`;
  }

  $("#result").innerHTML = html;
  if (d.chart) drawChart($("#chart"), d.chart.closes, v);
}

function drawChart(canvas, values, verdict) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - 8 - ((v - min) / (max - min || 1)) * (h - 16);
  const color = { ACHETER: "#22c55e", VENDRE: "#ef4444" }[verdict] || "#5b8cff";
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + "55"); grad.addColorStop(1, color + "00");
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
}

$("#loadTop").addEventListener("click", async () => {
  const box = $("#top");
  box.innerHTML = `<p><span class="spinner"></span>Calcul des scores…</p>`;
  try {
    const res = await fetch("/api/top-crypto", { headers: headers() });
    const list = await res.json();
    if (!res.ok) throw new Error(list.error);
    box.innerHTML = `<div class="table-wrap"><table>
      <tr><th>Crypto</th><th>Prix $</th><th class="hide-sm">7 j</th><th class="hide-sm">RSI</th><th>Score</th><th>Avis</th></tr>
      ${list
        .map((c) => `<tr class="clickable" data-sym="${esc(c.id)}">
          <td><img src="${esc(c.image)}" alt="">${esc(c.symbol)}</td>
          <td>${price(c.price)}</td>
          <td class="hide-sm">${pct(c.change7d)}</td>
          <td class="hide-sm">${num(c.rsi, 0)}</td>
          <td>${c.score ?? "—"}</td>
          <td>${c.verdict ? `<span class="small-badge badge ${c.verdict}">${c.verdict}</span>` : "—"}</td>
        </tr>`)
        .join("")}
    </table></div><p class="muted">Cliquez sur une ligne pour l'analyse complète.</p>`;
    box.querySelectorAll("tr.clickable").forEach((tr) =>
      tr.addEventListener("click", () => {
        document.querySelector('.tab[data-market="crypto"]').click();
        $("#symbol").value = tr.dataset.sym;
        analyze("crypto", tr.dataset.sym, "");
      }),
    );
  } catch (err) {
    box.innerHTML = `<p class="error">❌ ${esc(err.message)}</p>`;
  }
});

loadStatus();

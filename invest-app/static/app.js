/* InvestPilot – interface */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const S = { crypto: [], stocks: [], indices: [], global: {}, analysis: { stocks: [], crypto: [] },
  whales: null, market: {}, news: null, newsFilter: "Tout", dcaYears: 5, follow: store.get("ip_follow", []), custom: {}, notif: store.get("ip_notif", false),
  profile: "equilibre", scope: "all", region: "Tous", signal: "Tous",
  sort: { crypto: ["market_cap_rank", 1], stock: ["name", 1] } };

/* ---------- format ---------- */
const nf = (d = 2) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const cur = (v, c = "EUR") => {
  if (v == null || isNaN(v)) return "—";
  const d = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 8;
  try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: c || "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
  catch { return nf(d).format(v) + " " + (c || ""); }
};
const big = (v, c = "EUR") => {
  if (v == null) return "—";
  const u = [[1e12, " Bn"], [1e9, " Md"], [1e6, " M"]].find(([n]) => Math.abs(v) >= n);
  const sym = c === "EUR" ? " €" : " $";
  return u ? nf(2).format(v / u[0]) + u[1] + sym : cur(v, c);
};
const pct = (v, frac = false) => {
  if (v == null || isNaN(v)) return '<span class="dim">—</span>';
  const x = frac ? v * 100 : v;
  return `<span class="${x >= 0 ? "up" : "down"}">${x >= 0 ? "▲" : "▼"} ${nf(2).format(Math.abs(x))} %</span>`;
};
const pill = (v, frac = false) => {
  if (v == null) return "—";
  const x = frac ? v * 100 : v;
  return `<span class="pill ${x >= 0 ? "up" : "down"}">${x >= 0 ? "+" : ""}${nf(2).format(x)} %</span>`;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = n => esc(String(n).replace(/[^A-Za-z0-9 ]/g, "").split(" ").map(w => w[0]).join("").slice(0, 3).toUpperCase());

function spark(data, w = 110, h = 32) {
  const d = (data || []).filter(x => x != null);
  if (d.length < 2) return "";
  const mn = Math.min(...d), mx = Math.max(...d), r = mx - mn || 1;
  const pts = d.map((v, i) => `${(i / (d.length - 1)) * w},${h - 2 - ((v - mn) / r) * (h - 4)}`).join(" ");
  const col = d[d.length - 1] >= d[0] ? "var(--up)" : "var(--down)";
  const id = "g" + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><polygon points="0,${h} ${pts} ${w},${h}" fill="url(#${id})"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------- API ---------- */
async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

async function loadAll() {
  setStatus("load", "Mise à jour…");
  const jobs = {
    crypto: api("/api/crypto").then(d => S.crypto = d),
    global: api("/api/global").then(d => S.global = d),
    indices: api("/api/indices").then(d => S.indices = d),
    stocks: api("/api/stocks").then(d => S.stocks = d),
  };
  // premier affichage rapide dès que crypto + global sont arrivés
  Promise.allSettled([jobs.crypto, jobs.global]).then(() => { renderDashboard(); renderCrypto(); hideLoader(); });
  const res = await Promise.allSettled(Object.values(jobs));
  renderDashboard(); renderCrypto(); renderStocks(); hideLoader();
  await Promise.allSettled([api("/api/analysis").then(d => S.analysis = d), loadWhales(),
    api("/api/market").then(d => S.market = d), api("/api/news").then(d => S.news = d)]);
  if ($("#view-news").classList.contains("active")) renderNews();
  renderAdvice(); renderDashboard();
  const fails = res.filter(r => r.status === "rejected").length;
  setStatus(fails ? "err" : "ok", fails ? `${fails} source(s) indisponible(s)` : "À jour · " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
}
function setStatus(k, t) { $("#statusDot").className = "dot " + (k === "ok" ? "ok" : k === "err" ? "err" : ""); $("#statusText").textContent = t; }
function hideLoader() { $("#loader").classList.add("hide"); }

/* ---------- moteur de conseil ---------- */
const PROFILES = {
  prudent:   { volK: 45, volFree: .20, cryptoCap: .10, maxPicks: 8, label: "Prudent" },
  equilibre: { volK: 22, volFree: .28, cryptoCap: .25, maxPicks: 8, label: "Équilibré" },
  dynamique: { volK: 8,  volFree: .45, cryptoCap: .50, maxPicks: 10, label: "Dynamique" },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function score(a, profile = S.profile) {
  const P = PROFILES[profile];
  let s = 50; const why = [];
  if (a.sma200) {
    if (a.price > a.sma200) { s += 12; why.push(["+", "Au-dessus de sa moyenne 200 jours : tendance de fond haussière"]); }
    else { s -= 12; why.push(["-", "Sous sa moyenne 200 jours : tendance de fond baissière"]); }
  }
  if (a.sma50 && a.sma200) {
    if (a.sma50 > a.sma200) { s += 8; why.push(["+", "Moyenne 50j > 200j (« golden cross »)"]); }
    else { s -= 8; why.push(["-", "Moyenne 50j < 200j (« death cross »)"]); }
  }
  if (a.sma50) s += a.price > a.sma50 ? 5 : -5;
  if (a.ret3m != null) {
    s += clamp(a.ret3m * 40, -12, 12);
    if (a.ret3m > .1) why.push(["+", `Fort momentum : ${pctTxt(a.ret3m)} sur 3 mois`]);
    else if (a.ret3m < -.1) why.push(["-", `Momentum négatif : ${pctTxt(a.ret3m)} sur 3 mois`]);
  }
  if (a.ret1m != null) s += clamp(a.ret1m * 30, -8, 8);
  if (a.rsi != null) {
    if (a.rsi < 30) { s += 8; why.push(["+", `RSI ${a.rsi.toFixed(0)} : survendu, rebond possible`]); }
    else if (a.rsi < 45) s += 3;
    else if (a.rsi <= 65) s += 4;
    else if (a.rsi <= 70) { s -= 3; why.push(["~", `RSI ${a.rsi.toFixed(0)} : proche de la surchauffe`]); }
    else { s -= 10; why.push(["-", `RSI ${a.rsi.toFixed(0)} : suracheté, risque de correction`]); }
  }
  if (a.vol != null) {
    const pen = clamp((a.vol - P.volFree) * P.volK, 0, 22);
    s -= pen;
    if (pen > 6) why.push(["-", `Volatilité élevée (${(a.vol * 100).toFixed(0)} %/an) pour un profil ${P.label.toLowerCase()}`]);
    else if (a.vol < .2) why.push(["+", `Faible volatilité (${(a.vol * 100).toFixed(0)} %/an) : actif plutôt stable`]);
  }
  const wc = a.type === "crypto" && whaleConsensus(a.symbol.split("-")[0]);
  if (wc && wc.nLong + wc.nShort >= 3) {
    if (wc.bias >= .4) { s += 10; why.unshift(["+", `🐋 ${wc.nLong}/${wc.nLong + wc.nShort} meilleurs traders sont LONG (parient sur la hausse)`]); }
    else if (wc.bias <= -.4) { s -= 10; why.unshift(["-", `🐋 ${wc.nShort}/${wc.nLong + wc.nShort} meilleurs traders sont SHORT (parient sur la baisse)`]); }
  }
  const base = a.type === "crypto" ? a.symbol.split("-")[0] : a.symbol;
  const fd = a.type === "crypto" && S.market.derivs?.find(d => d.coin === base);
  if (fd) {
    if (fd.fundingApr > .3) { s -= 4; why.push(["-", `Trop d'acheteurs à levier (financement ${(fd.fundingApr * 100).toFixed(0)} %/an) : risque de purge`]); }
    else if (fd.fundingApr < -.1) { s += 3; why.push(["+", `Beaucoup de vendeurs à découvert (financement négatif) : rebond brutal possible`]); }
  }
  const nw = S.news?.byAsset?.[base];
  if (nw && nw.n >= 3) {
    if (nw.avg >= .5) { s += 4; why.push(["+", `📰 Actualité plutôt positive (${nw.n} articles récents)`]); }
    else if (nw.avg <= -.5) { s -= 4; why.push(["-", `📰 Actualité plutôt négative (${nw.n} articles récents)`]); }
  }
  if (a.fromHigh != null && a.fromHigh < -.35 && a.price > (a.sma50 || 0)) why.push(["~", `Encore ${pctTxt(a.fromHigh)} sous son plus haut annuel, mais reprise en cours`]);
  s = Math.round(clamp(s, 0, 100));
  return { score: s, why, ...signal(s) };
}
const pctTxt = v => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + " %";
function signal(s) {
  if (s >= 72) return { sig: "Achat fort", color: "#16c784" };
  if (s >= 60) return { sig: "Achat", color: "#5ad8a0" };
  if (s >= 45) return { sig: "Conserver", color: "#f5a524" };
  if (s >= 33) return { sig: "Prudence", color: "#f97a3c" };
  return { sig: "Éviter", color: "#ea3943" };
}

function universe() {
  const all = [...(S.analysis.stocks || []), ...(S.analysis.crypto || [])];
  return all.filter(a => S.scope === "all" || (S.scope === "crypto" ? a.type === "crypto" : a.type !== "crypto"))
    .map(a => ({ ...a, ...score(a) })).sort((x, y) => y.score - x.score);
}

function allocate(list, amount) {
  const P = PROFILES[S.profile];
  const picks = list.filter(a => a.score >= 60).slice(0, P.maxPicks);
  const w = picks.map(a => (a.score - 55) / Math.max(a.vol || .2, .15));
  let tot = w.reduce((a, b) => a + b, 0);
  let out = picks.map((a, i) => ({ a, w: tot ? w[i] / tot : 0 }));
  // plafond crypto selon profil
  const cw = out.filter(o => o.a.type === "crypto").reduce((s, o) => s + o.w, 0);
  const cap = S.scope === "crypto" ? 1 : P.cryptoCap;
  if (cw > cap) {
    const other = 1 - cw;
    out.forEach(o => { o.w = o.a.type === "crypto" ? o.w * cap / cw : other ? o.w * (1 - cap) / other : o.w; });
  }
  // le profil prudent garde toujours une poche de sécurité
  const cashBase = { prudent: .2, equilibre: .1, dynamique: 0 }[S.profile];
  const strength = picks.length ? Math.min(1, picks.length / 5) : 0;
  const cash = clamp(cashBase + (1 - strength) * .5, 0, 1);
  out.forEach(o => o.w *= (1 - cash));
  const inv = out.reduce((s, o) => s + o.w, 0);
  if (1 - inv > .001) out.push({ a: { name: "Liquidités / livret (sécurité)", symbol: "CASH", type: "cash" }, w: 1 - inv });
  return out.map(o => ({ ...o, amt: o.w * amount }));
}

/* ---------- rendu : tableau de bord ---------- */
function renderDashboard() {
  const g = S.global, fng = g.fng?.[0];
  const btc = S.crypto.find(c => c.id === "bitcoin"), eth = S.crypto.find(c => c.id === "ethereum");
  const cac = S.indices.find(i => i.symbol === "^FCHI"), sp = S.indices.find(i => i.symbol === "^GSPC");
  const fngFr = { "Extreme Fear": "Peur extrême", "Fear": "Peur", "Neutral": "Neutre", "Greed": "Avidité", "Extreme Greed": "Avidité extrême" };
  $("#kpis").innerHTML = [
    kpi("Bitcoin", btc && cur(btc.current_price), btc && pct(btc.price_change_percentage_24h), "bitcoin"),
    kpi("Ethereum", eth && cur(eth.current_price), eth && pct(eth.price_change_percentage_24h), "ethereum"),
    kpi("Capitalisation crypto", big(g.mcap), g.mcapChange != null ? pct(g.mcapChange) + ` <span class="dim">· BTC ${nf(1).format(g.btcDom || 0)} %</span>` : ""),
    kpi("S&P 500", sp && nf(2).format(sp.price), sp && pct(sp.change1d, true), "^GSPC"),
    kpi("CAC 40", cac && nf(2).format(cac.price), cac && pct(cac.change1d, true), "^FCHI"),
    fng ? `<div class="card kpi"><div class="l">Sentiment crypto</div><div class="v">${fng.value} <small style="font-size:13px;color:var(--muted)">/100</small></div><div class="s">${fngFr[fng.label] || fng.label}</div><div class="gauge"><i style="left:${fng.value}%"></i></div></div>` : "",
  ].join("");

  $("#indices").innerHTML = S.indices.length ? S.indices.map(i => `
    <div class="card idx" data-open="yh" data-sym="${esc(i.symbol)}">
      <div class="n">${esc(i.name)}</div>
      <div class="p">${nf(2).format(i.price)}</div>
      ${pill(i.change1d, true)}
      ${spark(i.spark, 200, 36)}
    </div>`).join("") : `<div class="empty">Chargement des indices…</div>`;

  // hausses / baisses : crypto (24h) + actions (1j)
  const movers = [
    ...S.crypto.filter(c => !["usdt", "usdc"].includes(c.symbol)).map(c => ({ name: c.name, sub: c.symbol.toUpperCase(), img: c.image, ch: c.price_change_percentage_24h, price: cur(c.current_price), open: ["cg", c.id] })),
    ...S.stocks.map(s => ({ name: s.name, sub: s.symbol, ch: (s.change1d || 0) * 100, price: cur(s.price, s.currency), open: ["yh", s.symbol] })),
  ].filter(m => m.ch != null).sort((a, b) => b.ch - a.ch);
  const mini = m => `<div class="mini" data-open="${m.open[0]}" data-sym="${esc(m.open[1])}">${m.img ? `<img class="ic" src="${esc(m.img)}" alt="">` : `<div class="ic">${initials(m.name)}</div>`}<div class="nm"><b>${esc(m.name)}</b><small>${esc(m.sub)} · ${m.price}</small></div>${pill(m.ch)}</div>`;
  $("#gainers").innerHTML = movers.slice(0, 6).map(mini).join("") || `<div class="empty">—</div>`;
  $("#losers").innerHTML = movers.slice(-6).reverse().map(mini).join("") || `<div class="empty">—</div>`;

  renderWhaleMini(); renderIntel();
  const top = universe().slice(0, 5);
  $("#topPicks").innerHTML = top.length ? top.map(a => `
    <div class="pick" data-open="${a.cgId ? "cg" : "yh"}" data-sym="${esc(a.cgId || a.symbol)}" data-ysym="${esc(a.symbol)}">
      <div class="top">${icon(a)}<div><b>${esc(a.name)}</b><small>${esc(a.symbol)}</small></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
        <span class="sig" style="margin:0;background:${a.color}22;color:${a.color}">${a.sig}</span><b style="font-size:18px">${a.score}<small style="color:var(--muted);font-size:11px">/100</small></b>
      </div></div>`).join("") : `<div class="empty">Analyse en cours… (≈ 20 secondes la première fois)</div>`;
}
const kpi = (l, v, s, sym) => `<div class="card kpi" ${sym ? `data-open="${sym.startsWith("^") ? "yh" : "cg"}" data-sym="${esc(sym)}" style="cursor:pointer"` : ""}><div class="l">${l}</div><div class="v">${v || "—"}</div><div class="s">${s || ""}</div></div>`;
const icon = a => a.image ? `<img class="ic" src="${esc(a.image)}" alt="">` : a.type === "cash" ? `<div class="ic">💶</div>` : `<div class="ic">${initials(a.name)}</div>`;

/* ---------- rendu : crypto ---------- */
const CCOLS = [
  ["market_cap_rank", "#", "l"], ["name", "Nom", "l"], ["current_price", "Prix"],
  ["price_change_percentage_1h_in_currency", "1h", "hm"], ["price_change_percentage_24h_in_currency", "24h"],
  ["price_change_percentage_7d_in_currency", "7j"], ["price_change_percentage_30d_in_currency", "30j", "hm"],
  ["market_cap", "Capitalisation", "hm"], ["total_volume", "Volume 24h", "hm"], [null, "7 derniers jours", "hm"],
];
function renderCrypto() {
  const q = $("#cryptoSearch").value.trim().toLowerCase();
  const [k, dir] = S.sort.crypto;
  const rows = S.crypto.filter(c => !q || c.name.toLowerCase().includes(q) || c.symbol.includes(q))
    .sort((a, b) => cmp(a[k], b[k]) * dir);
  $("#cryptoTable").innerHTML = `<thead><tr>${CCOLS.map(([key, l, c]) => `<th class="${c || ""}" data-k="${key || ""}">${l}${key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${
    rows.map(c => `<tr class="row" data-open="cg" data-sym="${esc(c.id)}">
      <td class="l rank">${c.market_cap_rank ?? ""}</td>
      <td class="l"><div class="coin"><img class="ic" src="${esc(c.image)}" alt=""><b>${esc(c.name)}</b><small>${esc(c.symbol.toUpperCase())}</small></div></td>
      <td><b>${cur(c.current_price)}</b></td>
      <td class="hm">${pct(c.price_change_percentage_1h_in_currency)}</td>
      <td>${pct(c.price_change_percentage_24h_in_currency)}</td>
      <td>${pct(c.price_change_percentage_7d_in_currency)}</td>
      <td class="hm">${pct(c.price_change_percentage_30d_in_currency)}</td>
      <td class="hm">${big(c.market_cap)}</td>
      <td class="hm">${big(c.total_volume)}</td>
      <td class="hm">${spark(c.sparkline_in_7d?.price?.filter((_, i) => i % 3 === 0))}</td></tr>`).join("") || `<tr><td colspan="10" class="empty">Aucun résultat</td></tr>`}</tbody>`;
}
const cmp = (a, b) => (a == null) - (b == null) || (typeof a === "string" ? a.localeCompare(b) : a - b);

/* ---------- rendu : bourse ---------- */
const SCOLS = [["name", "Nom", "l"], ["region", "Marché", "l hm"], ["price", "Prix"], ["change1d", "1 jour"], ["ret1m", "1 mois", "hm"],
  ["ret3m", "3 mois", "hm"], ["ret1y", "1 an"], ["rsi", "RSI", "hm"], [null, "3 derniers mois", "hm"]];
function renderStocks() {
  const regions = ["Tous", ...new Set(S.stocks.map(s => s.region))];
  $("#regionChips").innerHTML = regions.map(r => `<button class="chip ${r === S.region ? "on" : ""}" data-region="${esc(r)}">${esc(r)}</button>`).join("");
  const q = $("#stockSearch").value.trim().toLowerCase();
  const [k, dir] = S.sort.stock;
  const rows = S.stocks.filter(s => (S.region === "Tous" || s.region === S.region) && (!q || s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)))
    .sort((a, b) => cmp(a[k], b[k]) * dir);
  $("#stockTable").innerHTML = `<thead><tr>${SCOLS.map(([key, l, c]) => `<th class="${c || ""}" data-k="${key || ""}">${l}${key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${
    rows.map(s => `<tr class="row" data-open="yh" data-sym="${esc(s.symbol)}">
      <td class="l"><div class="coin"><div class="ic">${initials(s.name)}</div><b>${esc(s.name)}</b><small>${esc(s.symbol)}</small></div></td>
      <td class="l hm" style="color:var(--muted)">${esc(s.region)}</td>
      <td><b>${cur(s.price, s.currency)}</b></td>
      <td>${pct(s.change1d, true)}</td><td class="hm">${pct(s.ret1m, true)}</td><td class="hm">${pct(s.ret3m, true)}</td><td>${pct(s.ret1y, true)}</td>
      <td class="hm">${s.rsi != null ? s.rsi.toFixed(0) : "—"}</td>
      <td class="hm">${spark(s.spark)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">${S.stocks.length ? "Aucun résultat" : "Chargement…"}</td></tr>`}</tbody>`;
}

/* ---------- rendu : conseils ---------- */
let allocChart;
const PAL = ["#7c5cff", "#22d3ee", "#16c784", "#f5a524", "#ec4899", "#60a5fa", "#a3e635", "#fb7185", "#c084fc", "#2dd4bf", "#64748b"];
function renderAdvice() {
  const list = universe();
  const amount = Math.max(0, +$("#amount").value || 0);
  const al = allocate(list, amount);
  // donut
  const ctx = $("#allocChart");
  const data = { labels: al.map(o => o.a.name), datasets: [{ data: al.map(o => +(o.w * 100).toFixed(1)), backgroundColor: al.map((o, i) => o.a.type === "cash" ? "#3a4460" : PAL[i % PAL.length]), borderWidth: 0, hoverOffset: 6 }] };
  if (window.Chart) {
    if (allocChart) { allocChart.data = data; allocChart.update(); }
    else allocChart = new Chart(ctx, { type: "doughnut", data, options: { cutout: "72%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw} %` } } } } });
  }
  $("#donutCenter").innerHTML = `<div><b>${cur(amount)}</b><small>${PROFILES[S.profile].label}</small></div>`;
  $("#allocList").innerHTML = al.length ? al.map((o, i) => `<div class="al"><i style="background:${o.a.type === "cash" ? "#3a4460" : PAL[i % PAL.length]}"></i><span>${esc(o.a.name)} ${o.a.type === "crypto" ? "🪙" : ""}</span><b>${cur(o.amt)}</b><em>${(o.w * 100).toFixed(0)} %</em></div>`).join("")
    : `<div class="empty">Analyse en cours…</div>`;

  // humeur du marché
  const n = list.length || 1, bull = list.filter(a => a.price > a.sma200).length;
  const avg = list.reduce((s, a) => s + a.score, 0) / n;
  const best = list[0], cr = list.filter(a => a.type === "crypto"), st = list.filter(a => a.type !== "crypto");
  const avgOf = l => l.length ? Math.round(l.reduce((s, a) => s + a.score, 0) / l.length) : null;
  const fng = S.global.fng?.[0]?.value;
  let txt = avg >= 58 ? "Le marché est globalement <b class='up'>haussier</b> : la majorité des actifs sont en tendance positive. C'est un contexte favorable pour investir progressivement."
    : avg >= 45 ? "Le marché est <b style='color:var(--warn)'>mitigé</b> : soyez sélectif, privilégiez les actifs en tendance et investissez en plusieurs fois (DCA)."
    : "Le marché est plutôt <b class='down'>baissier</b> : la prudence est de mise. Gardez des liquidités et n'achetez que par petites tranches.";
  if (fng != null && fng < 25) txt += " Le sentiment crypto est en <b>peur extrême</b> : historiquement, ces phases ont souvent offert des points d'entrée intéressants à long terme, mais le risque reste élevé.";
  if (fng != null && fng > 75) txt += " Le sentiment crypto est en <b>avidité extrême</b> : attention à l'euphorie, les corrections sont fréquentes.";
  $("#marketMood").innerHTML = list.length ? `<div class="mood"><p>${txt}</p>
    <div class="mood-row"><span>Actifs en tendance haussière (> MM200)</span><b>${bull}/${list.length}</b></div>
    <div class="mood-row"><span>Score moyen Bourse</span><b>${avgOf(st) ?? "—"}/100</b></div>
    <div class="mood-row"><span>Score moyen Crypto</span><b>${avgOf(cr) ?? "—"}/100</b></div>
    <div class="mood-row"><span>Meilleur actif</span><b>${best ? esc(best.name) + " (" + best.score + ")" : "—"}</b></div></div>`
    : `<div class="empty">Analyse en cours…</div>`;

  const sigs = ["Tous", "Achat fort", "Achat", "Conserver", "Prudence", "Éviter"];
  $("#signalChips").innerHTML = sigs.map(s => `<button class="chip ${s === S.signal ? "on" : ""}" data-signal="${s}">${s}${s !== "Tous" ? " · " + list.filter(a => a.sig === s).length : ""}</button>`).join("");
  const shown = list.filter(a => S.signal === "Tous" || a.sig === S.signal);
  $("#ranking").innerHTML = shown.map(a => `
    <div class="rc" data-open="${a.cgId ? "cg" : "yh"}" data-sym="${esc(a.cgId || a.symbol)}" data-ysym="${esc(a.symbol)}">
      <div class="rc-top">${icon(a)}<div class="nm"><b>${esc(a.name)}</b><small>${esc(a.symbol)} · ${a.type === "crypto" ? "Crypto" : esc(a.region)} · ${cur(a.price, a.currency)}</small></div>
        <div class="score" style="--s:${a.score};--c:${a.color}">${a.score}</div></div>
      <span class="sig" style="background:${a.color}22;color:${a.color}">${a.sig}</span>
      <div class="stats"><div><small>1 mois</small><b>${pctShort(a.ret1m)}</b></div><div><small>3 mois</small><b>${pctShort(a.ret3m)}</b></div><div><small>RSI</small><b>${a.rsi?.toFixed(0) ?? "—"}</b></div><div><small>Risque</small><b>${risk(a.vol)}</b></div></div>
      <ul class="reasons">${a.why.slice(0, 3).map(([t, w]) => `<li>${t === "+" ? "✅" : t === "-" ? "⚠️" : "➖"} ${esc(w)}</li>`).join("")}</ul>
    </div>`).join("") || `<div class="empty">${list.length ? "Aucun actif dans cette catégorie" : "Analyse des marchés en cours… (≈ 20 secondes la première fois)"}</div>`;
}
const pctShort = v => v == null ? "—" : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%</span>`;
const risk = v => v == null ? "—" : v < .2 ? "Faible" : v < .35 ? "Moyen" : v < .6 ? "Élevé" : "Très élevé";

/* ---------- détail ---------- */
let detailChart, cur_detail = null;
async function openDetail(src, sym, ysym) {
  cur_detail = { src, sym, ysym, range: "1y" };
  $("#ranges").style.display = ""; $(".m-chart").style.display = "";
  $$("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.r === "1y"));
  const c = src === "cg" ? S.crypto.find(x => x.id === sym) : null;
  const all = [...S.stocks, ...S.indices];
  const s = src === "yh" ? all.find(x => x.symbol === sym) : null;
  const an = [...(S.analysis.stocks || []), ...(S.analysis.crypto || [])].find(a => a.symbol === (ysym || sym) || (c && a.cgId === c.id));
  const name = c?.name || s?.name || an?.name || sym;
  const price = c ? cur(c.current_price) : s ? cur(s.price, s.currency) : an ? cur(an.price, an.currency) : "";
  const ch = c ? pct(c.price_change_percentage_24h) : s ? pct(s.change1d, true) : "";
  $("#mHead").innerHTML = `${c ? `<img class="ic" style="width:44px;height:44px" src="${esc(c.image)}">` : `<div class="ic" style="width:44px;height:44px">${initials(name)}</div>`}
    <div><h2>${esc(name)}</h2><small style="color:var(--muted)">${esc(c ? c.symbol.toUpperCase() : sym)}</small></div>
    <div class="px"><b>${price}</b>${ch}</div>`;
  let body = "";
  if (an) {
    const r = score(an);
    body += `<div class="card" style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:14px">
      <div class="score" style="--s:${r.score};--c:${r.color}">${r.score}</div>
      <div><span class="sig" style="margin:0;background:${r.color}22;color:${r.color};font-size:14px">${r.sig}</span>
      <div style="color:var(--muted);font-size:12px;margin-top:6px">Avis pour un profil ${PROFILES[S.profile].label.toLowerCase()}</div></div></div>
      <ul class="reasons">${r.why.map(([t, w]) => `<li>${t === "+" ? "✅" : t === "-" ? "⚠️" : "➖"} ${esc(w)}</li>`).join("")}</ul></div>`;
    body += `<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div><small>RSI (14)</small><b>${an.rsi?.toFixed(1) ?? "—"}</b></div>
      <div><small>Moy. 50 j</small><b>${cur(an.sma50, an.currency)}</b></div>
      <div><small>Moy. 200 j</small><b>${cur(an.sma200, an.currency)}</b></div>
      <div><small>Volatilité</small><b>${an.vol != null ? (an.vol * 100).toFixed(0) + " %" : "—"}</b></div>
      <div><small>Perf. 1 an</small><b>${pctShort(an.ret1y)}</b></div>
      <div><small>Depuis le + haut</small><b>${pctShort(an.fromHigh)}</b></div></div>`;
  }
  if (c) body += `<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-top:8px">
      <div><small>Capitalisation</small><b>${big(c.market_cap)}</b></div><div><small>Volume 24h</small><b>${big(c.total_volume)}</b></div>
      <div><small>Plus haut historique</small><b>${cur(c.ath)}</b></div><div><small>Depuis l'ATH</small><b>${pctShort((c.ath_change_percentage || 0) / 100)}</b></div>
      <div><small>Perf. 1 an</small><b>${pctShort(c.price_change_percentage_1y_in_currency != null ? c.price_change_percentage_1y_in_currency / 100 : null)}</b></div>
      <div><small>Offre en circulation</small><b>${c.circulating_supply ? nf(0).format(c.circulating_supply) : "—"}</b></div></div>`;
  $("#mBody").innerHTML = body;
  $("#modal").classList.add("open");
  drawDetail();
}
async function drawDetail() {
  const { src, sym, range } = cur_detail;
  try {
    const d = await api(`/api/history?source=${src}&symbol=${encodeURIComponent(sym)}&range=${range}`);
    if (cur_detail.range !== range || cur_detail.sym !== sym) return;
    const pts = d.points;
    const up = pts.length && pts[pts.length - 1][1] >= pts[0][1];
    const col = up ? "#16c784" : "#ea3943";
    const ctx = $("#detailChart").getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, 300); grad.addColorStop(0, col + "44"); grad.addColorStop(1, col + "00");
    const short = range === "1mo" || range === "3mo";
    const data = { labels: pts.map(p => new Date(p[0] * 1000).toLocaleDateString("fr-FR", short ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" })),
      datasets: [{ data: pts.map(p => p[1]), borderColor: col, backgroundColor: grad, fill: true, borderWidth: 2, pointRadius: 0, tension: .25 }] };
    if (detailChart) detailChart.destroy();
    detailChart = new Chart(ctx, { type: "line", data, options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => " " + cur(c.raw, d.currency) } } },
      scales: { x: { grid: { display: false }, ticks: { color: "#5d6780", maxTicksLimit: 7 } }, y: { position: "right", grid: { color: "#ffffff08" }, ticks: { color: "#5d6780" } } } } });
  } catch (e) { console.error(e); }
}

/* ---------- événements ---------- */
function show(view) {
  $$(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "conseils") renderAdvice();
  if (view === "news") renderNews();
  if (view === "pro") renderPro();
  if (view === "plan") renderPlan();
  if (view === "baleines") { renderWhales(); loadWhales().then(renderWhales); }
  window.scrollTo(0, 0);
}
document.addEventListener("click", e => {
  const t = e.target;
  const nav = t.closest(".nav, [data-goto]"); if (nav) return show(nav.dataset.view || nav.dataset.goto);
  const th = t.closest("th[data-k]");
  if (th && th.dataset.k) {
    const tbl = th.closest("table").id === "cryptoTable" ? "crypto" : "stock";
    const [k, d] = S.sort[tbl];
    S.sort[tbl] = [th.dataset.k, k === th.dataset.k ? -d : (["name", "market_cap_rank", "region"].includes(th.dataset.k) ? 1 : -1)];
    return tbl === "crypto" ? renderCrypto() : renderStocks();
  }
  const nc = t.closest("[data-nf]"); if (nc) { S.newsFilter = nc.dataset.nf; return renderNews(); }
  const dy = t.closest("#dcaYears button"); if (dy) { S.dcaYears = +dy.dataset.y; $$("#dcaYears button").forEach(b => b.classList.toggle("on", b === dy)); return renderDCA(); }
  const st = t.closest("[data-star]"); if (st) { e.stopPropagation(); return toggleFollow(st.dataset.star); }
  if (t.closest("#notifBtn")) return enableNotif();
  const tr = t.closest("[data-trader]"); if (tr) return openTrader(tr.dataset.trader);
  const op = t.closest("[data-open]"); if (op) return openDetail(op.dataset.open, op.dataset.sym, op.dataset.ysym);
  const rc = t.closest("[data-region]"); if (rc) { S.region = rc.dataset.region; return renderStocks(); }
  const sc = t.closest("[data-signal]"); if (sc) { S.signal = sc.dataset.signal; return renderAdvice(); }
  const p = t.closest("#profileSeg button"); if (p) { S.profile = p.dataset.p; $$("#profileSeg button").forEach(b => b.classList.toggle("on", b === p)); renderAdvice(); renderDashboard(); return; }
  const s = t.closest("#scopeSeg button"); if (s) { S.scope = s.dataset.s; $$("#scopeSeg button").forEach(b => b.classList.toggle("on", b === s)); return renderAdvice(); }
  const r = t.closest("#ranges button"); if (r && cur_detail) { cur_detail.range = r.dataset.r; $$("#ranges button").forEach(b => b.classList.toggle("on", b === r)); return drawDetail(); }
  if (t.id === "modal" || t.closest("#modalClose")) $("#modal").classList.remove("open");
});
document.addEventListener("keydown", e => { if (e.key === "Escape") $("#modal").classList.remove("open"); });
$("#cryptoSearch").addEventListener("input", renderCrypto);
$("#stockSearch").addEventListener("input", renderStocks);
$("#amount").addEventListener("input", renderAdvice);
$("#refreshBtn").addEventListener("click", loadAll);

loadAll();
setInterval(loadAll, 3 * 60 * 1000);
// suivi des baleines en direct : toutes les 30 s (si l'onglet est visible ou les alertes activées)
setInterval(() => { if (!document.hidden || S.notif) loadWhales().then(() => { if ($("#view-baleines").classList.contains("active")) renderWhales(); renderWhaleMini(); }); }, 30 * 1000);
setInterval(updateLive, 1000);
$("#followForm").addEventListener("submit", e => { e.preventDefault(); const v = $("#followInput").value.trim().toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(v)) return toast("Adresse invalide", "Une adresse ressemble à 0x suivie de 40 caractères."); $("#followInput").value = ""; if (!S.follow.includes(v)) toggleFollow(v); });
updateNotifBtn();
$("#newsSearch").addEventListener("input", renderNews);
["pIncome", "pSpend", "pSaved", "pRate"].forEach(id => { const el = $("#" + id), v = store.get("ip_" + id, null); if (v != null) el.value = v;
  el.addEventListener("input", () => { store.set("ip_" + id, el.value); renderPlan(); }); });


/* ================= SUIVI DES BALEINES ================= */
const usd = v => cur(v, "USD");
const usdBig = v => v == null ? "—" : Math.abs(v) >= 1e6 ? nf(1).format(v / 1e6) + " M$" : Math.abs(v) >= 1e3 ? nf(0).format(v / 1e3) + " k$" : nf(0).format(v) + " $";
const short = a => a.slice(0, 6) + "…" + a.slice(-4);
const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`; };
const coinImg = c => S.crypto.find(x => x.symbol.toUpperCase() === c.replace(/^k/, ""))?.image;
const coinIcon = (c, size = 36) => { const i = coinImg(c); return i ? `<img class="ic" style="width:${size}px;height:${size}px" src="${esc(i)}" alt="">` : `<div class="ic" style="width:${size}px;height:${size}px">${esc(c.slice(0, 4))}</div>`; };
const whaleConsensus = coin => S.whales?.consensus?.find(c => c.coin === coin);
const SIGCOL = { "LONG fort": "#16c784", "LONG": "#5ad8a0", "Partagé": "#f5a524", "SHORT": "#f97a3c", "SHORT fort": "#ea3943" };
const traderName = t => t.name ? esc(t.name) : `Baleine #${t.rank}`;
let prevSnap = null, lastUpdate = 0;

async function loadWhales() {
  try {
    const d = await api("/api/whales");
    detectChanges(d);
    S.whales = d; lastUpdate = Date.now();
    await Promise.all(S.follow.filter(a => !d.traders.some(t => t.address === a)).map(loadCustom));
  } catch (e) { console.error("baleines", e); }
}
async function loadCustom(addr) {
  try { const d = await api("/api/whale?address=" + addr); detectCustom(addr, d); S.custom[addr] = d; } catch (e) { S.custom[addr] = { error: e.message, positions: [] }; }
}
function updateLive() {
  if (!lastUpdate) return;
  const s = Math.round((Date.now() - lastUpdate) / 1000);
  $("#liveTxt").textContent = `EN DIRECT · ${s < 5 ? "à l'instant" : "il y a " + s + " s"}`;
}

/* que faire ? */
function whaleAction(c) {
  const dom = c.bias >= 0 ? "long" : "short";
  const entry = dom === "long" ? c.avgEntryLong : c.avgEntryShort;
  const dist = entry ? c.mark / entry - 1 : 0;
  const n = c.nLong + c.nShort;
  if (c.signal.startsWith("LONG")) {
    const tp = c.tpMedian || (entry && entry * 1.1), sl = c.slMedian || (entry && entry * 0.95);
    if (dist > .03) return `⏳ <b>Attendre un repli.</b> ${c.nLong}/${n} baleines sont acheteuses, mais le prix est déjà ${pctTxt(dist)} au-dessus de leur entrée moyenne. Zone d'achat idéale : <b>vers ${usd(entry)}</b>.`;
    if (dist < -.05) return `⚠️ <b>Prudence.</b> Les baleines sont acheteuses mais actuellement en perte (${pctTxt(dist)}). Attends que le prix repasse au-dessus de <b>${usd(entry)}</b>.`;
    return `🟢 <b>Achat possible.</b> ${c.nLong}/${n} baleines sont acheteuses et le prix est proche de leur entrée (${usd(entry)}). Objectif : <b>${usd(tp)}</b> · Stop de protection : <b>${usd(sl)}</b>.`;
  }
  if (c.signal.startsWith("SHORT")) {
    let t = `🔴 <b>Ne pas acheter pour l'instant.</b> ${c.nShort}/${n} baleines parient sur la baisse (entrée moyenne ${usd(entry)}${c.tpMedian ? `, objectif de baisse ${usd(c.tpMedian)}` : ""}). Si tu en possèdes, pense à sécuriser une partie de tes gains.`;
    if (dist > .05) t += ` ⚠️ Attention : elles sont actuellement en perte (prix ${pctTxt(dist)} au-dessus de leur entrée). Si la hausse continue, elles pourraient devoir racheter, ce qui ferait encore monter le prix.`;
    if (dist < -.15) t += ` Elles sont déjà en gros gain (${pctTxt(-dist)}) : un rebond est possible quand elles prendront leurs profits, surveille leurs fermetures.`;
    if (S.profile === "dynamique") t += ` <i>Avancé : vente à découvert possible, stop au-dessus de ${usd(c.slMedian || entry * 1.05)}.</i>`;
    return t;
  }
  return `⚖️ <b>Pas de consensus.</b> Les meilleurs traders sont partagés (${c.nLong} acheteurs / ${c.nShort} vendeurs) : mieux vaut rester à l'écart.`;
}

function renderWhaleMini() {
  const el = $("#whaleMini"); if (!el) return;
  const cs = S.whales?.consensus?.slice(0, 6);
  el.innerHTML = cs?.length ? cs.map(c => `<div class="wm" data-goto="baleines">${coinIcon(c.coin, 32)}<div class="nm"><b>${esc(c.coin)}</b><small>${c.nLong} long · ${c.nShort} short · ${usdBig(c.total)}</small></div><span class="sig" style="margin:0;background:${SIGCOL[c.signal]}22;color:${SIGCOL[c.signal]}">${c.signal}</span></div>`).join("")
    : `<div class="empty">Analyse des baleines en cours…</div>`;
}

function renderWhales() {
  const d = S.whales;
  if (!d) return;
  const st = d.stats, tot = st.long + st.short || 1;
  const lp = st.long / tot;
  $("#whaleKpis").innerHTML = [
    kpi("Traders analysés", `${st.analysed}`, `<span class="dim">les plus réguliers sur 46 000</span>`),
    kpi("Traders en position", `${st.active}`, `<span class="dim">suivis en direct</span>`),
    kpi("Capital des baleines", usdBig(st.capital), ""),
    kpi("Exposition LONG", usdBig(st.long), `<span class="up">${(lp * 100).toFixed(0)} %</span>`),
    kpi("Exposition SHORT", usdBig(st.short), `<span class="down">${((1 - lp) * 100).toFixed(0)} %</span>`),
    `<div class="card kpi"><div class="l">Sentiment des baleines</div><div class="v" style="color:${lp > .6 ? "var(--up)" : lp < .4 ? "var(--down)" : "var(--warn)"}">${lp > .6 ? "Haussier" : lp < .4 ? "Baissier" : "Neutre"}</div><div class="ls-bar" style="margin-top:12px"><i style="width:${lp * 100}%"></i></div></div>`,
  ].join("");

  $("#consensus").innerHTML = d.consensus.slice(0, 12).map(c => {
    const n = c.nLong + c.nShort, lw = c.total ? c.longValue / c.total * 100 : 50, col = SIGCOL[c.signal];
    const dom = c.bias >= 0 ? "long" : "short", entry = dom === "long" ? c.avgEntryLong : c.avgEntryShort;
    return `<div class="cons">
      <div class="cons-top">${coinIcon(c.coin, 40)}<div class="nm"><b>${esc(c.coin)}</b><small>${n} baleine${n > 1 ? "s" : ""} · ${usdBig(c.total)} en jeu</small></div>
        <span class="sig" style="margin:0;background:${col}22;color:${col};font-size:13px">${c.signal}</span></div>
      <div><div class="ls-bar"><i style="width:${lw}%"></i></div><div class="ls-lbl"><span class="up">▲ ${c.nLong} LONG · ${usdBig(c.longValue)}</span><span class="down">${usdBig(c.shortValue)} · ${c.nShort} SHORT ▼</span></div></div>
      <div class="kv">
        <div><small>Prix actuel</small><b>${usd(c.mark)}</b></div>
        <div><small>Entrée moy. (${dom})</small><b>${usd(entry)}</b></div>
        <div><small>Take profit médian</small><b>${c.tpMedian ? usd(c.tpMedian) : "—"}</b></div>
        <div><small>Stop loss médian</small><b>${c.slMedian ? usd(c.slMedian) : "—"}</b></div>
      </div>
      <div class="todo">👉 ${whaleAction(c)}</div>
    </div>`;
  }).join("") || `<div class="empty">Aucune position ouverte chez les baleines.</div>`;

  const seen = store.get("ip_feed_seen", 0);
  $("#feed").innerHTML = d.feed.slice(0, 40).map(x => feedItem(x, x.time > seen)).join("") || `<div class="empty">Aucun mouvement récent.</div>`;
  store.set("ip_feed_seen", d.feed[0]?.time || seen);

  renderMyWhales();
  $("#traders").innerHTML = d.traders.map(traderCard).join("");
}

const DIRS = {
  "Open Long": ["a ouvert un LONG", "🟢", "#16c78422"], "Close Long": ["a fermé son LONG", "⚪", "#ffffff10"],
  "Open Short": ["a ouvert un SHORT", "🔴", "#ea394322"], "Close Short": ["a fermé son SHORT", "⚪", "#ffffff10"],
  "Long > Short": ["est passé de LONG à SHORT", "🔄", "#f5a52422"], "Short > Long": ["est passé de SHORT à LONG", "🔄", "#f5a52422"],
  "Buy": ["a acheté", "🟢", "#16c78422"], "Sell": ["a vendu", "🔴", "#ea394322"],
};
function feedItem(x, isNew) {
  const [txt, ic, bg] = DIRS[x.dir] || [x.dir, "•", "#ffffff10"];
  const who = x.rank ? `Baleine #${x.rank}` : x.address ? short(x.address) : "Il";
  return `<div class="fi ${isNew ? "new" : ""}" ${x.address ? `data-trader="${x.address}"` : ""}><div class="ico" style="background:${bg}">${ic}</div>
    <div class="tx"><b>${who}</b> ${txt} <b>${esc(x.coin)}</b> · ${usdBig(x.notional)} à ${usd(x.px)}${x.closedPnl ? ` · <span class="${x.closedPnl >= 0 ? "up" : "down"}">${x.closedPnl >= 0 ? "gain" : "perte"} ${usdBig(Math.abs(x.closedPnl))}</span>` : ""}<br><small>${ago(x.time)}</small></div></div>`;
}

function posTable(pos, tpsl = {}, max = 6) {
  if (!pos.length) return `<div class="empty" style="padding:10px">Aucune position ouverte</div>`;
  return `<table class="ptbl"><thead><tr><th>Crypto</th><th>Valeur</th><th>Entrée</th><th class="hm2">Actuel</th><th>Gain latent</th><th class="hm2">Levier</th><th class="hm2">TP / SL</th></tr></thead><tbody>${
    pos.slice(0, max).map(p => { const o = tpsl[p.coin] || {}; return `<tr><td><b>${esc(p.coin)}</b> <span class="side ${p.side}">${p.side}</span></td><td>${usdBig(p.value)}</td><td>${usd(p.entry)}</td><td class="hm2">${usd(p.mark)}</td>
      <td class="${p.pnl >= 0 ? "up" : "down"}">${p.pnl >= 0 ? "+" : ""}${usdBig(p.pnl)}</td><td class="hm2">${p.leverage ? "x" + p.leverage : "—"}</td>
      <td class="hm2">${o.tp ? usd(o.tp[0]) : "—"} / ${o.sl ? usd(o.sl[0]) : "—"}</td></tr>`; }).join("")}</tbody></table>${pos.length > max ? `<small style="color:var(--muted)">+ ${pos.length - max} autre(s) position(s)</small>` : ""}`;
}

function traderCard(t) {
  const on = S.follow.includes(t.address);
  return `<div class="tc" data-trader="${t.address}">
    <div class="tc-top"><div class="rank-b">#${t.rank}</div><div class="nm"><b>${traderName(t)}</b><small>${short(t.address)}</small></div>
      <button class="star ${on ? "on" : ""}" data-star="${t.address}" title="${on ? "Ne plus suivre" : "Suivre ce trader"}">${on ? "★" : "☆"}</button></div>
    <div class="stats">
      <div><small>Capital</small><b>${usdBig(t.accountValue)}</b></div>
      <div><small>Gain 30 j</small><b class="up">+${usdBig(t.pnlMonth)}</b></div>
      <div><small>Gain total</small><b class="up">+${usdBig(t.pnlAll)}</b></div>
      <div><small>Régularité</small><b>${"●".repeat(t.consistency)}${"○".repeat(4 - t.consistency)}</b></div>
    </div>
    ${posTable(t.positions, t.tpsl, 4)}
  </div>`;
}

function renderMyWhales() {
  const el = $("#myWhales");
  if (!S.follow.length) { el.innerHTML = `<div class="empty">Clique sur ☆ à côté d'un trader, ou colle une adresse, pour recevoir une alerte à chacun de ses mouvements.</div>`; return; }
  el.innerHTML = S.follow.map(a => {
    const t = S.whales?.traders.find(x => x.address === a) || S.custom[a];
    const pos = t?.positions || [];
    const name = t?.rank ? traderName(t) : short(a);
    return `<div class="fi" data-trader="${a}"><div class="ico" style="background:#f5c52422">★</div><div class="tx"><b>${name}</b> <span class="addr">${short(a)}</span><br>
      <small>${t?.error ? esc(t.error) : !t ? "chargement…" : pos.length ? pos.slice(0, 4).map(p => `<span class="side ${p.side}">${p.side}</span> ${esc(p.coin)} ${usdBig(p.value)}`).join(" · ") : "aucune position ouverte"}</small></div>
      <button class="star on" data-star="${a}" title="Ne plus suivre">★</button></div>`;
  }).join("");
}

function toggleFollow(a) {
  const i = S.follow.indexOf(a);
  if (i >= 0) S.follow.splice(i, 1); else { S.follow.push(a); toast("⭐ Trader suivi", `Tu seras alerté de ses mouvements (${short(a)}).`); if (!S.whales?.traders.some(t => t.address === a)) loadCustom(a).then(renderWhales); }
  store.set("ip_follow", S.follow);
  renderWhales();
}

async function openTrader(addr) {
  cur_detail = null;
  $("#ranges").style.display = "none"; $(".m-chart").style.display = "none";
  let t = S.whales?.traders.find(x => x.address === addr);
  $("#mHead").innerHTML = `<div class="rank-b" style="width:48px;height:48px">${t ? "#" + t.rank : "🐋"}</div><div><h2>${t ? traderName(t) : "Trader suivi"}</h2><span class="addr">${esc(addr)}</span><br>
    <a class="ext" href="https://hypurrscan.io/address/${addr}" target="_blank" rel="noopener">Voir sur la blockchain ↗</a></div>`;
  $("#mBody").innerHTML = `<div class="empty">Chargement…</div>`;
  $("#modal").classList.add("open");
  let d;
  try { d = await api("/api/whale?address=" + addr); } catch (e) { $("#mBody").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const s = d.stats || {};
  const on = S.follow.includes(addr);
  $("#mBody").innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div><small>Capital</small><b>${usdBig(d.equity)}</b></div>
      <div><small>Gain 24 h</small><b>${s.pnlDay != null ? usdBig(s.pnlDay) : "—"}</b></div>
      <div><small>Gain 7 j</small><b>${s.pnlWeek != null ? usdBig(s.pnlWeek) : "—"}</b></div>
      <div><small>Gain 30 j</small><b>${s.pnlMonth != null ? usdBig(s.pnlMonth) + ` (${pctTxt(s.roiMonth)})` : "—"}</b></div>
      <div><small>Gain total</small><b>${s.pnlAll != null ? usdBig(s.pnlAll) : "—"}</b></div>
      <div><small>Exposition</small><b>${usdBig(d.positions.reduce((a, p) => a + p.value, 0))}</b></div>
    </div>
    <div style="margin:14px 0"><button class="btn small ${on ? "ghost" : ""}" data-star="${addr}">${on ? "★ Ne plus suivre" : "☆ Suivre ce trader (alertes)"}</button></div>
    <h3>Positions ouvertes</h3>${posTable(d.positions, d.tpsl, 50)}
    <h3 style="margin-top:18px">Derniers trades (7 jours)</h3>
    <div class="feed">${d.feed.map(x => feedItem({ ...x, address: null, rank: null })).join("") || `<div class="empty">Aucun trade récent</div>`}</div>`;
}

/* alertes : comparaison des positions entre deux mises à jour */
const snap = traders => { const m = {}; traders.forEach(t => t.positions.forEach(p => m[t.address + "|" + p.coin] = { side: p.side, value: p.value, entry: p.entry, rank: t.rank, name: t.name, coin: p.coin, addr: t.address })); return m; };
function diffSnaps(a, b, filter) {
  const ev = [];
  for (const k in b) { const n = b[k], o = a[k]; if (!filter(n)) continue;
    if (!o) ev.push([`🐋 ${n.rank ? "Baleine #" + n.rank : short(n.addr)} ouvre un ${n.side}`, `${n.coin} · ${usdBig(n.value)} à ${usd(n.entry)}`]);
    else if (o.side !== n.side) ev.push([`🔄 ${n.rank ? "Baleine #" + n.rank : short(n.addr)} se retourne`, `${n.coin} : ${o.side} → ${n.side} · ${usdBig(n.value)}`]);
    else if (n.value > o.value * 1.5 && n.value - o.value > 50000) ev.push([`➕ ${n.rank ? "Baleine #" + n.rank : short(n.addr)} renforce son ${n.side}`, `${n.coin} : ${usdBig(o.value)} → ${usdBig(n.value)}`]); }
  for (const k in a) { const o = a[k]; if (!b[k] && filter(o)) ev.push([`✅ ${o.rank ? "Baleine #" + o.rank : short(o.addr)} ferme son ${o.side}`, `${o.coin} · ${usdBig(o.value)}`]); }
  return ev;
}
function detectChanges(d) {
  const cur = snap(d.traders);
  if (prevSnap) diffSnaps(prevSnap, cur, p => S.follow.includes(p.addr) || p.value >= 250000).slice(0, 5).forEach(([t, b]) => notify(t, b));
  prevSnap = cur;
}
const prevCustom = {};
function detectCustom(addr, d) {
  const cur = snap([{ address: addr, positions: d.positions }]);
  if (prevCustom[addr]) diffSnaps(prevCustom[addr], cur, () => true).forEach(([t, b]) => notify(t, b));
  prevCustom[addr] = cur;
}
function toast(title, body) {
  const el = document.createElement("div"); el.className = "toast"; el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  $("#toasts").prepend(el); setTimeout(() => el.remove(), 9000);
}
let audioCtx;
function beep() {
  try { audioCtx ||= new AudioContext(); const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(.08, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + .4);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + .4); } catch {}
}
function notify(title, body) {
  toast(title, body);
  if (S.notif) { beep(); if ("Notification" in window && Notification.permission === "granted") try { new Notification(title, { body }); } catch {} }
}
async function enableNotif() {
  if (S.notif) { S.notif = false; store.set("ip_notif", false); updateNotifBtn(); return toast("🔕 Alertes désactivées", ""); }
  if ("Notification" in window && Notification.permission !== "granted") await Notification.requestPermission();
  S.notif = true; store.set("ip_notif", true); updateNotifBtn(); beep();
  toast("🔔 Alertes activées", "Tu seras prévenu quand une baleine ouvre, ferme ou retourne une grosse position (vérification toutes les 30 s).");
}
function updateNotifBtn() { const b = $("#notifBtn"); b.textContent = S.notif ? "🔔 Alertes activées" : "🔕 Activer les alertes"; b.classList.toggle("ghost", !S.notif); }


/* ================= INDICATEURS AVANCES ================= */
function renderIntel() {
  const m = S.market, el = $("#intel"); if (!el) return;
  if (!m || !Object.keys(m).length) { el.innerHTML = `<div class="empty">Chargement des indicateurs…</div>`; return; }
  const b = [];
  if (m.stables) {
    const c = m.stables.change30d;
    b.push(`<div class="ib"><h4>💧 Liquidité crypto (stablecoins)</h4><div class="big">${nf(0).format(m.stables.total / 1e9)} Md$ ${pill(c * 100)}</div>
      ${spark(m.stables.series, 250, 34)}<p>${c > .01 ? "De l'argent frais entre sur le marché crypto : <b class='up'>signal positif</b>." : c < -.01 ? "De l'argent sort du marché crypto sur 30 jours : <b class='down'>signal négatif</b>." : "Liquidité stable sur 30 jours."}</p></div>`);
  }
  if (m.derivs?.length) {
    const rows = m.derivs.slice(0, 6).map(d => `<div class="fr"><span>${esc(d.coin)}</span><span class="${d.fundingApr > .3 ? "down" : d.fundingApr < 0 ? "up" : ""}">${(d.fundingApr * 100).toFixed(1)} %/an</span><span style="color:var(--muted)">${usdBig(d.oi)}</span></div>`).join("");
    const hot = m.derivs.filter(d => d.fundingApr > .3).map(d => d.coin), cold = m.derivs.filter(d => d.fundingApr < -.1).map(d => d.coin);
    b.push(`<div class="ib"><h4>⚙️ Marché à levier (financement · positions)</h4>${rows}<p>${hot.length ? `Surchauffe sur ${hot.slice(0, 3).join(", ")} : trop d'acheteurs à crédit. ` : ""}${cold.length ? `Vendeurs à découvert nombreux sur ${cold.slice(0, 3).join(", ")}. ` : ""}${!hot.length && !cold.length ? "Pas d'excès de levier en ce moment." : ""}</p></div>`);
  }
  if (m.inflation || m.ecbRate) {
    const inf = m.inflation?.value, rate = +($("#pRate")?.value || 1.5);
    b.push(`<div class="ib"><h4>🏦 Économie zone euro</h4><div class="fr"><span>Inflation <small style="color:var(--dim)">(${esc(m.inflation?.date || "")})</small></span><b>${inf ?? "—"} %</b></div><div class="fr"><span>Taux de la BCE</span><b>${m.ecbRate?.value ?? "—"} %</b></div>
      ${m.fx ? `<div class="fr"><span>1 € =</span><b>${nf(4).format(m.fx.USD)} $</b></div>` : ""}
      <p>${inf != null ? (rate < inf ? `Ton livret à ${rate} % rapporte <b class="down">moins que l'inflation</b> : ton argent perd du pouvoir d'achat.` : `Ton livret à ${rate} % bat l'inflation (${inf} %) : bien pour l'épargne de sécurité.`) : ""}</p></div>`);
  }
  if (m.trending?.length) {
    b.push(`<div class="ib"><h4>🔥 Cryptos tendance (recherches)</h4><div class="trend">${m.trending.map(t => `<span data-open="cg" data-sym="${esc(t.id)}"><img src="${esc(t.thumb)}" alt="">${esc(t.symbol)}${t.change != null ? ` <em class="${t.change >= 0 ? "up" : "down"}" style="font-style:normal">${t.change >= 0 ? "+" : ""}${t.change.toFixed(0)}%</em>` : ""}</span>`).join("")}</div>
      <p>Ce que tout le monde regarde. Attention : la tendance attire souvent les achats tardifs, au plus haut.</p></div>`);
  }
  if (S.news?.mood) {
    const md = v => v > .15 ? `<b class="up">positif</b>` : v < -.15 ? `<b class="down">négatif</b>` : `<b>neutre</b>`;
    b.push(`<div class="ib" data-goto="news" style="cursor:pointer"><h4>📰 Ton des actualités</h4><div class="fr"><span>Crypto</span>${md(S.news.mood.crypto)}</div><div class="fr"><span>Bourse</span>${md(S.news.mood.bourse)}</div>
      <p>${S.news.items.length} articles analysés automatiquement. Voir les actualités →</p></div>`);
  }
  el.innerHTML = b.join("");
}

/* ================= ACTUALITES ================= */
function renderNews() {
  const d = S.news;
  if (!d) { $("#newsList").innerHTML = `<div class="empty">Chargement des actualités…</div>`; return; }
  const md = v => v > .15 ? ["Positif", "var(--up)"] : v < -.15 ? ["Négatif", "var(--down)"] : ["Neutre", "var(--warn)"];
  const [cl, cc] = md(d.mood.crypto), [bl, bc] = md(d.mood.bourse);
  const assets = Object.entries(d.byAsset).filter(([, v]) => v.n >= 3).sort((a, b) => b[1].n - a[1].n);
  $("#newsKpis").innerHTML = [
    kpi("Articles analysés", d.items.length, `<span class="dim">6 sources, mis à jour toutes les 10 min</span>`),
    `<div class="card kpi"><div class="l">Ton crypto</div><div class="v" style="color:${cc}">${cl}</div></div>`,
    `<div class="card kpi"><div class="l">Ton bourse</div><div class="v" style="color:${bc}">${bl}</div></div>`,
    ...assets.slice(0, 3).map(([k, v]) => { const [l, c] = md(v.avg); return `<div class="card kpi"><div class="l">${esc(k)} · ${v.n} articles</div><div class="v" style="color:${c}">${l}</div></div>`; }),
  ].join("");
  const filters = ["Tout", "Crypto", "Bourse", "Positives", "Négatives", ...assets.slice(0, 6).map(([k]) => k)];
  $("#newsChips").innerHTML = filters.map(f => `<button class="chip ${f === S.newsFilter ? "on" : ""}" data-nf="${esc(f)}">${esc(f)}</button>`).join("");
  const q = $("#newsSearch").value.trim().toLowerCase(), F = S.newsFilter;
  const list = d.items.filter(n => (!q || n.title.toLowerCase().includes(q)) && (F === "Tout" || (F === "Crypto" && n.cat === "crypto") || (F === "Bourse" && n.cat === "bourse")
    || (F === "Positives" && n.sent > 0) || (F === "Négatives" && n.sent < 0) || n.assets.includes(F)));
  const SD = v => v > 0 ? ["📈", "#16c78422"] : v < 0 ? ["📉", "#ea394322"] : ["📰", "#ffffff10"];
  $("#newsList").innerHTML = list.map(n => { const [ic, bg] = SD(n.sent); return `<a class="ni" href="${esc(n.link)}" target="_blank" rel="noopener"><div class="sd" style="background:${bg}">${ic}</div>
    <div class="tx"><b>${esc(n.title)}</b><small>${esc(n.source)} · ${ago(n.ts * 1000)}</small>${n.assets.map(a => `<span class="tag">${esc(a)}</span>`).join("")}</div></a>`; }).join("") || `<div class="empty">Aucun article</div>`;
}

/* ================= MON PLAN ================= */
const DCA_ASSETS = [["CW8.PA", "ETF Monde (MSCI World)", "#7c5cff"], ["ESE.PA", "ETF S&P 500", "#22d3ee"], ["PAEEM.PA", "ETF Pays émergents", "#a3e635"], ["BTC-EUR", "Bitcoin", "#f5a524"], ["ETH-EUR", "Ethereum", "#ec4899"], ["GOLD.PA", "Or (Amundi Physical Gold)", "#f5c524"], ["XGLE.DE", "Obligations zone euro", "#94a3b8"]];
const SPLITS = {
  prudent:   [["ETF Monde (MSCI World)", "CW8 · éligible PEA", .85, "#7c5cff"], ["ETF Pays émergents", "PAEEM · éligible PEA", .10, "#a3e635"], ["Bitcoin", "crypto", .05, "#f5a524"]],
  equilibre: [["ETF Monde (MSCI World)", "CW8 · éligible PEA", .70, "#7c5cff"], ["ETF S&P 500", "ESE · éligible PEA", .10, "#22d3ee"], ["ETF Pays émergents", "PAEEM · éligible PEA", .10, "#a3e635"], ["Bitcoin / Ethereum", "crypto", .10, "#f5a524"]],
  dynamique: [["ETF Monde (MSCI World)", "CW8 · éligible PEA", .55, "#7c5cff"], ["ETF S&P 500", "ESE · éligible PEA", .15, "#22d3ee"], ["ETF Pays émergents", "PAEEM · éligible PEA", .10, "#a3e635"], ["Bitcoin", "crypto", .15, "#f5a524"], ["Ethereum", "crypto", .05, "#ec4899"]],
};
const eur0 = v => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
function planNumbers() {
  const inc = +$("#pIncome").value || 0, sp = +$("#pSpend").value || 0, saved = +$("#pSaved").value || 0, rate = +$("#pRate").value || 0;
  const cap = Math.max(0, inc - sp), target = sp * 3, fundOk = saved >= target;
  const toFund = fundOk ? 0 : Math.round(cap * .6), toInvest = cap - toFund;
  return { inc, sp, saved, rate, cap, target, fundOk, toFund, toInvest };
}
function renderPlan() {
  const P = planNumbers();
  const pct = P.target ? Math.min(1, P.saved / P.target) : 1;
  const months = P.toFund ? Math.ceil((P.target - P.saved) / P.toFund) : 0;
  const step = (n, cls, html) => `<div class="step ${cls}"><div class="n">${cls === "done" ? "✓" : n}</div><div class="tx">${html}</div></div>`;
  $("#planSteps").innerHTML = [
    step(1, P.cap > 0 ? "done" : "now", P.cap > 0 ? `<b>Budget positif</b> : il te reste <b>${eur0(P.cap)}</b> par mois après tes dépenses.` : `<b>Équilibrer ton budget</b> : tes dépenses dépassent tes revenus. Avant d'investir, réduis les dépenses (abonnements, livraisons…) ou cherche des aides (APL, bourses).`),
    step(2, P.fundOk ? "done" : P.cap > 0 ? "now" : "", `<b>Fonds d'urgence : ${eur0(P.saved)} / ${eur0(P.target)}</b> (3 mois de dépenses) sur un livret.${!P.fundOk && P.toFund ? ` Encore environ <b>${months} mois</b> à ${eur0(P.toFund)}/mois.` : ""}<div class="prog"><i style="width:${pct * 100}%"></i></div>`),
    step(3, P.fundOk && P.cap > 0 ? "now" : "", `<b>Investir chaque mois</b> (même 20 €) dans un ETF monde, de préférence sur un <b>PEA</b>, et ne pas y toucher pendant des années.`),
    step(4, "", `<b>Petite part crypto</b> (5 à 20 % selon ton profil), uniquement de l'argent que tu peux perdre. Utilise les onglets Baleines et Où investir ? pour choisir le moment.`),
  ].join("");
  const split = SPLITS[S.profile];
  $("#planSplit").innerHTML = P.cap <= 0 ? `<div class="empty">Commence par équilibrer ton budget 💪</div>` :
    `<p class="sub" style="margin-bottom:8px">Profil <b>${PROFILES[S.profile].label}</b> (modifiable dans « Où investir ? ») · ${eur0(P.cap)} disponibles / mois</p>
    ${P.toFund ? `<div class="split-row"><i style="background:#3a4460"></i><span>Livret (fonds d'urgence)<small>disponible à tout moment, sans risque</small></span><b>${eur0(P.toFund)}</b></div>` : ""}
    ${split.map(([n, sub, w, c]) => `<div class="split-row"><i style="background:${c}"></i><span>${n}<small>${sub}</small></span><b>${eur0(P.toInvest * w)}</b></div>`).join("")}
    <p class="sub" style="margin-top:10px;font-size:12px">💡 Programme un virement automatique le jour de ta paie/bourse : c'est le secret de la régularité.</p>`;
  renderProjection(P);
  renderDCA();
  renderIntel();
}
function renderProjection(P) {
  const m = P.toInvest || 50;
  const fv = (r, y) => { const i = r / 12; let v = 0; for (let k = 0; k < y * 12; k++) v = v * (1 + i) + m; return v; };
  const rows = [5, 10, 20, 30].map(y => `<tr><td>${y} ans</td><td>${eur0(m * 12 * y)}</td><td>${eur0(fv(P.rate / 100, y))}</td><td>${eur0(fv(.05, y))}</td><td class="up"><b>${eur0(fv(.07, y))}</b></td></tr>`).join("");
  $("#projection").innerHTML = `<p class="sub" style="margin-bottom:8px">Avec <b>${eur0(m)} / mois</b> investis :</p>
    <table class="ptbl big"><thead><tr><th>Durée</th><th>Versé</th><th>Livret ${P.rate}%</th><th>5 %/an</th><th>7 %/an</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="sub" style="margin-top:10px;font-size:12px">5 à 7 %/an ≈ moyenne historique long terme des actions mondiales (hypothèse, non garantie). Plus tu commences tôt, plus les intérêts travaillent pour toi.</p>`;
}
let dcaChart, dcaCache = {};
async function renderDCA() {
  const P = planNumbers(), m = P.toInvest || 50, Y = S.dcaYears;
  $("#dcaSub").innerHTML = `Simulation : <b>${eur0(m)} investis chaque mois pendant ${Y} ans</b>, aux vrais prix historiques.`;
  await Promise.all(DCA_ASSETS.map(async ([sym]) => { if (!dcaCache[sym]) try { dcaCache[sym] = (await api(`/api/history?source=yh&symbol=${encodeURIComponent(sym)}&range=10y`)).points; } catch { dcaCache[sym] = []; } }));
  const n = Y * 12;
  const sims = DCA_ASSETS.map(([sym, name, col]) => {
    const pts = dcaCache[sym].slice(-n - 1, -1).concat(dcaCache[sym].slice(-1));
    if (pts.length < n * .8) return null;
    let units = 0, inv = 0, peak = 0, dd = 0; const vals = [];
    pts.forEach(([, px], i) => { if (i < pts.length - 1 || pts.length <= n) { units += m / px; inv += m; } const v = units * px; vals.push(v); peak = Math.max(peak, v); dd = Math.min(dd, peak ? v / peak - 1 : 0); });
    return { sym, name, col, inv, final: vals[vals.length - 1], dd, vals, dates: pts.map(p => p[0]), full: pts.length >= n };
  }).filter(Boolean);
  if (!sims.length) { $("#dcaTable").innerHTML = `<div class="empty">Données indisponibles</div>`; return; }
  const ref = sims.reduce((a, b) => a.dates.length >= b.dates.length ? a : b);
  // livret
  let lv = 0; const lvals = ref.dates.map((_, i) => { lv = lv * (1 + P.rate / 100 / 12) + (i < ref.dates.length - 1 ? m : 0); return lv; });
  const invested = ref.dates.map((_, i) => m * Math.min(i + 1, ref.dates.length - 1));
  const labels = ref.dates.map(t => new Date(t * 1000).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }));
  const align = v => Array(ref.dates.length - v.length).fill(null).concat(v);
  const data = { labels, datasets: [
    ...sims.map(x => ({ label: x.name, data: align(x.vals), borderColor: x.col, borderWidth: 2, pointRadius: 0, tension: .2 })),
    { label: `Livret ${P.rate} %`, data: lvals, borderColor: "#8892a8", borderWidth: 1.5, pointRadius: 0 },
    { label: "Argent versé", data: invested, borderColor: "#ffffff55", borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0 },
  ] };
  if (window.Chart) {
    if (dcaChart) dcaChart.destroy();
    dcaChart = new Chart($("#dcaChart"), { type: "line", data, options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#8892a8", boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label} : ${eur0(c.raw)}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: "#5d6780", maxTicksLimit: 8 } }, y: { position: "right", grid: { color: "#ffffff08" }, ticks: { color: "#5d6780", callback: v => eur0(v) } } } } });
  }
  const row = (name, col, inv, fin, dd, note = "") => `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${col};margin-right:6px"></i>${name}${note}</td><td>${eur0(inv)}</td><td><b>${eur0(fin)}</b></td><td class="${fin >= inv ? "up" : "down"}">${fin >= inv ? "+" : ""}${((fin / inv - 1) * 100).toFixed(0)} %</td><td class="down">${dd == null ? "—" : (dd * 100).toFixed(0) + " %"}</td></tr>`;
  const linv = m * (ref.dates.length - 1);
  $("#dcaTable").innerHTML = `<table class="ptbl big"><thead><tr><th>Placement</th><th>Versé</th><th>Valeur aujourd'hui</th><th>Gain</th><th>Pire baisse en route</th></tr></thead><tbody>
    ${sims.sort((a, b) => b.final / b.inv - a.final / a.inv).map(x => row(x.name, x.col, x.inv, x.final, x.dd, x.full ? "" : " <small style='color:var(--muted)'>(historique plus court)</small>")).join("")}
    ${row(`Livret ${P.rate} %`, "#8892a8", linv, lvals[lvals.length - 1], 0)}</tbody></table>
    <p class="sub" style="margin-top:10px;font-size:12px">La colonne « pire baisse » montre ce que tu aurais dû supporter sans paniquer. C'est pour ça qu'on garde un fonds d'urgence et une petite part de crypto.</p>`;
}

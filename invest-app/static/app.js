/* InvestPilot – interface */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = { crypto: [], stocks: [], indices: [], global: {}, analysis: { stocks: [], crypto: [] },
  profile: "equilibre", scope: "all", region: "Tous", signal: "Tous",
  sort: { crypto: ["market_cap_rank", 1], stock: ["name", 1] } };

/* ---------- format ---------- */
const nf = (d = 2) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const cur = (v, c = "EUR") => {
  if (v == null || isNaN(v)) return "—";
  const d = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 8;
  try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: c || "USD", minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
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
  try { S.analysis = await api("/api/analysis"); } catch (e) { console.error(e); }
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

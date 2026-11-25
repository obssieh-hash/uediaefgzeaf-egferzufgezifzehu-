/* InvestPilot – Analyse Pro : 8 modules inspirés des méthodes institutionnelles */
const PRO = { m: "sel", sym: store.get("ip_pro_sym", "AAPL"), cache: {}, charts: {} };
const today = () => new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const P0 = v => v == null || isNaN(v) ? "—" : (v * 100).toFixed(1) + " %";
const P1 = v => v == null || isNaN(v) ? "—" : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} %</span>`;
const N1 = (v, d = 1) => v == null || isNaN(v) ? "—" : nf(d).format(v);
const bigC = (v, c) => { if (v == null) return "—"; const a = Math.abs(v), s = c === "EUR" ? " €" : c === "USD" ? " $" : " " + (c || ""); return a >= 1e12 ? nf(2).format(v / 1e12) + " Bn" + s : a >= 1e9 ? nf(1).format(v / 1e9) + " Md" + s : a >= 1e6 ? nf(1).format(v / 1e6) + " M" + s : nf(0).format(v) + s; };
const clampN = (x, a, b) => Math.max(a, Math.min(b, x));
const VCOL = { good: ["#16c784", "#16c78414", "#16c78444"], mid: ["#f5a524", "#f5a52414", "#f5a52444"], bad: ["#ea3943", "#ea394314", "#ea394344"] };
const verdictBox = (label, value, kind, sub = "") => { const [c, bg, bd] = VCOL[kind]; return `<div class="verdict" style="color:${c};background:${bg};border-color:${bd}"><small>${label}</small><b>${value}</b>${sub ? `<div style="font-size:12px;margin-top:4px;color:var(--muted)">${sub}</div>` : ""}</div>`; };
const repHead = (kicker, title, sub, right = "") => `<div class="rep-head"><div><div class="kicker">${kicker} · ${today()}</div><h2>${title}</h2><div class="sub">${sub}</div></div>${right}</div>`;
async function papi(path) { if (!PRO.cache[path]) PRO.cache[path] = api(path).catch(e => { delete PRO.cache[path]; throw e; }); return PRO.cache[path]; }
const loading = txt => `<div class="card"><div class="empty">⏳ ${txt}</div></div>`;
const errBox = e => `<div class="card"><div class="empty">❌ ${esc(e.message || e)}</div></div>`;
function mkChart(id, cfg) { if (PRO.charts[id]) PRO.charts[id].destroy(); const el = document.getElementById(id); if (el && window.Chart) PRO.charts[id] = new Chart(el, cfg); }
const axisOpts = (fmt) => ({ x: { grid: { display: false }, ticks: { color: "#5d6780", maxTicksLimit: 8 } }, y: { position: "right", grid: { color: "#ffffff08" }, ticks: { color: "#5d6780", callback: fmt || (v => v) } } });

function symPicker(label = "Action à analyser", allowCrypto = false) {
  return `<div class="field"><label>${label}</label><input id="proSym" list="symList" value="${esc(PRO.sym)}" placeholder="ex. AAPL, MC.PA${allowCrypto ? ", BTC-USD" : ""}" style="width:200px"></div>
    <button class="btn" id="proGo">Analyser</button><span class="sub" style="font-size:12px">Symboles Yahoo Finance : AAPL, NVDA, MC.PA (LVMH), TTE.PA${allowCrypto ? ", BTC-USD" : ""}…</span>`;
}
function fillSymList() {
  const opts = [...(S.stocks || []).map(s => [s.symbol, s.name]), ...(S.analysis?.crypto || []).map(c => [c.symbol, c.name])];
  $("#symList").innerHTML = opts.map(([s, n]) => `<option value="${esc(s)}">${esc(n)}</option>`).join("");
}

function renderPro() {
  fillSymList();
  $$("#proTabs button").forEach(b => b.classList.toggle("on", b.dataset.m === PRO.m));
  ({ sel: proSel, dcf: proDcf, risk: proRisk, earn: proEarn, port: proPort, tech: proTech, div: proDiv, etf: proEtf })[PRO.m]();
}
$("#proTabs").addEventListener("click", e => { const b = e.target.closest("button[data-m]"); if (b) { PRO.m = b.dataset.m; renderPro(); } });
$("#view-pro").addEventListener("click", e => {
  if (e.target.closest("#proGo")) { PRO.sym = $("#proSym").value.trim().toUpperCase() || PRO.sym; store.set("ip_pro_sym", PRO.sym); renderPro(); }
  const g = e.target.closest("[data-prosym]"); if (g) { PRO.sym = g.dataset.prosym; store.set("ip_pro_sym", PRO.sym); PRO.m = g.dataset.prom || "dcf"; renderPro(); window.scrollTo(0, 0); }
});
$("#view-pro").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "proSym") $("#proGo").click(); });

/* =============== 1. SELECTION D'ACTIONS (Goldman Sachs) =============== */
const SEL = store.get("ip_sel", { sector: "Tous", region: "Toutes", div: 0 });
function moatOf(x) { if ((x.opMargin || 0) > .25 && (x.roe || 0) > .18) return ["Fort", 2]; if ((x.opMargin || 0) > .12) return ["Modéré", 1]; return ["Faible", 0]; }
function riskOf(x) {
  let r = 2 + (x.vol || .3) * 12 + ((x.beta || 1) - 1) * 2 + ((x.debtToEquity || 0) > 150 ? 1 : 0) + ((x.pe || 0) > 50 ? 1 : 0);
  r = Math.round(clampN(r, 1, 10));
  const why = [`volatilité ${P0(x.vol)}/an`, `bêta ${N1(x.beta, 2)}`];
  if ((x.debtToEquity || 0) > 150) why.push("endettement élevé");
  if ((x.pe || 0) > 50) why.push("valorisation exigeante");
  return [r, why.join(", ")];
}
function selScore(x) {
  let s = 0; const pros = [], cons = [];
  const r = x.pe && x.sectorPe ? x.pe / x.sectorPe : null;
  if (!x.pe || x.pe < 0) { s -= 1; cons.push("pas de bénéfice (PER négatif)"); }
  else if (r < .8) { s += 2; pros.push("PER inférieur au secteur"); } else if (r < 1) s += 1; else if (r > 1.8) { s -= 2; cons.push("PER très supérieur au secteur"); } else if (r > 1.3) s -= 1;
  if (x.revCagr != null) { if (x.revCagr > .15) { s += 2; pros.push("forte croissance du chiffre d'affaires"); } else if (x.revCagr > .07) s += 1; else if (x.revCagr < 0) { s -= 2; cons.push("chiffre d'affaires en recul"); } }
  const de = x.debtToEquity; if (de != null) { if (de < 50) { s += 1; pros.push("peu endettée"); } else if (de > 300) { s -= 2; cons.push("très endettée"); } else if (de > 150) s -= 1; }
  if ((x.divYield || 0) > .02) { s += S.profile === "prudent" ? 2 : 1; pros.push("dividende attractif"); }
  const [moat, mv] = moatOf(x); s += mv; if (mv === 2) pros.push("avantage concurrentiel fort");
  const up = x.target && x.price ? x.target / x.price - 1 : null;
  if (up != null) { if (up > .15) { s += 1.5; pros.push(`les analystes voient +${(up * 100).toFixed(0)} %`); } else if (up < 0) { s -= 1.5; cons.push("cours au-dessus de l'objectif des analystes"); } }
  if (x.sma200) { if (x.price > x.sma200) s += 1; else { s -= 1; cons.push("sous sa moyenne 200 jours"); } }
  const [risk] = riskOf(x);
  s -= S.profile === "prudent" ? risk * .5 : S.profile === "equilibre" ? risk * .25 : 0;
  if (S.profile === "dynamique" && (x.revCagr || 0) > .1) s += 1;
  return { s, pros, cons, up, moat };
}
async function proSel() {
  let d; $("#proBody").innerHTML = loading("Analyse fondamentale de toutes les actions…");
  try { d = await papi("/api/screen"); } catch (e) { $("#proBody").innerHTML = errBox(e); return; }
  const sectors = ["Tous", ...new Set(d.map(x => x.sector).filter(Boolean))].sort();
  const region = c => c === "United States" ? "USA" : c === "France" ? "France" : "Europe";
  $("#proCtrl").innerHTML = `
    <div class="field"><label>Secteur</label><select id="selSector">${sectors.map(s => `<option ${s === SEL.sector ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
    <div class="field"><label>Région</label><select id="selRegion">${["Toutes", "USA", "France", "Europe"].map(s => `<option ${s === SEL.region ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="field"><label>Dividende minimum</label><select id="selDiv">${[0, .01, .02, .03].map(v => `<option value="${v}" ${v == SEL.div ? "selected" : ""}>${v ? (v * 100) + " %" : "Peu importe"}</option>`).join("")}</select></div>
    <div class="field"><label>Profil</label><select id="selProfile">${Object.entries(PROFILES).map(([k, p]) => `<option value="${k}" ${k === S.profile ? "selected" : ""}>${p.label}</option>`).join("")}</select></div>`;
  ["selSector", "selRegion", "selDiv", "selProfile"].forEach(id => $("#" + id).onchange = () => {
    SEL.sector = $("#selSector").value; SEL.region = $("#selRegion").value; SEL.div = +$("#selDiv").value; store.set("ip_sel", SEL);
    if ($("#selProfile").value !== S.profile) { S.profile = $("#selProfile").value; $$("#profileSeg button").forEach(b => b.classList.toggle("on", b.dataset.p === S.profile)); }
    proSel();
  });
  const list = d.filter(x => (SEL.sector === "Tous" || x.sector === SEL.sector) && (SEL.region === "Toutes" || region(x.country) === SEL.region) && (x.divYield || 0) >= SEL.div)
    .map(x => ({ ...x, ...selScore(x) })).sort((a, b) => b.s - a.s);
  const top = list.slice(0, 10);
  const card = (x, i) => {
    const [risk, rwhy] = riskOf(x);
    const bull = x.targetHigh || x.price * (1 + (x.vol || .3)), base = x.target || x.price * 1.08, bear = x.targetLow || x.price * (1 - (x.vol || .3));
    const ref = Math.min(x.price, x.sma50 || x.price), eLo = ref * .97, eHi = ref * 1.0;
    const stop = eLo * (1 - Math.max(.08, (x.vol || .3) * .35));
    const sust = x.divYield ? (x.payout < .6 ? ["Durable", "up"] : x.payout < .9 ? ["Tendu", ""] : ["Risqué", "down"]) : null;
    const rc = risk <= 3 ? "up" : risk <= 6 ? "" : "down";
    return `<div class="pick-card">
      <div style="display:flex;justify-content:space-between;gap:10px"><div><h4>${i + 1}. ${esc(x.name)}</h4><div class="meta">${esc(x.symbol)} · ${esc(x.sector || "")} · ${esc(x.country || "")} · ${cur(x.price, x.currency)}</div></div>
        <span class="badge" style="background:#7c5cff22;color:#c4b5fd;height:fit-content">${x.s.toFixed(1)} pts</span></div>
      <div class="lv"><span>PER (vs secteur)</span><b>${N1(x.pe)} <small style="color:var(--muted)">/ ${N1(x.sectorPe)}</small></b></div>
      <div class="lv"><span>Croissance du CA (par an, 4 ans)</span><b>${P1(x.revCagr)}</b></div>
      <div class="lv"><span>Dette / capitaux propres</span><b>${x.debtToEquity != null ? N1(x.debtToEquity / 100, 2) : "—"}</b></div>
      <div class="lv"><span>Dividende · durabilité</span><b>${x.divYield ? P0(x.divYield) + ` · <span class="${sust[1]}">${sust[0]}</span>` : "aucun"}</b></div>
      <div class="lv"><span>Avantage concurrentiel</span><b>${x.moat}</b></div>
      <div class="lv"><span>Risque</span><b class="${rc}">${risk}/10</b></div>
      <div style="font-size:11.5px;color:var(--muted);margin:2px 0 6px">↳ ${rwhy}</div>
      <div class="lv"><span>Objectif 12 mois (haussier / central / baissier)</span><b><span class="up">${cur(bull, x.currency)}</span> / ${cur(base, x.currency)} / <span class="down">${cur(bear, x.currency)}</span></b></div>
      <div class="lv"><span>Zone d'entrée</span><b>${cur(eLo, x.currency)} – ${cur(eHi, x.currency)}</b></div>
      <div class="lv"><span>Stop-loss</span><b class="down">${cur(stop, x.currency)}</b></div>
      <div style="font-size:12px;margin-top:8px;line-height:1.5">${x.pros.slice(0, 3).map(p => `✅ ${esc(p)}`).join("<br>")}${x.cons.length ? "<br>" + x.cons.slice(0, 2).map(p => `⚠️ ${esc(p)}`).join("<br>") : ""}</div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn ghost small" data-prosym="${esc(x.symbol)}" data-prom="dcf">Valorisation DCF</button><button class="btn ghost small" data-prosym="${esc(x.symbol)}" data-prom="earn">Résultats</button><button class="btn ghost small" data-prosym="${esc(x.symbol)}" data-prom="tech">Technique</button></div>
    </div>`;
  };
  const avgUp = top.filter(x => x.up != null).reduce((a, x, _, l) => a + x.up / l.length, 0);
  $("#proBody").innerHTML = `<div class="report">${repHead("Rapport de recherche actions", "Top 10 : sélection d'actions", `${list.length} actions passées au crible · profil ${PROFILES[S.profile].label.toLowerCase()} · secteur : ${esc(SEL.sector)} · région : ${esc(SEL.region)}`,
    verdictBox("Meilleur dossier", top[0] ? esc(top[0].symbol) : "—", "good", top[0] ? esc(top[0].name) : ""))}
    <div class="synth"><b>Synthèse :</b> ${top.length ? `Les dossiers les mieux notés combinent une valorisation raisonnable par rapport à leur secteur, une croissance régulière du chiffre d'affaires, un endettement maîtrisé et une tendance boursière positive. Potentiel moyen estimé par les analystes pour ce top 10 : <b>${P1(avgUp)}</b> sur 12 mois. ${S.profile === "prudent" ? "Profil prudent : les actions les plus volatiles sont pénalisées." : S.profile === "dynamique" ? "Profil dynamique : la croissance est favorisée, le risque moins pénalisé." : ""} Ne concentre jamais plus de 5 à 10 % de ton capital sur une seule action.` : "Aucune action ne correspond à ces critères."}</div>
    <div class="grid3">${top.map(card).join("")}</div>
    <div class="card"><h3>Classement complet</h3><div style="overflow-x:auto"><table class="ptbl big"><thead><tr><th>Action</th><th>Points</th><th>PER</th><th>PER secteur</th><th>Croiss. CA</th><th>Dette/CP</th><th>Div.</th><th>Potentiel analystes</th><th>Risque</th></tr></thead><tbody>
    ${list.map(x => `<tr style="cursor:pointer" data-prosym="${esc(x.symbol)}" data-prom="dcf"><td><b>${esc(x.symbol)}</b> <small style="color:var(--muted)">${esc((x.name || "").slice(0, 26))}</small></td><td>${x.s.toFixed(1)}</td><td>${N1(x.pe)}</td><td>${N1(x.sectorPe)}</td><td>${P1(x.revCagr)}</td><td>${x.debtToEquity != null ? N1(x.debtToEquity / 100, 2) : "—"}</td><td>${x.divYield ? P0(x.divYield) : "—"}</td><td>${P1(x.up)}</td><td>${riskOf(x)[0]}/10</td></tr>`).join("")}
    </tbody></table></div></div></div>`;
}

/* =============== 2. DCF (Morgan Stanley) =============== */
const DCFIN = {};
async function proDcf() {
  $("#proCtrl").innerHTML = symPicker();
  $("#proBody").innerHTML = loading("Chargement des états financiers de " + PRO.sym + "…");
  let x; try { x = await papi("/api/fundamentals?symbol=" + encodeURIComponent(PRO.sym)); } catch (e) { $("#proBody").innerHTML = errBox(e); return; }
  if (!x.revenue || !x.shares) { $("#proBody").innerHTML = errBox("Données financières insuffisantes pour un DCF sur ce titre (ETF, crypto ou données manquantes)."); return; }
  const k = x.symbol;
  if (!DCFIN[k]) {
    const tr = (x.trend || []).find(t => t.period === "+1y"), tr0 = (x.trend || []).find(t => t.period === "0y");
    let g = tr?.revenue && tr0?.revenue ? tr.revenue / tr0.revenue - 1 : x.revCagr ?? x.revGrowth ?? .05;
    g = clampN(g, -.05, .30);
    // le cash-flow libre de Yahoo est parfois anormalement bas : on se replie sur 60 % du cash-flow operationnel
    const fcfOk = x.fcf && x.ocf ? x.fcf > x.ocf * .35 : !!x.fcf;
    PRO.fcfEst = PRO.fcfEst || {}; PRO.fcfEst[k] = !fcfOk && x.ocf;
    const margin = clampN(fcfOk ? x.fcf / x.revenue : x.ocf ? x.ocf * .6 / x.revenue : (x.profitMargin || .1), -.1, .6);
    const beta = clampN(x.beta || 1, .5, 2.2), ke = .04 + beta * .055, kd = .05 * .75;
    const E = x.marketCap || x.price * x.shares, D = x.totalDebt || 0, wacc = clampN((E * ke + D * kd) / (E + D), .06, .14);
    const curMult = x.ev && x.fcf > 0 ? x.ev / x.fcf : 20;
    DCFIN[k] = { g: +(g * 100).toFixed(1), margin: +(margin * 100).toFixed(1), wacc: +(wacc * 100).toFixed(1), tg: 2.5, mult: +clampN(curMult, 10, 35).toFixed(0) };
  }
  const I = DCFIN[k];
  const calc = (wacc, tg, inp = I) => {
    const g1 = inp.g / 100, gT = tg / 100, m = inp.margin / 100, rows = [];
    let rev = x.revenue, pv = 0;
    for (let y = 1; y <= 5; y++) {
      const g = g1 + (gT - g1) * (y - 1) / 5; rev *= 1 + g; const fcf = rev * m, df = 1 / (1 + wacc) ** y; pv += fcf * df;
      rows.push({ y, g, rev, fcf, pvf: fcf * df });
    }
    const f5 = rows[4].fcf, df5 = 1 / (1 + wacc) ** 5;
    const tvG = wacc > gT ? f5 * (1 + gT) / (wacc - gT) : NaN, tvM = f5 * inp.mult;
    const eq = tv => pv + tv * df5 - (x.totalDebt || 0) + (x.totalCash || 0);
    const psG = eq(tvG) / x.shares, psM = eq(tvM) / x.shares;
    return { rows, pv, tvG, tvM, psG, psM, ps: (psG + psM) / 2, tvShare: tvG * df5 / (pv + tvG * df5) };
  };
  const r = calc(I.wacc / 100, I.tg);
  const up = r.ps / x.price - 1;
  const kind = up > .15 ? "good" : up < -.15 ? "bad" : "mid";
  const label = up > .15 ? "Sous-évaluée" : up < -.15 ? "Surévaluée" : "Correctement valorisée";
  const fin = x.sector === "Financial Services";
  const waccs = [-1, -.5, 0, .5, 1].map(d => I.wacc + d), tgs = [1.5, 2, 2.5, 3, 3.5];
  const risks = [];
  if (I.g > 12) risks.push(`La valorisation dépend d'une croissance de ${I.g} %/an : un ralentissement ferait fortement baisser la juste valeur.`);
  if (r.tvShare > .75) risks.push(`${(r.tvShare * 100).toFixed(0)} % de la valeur vient de la « valeur terminale » (après 5 ans) : très sensible aux hypothèses de long terme.`);
  if (I.margin > 30) risks.push(`Marge de cash-flow très élevée (${I.margin} %) : la concurrence pourrait la réduire.`);
  if ((x.debtToEquity || 0) > 150) risks.push("Endettement élevé : une hausse des taux augmenterait le coût du capital.");
  if ((x.beta || 1) > 1.3) risks.push(`Bêta de ${N1(x.beta, 2)} : l'action amplifie les mouvements du marché.`);
  risks.push("Une hausse de 1 point du coût du capital (WACC) change fortement le résultat : regarde le tableau de sensibilité.");
  const cc = x.currency;
  const inp = (id, lab, v, step = .5) => `<div class="field"><label>${lab}</label><input type="number" step="${step}" data-dcf="${id}" value="${v}" style="width:110px"></div>`;
  $("#proBody").innerHTML = `<div class="report">${repHead("Mémo de valorisation · DCF", esc(x.name), `${esc(x.symbol)} · ${esc(x.sector || "")} · cours actuel ${cur(x.price, cc)}`,
      verdictBox("Juste valeur estimée", cur(r.ps, cc), kind, `${label} · ${up >= 0 ? "+" : ""}${(up * 100).toFixed(0)} % vs cours`))}
    ${fin ? `<div class="synth" style="border-color:var(--warn)">⚠️ Pour une banque ou un assureur, le DCF par cash-flow libre est peu fiable (leur « dette » est leur matière première). Utilise plutôt le PER et le ratio cours/valeur comptable (${N1(x.pb, 2)}).</div>` : ""}
    <div class="synth"><b>Verdict :</b> avec une croissance initiale de ${I.g} %/an ralentissant vers ${I.tg} %, une marge de cash-flow libre de ${I.margin} % et un coût du capital de ${I.wacc} %, la juste valeur ressort à <b>${cur(r.ps, cc)}</b> par action (méthode Gordon : ${cur(r.psG, cc)} · méthode multiple de sortie ×${I.mult} : ${cur(r.psM, cc)}). Le titre paraît <b>${label.toLowerCase()}</b>. ${x.target ? `Pour comparaison, l'objectif moyen des analystes est ${cur(x.target, cc)}.` : ""}</div>
    ${PRO.fcfEst?.[k] ? `<div class="synth" style="border-color:var(--warn)">ℹ️ Le cash-flow libre publié par la source de données (${bigC(x.fcf, cc)}) paraît anormalement bas par rapport au cash-flow opérationnel (${bigC(x.ocf, cc)}). La marge par défaut est donc estimée à 60 % du cash-flow opérationnel. Tu peux l'ajuster.</div>` : ""}
    <div class="card"><h3>🔧 Hypothèses (modifiables)</h3><div class="pro-ctrl" style="margin:0">
      ${inp("g", "Croissance CA an 1 (%)", I.g)}${inp("margin", "Marge cash-flow libre (%)", I.margin)}${inp("wacc", "WACC (%)", I.wacc, .1)}${inp("tg", "Croissance perpétuelle (%)", I.tg, .1)}${inp("mult", "Multiple de sortie (×FCF)", I.mult, 1)}
      <button class="btn ghost small" id="dcfReset">Réinitialiser</button></div>
      <p class="sub" style="font-size:12px;margin-top:8px">WACC = coût des fonds propres (4 % sans risque + bêta ${N1(x.beta, 2)} × 5,5 % de prime) et coût de la dette (5 % après impôt), pondérés par capitalisation (${bigC(x.marketCap, cc)}) et dette (${bigC(x.totalDebt, cc)}).</p></div>
    <div class="two" style="margin:0">
      <div class="card"><h3>📅 Projection sur 5 ans</h3><table class="ptbl big"><thead><tr><th>Année</th><th>Croissance</th><th>Chiffre d'affaires</th><th>Cash-flow libre</th><th>Valeur actuelle</th></tr></thead><tbody>
        <tr><td>Actuel</td><td>${P1(x.revGrowth)}</td><td>${bigC(x.revenue, cc)}</td><td>${bigC(PRO.fcfEst?.[k] ? x.ocf * .6 : x.fcf, cc)}${PRO.fcfEst?.[k] ? " (est.)" : ""}</td><td>—</td></tr>
        ${r.rows.map(y => `<tr><td>An ${y.y}</td><td>${P0(y.g)}</td><td>${bigC(y.rev, cc)}</td><td>${bigC(y.fcf, cc)}</td><td>${bigC(y.pvf, cc)}</td></tr>`).join("")}</tbody></table>
        <div class="lv" style="margin-top:8px"><span>Valeur terminale (Gordon / multiple)</span><b>${bigC(r.tvG, cc)} / ${bigC(r.tvM, cc)}</b></div>
        <div class="lv"><span>Trésorerie − dette</span><b>${bigC((x.totalCash || 0) - (x.totalDebt || 0), cc)}</b></div>
        <div class="lv"><span>Nombre d'actions</span><b>${bigC(x.shares, "").replace(" ", "")}</b></div></div>
      <div class="card"><h3>🎯 Sensibilité : juste valeur par action</h3><p class="sub" style="font-size:12px;margin-bottom:8px">Lignes : WACC · Colonnes : croissance perpétuelle. <span class="up">Vert</span> = au-dessus du cours actuel.</p>
        <table class="ptbl sens"><thead><tr><th>WACC \\ g</th>${tgs.map(t => `<th>${t} %</th>`).join("")}</tr></thead><tbody>
        ${waccs.map(w => `<tr><td><b>${w.toFixed(1)} %</b></td>${tgs.map(t => { const v = calc(w / 100, t).ps; const u = v / x.price - 1; return `<td style="background:${u > .15 ? "#16c78422" : u < -.15 ? "#ea394322" : "#f5a52414"}">${isFinite(v) ? cur(v, cc) : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></div>
    <div class="two" style="margin:0">
      <div class="card"><h3>📜 Historique</h3><table class="ptbl big"><thead><tr><th>Année</th><th>Chiffre d'affaires</th><th>Résultat net</th><th>Marge nette</th></tr></thead><tbody>
        ${(x.years || []).map(y => `<tr><td>${y.year}</td><td>${bigC(y.revenue, cc)}</td><td>${bigC(y.netIncome, cc)}</td><td>${y.revenue ? P0(y.netIncome / y.revenue) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <div class="card"><h3>💥 Ce qui pourrait faire s'effondrer le modèle</h3><ul class="rules">${risks.map(t => `<li>⚠️ ${t}</li>`).join("")}</ul></div></div></div>`;
  $$("[data-dcf]").forEach(el => el.addEventListener("change", () => { I[el.dataset.dcf] = +el.value; proDcf(); }));
  $("#dcfReset").onclick = () => { delete DCFIN[k]; proDcf(); };
}

/* =============== 3. RISQUE (Bridgewater) =============== */
let PF = store.get("ip_pf", [["CW8.PA", 2000], ["AAPL", 800], ["MC.PA", 600], ["BTC-USD", 500], ["GOLD.PA", 300]]);
async function proRisk(run = false) {
  $("#proCtrl").innerHTML = "";
  const editor = `<div class="card"><h3>💼 Mon portefeuille</h3><p class="sub" style="font-size:12px;margin-bottom:10px">Entre tes positions (symbole Yahoo + montant en €). Exemples : CW8.PA (ETF monde), AAPL, MC.PA, BTC-USD, GOLD.PA (or), XGLE.DE (obligations).</p>
    <div id="pfRows">${PF.map(([s, a], i) => `<div class="pf-row"><input list="symList" value="${esc(s)}" data-pf="${i}" data-k="0" placeholder="Symbole"><input type="number" value="${a}" data-pf="${i}" data-k="1" placeholder="Montant €"><button data-pfdel="${i}" title="Supprimer">✕</button></div>`).join("")}</div>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn ghost small" id="pfAdd">+ Ajouter une ligne</button><button class="btn small" id="pfRun">Analyser le risque</button></div></div>`;
  $("#proBody").innerHTML = `<div class="report">${editor}<div id="riskOut">${run ? loading("Calcul des corrélations, scénarios et stress tests…") : ""}</div></div>`;
  $$("[data-pf]").forEach(el => el.addEventListener("input", () => { PF[+el.dataset.pf][+el.dataset.k] = el.dataset.k === "0" ? el.value.toUpperCase() : +el.value; store.set("ip_pf", PF); }));
  $$("[data-pfdel]").forEach(el => el.onclick = () => { PF.splice(+el.dataset.pfdel, 1); store.set("ip_pf", PF); proRisk(); });
  $("#pfAdd").onclick = () => { PF.push(["", 0]); proRisk(); };
  $("#pfRun").onclick = () => proRisk(true);
  if (!run && !PRO.lastRisk) return;
  const q = PF.filter(([s, a]) => s && a > 0).map(([s, a]) => `${s}:${a}`).join(",");
  let d; try { d = await api("/api/risk?pos=" + encodeURIComponent(q)); PRO.lastRisk = true; } catch (e) { $("#riskOut").innerHTML = errBox(e); return; }
  const tot = d.total, eur = v => eur0(v);
  const heat = v => v == null ? "#ffffff08" : v > .7 ? "#ea394366" : v > .4 ? "#f5a52455" : v > .1 ? "#f5a52422" : v < -.2 ? "#16c78444" : "#16c78418";
  const bars = (arr) => arr.map(x => `<div class="bar-row"><span>${esc(x.name)}</span><div class="b"><i style="width:${x.weight * 100}%"></i></div><b>${(x.weight * 100).toFixed(0)} %</b></div>`).join("");
  const top = d.sectors[0], maxLine = d.lines.reduce((a, b) => a.weight > b.weight ? a : b);
  const pairs = []; d.symbols.forEach((a, i) => d.symbols.forEach((b, j) => { if (j > i && d.matrix[i][j] > .7) pairs.push([a, b, d.matrix[i][j]]); }));
  const hedges = [];
  if (top.weight > .4) hedges.push(`<b>Concentration sectorielle</b> : ${(top.weight * 100).toFixed(0)} % en ${esc(top.name)}. Diversifie avec un ETF monde (CW8) qui répartit le risque sur 1 500 entreprises.`);
  if (d.usdWeight > .5) hedges.push(`<b>Risque de change</b> : ${(d.usdWeight * 100).toFixed(0)} % en dollars. Utilise une version « couverte en EUR » (EUR hedged) d'ETF pour une partie de ces positions.`);
  if (d.cryptoWeight > PROFILES[S.profile].cryptoCap) hedges.push(`<b>Crypto trop lourde</b> : ${(d.cryptoWeight * 100).toFixed(0)} % (maximum conseillé pour ton profil : ${(PROFILES[S.profile].cryptoCap * 100).toFixed(0)} %). Sécurise une partie des gains.`);
  if (maxLine.weight > .25 && !/CW8|URTH|SPY|ESE|IWDA/.test(maxLine.symbol)) hedges.push(`<b>Position trop grosse</b> : ${esc(maxLine.symbol)} pèse ${(maxLine.weight * 100).toFixed(0)} %. Limite chaque action individuelle à 10-20 %.`);
  if (pairs.length) hedges.push(`<b>Positions qui bougent ensemble</b> : ${pairs.slice(0, 3).map(p => `${p[0]}/${p[1]} (${p[2].toFixed(2)})`).join(", ")}. Elles ne te diversifient pas vraiment.`);
  if (!d.lines.some(l => l.sector === "Or" || l.sector === "Obligations")) hedges.push(`<b>Aucune protection</b> : ajoute 5 à 10 % d'or (GOLD.PA) et/ou des obligations (XGLE.DE), qui résistent souvent mieux pendant les krachs.`);
  if (!hedges.length) hedges.push("Ton portefeuille est déjà bien équilibré. Rééquilibre-le une fois par an.");
  const cap = PROFILES[S.profile].cryptoCap;
  const target = d.lines.map(l => { let t = l.weight; if (l.sector === "Crypto") t = Math.min(t, cap * l.weight / Math.max(d.cryptoWeight, 1e-9)); else if (!/CW8|URTH|SPY|ESE|IWDA|GOLD|XGLE/.test(l.symbol)) t = Math.min(t, .2); return { ...l, target: t }; });
  const freed = 1 - target.reduce((a, l) => a + l.target, 0);
  const pdd = d.maxDD;
  $("#riskOut").innerHTML = `<div class="report">${repHead("Rapport de gestion des risques", "Évaluation du risque de ton portefeuille", `${d.lines.length} positions · ${eur(tot)} · ${d.days} jours de données communes`,
      verdictBox("Pire scénario estimé", eur(Math.min(...d.scenarios.map(s => s.impact)) * tot), Math.min(...d.scenarios.map(s => s.impact)) < -.3 ? "bad" : "mid", "en cas de " + esc(d.scenarios.reduce((a, b) => a.impact < b.impact ? a : b).name.toLowerCase())))}
    <div class="kpis">${kpi("Volatilité annuelle", P0(d.vol), "variations typiques sur un an")}${kpi("Perte max en 1 jour (95 %)", eur(d.var95 * tot), "VaR historique")}${kpi("Pire baisse sur 12 mois", P0(pdd), eur((pdd || 0) * tot))}${kpi("Part crypto", P0(d.cryptoWeight), "")}${kpi("Exposition dollar", P0(d.usdWeight), "risque de change")}</div>
    <div class="synth"><b>Synthèse :</b> ton portefeuille a une volatilité de <b>${P0(d.vol)}</b> par an. Lors d'une récession type, il pourrait perdre environ <b>${P0(-d.scenarios[0].impact)}</b> (${eur(d.scenarios[0].impact * tot)}). Principal risque : ${esc(top.name)} (${(top.weight * 100).toFixed(0)} %)${d.cryptoWeight > .15 ? `, et une part crypto élevée` : ""}.</div>
    <div class="two" style="margin:0">
      <div class="card"><h3>🔥 Carte de chaleur des corrélations</h3><p class="sub" style="font-size:12px;margin-bottom:8px">1 = bougent toujours ensemble · 0 = indépendants. <span class="down">Rouge</span> = peu de diversification.</p><div style="overflow-x:auto">
        <table class="mtx"><thead><tr><th></th>${d.symbols.map(s => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${d.symbols.map((a, i) => `<tr><th>${esc(a)}</th>${d.matrix[i].map(v => `<td style="background:${heat(v)}">${v == null ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h3>🧩 Concentration</h3><h4 style="font-size:12px;color:var(--muted);margin-bottom:4px">PAR SECTEUR</h4>${bars(d.sectors)}<h4 style="font-size:12px;color:var(--muted);margin:10px 0 4px">PAR DEVISE</h4>${bars(d.currencies)}<h4 style="font-size:12px;color:var(--muted);margin:10px 0 4px">PAR PAYS / MARCHÉ</h4>${bars(d.countries)}</div></div>
    <div class="card"><h3>📋 Risque ligne par ligne</h3><div style="overflow-x:auto"><table class="ptbl big"><thead><tr><th>Position</th><th>Poids</th><th>Volatilité</th><th>Secteur</th><th>Sensibilité aux taux</th><th>Liquidité</th><th>Stress récession</th></tr></thead><tbody>
      ${d.lines.map(l => `<tr><td><b>${esc(l.symbol)}</b> <small style="color:var(--muted)">${esc((l.name || "").slice(0, 22))}</small></td><td>${P0(l.weight)}</td><td style="background:${l.vol > .6 ? "#ea394333" : l.vol > .3 ? "#f5a52422" : "#16c78418"}">${P0(l.vol)}</td><td>${esc(l.sector)}</td><td>${esc(l.rateSens)}</td><td>${l.liquidity}</td><td class="${l.stress < 0 ? "down" : "up"}">${eur(l.stress * l.amount)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="card"><h3>🌪️ Scénarios extrêmes</h3><table class="ptbl big"><thead><tr><th>Scénario</th><th>Probabilité (ordre de grandeur)</th><th>Impact</th><th>En euros</th></tr></thead><tbody>
      ${d.scenarios.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.proba)}</td><td class="${s.impact < 0 ? "down" : "up"}">${P0(s.impact)}</td><td class="${s.impact < 0 ? "down" : "up"}"><b>${eur(s.impact * tot)}</b></td></tr>`).join("")}</tbody></table></div>
    <div class="two" style="margin:0">
      <div class="card"><h3>🛡️ Stratégies de couverture</h3><ul class="rules">${hedges.slice(0, 4).map(h => `<li>👉 ${h}</li>`).join("")}</ul></div>
      <div class="card"><h3>⚖️ Rééquilibrage suggéré</h3><table class="ptbl big"><thead><tr><th>Position</th><th>Actuel</th><th>Cible</th><th>Action</th></tr></thead><tbody>
        ${target.map(l => { const diff = (l.target - l.weight) * tot; return `<tr><td>${esc(l.symbol)}</td><td>${P0(l.weight)}</td><td>${P0(l.target)}</td><td class="${diff < -1 ? "down" : ""}">${diff < -1 ? "Vendre " + eur(-diff) : "Garder"}</td></tr>`; }).join("")}
        ${freed > .005 ? `<tr><td><b>ETF Monde (CW8)</b></td><td>—</td><td>+${P0(freed)}</td><td class="up">Acheter ${eur(freed * tot)}</td></tr>` : ""}</tbody></table></div></div></div>`;
}

/* =============== 4. RESULTATS (JPMorgan) =============== */
const SECTOR_KPI = {
  Technology: "croissance du cloud et de l'IA, marge brute, prévisions du trimestre suivant", "Communication Services": "revenus publicitaires, nombre d'utilisateurs, dépenses en IA",
  "Consumer Cyclical": "ventes à magasins comparables, marges, demande en Chine et aux États-Unis", "Financial Services": "marge d'intérêt, provisions pour pertes, activité de marché",
  Healthcare: "ventes des médicaments phares, pipeline, essais cliniques", Energy: "prix du pétrole et du gaz, production, rachats d'actions",
  "Consumer Defensive": "volumes vs hausses de prix, marges, devises", Industrials: "carnet de commandes, livraisons, marge opérationnelle", "Basic Materials": "prix des matières premières, volumes",
};
async function proEarn() {
  $("#proCtrl").innerHTML = symPicker();
  $("#proBody").innerHTML = loading("Chargement des résultats de " + PRO.sym + "…");
  let x; try { x = await papi("/api/fundamentals?symbol=" + encodeURIComponent(PRO.sym)); } catch (e) { $("#proBody").innerHTML = errBox(e); return; }
  const cc = x.currency, qs = (x.quarters || []).slice(-4), re = x.reactions || [];
  const beats = qs.filter(q => q.actual != null && q.estimate != null && q.actual >= q.estimate).length;
  const moves = re.filter(v => v != null).map(Math.abs), avgMove = moves.length ? moves.reduce((a, b) => a + b) / moves.length : null;
  const nq = (x.trend || []).find(t => t.period === "0q"), ny = (x.trend || []).find(t => t.period === "0y"), ny1 = (x.trend || []).find(t => t.period === "+1y");
  const days = x.nextEarnings ? Math.round((x.nextEarnings * 1000 - Date.now()) / 864e5) : null;
  const t = S.stocks.find(s => s.symbol === x.symbol) || {};
  const up = x.price > (t.sma200 || 0), hot = (t.rsi || 50) > 68;
  let reco, kind;
  if (qs.length && beats >= 3 && up && !hot) { reco = "Acheter avant (risque modéré)"; kind = "good"; }
  else if (qs.length && beats <= 1) { reco = "Éviter avant la publication"; kind = "bad"; }
  else { reco = "Attendre la publication"; kind = "mid"; }
  const bullMv = avgMove ? avgMove * 1.1 : .05, bearMv = avgMove ? avgMove * 1.3 : .07;
  $("#proBody").innerHTML = `<div class="report">${repHead("Note de recherche pré-résultats", esc(x.name), `${esc(x.symbol)} · ${esc(x.sector || "")} · cours ${cur(x.price, cc)}`,
      verdictBox("Recommandation", reco, kind, x.nextEarnings ? `Prochains résultats : ${new Date(x.nextEarnings * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}${days != null && days >= 0 ? ` (dans ${days} j)` : ""}` : "Date de publication non communiquée"))}
    <div class="synth"><b>Résumé :</b> ${qs.length ? `l'entreprise a battu les attentes de bénéfice <b>${beats} fois sur ${qs.length}</b> lors des derniers trimestres.` : "pas d'historique trimestriel détaillé disponible pour ce titre (fréquent pour les sociétés européennes qui publient semestriellement) : voir les résultats annuels ci-dessous."}
      ${avgMove != null ? ` Le cours a bougé en moyenne de <b>±${(avgMove * 100).toFixed(1)} %</b> le jour des résultats : c'est le mouvement à anticiper.` : ""}
      ${nq?.eps ? ` Le consensus attend un bénéfice par action de <b>${N1(nq.eps, 2)}</b> ce trimestre${nq.revenue ? ` et un chiffre d'affaires de ${bigC(nq.revenue, cc)}` : ""}.` : ""}
      Tendance boursière ${up ? "positive (au-dessus de la moyenne 200 jours)" : "négative (sous la moyenne 200 jours)"}${hot ? ", RSI en surchauffe" : ""}.</div>
    ${qs.length ? `<div class="card"><h3>📊 Les 4 derniers trimestres : publié vs attendu</h3><table class="ptbl big"><thead><tr><th>Trimestre</th><th>Publié le</th><th>BPA réel</th><th>BPA attendu</th><th>Surprise</th><th>Chiffre d'affaires</th><th>Réaction du cours</th></tr></thead><tbody>
      ${qs.map((q, i) => { const ri = re[(x.quarters.length - qs.length) + i]; return `<tr><td>${esc(q.label)}</td><td>${q.reported ? new Date(q.reported * 1000).toLocaleDateString("fr-FR") : "—"}</td><td><b>${N1(q.actual, 2)}</b></td><td>${N1(q.estimate, 2)}</td><td>${q.surprise != null ? `<span class="${q.surprise >= 0 ? "up" : "down"}">${q.surprise >= 0 ? "✅ +" : "❌ "}${N1(q.surprise)} %</span>` : "—"}</td><td>${bigC(q.revenue, cc)}</td><td>${P1(ri)}</td></tr>`; }).join("")}</tbody></table></div>` : ""}
    <div class="two" style="margin:0">
      <div class="card"><h3>🔭 Consensus des analystes</h3>
        ${[["Ce trimestre", nq], ["Année en cours", ny], ["Année prochaine", ny1]].filter(([, v]) => v).map(([l, v]) => `<div class="lv"><span>${l} · BPA (fourchette)</span><b>${N1(v.eps, 2)} <small style="color:var(--muted)">(${N1(v.epsLow, 2)} – ${N1(v.epsHigh, 2)})</small></b></div><div class="lv"><span>${l} · chiffre d'affaires</span><b>${bigC(v.revenue, cc)}${v.growth != null ? ` · croiss. ${P1(v.growth)}` : ""}</b></div>`).join("") || `<div class="empty">Pas de consensus disponible</div>`}
        <div class="lv"><span>Objectif de cours moyen (${x.analysts || "?"} analystes)</span><b>${cur(x.target, cc)} ${x.target ? P1(x.target / x.price - 1) : ""}</b></div>
        <div class="lv"><span>Recommandation des analystes</span><b>${esc({ strong_buy: "Achat fort", buy: "Achat", hold: "Conserver", underperform: "Sous-performance", sell: "Vente" }[x.reco] || x.reco || "—")}</b></div></div>
      <div class="card"><h3>🔎 Ce que les investisseurs vont surveiller</h3><p class="sub" style="line-height:1.6">${esc(SECTOR_KPI[x.sector] || "chiffre d'affaires, marges, prévisions")}.</p>
        <h4 style="margin:14px 0 6px;font-size:13px">Scénarios le jour des résultats</h4>
        <div class="lv"><span>🟢 Scénario haussier (résultats et prévisions au-dessus)</span><b class="up">≈ +${(bullMv * 100).toFixed(0)} % → ${cur(x.price * (1 + bullMv), cc)}</b></div>
        <div class="lv"><span>🔴 Scénario baissier (déception ou prévisions prudentes)</span><b class="down">≈ −${(bearMv * 100).toFixed(0)} % → ${cur(x.price * (1 - bearMv), cc)}</b></div>
        <p class="sub" style="font-size:12px;margin-top:8px">Mouvement anticipé estimé à partir des réactions passées (les données d'options ne sont pas disponibles gratuitement). Les baisses sont souvent plus violentes que les hausses.</p></div></div>
    ${(x.years || []).length ? `<div class="card"><h3>📜 Résultats annuels</h3><table class="ptbl big"><thead><tr><th>Année</th><th>Chiffre d'affaires</th><th>Résultat opérationnel</th><th>Résultat net</th></tr></thead><tbody>${x.years.map(y => `<tr><td>${y.year}</td><td>${bigC(y.revenue, cc)}</td><td>${bigC(y.operatingIncome, cc)}</td><td>${bigC(y.netIncome, cc)}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
}

/* =============== 5. PORTEFEUILLE SUR MESURE (BlackRock) =============== */
const PORT = store.get("ip_port", { age: 20, horizon: 10, goal: "Croissance", account: "PEA", initial: 500, monthly: 100 });
function proPort() {
  const f = (id, lab, v, type = "number", opts) => `<div class="field"><label>${lab}</label>${opts ? `<select data-port="${id}">${opts.map(o => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>` : `<input type="${type}" data-port="${id}" value="${v}" style="width:110px">`}</div>`;
  $("#proCtrl").innerHTML = f("age", "Âge", PORT.age) + f("horizon", "Horizon (ans)", PORT.horizon) + f("goal", "Objectif", PORT.goal, 0, ["Sécurité", "Croissance", "Revenus"]) + f("account", "Enveloppe", PORT.account, 0, ["PEA", "Assurance-vie", "CTO", "PER"]) + f("initial", "Capital de départ €", PORT.initial) + f("monthly", "Versement mensuel €", PORT.monthly) +
    `<div class="field"><label>Profil</label><select id="portProfile">${Object.entries(PROFILES).map(([k, p]) => `<option value="${k}" ${k === S.profile ? "selected" : ""}>${p.label}</option>`).join("")}</select></div>`;
  $$("[data-port]").forEach(el => el.onchange = () => { PORT[el.dataset.port] = el.tagName === "SELECT" ? el.value : +el.value; store.set("ip_port", PORT); proPort(); });
  $("#portProfile").onchange = e => { S.profile = e.target.value; $$("#profileSeg button").forEach(b => b.classList.toggle("on", b.dataset.p === S.profile)); proPort(); };
  const H = PORT.horizon, adj = { prudent: -20, equilibre: 0, dynamique: 10 }[S.profile];
  let eq = clampN(100 - PORT.age + (H >= 10 ? 10 : H < 3 ? -35 : H < 5 ? -15 : 0) + adj + (PORT.goal === "Sécurité" ? -20 : PORT.goal === "Revenus" ? -10 : 0), 15, 95);
  const crypto = H < 3 ? 0 : { prudent: 0, equilibre: 5, dynamique: 10 }[S.profile];
  const gold = PORT.goal === "Sécurité" ? 10 : 7;
  eq = Math.min(eq, 100 - crypto - gold - 3);
  const bonds = 100 - eq - crypto - gold;
  const pea = PORT.account === "PEA";
  const core = Math.round(eq * (S.profile === "dynamique" ? .65 : .8)), sat = eq - core;
  const lines = [
    ["Cœur", "Actions monde", core, pea ? "Amundi MSCI World (CW8) · PEA" : "iShares Core MSCI World (IWDA) ou CW8", "#7c5cff"],
    ...(S.profile === "dynamique" ? [["Satellite", "Croissance US / Nasdaq-100", Math.round(sat * .6), pea ? "Amundi PEA Nasdaq-100 (PUST)" : "Invesco EQQQ Nasdaq-100 UCITS", "#22d3ee"], ["Satellite", "Pays émergents", sat - Math.round(sat * .6), "Amundi PEA Emergent (PAEEM)", "#a3e635"]]
      : [["Satellite", PORT.goal === "Revenus" ? "Actions à dividendes" : "Pays émergents", sat, PORT.goal === "Revenus" ? "voir module Dividendes" : "Amundi PEA Emergent (PAEEM)", "#a3e635"]]),
    ["Diversifiant", "Obligations", bonds, pea ? "hors PEA → assurance-vie (fonds euros) ou CTO : Xtrackers Eurozone Gov Bond (XGLE)" : PORT.account === "Assurance-vie" ? "Fonds euros + ETF obligataire" : "Xtrackers Eurozone Gov Bond (XGLE)", "#60a5fa"],
    ["Diversifiant", "Or", gold, pea ? "hors PEA → CTO : Amundi Physical Gold (GOLD)" : "Amundi Physical Gold ETC (GOLD)", "#f5c524"],
    ...(crypto ? [["Satellite", "Crypto (Bitcoin / Ethereum)", crypto, "plateforme régulée (enregistrée PSAN/MiCA)", "#f5a524"]] : []),
  ].filter(l => l[2] > 0);
  const ER = { "Actions monde": [5, 9], "Croissance US / Nasdaq-100": [5, 12], "Pays émergents": [3, 9], "Actions à dividendes": [4, 8], Obligations: [1, 4], Or: [2, 7], "Crypto (Bitcoin / Ethereum)": [-20, 40] };
  const LOSS = { "Actions monde": -35, "Croissance US / Nasdaq-100": -45, "Pays émergents": -40, "Actions à dividendes": -30, Obligations: -12, Or: -15, "Crypto (Bitcoin / Ethereum)": -75 };
  const lo = lines.reduce((a, l) => a + l[2] / 100 * ER[l[1]][0], 0), hi = lines.reduce((a, l) => a + l[2] / 100 * ER[l[1]][1], 0);
  const worst = lines.reduce((a, l) => a + l[2] / 100 * LOSS[l[1]], 0);
  const fv = r => { let v = PORT.initial; for (let m = 0; m < H * 12; m++) v = v * (1 + r / 1200) + PORT.monthly; return v; };
  const TAX = { PEA: "Après 5 ans, les gains ne supportent que les prélèvements sociaux (17,2 %). Plafond 150 000 € de versements. Seuls les ETF et actions européens sont éligibles : or et obligations se mettent ailleurs.", "Assurance-vie": "Après 8 ans, abattement annuel de 4 600 € de gains (9 200 € pour un couple). Idéal pour la poche obligations (fonds euros) et la transmission.", CTO: "Gains taxés à 30 % (flat tax) à chaque vente. Aucune restriction d'actifs. À utiliser en complément du PEA.", PER: "Versements déductibles du revenu imposable, bloqués jusqu'à la retraite. Peu utile si tu n'es pas encore imposable (étudiant) : privilégie PEA et assurance-vie." };
  $("#proBody").innerHTML = `<div class="report">${repHead("Politique d'investissement", "Ton portefeuille sur mesure", `${PORT.age} ans · horizon ${H} ans · objectif ${PORT.goal.toLowerCase()} · ${PORT.account} · profil ${PROFILES[S.profile].label.toLowerCase()}`,
      verdictBox("Allocation", `${eq} % actions`, eq > 70 ? "good" : "mid", `${bonds} % obligations · ${gold} % or${crypto ? ` · ${crypto} % crypto` : ""}`))}
    <div class="two" style="margin:0">
      <div class="card"><h3>🥧 Allocation d'actifs</h3><div class="alloc"><div class="donut" style="width:170px;height:170px"><canvas id="portChart"></canvas></div><div class="alloc-list">
        ${lines.map(l => `<div class="split-row"><i style="background:${l[4]}"></i><span>${l[1]} <span class="tag" style="background:#ffffff10;color:var(--muted)">${l[0]}</span><small>${esc(l[3])}</small></span><b>${l[2]} %</b></div>`).join("")}</div></div></div>
      <div class="card"><h3>📐 Attentes réalistes</h3>
        <div class="lv"><span>Rendement annuel attendu (fourchette)</span><b>${lo.toFixed(1)} % – ${hi.toFixed(1)} %</b></div>
        <div class="lv"><span>Perte possible une mauvaise année</span><b class="down">${worst.toFixed(0)} % (${eur0(worst / 100 * (PORT.initial + PORT.monthly * 12))} sur 1 an de versements)</b></div>
        <div class="lv"><span>Capital dans ${H} ans (versé : ${eur0(PORT.initial + PORT.monthly * 12 * H)})</span><b>${eur0(fv(lo))} – <span class="up">${eur0(fv(hi))}</span></b></div>
        <div class="lv"><span>Indice de référence</span><b>${eq >= 80 ? "MSCI World" : `${eq} % MSCI World / ${100 - eq} % obligations`}</b></div>
        <h4 style="margin:14px 0 6px;font-size:13px">📅 Plan d'investissement progressif (DCA)</h4>
        ${lines.map(l => `<div class="lv"><span>${l[1]}</span><b>${eur0(PORT.monthly * l[2] / 100)} / mois</b></div>`).join("")}</div></div>
    <div class="two" style="margin:0">
      <div class="card"><h3>🔁 Rééquilibrage</h3><ul class="rules"><li>📆 <b>Une fois par an</b> (par exemple chaque janvier), remets chaque poche à sa cible.</li><li>🚨 <b>Déclencheur</b> : si une poche s'écarte de plus de 5 points de sa cible (ex. actions à ${eq + 5} %), rééquilibre sans attendre.</li><li>💡 Rééquilibre de préférence <b>avec tes nouveaux versements</b> (tu achètes ce qui est en retard) : pas de vente, pas d'impôt.</li><li>🎂 Tous les 5 ans, baisse les actions d'environ 5 points en vieillissant ou à l'approche de ton objectif.</li></ul></div>
      <div class="card"><h3>🧾 Optimisation fiscale (${esc(PORT.account)})</h3><p class="sub" style="line-height:1.7">${TAX[PORT.account]}</p><p class="sub" style="font-size:12px;margin-top:8px">Règles fiscales françaises générales : vérifie-les sur impots.gouv.fr ou auprès d'un conseiller.</p></div></div>
    <div class="ips"><h3>📄 Ma politique d'investissement (1 page)</h3>
      <table><tr><td><b>Objectif</b></td><td>${PORT.goal} sur ${H} ans, en investissant ${eur0(PORT.monthly)} par mois</td></tr>
      <tr><td><b>Allocation cible</b></td><td>${lines.map(l => `${l[1]} ${l[2]} %`).join(" · ")}</td></tr>
      <tr><td><b>Enveloppe</b></td><td>${PORT.account}${pea ? " (+ assurance-vie ou CTO pour or et obligations)" : ""}</td></tr>
      <tr><td><b>Risque accepté</b></td><td>Je sais que je peux perdre ${Math.abs(worst).toFixed(0)} % une mauvaise année et je ne vendrai pas en panique.</td></tr>
      <tr><td><b>Règles</b></td><td>Versement automatique chaque mois · rééquilibrage annuel ou à ±5 points · jamais d'argent emprunté · fonds d'urgence de 3 mois à part</td></tr>
      <tr><td><b>Mesure de performance</b></td><td>Comparaison annuelle avec ${eq >= 80 ? "le MSCI World" : "un portefeuille " + eq + "/" + (100 - eq)}</td></tr>
      <tr><td><b>Revue</b></td><td>Une fois par an, ou en cas de changement de vie (premier emploi, déménagement…)</td></tr></table></div></div>`;
  mkChart("portChart", { type: "doughnut", data: { labels: lines.map(l => l[1]), datasets: [{ data: lines.map(l => l[2]), backgroundColor: lines.map(l => l[4]), borderWidth: 0 }] }, options: { cutout: "68%", plugins: { legend: { display: false } } } });
}

/* =============== 6. TECHNIQUE (Citadel) =============== */
async function proTech() {
  $("#proCtrl").innerHTML = symPicker("Action ou crypto", true);
  $("#proBody").innerHTML = loading("Analyse technique de " + PRO.sym + "…");
  let d; try { d = await papi("/api/technical?symbol=" + encodeURIComponent(PRO.sym)); } catch (e) { $("#proBody").innerHTML = errBox(e); return; }
  const cc = d.currency, c = v => cur(v, cc);
  const kind = d.score >= 3 ? "good" : d.score <= -3 ? "bad" : "mid";
  const tc = t => t === "Haussière" ? "up" : t === "Baissière" ? "down" : "";
  const pl = d.plan;
  $("#proBody").innerHTML = `<div class="report">${repHead("Bulletin d'analyse technique", esc(d.name), `${esc(d.symbol)} · cours ${c(d.price)} · plus haut / bas 1 an : ${c(d.high1y)} / ${c(d.low1y)}`,
      verdictBox("Signal", d.verdict, kind, `Score ${d.score > 0 ? "+" : ""}${d.score}/10 · confiance ${d.confidence} %`))}
    <div class="kpis">${["jour", "semaine", "mois"].map(k => `<div class="card kpi"><div class="l">Tendance ${k === "jour" ? "court terme" : k === "semaine" ? "moyen terme" : "long terme"}</div><div class="v ${tc(d.trend[k])}">${d.trend[k]}</div></div>`).join("")}
      ${kpi("RSI (14)", N1(d.rsi, 0), d.rsi > 70 ? "suracheté" : d.rsi < 30 ? "survendu" : "neutre")}${kpi("MACD", d.macd > d.macdSignal ? `<span class="up">Haussier</span>` : `<span class="down">Baissier</span>`, "vs ligne de signal")}</div>
    <div class="card"><h3>📈 Graphique (12 mois) : cours, moyennes mobiles, Bollinger, niveaux clés</h3><div class="m-chart" style="height:340px"><canvas id="techChart"></canvas></div>
      <div class="two" style="margin:10px 0 0"><div style="height:110px"><canvas id="rsiChart"></canvas></div><div style="height:110px"><canvas id="macdChart"></canvas></div></div></div>
    <div class="grid3">
      <div class="card"><h3>🎯 Plan de trade</h3><div class="lv"><span>Prix d'entrée idéal</span><b>${c(pl.entry)}</b></div><div class="lv"><span>Stop-loss</span><b class="down">${c(pl.stop)} (${P0(pl.stop / pl.entry - 1)})</b></div><div class="lv"><span>Objectif de gain</span><b class="up">${c(pl.target)} (${P1(pl.target / pl.entry - 1)})</b></div><div class="lv"><span>Ratio risque / rendement</span><b class="${pl.rr >= 2 ? "up" : pl.rr < 1 ? "down" : ""}">1 : ${N1(pl.rr)}</b></div>
        <p class="sub" style="font-size:12px;margin-top:8px">${d.score <= -3 ? "⚠️ Signal baissier : ce plan n'est valable que si la tendance se retourne. Mieux vaut attendre." : pl.rr >= 2 ? "Ratio favorable : le gain potentiel est au moins deux fois plus grand que le risque." : "Ratio moyen : attends un meilleur point d'entrée, plus proche du support."}</p></div>
      <div class="card"><h3>🧱 Supports & résistances</h3>${d.resistances.slice().reverse().map(r => `<div class="lv"><span>Résistance (${r.touches} contact${r.touches > 1 ? "s" : ""})</span><b class="down">${c(r.price)}</b></div>`).join("")}<div class="lv"><span><b>Cours actuel</b></span><b>${c(d.price)}</b></div>${d.supports.map(r => `<div class="lv"><span>Support (${r.touches} contact${r.touches > 1 ? "s" : ""})</span><b class="up">${c(r.price)}</b></div>`).join("")}</div>
      <div class="card"><h3>📏 Moyennes mobiles</h3>${["20", "50", "100", "200"].map(k => `<div class="lv"><span>MM ${k} jours</span><b class="${d.price > d.sma[k] ? "up" : "down"}">${c(d.sma[k])} ${d.price > d.sma[k] ? "▲" : "▼"}</b></div>`).join("")}<div class="lv"><span>Bandes de Bollinger</span><b>${c(d.bbLower)} – ${c(d.bbUpper)}</b></div></div>
      <div class="card"><h3>🌀 Retracements de Fibonacci (1 an)</h3>${Object.entries(d.fib).map(([k, v]) => `<div class="lv"><span>${(k * 100).toFixed(1)} %</span><b>${c(v)}${Math.abs(v / d.price - 1) < .02 ? " ◀ zone actuelle" : ""}</b></div>`).join("")}<p class="sub" style="font-size:12px;margin-top:6px">Les niveaux 38,2 % et 61,8 % sont des zones de rebond fréquentes.</p></div>
      <div class="card"><h3>📊 Volumes</h3><div class="lv"><span>Volume moyen 20 j vs 60 j</span><b>${P1(d.volume.avg20 / d.volume.avg60 - 1)}</b></div><div class="lv"><span>Volume des séances haussières</span><b class="up">${nf(0).format(d.volume.up)}</b></div><div class="lv"><span>Volume des séances baissières</span><b class="down">${nf(0).format(d.volume.down)}</b></div>
        <p class="sub" style="font-size:12px;margin-top:6px">${d.volume.up > d.volume.down * 1.2 ? "Les acheteurs dominent le volume : pression acheteuse." : d.volume.down > d.volume.up * 1.2 ? "Les vendeurs dominent le volume : pression vendeuse." : "Volume équilibré entre acheteurs et vendeurs."}</p></div>
      <div class="card"><h3>🔍 Figures & signaux</h3>${d.patterns.length ? d.patterns.map(p => `<div class="lv"><span>${esc(p)}</span></div>`).join("") : `<p class="sub">Aucune figure chartiste nette en ce moment.</p>`}
        <ul class="reasons" style="margin-top:10px">${d.why.map(([t, w]) => `<li>${t === "+" ? "✅" : t === "-" ? "⚠️" : "➖"} ${esc(w)}</li>`).join("")}</ul></div></div></div>`;
  const s = d.series, labels = s.t.map(t => new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
  const flat = (v, col, lab) => ({ label: lab, data: s.t.map(() => v), borderColor: col, borderWidth: 1, borderDash: [4, 4], pointRadius: 0 });
  mkChart("techChart", { type: "line", data: { labels, datasets: [
    { label: "Cours", data: s.c, borderColor: "#e8edf7", borderWidth: 1.8, pointRadius: 0 },
    { label: "MM50", data: s.s50, borderColor: "#22d3ee", borderWidth: 1.3, pointRadius: 0 },
    { label: "MM200", data: s.s200, borderColor: "#f5a524", borderWidth: 1.3, pointRadius: 0 },
    { label: "Bollinger haut", data: s.bbu, borderColor: "#7c5cff55", borderWidth: 1, pointRadius: 0 },
    { label: "Bollinger bas", data: s.bbl, borderColor: "#7c5cff55", borderWidth: 1, pointRadius: 0, fill: "-1", backgroundColor: "#7c5cff0d" },
    ...d.supports.slice(0, 2).map((x, i) => flat(x.price, "#16c784aa", "Support " + (i + 1))), ...d.resistances.slice(0, 2).map((x, i) => flat(x.price, "#ea3943aa", "Résistance " + (i + 1))),
    flat(pl.stop, "#ea394355", "Stop"), flat(pl.target, "#16c78455", "Objectif"),
  ] }, options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#8892a8", boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: x => ` ${x.dataset.label} : ${c(x.raw)}` } } }, scales: axisOpts() } });
  mkChart("rsiChart", { type: "line", data: { labels, datasets: [{ label: "RSI", data: s.rsi, borderColor: "#c084fc", borderWidth: 1.3, pointRadius: 0 }, { data: s.t.map(() => 70), borderColor: "#ea394366", borderDash: [3, 3], borderWidth: 1, pointRadius: 0 }, { data: s.t.map(() => 30), borderColor: "#16c78466", borderDash: [3, 3], borderWidth: 1, pointRadius: 0 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: "RSI (14)", color: "#8892a8", font: { size: 11 } } }, scales: { x: { display: false }, y: { min: 0, max: 100, position: "right", ticks: { color: "#5d6780", stepSize: 30 }, grid: { color: "#ffffff08" } } } } });
  mkChart("macdChart", { type: "bar", data: { labels, datasets: [{ type: "line", label: "MACD", data: s.macd, borderColor: "#22d3ee", borderWidth: 1.2, pointRadius: 0 }, { type: "line", label: "Signal", data: s.sig, borderColor: "#f5a524", borderWidth: 1.2, pointRadius: 0 }, { label: "Histogramme", data: s.macd.map((m, i) => m - s.sig[i]), backgroundColor: s.macd.map((m, i) => m - s.sig[i] >= 0 ? "#16c78477" : "#ea394377") }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: "MACD", color: "#8892a8", font: { size: 11 } } }, scales: { x: { display: false }, y: { position: "right", ticks: { color: "#5d6780", maxTicksLimit: 4 }, grid: { color: "#ffffff08" } } } } });
}

/* =============== 7. DIVIDENDES (Harvard) =============== */
const DIV = store.get("ip_div", { amount: 5000, goal: 50, account: "PEA", tax: "Non imposable" });
const PEA_OK = s => /\.(PA|DE|AS|MI|MC|BR|LS|HE|IR|VI)$/.test(s);
async function proDiv() {
  const f = (id, lab, v, opts) => `<div class="field"><label>${lab}</label>${opts ? `<select data-div="${id}">${opts.map(o => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>` : `<input type="number" data-div="${id}" value="${v}" style="width:120px">`}</div>`;
  $("#proCtrl").innerHTML = f("amount", "Montant investi €", DIV.amount) + f("goal", "Revenu mensuel visé €", DIV.goal) + f("account", "Enveloppe", DIV.account, ["PEA", "CTO", "Assurance-vie"]) + f("tax", "Tranche d'imposition", DIV.tax, ["Non imposable", "11 %", "30 %", "41 %"]);
  $$("[data-div]").forEach(el => el.onchange = () => { DIV[el.dataset.div] = el.tagName === "SELECT" ? el.value : +el.value; store.set("ip_div", DIV); proDiv(); });
  $("#proBody").innerHTML = loading("Analyse des dividendes sur 20 ans…");
  let d; try { d = await papi("/api/dividends"); } catch (e) { $("#proBody").innerHTML = errBox(e); return; }
  const pea = DIV.account === "PEA";
  let cand = d.filter(x => x.yield > .01 && x.yield < .1 && (!pea || PEA_OK(x.symbol)));
  cand.sort((a, b) => (b.safety * 2 + b.yield * 100) - (a.safety * 2 + a.yield * 100));
  const pick = [], perSector = {};
  for (const x of cand) { const k = x.sector || "?"; if ((perSector[k] || 0) >= 3) continue; perSector[k] = (perSector[k] || 0) + 1; pick.push(x); if (pick.length >= 15) break; }
  const w = 1 / Math.max(pick.length, 1), amt = DIV.amount * w;
  const yAvg = pick.reduce((a, x) => a + x.yield * w, 0), gross = DIV.amount * yAvg;
  const taxRate = DIV.account === "PEA" ? 0 : DIV.account === "Assurance-vie" ? 0 : .30;
  const net = gross * (1 - taxRate);
  const gs = pick.map(x => x.cagr5 ?? .03).sort((a, b) => a - b);
  const g = clampN(gs.length ? gs[Math.floor(gs.length / 2)] : .03, 0, .06); // croissance mediane des dividendes, plafonnee a 6 %
  const need = DIV.goal * 12 / Math.max(yAvg * (1 - taxRate), .001);
  let drip = DIV.amount, nodrip = DIV.amount; const proj = [];
  for (let y = 1; y <= 10; y++) { const inc = drip * yAvg * (1 - taxRate); drip = drip * (1 + g) + inc; nodrip *= 1 + g; proj.push({ y, drip, inc: drip * yAvg * (1 - taxRate), noInc: nodrip * yAvg * (1 - taxRate) }); }
  const sectors = Object.entries(pick.reduce((a, x) => (a[x.sector || "?"] = (a[x.sector || "?"] || 0) + w, a), {})).sort((a, b) => b[1] - a[1]).map(([name, weight]) => ({ name, weight }));
  const unsafe = d.filter(x => (x.payout > .9 && x.sector !== "Real Estate") || (x.cover != null && x.cover < 1.2));
  const ranked = [...pick].sort((a, b) => b.safety - a.safety);
  $("#proBody").innerHTML = `<div class="report">${repHead("Stratégie de revenus passifs", "Portefeuille de dividendes", `${pick.length} valeurs · ${eur0(DIV.amount)} · ${DIV.account}${pea ? " (actions européennes uniquement)" : ""}`,
      verdictBox("Revenu net estimé", `${eur0(net / 12)} / mois`, net / 12 >= DIV.goal ? "good" : "mid", `${eur0(net)} par an · rendement moyen ${P0(yAvg)}`))}
    <div class="synth"><b>Synthèse :</b> avec ${eur0(DIV.amount)}, ce portefeuille verserait environ <b>${eur0(gross)} brut par an</b> (${eur0(net)} net${taxRate ? " après flat tax de 30 %" : DIV.account === "PEA" ? ", sans impôt tant que l'argent reste dans le PEA" : ", sans impôt tant que l'argent reste dans le contrat"}). Pour atteindre ton objectif de <b>${eur0(DIV.goal)} par mois</b>, il faudrait environ <b>${eur0(need)}</b> investis. En réinvestissant les dividendes, le revenu annuel passerait à environ <b>${eur0(proj[9].inc)}</b> dans 10 ans (hypothèse : dividendes en hausse de ${P0(g)}/an).</div>
    <div class="card"><h3>💵 Les valeurs sélectionnées</h3><div style="overflow-x:auto"><table class="ptbl big"><thead><tr><th>Valeur</th><th>Secteur</th><th>Rendement</th><th>Sécurité</th><th>Années de hausse</th><th>Croissance 5 ans</th><th>Taux de distribution</th><th>Montant</th><th>Revenu / an</th></tr></thead><tbody>
      ${pick.map(x => `<tr style="cursor:pointer" data-prosym="${esc(x.symbol)}" data-prom="dcf"><td><b>${esc(x.symbol)}</b> <small style="color:var(--muted)">${esc((x.name || "").slice(0, 24))}</small></td><td>${esc(x.sector || "")}</td><td><b>${P0(x.yield)}</b></td><td><span class="badge" style="background:${x.safety >= 7 ? "#16c78422" : x.safety >= 5 ? "#f5a52422" : "#ea394322"};color:${x.safety >= 7 ? "var(--up)" : x.safety >= 5 ? "var(--warn)" : "var(--down)"}">${x.safety}/10</span></td><td>${x.streak} ans</td><td>${P1(x.cagr5)}</td><td class="${x.payout > .9 && x.sector !== "Real Estate" ? "down" : ""}">${P0(x.payout)}</td><td>${eur0(amt)}</td><td>${eur0(amt * x.yield)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="two" style="margin:0">
      <div class="card"><h3>📈 Projection sur 10 ans</h3><div style="height:230px"><canvas id="divChart"></canvas></div><p class="sub" style="font-size:12px;margin-top:6px">Les intérêts composés : réinvestir les dividendes fait grossir le revenu bien plus vite.</p></div>
      <div class="card"><h3>🧩 Répartition par secteur</h3>${sectors.map(x => `<div class="bar-row"><span>${esc(x.name)}</span><div class="b"><i style="width:${x.weight * 100}%"></i></div><b>${(x.weight * 100).toFixed(0)} %</b></div>`).join("")}
        <h4 style="margin:14px 0 6px;font-size:13px">🧾 Fiscalité (${esc(DIV.account)})</h4><p class="sub" style="font-size:12.5px;line-height:1.6">${DIV.account === "PEA" ? "Dividendes réinvestis dans le PEA sans impôt. Après 5 ans, seuls les prélèvements sociaux (17,2 %) s'appliquent aux retraits." : DIV.account === "CTO" ? `Flat tax de 30 % sur les dividendes${DIV.tax === "Non imposable" || DIV.tax === "11 %" ? ". Comme ta tranche est basse, l'option pour le barème progressif peut être plus avantageuse (abattement de 40 %)" : ""}. Les dividendes américains subissent en plus une retenue de 15 % à la source (récupérable via le crédit d'impôt).` : "Les dividendes restent dans le contrat sans impôt. Fiscalité avantageuse après 8 ans."}</p></div></div>
    <div class="two" style="margin:0">
      <div class="card"><h3>🏅 Du plus sûr au plus agressif</h3>${ranked.map((x, i) => `<div class="lv"><span>${i + 1}. ${esc(x.symbol)} · ${esc((x.name || "").slice(0, 26))}</span><b>${x.safety}/10 · ${P0(x.yield)}</b></div>`).join("")}</div>
      <div class="card"><h3>🚩 Dividendes non soutenables (à éviter)</h3>${unsafe.length ? unsafe.map(x => `<div class="lv"><span>${esc(x.symbol)} · ${esc((x.name || "").slice(0, 26))}</span><b class="down">${x.payout > .9 && x.sector !== "Real Estate" ? `distribue ${P0(x.payout)} des bénéfices` : "cash-flow trop juste"}</b></div>`).join("") : `<p class="sub">Aucune valeur à risque détectée dans l'univers analysé.</p>`}
        <p class="sub" style="font-size:12px;margin-top:8px">Les foncières (immobilier, ex. Realty Income) ont souvent un taux de distribution supérieur à 100 % des bénéfices comptables : c'est normal pour elles, on les juge sur leur cash-flow. Un taux de distribution au-dessus de 90 % veut dire que l'entreprise verse presque tout (ou plus) de ce qu'elle gagne : le dividende risque d'être coupé.</p></div></div></div>`;
  mkChart("divChart", { type: "bar", data: { labels: proj.map(p => "An " + p.y), datasets: [{ label: "Revenu annuel (réinvesti)", data: proj.map(p => p.inc), backgroundColor: "#7c5cffcc" }, { label: "Revenu annuel (non réinvesti)", data: proj.map(p => p.noInc), backgroundColor: "#22d3ee66" }] },
    options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: "#8892a8", boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: x => ` ${x.dataset.label} : ${eur0(x.raw)}` } } }, scales: axisOpts(v => eur0(v)) } });
}

/* =============== 8. ETF & TOP ACTIFS (vidéos) =============== */
const CLAIMS = { SCHG: 18, QQQ: 20, VGT: 23, SOXX: 30, SMH: 30, SPY: 10, "GOLD.PA": 7.5, "XGLE.DE": 4.5, "CW8.PA": 10 };
const UCITS = { SCHG: "Pas d'équivalent exact · iShares MSCI USA Quality ou S&P 500 Growth (IUSG)", QQQ: "Invesco EQQQ Nasdaq-100 UCITS · Amundi PEA Nasdaq-100 (PUST, éligible PEA)", VGT: "iShares S&P 500 Information Technology (IUIT)", SOXX: "iShares MSCI Global Semiconductors (SEMI)", SMH: "VanEck Semiconductor UCITS (SMH / VVSM)", SPY: "Amundi PEA S&P 500 (ESE, éligible PEA)" };
async function proEtf() {
  $("#proCtrl").innerHTML = "";
  $("#proBody").innerHTML = loading("Comparaison des ETF sur 10 ans…");
  let d; try { d = await papi("/api/etfs"); } catch (e) { $("#proBody").innerHTML = errBox(e); return; }
  const by = Object.fromEntries(d.map(x => [x.symbol, x]));
  const aggr = ["SPY", "SCHG", "QQQ", "VGT", "SOXX", "SMH"].map(s => by[s]).filter(Boolean);
  const top3 = [["Actions / ETF", "SPY", "≈ 10 %/an, rentable sur le long terme"], ["Or", "GOLD.PA", "≈ 7-8 %/an, protège contre l'inflation"], ["Obligations", "XGLE.DE", "≈ 3-6 %/an, faible risque, plus stable"]];
  const cols = { SPY: "#8892a8", SCHG: "#60a5fa", QQQ: "#22d3ee", VGT: "#7c5cff", SOXX: "#ec4899", SMH: "#f5a524", "CW8.PA": "#a3e635", "GOLD.PA": "#f5c524", "XGLE.DE": "#94a3b8" };
  $("#proBody").innerHTML = `<div class="report">${repHead("Vérification des vidéos", "Les affirmations des vidéos, confrontées aux vraies données", "Performances réelles sur 10 ans (ou depuis la création), dividendes réinvestis non inclus")}
    <div class="card"><h3>🥇 Vidéo « Top 3 des actifs »</h3><div class="grid3">${top3.map(([n, s, claim]) => { const x = by[s]; return x ? `<div class="pick-card"><h4>${n}</h4><div class="meta">${esc(x.name)} (${s})</div>
      <div class="lv"><span>La vidéo dit</span><b>${claim.split(",")[0]}</b></div><div class="lv"><span>Réalité (${x.years} ans)</span><b class="${x.cagr >= 0 ? "up" : "down"}">${(x.cagr * 100).toFixed(1)} %/an</b></div>
      <div class="lv"><span>Pire baisse</span><b class="down">${(x.maxDD * 100).toFixed(0)} %</b></div><div class="lv"><span>Volatilité</span><b>${(x.vol * 100).toFixed(0)} %/an</b></div></div>` : ""; }).join("")}</div>
      <p class="sub" style="font-size:12.5px;line-height:1.6;margin-top:10px">✅ La vidéo a raison sur l'idée : actions = moteur de croissance, or = protection, obligations = stabilité. ⚠️ Mais les chiffres varient beaucoup selon la période : de 2016 à 2026, les obligations de la zone euro ont <b>perdu de l'argent</b> à cause de la forte remontée des taux en 2022, tandis que l'or a fait mieux que prévu. Rien n'est garanti, d'où l'intérêt de combiner les trois.</p></div>
    <div class="card"><h3>🚀 Vidéo « 5 ETF qui surpassent le S&P 500 (version agressive) »</h3><div style="height:300px"><canvas id="etfChart"></canvas></div>
      <div style="overflow-x:auto;margin-top:12px"><table class="ptbl big"><thead><tr><th>ETF</th><th>La vidéo dit</th><th>Réalité /an</th><th>10 000 € devenus</th><th>Volatilité</th><th>Pire baisse</th><th>Pire année</th><th>Équivalent achetable en Europe</th></tr></thead><tbody>
      ${aggr.map(x => `<tr><td><b>${x.symbol}</b> <small style="color:var(--muted)">${esc(x.name)}</small></td><td>≈ ${CLAIMS[x.symbol]} %</td><td class="${x.cagr * 100 >= CLAIMS[x.symbol] - 2 ? "up" : "down"}"><b>${(x.cagr * 100).toFixed(1)} %</b></td><td>${eur0(x.growth10k)}</td><td>${(x.vol * 100).toFixed(0)} %</td><td class="down">${(x.maxDD * 100).toFixed(0)} %</td><td class="down">${(x.worst12 * 100).toFixed(0)} %</td><td style="white-space:normal;min-width:220px;font-size:12px">${esc(UCITS[x.symbol] || "")}</td></tr>`).join("")}</tbody></table></div>
      <div class="synth" style="margin-top:12px"><b>Ce qu'il faut retenir :</b> oui, ces ETF ont battu le S&P 500 ces 10 dernières années, surtout les semi-conducteurs (SOXX, SMH), portés par l'IA. Mais : <br>• ils sont <b>beaucoup plus risqués</b> : jusqu'à ${(Math.min(...aggr.map(x => x.maxDD)) * 100).toFixed(0)} % de baisse en route ; <br>• ils sont <b>concentrés</b> (≈ 30 entreprises pour les semi-conducteurs) : si le secteur ralentit, ils peuvent sous-performer pendant des années, comme le Nasdaq de 2000 à 2015 ; <br>• les ETF américains (QQQ, SCHG, VGT, SOXX, SMH) <b>ne sont généralement pas achetables</b> par un particulier européen (réglementation PRIIPs) : utilise les équivalents UCITS indiqués. <br>👉 Version raisonnable : garde un ETF monde comme cœur (70-80 %) et limite ces ETF « agressifs » à 10-20 % en satellite.</div></div></div>`;
  const all = d.filter(x => cols[x.symbol]);
  const ref = all.reduce((a, b) => a.series.length >= b.series.length ? a : b);
  mkChart("etfChart", { type: "line", data: { labels: ref.series.map(p => new Date(p[0] * 1000).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })),
    datasets: all.map(x => ({ label: x.symbol, data: Array(ref.series.length - x.series.length).fill(null).concat(x.series.map(p => 10000 * p[1])), borderColor: cols[x.symbol], borderWidth: x.symbol === "SPY" ? 2.5 : 1.6, pointRadius: 0 })) },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#8892a8", boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: x => ` ${x.dataset.label} : ${eur0(x.raw)}` } } }, scales: { ...axisOpts(v => eur0(v)), y: { type: "logarithmic", position: "right", grid: { color: "#ffffff08" }, ticks: { color: "#5d6780", callback: v => [10000, 20000, 50000, 100000, 200000].includes(v) ? eur0(v) : "" } } } } });
}

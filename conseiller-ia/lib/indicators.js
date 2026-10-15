// Indicateurs techniques calculés sur une série de prix de clôture (du plus ancien au plus récent).

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macd(values) {
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  if (slow.length < 9) return null;
  const offset = fast.length - slow.length;
  const line = slow.map((s, i) => fast[i + offset] - s);
  const signal = emaSeries(line, 9);
  const m = line[line.length - 1];
  const s = signal[signal.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

function pctChange(values, days) {
  if (values.length <= days) return null;
  const old = values[values.length - 1 - days];
  return ((values[values.length - 1] - old) / old) * 100;
}

// Volatilité annualisée (écart-type des rendements journaliers).
function volatility(values, days = 30, periodsPerYear = 365) {
  const slice = values.slice(-(days + 1));
  if (slice.length < 3) return null;
  const rets = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

function drawdownFromHigh(values) {
  const high = Math.max(...values);
  return ((values[values.length - 1] - high) / high) * 100;
}

export function computeIndicators(closes, { periodsPerYear = 365 } = {}) {
  const price = closes[closes.length - 1];
  return {
    price,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    change7d: pctChange(closes, 7),
    change30d: pctChange(closes, 30),
    change90d: pctChange(closes, 90),
    volatility30d: volatility(closes, 30, periodsPerYear),
    drawdownFromHigh: drawdownFromHigh(closes),
    points: closes.length,
  };
}

// Score technique de -100 (très baissier) à +100 (très haussier), avec les raisons.
export function technicalScore(ind) {
  let score = 0;
  const reasons = [];
  const add = (pts, txt) => {
    score += pts;
    reasons.push({ pts, txt });
  };

  if (ind.sma200 != null) {
    if (ind.price > ind.sma200) add(20, "Prix au-dessus de la moyenne 200 jours (tendance de fond haussière)");
    else add(-20, "Prix sous la moyenne 200 jours (tendance de fond baissière)");
  }
  if (ind.sma50 != null && ind.sma200 != null) {
    if (ind.sma50 > ind.sma200) add(15, "MM50 au-dessus de la MM200 (croisement haussier)");
    else add(-15, "MM50 sous la MM200 (croisement baissier)");
  }
  if (ind.sma20 != null && ind.sma50 != null) {
    if (ind.price > ind.sma20 && ind.sma20 > ind.sma50) add(10, "Momentum court terme positif (prix > MM20 > MM50)");
    else if (ind.price < ind.sma20 && ind.sma20 < ind.sma50) add(-10, "Momentum court terme négatif (prix < MM20 < MM50)");
  }
  if (ind.rsi14 != null) {
    if (ind.rsi14 > 75) add(-15, `RSI à ${ind.rsi14.toFixed(0)} : suracheté, risque de correction`);
    else if (ind.rsi14 < 25) add(10, `RSI à ${ind.rsi14.toFixed(0)} : survendu, rebond possible`);
    else if (ind.rsi14 >= 50) add(5, `RSI à ${ind.rsi14.toFixed(0)} : acheteurs légèrement dominants`);
    else add(-5, `RSI à ${ind.rsi14.toFixed(0)} : vendeurs légèrement dominants`);
  }
  if (ind.macd) {
    if (ind.macd.histogram > 0) add(10, "MACD au-dessus de son signal (élan haussier)");
    else add(-10, "MACD sous son signal (élan baissier)");
  }
  if (ind.change90d != null) {
    if (ind.change90d > 20) add(10, `+${ind.change90d.toFixed(0)} % sur 90 jours`);
    else if (ind.change90d < -20) add(-10, `${ind.change90d.toFixed(0)} % sur 90 jours`);
  }
  if (ind.volatility30d != null && ind.volatility30d > 100) {
    add(-10, `Volatilité très élevée (${ind.volatility30d.toFixed(0)} %/an) : actif très risqué`);
  }

  score = Math.max(-100, Math.min(100, score));
  let verdict = "CONSERVER";
  if (score >= 30) verdict = "ACHETER";
  else if (score <= -30) verdict = "VENDRE";
  return { score, verdict, reasons };
}

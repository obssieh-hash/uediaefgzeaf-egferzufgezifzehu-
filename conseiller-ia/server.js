import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeIndicators, technicalScore } from "./lib/indicators.js";
import { resolveCrypto, cryptoHistory, topCryptos, stockHistory } from "./lib/data.js";
import { analyzeWithClaude, aiEnabled } from "./lib/ai.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1); // derrière l'hébergeur (Render, Nginx…), pour connaître la vraie IP
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(here, "public")));

// Mot de passe optionnel : protège votre facture Claude si le site est public.
function checkPassword(req, res, next) {
  const pwd = process.env.APP_PASSWORD;
  if (pwd && req.get("x-app-password") !== pwd) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }
  next();
}

// Limite simple : 30 analyses IA par heure et par adresse IP.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (list.length >= 30) return res.status(429).json({ error: "Trop de demandes, réessayez dans une heure." });
  list.push(now);
  hits.set(req.ip, list);
  next();
}

app.get("/api/status", (req, res) => {
  res.json({
    ai: aiEnabled(),
    stocks: Boolean(process.env.TWELVEDATA_API_KEY),
    passwordRequired: Boolean(process.env.APP_PASSWORD),
  });
});

async function loadAsset(market, symbol) {
  if (market === "crypto") {
    const coin = await resolveCrypto(symbol);
    const h = await cryptoHistory(coin.id);
    const indicators = computeIndicators(h.closes, { periodsPerYear: 365 });
    return { name: coin.name, symbol: coin.symbol, currency: "USD", indicators, history: h };
  }
  if (market === "us") {
    const h = await stockHistory(symbol);
    const indicators = computeIndicators(h.closes, { periodsPerYear: 252 });
    return { name: h.name, symbol: symbol.toUpperCase(), currency: h.currency || "USD", indicators, history: h };
  }
  // BVMT : pas d'API publique gratuite, l'IA récupère le cours et l'actualité par recherche web.
  return { name: symbol.toUpperCase(), symbol: symbol.toUpperCase(), currency: "TND", indicators: null, history: null };
}

app.post("/api/analyze", checkPassword, rateLimit, async (req, res) => {
  const { market, symbol, question } = req.body || {};
  if (!["crypto", "us", "bvmt"].includes(market) || !symbol || typeof symbol !== "string" || symbol.length > 40) {
    return res.status(400).json({ error: "Marché ou symbole invalide." });
  }
  try {
    const asset = await loadAsset(market, symbol);
    const tech = asset.indicators ? technicalScore(asset.indicators) : null;

    let ai = null;
    let aiError = null;
    if (aiEnabled()) {
      try {
        ai = await analyzeWithClaude({
          market,
          name: asset.name,
          symbol: asset.symbol,
          indicators: asset.indicators,
          tech,
          question: typeof question === "string" ? question.slice(0, 500) : "",
        });
      } catch (e) {
        aiError = e.message;
      }
    } else if (market === "bvmt") {
      return res.status(400).json({ error: "La BVMT nécessite l'IA : ajoutez ANTHROPIC_API_KEY dans .env." });
    }

    res.json({
      market,
      name: asset.name,
      symbol: asset.symbol,
      currency: asset.currency,
      indicators: asset.indicators,
      technical: tech,
      chart: asset.history
        ? { dates: asset.history.dates.slice(-180), closes: asset.history.closes.slice(-180) }
        : null,
      ai,
      aiError,
      finalVerdict: ai?.verdict || tech?.verdict || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Classement des grosses cryptos par score technique (sans IA, rapide et gratuit).
app.get("/api/top-crypto", checkPassword, async (req, res) => {
  try {
    const list = await topCryptos(20);
    const results = [];
    const queue = [...list];
    async function worker() {
      while (queue.length) {
        const c = queue.shift();
        try {
          const h = await cryptoHistory(c.id);
          const ind = computeIndicators(h.closes);
          const t = technicalScore(ind);
          results.push({ id: c.id, name: c.name, symbol: c.symbol.toUpperCase(), image: c.image, price: c.current_price,
            change7d: c.price_change_percentage_7d_in_currency, change30d: c.price_change_percentage_30d_in_currency,
            rsi: ind.rsi14, score: t.score, verdict: t.verdict });
        } catch {
          results.push({ id: c.id, name: c.name, symbol: c.symbol.toUpperCase(), image: c.image, price: c.current_price,
            change7d: c.price_change_percentage_7d_in_currency, score: null, verdict: null });
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    results.sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Conseiller IA démarré sur http://localhost:${port}`));

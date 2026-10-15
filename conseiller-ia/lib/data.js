// Récupération des données de marché : CoinGecko (crypto) et Twelve Data (actions US).

const CG_BASE = "https://api.coingecko.com/api/v3";
const TD_BASE = "https://api.twelvedata.com";

const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function getJson(url, headers = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const res = await fetch(url, { headers: { accept: "application/json", ...headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Erreur API ${res.status} : ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

function cgHeaders() {
  return process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
}

// Trouve l'identifiant CoinGecko à partir d'un symbole ou d'un nom (ex : "btc", "solana").
export async function resolveCrypto(query) {
  const q = query.trim().toLowerCase();
  const data = await getJson(`${CG_BASE}/search?query=${encodeURIComponent(q)}`, cgHeaders());
  const coins = data.coins || [];
  if (!coins.length) throw new Error(`Crypto introuvable : ${query}`);
  // Préférer la correspondance exacte du symbole la mieux classée.
  const exact = coins.filter((c) => c.symbol.toLowerCase() === q || c.id === q || c.name.toLowerCase() === q);
  const pick = (exact.length ? exact : coins).sort(
    (a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9),
  )[0];
  return { id: pick.id, name: pick.name, symbol: pick.symbol.toUpperCase(), rank: pick.market_cap_rank };
}

export async function cryptoHistory(id, days = 365) {
  const data = await getJson(
    `${CG_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
    cgHeaders(),
  );
  return {
    closes: data.prices.map((p) => p[1]),
    dates: data.prices.map((p) => new Date(p[0]).toISOString().slice(0, 10)),
    volume24h: data.total_volumes.at(-1)?.[1] ?? null,
    marketCap: data.market_caps.at(-1)?.[1] ?? null,
  };
}

export async function topCryptos(limit = 25) {
  return getJson(
    `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&price_change_percentage=7d,30d`,
    cgHeaders(),
  );
}

export async function stockHistory(symbol) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY manquante : ajoutez-la dans le fichier .env pour les actions US.");
  const data = await getJson(
    `${TD_BASE}/time_series?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=1day&outputsize=300&apikey=${key}`,
  );
  if (data.status === "error") throw new Error(`Twelve Data : ${data.message}`);
  const values = [...data.values].reverse(); // l'API renvoie le plus récent en premier
  return {
    name: data.meta?.symbol ?? symbol.toUpperCase(),
    exchange: data.meta?.exchange,
    currency: data.meta?.currency,
    closes: values.map((v) => Number(v.close)),
    dates: values.map((v) => v.datetime),
  };
}

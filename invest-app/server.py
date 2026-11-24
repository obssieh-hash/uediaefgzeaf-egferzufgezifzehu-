#!/usr/bin/env python3
"""InvestPilot - serveur local (bibliotheque standard Python uniquement).

Lancer :  python3 server.py   puis ouvrir http://localhost:8765
Sources : CoinGecko (crypto), Yahoo Finance (bourse), alternative.me (Fear & Greed).
"""
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8765))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
UA = {"User-Agent": "Mozilla/5.0 (InvestPilot)", "Accept": "application/json"}

INDICES = [
    ("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^DJI", "Dow Jones"),
    ("^FCHI", "CAC 40"), ("^GDAXI", "DAX"), ("^N225", "Nikkei 225"),
    ("GC=F", "Or"), ("CL=F", "Pétrole WTI"), ("EURUSD=X", "EUR/USD"),
]
STOCKS = [
    # USA
    ("AAPL", "USA"), ("MSFT", "USA"), ("NVDA", "USA"), ("GOOGL", "USA"), ("AMZN", "USA"),
    ("META", "USA"), ("TSLA", "USA"), ("AVGO", "USA"), ("AMD", "USA"), ("NFLX", "USA"),
    ("JPM", "USA"), ("V", "USA"), ("MA", "USA"), ("BRK-B", "USA"), ("LLY", "USA"),
    ("COST", "USA"), ("WMT", "USA"), ("KO", "USA"), ("PEP", "USA"), ("XOM", "USA"),
    # France
    ("MC.PA", "France"), ("OR.PA", "France"), ("RMS.PA", "France"), ("TTE.PA", "France"),
    ("AIR.PA", "France"), ("SAN.PA", "France"), ("BNP.PA", "France"), ("SU.PA", "France"),
    ("AI.PA", "France"), ("SAF.PA", "France"),
    # Europe
    ("ASML.AS", "Europe"), ("SAP.DE", "Europe"), ("SIE.DE", "Europe"), ("NOVO-B.CO", "Europe"),
    # ETF
    ("SPY", "ETF"), ("QQQ", "ETF"), ("URTH", "ETF"), ("CW8.PA", "ETF"), ("GLD", "ETF"),
]
STABLES = {"usdt", "usdc", "dai", "fdusd", "tusd", "usde", "usds", "pyusd", "busd", "usd1",
           "steth", "wsteth", "wbtc", "weth", "wbeth", "cbbtc", "weeth", "bsc-usd", "susde", "usdtb", "rlusd", "usdf"}

_cache = {}
_lock = threading.Lock()
_key_locks = {}


def cached(key, ttl, fn):
    with _lock:
        klock = _key_locks.setdefault(key, threading.Lock())
    with klock:  # une seule requete reseau a la fois par cle
        now = time.time()
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        try:
            val = fn()
        except Exception:
            if hit:  # en cas d'erreur, on renvoie la derniere valeur connue
                return hit[1]
            raise
        _cache[key] = (now, val)
        return val


def get_json(url, timeout=15, retries=2):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries:  # limite de debit : on patiente
                time.sleep(3 * (attempt + 1))
                continue
            raise


# ---------------------------------------------------------------- indicateurs
def rsi(closes, n=14):
    if len(closes) <= n:
        return None
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    ag, al = gains / n, losses / n
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
    if al == 0:
        return 100.0
    return 100 - 100 / (1 + ag / al)


def sma(closes, n):
    return sum(closes[-n:]) / n if len(closes) >= n else None


def ret(closes, n):
    return closes[-1] / closes[-1 - n] - 1 if len(closes) > n and closes[-1 - n] else None


def volatility(closes, days_per_year=252):
    rs = [math.log(closes[i] / closes[i - 1]) for i in range(max(1, len(closes) - 90), len(closes))
          if closes[i - 1] > 0 and closes[i] > 0]
    if len(rs) < 10:
        return None
    m = sum(rs) / len(rs)
    var = sum((x - m) ** 2 for x in rs) / (len(rs) - 1)
    return math.sqrt(var) * math.sqrt(days_per_year)


def analyse(closes, crypto=False):
    p = closes[-1]
    s50, s200 = sma(closes, 50), sma(closes, 200)
    return {
        "price": p,
        "change1d": ret(closes, 1),
        "ret1m": ret(closes, 21 if not crypto else 30),
        "ret3m": ret(closes, 63 if not crypto else 90),
        "ret1y": closes[-1] / closes[0] - 1 if closes[0] else None,
        "sma50": s50, "sma200": s200,
        "rsi": rsi(closes),
        "vol": volatility(closes, 365 if crypto else 252),
        "fromHigh": p / max(closes) - 1,
        "spark": closes[-60:],
    }


# ---------------------------------------------------------------- sources
def yahoo_chart(symbol, rng="1y", interval="1d"):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}"
           f"?range={rng}&interval={interval}")
    d = get_json(url)["chart"]["result"][0]
    ts = d.get("timestamp") or []
    cl = d["indicators"]["quote"][0]["close"]
    pts = [(t, c) for t, c in zip(ts, cl) if c is not None]
    return d["meta"], pts


def yahoo_asset(symbol, region=None, name=None, crypto=False):
    meta, pts = yahoo_chart(symbol)
    closes = [c for _, c in pts]
    if len(closes) < 30:
        return None
    a = analyse(closes, crypto)
    if meta.get("regularMarketPrice"):
        a["price"] = meta["regularMarketPrice"]
    a.update({
        "symbol": symbol,
        "name": name or meta.get("shortName") or meta.get("longName") or symbol,
        "currency": meta.get("currency", ""),
        "region": region,
        "type": "crypto" if crypto else ("etf" if region == "ETF" else "stock"),
    })
    return a


def fetch_many(items, fn, workers=10):
    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(lambda it: _safe(fn, *it), items))
    return [r for r in res if r]


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # une action indisponible ne bloque pas le reste
        print("  ! erreur", args[0], "->", e)
        return None


def crypto_markets():
    url = ("https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc"
           "&per_page=60&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y")
    return get_json(url)


def api_crypto():
    return cached("crypto", 120, crypto_markets)


def api_stocks():
    return cached("stocks", 300, lambda: fetch_many(STOCKS, lambda s, r: yahoo_asset(s, r)))


def api_indices():
    return cached("indices", 300, lambda: fetch_many(INDICES, lambda s, n: yahoo_asset(s, "Indice", n)))


def api_global():
    def build():
        out = {}
        try:
            g = get_json("https://api.coingecko.com/api/v3/global")["data"]
            out.update({
                "mcap": g["total_market_cap"].get("eur"),
                "volume": g["total_volume"].get("eur"),
                "mcapChange": g.get("market_cap_change_percentage_24h_usd"),
                "btcDom": g["market_cap_percentage"].get("btc"),
                "ethDom": g["market_cap_percentage"].get("eth"),
            })
        except Exception as e:
            print("  ! global", e)
        try:
            f = get_json("https://api.alternative.me/fng/?limit=30")["data"]
            out["fng"] = [{"value": int(x["value"]), "label": x["value_classification"],
                           "ts": int(x["timestamp"])} for x in f]
        except Exception as e:
            print("  ! fng", e)
        return out
    return cached("global", 600, build)


FALLBACK_CRYPTO = [("BTC", "Bitcoin", "bitcoin"), ("ETH", "Ethereum", "ethereum"), ("XRP", "XRP", "ripple"),
                   ("BNB", "BNB", "binancecoin"), ("SOL", "Solana", "solana"), ("DOGE", "Dogecoin", "dogecoin"),
                   ("ADA", "Cardano", "cardano"), ("TRX", "TRON", "tron"), ("LINK", "Chainlink", "chainlink"),
                   ("AVAX", "Avalanche", "avalanche-2"), ("XLM", "Stellar", "stellar"), ("LTC", "Litecoin", "litecoin"),
                   ("DOT", "Polkadot", "polkadot"), ("BCH", "Bitcoin Cash", "bitcoin-cash")]


def api_crypto_analysis():
    def build():
        try:
            coins = [c for c in api_crypto() if c["symbol"].lower() not in STABLES][:20]
            items = [(c["symbol"].upper() + "-USD", c["name"], c["image"], c["id"]) for c in coins]
        except Exception as e:  # CoinGecko indisponible : liste de secours
            print("  ! coingecko indisponible, liste de secours :", e)
            items = [(s + "-USD", n, None, cid) for s, n, cid in FALLBACK_CRYPTO]

        def one(sym, name, img, cid):
            a = yahoo_asset(sym, "Crypto", name, crypto=True)
            if a:
                a.update({"image": img, "cgId": cid})
            return a
        return fetch_many(items, one)
    return cached("crypto_analysis", 300, build)


def api_analysis():
    return {"stocks": api_stocks(), "crypto": api_crypto_analysis(), "updated": int(time.time())}


def api_history(q):
    sym = q.get("symbol", [""])[0]
    rng = q.get("range", ["1y"])[0]
    if rng not in {"1mo", "3mo", "6mo", "1y", "5y"}:
        rng = "1y"
    if q.get("source", [""])[0] == "cg":
        days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "5y": 1825}[rng]
        d = cached(f"cg:{sym}:{rng}", 300, lambda: get_json(
            f"https://api.coingecko.com/api/v3/coins/{urllib.parse.quote(sym)}/market_chart?vs_currency=eur&days={days}"))
        return {"points": [[int(t / 1000), p] for t, p in d["prices"]], "currency": "EUR"}
    interval = "1wk" if rng == "5y" else "1d"
    meta, pts = cached(f"yh:{sym}:{rng}", 300, lambda: yahoo_chart(sym, rng, interval))
    return {"points": pts, "currency": meta.get("currency", "")}


ROUTES = {
    "/api/crypto": lambda q: api_crypto(),
    "/api/stocks": lambda q: api_stocks(),
    "/api/indices": lambda q: api_indices(),
    "/api/global": lambda q: api_global(),
    "/api/analysis": lambda q: api_analysis(),
    "/api/history": api_history,
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ROUTES:
            try:
                body = json.dumps(ROUTES[u.path](urllib.parse.parse_qs(u.query))).encode()
                code = 200
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode()
                code = 502
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            print("  ", args[0])


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"\n  InvestPilot est lancé  ->  {url}\n  (Ctrl+C pour arrêter)\n")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Au revoir !")

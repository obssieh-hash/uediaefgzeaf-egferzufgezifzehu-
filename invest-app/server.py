#!/usr/bin/env python3
"""InvestPilot - serveur local (bibliotheque standard Python uniquement).

Lancer :  python3 server.py   puis ouvrir http://localhost:8765
Sources : CoinGecko (crypto), Yahoo Finance (bourse), alternative.me (Fear & Greed).
"""
import gzip
import http.cookiejar
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
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
    ("SCHG", "ETF"), ("VGT", "ETF"), ("SOXX", "ETF"), ("SMH", "ETF"), ("GOLD.PA", "ETF"), ("XGLE.DE", "ETF"),
]
STABLES = {"usdt", "usdc", "dai", "fdusd", "tusd", "usde", "usds", "pyusd", "busd", "usd1",
           "steth", "wsteth", "wbtc", "weth", "wbeth", "cbbtc", "weeth", "bsc-usd", "susde", "usdtb", "rlusd", "usdf"}

_cache = {}
_lock = threading.Lock()
_key_locks = {}
_refreshing = set()


def _fetch_into_cache(key, fn):
    val = fn()
    with _lock:
        _cache[key] = (time.time(), val)
    return val


def _refresh_bg(key, fn):
    with _lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def run():
        try:
            with _key_locks[key]:
                _fetch_into_cache(key, fn)
        except Exception as e:
            print("  ! rafraichissement", key, "->", e)
        finally:
            with _lock:
                _refreshing.discard(key)
    threading.Thread(target=run, daemon=True).start()


def cached(key, ttl, fn):
    """Cache avec 'stale-while-revalidate' : si la donnee est perimee on la renvoie
    immediatement et on la met a jour en arriere-plan -> l'interface ne patiente jamais."""
    with _lock:
        klock = _key_locks.setdefault(key, threading.Lock())
        hit = _cache.get(key)
    if hit:
        if time.time() - hit[0] >= ttl:
            _refresh_bg(key, fn)
        return hit[1]
    with klock:  # premier chargement : une seule requete reseau a la fois par cle
        with _lock:
            hit = _cache.get(key)
        if hit:
            return hit[1]
        return _fetch_into_cache(key, fn)


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


def hl_asset(coin, name):
    """Historique journalier depuis Hyperliquid (cryptos absentes de Yahoo)."""
    end = int(time.time() * 1000)
    candles = hl({"type": "candleSnapshot", "req": {"coin": coin, "interval": "1d",
                                                     "startTime": end - 365 * 86400000, "endTime": end}})
    closes = [float(c["c"]) for c in candles]
    if len(closes) < 30:
        return None
    a = analyse(closes, True)
    a.update({"symbol": coin + "-USD", "name": name, "currency": "USD", "region": "Crypto", "type": "crypto"})
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


def crypto_markets(cur_="eur"):
    url = (f"https://api.coingecko.com/api/v3/coins/markets?vs_currency={cur_}&order=market_cap_desc"
           "&per_page=60&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y")
    return get_json(url)


def api_crypto(q=None):
    cur_ = (q or {}).get("cur", ["eur"])[0].lower()
    cur_ = cur_ if cur_ in ("eur", "usd") else "eur"
    return cached("crypto" if cur_ == "eur" else "crypto:usd", 120, lambda: crypto_markets(cur_))


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
                "mcapUsd": g["total_market_cap"].get("usd"),
                "volumeUsd": g["total_volume"].get("usd"),
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
            try:
                a = yahoo_asset(sym, "Crypto", name, crypto=True)
            except Exception:
                a = hl_asset(sym.replace("-USD", ""), name)
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
    if rng not in {"1mo", "3mo", "6mo", "1y", "5y", "10y"}:
        rng = "1y"
    if q.get("source", [""])[0] == "cg":
        vs = "usd" if q.get("cur", ["eur"])[0].lower() == "usd" else "eur"
        days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "5y": 1825, "10y": 3650}[rng]
        d = cached(f"cg:{sym}:{rng}:{vs}", 300, lambda: get_json(
            f"https://api.coingecko.com/api/v3/coins/{urllib.parse.quote(sym)}/market_chart?vs_currency={vs}&days={days}"))
        return {"points": [[int(t / 1000), p] for t, p in d["prices"]], "currency": vs.upper()}
    interval = {"5y": "1wk", "10y": "1mo"}.get(rng, "1d")
    meta, pts = cached(f"yh:{sym}:{rng}", 300, lambda: yahoo_chart(sym, rng, interval))
    return {"points": pts, "currency": meta.get("currency", "")}


# ================================================================ SUIVI DES BALEINES (Hyperliquid)
HL_INFO = "https://api.hyperliquid.xyz/info"
HL_LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
N_CANDIDATES = 45   # traders analyses
N_TRACKED = 25      # traders actifs affiches
N_FILLS = 15        # traders dont on lit l'historique de trades


def hl(payload, timeout=15):
    data = json.dumps(payload).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(HL_INFO, data=data, headers={**UA, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise


def f(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def leaderboard():
    """Selectionne les traders aux profits stables et reguliers parmi tout le classement."""
    print("  … telechargement du classement Hyperliquid (une fois toutes les 30 min)")
    rows = get_json(HL_LEADERBOARD, timeout=120)["leaderboardRows"]
    out = []
    for x in rows:
        av = f(x["accountValue"])
        if av < 100_000:
            continue
        w = {k: v for k, v in x["windowPerformances"]}
        d, wk, m, a = (w.get(k, {}) for k in ("day", "week", "month", "allTime"))
        mp, mr, wp, wr = f(m.get("pnl")), f(m.get("roi")), f(wk.get("pnl")), f(wk.get("roi"))
        ap, ar = f(a.get("pnl")), f(a.get("roi"))
        turnover = f(m.get("vlm")) / av
        # profits positifs sur la semaine, le mois et depuis le debut, ROI mensuel >= 3 %,
        # et pas de robots de market-making (volume demesure par rapport au capital)
        if mp <= 0 or ap <= 0 or wp < 0 or mr < 0.03 or turnover > 150:
            continue
        consistency = sum(f(p.get("pnl")) > 0 for p in (d, wk, m, a))
        score = (math.log10(ap + 1) + min(mr, 1.5) * 4 + min(ar, 5) * 0.5
                 + min(max(wr, 0), 0.5) * 3 + consistency * 0.5)
        out.append({
            "address": x["ethAddress"], "name": x.get("displayName"), "accountValue": av,
            "pnlDay": f(d.get("pnl")), "pnlWeek": wp, "pnlMonth": mp, "pnlAll": ap,
            "roiWeek": wr, "roiMonth": mr, "roiAll": ar, "consistency": consistency, "score": round(score, 2),
        })
    out.sort(key=lambda t: -t["score"])
    return out[:N_CANDIDATES]


def parse_positions(state, mids):
    pos = []
    for ap in state.get("assetPositions", []):
        p = ap.get("position", {})
        szi = f(p.get("szi"))
        if not szi:
            continue
        coin = p["coin"]
        entry = f(p.get("entryPx"))
        mark = f(mids.get(coin)) or entry
        pos.append({
            "coin": coin, "side": "LONG" if szi > 0 else "SHORT", "size": abs(szi),
            "value": abs(szi) * mark, "entry": entry, "mark": mark,
            "pnl": f(p.get("unrealizedPnl")), "roe": f(p.get("returnOnEquity")),
            "leverage": (p.get("leverage") or {}).get("value"),
            "liq": f(p.get("liquidationPx"), None), "margin": f(p.get("marginUsed")),
        })
    pos.sort(key=lambda x: -x["value"])
    return pos


def parse_orders(orders):
    """Take profit / stop loss poses par le trader (ordres declencheurs)."""
    out = {}
    for o in orders or []:
        if not o.get("isTrigger"):
            continue
        typ = o.get("orderType", "")
        kind = "tp" if "Take Profit" in typ else "sl" if "Stop" in typ else None
        if kind:
            out.setdefault(o["coin"], {}).setdefault(kind, []).append(f(o.get("triggerPx")))
    return out


def parse_fills(fills, since_ms):
    """Regroupe les executions par ordre -> liste de trades lisibles."""
    agg = {}
    for x in fills or []:
        if x.get("time", 0) < since_ms or x.get("coin", "").startswith("@"):
            continue
        k = (x.get("oid"), x.get("dir"))
        a = agg.setdefault(k, {"coin": x["coin"], "dir": x.get("dir", ""), "time": x["time"],
                               "sz": 0.0, "notional": 0.0, "closedPnl": 0.0})
        sz, px = f(x["sz"]), f(x["px"])
        a["sz"] += sz
        a["notional"] += sz * px
        a["closedPnl"] += f(x.get("closedPnl"))
        a["time"] = max(a["time"], x["time"])
    out = []
    for a in agg.values():
        a["px"] = a["notional"] / a["sz"] if a["sz"] else 0
        out.append(a)
    return out


def trader_state(addr, mids, with_orders=True):
    st = cached(f"hl:state:{addr}", 30, lambda: hl({"type": "clearinghouseState", "user": addr}))
    res = {"positions": parse_positions(st, mids),
           "equity": f(st.get("marginSummary", {}).get("accountValue"))}
    if with_orders and res["positions"]:
        try:
            orders = cached(f"hl:orders:{addr}", 120, lambda: hl({"type": "frontendOpenOrders", "user": addr}))
            res["tpsl"] = parse_orders(orders)
        except Exception as e:
            print("  ! ordres", addr[:10], e)
    return res


def build_consensus(traders):
    coins = {}
    for t in traders:
        for p in t["positions"]:
            c = coins.setdefault(p["coin"], {"coin": p["coin"], "mark": p["mark"], "nLong": 0, "nShort": 0,
                                             "longValue": 0.0, "shortValue": 0.0, "pnl": 0.0,
                                             "_le": 0.0, "_se": 0.0, "tp": [], "sl": [], "liq": [], "traders": []})
            side = "long" if p["side"] == "LONG" else "short"
            c["n" + side.capitalize()] += 1
            c[side + "Value"] += p["value"]
            c["_" + side[0] + "e"] += p["entry"] * p["value"]
            c["pnl"] += p["pnl"]
            orders = t.get("tpsl", {}).get(p["coin"], {})
            c["tp"] += [(side, x) for x in orders.get("tp", [])]
            c["sl"] += [(side, x) for x in orders.get("sl", [])]
            c["traders"].append({"rank": t["rank"], "side": p["side"], "value": p["value"], "entry": p["entry"]})
    out = []
    for c in coins.values():
        lv, sv = c["longValue"], c["shortValue"]
        c["bias"] = (lv - sv) / (lv + sv) if lv + sv else 0
        c["avgEntryLong"] = c.pop("_le") / lv if lv else None
        c["avgEntryShort"] = c.pop("_se") / sv if sv else None
        dom = "long" if c["bias"] >= 0 else "short"
        tps = sorted(x for s, x in c.pop("tp") if s == dom)
        sls = sorted(x for s, x in c.pop("sl") if s == dom)
        c["tpMedian"] = tps[len(tps) // 2] if tps else None
        c["slMedian"] = sls[len(sls) // 2] if sls else None
        c["nTp"], c["nSl"] = len(tps), len(sls)
        n = c["nLong"] + c["nShort"]
        b = c["bias"]
        if n >= 3 and b >= 0.5 and c["nLong"] > c["nShort"]:
            c["signal"] = "LONG fort"
        elif b >= 0.2 and c["nLong"] >= c["nShort"]:
            c["signal"] = "LONG"
        elif n >= 3 and b <= -0.5 and c["nShort"] > c["nLong"]:
            c["signal"] = "SHORT fort"
        elif b <= -0.2 and c["nShort"] >= c["nLong"]:
            c["signal"] = "SHORT"
        else:
            c["signal"] = "Partagé"
        c["total"] = lv + sv
        c["traders"].sort(key=lambda x: -x["value"])
        out.append(c)
    out.sort(key=lambda c: -(c["total"] * (1 + (c["nLong"] + c["nShort"]) / 5)))
    return out


def api_whales():
    def build():
        cands = cached("hl:leaderboard", 1800, leaderboard)
        mids = hl({"type": "allMids"})
        with ThreadPoolExecutor(10) as ex:
            states = list(ex.map(lambda t: _safe(trader_state, t["address"], mids), cands))
        traders = []
        for t, st in zip(cands, states):
            if st and st["positions"]:
                traders.append({**t, **st})
        traders = traders[:N_TRACKED]
        for i, t in enumerate(traders):
            t["rank"] = i + 1
            t["exposure"] = sum(p["value"] for p in t["positions"])
            t["upnl"] = sum(p["pnl"] for p in t["positions"])
        # derniers trades (72 h) des meilleurs traders
        since = int(time.time() * 1000) - 72 * 3600 * 1000
        def fills(t):
            fl = cached(f"hl:fills:{t['address']}", 120, lambda: hl({"type": "userFills", "user": t["address"]}))
            return [{**x, "rank": t["rank"], "address": t["address"]} for x in parse_fills(fl, since)]
        with ThreadPoolExecutor(8) as ex:
            feed = [x for lst in ex.map(lambda t: _safe(fills, t) or [], traders[:N_FILLS]) for x in lst]
        feed = sorted((x for x in feed if x["notional"] >= 10_000), key=lambda x: -x["time"])[:80]
        total_long = sum(p["value"] for t in traders for p in t["positions"] if p["side"] == "LONG")
        total_short = sum(p["value"] for t in traders for p in t["positions"] if p["side"] == "SHORT")
        return {
            "traders": traders, "consensus": build_consensus(traders), "feed": feed,
            "stats": {"analysed": len(cands), "active": len(traders),
                      "capital": sum(t["accountValue"] for t in traders),
                      "long": total_long, "short": total_short},
            "updated": int(time.time()),
        }
    return cached("whales", 30, build)


def api_whale(q):
    addr = q.get("address", [""])[0].strip().lower()
    if not (addr.startswith("0x") and len(addr) == 42 and all(c in "0123456789abcdef" for c in addr[2:])):
        raise ValueError("Adresse invalide (format 0x… sur 42 caractères)")
    mids = cached("hl:mids", 15, lambda: hl({"type": "allMids"}))
    st = trader_state(addr, mids)
    fl = cached(f"hl:fills:{addr}", 120, lambda: hl({"type": "userFills", "user": addr}))
    known = next((t for t in cached("hl:leaderboard", 1800, leaderboard) if t["address"] == addr), {})
    st.update({"address": addr, "stats": known,
               "feed": sorted(parse_fills(fl, int(time.time() * 1000) - 7 * 86400000), key=lambda x: -x["time"])[:30]})
    return st


# ================================================================ ACTUALITES + SENTIMENT
FEEDS = [
    ("Google Actu · Bourse", "https://news.google.com/rss/search?q=bourse+OR+%22CAC+40%22+OR+actions+when:2d&hl=fr&gl=FR&ceid=FR:fr", "bourse"),
    ("Google Actu · Crypto", "https://news.google.com/rss/search?q=bitcoin+OR+crypto+OR+ethereum+when:2d&hl=fr&gl=FR&ceid=FR:fr", "crypto"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "crypto"),
    ("Cointelegraph", "https://cointelegraph.com/rss", "crypto"),
    ("Decrypt", "https://decrypt.co/feed", "crypto"),
    ("Investing.com", "https://fr.investing.com/rss/news.rss", "bourse", 12),
]
POS = ("hausse", "bondit", "grimpe", "record", "rebond", "envol", "flambe", "progresse", "rallye", "optimis", "bénéfice",
       "surge", "soar", "rally", "jump", "gain", "climb", "bull", "record high", "all-time high", "approv", "adopt",
       "inflow", "upgrade", "beats", "rebound", "recover", "breakout", "accumul", "buy")
NEG = ("chute", "baisse", "plonge", "krach", "recul", "dégringol", "effondr", "inquiét", "crainte", "perte", "faillite",
       "plunge", "crash", "drop", "fall", "slump", "tumble", "bear", "sell-off", "selloff", "hack", "exploit", "lawsuit",
       "sues", "fraud", "outflow", "liquidat", "fear", "warning", "downgrade", "banned", "collapse", "loss")
POS_RE = re.compile(r"\b(" + "|".join(map(re.escape, POS)) + ")")
NEG_RE = re.compile(r"\b(" + "|".join(map(re.escape, NEG)) + ")")
ASSETS = {
    "BTC": ("bitcoin", "btc"), "ETH": ("ethereum", "ether ", "eth "), "SOL": ("solana",), "XRP": ("xrp", "ripple"),
    "HYPE": ("hyperliquid",), "DOGE": ("dogecoin",), "BNB": ("bnb", "binance"),
    "NVDA": ("nvidia",), "AAPL": ("apple",), "TSLA": ("tesla",), "MSFT": ("microsoft",), "AMZN": ("amazon",),
    "GOOGL": ("google", "alphabet"), "META": ("meta ",), "MC.PA": ("lvmh",), "TTE.PA": ("totalenergies",),
    "AIR.PA": ("airbus",), "^FCHI": ("cac 40", "cac40"), "^GSPC": ("s&p 500", "wall street"),
}


def sentiment(text):
    t = text.lower()
    p = len(POS_RE.findall(t))
    n = len(NEG_RE.findall(t))
    return max(-3, min(3, p - n))


def parse_date(txt):
    txt = (txt or "").strip()
    try:
        return int(parsedate_to_datetime(txt).timestamp())
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            from datetime import datetime, timezone
            d = datetime.strptime(txt, fmt)
            return int((d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp())
        except ValueError:
            pass
    return None


def fetch_feed(name, url, cat, limit=40):
    req = urllib.request.Request(url, headers={**UA, "Accept": "application/rss+xml, application/xml"})
    with urllib.request.urlopen(req, timeout=15) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        src = it.findtext("source") or name
        if " - " in title and name.startswith("Google"):
            title, src = title.rsplit(" - ", 1)
        ts = parse_date(it.findtext("pubDate"))
        if ts is None:
            continue
        low = " " + title.lower() + " "
        out.append({"title": title, "link": it.findtext("link"), "source": src.strip(), "ts": ts, "cat": cat,
                    "sent": sentiment(title), "assets": [k for k, ws in ASSETS.items() if any(w in low for w in ws)]})
    return out[:limit]


def api_news():
    def build():
        items = fetch_many(FEEDS, fetch_feed, workers=6)
        seen, news = set(), []
        for it in sorted((x for lst in items for x in lst), key=lambda x: -x["ts"]):
            key = it["title"].lower()[:70]
            if key not in seen and time.time() - it["ts"] < 4 * 86400:
                seen.add(key)
                news.append(it)
        by_asset = {}
        for it in news:
            for a in it["assets"]:
                b = by_asset.setdefault(a, {"n": 0, "score": 0})
                b["n"] += 1
                b["score"] += it["sent"]
        for b in by_asset.values():
            b["avg"] = b["score"] / b["n"]
        cats = {c: [x["sent"] for x in news if x["cat"] == c] for c in ("crypto", "bourse")}
        mood = {c: (sum(v) / len(v) if v else 0) for c, v in cats.items()}
        return {"items": news[:120], "byAsset": by_asset, "mood": mood}
    return cached("news", 600, build)


# ================================================================ INTELLIGENCE DE MARCHE
def ecb_value(key):
    d = get_json(f"https://data-api.ecb.europa.eu/service/data/{key}?lastNObservations=1&format=jsondata")
    ser = d["dataSets"][0]["series"]
    obs = ser[next(iter(ser))]["observations"]
    val = obs[max(obs, key=int)][0]
    date = d["structure"]["dimensions"]["observation"][0]["values"][-1]["id"]
    return {"value": val, "date": date}


def api_market():
    def build():
        out = {}
        try:  # marches a levier : financement (funding) et interet ouvert
            meta, ctx = hl({"type": "metaAndAssetCtxs"})
            rows = []
            for m, c in zip(meta["universe"], ctx):
                px = f(c.get("markPx"))
                oi = f(c.get("openInterest")) * px
                if oi < 5_000_000 or m.get("isDelisted"):
                    continue
                prev = f(c.get("prevDayPx"))
                rows.append({"coin": m["name"], "price": px, "change": px / prev - 1 if prev else None,
                             "fundingApr": f(c.get("funding")) * 24 * 365, "oi": oi, "volume": f(c.get("dayNtlVlm"))})
            rows.sort(key=lambda r: -r["oi"])
            out["derivs"] = rows[:30]
        except Exception as e:
            print("  ! derivs", e)
        try:
            t = get_json("https://api.coingecko.com/api/v3/search/trending")["coins"]
            out["trending"] = [{"id": c["item"]["id"], "name": c["item"]["name"], "symbol": c["item"]["symbol"],
                                "thumb": c["item"]["small"], "rank": c["item"].get("market_cap_rank"),
                                "change": (c["item"].get("data", {}).get("price_change_percentage_24h") or {}).get("eur")}
                               for c in t[:10]]
        except Exception as e:
            print("  ! trending", e)
        try:  # liquidite : offre totale de stablecoins (argent pret a entrer sur le marche crypto)
            d = get_json("https://stablecoins.llama.fi/stablecoincharts/all", timeout=30)
            cur_ = d[-1]["totalCirculatingUSD"]["peggedUSD"]
            prev = d[-31]["totalCirculatingUSD"]["peggedUSD"] if len(d) > 31 else cur_
            out["stables"] = {"total": cur_, "change30d": cur_ / prev - 1,
                              "series": [x["totalCirculatingUSD"]["peggedUSD"] for x in d[-90:]]}
        except Exception as e:
            print("  ! stablecoins", e)
        for k, key in (("ecbRate", "FM/B.U2.EUR.4F.KR.DFR.LEV"), ("inflation", "ICP/M.U2.N.000000.4.ANR")):
            try:
                out[k] = ecb_value(key)
            except Exception as e:
                print("  !", k, e)
        try:
            out["fx"] = get_json("https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,CHF,JPY,MAD,CAD")["rates"]
        except Exception as e:
            print("  ! fx", e)
        return out
    return cached("market", 600, build)


# ================================================================ ANALYSE PRO (donnees fondamentales Yahoo)
_yjar = http.cookiejar.CookieJar()
_yopener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_yjar))
_ycrumb = {"v": None}
YH = {**UA, "Accept": "*/*"}  # le jeton (crumb) est renvoye en texte brut
_ylock = threading.Lock()


def _ycrumb_get(force=False):
    with _ylock:
        if _ycrumb["v"] and not force:
            return _ycrumb["v"]
        try:
            _yopener.open(urllib.request.Request("https://fc.yahoo.com", headers=YH), timeout=10)
        except Exception:
            pass  # renvoie 404 mais depose le cookie
        req = urllib.request.Request("https://query1.finance.yahoo.com/v1/test/getcrumb", headers=YH)
        _ycrumb["v"] = _yopener.open(req, timeout=10).read().decode().strip()
        return _ycrumb["v"]


def yahoo_summary(sym, modules):
    for attempt in range(4):
        crumb = _ycrumb_get(force=attempt == 1)
        url = (f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}"
               f"?modules={','.join(modules)}&crumb={urllib.parse.quote(crumb)}")
        try:
            with _yopener.open(urllib.request.Request(url, headers=UA), timeout=15) as r:
                res = json.loads(r.read().decode())["quoteSummary"]["result"]
                return res[0] if res else {}
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and attempt == 0:
                continue
            if e.code == 429 and attempt < 3:  # limite de debit : on patiente
                time.sleep(2 + 3 * attempt)
                continue
            raise


def rv(d, *path):
    for k in path:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d.get("raw") if isinstance(d, dict) else d


FUND_MODULES = ["price", "assetProfile", "summaryDetail", "financialData", "defaultKeyStatistics",
                "incomeStatementHistory", "earnings", "earningsTrend", "calendarEvents"]


def fundamentals(sym):
    def build():
        r = yahoo_summary(sym, FUND_MODULES)
        inc = (r.get("incomeStatementHistory") or {}).get("incomeStatementHistory") or []
        years = [{"year": rv(x, "endDate") and time.gmtime(rv(x, "endDate")).tm_year, "revenue": rv(x, "totalRevenue"),
                  "netIncome": rv(x, "netIncome"), "operatingIncome": rv(x, "operatingIncome")} for x in inc]
        years = [y for y in years if y["revenue"]]
        cagr = None
        if len(years) >= 2 and years[-1]["revenue"] > 0:
            cagr = (years[0]["revenue"] / years[-1]["revenue"]) ** (1 / (len(years) - 1)) - 1
        ec = ((r.get("earnings") or {}).get("earningsChart") or {}).get("quarterly") or []
        fq = ((r.get("earnings") or {}).get("financialsChart") or {}).get("quarterly") or []
        rev_q = {x.get("date"): rv(x, "revenue") for x in fq}
        quarters = [{"label": x.get("calendarQuarter") or x.get("date"), "actual": rv(x, "actual"), "estimate": rv(x, "estimate"),
                     "surprise": f(x.get("surprisePct"), None), "reported": rv(x, "reportedDate"),
                     "revenue": rev_q.get(x.get("date"))} for x in ec]
        trend = [{"period": t.get("period"), "eps": rv(t, "earningsEstimate", "avg"), "epsLow": rv(t, "earningsEstimate", "low"),
                  "epsHigh": rv(t, "earningsEstimate", "high"), "revenue": rv(t, "revenueEstimate", "avg"),
                  "growth": rv(t, "growth"), "analysts": rv(t, "earningsEstimate", "numberOfAnalysts")}
                 for t in ((r.get("earningsTrend") or {}).get("trend") or [])]
        ed = (((r.get("calendarEvents") or {}).get("earnings") or {}).get("earningsDate") or [])
        P, A, SD, FD, KS = (r.get(k) or {} for k in ("price", "assetProfile", "summaryDetail", "financialData", "defaultKeyStatistics"))
        return {
            "symbol": sym, "name": P.get("longName") or P.get("shortName") or sym, "currency": P.get("currency"),
            "sector": A.get("sector"), "industry": A.get("industry"), "country": A.get("country"),
            "summary": (A.get("longBusinessSummary") or "")[:600], "employees": A.get("fullTimeEmployees"),
            "price": rv(FD, "currentPrice") or rv(P, "regularMarketPrice"), "marketCap": rv(SD, "marketCap") or rv(P, "marketCap"),
            "pe": rv(SD, "trailingPE"), "fpe": rv(KS, "forwardPE") or rv(SD, "forwardPE"), "peg": rv(KS, "pegRatio"),
            "pb": rv(KS, "priceToBook"), "eps": rv(KS, "trailingEps"), "feps": rv(KS, "forwardEps"), "beta": rv(KS, "beta") or rv(SD, "beta"),
            "divRate": rv(SD, "dividendRate"), "divYield": rv(SD, "dividendYield"), "payout": rv(SD, "payoutRatio"),
            "avgYield5y": rv(SD, "fiveYearAvgDividendYield"), "exDiv": rv(SD, "exDividendDate"),
            "revGrowth": rv(FD, "revenueGrowth"), "earnGrowth": rv(FD, "earningsGrowth"), "revCagr": cagr, "years": years,
            "grossMargin": rv(FD, "grossMargins"), "opMargin": rv(FD, "operatingMargins"), "profitMargin": rv(FD, "profitMargins"),
            "roe": rv(FD, "returnOnEquity"), "debtToEquity": rv(FD, "debtToEquity"), "totalDebt": rv(FD, "totalDebt"),
            "totalCash": rv(FD, "totalCash"), "fcf": rv(FD, "freeCashflow"), "ocf": rv(FD, "operatingCashflow"),
            "revenue": rv(FD, "totalRevenue"), "shares": rv(KS, "sharesOutstanding"), "ev": rv(KS, "enterpriseValue"),
            "target": rv(FD, "targetMeanPrice"), "targetHigh": rv(FD, "targetHighPrice"), "targetLow": rv(FD, "targetLowPrice"),
            "analysts": rv(FD, "numberOfAnalystOpinions"), "reco": FD.get("recommendationKey"),
            "quarters": quarters, "trend": trend, "nextEarnings": rv(ed[0]) if ed and isinstance(ed[0], dict) else None,
        }
    return cached(f"fund:{sym}", 6 * 3600, build)


def yahoo_ohlcv(sym, rng="2y", interval="1d", events=None):
    def build():
        url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval={interval}"
               + (f"&events={events}" if events else ""))
        d = get_json(url)["chart"]["result"][0]
        q = d["indicators"]["quote"][0]
        rows = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v or 0}
                for t, o, h, l, c, v in zip(d.get("timestamp") or [], q["open"], q["high"], q["low"], q["close"], q["volume"])
                if c is not None and h is not None and l is not None]
        return {"meta": d["meta"], "rows": rows, "events": d.get("events", {})}
    return cached(f"ohlcv:{sym}:{rng}:{interval}:{events}", 900, build)


# ---------- indicateurs series
def sma_s(xs, n):
    out, s_ = [], 0.0
    for i, x in enumerate(xs):
        s_ += x
        if i >= n:
            s_ -= xs[i - n]
        out.append(s_ / n if i >= n - 1 else None)
    return out


def ema_s(xs, n):
    k, out, e = 2 / (n + 1), [], None
    for x in xs:
        e = x if e is None else x * k + e * (1 - k)
        out.append(e)
    return out


def rsi_s(xs, n=14):
    out = [None] * len(xs)
    if len(xs) <= n:
        return out
    g = sum(max(xs[i] - xs[i - 1], 0) for i in range(1, n + 1)) / n
    l_ = sum(max(xs[i - 1] - xs[i], 0) for i in range(1, n + 1)) / n
    for i in range(n, len(xs)):
        if i > n:
            d = xs[i] - xs[i - 1]
            g = (g * (n - 1) + max(d, 0)) / n
            l_ = (l_ * (n - 1) + max(-d, 0)) / n
        out[i] = 100 - 100 / (1 + g / l_) if l_ else 100
    return out


def std_s(xs, n):
    out = []
    for i in range(len(xs)):
        if i < n - 1:
            out.append(None)
            continue
        w = xs[i - n + 1:i + 1]
        m = sum(w) / n
        out.append(math.sqrt(sum((x - m) ** 2 for x in w) / n))
    return out


def pivots(rows, w=5):
    hi, lo = [], []
    for i in range(w, len(rows) - w):
        win = rows[i - w:i + w + 1]
        if rows[i]["h"] == max(r["h"] for r in win):
            hi.append((i, rows[i]["h"]))
        if rows[i]["l"] == min(r["l"] for r in win):
            lo.append((i, rows[i]["l"]))
    return hi, lo


def cluster_levels(points, tol=0.02):
    lv = []
    for _, p in sorted(points, key=lambda x: x[1]):
        if lv and abs(p / lv[-1]["price"] - 1) < tol:
            c = lv[-1]
            c["price"] = (c["price"] * c["touches"] + p) / (c["touches"] + 1)
            c["touches"] += 1
        else:
            lv.append({"price": p, "touches": 1})
    return lv


def api_technical(q):
    sym = q.get("symbol", [""])[0].strip().upper()
    if not sym:
        raise ValueError("symbole manquant")

    def build():
        d = yahoo_ohlcv(sym, "2y", "1d")
        rows = d["rows"]
        if len(rows) < 120:
            raise ValueError("Historique insuffisant pour " + sym)
        c = [r["c"] for r in rows]
        n = len(c)
        p = c[-1]
        s20, s50, s100, s200 = (sma_s(c, k) for k in (20, 50, 100, 200))
        e12, e26 = ema_s(c, 12), ema_s(c, 26)
        macd = [a - b for a, b in zip(e12, e26)]
        sig = ema_s(macd, 9)
        rsi_ = rsi_s(c)
        sd20 = std_s(c, 20)
        bbu = [m + 2 * s_ if m and s_ else None for m, s_ in zip(s20, sd20)]
        bbl = [m - 2 * s_ if m and s_ else None for m, s_ in zip(s20, sd20)]
        trs = [max(r["h"] - r["l"], abs(r["h"] - rows[i - 1]["c"]), abs(r["l"] - rows[i - 1]["c"])) for i, r in enumerate(rows) if i]
        atr = sum(trs[-14:]) / 14
        # tendances multi-horizons
        def trend(price, ma, ma_prev):
            if ma is None:
                return "Neutre"
            up = price > ma and (ma_prev is None or ma >= ma_prev)
            down = price < ma and (ma_prev is None or ma <= ma_prev)
            return "Haussière" if up else "Baissière" if down else "Neutre"
        tr = {"jour": trend(p, s20[-1], s20[-6]), "semaine": trend(p, s100[-1], s100[-11]), "mois": trend(p, s200[-1], s200[-22])}
        # supports / resistances (12 derniers mois)
        last = rows[-260:]
        hi, lo = pivots(last)
        levels = cluster_levels(hi + lo)
        sup = sorted([x for x in levels if x["price"] < p * 0.995], key=lambda x: -x["price"])[:3]
        res = sorted([x for x in levels if x["price"] > p * 1.005], key=lambda x: x["price"])[:3]
        h1, l1 = max(r["h"] for r in last), min(r["l"] for r in last)
        fib = {k: h1 - (h1 - l1) * k for k in (0.236, 0.382, 0.5, 0.618, 0.786)}
        # volume
        v20 = sum(r["v"] for r in rows[-20:]) / 20
        v60 = sum(r["v"] for r in rows[-60:]) / 60
        upv = sum(rows[i]["v"] for i in range(n - 20, n) if c[i] > c[i - 1])
        dnv = sum(rows[i]["v"] for i in range(n - 20, n) if c[i] < c[i - 1])
        # figures chartistes simples
        patterns = []
        if len(hi) >= 2 and abs(hi[-1][1] / hi[-2][1] - 1) < 0.03 and hi[-1][0] - hi[-2][0] > 10 and p < hi[-1][1] * 0.97:
            patterns.append("Double sommet (signal baissier)")
        if len(lo) >= 2 and abs(lo[-1][1] / lo[-2][1] - 1) < 0.03 and lo[-1][0] - lo[-2][0] > 10 and p > lo[-1][1] * 1.03:
            patterns.append("Double creux (signal haussier)")
        if len(hi) >= 2 and len(lo) >= 2:
            if hi[-1][1] > hi[-2][1] and lo[-1][1] > lo[-2][1]:
                patterns.append("Plus hauts et plus bas ascendants (tendance haussière saine)")
            elif hi[-1][1] < hi[-2][1] and lo[-1][1] < lo[-2][1]:
                patterns.append("Plus hauts et plus bas descendants (tendance baissière)")
        if len(hi) >= 3 and hi[-2][1] > hi[-1][1] and hi[-2][1] > hi[-3][1] and abs(hi[-1][1] / hi[-3][1] - 1) < 0.04:
            patterns.append("Possible tête-épaules (retournement baissier)")
        for k in range(1, 21):
            if s50[-k] and s200[-k] and s50[-k - 1] and s200[-k - 1]:
                if s50[-k] > s200[-k] and s50[-k - 1] <= s200[-k - 1]:
                    patterns.append(f"Golden cross il y a {k} jours (MM50 passe au-dessus de MM200)")
                if s50[-k] < s200[-k] and s50[-k - 1] >= s200[-k - 1]:
                    patterns.append(f"Death cross il y a {k} jours (MM50 passe sous MM200)")
        # score
        sc, why = 0, []
        def add(v, txt):
            nonlocal sc
            sc += v
            why.append(("+" if v > 0 else "-" if v < 0 else "~", txt))
        for k_, w in (("jour", 1), ("semaine", 2), ("mois", 2)):
            add(w if tr[k_] == "Haussière" else -w if tr[k_] == "Baissière" else 0, f"Tendance {k_} : {tr[k_].lower()}")
        r_ = rsi_[-1]
        add(2 if r_ < 30 else -2 if r_ > 70 else 1 if 45 <= r_ <= 60 else 0,
            f"RSI {r_:.0f} : " + ("survendu" if r_ < 30 else "suracheté" if r_ > 70 else "zone neutre"))
        add(1 if macd[-1] > sig[-1] else -1, "MACD " + ("au-dessus" if macd[-1] > sig[-1] else "sous") + " sa ligne de signal")
        if bbu[-1] and p > bbu[-1]:
            add(-1, "Prix au-dessus de la bande de Bollinger haute (excès)")
        elif bbl[-1] and p < bbl[-1]:
            add(1, "Prix sous la bande de Bollinger basse (excès de vente)")
        add(1 if upv > dnv * 1.2 else -1 if dnv > upv * 1.2 else 0,
            "Volume : " + ("les acheteurs dominent" if upv > dnv * 1.2 else "les vendeurs dominent" if dnv > upv * 1.2 else "équilibré"))
        sc = max(-10, min(10, sc))
        verdict = ("Achat fort" if sc >= 6 else "Achat" if sc >= 3 else "Neutre" if sc > -3 else "Vente" if sc > -6 else "Vente forte")
        # plan de trade
        s1 = sup[0]["price"] if sup else p - 2 * atr
        r1 = res[0]["price"] if res else max(h1, p + 3 * atr)
        entry = p if (p - s1) / p < 0.03 else s1 * 1.005
        stop = min(s1, entry) - atr
        target = r1 if r1 > entry * 1.02 else entry + 3 * (entry - stop)
        rr = (target - entry) / (entry - stop) if entry > stop else None
        k0 = max(0, n - 260)
        return {
            "symbol": sym, "name": d["meta"].get("shortName") or d["meta"].get("longName") or sym, "currency": d["meta"].get("currency"),
            "price": p, "trend": tr, "supports": sup, "resistances": res, "fib": fib, "high1y": h1, "low1y": l1,
            "sma": {"20": s20[-1], "50": s50[-1], "100": s100[-1], "200": s200[-1]},
            "rsi": r_, "macd": macd[-1], "macdSignal": sig[-1], "bbUpper": bbu[-1], "bbLower": bbl[-1], "atr": atr,
            "volume": {"avg20": v20, "avg60": v60, "up": upv, "down": dnv}, "patterns": patterns,
            "score": sc, "confidence": min(95, 40 + abs(sc) * 5), "verdict": verdict, "why": why,
            "plan": {"entry": entry, "stop": stop, "target": target, "rr": rr},
            "series": {"t": [r["t"] for r in rows[k0:]], "c": c[k0:], "s50": s50[k0:], "s200": s200[k0:],
                       "bbu": bbu[k0:], "bbl": bbl[k0:], "rsi": rsi_[k0:], "macd": macd[k0:], "sig": sig[k0:]},
        }
    return cached(f"tech:{sym}", 900, build)


def api_fundamentals(q):
    sym = q.get("symbol", [""])[0].strip().upper()
    fd = dict(fundamentals(sym))
    # reaction du cours apres les 4 dernieres publications
    try:
        rows = yahoo_ohlcv(sym, "2y", "1d")["rows"]
        reacts = []
        for qu in fd["quarters"]:
            t = qu.get("reported")
            if not t:
                continue
            before = [r for r in rows if r["t"] < t - 3600]
            after = [r for r in rows if r["t"] > t + 3600 * 6]
            if before and after:
                b, a = before[-1]["c"], after[0]["c"]
                # publication avant ouverture : la seance du jour compte
                same = [r for r in rows if t - 3600 <= r["t"] <= t + 3600 * 6]
                if same and time.gmtime(t).tm_hour < 13:
                    a = same[0]["c"]
                reacts.append(a / b - 1)
            else:
                reacts.append(None)
        fd["reactions"] = reacts
    except Exception as e:
        print("  ! reactions", sym, e)
    return fd


SCREEN = [s for s, r in STOCKS if r != "ETF"]


def api_screen():
    def build():
        funds = fetch_many([(s,) for s in SCREEN], fundamentals, workers=3)
        if len(funds) < len(SCREEN) // 2:
            raise RuntimeError("données fondamentales indisponibles, nouvel essai bientôt")
        techs = {a["symbol"]: a for a in api_stocks()}
        by_sector = {}
        for x in funds:
            if x.get("pe") and 0 < x["pe"] < 200:
                by_sector.setdefault(x.get("sector"), []).append(x["pe"])
        med = {k: sorted(v)[len(v) // 2] for k, v in by_sector.items()}
        allpe = sorted(p for v in by_sector.values() for p in v)
        out = []
        for x in funds:
            t = techs.get(x["symbol"], {})
            out.append({**{k: x.get(k) for k in ("symbol", "name", "currency", "sector", "country", "price", "marketCap", "pe", "fpe",
                                                   "peg", "revCagr", "revGrowth", "debtToEquity", "divYield", "payout", "opMargin",
                                                   "roe", "beta", "target", "targetHigh", "targetLow", "analysts", "reco", "fcf")},
                        "sectorPe": med.get(x.get("sector")) or (allpe[len(allpe) // 2] if allpe else None),
                        "vol": t.get("vol"), "sma50": t.get("sma50"), "sma200": t.get("sma200"), "rsi": t.get("rsi"),
                        "ret1y": t.get("ret1y"), "low52": t.get("price", 0) / (1 + t["fromHigh"]) if t.get("fromHigh") is not None else None})
        return out
    return cached("screen", 6 * 3600, build)


DIV_UNIVERSE = ["KO", "PEP", "PG", "JNJ", "MCD", "XOM", "CVX", "ABBV", "VZ", "O", "HD", "JPM", "MSFT", "AAPL", "MO",
                "PFE", "CSCO", "TTE.PA", "SAN.PA", "AI.PA", "OR.PA", "BNP.PA", "ENGI.PA", "ORA.PA", "CS.PA", "ALV.DE",
                "MUV2.DE", "ALLN.SW", "NESN.SW", "ULVR.L"]


def dividend_history(sym):
    ev = yahoo_ohlcv(sym, "20y", "3mo", "div")["events"].get("dividends", {})
    per_year = {}
    for x in ev.values():
        y = time.gmtime(x["date"]).tm_year
        per_year[y] = per_year.get(y, 0) + x["amount"]
    this = time.gmtime().tm_year
    yrs = sorted(y for y in per_year if y < this)
    streak = 0
    for i in range(len(yrs) - 1, 0, -1):
        if yrs[i] - yrs[i - 1] == 1 and per_year[yrs[i]] >= per_year[yrs[i - 1]] * 0.995:
            streak += 1
        else:
            break
    cagr5 = None
    if len(yrs) >= 6 and per_year[yrs[-6]] > 0:
        cagr5 = (per_year[yrs[-1]] / per_year[yrs[-6]]) ** (1 / 5) - 1
    return {"streak": streak, "cagr5": cagr5, "history": [[y, per_year[y]] for y in yrs[-12:]]}


def api_dividends():
    def build():
        def one(sym):
            fd = fundamentals(sym)
            if not fd.get("divYield"):
                return None
            h = dividend_history(sym)
            pay = fd.get("payout") or 0
            # couverture du dividende par le cash-flow operationnel (le FCF "leveraged" de Yahoo est peu fiable)
            cover = (fd["ocf"] / (fd["divRate"] * fd["shares"])) if fd.get("ocf") and fd.get("divRate") and fd.get("shares") else None
            safe = 3.5
            if fd.get("sector") != "Real Estate":  # les foncieres distribuent par nature > 100 % du resultat comptable
                safe += 2 if 0 < pay < 0.6 else 1 if pay < 0.8 else -2 if pay > 1 else 0
            safe += 1.5 if cover and cover > 3 else 0.5 if cover and cover > 1.8 else -1.5 if cover is not None and cover < 1.2 else 0
            safe += min(2, h["streak"] / 10)
            de = fd.get("debtToEquity")
            safe += -1 if de and de > 200 else 0.5 if de is not None and de < 80 else 0
            safe += -1 if fd["divYield"] > 0.08 else 0
            safe += 0.5 if (fd.get("beta") or 1) < 0.8 else 0
            return {"symbol": sym, "name": fd["name"], "sector": fd.get("sector"), "country": fd.get("country"), "currency": fd.get("currency"),
                    "price": fd.get("price"), "yield": fd["divYield"], "divRate": fd.get("divRate"), "payout": pay, "cover": cover,
                    "streak": h["streak"], "cagr5": h["cagr5"], "history": h["history"], "beta": fd.get("beta"),
                    "debtToEquity": de, "safety": round(max(0, min(10, safe)), 1)}
        res = fetch_many([(s,) for s in DIV_UNIVERSE], one, workers=3)
        if len(res) < len(DIV_UNIVERSE) // 2:
            raise RuntimeError("données de dividendes indisponibles, nouvel essai bientôt")
        return res
    return cached("dividends", 6 * 3600, build)


ETF_COMPARE = [("SPY", "S&P 500 (référence)"), ("SCHG", "Schwab US Large-Cap Growth"), ("QQQ", "Invesco QQQ (Nasdaq-100)"),
               ("VGT", "Vanguard Information Technology"), ("SOXX", "iShares Semiconductor"), ("SMH", "VanEck Semiconductor"),
               ("CW8.PA", "Amundi MSCI World (PEA)"), ("GOLD.PA", "Or physique (Amundi)"), ("XGLE.DE", "Obligations d'État zone euro")]


def api_etfs():
    def build():
        def one(sym, name):
            rows = yahoo_ohlcv(sym, "10y", "1mo")["rows"]
            c = [r["c"] for r in rows]
            if len(c) < 24:
                return None
            yrs = (len(c) - 1) / 12
            rets = [c[i] / c[i - 1] - 1 for i in range(1, len(c))]
            m = sum(rets) / len(rets)
            vol = math.sqrt(sum((x - m) ** 2 for x in rets) / (len(rets) - 1)) * math.sqrt(12)
            peak, dd = c[0], 0
            for x in c:
                peak = max(peak, x)
                dd = min(dd, x / peak - 1)
            r12 = [c[i] / c[i - 12] - 1 for i in range(12, len(c))]
            return {"symbol": sym, "name": name, "years": round(yrs, 1), "cagr": (c[-1] / c[0]) ** (1 / yrs) - 1, "vol": vol,
                    "maxDD": dd, "worst12": min(r12), "best12": max(r12), "growth10k": 10000 * c[-1] / c[0],
                    "series": [[r["t"], r["c"] / c[0]] for r in rows]}
        return fetch_many(ETF_COMPARE, one, workers=6)
    return cached("etfs", 6 * 3600, build)


SECTOR_STRESS = {"Technology": -0.40, "Communication Services": -0.35, "Consumer Cyclical": -0.40, "Financial Services": -0.45,
                 "Energy": -0.35, "Healthcare": -0.20, "Consumer Defensive": -0.15, "Utilities": -0.15, "Industrials": -0.35,
                 "Basic Materials": -0.35, "Real Estate": -0.35, "Crypto": -0.70, "Or": 0.10, "Obligations": 0.05, "ETF actions": -0.35}
RATE_SENS = {"Real Estate": "Forte", "Utilities": "Forte", "Obligations": "Forte", "Technology": "Moyenne", "Communication Services": "Moyenne",
             "Financial Services": "Moyenne (profite de taux hauts)", "Consumer Cyclical": "Moyenne", "Crypto": "Forte", "Or": "Moyenne"}
ETF_KIND = {"GLD": "Or", "GOLD.PA": "Or", "IGLN.L": "Or", "XGLE.DE": "Obligations", "AGG": "Obligations", "EUNA.DE": "Obligations"}


def api_risk(q):
    raw = q.get("pos", [""])[0]
    pos = []
    for part in raw.split(","):
        if ":" in part:
            s_, a = part.split(":", 1)
            if s_.strip() and f(a) > 0:
                pos.append((s_.strip().upper(), f(a)))
    if not pos:
        raise ValueError("Ajoute au moins une position")
    pos = pos[:25]
    total = sum(a for _, a in pos)

    def info(sym):
        crypto = sym.endswith("-USD") or sym.endswith("-EUR")
        series = yahoo_ohlcv(sym, "1y", "1d")
        meta = series["meta"]
        sector = "Crypto" if crypto else ETF_KIND.get(sym)
        country, cur_ = None, meta.get("currency")
        if not sector:
            try:
                fd = fundamentals(sym)
                sector, country = fd.get("sector"), fd.get("country")
            except Exception:
                pass
            sector = sector or ("ETF actions" if meta.get("instrumentType") == "ETF" else "Autre")
        rows = series["rows"]
        closes = {time.strftime("%Y-%m-%d", time.gmtime(r["t"])): r["c"] for r in rows}
        adv = sum(r["v"] * r["c"] for r in rows[-30:]) / max(1, len(rows[-30:]))
        region = {"Crypto": "Mondial (crypto)", "Or": "Mondial (or)", "Obligations": "Zone euro", "ETF actions": "Mondial (ETF)"}.get(sector)
        return {"symbol": sym, "name": meta.get("shortName") or sym, "sector": sector, "country": country or region or meta.get("exchangeName"),
                "currency": "Crypto" if crypto else cur_, "closes": closes, "adv": adv}

    infos = fetch_many([(s_,) for s_, _ in pos], info, workers=6)
    imap = {i["symbol"]: i for i in infos}
    pos = [(s_, a) for s_, a in pos if s_ in imap]
    if not pos:
        raise ValueError("Aucun symbole reconnu (utilise les symboles Yahoo, ex. AAPL, MC.PA, BTC-USD)")
    total = sum(a for _, a in pos)
    dates = sorted(set.intersection(*[set(imap[s_]["closes"]) for s_, _ in pos]))
    rets = {}
    for s_, _ in pos:
        cl = [imap[s_]["closes"][d_] for d_ in dates]
        rets[s_] = [cl[i] / cl[i - 1] - 1 for i in range(1, len(cl))]
    def corr(a, b):
        n = len(a)
        if n < 20:
            return None
        ma, mb = sum(a) / n, sum(b) / n
        cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
        va = math.sqrt(sum((x - ma) ** 2 for x in a))
        vb = math.sqrt(sum((y - mb) ** 2 for y in b))
        return cov / (va * vb) if va and vb else None
    syms = [s_ for s_, _ in pos]
    matrix = [[1.0 if i == j else corr(rets[a], rets[b]) for j, b in enumerate(syms)] for i, a in enumerate(syms)]
    w = {s_: a / total for s_, a in pos}
    port = [sum(w[s_] * rets[s_][i] for s_ in syms) for i in range(len(dates) - 1)] if len(dates) > 1 else []
    pvol = var95 = mdd = None
    if len(port) > 20:
        m = sum(port) / len(port)
        pvol = math.sqrt(sum((x - m) ** 2 for x in port) / (len(port) - 1)) * math.sqrt(252)
        var95 = sorted(port)[int(len(port) * 0.05)]
        v, peak, mdd = 1.0, 1.0, 0.0
        for x in port:
            v *= 1 + x
            peak = max(peak, v)
            mdd = min(mdd, v / peak - 1)
    group = lambda key: sorted(({"name": k, "weight": sum(w[s_] for s_ in syms if (imap[s_][key] or "Autre") == k)}
                                for k in {imap[s_][key] or "Autre" for s_ in syms}), key=lambda x: -x["weight"])
    lines = []
    for s_, a in pos:
        i = imap[s_]
        sv = [rets[s_][k] for k in range(len(rets[s_]))]
        vol_ = None
        if len(sv) > 20:
            m = sum(sv) / len(sv)
            vol_ = math.sqrt(sum((x - m) ** 2 for x in sv) / (len(sv) - 1)) * math.sqrt(252)
        days_to_sell = a / (i["adv"] * 0.1) if i["adv"] else None
        lines.append({"symbol": s_, "name": i["name"], "amount": a, "weight": w[s_], "sector": i["sector"], "currency": i["currency"],
                      "country": i["country"], "vol": vol_, "stress": SECTOR_STRESS.get(i["sector"], -0.30),
                      "rateSens": RATE_SENS.get(i["sector"], "Faible"),
                      "liquidity": "Excellente" if days_to_sell is not None and days_to_sell < 0.01 else "Bonne" if days_to_sell is not None and days_to_sell < 1 else "Faible"})
    recession = sum(l["weight"] * l["stress"] for l in lines)
    crypto_w = sum(l["weight"] for l in lines if l["sector"] == "Crypto")
    usd_w = sum(l["weight"] for l in lines if l["currency"] == "USD")
    tech_w = sum(l["weight"] for l in lines if l["sector"] in ("Technology", "Communication Services"))
    scenarios = [
        {"name": "Récession / krach boursier", "proba": "≈ 10-15 % par an", "impact": recession},
        {"name": "Hiver crypto (-75 % sur la crypto)", "proba": "≈ 20 % par an", "impact": -0.75 * crypto_w},
        {"name": "Hausse brutale des taux (+2 pts)", "proba": "≈ 10 % par an",
         "impact": -sum(l["weight"] * (0.25 if l["rateSens"].startswith("Forte") else 0.12 if l["rateSens"].startswith("Moyenne") else 0.05) for l in lines)},
        {"name": "Chute du dollar (-15 % vs euro)", "proba": "≈ 15 % par an", "impact": -0.15 * usd_w},
        {"name": "Éclatement d'une bulle tech (-50 % tech)", "proba": "≈ 5-10 % par an", "impact": -0.5 * tech_w},
    ]
    return {"lines": lines, "symbols": syms, "matrix": matrix, "sectors": group("sector"), "currencies": group("currency"),
            "countries": group("country"), "vol": pvol, "var95": var95, "maxDD": mdd, "total": total, "days": len(dates),
            "scenarios": scenarios, "cryptoWeight": crypto_w, "usdWeight": usd_w}


ROUTES = {
    "/api/crypto": api_crypto,
    "/api/stocks": lambda q: api_stocks(),
    "/api/indices": lambda q: api_indices(),
    "/api/global": lambda q: api_global(),
    "/api/analysis": lambda q: api_analysis(),
    "/api/history": api_history,
    "/api/whales": lambda q: api_whales(),
    "/api/whale": api_whale,
    "/api/news": lambda q: api_news(),
    "/api/market": lambda q: api_market(),
    "/api/fundamentals": api_fundamentals,
    "/api/technical": api_technical,
    "/api/screen": lambda q: api_screen(),
    "/api/dividends": lambda q: api_dividends(),
    "/api/etfs": lambda q: api_etfs(),
    "/api/risk": api_risk,
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
            if len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
                body = gzip.compress(body, 5)
                self.send_response(code)
                self.send_header("Content-Encoding", "gzip")
            else:
                self.send_response(code)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            print("  ", args[0])


def warmup():
    """Precharge toutes les donnees au demarrage pour un affichage instantane."""
    t0 = time.time()
    for name, fn in (("crypto", api_crypto), ("crypto $", lambda: api_crypto({"cur": ["usd"]})), ("indices", api_indices), ("bourse", api_stocks),
                     ("global", api_global), ("analyse", api_analysis), ("marché", api_market),
                     ("actualités", api_news), ("baleines", api_whales),
                     ("sélection d'actions", api_screen), ("ETF", api_etfs), ("dividendes", api_dividends)):
        try:
            fn()
            print(f"  ✓ {name} prêt ({time.time() - t0:.1f}s)")
        except Exception as e:
            print(f"  ! {name} : {e}")


if __name__ == "__main__":
    threading.Thread(target=warmup, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"\n  InvestPilot est lancé  ->  {url}\n  (Ctrl+C pour arrêter)\n")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Au revoir !")

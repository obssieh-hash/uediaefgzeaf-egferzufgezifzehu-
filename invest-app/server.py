#!/usr/bin/env python3
"""InvestPilot - serveur local (bibliotheque standard Python uniquement).

Lancer :  python3 server.py   puis ouvrir http://localhost:8765
Sources : CoinGecko (crypto), Yahoo Finance (bourse), alternative.me (Fear & Greed).
"""
import gzip
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
        days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "5y": 1825, "10y": 3650}[rng]
        d = cached(f"cg:{sym}:{rng}", 300, lambda: get_json(
            f"https://api.coingecko.com/api/v3/coins/{urllib.parse.quote(sym)}/market_chart?vs_currency=eur&days={days}"))
        return {"points": [[int(t / 1000), p] for t, p in d["prices"]], "currency": "EUR"}
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


ROUTES = {
    "/api/crypto": lambda q: api_crypto(),
    "/api/stocks": lambda q: api_stocks(),
    "/api/indices": lambda q: api_indices(),
    "/api/global": lambda q: api_global(),
    "/api/analysis": lambda q: api_analysis(),
    "/api/history": api_history,
    "/api/whales": lambda q: api_whales(),
    "/api/whale": api_whale,
    "/api/news": lambda q: api_news(),
    "/api/market": lambda q: api_market(),
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
    for name, fn in (("crypto", api_crypto), ("indices", api_indices), ("bourse", api_stocks),
                     ("global", api_global), ("analyse", api_analysis), ("marché", api_market),
                     ("actualités", api_news), ("baleines", api_whales)):
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

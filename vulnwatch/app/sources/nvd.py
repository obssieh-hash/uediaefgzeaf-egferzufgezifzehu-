"""NVD (NIST) — API CVE 2.0 : https://nvd.nist.gov/developers/vulnerabilities

Sans clé : 5 requêtes / 30 s. Avec clé (gratuite) : 50 requêtes / 30 s.
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from .. import config, db
from . import client, get

log = logging.getLogger("vulnwatch.nvd")
URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
PAGE = 2000
MAX_RANGE = timedelta(days=119)


def _delay() -> float:
    return 0.8 if config.NVD_API_KEY else 6.5


def _client():
    h = {"apiKey": config.NVD_API_KEY} if config.NVD_API_KEY else {}
    return client(**h)


def _fmt(dt: datetime) -> str:
    # Format documenté par le NVD : 2021-08-04T13:00:00.000+00:00
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")


def _norm_date(s):
    if not s:
        return None
    s = s.replace("Z", "")
    if "." in s:
        s = s.split(".")[0]
    return s + "+00:00" if "+" not in s else s


def parse_cve(item: dict) -> dict:
    cve = item.get("cve", item)
    desc = ""
    for d in cve.get("descriptions", []):
        if d.get("lang") == "en":
            desc = d.get("value", "")
            break
    if not desc and cve.get("descriptions"):
        desc = cve["descriptions"][0].get("value", "")

    score = vector = version = severity = None
    metrics = cve.get("metrics", {}) or {}
    for key, ver in (("cvssMetricV31", "3.1"), ("cvssMetricV40", "4.0"), ("cvssMetricV30", "3.0"), ("cvssMetricV2", "2.0")):
        entries = metrics.get(key) or []
        if not entries:
            continue
        entries = sorted(entries, key=lambda m: 0 if m.get("type") == "Primary" else 1)
        m = entries[0]
        data = m.get("cvssData", {})
        score = data.get("baseScore")
        vector = data.get("vectorString")
        version = data.get("version", ver)
        severity = (data.get("baseSeverity") or m.get("baseSeverity") or "").upper() or None
        break

    cwes = []
    for w in cve.get("weaknesses", []) or []:
        for d in w.get("description", []):
            v = d.get("value", "")
            if v.startswith("CWE-") and v not in cwes:
                cwes.append(v)

    products = []
    for conf in cve.get("configurations", []) or []:
        for node in conf.get("nodes", []) or []:
            for m in node.get("cpeMatch", []) or []:
                if not m.get("vulnerable", True):
                    continue
                parts = (m.get("criteria") or "").split(":")
                if len(parts) > 4:
                    vp = f"{parts[3]}:{parts[4]}".lower()
                    if vp not in products:
                        products.append(vp)

    refs = [{"url": r.get("url"), "tags": r.get("tags", [])} for r in cve.get("references", []) or [] if r.get("url")]

    title = ""
    if cve.get("cisaVulnerabilityName"):
        title = cve["cisaVulnerabilityName"]

    return {
        "id": cve["id"],
        "title": title,
        "description": desc,
        "cvss_score": score,
        "cvss_vector": vector,
        "cvss_version": version,
        "severity": severity,
        "cwe": cwes,
        "products": products,
        "refs": refs,
        "published": _norm_date(cve.get("published")),
        "modified": _norm_date(cve.get("lastModified")),
        "vuln_status": cve.get("vulnStatus"),
    }


def _fetch(cl, params: dict) -> list[dict]:
    """Récupère toutes les pages d'une requête NVD."""
    out, start = [], 0
    while True:
        p = dict(params, resultsPerPage=PAGE, startIndex=start)
        r = get(cl, URL, params=p, backoff=10)
        data = r.json()
        vulns = data.get("vulnerabilities", [])
        out.extend(parse_cve(v) for v in vulns)
        total = data.get("totalResults", 0)
        start += len(vulns)
        time.sleep(_delay())
        if not vulns or start >= total:
            return out


def _store(items: list[dict]) -> tuple[int, list[str]]:
    new = 0
    ids = []
    with db.tx() as c:
        for v in items:
            if db.upsert_vuln(c, v, "nvd"):
                new += 1
            ids.append(v["id"])
    return new, ids


def _ranges(start: datetime, end: datetime):
    cur = start
    while cur < end:
        nxt = min(cur + MAX_RANGE, end)
        yield cur, nxt
        cur = nxt


def sync_recent() -> tuple[int, int]:
    """CVE modifiées/publiées depuis la dernière synchro. Retourne (total, nouvelles)."""
    end = datetime.now(timezone.utc)
    last = db.kv_get("nvd_last_mod")
    start = datetime.fromisoformat(last) - timedelta(minutes=10) if last else end - timedelta(days=config.INITIAL_BACKFILL_DAYS)
    total = new = 0
    with _client() as cl:
        for a, b in _ranges(start, end):
            items = _fetch(cl, {"lastModStartDate": _fmt(a), "lastModEndDate": _fmt(b)})
            n, _ = _store(items)
            total += len(items)
            new += n
    db.kv_set("nvd_last_mod", end.isoformat())
    return total, new


def backfill_watch(cpes: list[str], keywords: list[str]) -> int:
    """Historique d'un produit surveillé (par CPE de préférence, sinon par mot-clé)."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=config.WATCH_BACKFILL_DAYS)
    total = errors = attempts = 0
    queries = [{"virtualMatchString": f"cpe:2.3:*:{c.split(':')[0]}:{c.split(':')[1]}"} for c in cpes if ":" in c]
    if not queries:
        queries = [{"keywordSearch": k} for k in keywords[:5]]
    with _client() as cl:
        for q in queries:
            for a, b in _ranges(start, end):
                attempts += 1
                try:
                    items = _fetch(cl, dict(q, pubStartDate=_fmt(a), pubEndDate=_fmt(b)))
                except Exception as e:  # une requête en échec ne bloque pas les autres
                    log.warning("Backfill NVD %s : %s", q, e)
                    errors += 1
                    last_error = e
                    continue
                _store(items)
                total += len(items)
    if attempts and errors == attempts:
        raise RuntimeError(f"NVD injoignable : {last_error}")
    return total


def enrich(cve_ids: list[str]) -> int:
    """Complète des CVE connues par d'autres sources (KEV, GitHub) avec les données NVD."""
    done = 0
    with _client() as cl:
        for cid in cve_ids:
            try:
                items = _fetch(cl, {"cveId": cid})
            except Exception as e:
                log.warning("Enrichissement NVD %s : %s", cid, e)
                continue
            _store(items)
            done += len(items)
    return done

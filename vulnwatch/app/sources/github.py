"""GitHub Advisory Database — avis revus (paquets PHP/Composer, npm, PyPI, Maven, Go...).
https://docs.github.com/rest/security-advisories/global-advisories
Sans token : 60 requêtes / heure (suffisant). Avec token : 5000 / heure.
"""
from datetime import datetime, timedelta, timezone

from .. import config, db
from . import client, get

URL = "https://api.github.com/advisories"
MAX_PAGES = 20


def parse(a: dict) -> dict:
    cvss = a.get("cvss") or {}
    sev = a.get("cvss_severities") or {}
    v3 = sev.get("cvss_v3") or {}
    v4 = sev.get("cvss_v4") or {}
    score = cvss.get("score") or v3.get("score") or v4.get("score")
    vector = cvss.get("vector_string") or v3.get("vector_string") or v4.get("vector_string")
    version = None
    if vector:
        version = "4.0" if vector.startswith("CVSS:4") else ("3.1" if "3.1" in vector else "3.0")
    severity = (a.get("severity") or "").upper()
    if severity in ("MODERATE",):
        severity = "MEDIUM"
    if severity == "UNKNOWN":
        severity = None
    products = []
    for v in a.get("vulnerabilities") or []:
        pkg = v.get("package") or {}
        if pkg.get("name"):
            products.append(f"{(pkg.get('ecosystem') or '').lower()}:{pkg['name'].lower()}")
    refs = [{"url": u, "tags": []} for u in (a.get("references") or []) if isinstance(u, str)]
    if a.get("html_url"):
        refs.insert(0, {"url": a["html_url"], "tags": ["GitHub Advisory"]})
    cve = a.get("cve_id")
    return {
        "id": cve or a["ghsa_id"],
        "aliases": [a["ghsa_id"]] if cve else [],
        "title": a.get("summary", ""),
        "description": a.get("description") or a.get("summary", ""),
        "cvss_score": float(score) if score else None,
        "cvss_vector": vector,
        "cvss_version": version,
        "severity": severity or None,
        "cwe": [c.get("cwe_id") for c in (a.get("cwes") or []) if c.get("cwe_id")],
        "products": products,
        "refs": refs,
        "published": a.get("published_at"),
        "modified": a.get("updated_at"),
    }


def sync() -> tuple[int, int, list[str]]:
    last = db.kv_get("github_last")
    since = datetime.fromisoformat(last) - timedelta(hours=1) if last else \
        datetime.now(timezone.utc) - timedelta(days=config.INITIAL_BACKFILL_DAYS)
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if config.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {config.GITHUB_TOKEN}"
    url, params = URL, {"type": "reviewed", "per_page": 100, "sort": "updated", "direction": "desc"}
    total = new = 0
    to_enrich = []
    started = datetime.now(timezone.utc)
    with client(**headers) as cl:
        for _ in range(MAX_PAGES):
            r = get(cl, url, params=params)
            items = r.json()
            if not items:
                break
            stop = False
            with db.tx() as c:
                for a in items:
                    upd = datetime.fromisoformat(a["updated_at"].replace("Z", "+00:00"))
                    if upd < since:
                        stop = True
                        break
                    v = parse(a)
                    if db.upsert_vuln(c, v, "github"):
                        new += 1
                        if v["id"].startswith("CVE-"):
                            to_enrich.append(v["id"])
                    total += 1
            nxt = r.links.get("next", {}).get("url")
            if stop or not nxt:
                break
            url, params = nxt, None
    db.kv_set("github_last", started.isoformat())
    return total, new, to_enrich

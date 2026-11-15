"""CVE.org (MITRE CVE Services) + CISA Vulnrichment (ADP) — sans clé.

Complète les CVE qui n'ont pas encore de score : le NVD accuse un fort retard d'analyse, alors que
l'éditeur (CNA) et la CISA (conteneur « CISA-ADP ») publient souvent un CVSS dès la publication.
Fournit aussi la décision SSVC de la CISA : exploitation none / poc / active, automatisable oui / non.
API : https://cveawg.mitre.org/api/cve/CVE-AAAA-NNNN
"""
import logging
import re
import time

from .. import db
from . import client, get

log = logging.getLogger("vulnwatch.cveorg")
URL = "https://cveawg.mitre.org/api/cve/{}"
MAX_PER_RUN = 400


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")


def _metrics(metrics: list) -> tuple:
    """(score, vecteur, version, sévérité) depuis une liste de métriques CVE 5."""
    for key, ver in (("cvssV3_1", "3.1"), ("cvssV4_0", "4.0"), ("cvssV3_0", "3.0"), ("cvssV2_0", "2.0")):
        for m in metrics or []:
            d = m.get(key)
            if d and d.get("baseScore") is not None:
                return float(d["baseScore"]), d.get("vectorString"), ver, (d.get("baseSeverity") or "").upper() or None
    return None, None, None, None


def _ssvc(metrics: list) -> dict:
    for m in metrics or []:
        o = m.get("other") or {}
        if o.get("type") == "ssvc":
            out = {}
            for opt in (o.get("content") or {}).get("options", []):
                for k, v in opt.items():
                    out[k.lower()] = str(v).lower()
            return out
    return {}


def parse(data: dict) -> dict | None:
    meta = data.get("cveMetadata") or {}
    if meta.get("state") == "REJECTED":
        return None
    cna = (data.get("containers") or {}).get("cna") or {}
    adps = (data.get("containers") or {}).get("adp") or []
    desc = next((d.get("value", "") for d in cna.get("descriptions", []) if d.get("lang", "").startswith("en")), "")
    score, vector, version, sev = _metrics(cna.get("metrics"))
    ssvc = {}
    for adp in adps:
        if score is None:
            score, vector, version, sev = _metrics(adp.get("metrics"))
        ssvc = ssvc or _ssvc(adp.get("metrics"))
    if score is not None and not sev:
        sev = "CRITICAL" if score >= 9 else "HIGH" if score >= 7 else "MEDIUM" if score >= 4 else "LOW" if score > 0 else "NONE"
    cwes = []
    for c in [cna] + adps:
        for pt in c.get("problemTypes", []) or []:
            for d in pt.get("descriptions", []) or []:
                if d.get("cweId") and d["cweId"] not in cwes:
                    cwes.append(d["cweId"])
    products = []
    for a in cna.get("affected", []) or []:
        if a.get("vendor") and a.get("product") and a["vendor"].lower() not in ("n/a", "unknown"):
            products.append(f"{_slug(a['vendor'])}:{_slug(a['product'])}")
    refs = [{"url": r.get("url"), "tags": r.get("tags", [])} for r in cna.get("references", []) or [] if r.get("url")]
    pub = meta.get("datePublished")
    if pub:  # format homogène avec les autres sources : 2024-07-01T08:15:00+00:00
        pub = pub.replace("Z", "").split(".")[0].split("+")[0] + "+00:00"
    return {
        "id": meta.get("cveId"), "title": cna.get("title", "") or "", "description": desc,
        "cvss_score": score, "cvss_vector": vector, "cvss_version": version, "severity": sev,
        "cwe": cwes, "products": products, "refs": refs, "published": pub,
        "modified": meta.get("dateUpdated"), "ssvc": ssvc,
    }


def sync() -> int:
    conn = db.connect()
    rows = conn.execute(
        """SELECT v.id FROM vulns v
           WHERE v.id LIKE 'CVE-%' AND v.cvss_score IS NULL AND v.sources NOT LIKE '%"cveorg"%'
           ORDER BY EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id) DESC, v.kev DESC,
                    COALESCE(v.published, v.first_seen) DESC
           LIMIT ?""", (MAX_PER_RUN,)).fetchall()
    done = errors = 0
    with client() as cl:
        for r in rows:
            try:
                data = get(cl, URL.format(r["id"]), retries=2, backoff=2).json()
            except Exception as e:
                errors += 1
                log.debug("CVE.org %s : %s", r["id"], e)
                if errors >= 10 and done == 0:
                    raise RuntimeError(f"CVE.org injoignable : {e}")
                continue
            v = parse(data)
            if not v or not v["id"]:
                continue
            ssvc = v.pop("ssvc", {})
            with db.tx() as c:
                db.upsert_vuln(c, v, "cveorg")
                if ssvc:
                    c.execute("UPDATE vulns SET ssvc_exploitation=?, ssvc_automatable=? WHERE id=?",
                              (ssvc.get("exploitation"), ssvc.get("automatable"), v["id"]))
            done += 1
            time.sleep(0.15)
    return done

"""CISA KEV — catalogue des vulnérabilités activement exploitées (sans clé).
https://www.cisa.gov/known-exploited-vulnerabilities-catalog
"""
import re

from .. import db
from . import client, get

URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")


def sync() -> tuple[int, int, list[str]]:
    """Retourne (entrées, nouvelles entrées KEV, CVE inconnues à enrichir)."""
    with client() as cl:
        data = get(cl, URL).json()
    entries = data.get("vulnerabilities", [])
    new_kev, unknown = 0, []
    with db.tx() as c:
        for e in entries:
            cid = e.get("cveID")
            if not cid:
                continue
            row = c.execute("SELECT kev, sources FROM vulns WHERE id=?", (cid,)).fetchone()
            if row is None:
                db.upsert_vuln(c, {
                    "id": cid,
                    "title": e.get("vulnerabilityName", ""),
                    "description": e.get("shortDescription", ""),
                    "cwe": e.get("cwes", []) or [],
                    "products": [f"{_slug(e.get('vendorProject'))}:{_slug(e.get('product'))}"],
                }, "kev")
                unknown.append(cid)
            elif "nvd" not in db.jl(row["sources"]):
                unknown.append(cid)
            if row is None or not row["kev"]:
                new_kev += 1
            c.execute(
                """UPDATE vulns SET kev=1, kev_added=?, kev_due=?, kev_ransomware=?, kev_action=?,
                       title=CASE WHEN title='' OR title IS NULL THEN ? ELSE title END,
                       sources=?, updated_at=? WHERE id=?""",
                (
                    e.get("dateAdded"), e.get("dueDate"), e.get("knownRansomwareCampaignUse"),
                    e.get("requiredAction"), e.get("vulnerabilityName", ""),
                    db.merge_list(c.execute("SELECT sources FROM vulns WHERE id=?", (cid,)).fetchone()["sources"], ["kev"]),
                    db.now_iso(), cid,
                ),
            )
    # Les plus récentes d'abord pour l'enrichissement NVD
    unknown.sort(reverse=True)
    return len(entries), new_kev, unknown

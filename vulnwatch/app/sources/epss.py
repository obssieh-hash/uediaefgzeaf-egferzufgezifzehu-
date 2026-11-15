"""FIRST EPSS — probabilité d'exploitation dans les 30 jours (sans clé).
https://www.first.org/epss/api
"""
import time
from datetime import datetime, timedelta, timezone

from .. import db
from . import client, get

URL = "https://api.first.org/data/v1/epss"
BATCH = 100
MAX_PER_RUN = 6000


def sync() -> int:
    today = datetime.now(timezone.utc).date().isoformat()
    since = (datetime.now(timezone.utc) - timedelta(days=730)).isoformat()
    conn = db.connect()
    # Priorité : CVE surveillées, KEV, puis récentes ; uniquement celles non mises à jour aujourd'hui
    rows = conn.execute(
        """SELECT v.id FROM vulns v
           WHERE v.id LIKE 'CVE-%' AND (v.epss_date IS NULL OR v.epss_date < ?)
             AND (v.kev=1 OR v.published >= ? OR EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id))
           ORDER BY EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id) DESC, v.kev DESC, v.published DESC
           LIMIT ?""",
        (today, since, MAX_PER_RUN),
    ).fetchall()
    ids = [r["id"] for r in rows]
    updated = 0
    with client() as cl:
        for i in range(0, len(ids), BATCH):
            chunk = ids[i:i + BATCH]
            data = get(cl, URL, params={"cve": ",".join(chunk)}).json().get("data", [])
            seen = set()
            with db.tx() as c:
                for d in data:
                    c.execute(
                        "UPDATE vulns SET epss=?, epss_percentile=?, epss_date=? WHERE id=?",
                        (float(d.get("epss", 0)), float(d.get("percentile", 0)), d.get("date") or today, d["cve"]),
                    )
                    seen.add(d["cve"])
                # CVE sans score EPSS (trop récentes) : on note la date pour ne pas re-demander aujourd'hui
                for cid in set(chunk) - seen:
                    c.execute("UPDATE vulns SET epss_date=? WHERE id=?", (today, cid))
            updated += len(data)
            time.sleep(1)
    return updated

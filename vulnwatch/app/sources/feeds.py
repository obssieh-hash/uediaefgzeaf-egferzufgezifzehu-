"""Flux RSS/Atom de bulletins : CERT-FR (ANSSI), Ubuntu USN, CISA, ZDI... (sans clé).

Des flux supplémentaires peuvent être ajoutés via VW_EXTRA_FEEDS="Nom|url;Nom2|url2".
"""
import json
import logging
import os
import re
import calendar
from datetime import datetime, timezone

import feedparser

from .. import db
from . import client, get

log = logging.getLogger("vulnwatch.feeds")
CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.I)
TAG_RE = re.compile(r"<[^>]+>")

DEFAULT_FEEDS = [
    # (source, type, url)
    ("CERT-FR", "alerte", "https://www.cert.ssi.gouv.fr/alerte/feed/"),
    ("CERT-FR", "avis", "https://www.cert.ssi.gouv.fr/avis/feed/"),
    ("CERT-FR", "actualite", "https://www.cert.ssi.gouv.fr/actualite/feed/"),
    ("Ubuntu", "usn", "https://ubuntu.com/security/notices/rss.xml"),
    ("CISA", "advisory", "https://www.cisa.gov/cybersecurity-advisories/all.xml"),
    ("ZDI", "advisory", "https://www.zerodayinitiative.com/rss/published/"),
    # Correctifs publiés par les éditeurs (page « Correctifs »)
    ("Microsoft", "correctif", "https://api.msrc.microsoft.com/update-guide/rss"),
    ("Fortinet", "correctif", "https://filestore.fortinet.com/fortiguard/rss/ir.xml"),
    ("Cisco", "correctif", "https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml"),
    ("Palo Alto", "correctif", "https://security.paloaltonetworks.com/rss.xml"),
    ("Debian", "correctif", "https://www.debian.org/security/dsa"),
    ("PHP", "version", "https://www.php.net/releases/feed.php"),
]


def feeds() -> list[tuple[str, str, str]]:
    out = list(DEFAULT_FEEDS)
    for part in os.environ.get("VW_EXTRA_FEEDS", "").split(";"):
        if "|" in part:
            name, url = part.split("|", 1)
            out.append((name.strip(), "rss", url.strip()))
    return out


def _date(entry) -> str | None:
    for k in ("published_parsed", "updated_parsed"):
        t = entry.get(k)
        if t:
            return datetime.fromtimestamp(calendar.timegm(t), tz=timezone.utc).replace(microsecond=0).isoformat()
    return None


def _certfr_details(cl, link: str) -> dict:
    """CERT-FR publie une version JSON de chaque bulletin (liste exhaustive des CVE)."""
    try:
        data = get(cl, link.rstrip("/") + "/json/", retries=2, backoff=2).json()
    except Exception:
        return {}
    cves = [c.get("name") for c in data.get("cves", []) or [] if c.get("name")]
    systems = [s.get("description") for s in data.get("affected_systems", []) or [] if s.get("description")]
    risks = [r.get("description") for r in data.get("risks", []) or [] if r.get("description")]
    summary = data.get("summary") or ""
    if risks:
        summary = (summary + "\n\nRisques : " + ", ".join(risks)).strip()
    if systems:
        summary += "\n\nSystèmes affectés :\n- " + "\n- ".join(systems[:30])
    return {"cves": cves, "summary": summary.strip(), "id": data.get("reference")}


def sync() -> tuple[int, int]:
    total = new = 0
    errors = []
    with client() as cl:
        for source, kind, url in feeds():
            try:
                parsed = feedparser.parse(get(cl, url, retries=2).content)
            except Exception as e:
                errors.append(f"{source}/{kind}: {e}")
                continue
            total += len(parsed.entries)
            for entry in parsed.entries[:100]:
                link = entry.get("link") or entry.get("id")
                if not link:
                    continue
                bid = entry.get("id") or link
                conn = db.connect()
                if conn.execute("SELECT 1 FROM bulletins WHERE id=? OR link=?", (bid, link)).fetchone():
                    continue
                title = TAG_RE.sub("", entry.get("title", "")).strip()
                summary = TAG_RE.sub("", entry.get("summary", "") or "").strip()
                cves = sorted({c.upper() for c in CVE_RE.findall(title + " " + summary)})
                if source == "CERT-FR" and kind in ("alerte", "avis"):
                    det = _certfr_details(cl, link)
                    if det.get("cves"):
                        cves = sorted(set(cves) | set(det["cves"]))
                    if det.get("summary"):
                        summary = det["summary"]
                with db.tx() as c:
                    c.execute(
                        """INSERT OR IGNORE INTO bulletins(id, source, kind, title, summary, link, published, cves, first_seen)
                           VALUES (?,?,?,?,?,?,?,?,?)""",
                        (bid, source, kind, title, summary[:8000], link, _date(entry), json.dumps(cves), db.now_iso()),
                    )
                new += 1
    if errors and len(errors) == len(feeds()):
        raise RuntimeError("; ".join(errors))
    if errors:
        log.warning("Flux en erreur : %s", "; ".join(errors))
    return total, new

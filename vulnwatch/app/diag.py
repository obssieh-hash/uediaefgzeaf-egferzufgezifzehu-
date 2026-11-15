"""Diagnostic : vérifie l'accès Internet aux API et l'état de la base.

Usage sur la VM :   sudo vulnwatch-diag
"""
import os
import sqlite3
import sys

ENV_FILE = "/etc/vulnwatch/vulnwatch.env"


def load_env():
    if not os.path.exists(ENV_FILE):
        print(f"! {ENV_FILE} introuvable (install.sh a-t-il été lancé ?)")
        return
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_env()

from . import config  # noqa: E402  (après chargement de l'environnement)
from .sources import client  # noqa: E402

G, R, Y, N = "\033[32m", "\033[31m", "\033[33m", "\033[0m"

TESTS = [
    ("NVD (NIST)", "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-6387"),
    ("CISA KEV", "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"),
    ("FIRST EPSS", "https://api.first.org/data/v1/epss?cve=CVE-2024-6387"),
    ("GitHub Advisories", "https://api.github.com/advisories?per_page=1"),
    ("CERT-FR", "https://www.cert.ssi.gouv.fr/alerte/feed/"),
    ("Ubuntu USN", "https://ubuntu.com/security/notices/rss.xml"),
]


def main():
    print("\n== Réseau ==")
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    print(f"Proxy HTTPS : {proxy or 'aucun'}")
    print(f"Clé NVD     : {'configurée' if config.NVD_API_KEY else 'absente (synchro lente)'}")
    ok_all = True
    with client() as cl:
        for name, url in TESTS:
            headers = {"apiKey": config.NVD_API_KEY} if "nvd" in url and config.NVD_API_KEY else {}
            try:
                r = cl.get(url, headers=headers, timeout=25)
                good = r.status_code == 200
                ok_all &= good
                print(f"{G if good else R}{'OK ' if good else 'ERR'}{N} {name:20} HTTP {r.status_code}"
                      + ("" if good else f"  {r.text[:120]!r}"))
            except Exception as e:
                ok_all = False
                print(f"{R}ERR{N} {name:20} {type(e).__name__}: {e}")
    if not ok_all:
        print(f"\n{Y}→ Si tout est en erreur : la VM n'a pas accès à Internet (DNS, passerelle, pare-feu)"
              f"\n  ou elle passe par un proxy : renseignez HTTPS_PROXY / HTTP_PROXY dans {ENV_FILE}"
              f"\n  puis : sudo systemctl restart vulnwatch{N}")

    print("\n== Base de données ==")
    if not os.path.exists(config.DB_PATH):
        print(f"{R}Base absente{N} : {config.DB_PATH}")
        return
    c = sqlite3.connect(config.DB_PATH)
    for label, sql in [("Vulnérabilités", "SELECT COUNT(*) FROM vulns"), ("dont KEV", "SELECT COUNT(*) FROM vulns WHERE kev=1"),
                       ("Correspondances périmètre", "SELECT COUNT(*) FROM matches"), ("Bulletins", "SELECT COUNT(*) FROM bulletins")]:
        print(f"{label:28} {c.execute(sql).fetchone()[0]}")
    print("\n== Dernières synchronisations ==")
    for src, st, start, items, msg in c.execute(
            "SELECT source, status, started_at, items, message FROM sync_log ORDER BY id DESC LIMIT 15"):
        col = G if st == "ok" else R if st == "error" else Y
        print(f"{col}{st:8}{N} {start[:19]}  {src:28} {items:>6}  {(msg or '')[:110]}")
    print()


if __name__ == "__main__":
    sys.exit(main())

"""Couche SQLite : schéma, connexions et helpers."""
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS vulns (
    id              TEXT PRIMARY KEY,           -- CVE-xxxx-yyyy ou GHSA-xxxx
    aliases         TEXT DEFAULT '[]',          -- JSON : autres identifiants (GHSA <-> CVE)
    title           TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    cvss_score      REAL,
    cvss_version    TEXT,
    cvss_vector     TEXT,
    severity        TEXT,                        -- CRITICAL / HIGH / MEDIUM / LOW / NONE
    cwe             TEXT DEFAULT '[]',
    products        TEXT DEFAULT '[]',          -- JSON : ["vendor:product", ...] (CPE ou écosystème)
    refs            TEXT DEFAULT '[]',          -- JSON : [{"url":..., "tags":[...]}]
    sources         TEXT DEFAULT '[]',          -- JSON : ["nvd","github",...]
    published       TEXT,
    modified        TEXT,
    vuln_status     TEXT,                        -- statut NVD (Analyzed, Awaiting Analysis...)
    epss            REAL,
    epss_percentile REAL,
    epss_date       TEXT,
    kev             INTEGER DEFAULT 0,
    kev_added       TEXT,
    kev_due         TEXT,
    kev_ransomware  TEXT,
    kev_action      TEXT,
    first_seen      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vulns_published ON vulns(published);
CREATE INDEX IF NOT EXISTS idx_vulns_first_seen ON vulns(first_seen);
CREATE INDEX IF NOT EXISTS idx_vulns_kev ON vulns(kev);

CREATE TABLE IF NOT EXISTS watchlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    keywords    TEXT DEFAULT '',     -- séparés par des virgules (recherche dans la description)
    cpes        TEXT DEFAULT '',     -- vendor:product séparés par des virgules (ex: php:php)
    min_cvss    REAL DEFAULT 0,
    enabled     INTEGER DEFAULT 1,
    backfilled  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    vuln_id     TEXT NOT NULL,
    watch_id    INTEGER NOT NULL,
    matched_at  TEXT NOT NULL,
    notified    INTEGER DEFAULT 0,
    PRIMARY KEY (vuln_id, watch_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_watch ON matches(watch_id);

CREATE TABLE IF NOT EXISTS triage (
    vuln_id     TEXT PRIMARY KEY,
    status      TEXT DEFAULT 'new',  -- new / analysis / action / done / na
    note        TEXT DEFAULT '',
    updated_by  TEXT,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS bulletins (
    id          TEXT PRIMARY KEY,    -- lien ou identifiant (CERTFR-2025-ALE-001...)
    source      TEXT NOT NULL,
    kind        TEXT DEFAULT '',     -- alerte / avis / actualite / usn ...
    title       TEXT NOT NULL,
    summary     TEXT DEFAULT '',
    link        TEXT,
    published   TEXT,
    cves        TEXT DEFAULT '[]',
    first_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bulletins_published ON bulletins(published);

CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT,                -- ok / error / running
    items       INTEGER DEFAULT 0,
    message     TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT
);
"""

DEFAULT_WATCHLIST = [
    # (nom, mots-clés, cpes, cvss min)
    ("PHP", "PHP versions,php-fpm,php-cgi,PHP before,PHP 8,PHP 7", "php:php", 0),
    ("OpenSSH", "OpenSSH", "openbsd:openssh", 0),
    ("OpenSSL", "OpenSSL", "openssl:openssl", 0),
    ("Apache HTTP Server", "Apache HTTP Server,mod_proxy,mod_rewrite", "apache:http_server", 0),
    ("Nginx", "nginx", "f5:nginx,nginx:nginx", 0),
    ("Linux Kernel", "Linux kernel", "linux:linux_kernel", 7.0),
    ("Fortinet FortiOS", "FortiOS,FortiGate,FortiProxy", "fortinet:fortios,fortinet:fortiproxy", 0),
    ("Microsoft Exchange", "Microsoft Exchange Server", "microsoft:exchange_server", 0),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(os.path.dirname(os.path.abspath(config.DB_PATH)), exist_ok=True)
        conn = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db() -> None:
    with tx() as c:
        c.executescript(SCHEMA)
        if not kv_get("seeded"):
            for name, kw, cpes, mn in DEFAULT_WATCHLIST:
                c.execute(
                    "INSERT INTO watchlist(name, keywords, cpes, min_cvss, created_at) VALUES (?,?,?,?,?)",
                    (name, kw, cpes, mn, now_iso()),
                )
            c.execute("INSERT OR REPLACE INTO kv(k, v) VALUES ('seeded', '1')")


def kv_get(key: str, default=None):
    row = connect().execute("SELECT v FROM kv WHERE k=?", (key,)).fetchone()
    return row["v"] if row else default


def kv_set(key: str, value: str) -> None:
    with tx() as c:
        c.execute("INSERT OR REPLACE INTO kv(k, v) VALUES (?, ?)", (key, value))


def jl(value) -> list:
    """Décode une colonne JSON de type liste."""
    if not value:
        return []
    try:
        v = json.loads(value)
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def merge_list(old_json: str, new_items) -> str:
    seen = jl(old_json)
    for it in new_items or []:
        if it not in seen:
            seen.append(it)
    return json.dumps(seen)


def upsert_vuln(c: sqlite3.Connection, v: dict, source: str) -> bool:
    """Insère ou fusionne une vulnérabilité. Retourne True si elle est nouvelle."""
    ts = now_iso()
    row = c.execute("SELECT * FROM vulns WHERE id=?", (v["id"],)).fetchone()
    if row is None:
        c.execute(
            """INSERT INTO vulns(id, aliases, title, description, cvss_score, cvss_version, cvss_vector, severity,
                   cwe, products, refs, sources, published, modified, vuln_status, first_seen, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                v["id"], json.dumps(v.get("aliases", [])), v.get("title", ""), v.get("description", ""),
                v.get("cvss_score"), v.get("cvss_version"), v.get("cvss_vector"), v.get("severity"),
                json.dumps(v.get("cwe", [])), json.dumps(v.get("products", [])), json.dumps(v.get("refs", [])),
                json.dumps([source]), v.get("published"), v.get("modified"), v.get("vuln_status"), ts, ts,
            ),
        )
        return True

    # Fusion : NVD fait foi pour le score CVSS ; les autres sources complètent les champs vides.
    authoritative = source == "nvd"
    def pick(field):
        new = v.get(field)
        old = row[field]
        if new in (None, "", []):
            return old
        if authoritative or old in (None, ""):
            return new
        return old

    refs_old = jl(row["refs"])
    known_urls = {r.get("url") for r in refs_old if isinstance(r, dict)}
    for r in v.get("refs", []):
        if r.get("url") not in known_urls:
            refs_old.append(r)
            known_urls.add(r.get("url"))

    c.execute(
        """UPDATE vulns SET aliases=?, title=?, description=?, cvss_score=?, cvss_version=?, cvss_vector=?,
               severity=?, cwe=?, products=?, refs=?, sources=?, published=?, modified=?, vuln_status=?, updated_at=?
           WHERE id=?""",
        (
            merge_list(row["aliases"], v.get("aliases")), pick("title"), pick("description"),
            pick("cvss_score"), pick("cvss_version"), pick("cvss_vector"), pick("severity"),
            merge_list(row["cwe"], v.get("cwe")), merge_list(row["products"], v.get("products")),
            json.dumps(refs_old[:200]), merge_list(row["sources"], [source]),
            row["published"] or v.get("published"), v.get("modified") or row["modified"],
            v.get("vuln_status") or row["vuln_status"], ts, v["id"],
        ),
    )
    return False


def log_start(source: str) -> int:
    with tx() as c:
        cur = c.execute(
            "INSERT INTO sync_log(source, started_at, status) VALUES (?,?, 'running')", (source, now_iso())
        )
        return cur.lastrowid


def log_end(log_id: int, status: str, items: int = 0, message: str = "") -> None:
    with tx() as c:
        c.execute(
            "UPDATE sync_log SET finished_at=?, status=?, items=?, message=? WHERE id=?",
            (now_iso(), status, items, message[:1000], log_id),
        )
        # Garde un historique raisonnable
        c.execute("DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 500)")

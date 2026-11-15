"""VulnWatch — application web de veille des vulnérabilités pour CERT/CSIRT."""
import base64
import csv
import hashlib
import hmac
import io
import logging
import os
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db, engine, notify

logging.basicConfig(level=os.environ.get("VW_LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("vulnwatch")
STATIC = os.path.join(os.path.dirname(__file__), "static")
COOKIE = "vw_session"
_stop = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if not config.ADMIN_PASSWORD:
        log.warning("VW_ADMIN_PASSWORD non défini : interface accessible SANS authentification !")
    if os.environ.get("VW_NO_SCHEDULER") != "1":
        threading.Thread(target=engine.scheduler_loop, args=(_stop,), daemon=True, name="scheduler").start()
    yield
    _stop.set()


app = FastAPI(title=config.APP_NAME, lifespan=lifespan, docs_url="/api/docs", redoc_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'")
    return resp


# ---------------------------------------------------------------- Authentification

def _sign(payload: str) -> str:
    return hmac.new(config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(user: str) -> str:
    exp = int(time.time()) + config.SESSION_HOURS * 3600
    payload = base64.urlsafe_b64encode(f"{user}|{exp}".encode()).decode()
    return f"{payload}.{_sign(payload)}"


def read_token(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        user, exp = base64.urlsafe_b64decode(payload.encode()).decode().split("|")
    except Exception:
        return None
    return user if int(exp) > time.time() else None


def auth(request: Request) -> str:
    if not config.ADMIN_PASSWORD:
        return "anonyme"
    user = read_token(request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(401, "Authentification requise")
    return user


_fails: dict[str, list[float]] = {}


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else "?"
    now = time.time()
    attempts = [t for t in _fails.get(ip, []) if now - t < 900]
    if len(attempts) >= 10:
        raise HTTPException(429, "Trop de tentatives, réessayez dans 15 minutes")
    ok = hmac.compare_digest(body.username.encode(), config.ADMIN_USER.encode()) & hmac.compare_digest(
        body.password.encode(), config.ADMIN_PASSWORD.encode())
    if not ok:
        attempts.append(now)
        _fails[ip] = attempts
        log.warning("Échec de connexion depuis %s", ip)
        raise HTTPException(401, "Identifiants invalides")
    _fails.pop(ip, None)
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, make_token(body.username), httponly=True, samesite="strict", secure=secure,
                        max_age=config.SESSION_HOURS * 3600)
    return {"user": body.username}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    user = read_token(request.cookies.get(COOKIE)) if config.ADMIN_PASSWORD else "anonyme"
    return {"user": user, "auth_required": bool(config.ADMIN_PASSWORD), "app": config.APP_NAME, "org": config.ORG_NAME}


# ---------------------------------------------------------------- Helpers

PRIO = engine.PRIORITY_SQL
TRIAGE_STATUS = {"new": "Nouveau", "analysis": "En analyse", "action": "Action requise", "done": "Traité", "na": "Non applicable"}


def _row_to_vuln(r, full: bool = False) -> dict:
    d = {
        "id": r["id"], "title": r["title"], "cvss_score": r["cvss_score"], "severity": r["severity"],
        "cvss_version": r["cvss_version"], "epss": r["epss"], "epss_percentile": r["epss_percentile"],
        "kev": bool(r["kev"]), "kev_due": r["kev_due"], "kev_added": r["kev_added"], "published": r["published"], "modified": r["modified"],
        "first_seen": r["first_seen"], "sources": db.jl(r["sources"]), "priority": r["prio"],
        "products": db.jl(r["products"])[:8], "status": r["status"] or "new",
        "watches": [w for w in (r["watches"] or "").split("\x1f") if w],
        "description": r["description"] if full else (r["description"] or "")[:280],
    }
    if full:
        d.update({
            "aliases": db.jl(r["aliases"]), "cvss_vector": r["cvss_vector"], "cwe": db.jl(r["cwe"]),
            "products": db.jl(r["products"]), "refs": db.jl(r["refs"]), "vuln_status": r["vuln_status"],
            "kev_added": r["kev_added"], "kev_ransomware": r["kev_ransomware"], "kev_action": r["kev_action"],
            "epss_date": r["epss_date"], "note": r["note"] or "", "triage_by": r["updated_by"],
            "triage_at": r["triage_at"],
        })
    return d


BASE_SELECT = f"""
SELECT v.*, {PRIO} AS prio, t.status, t.note, t.updated_by, t.updated_at AS triage_at,
       (SELECT group_concat(w.name, char(31)) FROM matches m JOIN watchlist w ON w.id=m.watch_id
         WHERE m.vuln_id=v.id) AS watches
FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id
"""


def _filters(q, severity, priority, kev, watch, status, days, source, scope):
    where, params = [], []
    if q:
        like = f"%{q.strip()}%"
        where.append("(v.id LIKE ? OR v.title LIKE ? OR v.description LIKE ? OR v.aliases LIKE ? OR v.products LIKE ?)")
        params += [like] * 5
    if severity:
        sev = [s.upper() for s in severity.split(",") if s]
        where.append(f"v.severity IN ({','.join('?' * len(sev))})")
        params += sev
    if priority:
        pr = [int(p) for p in priority.split(",") if p.isdigit()]
        if pr:
            where.append(f"{PRIO} IN ({','.join('?' * len(pr))})")
            params += pr
    if kev:
        where.append("v.kev=1")
    if watch:
        where.append("EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id AND m.watch_id=?)")
        params.append(watch)
    elif scope == "watch":
        where.append("EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id)")
    if status:
        st = status.split(",")
        cond = f"COALESCE(t.status,'new') IN ({','.join('?' * len(st))})"
        where.append(cond)
        params += st
    if days:
        since = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
        where.append("(COALESCE(v.published, v.first_seen) >= ? OR v.kev_added >= ?)")
        params += [since, since[:10]]
    if source:
        where.append("v.sources LIKE ?")
        params.append(f'%"{source}"%')
    return (" WHERE " + " AND ".join(where)) if where else "", params


SORTS = {
    "published": "COALESCE(v.published, v.first_seen) DESC",
    "priority": f"{PRIO} ASC, COALESCE(v.published, v.first_seen) DESC",
    "cvss": "v.cvss_score IS NULL, v.cvss_score DESC, v.published DESC",
    "epss": "v.epss IS NULL, v.epss DESC",
    "kev": "v.kev_added IS NULL, v.kev_added DESC",
    "first_seen": "v.first_seen DESC",
}


# ---------------------------------------------------------------- API : tableau de bord

@app.get("/api/stats")
def stats(user: str = Depends(auth)):
    c = db.connect()
    now = datetime.now(timezone.utc)
    d1 = (now - timedelta(days=1)).isoformat()
    d7 = (now - timedelta(days=7)).isoformat()
    d30 = (now - timedelta(days=30)).isoformat()

    def one(sql, *p):
        return c.execute(sql, p).fetchone()[0]

    in_scope = "EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id)"
    kpi = {
        "total": one("SELECT COUNT(*) FROM vulns"),
        "new_24h": one("SELECT COUNT(*) FROM vulns v WHERE COALESCE(v.published, v.first_seen) >= ?", d1),
        "critical_7d": one("SELECT COUNT(*) FROM vulns v WHERE v.severity='CRITICAL' AND v.published >= ?", d7),
        "kev_total": one("SELECT COUNT(*) FROM vulns WHERE kev=1"),
        "kev_30d": one("SELECT COUNT(*) FROM vulns WHERE kev=1 AND kev_added >= ?", d30[:10]),
        "scope_total": one(f"SELECT COUNT(*) FROM vulns v WHERE {in_scope}"),
        "scope_7d": one(f"SELECT COUNT(*) FROM vulns v WHERE {in_scope} AND COALESCE(v.published, v.first_seen) >= ?", d7),
        "scope_p1": one(f"SELECT COUNT(*) FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id WHERE {in_scope} "
                        f"AND {PRIO}=1 AND COALESCE(t.status,'new') NOT IN ('done','na')"),
        "to_triage": one(f"SELECT COUNT(*) FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id WHERE {in_scope} "
                         f"AND {PRIO}<=2 AND COALESCE(t.status,'new')='new'"),
        "bulletins_7d": one("SELECT COUNT(*) FROM bulletins WHERE published >= ?", d7),
    }
    # Chronologie 14 jours par sévérité
    days = [(now - timedelta(days=i)).date().isoformat() for i in range(13, -1, -1)]
    rows = c.execute(
        "SELECT substr(published,1,10) d, COALESCE(severity,'NONE') s, COUNT(*) n FROM vulns "
        "WHERE published >= ? GROUP BY d, s", (days[0],)).fetchall()
    timeline = {d: {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "NONE": 0} for d in days}
    for r in rows:
        if r["d"] in timeline:
            timeline[r["d"]][r["s"] if r["s"] in timeline[r["d"]] else "NONE"] += r["n"]

    watches = [dict(r) for r in c.execute(
        f"""SELECT w.id, w.name, COUNT(m.vuln_id) total,
                   SUM(CASE WHEN COALESCE(v.published, v.first_seen) >= ? THEN 1 ELSE 0 END) recent,
                   SUM(CASE WHEN {PRIO}=1 THEN 1 ELSE 0 END) p1,
                   SUM(CASE WHEN v.kev=1 THEN 1 ELSE 0 END) kev,
                   MAX(v.cvss_score) max_cvss
            FROM watchlist w LEFT JOIN matches m ON m.watch_id=w.id LEFT JOIN vulns v ON v.id=m.vuln_id
            WHERE w.enabled=1 GROUP BY w.id ORDER BY recent DESC, total DESC""", (d30,)).fetchall()]

    top = [_row_to_vuln(r) for r in c.execute(
        BASE_SELECT + f" WHERE {in_scope} AND COALESCE(t.status,'new') NOT IN ('done','na') "
        f"AND COALESCE(v.published, v.first_seen) >= ? ORDER BY prio ASC, v.cvss_score DESC, v.published DESC LIMIT 10",
        (d30,)).fetchall()]
    kev_recent = [_row_to_vuln(r) for r in c.execute(
        BASE_SELECT + " WHERE v.kev=1 ORDER BY v.kev_added DESC LIMIT 8").fetchall()]
    bulletins = [_bulletin(r) for r in c.execute(
        "SELECT * FROM bulletins ORDER BY published DESC LIMIT 6").fetchall()]
    errors = [dict(r) for r in c.execute(
        """SELECT l.source, l.message, l.started_at FROM sync_log l
           WHERE l.id IN (SELECT MAX(id) FROM sync_log GROUP BY source) AND l.status='error'""").fetchall()]
    return {"first_sync_done": db.kv_get("first_sync_done") is not None, "errors": errors,
            "kpi": kpi, "timeline": timeline, "watches": watches, "top": top, "kev_recent": kev_recent,
            "bulletins": bulletins, "last_sync": db.kv_get("last_sync"), "sync": engine.state}


# ---------------------------------------------------------------- API : vulnérabilités

@app.get("/api/vulns")
def list_vulns(q: str = "", severity: str = "", priority: str = "", kev: bool = False, watch: int | None = None,
               status: str = "", days: int | None = None, source: str = "", scope: str = "watch",
               sort: str = "published", page: int = 1, per_page: int = 50, user: str = Depends(auth)):
    per_page = max(1, min(per_page, 200))
    where, params = _filters(q, severity, priority, kev, watch, status, days, source, scope)
    c = db.connect()
    total = c.execute(f"SELECT COUNT(*) FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id {where}", params).fetchone()[0]
    rows = c.execute(f"{BASE_SELECT} {where} ORDER BY {SORTS.get(sort, SORTS['published'])} LIMIT ? OFFSET ?",
                     params + [per_page, (max(page, 1) - 1) * per_page]).fetchall()
    return {"total": total, "page": page, "per_page": per_page, "items": [_row_to_vuln(r) for r in rows]}


@app.get("/api/export.csv")
def export_csv(q: str = "", severity: str = "", priority: str = "", kev: bool = False, watch: int | None = None,
               status: str = "", days: int | None = None, source: str = "", scope: str = "watch",
               sort: str = "published", user: str = Depends(auth)):
    where, params = _filters(q, severity, priority, kev, watch, status, days, source, scope)
    rows = db.connect().execute(
        f"{BASE_SELECT} {where} ORDER BY {SORTS.get(sort, SORTS['published'])} LIMIT 20000", params).fetchall()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["ID", "Priorité", "CVSS", "Sévérité", "EPSS", "KEV", "Échéance KEV", "Publié", "Produits surveillés",
                "Statut", "Titre", "Description", "Lien"])
    for r in rows:
        v = _row_to_vuln(r, full=True)
        w.writerow([v["id"], f"P{v['priority']}", v["cvss_score"] or "", v["severity"] or "",
                    f"{v['epss']:.4f}" if v["epss"] is not None else "", "oui" if v["kev"] else "non",
                    v["kev_due"] or "", (v["published"] or "")[:10], ", ".join(v["watches"]),
                    TRIAGE_STATUS.get(v["status"], v["status"]), v["title"] or "", (v["description"] or "").replace("\n", " "),
                    f"https://nvd.nist.gov/vuln/detail/{v['id']}" if v["id"].startswith("CVE-") else
                    f"https://github.com/advisories/{v['id']}"])
    data = "﻿" + buf.getvalue()  # BOM pour ouverture correcte dans Excel
    name = f"vulnwatch-{datetime.now().strftime('%Y%m%d-%H%M')}.csv"
    return StreamingResponse(iter([data]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/vulns/{vid}")
def get_vuln(vid: str, user: str = Depends(auth)):
    c = db.connect()
    r = c.execute(BASE_SELECT + " WHERE v.id=? OR v.aliases LIKE ?", (vid, f'%"{vid}"%')).fetchone()
    if not r:
        raise HTTPException(404, "Vulnérabilité inconnue")
    v = _row_to_vuln(r, full=True)
    ids = [v["id"]] + v["aliases"]
    v["bulletins"] = [_bulletin(b) for b in c.execute(
        "SELECT * FROM bulletins WHERE " + " OR ".join(["cves LIKE ?"] * len(ids)) + " ORDER BY published DESC",
        [f'%"{i}"%' for i in ids]).fetchall()]
    return v


class TriageIn(BaseModel):
    status: str = Field(pattern="^(new|analysis|action|done|na)$")
    note: str = Field(default="", max_length=5000)


@app.put("/api/vulns/{vid}/triage")
def set_triage(vid: str, body: TriageIn, user: str = Depends(auth)):
    with db.tx() as c:
        if not c.execute("SELECT 1 FROM vulns WHERE id=?", (vid,)).fetchone():
            raise HTTPException(404, "Vulnérabilité inconnue")
        c.execute("INSERT OR REPLACE INTO triage(vuln_id, status, note, updated_by, updated_at) VALUES (?,?,?,?,?)",
                  (vid, body.status, body.note, user, db.now_iso()))
    return {"ok": True}


# ---------------------------------------------------------------- API : liste de veille

class WatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    keywords: str = Field(default="", max_length=1000)
    cpes: str = Field(default="", max_length=1000)
    min_cvss: float = Field(default=0, ge=0, le=10)
    enabled: bool = True


@app.get("/api/watchlist")
def list_watch(user: str = Depends(auth)):
    rows = db.connect().execute(
        f"""SELECT w.*, COUNT(m.vuln_id) total, SUM(CASE WHEN {PRIO}<=2 THEN 1 ELSE 0 END) high,
                   SUM(CASE WHEN v.kev=1 THEN 1 ELSE 0 END) kev, MAX(COALESCE(v.published, v.first_seen)) last
            FROM watchlist w LEFT JOIN matches m ON m.watch_id=w.id LEFT JOIN vulns v ON v.id=m.vuln_id
            GROUP BY w.id ORDER BY w.name COLLATE NOCASE""").fetchall()
    return [dict(r) for r in rows]


def _rematch_async(wid: int):
    def job():
        with db.tx() as c:
            c.execute("DELETE FROM matches WHERE watch_id=?", (wid,))
        engine.run_matching(watch_id=wid, silent=True)
    threading.Thread(target=job, daemon=True).start()


@app.post("/api/watchlist")
def add_watch(body: WatchIn, user: str = Depends(auth)):
    with db.tx() as c:
        cur = c.execute("INSERT INTO watchlist(name, keywords, cpes, min_cvss, enabled, created_at) VALUES (?,?,?,?,?,?)",
                        (body.name.strip(), body.keywords.strip(), body.cpes.strip().lower(), body.min_cvss,
                         int(body.enabled), db.now_iso()))
        wid = cur.lastrowid
    _rematch_async(wid)  # correspondances immédiates sur les données locales
    return {"id": wid, "info": "Ajouté. L'historique NVD sera récupéré à la prochaine synchronisation."}


@app.put("/api/watchlist/{wid}")
def update_watch(wid: int, body: WatchIn, user: str = Depends(auth)):
    with db.tx() as c:
        old = c.execute("SELECT * FROM watchlist WHERE id=?", (wid,)).fetchone()
        if not old:
            raise HTTPException(404, "Élément inconnu")
        crit_changed = old["cpes"] != body.cpes.strip().lower() or old["keywords"] != body.keywords.strip()
        c.execute("UPDATE watchlist SET name=?, keywords=?, cpes=?, min_cvss=?, enabled=?, backfilled=? WHERE id=?",
                  (body.name.strip(), body.keywords.strip(), body.cpes.strip().lower(), body.min_cvss,
                   int(body.enabled), 0 if crit_changed else old["backfilled"], wid))
    _rematch_async(wid)
    return {"ok": True}


@app.delete("/api/watchlist/{wid}")
def delete_watch(wid: int, user: str = Depends(auth)):
    with db.tx() as c:
        c.execute("DELETE FROM matches WHERE watch_id=?", (wid,))
        c.execute("DELETE FROM watchlist WHERE id=?", (wid,))
    return {"ok": True}


# ---------------------------------------------------------------- API : bulletins

def _bulletin(r) -> dict:
    return {"id": r["id"], "source": r["source"], "kind": r["kind"], "title": r["title"], "summary": r["summary"],
            "link": r["link"], "published": r["published"], "cves": db.jl(r["cves"])}


@app.get("/api/bulletins")
def list_bulletins(q: str = "", source: str = "", page: int = 1, per_page: int = 30, user: str = Depends(auth)):
    where, params = [], []
    if q:
        where.append("(title LIKE ? OR summary LIKE ? OR cves LIKE ?)")
        params += [f"%{q}%"] * 3
    if source:
        where.append("source=?")
        params.append(source)
    w = (" WHERE " + " AND ".join(where)) if where else ""
    c = db.connect()
    total = c.execute(f"SELECT COUNT(*) FROM bulletins{w}", params).fetchone()[0]
    rows = c.execute(f"SELECT * FROM bulletins{w} ORDER BY published DESC LIMIT ? OFFSET ?",
                     params + [per_page, (max(page, 1) - 1) * per_page]).fetchall()
    sources = [r[0] for r in c.execute("SELECT DISTINCT source FROM bulletins ORDER BY source")]
    # Signale les bulletins qui touchent le périmètre surveillé
    items = []
    for r in rows:
        b = _bulletin(r)
        if b["cves"]:
            marks = ",".join("?" * len(b["cves"]))
            b["in_scope"] = c.execute(f"SELECT COUNT(DISTINCT vuln_id) FROM matches WHERE vuln_id IN ({marks})",
                                      b["cves"]).fetchone()[0]
        else:
            b["in_scope"] = 0
        items.append(b)
    return {"total": total, "items": items, "sources": sources}


# ---------------------------------------------------------------- API : sources & administration

SOURCE_INFO = [
    {"key": "nvd", "name": "NVD (NIST)", "desc": "Base CVE de référence : CVSS, CWE, produits (CPE)",
     "key_env": "NVD_API_KEY", "key_url": "https://nvd.nist.gov/developers/request-an-api-key", "enabled": config.ENABLE_NVD},
    {"key": "kev", "name": "CISA KEV", "desc": "Vulnérabilités activement exploitées", "enabled": config.ENABLE_KEV},
    {"key": "epss", "name": "FIRST EPSS", "desc": "Probabilité d'exploitation à 30 jours", "enabled": config.ENABLE_EPSS},
    {"key": "github", "name": "GitHub Advisories", "desc": "Avis de sécurité des paquets (Composer/PHP, npm, PyPI…)",
     "key_env": "GITHUB_TOKEN", "key_url": "https://github.com/settings/tokens", "enabled": config.ENABLE_GITHUB},
    {"key": "feeds", "name": "Bulletins (RSS)", "desc": "CERT-FR (alertes, avis, actualités), Ubuntu USN, CISA, ZDI",
     "enabled": config.ENABLE_FEEDS},
]


@app.get("/api/sources")
def sources(user: str = Depends(auth)):
    c = db.connect()
    out = []
    for s in SOURCE_INFO:
        last = c.execute("SELECT * FROM sync_log WHERE source=? ORDER BY id DESC LIMIT 1", (s["key"],)).fetchone()
        last_ok = c.execute("SELECT finished_at FROM sync_log WHERE source=? AND status='ok' ORDER BY id DESC LIMIT 1",
                            (s["key"],)).fetchone()
        item = dict(s)
        item["has_key"] = bool(os.environ.get(s["key_env"])) if s.get("key_env") else None
        item["last"] = dict(last) if last else None
        item["last_ok"] = last_ok[0] if last_ok else None
        out.append(item)
    logs = [dict(r) for r in c.execute("SELECT * FROM sync_log ORDER BY id DESC LIMIT 40").fetchall()]
    return {"sources": out, "logs": logs, "state": engine.state, "interval_min": config.SYNC_INTERVAL_MIN,
            "notify_channels": notify.channels(), "notify_min_priority": config.NOTIFY_MIN_PRIORITY,
            "db_size_mb": round(os.path.getsize(config.DB_PATH) / 1e6, 1) if os.path.exists(config.DB_PATH) else 0}


@app.post("/api/sync")
def trigger_sync(user: str = Depends(auth)):
    if engine.state["running"]:
        return {"started": False, "info": "Une synchronisation est déjà en cours"}
    threading.Thread(target=engine.sync_all, daemon=True).start()
    return {"started": True}


@app.post("/api/notify/test")
def test_notify(user: str = Depends(auth)):
    if not notify.enabled():
        raise HTTPException(400, "Aucun canal de notification configuré (voir /etc/vulnwatch/vulnwatch.env)")
    errors = notify.send("✅ Test de notification", f"Message de test envoyé par {config.APP_NAME} ({user}).", 4,
                         config.BASE_URL or None, {"Canaux": ", ".join(notify.channels())})
    return {"ok": not errors, "errors": errors}


@app.get("/api/health")
def health():
    return {"status": "ok", "last_sync": db.kv_get("last_sync"),
            "sync": {"running": engine.state["running"], "current": engine.state["current"]}}


# ---------------------------------------------------------------- Interface web

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})


@app.exception_handler(sqlite3.OperationalError)
async def db_error(request: Request, exc):
    log.error("Erreur base de données : %s", exc)
    return JSONResponse({"detail": "Erreur base de données"}, status_code=500)

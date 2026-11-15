"""CERT-ANSIE — application web de veille des vulnérabilités pour CERT/CSIRT."""
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

from . import config, db, engine, notify, users

logging.basicConfig(level=os.environ.get("VW_LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("vulnwatch")
STATIC = os.path.join(os.path.dirname(__file__), "static")
COOKIE = "certansie_session"
APP_VERSION = "2.0.0"
_stop = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    users.bootstrap()
    if os.environ.get("VW_NO_SCHEDULER") != "1":
        threading.Thread(target=engine.scheduler_loop, args=(_stop,), daemon=True, name="scheduler").start()
    yield
    _stop.set()


app = FastAPI(title=config.APP_NAME, version=APP_VERSION, lifespan=lifespan, docs_url="/api/docs", redoc_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Protection CSRF : toute requête qui modifie l'état doit porter l'en-tête ajouté par l'interface
    if (request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/")
            and request.headers.get("x-requested-with") != "CERT-ANSIE"):
        return JSONResponse({"detail": "Requête refusée (protection CSRF)"}, status_code=403)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------- Authentification

def _sign(payload: str) -> str:
    return hmac.new(config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(u) -> str:
    exp = int(time.time()) + config.SESSION_HOURS * 3600
    payload = base64.urlsafe_b64encode(f"{u['id']}|{u['token_version']}|{exp}".encode()).decode()
    return f"{payload}.{_sign(payload)}"


def read_token(token: str | None):
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        uid, tv, exp = base64.urlsafe_b64decode(payload.encode()).decode().split("|")
        if int(exp) < time.time():
            return None
        return int(uid), int(tv)
    except Exception:
        return None


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def current_user(request: Request) -> dict | None:
    tok = read_token(request.cookies.get(COOKIE))
    if not tok:
        return None
    u = users.get(tok[0])
    if u is None or not u["active"] or u["token_version"] != tok[1]:
        return None
    d = users.public(u)
    d["perms"] = sorted(users.PERMISSIONS.get(u["role"], set()))
    return d


def _set_cookie(request: Request, response: Response, u) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, make_token(u), httponly=True, samesite="strict", secure=secure,
                        max_age=config.SESSION_HOURS * 3600)


def auth_any(request: Request) -> dict:
    """Utilisateur connecté, même s'il doit encore changer son mot de passe."""
    u = current_user(request)
    if not u:
        raise HTTPException(401, "Authentification requise")
    return u


def auth(request: Request) -> dict:
    u = auth_any(request)
    if u["must_change"]:
        raise HTTPException(403, "Vous devez d'abord changer votre mot de passe")
    return u


def require(perm: str):
    def dep(user: dict = Depends(auth)) -> dict:
        if perm not in user["perms"]:
            raise HTTPException(403, "Droits insuffisants pour cette action")
        return user
    return dep


_fails: dict[str, list[float]] = {}


class LoginIn(BaseModel):
    username: str = Field(max_length=120)
    password: str = Field(max_length=256)


def _me_payload(u: dict | None) -> dict:
    return {"authenticated": bool(u), "user": u, "app": config.APP_NAME, "org": config.ORG_NAME,
            "classification": config.CLASSIFICATION, "version": APP_VERSION,
            "roles": {k: v["label"] for k, v in users.ROLES.items()}}


@app.post("/api/login")
def login(body: LoginIn, request: Request, response: Response):
    ip = client_ip(request)
    now = time.time()
    attempts = [t for t in _fails.get(ip, []) if now - t < 900]
    if len(attempts) >= 20:
        raise HTTPException(429, "Trop de tentatives depuis votre poste, réessayez dans 15 minutes")
    u, err = users.authenticate(body.username, body.password, ip)
    if not u:
        attempts.append(now)
        _fails[ip] = attempts
        log.warning("Échec de connexion '%s' depuis %s", body.username, ip)
        raise HTTPException(401, err)
    _fails.pop(ip, None)
    _set_cookie(request, response, u)
    return _me_payload(current_user_from_row(u))


def current_user_from_row(u) -> dict:
    d = users.public(u)
    d["perms"] = sorted(users.PERMISSIONS.get(u["role"], set()))
    return d


@app.post("/api/logout")
def logout(request: Request, response: Response):
    u = current_user(request)
    if u:
        users.audit(u["username"], "logout", u["username"], "", client_ip(request))
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return _me_payload(current_user(request))


class ProfileIn(BaseModel):
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=200)


@app.put("/api/me")
def update_me(body: ProfileIn, request: Request, user: dict = Depends(auth)):
    with db.tx() as c:
        c.execute("UPDATE users SET full_name=?, email=? WHERE id=?", (body.full_name.strip(), body.email.strip(), user["id"]))
    users.audit(user["username"], "profile.update", user["username"], "", client_ip(request))
    return {"ok": True}


class PasswordIn(BaseModel):
    current: str = Field(max_length=256)
    new: str = Field(max_length=256)


@app.post("/api/me/password")
def change_password(body: PasswordIn, request: Request, response: Response, user: dict = Depends(auth_any)):
    row = users.get(user["id"])
    if not users.verify_password(body.current, row["pw_hash"]):
        users.audit(user["username"], "password.change_fail", user["username"], "mot de passe actuel incorrect", client_ip(request))
        raise HTTPException(400, "Mot de passe actuel incorrect")
    problems = users.password_problems(body.new, user["username"])
    if problems:
        raise HTTPException(400, "Mot de passe trop faible : " + ", ".join(problems))
    if body.new == body.current:
        raise HTTPException(400, "Le nouveau mot de passe doit être différent de l'actuel")
    users.set_password(user["id"], body.new, must_change=False)
    users.audit(user["username"], "password.change", user["username"], "", client_ip(request))
    _set_cookie(request, response, users.get(user["id"]))  # les autres sessions sont révoquées
    return {"ok": True}


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
        "assignee_id": r["assignee_id"], "assignee_name": r["assignee_name"], "due_date": r["due_date"],
        "overdue": bool(r["due_date"] and r["due_date"] < datetime.now(timezone.utc).date().isoformat()
                        and (r["status"] or "new") not in ("done", "na")),
        "watches": [w for w in (r["watches"] or "").split("\x1f") if w],
        "description": r["description"] if full else (r["description"] or "")[:280],
    }
    if full:
        d.update({
            "aliases": db.jl(r["aliases"]), "cvss_vector": r["cvss_vector"], "cwe": db.jl(r["cwe"]),
            "products": db.jl(r["products"]), "refs": db.jl(r["refs"]), "vuln_status": r["vuln_status"],
            "kev_added": r["kev_added"], "kev_ransomware": r["kev_ransomware"], "kev_action": r["kev_action"],
            "epss_date": r["epss_date"], "note": r["note"] or "", "triage_by": r["updated_by"],
            "triage_at": r["triage_at"], "assigned_by": r["assigned_by"], "assigned_at": r["assigned_at"],
        })
    return d


BASE_SELECT = f"""
SELECT v.*, {PRIO} AS prio, t.status, t.note, t.updated_by, t.updated_at AS triage_at,
       t.assignee_id, t.due_date, t.assigned_by, t.assigned_at, COALESCE(NULLIF(u.full_name,''), u.username) AS assignee_name,
       (SELECT group_concat(w.name, char(31)) FROM matches m JOIN watchlist w ON w.id=m.watch_id
         WHERE m.vuln_id=v.id) AS watches
FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id LEFT JOIN users u ON u.id=t.assignee_id
"""


def _filters(q, severity, priority, kev, watch, status, days, source, scope, assignee=None, user=None, overdue=False):
    where, params = [], []
    if assignee:
        if assignee == "me" and user:
            where.append("t.assignee_id=?")
            params.append(user["id"])
        elif assignee == "none":
            where.append("t.assignee_id IS NULL")
        elif str(assignee).isdigit():
            where.append("t.assignee_id=?")
            params.append(int(assignee))
        scope = "all" if scope == "watch" else scope
    if overdue:
        where.append("t.due_date < ? AND COALESCE(t.status,'new') NOT IN ('done','na')")
        params.append(datetime.now(timezone.utc).date().isoformat())
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
def stats(user: dict = Depends(auth)):
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
        "my_open": one("SELECT COUNT(*) FROM triage WHERE assignee_id=? AND status NOT IN ('done','na')", user["id"]),
        "my_overdue": one("SELECT COUNT(*) FROM triage WHERE assignee_id=? AND status NOT IN ('done','na') AND due_date < ?",
                          user["id"], now.date().isoformat()),
        "overdue_total": one("SELECT COUNT(*) FROM triage WHERE assignee_id IS NOT NULL AND status NOT IN ('done','na') "
                             "AND due_date < ?", now.date().isoformat()),
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
    my_tasks = [_row_to_vuln(r) for r in c.execute(
        BASE_SELECT + " WHERE t.assignee_id=? AND t.status NOT IN ('done','na') "
        "ORDER BY t.due_date IS NULL, t.due_date ASC, prio ASC LIMIT 10", (user["id"],)).fetchall()]
    return {"first_sync_done": db.kv_get("first_sync_done") is not None, "errors": errors, "my_tasks": my_tasks,
            "kpi": kpi, "timeline": timeline, "watches": watches, "top": top, "kev_recent": kev_recent,
            "bulletins": bulletins, "last_sync": db.kv_get("last_sync"), "sync": engine.state}


# ---------------------------------------------------------------- API : vulnérabilités

@app.get("/api/vulns")
def list_vulns(q: str = "", severity: str = "", priority: str = "", kev: bool = False, watch: int | None = None,
               status: str = "", days: int | None = None, source: str = "", scope: str = "watch",
               sort: str = "published", page: int = 1, per_page: int = 50, assignee: str = "", overdue: bool = False,
               user: dict = Depends(auth)):
    per_page = max(1, min(per_page, 200))
    where, params = _filters(q, severity, priority, kev, watch, status, days, source, scope, assignee, user, overdue)
    c = db.connect()
    total = c.execute(f"SELECT COUNT(*) FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id LEFT JOIN users u ON u.id=t.assignee_id {where}", params).fetchone()[0]
    rows = c.execute(f"{BASE_SELECT} {where} ORDER BY {SORTS.get(sort, SORTS['published'])} LIMIT ? OFFSET ?",
                     params + [per_page, (max(page, 1) - 1) * per_page]).fetchall()
    return {"total": total, "page": page, "per_page": per_page, "items": [_row_to_vuln(r) for r in rows]}


@app.get("/api/export.csv")
def export_csv(q: str = "", severity: str = "", priority: str = "", kev: bool = False, watch: int | None = None,
               status: str = "", days: int | None = None, source: str = "", scope: str = "watch",
               sort: str = "published", assignee: str = "", overdue: bool = False,
               request: Request = None, user: dict = Depends(require("export"))):
    where, params = _filters(q, severity, priority, kev, watch, status, days, source, scope, assignee, user, overdue)
    rows = db.connect().execute(
        f"{BASE_SELECT} {where} ORDER BY {SORTS.get(sort, SORTS['published'])} LIMIT 20000", params).fetchall()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["ID", "Priorité", "CVSS", "Sévérité", "EPSS", "KEV", "Échéance KEV", "Publié", "Produits surveillés",
                "Statut", "Assigné à", "Échéance", "Titre", "Description", "Lien"])
    for r in rows:
        v = _row_to_vuln(r, full=True)
        w.writerow([v["id"], f"P{v['priority']}", v["cvss_score"] or "", v["severity"] or "",
                    f"{v['epss']:.4f}" if v["epss"] is not None else "", "oui" if v["kev"] else "non",
                    v["kev_due"] or "", (v["published"] or "")[:10], ", ".join(v["watches"]),
                    TRIAGE_STATUS.get(v["status"], v["status"]), v["assignee_name"] or "", v["due_date"] or "",
                    v["title"] or "", (v["description"] or "").replace("\n", " "),
                    f"https://nvd.nist.gov/vuln/detail/{v['id']}" if v["id"].startswith("CVE-") else
                    f"https://github.com/advisories/{v['id']}"])
    data = "﻿" + buf.getvalue()  # BOM pour ouverture correcte dans Excel
    users.audit(user["username"], "export.csv", "", f"{len(rows)} lignes", client_ip(request) if request else "")
    name = f"cert-ansie-{datetime.now().strftime('%Y%m%d-%H%M')}.csv"
    return StreamingResponse(iter([data]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/vulns/{vid}")
def get_vuln(vid: str, user: dict = Depends(auth)):
    c = db.connect()
    r = c.execute(BASE_SELECT + " WHERE v.id=? OR v.aliases LIKE ?", (vid, f'%"{vid}"%')).fetchone()
    if not r:
        raise HTTPException(404, "Vulnérabilité inconnue")
    v = _row_to_vuln(r, full=True)
    ids = [v["id"]] + v["aliases"]
    v["bulletins"] = [_bulletin(b) for b in c.execute(
        "SELECT * FROM bulletins WHERE " + " OR ".join(["cves LIKE ?"] * len(ids)) + " ORDER BY published DESC",
        [f'%"{i}"%' for i in ids]).fetchall()]
    v["history"] = [dict(h) for h in c.execute(
        "SELECT ts, username, action, details FROM audit WHERE target=? AND action LIKE 'triage.%' ORDER BY id DESC LIMIT 50",
        (v["id"],)).fetchall()]
    me_ = user
    v["can_edit"] = "triage.all" in me_["perms"] or ("triage.assigned" in me_["perms"] and v["assignee_id"] == me_["id"])
    v["can_assign"] = "assign" in me_["perms"]
    return v


class TriageIn(BaseModel):
    status: str = Field(pattern="^(new|analysis|action|done|na)$")
    note: str = Field(default="", max_length=5000)
    assignee_id: int | None = None
    due_date: str | None = Field(default=None, pattern=r"^(\d{4}-\d{2}-\d{2})?$")


@app.put("/api/vulns/{vid}/triage")
def set_triage(vid: str, body: TriageIn, request: Request, user: dict = Depends(auth)):
    ip = client_ip(request)
    with db.tx() as c:
        v = c.execute("SELECT id, title FROM vulns WHERE id=?", (vid,)).fetchone()
        if not v:
            raise HTTPException(404, "Vulnérabilité inconnue")
        old = c.execute("SELECT * FROM triage WHERE vuln_id=?", (vid,)).fetchone()
        old_assignee = old["assignee_id"] if old else None
        full = "triage.all" in user["perms"]
        if not full and not ("triage.assigned" in user["perms"] and old_assignee == user["id"]):
            raise HTTPException(403, "Vous ne pouvez mettre à jour que les actions qui vous sont assignées")
        assignee, due = old_assignee, (old["due_date"] if old else None)
        assigned_by, assigned_at = (old["assigned_by"], old["assigned_at"]) if old else (None, None)
        if "assign" in user["perms"]:
            if body.assignee_id is not None and body.assignee_id != 0:
                target = users.get(body.assignee_id)
                if not target or not target["active"]:
                    raise HTTPException(400, "Compte assigné inconnu ou désactivé")
            new_assignee = body.assignee_id or None
            if new_assignee != old_assignee:
                assigned_by, assigned_at = user["username"], db.now_iso()
            assignee, due = new_assignee, (body.due_date or None)
        c.execute("""INSERT OR REPLACE INTO triage(vuln_id, status, note, updated_by, updated_at, assignee_id, due_date,
                         assigned_by, assigned_at) VALUES (?,?,?,?,?,?,?,?,?)""",
                  (vid, body.status, body.note, user["username"], db.now_iso(), assignee, due, assigned_by, assigned_at))
    changes = []
    if not old or old["status"] != body.status:
        changes.append(f"statut → {TRIAGE_STATUS[body.status]}")
    if (old["note"] if old else "") != body.note:
        changes.append("note mise à jour")
    if (old["due_date"] if old else None) != due:
        changes.append(f"échéance → {due or 'aucune'}")
    if changes:
        users.audit(user["username"], "triage.update", vid, ", ".join(changes), ip)
    if assignee != old_assignee:
        target = users.get(assignee) if assignee else None
        users.audit(user["username"], "triage.assign", vid,
                    f"assignée à {target['full_name'] or target['username']}" if target else "assignation retirée", ip)
        if target and target["email"]:
            link = f"{config.BASE_URL.rstrip('/')}/#/vuln/{vid}" if config.BASE_URL else None
            threading.Thread(target=notify.email_to, daemon=True, args=(
                target["email"], f"Action de remédiation assignée : {vid}",
                f"{user['full_name']} vous a assigné le traitement de {vid}" + (f" ({v['title']})" if v["title"] else "") + ".",
                link, {"Échéance": due or "non définie", "Statut": TRIAGE_STATUS[body.status]})).start()
    return {"ok": True}


@app.get("/api/assignees")
def assignees(user: dict = Depends(auth)):
    rows = db.connect().execute(
        "SELECT id, username, full_name, role FROM users WHERE active=1 AND role != 'reader' ORDER BY full_name COLLATE NOCASE").fetchall()
    return [{"id": r["id"], "name": r["full_name"] or r["username"], "role": r["role"],
             "role_label": users.ROLES[r["role"]]["label"]} for r in rows]


# ---------------------------------------------------------------- API : liste de veille

class WatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    keywords: str = Field(default="", max_length=1000)
    cpes: str = Field(default="", max_length=1000)
    min_cvss: float = Field(default=0, ge=0, le=10)
    enabled: bool = True


@app.get("/api/watchlist")
def list_watch(user: dict = Depends(auth)):
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
def add_watch(body: WatchIn, request: Request, user: dict = Depends(require("watch.edit"))):
    with db.tx() as c:
        cur = c.execute("INSERT INTO watchlist(name, keywords, cpes, min_cvss, enabled, created_at) VALUES (?,?,?,?,?,?)",
                        (body.name.strip(), body.keywords.strip(), body.cpes.strip().lower(), body.min_cvss,
                         int(body.enabled), db.now_iso()))
        wid = cur.lastrowid
    users.audit(user["username"], "watch.create", body.name, f"cpe={body.cpes} mots-clés={body.keywords}", client_ip(request))
    _rematch_async(wid)  # correspondances immédiates sur les données locales
    return {"id": wid, "info": "Ajouté. L'historique NVD sera récupéré à la prochaine synchronisation."}


@app.put("/api/watchlist/{wid}")
def update_watch(wid: int, body: WatchIn, request: Request, user: dict = Depends(require("watch.edit"))):
    with db.tx() as c:
        old = c.execute("SELECT * FROM watchlist WHERE id=?", (wid,)).fetchone()
        if not old:
            raise HTTPException(404, "Élément inconnu")
        crit_changed = old["cpes"] != body.cpes.strip().lower() or old["keywords"] != body.keywords.strip()
        c.execute("UPDATE watchlist SET name=?, keywords=?, cpes=?, min_cvss=?, enabled=?, backfilled=? WHERE id=?",
                  (body.name.strip(), body.keywords.strip(), body.cpes.strip().lower(), body.min_cvss,
                   int(body.enabled), 0 if crit_changed else old["backfilled"], wid))
    users.audit(user["username"], "watch.update", body.name, f"cpe={body.cpes} mots-clés={body.keywords} actif={body.enabled}", client_ip(request))
    _rematch_async(wid)
    return {"ok": True}


@app.delete("/api/watchlist/{wid}")
def delete_watch(wid: int, request: Request, user: dict = Depends(require("watch.edit"))):
    with db.tx() as c:
        w = c.execute("SELECT name FROM watchlist WHERE id=?", (wid,)).fetchone()
        users.audit(user["username"], "watch.delete", w["name"] if w else str(wid), "", client_ip(request))
        c.execute("DELETE FROM matches WHERE watch_id=?", (wid,))
        c.execute("DELETE FROM watchlist WHERE id=?", (wid,))
    return {"ok": True}


# ---------------------------------------------------------------- API : bulletins

def _bulletin(r) -> dict:
    return {"id": r["id"], "source": r["source"], "kind": r["kind"], "title": r["title"], "summary": r["summary"],
            "link": r["link"], "published": r["published"], "cves": db.jl(r["cves"])}


@app.get("/api/bulletins")
def list_bulletins(q: str = "", source: str = "", page: int = 1, per_page: int = 30, user: dict = Depends(auth)):
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
def sources(user: dict = Depends(auth)):
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
def trigger_sync(request: Request, user: dict = Depends(require("sync"))):
    if engine.state["running"]:
        return {"started": False, "info": "Une synchronisation est déjà en cours"}
    users.audit(user["username"], "sync.start", "", "", client_ip(request))
    threading.Thread(target=engine.sync_all, daemon=True).start()
    return {"started": True}


@app.post("/api/notify/test")
def test_notify(user: dict = Depends(require("notify.test"))):
    if not notify.enabled():
        raise HTTPException(400, "Aucun canal de notification configuré (voir /etc/vulnwatch/vulnwatch.env)")
    errors = notify.send("✅ Test de notification", f"Message de test envoyé par {config.APP_NAME} ({user['username']}).", 4,
                         config.BASE_URL or None, {"Canaux": ", ".join(notify.channels())})
    return {"ok": not errors, "errors": errors}


# ---------------------------------------------------------------- API : rapport de veille

@app.get("/api/report")
def report(days: int = 7, user: dict = Depends(auth)):
    days = max(1, min(days, 90))
    c = db.connect()
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()
    in_scope = "EXISTS (SELECT 1 FROM matches m WHERE m.vuln_id=v.id)"
    in_period = "(COALESCE(v.published, v.first_seen) >= ? OR v.kev_added >= ?)"
    pp = (since, since[:10])

    def one(sql, *p):
        return c.execute(sql, p).fetchone()[0]

    kpi = {
        "cve_new": one("SELECT COUNT(*) FROM vulns v WHERE v.id LIKE 'CVE-%' AND v.published >= ?", since),
        "critical_new": one("SELECT COUNT(*) FROM vulns v WHERE v.severity='CRITICAL' AND v.published >= ?", since),
        "scope_new": one(f"SELECT COUNT(*) FROM vulns v WHERE {in_scope} AND {in_period}", *pp),
        "p1": one(f"SELECT COUNT(*) FROM vulns v WHERE {in_scope} AND {in_period} AND {PRIO}=1", *pp),
        "p2": one(f"SELECT COUNT(*) FROM vulns v WHERE {in_scope} AND {in_period} AND {PRIO}=2", *pp),
        "kev_new": one("SELECT COUNT(*) FROM vulns WHERE kev=1 AND kev_added >= ?", since[:10]),
        "kev_new_scope": one(f"SELECT COUNT(*) FROM vulns v WHERE kev=1 AND kev_added >= ? AND {in_scope}", since[:10]),
        "certfr_alertes": one("SELECT COUNT(*) FROM bulletins WHERE source='CERT-FR' AND kind='alerte' AND published >= ?", since),
        "certfr_avis": one("SELECT COUNT(*) FROM bulletins WHERE source='CERT-FR' AND kind='avis' AND published >= ?", since),
    }
    by_watch = [dict(r) for r in c.execute(
        f"""SELECT w.name, COUNT(v.id) total, SUM(CASE WHEN {PRIO}=1 THEN 1 ELSE 0 END) p1,
                   SUM(CASE WHEN {PRIO}=2 THEN 1 ELSE 0 END) p2, SUM(v.kev) kev, MAX(v.cvss_score) max_cvss
            FROM watchlist w JOIN matches m ON m.watch_id=w.id JOIN vulns v ON v.id=m.vuln_id
            WHERE {in_period} GROUP BY w.id ORDER BY p1 DESC, p2 DESC, total DESC""", pp).fetchall()]
    priority_items = [_row_to_vuln(r) for r in c.execute(
        BASE_SELECT + f" WHERE {in_scope} AND {in_period} AND {PRIO}<=2 "
        "ORDER BY prio ASC, v.cvss_score DESC LIMIT 60", pp).fetchall()]
    kev_new = [_row_to_vuln(r) for r in c.execute(
        BASE_SELECT + " WHERE v.kev=1 AND v.kev_added >= ? ORDER BY v.kev_added DESC LIMIT 40", (since[:10],)).fetchall()]
    bulletins = [_bulletin(r) for r in c.execute(
        "SELECT * FROM bulletins WHERE source='CERT-FR' AND kind IN ('alerte','avis') AND published >= ? "
        "ORDER BY kind='alerte' DESC, published DESC LIMIT 60", (since,)).fetchall()]
    triage = {r[0]: r[1] for r in c.execute(
        f"""SELECT COALESCE(t.status,'new'), COUNT(*) FROM vulns v LEFT JOIN triage t ON t.vuln_id=v.id
            WHERE {in_scope} AND {PRIO}<=2 GROUP BY 1""").fetchall()}
    return {"days": days, "start": since, "end": now.isoformat(), "generated_by": user["full_name"],
            "org": config.ORG_NAME, "app": config.APP_NAME, "classification": config.CLASSIFICATION,
            "kpi": kpi, "by_watch": by_watch, "priority_items": priority_items, "kev_new": kev_new,
            "bulletins": bulletins, "triage": triage}


# ---------------------------------------------------------------- API : comptes utilisateurs (administrateurs)

class UserIn(BaseModel):
    username: str = Field(min_length=2, max_length=60, pattern=r"^[A-Za-z0-9._@-]+$")
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=200)
    role: str = Field(pattern="^(admin|analyst|netadmin|developer|reader)$")
    password: str = Field(default="", max_length=256)


class UserUpdate(BaseModel):
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=200)
    role: str = Field(pattern="^(admin|analyst|netadmin|developer|reader)$")
    active: bool = True


@app.get("/api/users")
def list_users(user: dict = Depends(require("users.manage"))):
    c = db.connect()
    out = []
    for r in c.execute("SELECT * FROM users ORDER BY role='admin' DESC, full_name COLLATE NOCASE").fetchall():
        d = users.public(r)
        d["open_tasks"] = c.execute("SELECT COUNT(*) FROM triage WHERE assignee_id=? AND status NOT IN ('done','na')",
                                    (r["id"],)).fetchone()[0]
        out.append(d)
    return {"users": out, "roles": users.ROLES}


@app.post("/api/users")
def create_user(body: UserIn, request: Request, user: dict = Depends(require("users.manage"))):
    if users.by_username(body.username):
        raise HTTPException(400, "Cet identifiant existe déjà")
    temp = body.password or users.generate_password()
    problems = users.password_problems(temp, body.username)
    if problems:
        raise HTTPException(400, "Mot de passe trop faible : " + ", ".join(problems))
    uid = users.create(body.username, temp, body.role, body.full_name, body.email, must_change=True,
                       created_by=user["username"])
    users.audit(user["username"], "user.create", body.username, f"rôle {users.ROLES[body.role]['label']}", client_ip(request))
    return {"id": uid, "temp_password": temp}


@app.put("/api/users/{uid}")
def update_user(uid: int, body: UserUpdate, request: Request, user: dict = Depends(require("users.manage"))):
    old = users.get(uid)
    if not old:
        raise HTTPException(404, "Compte inconnu")
    if uid == user["id"] and (body.role != "admin" or not body.active):
        raise HTTPException(400, "Vous ne pouvez pas retirer vos propres droits d'administrateur ni désactiver votre compte")
    if old["role"] == "admin" and (body.role != "admin" or not body.active) and users.active_admins(exclude_id=uid) == 0:
        raise HTTPException(400, "Il doit rester au moins un administrateur actif")
    revoke = (old["role"] != body.role) or (bool(old["active"]) and not body.active)
    with db.tx() as c:
        c.execute("UPDATE users SET full_name=?, email=?, role=?, active=?, token_version=token_version+? WHERE id=?",
                  (body.full_name.strip(), body.email.strip(), body.role, int(body.active), int(revoke), uid))
    changes = []
    if old["role"] != body.role:
        changes.append(f"rôle {users.ROLES[old['role']]['label']} → {users.ROLES[body.role]['label']}")
    if bool(old["active"]) != body.active:
        changes.append("activé" if body.active else "désactivé")
    users.audit(user["username"], "user.update", old["username"], ", ".join(changes) or "profil", client_ip(request))
    return {"ok": True}


@app.post("/api/users/{uid}/reset-password")
def reset_password(uid: int, request: Request, user: dict = Depends(require("users.manage"))):
    old = users.get(uid)
    if not old:
        raise HTTPException(404, "Compte inconnu")
    temp = users.generate_password()
    users.set_password(uid, temp, must_change=True)
    users.audit(user["username"], "user.reset_password", old["username"], "", client_ip(request))
    return {"temp_password": temp}


@app.post("/api/users/{uid}/unlock")
def unlock_user(uid: int, request: Request, user: dict = Depends(require("users.manage"))):
    old = users.get(uid)
    if not old:
        raise HTTPException(404, "Compte inconnu")
    with db.tx() as c:
        c.execute("UPDATE users SET locked_until=NULL, failed_count=0 WHERE id=?", (uid,))
    users.audit(user["username"], "user.unlock", old["username"], "", client_ip(request))
    return {"ok": True}


@app.delete("/api/users/{uid}")
def delete_user(uid: int, request: Request, user: dict = Depends(require("users.manage"))):
    old = users.get(uid)
    if not old:
        raise HTTPException(404, "Compte inconnu")
    if uid == user["id"]:
        raise HTTPException(400, "Vous ne pouvez pas supprimer votre propre compte")
    if old["role"] == "admin" and users.active_admins(exclude_id=uid) == 0:
        raise HTTPException(400, "Il doit rester au moins un administrateur actif")
    with db.tx() as c:
        c.execute("UPDATE triage SET assignee_id=NULL WHERE assignee_id=?", (uid,))
        c.execute("DELETE FROM users WHERE id=?", (uid,))
    users.audit(user["username"], "user.delete", old["username"], "actions assignées libérées", client_ip(request))
    return {"ok": True}


@app.get("/api/audit")
def audit_log(q: str = "", username: str = "", action: str = "", page: int = 1, per_page: int = 50,
              user: dict = Depends(require("audit.read"))):
    per_page = max(1, min(per_page, 200))
    where, params = [], []
    if q:
        where.append("(target LIKE ? OR details LIKE ? OR ip LIKE ?)")
        params += [f"%{q}%"] * 3
    if username:
        where.append("username=?")
        params.append(username)
    if action:
        where.append("action LIKE ?")
        params.append(f"{action}%")
    w = (" WHERE " + " AND ".join(where)) if where else ""
    c = db.connect()
    total = c.execute(f"SELECT COUNT(*) FROM audit{w}", params).fetchone()[0]
    rows = c.execute(f"SELECT * FROM audit{w} ORDER BY id DESC LIMIT ? OFFSET ?",
                     params + [per_page, (max(page, 1) - 1) * per_page]).fetchall()
    names = [r[0] for r in c.execute("SELECT DISTINCT username FROM audit ORDER BY username")]
    return {"total": total, "items": [dict(r) for r in rows], "usernames": names}


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

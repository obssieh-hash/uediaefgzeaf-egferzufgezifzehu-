"""Comptes utilisateurs, rôles, mots de passe (scrypt) et journal d'audit."""
import hashlib
import hmac
import logging
import re
import secrets
import string
from datetime import datetime, timedelta, timezone

from . import config, db

log = logging.getLogger("vulnwatch.users")

ROLES = {
    "admin": {"label": "Administrateur", "desc": "Accès complet : comptes utilisateurs, configuration, qualification et journal d'audit."},
    "analyst": {"label": "Analyste SSI", "desc": "Qualifie les vulnérabilités, gère le périmètre surveillé et assigne les actions de remédiation."},
    "netadmin": {"label": "Administrateur réseau", "desc": "Consulte la veille et traite les actions de remédiation qui lui sont assignées."},
    "developer": {"label": "Développeur", "desc": "Consulte la veille et traite les actions de remédiation qui lui sont assignées."},
    "reader": {"label": "Lecteur", "desc": "Consultation et rapports uniquement (direction, auditeurs)."},
}

PERMISSIONS = {
    "admin": {"triage.all", "triage.assigned", "assign", "watch.edit", "sync", "notify.test", "users.manage", "audit.read", "export", "report.send"},
    "analyst": {"triage.all", "triage.assigned", "assign", "watch.edit", "sync", "export", "report.send"},
    "netadmin": {"triage.assigned", "export"},
    "developer": {"triage.assigned", "export"},
    "reader": {"export"},
}

MAX_FAILED = 5
LOCK_MINUTES = 15


# ---------------------------------------------------------------- mots de passe

def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 2 ** 14, 8, 1
    h = hashlib.scrypt(pw.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str | None) -> bool:
    try:
        algo, n, r, p, salt, h = (stored or "").split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(h) // 2)
        return hmac.compare_digest(calc.hex(), h)
    except (ValueError, TypeError):
        return False


_DUMMY = hash_password(secrets.token_hex(8))


def password_problems(pw: str, username: str = "") -> list[str]:
    errs = []
    if len(pw) < 12:
        errs.append("au moins 12 caractères")
    classes = sum(bool(re.search(p, pw)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    if classes < 3:
        errs.append("au moins 3 types de caractères parmi minuscules, majuscules, chiffres, symboles")
    if username and len(username) >= 3 and username.lower() in pw.lower():
        errs.append("ne doit pas contenir l'identifiant")
    return errs


def generate_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "-_!@#%+="
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if not password_problems(pw):
            return pw


# ---------------------------------------------------------------- audit

def audit(username: str | None, action: str, target: str = "", details: str = "", ip: str = "") -> None:
    try:
        with db.tx() as c:
            c.execute("INSERT INTO audit(ts, username, action, target, details, ip) VALUES (?,?,?,?,?,?)",
                      (db.now_iso(), username or "-", action, target or "", (details or "")[:2000], ip or ""))
    except Exception as e:  # l'audit ne doit jamais casser une action
        log.error("Audit impossible : %s", e)


# ---------------------------------------------------------------- comptes

def public(u) -> dict:
    if u is None:
        return None
    return {
        "id": u["id"], "username": u["username"], "full_name": u["full_name"] or u["username"], "email": u["email"] or "",
        "role": u["role"], "role_label": ROLES.get(u["role"], {}).get("label", u["role"]), "active": bool(u["active"]),
        "must_change": bool(u["must_change"]), "last_login": u["last_login"], "last_ip": u["last_ip"],
        "created_at": u["created_at"], "created_by": u["created_by"],
        "locked": bool(u["locked_until"] and u["locked_until"] > db.now_iso()),
    }


def get(user_id: int):
    return db.connect().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def by_username(username: str):
    return db.connect().execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username.strip(),)).fetchone()


def active_admins(exclude_id: int | None = None) -> int:
    return db.connect().execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND id != ?",
                                (exclude_id or -1,)).fetchone()[0]


def create(username: str, password: str, role: str, full_name: str = "", email: str = "",
           must_change: bool = True, created_by: str = "système") -> int:
    with db.tx() as c:
        cur = c.execute(
            """INSERT INTO users(username, full_name, email, role, pw_hash, active, must_change, token_version,
                                 failed_count, created_at, created_by) VALUES (?,?,?,?,?,1,?,1,0,?,?)""",
            (username.strip(), full_name.strip(), email.strip(), role, hash_password(password), int(must_change),
             db.now_iso(), created_by))
        return cur.lastrowid


def set_password(user_id: int, password: str, must_change: bool) -> None:
    with db.tx() as c:
        c.execute("""UPDATE users SET pw_hash=?, must_change=?, token_version=token_version+1, failed_count=0,
                     locked_until=NULL WHERE id=?""", (hash_password(password), int(must_change), user_id))


def authenticate(username: str, password: str, ip: str):
    """Retourne (user, erreur)."""
    u = by_username(username)
    if u is None:
        verify_password(password, _DUMMY)  # temps constant
        audit(username, "login.fail", username, "compte inconnu", ip)
        return None, "Identifiants invalides"
    if u["locked_until"] and u["locked_until"] > db.now_iso():
        audit(u["username"], "login.locked", u["username"], "", ip)
        return None, f"Compte verrouillé temporairement après {MAX_FAILED} échecs. Réessayez plus tard ou contactez un administrateur."
    if not verify_password(password, u["pw_hash"]):
        failed = (u["failed_count"] or 0) + 1
        locked = None
        if failed >= MAX_FAILED:
            locked = (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).replace(microsecond=0).isoformat()
            failed = 0
        with db.tx() as c:
            c.execute("UPDATE users SET failed_count=?, locked_until=? WHERE id=?", (failed, locked, u["id"]))
        audit(u["username"], "login.fail", u["username"], "verrouillage" if locked else f"échec {failed}/{MAX_FAILED}", ip)
        return None, "Identifiants invalides"
    if not u["active"]:
        audit(u["username"], "login.fail", u["username"], "compte désactivé", ip)
        return None, "Compte désactivé. Contactez un administrateur."
    with db.tx() as c:
        c.execute("UPDATE users SET failed_count=0, locked_until=NULL, last_login=?, last_ip=? WHERE id=?",
                  (db.now_iso(), ip, u["id"]))
    audit(u["username"], "login.ok", u["username"], "", ip)
    return get(u["id"]), None


def bootstrap() -> None:
    """Crée le premier compte administrateur à partir de la configuration si aucun compte n'existe."""
    c = db.connect()
    if c.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        return
    pw = config.ADMIN_PASSWORD
    if not pw:
        pw = generate_password()
        log.warning("Aucun mot de passe VW_ADMIN_PASSWORD : compte '%s' créé avec le mot de passe : %s",
                    config.ADMIN_USER, pw)
    create(config.ADMIN_USER, pw, "admin", "Administrateur", must_change=False, created_by="installation")
    audit("système", "user.create", config.ADMIN_USER, "compte administrateur initial")

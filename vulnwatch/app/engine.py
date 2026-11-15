"""Orchestration : synchronisation des sources, corrélation avec la liste de veille, priorisation, alertes."""
import logging
import re
import threading
import time
import traceback

from . import config, db, notify
from .sources import cveorg, epss, feeds, github, kev, nvd

log = logging.getLogger("vulnwatch.engine")
_lock = threading.Lock()
state = {"running": False, "current": None, "last_run": None}

# Score effectif : CVSS, à défaut une valeur dérivée de la sévérité
EFF_SCORE_SQL = ("COALESCE(v.cvss_score, CASE v.severity WHEN 'CRITICAL' THEN 9.0 WHEN 'HIGH' THEN 7.0 "
                 "WHEN 'MEDIUM' THEN 4.0 WHEN 'LOW' THEN 2.0 ELSE 0 END)")
PRIORITY_SQL = f"""(CASE
    WHEN v.kev=1 OR ({EFF_SCORE_SQL} >= 9.0 AND COALESCE(v.epss,0) >= 0.1) THEN 1
    WHEN {EFF_SCORE_SQL} >= 9.0 OR ({EFF_SCORE_SQL} >= 7.0 AND COALESCE(v.epss,0) >= 0.1) THEN 2
    WHEN {EFF_SCORE_SQL} >= 7.0 THEN 3
    ELSE 4 END)"""


def priority(v) -> int:
    sev_map = {"CRITICAL": 9.0, "HIGH": 7.0, "MEDIUM": 4.0, "LOW": 2.0}
    s = v["cvss_score"] if v["cvss_score"] is not None else sev_map.get(v["severity"] or "", 0)
    e = v["epss"] or 0
    if v["kev"] or (s >= 9 and e >= 0.1):
        return 1
    if s >= 9 or (s >= 7 and e >= 0.1):
        return 2
    if s >= 7:
        return 3
    return 4


# ---------------------------------------------------------------- Corrélation

def _compile(watch) -> tuple[list[re.Pattern], set[str]]:
    kws = [k.strip() for k in (watch["keywords"] or "").split(",") if k.strip()]
    pats = [re.compile(r"(?<![\w-])" + re.escape(k) + r"(?![\w])", re.I) for k in kws]
    cpes = {c.strip().lower() for c in (watch["cpes"] or "").split(",") if ":" in c}
    return pats, cpes


def is_match(watch_compiled, min_cvss, v) -> bool:
    pats, cpes = watch_compiled
    if min_cvss and v["cvss_score"] is not None and v["cvss_score"] < min_cvss and not v["kev"]:
        return False
    prods = set(db.jl(v["products"]))
    if cpes & prods:
        return True
    text = f"{v['title'] or ''} {v['description'] or ''}"
    return any(p.search(text) for p in pats)


def run_matching(watch_id: int | None = None, since: str | None = None, silent: bool = False) -> int:
    """Associe les vulnérabilités aux éléments de veille. silent=True : pas d'alerte (rattrapage)."""
    conn = db.connect()
    q = "SELECT * FROM watchlist WHERE enabled=1" + (" AND id=?" if watch_id else "")
    watches = conn.execute(q, (watch_id,) if watch_id else ()).fetchall()
    if not watches:
        return 0
    compiled = [(w, _compile(w)) for w in watches]
    vq = "SELECT * FROM vulns" + (" WHERE updated_at >= ?" if since else "")
    rows = conn.execute(vq, (since,) if since else ()).fetchall()
    count = 0
    ts = db.now_iso()
    with db.tx() as c:
        for v in rows:
            for w, comp in compiled:
                if is_match(comp, w["min_cvss"], v):
                    cur = c.execute(
                        "INSERT OR IGNORE INTO matches(vuln_id, watch_id, matched_at, notified) VALUES (?,?,?,?)",
                        (v["id"], w["id"], ts, priority(v) if silent else 0),
                    )
                    count += cur.rowcount
    return count


def process_alerts() -> int:
    """Envoie les alertes pour les correspondances nouvelles ou dont la priorité s'est aggravée (ex: ajout KEV)."""
    conn = db.connect()
    rows = conn.execute(
        f"""SELECT v.*, m.watch_id, m.notified, w.name AS watch_name, {PRIORITY_SQL} AS prio
            FROM matches m JOIN vulns v ON v.id=m.vuln_id JOIN watchlist w ON w.id=m.watch_id
            WHERE (m.notified=0 OR {PRIORITY_SQL} < m.notified)"""
    ).fetchall()
    to_send, sent = [], 0
    with db.tx() as c:
        for r in rows:
            escalated = r["notified"] != 0
            if r["prio"] <= config.NOTIFY_MIN_PRIORITY:
                to_send.append((r, escalated))
            c.execute("UPDATE matches SET notified=? WHERE vuln_id=? AND watch_id=?", (r["prio"], r["id"], r["watch_id"]))
    # Regroupe par vulnérabilité (une CVE peut toucher plusieurs éléments de veille)
    grouped: dict[str, dict] = {}
    for r, esc in to_send:
        g = grouped.setdefault(r["id"], {"v": r, "watches": [], "escalated": esc})
        g["watches"].append(r["watch_name"])
    if grouped and notify.enabled():
        for g in sorted(grouped.values(), key=lambda x: x["v"]["prio"])[:50]:
            try:
                notify.send_vuln(g["v"], g["watches"], g["v"]["prio"], g["escalated"])
                sent += 1
            except Exception as e:
                log.error("Notification %s : %s", g["v"]["id"], e)
    return sent


# ---------------------------------------------------------------- Synchronisation

def _step(name: str, fn):
    state["current"] = name
    lid = db.log_start(name)
    t0 = time.time()
    try:
        res = fn()
        items = res[0] if isinstance(res, tuple) else (res or 0)
        msg = ""
        if isinstance(res, tuple) and len(res) > 1 and isinstance(res[1], int):
            msg = f"{res[1]} nouveau(x)"
        db.log_end(lid, "ok", items, f"{msg} — {time.time() - t0:.0f}s".strip(" —"))
        return res
    except Exception as e:
        log.error("Source %s en erreur : %s\n%s", name, e, traceback.format_exc())
        db.log_end(lid, "error", 0, str(e))
        return None


def sync_all() -> bool:
    if not _lock.acquire(blocking=False):
        return False
    state["running"] = True
    try:
        first_run = db.kv_get("first_sync_done") is None
        started = db.now_iso()
        to_enrich: list[str] = []

        # 1) Sources rapides d'abord : l'interface se remplit en quelques secondes
        if config.ENABLE_KEV:
            r = _step("kev", kev.sync)
            if r:
                to_enrich += r[2]
        if config.ENABLE_FEEDS:
            _step("feeds", feeds.sync)
        if config.ENABLE_GITHUB:
            r = _step("github", github.sync)
            if r:
                to_enrich += r[2]
        # Scores immédiats : EPSS + CVE.org/CISA (les CVE du KEV n'ont pas de CVSS par elles-mêmes)
        if config.ENABLE_EPSS:
            _step("epss", epss.sync)
        if config.ENABLE_CVEORG:
            _step("cveorg", cveorg.sync)
        state["current"] = "matching"
        run_matching(since=None if first_run else started, silent=first_run)

        # 2) NVD (plus lent, surtout sans clé API)
        if config.ENABLE_NVD:
            _step("nvd", nvd.sync_recent)
            state["current"] = "matching"
            run_matching(since=None if first_run else started, silent=first_run)

        # 3) Rattrapage historique des nouveaux éléments de veille
        conn = db.connect()
        for w in conn.execute("SELECT * FROM watchlist WHERE enabled=1 AND backfilled=0").fetchall():
            ok = True
            if config.ENABLE_NVD:
                cpes = [c.strip() for c in (w["cpes"] or "").split(",") if c.strip()]
                kws = [k.strip() for k in (w["keywords"] or "").split(",") if k.strip()]
                ok = _step(f"backfill:{w['name']}", lambda: nvd.backfill_watch(cpes, kws)) is not None
            run_matching(watch_id=w["id"], silent=True)
            if ok:  # en cas d'échec réseau, on réessaiera à la prochaine synchro
                with db.tx() as c:
                    c.execute("UPDATE watchlist SET backfilled=1 WHERE id=?", (w["id"],))

        if config.ENABLE_NVD and to_enrich:
            ids = list(dict.fromkeys(to_enrich))[: (200 if config.NVD_API_KEY else 30)]
            _step("nvd-enrich", lambda: nvd.enrich(ids))

        if config.ENABLE_CVEORG:
            _step("cveorg", cveorg.sync)  # nouvelles CVE NVD encore sans score
        state["current"] = "matching"
        run_matching(since=None if first_run else started, silent=first_run)

        if config.ENABLE_EPSS:
            _step("epss", epss.sync)

        state["current"] = "alerts"
        process_alerts()
        db.kv_set("first_sync_done", "1")
        db.kv_set("last_sync", db.now_iso())
        state["last_run"] = db.now_iso()
        return True
    finally:
        state["running"] = False
        state["current"] = None
        _lock.release()


def scheduler_loop(stop: threading.Event):
    time.sleep(5)
    while not stop.is_set():
        try:
            sync_all()
        except Exception as e:  # ne jamais tuer la boucle
            log.exception("Synchronisation : %s", e)
        stop.wait(config.SYNC_INTERVAL_MIN * 60)

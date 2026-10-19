#!/usr/bin/env python3
"""Interface web pour openvasd (OpenVAS Scanner API).

Ce serveur, sans dépendance externe (bibliothèque standard Python 3.9+) :

* sert l'interface statique (``static/``) ;
* fait office de passerelle vers openvasd en ajoutant l'en-tête ``X-API-KEY``
  (ou le certificat client mTLS), ce qui évite tout problème de CORS ;
* enrichit les résultats bruts d'openvasd avec les métadonnées des VTs
  (nom, score CVSS, solution, CVE…), stocke le nom des scans, le suivi de
  remédiation et les scans planifiés dans ``data/state.json`` ;
* propose un mode ``--demo`` avec un openvasd simulé pour essayer l'interface.

Exemples ::

    python3 server.py --demo
    python3 server.py --openvasd http://127.0.0.1:3000 --api-key changeme
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import secrets
import http.server
import json
import math
import os
import random
import re
import socketserver
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")


# --------------------------------------------------------------------------
# CVSS
# --------------------------------------------------------------------------

def _roundup(value: float) -> float:
    i = int(round(value * 100000))
    if i % 10000 == 0:
        return i / 100000.0
    return (math.floor(i / 10000) + 1) / 10.0


def cvss_score(vector: str | None) -> float | None:
    """Calcule le score de base CVSS v3.x ou v2 à partir d'un vecteur."""
    if not vector:
        return None
    parts = dict(p.split(":", 1) for p in vector.split("/") if ":" in p)
    try:
        if vector.startswith("CVSS:3"):
            av = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}[parts["AV"]]
            ac = {"L": 0.77, "H": 0.44}[parts["AC"]]
            changed = parts["S"] == "C"
            pr = {"N": 0.85, "L": 0.68 if changed else 0.62, "H": 0.5 if changed else 0.27}[parts["PR"]]
            ui = {"N": 0.85, "R": 0.62}[parts["UI"]]
            cia = {"H": 0.56, "L": 0.22, "N": 0.0}
            iss = 1 - (1 - cia[parts["C"]]) * (1 - cia[parts["I"]]) * (1 - cia[parts["A"]])
            impact = 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 if changed else 6.42 * iss
            expl = 8.22 * av * ac * pr * ui
            if impact <= 0:
                return 0.0
            if changed:
                return _roundup(min(1.08 * (impact + expl), 10))
            return _roundup(min(impact + expl, 10))
        if "Au" in parts:  # CVSS v2
            av = {"L": 0.395, "A": 0.646, "N": 1.0}[parts["AV"]]
            ac = {"H": 0.35, "M": 0.61, "L": 0.71}[parts["AC"]]
            au = {"M": 0.45, "S": 0.56, "N": 0.704}[parts["Au"]]
            cia = {"N": 0.0, "P": 0.275, "C": 0.660}
            impact = 10.41 * (1 - (1 - cia[parts["C"]]) * (1 - cia[parts["I"]]) * (1 - cia[parts["A"]]))
            expl = 20 * av * ac * au
            f = 0 if impact == 0 else 1.176
            return round(((0.6 * impact) + (0.4 * expl) - 1.5) * f, 1)
    except (KeyError, ValueError):
        return None
    return None


def severity_level(score: float | None, rtype: str = "alarm") -> str:
    if rtype == "error":
        return "error"
    if rtype != "alarm" or score is None or score <= 0:
        return "log"
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    return "low"


# Familles de VTs utiles pour un site web (noms anglais du flux Greenbone,
# et équivalents français du mode démo).
WEB_FAMILIES = re.compile(
    r"web|cgi|http|ssl|tls|product detection|service detection|default accounts|^general$|settings"
    r"|serveurs web|détection|découverte de services|identifiants par défaut|généralités",
    re.IGNORECASE,
)


def compact_vt(vt: dict) -> dict:
    """Réduit un VTData openvasd aux champs utiles pour l'interface."""
    tag = {k: ("" if v is None else str(v)) for k, v in (vt.get("tag") or {}).items()}
    vector = tag.get("severity_vector") or tag.get("cvss_base_vector")
    score = cvss_score(vector)
    if score is None and tag.get("cvss_base"):
        try:
            score = float(tag["cvss_base"])
        except ValueError:
            score = None
    refs = vt.get("references") or []
    return {
        "oid": vt.get("oid"),
        "name": vt.get("name") or vt.get("oid"),
        "family": vt.get("family") or "",
        "category": vt.get("category") or "",
        "summary": tag.get("summary", ""),
        "insight": tag.get("insight", ""),
        "affected": tag.get("affected", ""),
        "impact": tag.get("impact", ""),
        "vuldetect": tag.get("vuldetect", ""),
        "solution": tag.get("solution", ""),
        "solution_type": tag.get("solution_type", ""),
        "qod": tag.get("qod") or "",
        "qod_type": tag.get("qod_type", ""),
        "vector": vector or "",
        "score": score,
        "created": tag.get("creation_date", ""),
        "modified": tag.get("last_modification", ""),
        "cves": [r.get("id") for r in refs if (r.get("class") or "").lower() == "cve"],
        "refs": [{"class": r.get("class"), "id": r.get("id")} for r in refs],
    }


# --------------------------------------------------------------------------
# Persistance locale
# --------------------------------------------------------------------------

class State:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.RLock()
        self.data = {"scans": {}, "tracking": {}, "schedules": [], "notifications": []}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    self.data.update(json.load(fh))
            except (OSError, ValueError):
                pass

    def save(self) -> None:
        with self.lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(self.data, fh, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)

    def notify(self, level: str, title: str, link: str = "") -> None:
        with self.lock:
            self.data["notifications"].insert(0, {
                "id": uuid.uuid4().hex[:8], "level": level, "title": title,
                "link": link, "time": int(time.time()), "read": False,
            })
            del self.data["notifications"][50:]
            self.save()


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------

class BackendError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class OpenvasdBackend:
    """Client HTTP minimal pour l'API openvasd."""

    demo = False

    def __init__(self, base: str, api_key: str | None, cafile=None, cert=None, key=None, insecure=False):
        self.base = base.rstrip("/")
        self.api_key = api_key
        self.ctx = None
        if self.base.startswith("https"):
            self.ctx = ssl.create_default_context(cafile=cafile)
            if insecure:
                self.ctx.check_hostname = False
                self.ctx.verify_mode = ssl.CERT_NONE
            if cert:
                self.ctx.load_cert_chain(cert, key)
        self.vts: dict[str, dict] = {}
        self.vts_state = "pending"
        self.feed_version = ""
        self.api_version = ""

    def request(self, method: str, path: str, body=None, timeout=60):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("X-API-KEY", self.api_key)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=self.ctx) as resp:
                self.feed_version = resp.headers.get("feed-version", self.feed_version)
                self.api_version = resp.headers.get("api-version", self.api_version)
                raw = resp.read()
                if not raw:
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode(errors="replace") or exc.reason
            raise BackendError(exc.code, msg) from None
        except (urllib.error.URLError, OSError) as exc:
            raise BackendError(502, f"openvasd injoignable : {exc}") from None

    # -- santé -------------------------------------------------------------
    def info(self) -> dict:
        ok = True
        try:
            self.request("HEAD", "/scans", timeout=5)
        except BackendError as exc:
            ok = exc.status not in (502, 401)
        return {"connected": ok, "feed_version": self.feed_version, "api_version": self.api_version or "1",
                "vts_state": self.vts_state, "vts_count": len(self.vts)}

    def performance(self):
        try:
            return self.request("GET", "/health/performance")
        except BackendError:
            return []

    # -- VTs ---------------------------------------------------------------
    def load_vts(self, cache_dir: str) -> None:
        """Charge les métadonnées des VTs, puis les recharge à chaque nouveau flux.

        openvasd répond 503 tant qu'il n'a pas fini de lire le flux (plusieurs
        minutes au premier démarrage) : on réessaie sans limite.
        """
        cache = os.path.join(cache_dir, "vts-cache.json")
        loaded_version = None
        while True:
            try:
                self.request("HEAD", "/vts", timeout=30)
            except BackendError:
                pass
            if self.feed_version and self.feed_version != loaded_version:
                if not self.vts:
                    self.vts_state = "loading"
                if self._load_vts_once(cache):
                    loaded_version = self.feed_version
                    self.vts_state = "ready"
                    continue
                time.sleep(30)
                continue
            if not self.feed_version and not self.vts:
                time.sleep(30)
                continue
            time.sleep(1800)

    def _load_vts_once(self, cache: str) -> bool:
        if os.path.exists(cache):
            try:
                with open(cache, encoding="utf-8") as fh:
                    cached = json.load(fh)
                if cached.get("feed_version") == self.feed_version and cached.get("vts"):
                    self.vts = cached["vts"]
                    return True
            except (OSError, ValueError):
                pass
        try:
            raw = self.request("GET", "/vts?information=1", timeout=1800)
        except BackendError:
            return False
        if not raw:
            return False
        self.vts = {v["oid"]: compact_vt(v) for v in raw}
        try:
            tmp = cache + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"feed_version": self.feed_version, "vts": self.vts}, fh)
            os.replace(tmp, cache)
        except OSError:
            pass
        return True

    # -- scans -------------------------------------------------------------
    def list_scans(self):
        return self.request("GET", "/scans") or []

    def create_scan(self, req):
        return self.request("POST", "/scans", req)

    def get_scan(self, sid):
        return self.request("GET", f"/scans/{sid}")

    def status(self, sid):
        return self.request("GET", f"/scans/{sid}/status")

    def results(self, sid):
        return self.request("GET", f"/scans/{sid}/results", timeout=120) or []

    def action(self, sid, action):
        return self.request("POST", f"/scans/{sid}", {"action": action})

    def delete(self, sid):
        return self.request("DELETE", f"/scans/{sid}")

    def preferences(self):
        return self.request("GET", "/scans/preferences") or []

    # -- conteneurs --------------------------------------------------------
    def create_container_scan(self, req):
        return self.request("POST", "/container-image-scanner/scans", req)

    def container_action(self, sid, action):
        return self.request("POST", f"/container-image-scanner/scans/{sid}", {"action": action})

    def container_status(self, sid):
        return self.request("GET", f"/container-image-scanner/scans/{sid}/status")

    def container_results(self, sid):
        return self.request("GET", f"/container-image-scanner/scans/{sid}/results", timeout=120) or []

    def container_delete(self, sid):
        return self.request("DELETE", f"/container-image-scanner/scans/{sid}")

    # -- notus -------------------------------------------------------------
    def notus_os(self):
        return self.request("GET", "/notus") or []

    def notus_run(self, os_name, packages):
        return self.request("POST", "/notus/" + urllib.parse.quote(os_name, safe=""), packages)


# --------------------------------------------------------------------------
# Backend de démonstration
# --------------------------------------------------------------------------

DEMO_VTS = [
    # oid suffix, nom, famille, vecteur, cves, solution_type, port
    ("104869", "Vulnérabilité OpenBSD OpenSSH < 9.3p2 RCE", "Généralités", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", ["CVE-2023-38408"], "VendorFix", "22/tcp"),
    ("104634", "OpenBSD OpenSSH 8.9 - Vulnérabilité de contournement de restriction de sécurité", "Généralités", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", ["CVE-2021-41617"], "VendorFix", "22/tcp"),
    ("114680", "OpenBSD OpenSSH < vulnérabilité RCE 4.4p1, 8.5p1 - 9.7p1 (regreSSHion)", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", ["CVE-2024-6387"], "VendorFix", "22/tcp"),
    ("117839", "Diffie-Hellman Échange de clés éphémère Vulnérabilité DoS (SSH, D(HEat))", "Déni de service", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", ["CVE-2002-20001"], "Mitigation", "22/tcp"),
    ("114946", "OpenBSD OpenSSH 6.8p1 - 9.9p1 Vulnérabilité MitM", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N", ["CVE-2025-26465"], "VendorFix", "22/tcp"),
    ("118572", "OpenBSD OpenSSH < 9.6 Vulnérabilités multiples (attaque Terrapin)", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N", ["CVE-2023-48795", "CVE-2023-51384"], "VendorFix", "22/tcp"),
    ("114238", "Attaques par troncature de préfixe dans la spécification SSH (attaque Terrapin)", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:N", ["CVE-2023-48795"], "VendorFix", "22/tcp"),
    ("117777", "Vulnérabilité de divulgation d'informations OpenSSH (CVE-2016-20012)", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N", ["CVE-2016-20012"], "WillNotFix", "22/tcp"),
    ("104635", "Vulnérabilité OpenBSD OpenSSH < 9.3 en lecture OOB", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:L", ["CVE-2023-28531"], "VendorFix", "22/tcp"),
    ("104611", "OpenBSD OpenSSH 8.7 - Vulnérabilité de contournement des restrictions", "Généralités", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N", ["CVE-2021-36368"], "VendorFix", "22/tcp"),
    ("105611", "Algorithmes de chiffrement faibles pris en charge par SSH", "Chiffrement et SSL/TLS", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N", [], "Mitigation", "22/tcp"),
    ("150623", "Algorithmes MAC faibles pris en charge par SSH", "Chiffrement et SSL/TLS", "AV:N/AC:H/Au:N/C:P/I:N/A:N", [], "Mitigation", "22/tcp"),
    ("117497", "SSL/TLS : protocoles obsolètes TLSv1.0 et TLSv1.1 détectés", "SSL et TLS", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N", ["CVE-2011-3389", "CVE-2015-0204"], "Mitigation", "443/tcp"),
    ("103440", "SSL/TLS : certificat expiré", "SSL et TLS", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N", [], "Mitigation", "443/tcp"),
    ("108440", "SSL/TLS : suites de chiffrement faibles (RC4, 3DES)", "SSL et TLS", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", ["CVE-2016-2183", "CVE-2013-2566"], "Mitigation", "443/tcp"),
    ("112836", "Apache HTTP Server < 2.4.59 Vulnérabilités multiples", "Serveurs web", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", ["CVE-2024-27316", "CVE-2024-24795"], "VendorFix", "80/tcp"),
    ("114567", "Apache HTTP Server < 2.4.60 Contournement de restrictions (mod_rewrite)", "Serveurs web", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", ["CVE-2024-38476", "CVE-2024-38474"], "VendorFix", "80/tcp"),
    ("108031", "Communication en clair (HTTP) détectée", "Serveurs web", "CVSS:3.1/AV:A/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N", [], "Workaround", "80/tcp"),
    ("11213", "Méthodes HTTP TRACE / TRACK activées", "Serveurs web", "AV:N/AC:M/Au:N/C:P/I:N/A:N", ["CVE-2003-1567", "CVE-2004-2320"], "Mitigation", "80/tcp"),
    ("108021", "Divulgation de la bannière de version du serveur web", "Serveurs web", "", [], "Mitigation", "80/tcp"),
    ("103674", "Service MySQL / MariaDB accessible depuis Internet", "Bases de données", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N", [], "Mitigation", "3306/tcp"),
    ("108716", "MySQL : identifiants par défaut (root sans mot de passe)", "Identifiants par défaut", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", [], "Mitigation", "3306/tcp"),
    ("10330", "Microsoft RDP : Network Level Authentication désactivée", "Windows", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N", [], "Mitigation", "3389/tcp"),
    ("108574", "SMBv1 activé (EternalBlue / WannaCry)", "Windows : bulletins Microsoft", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", ["CVE-2017-0144"], "VendorFix", "445/tcp"),
    ("147736", "Redis : accès sans authentification", "Bases de données", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", [], "Mitigation", "6379/tcp"),
    ("10287", "Traceroute", "Généralités", "", [], "", "general/tcp"),
    ("108192", "Détection du système d'exploitation (OS) consolidée", "Détection de produits", "", [], "", "general/tcp"),
    ("10330b", "Services détectés", "Découverte de services", "", [], "", "general/tcp"),
    ("80091", "Horodatage TCP (TCP timestamps)", "Généralités", "AV:N/AC:L/Au:N/C:N/I:N/A:N", [], "Mitigation", "general/tcp"),
]

DEMO_TEXT = {
    "summary": "{name} — le produit distant est affecté par une ou plusieurs vulnérabilités connues.",
    "insight": ("Avis des fournisseurs : une condition de course ou une validation insuffisante des entrées peut être "
                "exploitée par un attaquant distant non authentifié. L'exploitation réussie a été démontrée en "
                "laboratoire ; des variantes plus fiables sont probables."),
    "solution": {
        "VendorFix": "Mise à jour vers la dernière version corrigée proposée par l'éditeur.",
        "Mitigation": "Désactiver la fonctionnalité concernée ou restreindre l'accès au service au réseau d'administration.",
        "Workaround": "Mettre en place un contournement (filtrage, redirection HTTPS) en attendant un correctif.",
        "WillNotFix": "L'éditeur ne prévoit pas de correctif ; évaluer le risque et documenter l'acceptation.",
        "": "",
    },
}

DEMO_HOST_PROFILES = {
    "linux-web": {"os": "Ubuntu 22.04 LTS", "ports": ["22/tcp", "80/tcp", "443/tcp"]},
    "linux-ssh": {"os": "Debian GNU/Linux 12", "ports": ["22/tcp"]},
    "db": {"os": "Debian GNU/Linux 11", "ports": ["22/tcp", "3306/tcp", "6379/tcp"]},
    "windows": {"os": "Microsoft Windows Server 2019", "ports": ["445/tcp", "3389/tcp", "80/tcp"]},
}


class DemoBackend:
    """openvasd simulé : les scans progressent avec le temps."""

    demo = True

    def __init__(self):
        self.lock = threading.RLock()
        self.feed_version = "1c0cb6214c9e"
        self.api_version = "1"
        self.vts_state = "ready"
        self.vts: dict[str, dict] = {}
        for suffix, name, family, vector, cves, sol, _port in DEMO_VTS:
            oid = "1.3.6.1.4.1.25623.1.0." + suffix
            tag = {
                "summary": DEMO_TEXT["summary"].format(name=name),
                "insight": DEMO_TEXT["insight"] if vector else "",
                "solution": DEMO_TEXT["solution"].get(sol, ""),
                "solution_type": sol,
                "qod": "80" if vector else "",
                "qod_type": "remote_banner",
                "severity_vector": vector,
                "creation_date": "2024-07-02T08:00:00Z",
                "last_modification": "2025-03-14T10:00:00Z",
                "vuldetect": "Vérifie si une version vulnérable est présente sur la cible.",
            }
            self.vts[oid] = compact_vt({
                "oid": oid, "name": name, "family": family, "category": "gather_info", "tag": tag,
                "references": [{"class": "cve", "id": c} for c in cves],
            })
        self.vt_ports = {"1.3.6.1.4.1.25623.1.0." + v[0]: v[6] for v in DEMO_VTS}
        self.scans: dict[str, dict] = {}
        now = time.time()
        self._seed("5bc7901d-0632-452f-b2ac-9274e2a7595f", ["91.121.39.98"], now - 1650, 2100)
        self._seed("b510b582-1e8d-4f6b-9a47-8be1f0c9a5d2", ["192.168.5.128"], now - 86400 * 1.2, 900)
        self._seed("7e1d3a90-44c2-4c1b-8f0e-2f6a1d9b7c11", ["10.0.12.0/29"], now - 86400 * 4, 1500, exclude=["10.0.12.7"])

    # -- simulation --------------------------------------------------------
    @staticmethod
    def _expand(hosts, excluded):
        out = []
        for h in hosts:
            m = re.match(r"^(\d+\.\d+\.\d+)\.(\d+)/(\d+)$", h)
            if m:
                size = 2 ** (32 - int(m.group(3)))
                base = int(m.group(2))
                out += [f"{m.group(1)}.{base + i}" for i in range(1, min(size - 1, 16))]
            elif re.match(r"^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$", h):
                m = re.match(r"^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$", h)
                out += [f"{m.group(1)}.{i}" for i in range(int(m.group(2)), min(int(m.group(3)), int(m.group(2)) + 15) + 1)]
            else:
                out.append(h)
        return [h for h in dict.fromkeys(out) if h not in excluded]

    def _host_plan(self, host):
        rnd = random.Random(hashlib.sha1(host.encode()).hexdigest())
        dead = rnd.random() < 0.15 and not host.startswith(("91.", "192.168.5.")) and bool(re.match(r"^[\d.:]+$", host))
        profile = rnd.choice(list(DEMO_HOST_PROFILES))
        if host.startswith("192.168.5.") or host.startswith("91."):
            profile = "linux-ssh"
        elif not re.match(r"^[\d.:]+$", host):
            profile = "linux-web"
        info = DEMO_HOST_PROFILES[profile]
        findings = []
        for oid, port in self.vt_ports.items():
            if port.startswith("general") or port in info["ports"]:
                if port.startswith("general") or rnd.random() < 0.72:
                    findings.append((oid, port))
        return {"dead": dead, "os": info["os"], "ports": info["ports"], "findings": findings}

    def _seed(self, sid, hosts, start, duration, exclude=None):
        req = {
            "scan_id": sid,
            "target": {
                "hosts": hosts, "excluded_hosts": exclude or [],
                "ports": [{"protocol": "tcp", "range": [{"start": 21, "end": 23}, {"start": 25}, {"start": 53}, {"start": 80}, {"start": 443}, {"start": 3306}, {"start": 3389}, {"start": 6379}, {"start": 8080}]}],
                "alive_test_methods": ["consider_alive", "icmp", "tcp_syn"],
            },
            "vts": [],
            "scan_preferences": [],
        }
        self.scans[sid] = {"req": req, "start": start, "duration": duration, "state": "running", "stopped_at": None}

    def _snapshot(self, sid):
        s = self.scans.get(sid)
        if not s:
            raise BackendError(404, "scan inconnu")
        t = req_t = s["req"]["target"]
        hosts = self._expand(req_t.get("hosts", []), set(t.get("excluded_hosts") or []))
        if s["state"] == "stored":
            return {"status": {"status": "stored"}, "results": []}
        now = s["stopped_at"] or time.time()
        elapsed = max(0.0, now - s["start"])
        per_host = s["duration"] / max(1, min(len(hosts), 3))
        host_info = {"all": len(hosts), "excluded": len(t.get("excluded_hosts") or []), "dead": 0,
                     "alive": 0, "queued": 0, "finished": 0, "scanning": {}}
        results = []
        rid = 0
        for i, h in enumerate(hosts):
            plan = self._host_plan(h)
            h_start = (i // 3) * per_host
            frac = (elapsed - h_start) / per_host
            if frac <= 0:
                host_info["queued"] += 1
                continue
            if plan["dead"]:
                host_info["dead"] += 1
                continue
            results.append({"id": rid, "type": "host_start", "ip_address": h, "hostname": "", "message": ""})
            rid += 1
            visible = plan["findings"][: int(len(plan["findings"]) * min(frac, 1.0) + 0.999)]
            results.append({"id": rid, "type": "host_detail", "ip_address": h, "hostname": "", "message": "",
                            "detail": {"name": "best_os_txt", "value": plan["os"],
                                       "source": {"type": "nvt", "name": "1.3.6.1.4.1.25623.1.0.108192"}}})
            rid += 1
            for oid, port in visible:
                vt = self.vts[oid]
                p, _, proto = port.partition("/")
                ptype = "alarm" if vt["score"] else "log"
                msg = ("Installed version: 9.6p1\nFixed version:     9.8\nInstallation\npath / port:       " + port) \
                    if "OpenSSH" in vt["name"] else \
                    ("The remote SSH server supports the following DHE KEX algorithm(s):\n\ndiffie-hellman-group14-sha256\n"
                     "diffie-hellman-group16-sha512\ndiffie-hellman-group18-sha512\ndiffie-hellman-group-exchange-sha256"
                     if "Diffie" in vt["name"] else "Le test a confirmé la présence du problème sur " + port + ".")
                entry = {"id": rid, "type": ptype, "ip_address": h, "hostname": "", "oid": oid, "message": msg}
                if p.isdigit():
                    entry["port"] = int(p)
                    entry["protocol"] = proto
                results.append(entry)
                rid += 1
            if frac >= 1 or s["state"] in ("succeeded",):
                host_info["alive"] += 1
                host_info["finished"] += 1
                results.append({"id": rid, "type": "host_stop", "ip_address": h, "hostname": "", "message": ""})
                rid += 1
            else:
                host_info["scanning"][h] = int(frac * 100)
        state = s["state"]
        if state == "running" and not host_info["scanning"] and host_info["queued"] == 0:
            state = s["state"] = "succeeded"
            s["end"] = s["start"] + min(elapsed, s["duration"])
        status = {"status": state, "start_time": int(s["start"]), "host_info": host_info}
        if state in ("succeeded", "stopped", "failed"):
            status["end_time"] = int(s.get("end") or now)
        return {"status": status, "results": results}

    # -- API compatible OpenvasdBackend -------------------------------------
    def info(self):
        return {"connected": True, "feed_version": self.feed_version, "api_version": "1",
                "vts_state": "ready", "vts_count": 190208}

    def performance(self):
        return []

    def load_vts(self, cache_dir):
        return None

    def list_scans(self):
        return list(self.scans)

    def create_scan(self, req):
        with self.lock:
            sid = req.get("scan_id") or str(uuid.uuid4())
            req["scan_id"] = sid
            self.scans[sid] = {"req": req, "start": None, "duration": 150, "state": "stored", "stopped_at": None}
            return sid

    def get_scan(self, sid):
        if sid not in self.scans:
            raise BackendError(404, "scan inconnu")
        return self.scans[sid]["req"]

    def status(self, sid):
        with self.lock:
            return self._snapshot(sid)["status"]

    def results(self, sid):
        with self.lock:
            return self._snapshot(sid)["results"]

    def action(self, sid, action):
        with self.lock:
            s = self.scans.get(sid)
            if not s:
                raise BackendError(404, "scan inconnu")
            if action == "start":
                if s["state"] != "stored":
                    raise BackendError(406, "Le scan a déjà été démarré")
                s.update(state="running", start=time.time())
            elif action == "stop":
                if s["state"] != "running":
                    raise BackendError(406, "Le scan n'est pas en cours")
                s.update(state="stopped", stopped_at=time.time(), end=time.time())
            return None

    def delete(self, sid):
        with self.lock:
            self.scans.pop(sid, None)

    def preferences(self):
        return [
            {"id": "auto_enable_dependencies", "name": "Auto Enable Dependencies", "default": True, "description": "Active automatiquement les dépendances des VTs."},
            {"id": "safe_checks", "name": "Safe Checks", "default": True, "description": "Désactive les tests potentiellement dangereux."},
            {"id": "optimize_test", "name": "Optimize Test", "default": True, "description": "N'exécute un VT que si les services requis sont présents."},
            {"id": "checks_read_timeout", "name": "Checks Read Timeout", "default": 5, "description": "Délai de lecture des sockets (s)."},
            {"id": "plugins_timeout", "name": "Plugins Timeout", "default": 320, "description": "Durée maximale d'exécution d'un VT (s)."},
            {"id": "report_host_details", "name": "Report Host Details", "default": True, "description": "Remonte les détails d'hôte."},
            {"id": "expand_vhosts", "name": "Expand Vhosts", "default": True, "description": "Étend la liste des hôtes virtuels."},
            {"id": "results_per_host", "name": "Results Per Host", "default": 10, "description": "Nombre de résultats renvoyés par hôte."},
        ]

    def create_container_scan(self, req):
        req.setdefault("target", {})
        sid = self.create_scan(req)
        self.scans[sid]["container"] = True
        return sid

    container_action = action
    container_status = status
    container_results = results
    container_delete = delete

    def notus_os(self):
        return ["debian_10", "debian_11", "debian_12", "ubuntu_20.04", "ubuntu_22.04", "ubuntu_24.04",
                "rhel_8", "rhel_9", "alpine_3.19", "alpine_3.20", "suse_15.5"]

    def notus_run(self, os_name, packages):
        out = {}
        vulnerable = {"openssl": ("3.0.13-0ubuntu3.4", "1.3.6.1.4.1.25623.1.1.12.2024.6762.1"),
                      "openssh-server": ("1:9.6p1-3ubuntu13.5", "1.3.6.1.4.1.25623.1.1.12.2024.6859.1"),
                      "libc6": ("2.39-0ubuntu8.3", "1.3.6.1.4.1.25623.1.1.12.2024.6911.1"),
                      "curl": ("8.5.0-2ubuntu10.4", "1.3.6.1.4.1.25623.1.1.12.2024.7012.1"),
                      "sudo": ("1.9.15p5-3ubuntu5.1", "1.3.6.1.4.1.25623.1.1.12.2025.7604.1")}
        for pkg in packages:
            name = re.split(r"[-_]\d|=", pkg, maxsplit=1)[0]
            for key, (fixed, oid) in vulnerable.items():
                if name == key:
                    out.setdefault(oid, []).append({"name": key, "installed_version": pkg, "fixed_version": fixed})
        return out


# --------------------------------------------------------------------------
# Service applicatif (agrégation, enrichissement)
# --------------------------------------------------------------------------

def scan_progress(status: dict) -> int:
    st = status.get("status")
    if st == "succeeded":
        return 100
    hi = status.get("host_info") or {}
    scanning = hi.get("scanning") or {}
    if isinstance(scanning, list):
        scanning = {}
    total = (hi.get("all") or 0) - (hi.get("dead") or 0)
    if total <= 0:
        return 0
    done = sum(v for v in scanning.values() if isinstance(v, (int, float)) and v > 0) + 100 * (hi.get("alive") or 0)
    return max(0, min(100, int(done / total)))


class App:
    def __init__(self, backend, state: State):
        self.backend = backend
        self.state = state
        self.cache: dict[str, tuple[float, dict]] = {}

    # -- enrichissement ------------------------------------------------------
    def vt(self, oid):
        return self.backend.vts.get(oid) if oid else None

    def enrich(self, results: list[dict]) -> list[dict]:
        out = []
        for r in results:
            rtype = r.get("type")
            vt = self.vt(r.get("oid"))
            score = vt["score"] if vt else None
            item = dict(r)
            if r.get("port"):  # openvasd signale les résultats généraux avec le port 0
                item["port_label"] = f"{r['port']}/{r.get('protocol') or 'tcp'}"
            else:
                item["port_label"] = "general/" + (r.get("protocol") or "tcp")
            item["severity"] = score if rtype == "alarm" else (0.0 if rtype == "log" else None)
            item["level"] = severity_level(score, rtype)
            item["name"] = vt["name"] if vt else (r.get("oid") or rtype)
            if vt:
                item["vt"] = {k: vt[k] for k in ("family", "summary", "insight", "affected", "impact", "solution",
                                                 "solution_type", "vector", "cves", "qod", "qod_type", "vuldetect")}
            out.append(item)
        return out

    def scan_bundle(self, sid: str, with_results=True) -> dict:
        meta = self.state.data["scans"].get(sid, {})
        container = meta.get("kind") == "container"
        b = self.backend
        status = (b.container_status if container else b.status)(sid)
        bundle = {"id": sid, "name": meta.get("name") or ("Scanner " + sid[:8]), "kind": meta.get("kind", "host"),
                  "created": meta.get("created"), "schedule": meta.get("schedule"), "status": status,
                  "site": meta.get("site"), "resumed_from": meta.get("resumed_from"),
                  "resumed_by": meta.get("resumed_by"),
                  "progress": scan_progress(status)}
        if with_results:
            key = sid
            cached = self.cache.get(key)
            if cached and status.get("status") in ("succeeded", "stopped", "failed") and cached[0] == status.get("end_time"):
                bundle["results"] = cached[1]
            else:
                raw = (b.container_results if container else b.results)(sid)
                bundle["results"] = self.enrich(raw)
                self.cache[key] = (status.get("end_time"), bundle["results"])
            bundle["summary"] = summarize(bundle["results"])
        return bundle

    def scan_config(self, sid):
        meta = self.state.data["scans"].get(sid, {})
        if meta.get("request"):
            return meta["request"]
        try:
            return self.backend.get_scan(sid)
        except BackendError:
            return {}

    def list_scans(self):
        ids = []
        try:
            ids = self.backend.list_scans()
        except BackendError:
            ids = []
        ids = list(dict.fromkeys(list(ids) + list(self.state.data["scans"])))
        out = []
        for sid in ids:
            try:
                b = self.scan_bundle(sid)
            except BackendError as exc:
                if exc.status == 404:
                    continue
                raise
            cfg = self.scan_config(sid)
            b["targets"] = (cfg.get("target") or {}).get("hosts", [])
            b.pop("results", None)
            out.append(b)
        out.sort(key=lambda s: s["status"].get("start_time") or s.get("created") or 0, reverse=True)
        return out

    def create(self, payload: dict) -> str:
        req = payload["scan"]
        kind = payload.get("kind", "host")
        b = self.backend
        stored_selection = req.pop("_vt_selection", None)
        selection = payload.get("vt_selection") or stored_selection
        if selection and kind != "container":
            req["vts"] = self.select_vts(selection)
        sid = (b.create_container_scan if kind == "container" else b.create_scan)(req)
        if isinstance(sid, dict):
            sid = sid.get("id") or sid.get("scan_id")
        safe_req = json.loads(json.dumps(req))
        for cred in (safe_req.get("target") or {}).get("credentials", []) or []:
            for v in cred.values():
                if isinstance(v, dict):
                    for k in ("password", "private", "privacy_password", "community"):
                        if k in v:
                            v[k] = "••••••"
        if selection:
            safe_req["vts"] = []
            safe_req["_vt_selection"] = dict(selection, count=len(req.get("vts") or []))
        with self.state.lock:
            self.state.data["scans"][sid] = {"name": payload.get("name") or f"Scan {sid[:8]}", "kind": kind,
                                             "created": int(time.time()), "request": safe_req,
                                             "site": payload.get("site"),
                                             "resumed_from": payload.get("resumed_from"),
                                             # Identifiants réels, jamais renvoyés par l'API : ils
                                             # servent uniquement à reprendre ou dupliquer le scan.
                                             "_credentials": (req.get("target") or {}).get("credentials") or []}
            if payload.get("resumed_from") in self.state.data["scans"]:
                self.state.data["scans"][payload["resumed_from"]]["resumed_by"] = sid
            self.state.save()
        if payload.get("start", True):
            (b.container_action if kind == "container" else b.action)(sid, "start")
        self.state.notify("info", f"Scan « {self.state.data['scans'][sid]['name']} » créé", f"#/scans/{sid}")
        return sid

    def select_vts(self, selection: dict) -> list[dict]:
        vts = self.backend.vts
        if not vts:
            if self.backend.demo:
                return []
            oids = self.backend.request("GET", "/vts", timeout=300) or []
            if selection.get("mode") in ("families", "web"):
                raise BackendError(503, "Les métadonnées des VTs sont en cours de chargement, réessayez dans quelques minutes")
            return [{"oid": o} for o in oids]
        if selection.get("mode") == "families":
            fams = set(selection.get("families") or [])
            return [{"oid": o} for o, v in vts.items() if v["family"] in fams]
        if selection.get("mode") == "web":
            return [{"oid": o} for o, v in vts.items() if WEB_FAMILIES.search(v["family"] or "")]
        return [{"oid": o} for o in vts]

    def assets(self):
        hosts: dict[str, dict] = {}
        for s in self.list_scans():
            try:
                bundle = self.scan_bundle(s["id"])
            except BackendError:
                continue
            for h in host_view(bundle["results"]):
                cur = hosts.get(h["ip"])
                when = s["status"].get("start_time") or 0
                if cur is None or when >= cur["last_seen"]:
                    h.update(last_seen=when, last_scan=s["id"], last_scan_name=s["name"])
                    h["scans"] = (cur or {}).get("scans", 0) + 1
                    hosts[h["ip"]] = h
                else:
                    cur["scans"] += 1
        return sorted(hosts.values(), key=lambda h: (-h["max_severity"], h["ip"]))

    def findings(self):
        """Vulnérabilités ouvertes (dernier scan de chaque hôte) + suivi."""
        latest: dict[str, tuple[int, dict]] = {}
        scans = self.list_scans()
        bundles = {}
        for s in scans:
            try:
                bundles[s["id"]] = self.scan_bundle(s["id"])
            except BackendError:
                continue
            for r in bundles[s["id"]]["results"]:
                if r.get("type") == "host_start":
                    ip = r.get("ip_address")
                    # un scan en cours ne remplace pas le dernier scan terminé de l'hôte
                    rank = (s["status"].get("status") not in ("running", "requested"), s["status"].get("start_time") or 0)
                    if ip not in latest or rank > latest[ip][0]:
                        latest[ip] = (rank, s)
        out = {}
        tracking = self.state.data["tracking"]
        for ip, ((_, when), s) in latest.items():
            for r in bundles[s["id"]]["results"]:
                if r.get("ip_address") != ip or r.get("type") != "alarm":
                    continue
                key = f"{r.get('oid')}|{ip}|{r['port_label']}"
                if key in out:
                    continue
                t = tracking.get(key, {})
                first_seen = t.get("first_seen") or when
                out[key] = {"key": key, "oid": r.get("oid"), "name": r["name"], "severity": r["severity"],
                            "level": r["level"], "host": ip, "port": r["port_label"], "scan_id": s["id"],
                            "scan_name": s["name"], "cves": (r.get("vt") or {}).get("cves", []),
                            "first_seen": first_seen, "status": t.get("status", "todo"),
                            "assignee": t.get("assignee", ""), "due": t.get("due"), "note": t.get("note", ""),
                            "updated": t.get("updated")}
        # anciennes vulnérabilités suivies et non revues → corrigées
        for key, t in tracking.items():
            if key not in out and t.get("name"):
                out[key] = dict(t, key=key, status="fixed" if t.get("status") not in ("accepted", "false_positive") else t["status"])
        return list(out.values())


def summarize(results: list[dict]) -> dict:
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "log": 0, "error": 0}
    hosts = set()
    max_sev = 0.0
    seen = set()
    for r in results:
        if r.get("type") in ("host_start", "host_stop", "host_end", "host_detail"):
            hosts.add(r.get("ip_address"))
            continue
        k = (r.get("oid"), r.get("ip_address"), r.get("port_label"))
        if k in seen:
            continue
        seen.add(k)
        counts[r["level"]] = counts.get(r["level"], 0) + 1
        if r.get("severity"):
            max_sev = max(max_sev, r["severity"])
    vulns = counts["critical"] + counts["high"] + counts["medium"] + counts["low"]
    return {"counts": counts, "vulns": vulns, "hosts": len(hosts), "max_severity": max_sev, "results": len(results)}


def host_view(results: list[dict]) -> list[dict]:
    hosts: dict[str, dict] = {}
    for r in results:
        ip = r.get("ip_address")
        if not ip:
            continue
        h = hosts.setdefault(ip, {"ip": ip, "hostname": r.get("hostname") or "", "os": "", "ports": [],
                                  "vulns": 0, "max_severity": 0.0, "state": "running",
                                  "counts": {"critical": 0, "high": 0, "medium": 0, "low": 0}})
        t = r.get("type")
        if t in ("host_stop", "host_end"):
            h["state"] = "done"
        elif t == "host_detail":
            d = r.get("detail") or {}
            if d.get("name") in ("best_os_txt", "OS") and not h["os"]:
                h["os"] = d.get("value", "")
        elif t in ("alarm", "log"):
            p = r.get("port_label")
            if p and not p.startswith("general") and p not in h["ports"]:
                h["ports"].append(p)
            if t == "alarm":
                h["vulns"] += 1
                h["counts"][r["level"]] = h["counts"].get(r["level"], 0) + 1
                h["max_severity"] = max(h["max_severity"], r.get("severity") or 0)
        if r.get("hostname") and not h["hostname"]:
            h["hostname"] = r["hostname"]
    for h in hosts.values():
        h["ports"].sort(key=lambda p: int(p.split("/")[0]) if p.split("/")[0].isdigit() else 0)
        h["level"] = severity_level(h["max_severity"])
    return list(hosts.values())


# --------------------------------------------------------------------------
# Planificateur
# --------------------------------------------------------------------------

def schedule_due(sched: dict, now: datetime) -> bool:
    if not sched.get("enabled", True):
        return False
    last = sched.get("last_run") or 0
    hh, mm = (sched.get("time") or "02:00").split(":")
    target = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    if now < target or last >= target.timestamp():
        return False
    freq = sched.get("frequency", "daily")
    if freq == "weekly" and now.weekday() != int(sched.get("weekday", 0)):
        return False
    if freq == "monthly" and now.day != int(sched.get("day", 1)):
        return False
    if freq == "once":
        return not last and sched.get("date") == now.strftime("%Y-%m-%d")
    return True


def scheduler_loop(app: App):
    while True:
        time.sleep(30)
        now = datetime.now()
        changed = False
        with app.state.lock:
            schedules = list(app.state.data["schedules"])
        for sched in schedules:
            if not schedule_due(sched, now):
                continue
            try:
                req = json.loads(json.dumps(sched["scan"]))
                req.pop("scan_id", None)
                sid = app.create({"name": f"{sched['name']} — {now:%d/%m %H:%M}", "scan": req, "kind": sched.get("kind", "host"),
                                  "vt_selection": sched.get("vt_selection")})
                sched["last_scan"] = sid
                sched["last_error"] = ""
            except (BackendError, KeyError) as exc:
                sched["last_error"] = str(getattr(exc, "message", exc))
                app.state.notify("error", f"Échec du scan planifié « {sched['name']} »", "#/schedules")
            sched["last_run"] = int(now.timestamp())
            changed = True
        if changed:
            app.state.save()


# --------------------------------------------------------------------------
# Serveur HTTP
# --------------------------------------------------------------------------

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
        ".woff2": "font/woff2"}


# --------------------------------------------------------------------------
# Authentification
# --------------------------------------------------------------------------

class Auth:
    """Comptes définis par variables d'environnement, sessions en mémoire.

    * ``UI_ADMIN_USER`` / ``UI_ADMIN_PASSWORD`` : accès complet ;
    * ``UI_VIEWER_USER`` / ``UI_VIEWER_PASSWORD`` : lecture seule (facultatif).

    Sans ``UI_ADMIN_PASSWORD``, l'authentification est désactivée (usage local).
    """

    COOKIE = "ovsession"
    TTL = 12 * 3600
    MAX_FAILS = 5
    BLOCK = 300

    def __init__(self, env=os.environ):
        self.users = {}
        if env.get("UI_ADMIN_PASSWORD"):
            self.users[env.get("UI_ADMIN_USER") or "admin"] = (env["UI_ADMIN_PASSWORD"], "admin")
        if env.get("UI_VIEWER_PASSWORD"):
            self.users[env.get("UI_VIEWER_USER") or "lecteur"] = (env["UI_VIEWER_PASSWORD"], "viewer")
        self.enabled = bool(self.users)
        self.sessions: dict[str, tuple[str, str, float]] = {}
        self.fails: dict[str, tuple[int, float]] = {}
        self.lock = threading.Lock()

    def login(self, ip: str, username: str, password: str):
        now = time.time()
        with self.lock:
            count, since = self.fails.get(ip, (0, now))
            if count >= self.MAX_FAILS and now - since < self.BLOCK:
                raise BackendError(429, "Trop de tentatives, réessayez dans quelques minutes")
            entry = self.users.get(username)
            ok = entry is not None and hmac.compare_digest(entry[0].encode(), password.encode())
            if not ok:
                if now - since >= self.BLOCK:
                    count, since = 0, now
                self.fails[ip] = (count + 1, since)
                raise BackendError(401, "Identifiant ou mot de passe incorrect")
            self.fails.pop(ip, None)
            token = secrets.token_urlsafe(32)
            self.sessions[token] = (username, entry[1], now + self.TTL)
            return token, {"user": username, "role": entry[1]}

    def session(self, cookie_header: str | None):
        if not self.enabled:
            return {"user": "admin", "role": "admin", "auth": False}
        token = None
        for part in (cookie_header or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == self.COOKIE:
                token = v
        if not token:
            return None
        with self.lock:
            entry = self.sessions.get(token)
            if not entry or entry[2] < time.time():
                self.sessions.pop(token, None)
                return None
            return {"user": entry[0], "role": entry[1], "auth": True, "token": token}

    def logout(self, token: str | None):
        with self.lock:
            self.sessions.pop(token or "", None)


class Handler(http.server.BaseHTTPRequestHandler):
    app: App = None  # type: ignore
    auth: Auth = None  # type: ignore
    server_version = "openvas-ui/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("OPENVAS_UI_DEBUG"):
            super().log_message(fmt, *args)

    # -- helpers -----------------------------------------------------------
    def send_json(self, data, status=200, headers=None):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n))

    def do_login(self):
        payload = self.body()
        ip = self.client_address[0]
        token, who = self.auth.login(ip, str(payload.get("username", "")), str(payload.get("password", "")))
        cookie = f"{Auth.COOKIE}={token}; Path=/; Max-Age={Auth.TTL}; HttpOnly; SameSite=Strict"
        self.send_json(who, headers={"Set-Cookie": cookie})

    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            full = os.path.join(STATIC, "index.html")
        with open(full, "rb") as fh:
            raw = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(os.path.splitext(full)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        url = urllib.parse.urlparse(self.path)
        if not url.path.startswith("/api/"):
            if method != "GET":
                return self.send_json({"error": "méthode non autorisée"}, 405)
            return self.static(url.path)
        query = urllib.parse.parse_qs(url.query)
        path = url.path[4:].rstrip("/")
        try:
            if path == "/login" and method == "POST":
                return self.do_login()
            sess = self.auth.session(self.headers.get("Cookie"))
            if path == "/logout" and method == "POST":
                self.auth.logout((sess or {}).get("token"))
                return self.send_json({"ok": True}, headers={"Set-Cookie": f"{Auth.COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"})
            if sess is None:
                return self.send_json({"error": "Authentification requise"}, 401)
            if path == "/me":
                return self.send_json({k: v for k, v in sess.items() if k != "token"})
            if method != "GET":
                # Les formulaires d'un autre site ne peuvent pas envoyer du JSON sans
                # pré-vérification CORS : on exige ce type pour bloquer le CSRF.
                if self.auth.enabled and "application/json" not in (self.headers.get("Content-Type") or ""):
                    return self.send_json({"error": "Content-Type application/json requis"}, 415)
                if sess["role"] != "admin" and path not in ("/notifications", "/notus"):
                    return self.send_json({"error": "Compte en lecture seule : action non autorisée"}, 403)
            data = self.api(method, path, query)
            if data is None and method == "DELETE":
                return self.send_json({"ok": True})
            self.send_json(data)
        except BackendError as exc:
            self.send_json({"error": exc.message, "status": exc.status}, exc.status if 400 <= exc.status < 600 else 500)
        except (KeyError, ValueError, TypeError) as exc:
            self.send_json({"error": f"requête invalide : {exc}"}, 400)

    # -- API de l'interface -------------------------------------------------
    def api(self, method, path, query):
        app = self.app
        b = app.backend
        st = app.state
        parts = path.strip("/").split("/")

        if path == "/info" and method == "GET":
            info = b.info()
            info.update(demo=b.demo, scanner="openvasd", url=getattr(b, "base", "démo"),
                        unread=sum(1 for n in st.data["notifications"] if not n.get("read")))
            return info
        if path == "/notifications":
            if method == "POST":
                with st.lock:
                    for n in st.data["notifications"]:
                        n["read"] = True
                    st.save()
            return st.data["notifications"]
        if path == "/performance":
            return b.performance()
        if path == "/preferences":
            return b.preferences()

        # Scans ------------------------------------------------------------
        if parts[0] == "scans":
            if len(parts) == 1:
                if method == "GET":
                    return app.list_scans()
                if method == "POST":
                    return {"id": app.create(self.body())}
            sid = parts[1]
            meta = st.data["scans"].get(sid, {})
            container = meta.get("kind") == "container"
            if len(parts) == 2:
                if method == "GET":
                    bundle = app.scan_bundle(sid)
                    bundle["config"] = app.scan_config(sid)
                    bundle["hosts"] = host_view(bundle["results"])
                    return bundle
                if method == "DELETE":
                    try:
                        (b.container_delete if container else b.delete)(sid)
                    except BackendError as exc:
                        if exc.status != 404:
                            raise
                    with st.lock:
                        st.data["scans"].pop(sid, None)
                        st.save()
                    app.cache.pop(sid, None)
                    return None
                if method == "PUT":
                    payload = self.body()
                    with st.lock:
                        st.data["scans"].setdefault(sid, {})["name"] = payload.get("name", meta.get("name"))
                        st.save()
                    return {"ok": True}
            if len(parts) == 3 and method == "POST":
                action = parts[2]
                if action in ("start", "stop"):
                    (b.container_action if container else b.action)(sid, action)
                    if action == "stop":
                        st.notify("warning", f"Scan « {meta.get('name', sid[:8])} » arrêté", f"#/scans/{sid}")
                    return {"ok": True}
                if action in ("duplicate", "resume"):
                    req = json.loads(json.dumps(app.scan_config(sid)))
                    req.pop("scan_id", None)
                    target = req.setdefault("target", {})
                    if meta.get("_credentials"):
                        target["credentials"] = json.loads(json.dumps(meta["_credentials"]))
                    for cred in target.get("credentials", []) or []:
                        for v in cred.values():
                            if isinstance(v, dict) and "••••••" in v.values():
                                raise ValueError("les identifiants de ce scan ne sont pas conservés : utilisez « Nouveau scan »")
                    name = meta.get("name") or "Scan"
                    extra = {}
                    if action == "resume":
                        if meta.get("resumed_by") in st.data["scans"]:
                            raise ValueError("ce scan a déjà été repris : reprenez plutôt la reprise")
                        status = (b.container_status if container else b.status)(sid)
                        if status.get("status") not in ("failed", "stopped"):
                            raise ValueError("seul un scan arrêté ou en échec peut être repris")
                        results = (b.container_results if container else b.results)(sid)
                        done = sorted({r["ip_address"] for r in results
                                       if r.get("type") in ("host_stop", "host_end") and r.get("ip_address")})
                        if done:
                            target["excluded_hosts"] = sorted(set(target.get("excluded_hosts") or []) | set(done))
                        name = re.sub(r" \(reprise( \d+)?\)$", "", name) + " (reprise)"
                        extra = {"resumed_from": sid}
                        st.notify("info", f"Reprise du scan « {meta.get('name', sid[:8])} » : {len(done)} hôte(s) déjà terminé(s) ignoré(s)",
                                  f"#/scans/{sid}")
                    else:
                        name += " (copie)"
                    return {"id": app.create({"name": name, "scan": req, "kind": meta.get("kind", "host"),
                                              "site": meta.get("site"), **extra})}
            if len(parts) == 3 and parts[2] == "status":
                return app.scan_bundle(sid, with_results=False)

        if path == "/assets":
            return app.assets()
        if path == "/findings":
            return app.findings()
        if path == "/tracking" and method == "PUT":
            payload = self.body()
            with st.lock:
                for key, upd in payload.items():
                    cur = st.data["tracking"].setdefault(key, {})
                    cur.update({k: v for k, v in upd.items() if k in ("status", "assignee", "due", "note", "name",
                                                                         "severity", "level", "host", "port", "oid",
                                                                         "first_seen", "cves")})
                    cur["updated"] = int(time.time())
                st.save()
            return {"ok": True}

        # Planification --------------------------------------------------
        if parts[0] == "schedules":
            if method == "GET":
                return st.data["schedules"]
            if method == "POST" and len(parts) == 1:
                sched = self.body()
                sched["id"] = uuid.uuid4().hex[:12]
                sched.setdefault("enabled", True)
                with st.lock:
                    st.data["schedules"].append(sched)
                    st.save()
                return sched
            if len(parts) == 2:
                with st.lock:
                    items = st.data["schedules"]
                    idx = next((i for i, s in enumerate(items) if s["id"] == parts[1]), None)
                    if idx is None:
                        raise BackendError(404, "planification inconnue")
                    if method == "DELETE":
                        items.pop(idx)
                    elif method == "PUT":
                        items[idx].update(self.body())
                    st.save()
                return None if method == "DELETE" else items[idx]

        # VTs ------------------------------------------------------------
        if parts[0] == "vts":
            if len(parts) == 2:
                vt = b.vts.get(parts[1])
                if not vt:
                    raise BackendError(404, "VT inconnu")
                return vt
            q = (query.get("q", [""])[0]).lower().strip()
            fam = query.get("family", [""])[0]
            sev = query.get("severity", [""])[0]
            page = int(query.get("page", ["0"])[0])
            size = min(200, int(query.get("size", ["50"])[0]))
            families: dict[str, int] = {}
            matches = []
            for vt in b.vts.values():
                families[vt["family"]] = families.get(vt["family"], 0) + 1
                if fam and vt["family"] != fam:
                    continue
                if sev and severity_level(vt["score"]) != sev:
                    continue
                if q and q not in vt["name"].lower() and q not in vt["oid"] and not any(q in c.lower() for c in vt["cves"]):
                    continue
                matches.append(vt)
            matches.sort(key=lambda v: -(v["score"] or 0))
            return {"state": b.vts_state, "total": len(matches), "families": sorted(families.items()),
                    "items": [{k: v[k] for k in ("oid", "name", "family", "score", "cves", "modified", "solution_type")}
                              for v in matches[page * size:(page + 1) * size]]}

        # Notus ----------------------------------------------------------
        if parts[0] == "notus":
            if method == "GET":
                return b.notus_os()
            payload = self.body()
            raw = b.notus_run(payload["os"], payload["packages"])
            out = []
            for oid, pkgs in (raw or {}).items():
                vt = b.vts.get(oid) or {}
                for p in pkgs:
                    out.append({"oid": oid, "name": vt.get("name") or "Avis de sécurité " + oid.split(".")[-2] + "-" + oid.split(".")[-1],
                                "score": vt.get("score"), "level": severity_level(vt.get("score")) if vt.get("score") else "medium",
                                "package": p.get("name"), "installed": p.get("installed_version"),
                                "fixed": p.get("fixed_version") or (p.get("fixed_version_range") or {}),
                                "cves": vt.get("cves", [])})
            return out

        raise BackendError(404, f"route inconnue : {method} {path}")


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    p = argparse.ArgumentParser(description="Interface web pour openvasd")
    p.add_argument("--host", default=os.environ.get("OPENVAS_UI_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("OPENVAS_UI_PORT", "8080")))
    p.add_argument("--openvasd", default=os.environ.get("OPENVASD_URL", "http://127.0.0.1:3000"),
                   help="URL d'openvasd (défaut : http://127.0.0.1:3000)")
    p.add_argument("--api-key", default=os.environ.get("OPENVASD_API_KEY"), help="Clé X-API-KEY d'openvasd")
    p.add_argument("--cafile", default=os.environ.get("OPENVASD_CAFILE"), help="CA pour vérifier openvasd (HTTPS)")
    p.add_argument("--client-cert", default=os.environ.get("OPENVASD_CLIENT_CERT"), help="Certificat client (mTLS)")
    p.add_argument("--client-key", default=os.environ.get("OPENVASD_CLIENT_KEY"), help="Clé privée client (mTLS)")
    p.add_argument("--insecure", action="store_true", help="Ne pas vérifier le certificat d'openvasd")
    p.add_argument("--data", default=os.environ.get("OPENVAS_UI_DATA", os.path.join(ROOT, "data")))
    p.add_argument("--demo", action="store_true", help="Utiliser un openvasd simulé")
    args = p.parse_args()

    if args.demo:
        backend = DemoBackend()
        state = State(os.path.join(args.data, "demo-state.json"))
        defaults = {
            "5bc7901d-0632-452f-b2ac-9274e2a7595f": "Test",
            "b510b582-1e8d-4f6b-9a47-8be1f0c9a5d2": "Serveur SSH interne",
            "7e1d3a90-44c2-4c1b-8f0e-2f6a1d9b7c11": "DMZ 10.0.12.0/29",
        }
        for sid, name in defaults.items():
            state.data["scans"].setdefault(sid, {"name": name, "kind": "host", "created": int(time.time())})
        for sid in list(state.data["scans"]):
            if sid not in backend.scans:
                state.data["scans"].pop(sid)
        if not state.data["notifications"]:
            state.notify("critical", "2 vulnérabilités critiques détectées sur 192.168.5.128", "#/scans/b510b582-1e8d-4f6b-9a47-8be1f0c9a5d2")
            state.notify("info", "Flux de VTs synchronisé (1c0cb6214c9e)", "#/vts")
            state.notify("info", "Scan « Test » démarré", "#/scans/5bc7901d-0632-452f-b2ac-9274e2a7595f")
    else:
        backend = OpenvasdBackend(args.openvasd, args.api_key, args.cafile, args.client_cert, args.client_key, args.insecure)
        state = State(os.path.join(args.data, "state.json"))
        os.makedirs(args.data, exist_ok=True)
        threading.Thread(target=backend.load_vts, args=(args.data,), daemon=True).start()

    app = App(backend, state)
    threading.Thread(target=scheduler_loop, args=(app,), daemon=True).start()
    Handler.app = app
    Handler.auth = Auth()
    if Handler.auth.enabled:
        print("Authentification activée : " + ", ".join(f"{u} ({r})" for u, (_, r) in Handler.auth.users.items()))
    elif args.host not in ("127.0.0.1", "localhost", "::1"):
        print("ATTENTION : aucune authentification (UI_ADMIN_PASSWORD non défini) et écoute sur " + args.host)
    srv = ThreadingServer((args.host, args.port), Handler)
    mode = "démo" if args.demo else args.openvasd
    print(f"Interface OpenVAS disponible sur http://{args.host}:{args.port}  (openvasd : {mode})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

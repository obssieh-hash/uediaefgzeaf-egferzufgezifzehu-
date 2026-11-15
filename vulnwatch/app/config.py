"""Configuration chargée depuis les variables d'environnement (fichier /etc/vulnwatch/vulnwatch.env)."""
import os
import secrets


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_get(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    v = _get(name, "1" if default else "0").lower()
    return v in ("1", "true", "yes", "oui", "on")


# --- Général ---
APP_NAME = _get("VW_APP_NAME", "CERT-ANSIE")
ORG_NAME = _get("VW_ORG_NAME", "ANSIE · Djibouti")
# Marquage affiché sur toutes les pages et les rapports (TLP:CLEAR / GREEN / AMBER / RED)
CLASSIFICATION = _get("VW_CLASSIFICATION", "TLP:AMBER — Usage interne ANSIE")
DB_PATH = _get("VW_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "vulnwatch.db"))
SECRET_KEY = _get("VW_SECRET_KEY") or secrets.token_hex(32)
ADMIN_USER = _get("VW_ADMIN_USER", "admin")
ADMIN_PASSWORD = _get("VW_ADMIN_PASSWORD", "")  # vide = pas d'authentification (déconseillé)
SESSION_HOURS = _int("VW_SESSION_HOURS", 12)
BASE_URL = _get("VW_BASE_URL", "")  # ex: https://vulnwatch.cert.local (utilisé dans les notifications)

# --- Synchronisation ---
SYNC_INTERVAL_MIN = _int("VW_SYNC_INTERVAL_MIN", 60)
INITIAL_BACKFILL_DAYS = _int("VW_INITIAL_BACKFILL_DAYS", 30)   # CVE récentes toutes confondues au 1er lancement
WATCH_BACKFILL_DAYS = _int("VW_WATCH_BACKFILL_DAYS", 365)      # historique récupéré pour chaque produit surveillé
HTTP_TIMEOUT = _int("VW_HTTP_TIMEOUT", 60)

# --- Clés API (toutes optionnelles) ---
NVD_API_KEY = _get("NVD_API_KEY")         # https://nvd.nist.gov/developers/request-an-api-key
GITHUB_TOKEN = _get("GITHUB_TOKEN")       # token GitHub sans aucun scope (lecture publique)

# --- Sources activables ---
ENABLE_NVD = _bool("VW_ENABLE_NVD", True)
ENABLE_KEV = _bool("VW_ENABLE_KEV", True)
ENABLE_EPSS = _bool("VW_ENABLE_EPSS", True)
ENABLE_GITHUB = _bool("VW_ENABLE_GITHUB", True)
ENABLE_FEEDS = _bool("VW_ENABLE_FEEDS", True)

# --- Notifications ---
NOTIFY_MIN_PRIORITY = _int("VW_NOTIFY_MIN_PRIORITY", 2)  # 1 = P1 seulement, 2 = P1+P2, 3, 4 = tout
TELEGRAM_BOT_TOKEN = _get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = _get("TELEGRAM_CHAT_ID")
DISCORD_WEBHOOK_URL = _get("DISCORD_WEBHOOK_URL")
SLACK_WEBHOOK_URL = _get("SLACK_WEBHOOK_URL")      # Slack / Mattermost / Rocket.Chat (format compatible)
TEAMS_WEBHOOK_URL = _get("TEAMS_WEBHOOK_URL")
SMTP_HOST = _get("SMTP_HOST")
SMTP_PORT = _int("SMTP_PORT", 587)
SMTP_USER = _get("SMTP_USER")
SMTP_PASSWORD = _get("SMTP_PASSWORD")
SMTP_FROM = _get("SMTP_FROM")
SMTP_TO = _get("SMTP_TO")  # plusieurs adresses séparées par des virgules
SMTP_STARTTLS = _bool("SMTP_STARTTLS", True)

USER_AGENT = "CERT-ANSIE/1.0 (vulnerability-watch)"

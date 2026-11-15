"""Notifications : Telegram, Discord, Slack/Mattermost, Microsoft Teams, e-mail (SMTP)."""
import html
import logging
import smtplib
from email.message import EmailMessage

from . import config
from .sources import client

log = logging.getLogger("vulnwatch.notify")
PRIO_LABEL = {1: "P1 — CRITIQUE", 2: "P2 — HAUTE", 3: "P3 — MOYENNE", 4: "P4 — BASSE"}
PRIO_EMOJI = {1: "🔴", 2: "🟠", 3: "🟡", 4: "🔵"}
PRIO_COLOR = {1: 0xE5484D, 2: 0xF76B15, 3: 0xFFC53D, 4: 0x3E63DD}


def channels() -> list[str]:
    ch = []
    if config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID:
        ch.append("telegram")
    if config.DISCORD_WEBHOOK_URL:
        ch.append("discord")
    if config.SLACK_WEBHOOK_URL:
        ch.append("slack")
    if config.TEAMS_WEBHOOK_URL:
        ch.append("teams")
    if config.SMTP_HOST and config.SMTP_TO:
        ch.append("email")
    return ch


def enabled() -> bool:
    return bool(channels())


def _link(vid: str) -> str:
    if config.BASE_URL:
        return f"{config.BASE_URL.rstrip('/')}/#/vuln/{vid}"
    if vid.startswith("CVE-"):
        return f"https://nvd.nist.gov/vuln/detail/{vid}"
    return f"https://github.com/advisories/{vid}"


def _fields(v) -> dict:
    score = f"{v['cvss_score']:.1f}" if v["cvss_score"] is not None else "n/a"
    epss = f"{v['epss'] * 100:.1f} %" if v["epss"] is not None else "n/a"
    desc = (v["description"] or v["title"] or "").strip()
    return {"score": score, "epss": epss, "desc": desc[:600] + ("…" if len(desc) > 600 else ""),
            "kev": "OUI — exploitée activement (CISA KEV)" if v["kev"] else "non"}


def send(title: str, text: str, prio: int = 3, url: str | None = None, fields: dict | None = None) -> list[str]:
    """Envoie un message sur tous les canaux configurés. Retourne la liste des erreurs."""
    errors = []
    fields = fields or {}
    with client() as cl:
        for ch in channels():
            try:
                if ch == "telegram":
                    body = f"<b>{html.escape(title)}</b>\n\n{html.escape(text)}"
                    for k, val in fields.items():
                        body += f"\n<b>{html.escape(k)}</b> : {html.escape(str(val))}"
                    if url:
                        body += f'\n\n<a href="{html.escape(url)}">Voir le détail</a>'
                    r = cl.post(f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage",
                                json={"chat_id": config.TELEGRAM_CHAT_ID, "text": body[:4000], "parse_mode": "HTML",
                                      "disable_web_page_preview": True})
                elif ch == "discord":
                    r = cl.post(config.DISCORD_WEBHOOK_URL, json={"embeds": [{
                        "title": title[:256], "description": text[:3500], "url": url, "color": PRIO_COLOR.get(prio),
                        "fields": [{"name": k, "value": str(v)[:1000], "inline": True} for k, v in fields.items()],
                    }]})
                elif ch == "slack":
                    extra = "\n".join(f"*{k}* : {v}" for k, v in fields.items())
                    r = cl.post(config.SLACK_WEBHOOK_URL, json={
                        "text": f"*{title}*\n{text}\n{extra}" + (f"\n<{url}|Voir le détail>" if url else "")})
                elif ch == "teams":
                    facts = [{"title": k, "value": str(v)} for k, v in fields.items()]
                    r = cl.post(config.TEAMS_WEBHOOK_URL, json={
                        "type": "message",
                        "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": {
                            "type": "AdaptiveCard", "version": "1.4",
                            "body": [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
                                     {"type": "TextBlock", "text": text, "wrap": True},
                                     {"type": "FactSet", "facts": facts}],
                            "actions": [{"type": "Action.OpenUrl", "title": "Voir le détail", "url": url}] if url else [],
                        }}]})
                elif ch == "email":
                    _email(title, text, url, fields)
                    continue
                r.raise_for_status()
            except Exception as e:
                log.error("Canal %s : %s", ch, e)
                errors.append(f"{ch}: {e}")
    return errors


def _email(title, text, url, fields):
    msg = EmailMessage()
    msg["Subject"] = f"[{config.APP_NAME}] {title}"
    msg["From"] = config.SMTP_FROM or config.SMTP_USER
    msg["To"] = config.SMTP_TO
    rows = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#666'>{html.escape(k)}</td>"
                   f"<td><b>{html.escape(str(v))}</b></td></tr>" for k, v in fields.items())
    plain = f"{title}\n\n{text}\n\n" + "\n".join(f"{k}: {v}" for k, v in fields.items()) + (f"\n\n{url}" if url else "")
    msg.set_content(plain)
    msg.add_alternative(
        f"<div style='font-family:Segoe UI,Arial,sans-serif;max-width:640px'>"
        f"<h2 style='margin:0 0 12px'>{html.escape(title)}</h2><p>{html.escape(text)}</p>"
        f"<table>{rows}</table>"
        + (f"<p><a href='{html.escape(url)}'>Voir le détail</a></p>" if url else "") + "</div>",
        subtype="html",
    )
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30) as s:
        if config.SMTP_STARTTLS:
            s.starttls()
        if config.SMTP_USER:
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(msg)


def email_to(address: str, title: str, text: str, url: str | None = None, fields: dict | None = None) -> bool:
    """E-mail individuel (ex : assignation d'une action). Ne fait rien si le SMTP n'est pas configuré."""
    if not (config.SMTP_HOST and address):
        return False
    saved = config.SMTP_TO
    try:
        config.SMTP_TO = address
        _email(title, text, url, fields or {})
        return True
    except Exception as e:
        log.error("E-mail vers %s : %s", address, e)
        return False
    finally:
        config.SMTP_TO = saved


def send_vuln(v, watches: list[str], prio: int, escalated: bool = False):
    f = _fields(v)
    head = "⬆️ Priorité relevée — " if escalated else ""
    title = f"{PRIO_EMOJI[prio]} {head}{v['id']} [{PRIO_LABEL[prio]}]"
    fields = {"Produit(s) surveillé(s)": ", ".join(watches), "CVSS": f["score"], "EPSS": f["epss"],
              "Exploitée (KEV)": f["kev"]}
    if v["title"]:
        fields = {"Titre": v["title"], **fields}
    errors = send(title, f["desc"], prio, _link(v["id"]), fields)
    if errors and len(errors) == len(channels()):
        raise RuntimeError("; ".join(errors))

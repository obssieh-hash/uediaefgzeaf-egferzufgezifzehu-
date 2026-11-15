"""Client HTTP commun aux connecteurs (gestion des retries, du proxy système et du User-Agent)."""
import logging
import time

import httpx

from .. import config

log = logging.getLogger("vulnwatch.http")


def client(**headers) -> httpx.Client:
    h = {"User-Agent": config.USER_AGENT, "Accept": "application/json, application/xml, text/xml, */*"}
    h.update(headers)
    # trust_env=True : respecte HTTP(S)_PROXY / NO_PROXY si la VM passe par un proxy d'entreprise
    return httpx.Client(timeout=config.HTTP_TIMEOUT, headers=h, follow_redirects=True, trust_env=True)


def get(cl: httpx.Client, url: str, params=None, retries: int = 4, backoff: float = 6.0) -> httpx.Response:
    last_exc = None
    for attempt in range(retries):
        try:
            r = cl.get(url, params=params)
            if r.status_code in (403, 429, 502, 503, 504) and attempt < retries - 1:
                wait = float(r.headers.get("Retry-After", backoff * (attempt + 1)))
                log.warning("HTTP %s sur %s, nouvel essai dans %.0fs", r.status_code, url, wait)
                time.sleep(min(wait, 120))
                continue
            r.raise_for_status()
            return r
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            last_exc = e
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code < 500 \
                    and e.response.status_code not in (403, 429):
                raise
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))
    raise last_exc  # type: ignore[misc]

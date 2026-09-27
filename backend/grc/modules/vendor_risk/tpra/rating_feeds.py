"""Security ratings from the providers a tenant already pays for.

UpGuard, SecurityScorecard and BitSight each rate a company from its domain. A
tenant switches one on by adding its key under Admin → Connectors (security
ratings); from then on each supplier's rating is read on the outside-in cadence
and kept through ratings.record. Every provider's score is put on one 0–100
scale, so the three sit side by side and a fall of ten points raises a signal
whichever provider it came from.

ponytail: built to each provider's published API and tested against the shapes
those APIs document; not yet run against a live account. A provider that
answers differently fails loudly in the monitoring log, never quietly.
"""
from __future__ import annotations

from typing import Callable, Dict, Optional

import requests
from sqlalchemy.orm import Session

from ....models import IntegrationConnection

CATEGORY = "security_rating"
PROVIDERS = {"upguard": "UpGuard", "securityscorecard": "SecurityScorecard", "bitsight": "BitSight"}
TIMEOUT = 30


def credentials(db: Session, tenant_id: int, integration: str) -> Optional[dict]:
    from ....services.connector_credentials import decrypt_credentials

    row = (db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == tenant_id, IntegrationConnection.category == CATEGORY,
        IntegrationConnection.integration_type == integration, IntegrationConnection.is_active.is_(True)).first())
    creds = decrypt_credentials(row.encrypted_credentials) if row is not None else None
    return creds if creds and creds.get("api_key") else None


def _letter(score: float, bands) -> str:
    return next(letter for floor, letter in bands if score >= floor)


def upguard(domain: str, creds: dict, get: Callable = requests.get) -> Optional[dict]:
    """UpGuard rates 0–950; its letter bands are A from 800 down to F below 200."""
    resp = get("https://cyber-risk.upguard.com/api/public/vendor", params={"hostname": domain},
               headers={"Authorization": creds["api_key"], "Accept": "application/json"}, timeout=TIMEOUT)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    body = resp.json() or {}
    raw = body.get("score", body.get("overallScore", (body.get("vendor") or {}).get("score")))
    if raw is None:
        return None
    raw = float(raw)
    return {"score": round(raw / 9.5, 1), "native": raw,
            "grade": _letter(raw, ((800, "A"), (600, "B"), (400, "C"), (200, "D"), (0, "F")))}


def securityscorecard(domain: str, creds: dict, get: Callable = requests.get) -> Optional[dict]:
    """SecurityScorecard already rates 0–100, with its own letter."""
    resp = get(f"https://api.securityscorecard.io/companies/{domain}",
               headers={"Authorization": f"Token {creds['api_key']}", "Accept": "application/json"}, timeout=TIMEOUT)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    body = resp.json() or {}
    if body.get("score") is None:
        return None
    raw = float(body["score"])
    return {"score": round(raw, 1), "native": raw, "grade": (body.get("grade") or None)}


def bitsight(domain: str, creds: dict, get: Callable = requests.get) -> Optional[dict]:
    """BitSight rates 250–900 and finds a company by domain first."""
    auth = (creds["api_key"], "")
    found = get("https://api.bitsighttech.com/ratings/v1/companies/search", params={"domain": domain},
                auth=auth, timeout=TIMEOUT)
    found.raise_for_status()
    body = found.json() or {}
    results = body.get("results", body if isinstance(body, list) else [])
    guid = next((r.get("guid") for r in results if r.get("guid")), None)
    if not guid:
        return None
    company = get(f"https://api.bitsighttech.com/ratings/v1/companies/{guid}", auth=auth, timeout=TIMEOUT)
    company.raise_for_status()
    detail = company.json() or {}
    history = sorted(detail.get("ratings") or [], key=lambda r: r.get("rating_date") or "", reverse=True)
    raw = history[0].get("rating") if history else detail.get("rating")
    if raw is None:
        return None
    raw = float(raw)
    # BitSight bands its scale (Advanced, Intermediate, Basic) rather than grading it, so no letter is made up.
    return {"score": round(max(0.0, min(100.0, (raw - 250) / 6.5)), 1), "native": raw, "grade": None}


FETCH: Dict[str, Callable] = {"upguard": upguard, "securityscorecard": securityscorecard, "bitsight": bitsight}

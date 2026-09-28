"""An EU supplier's VAT number, checked live against the European Commission's VIES.

VIES says whether the number is registered and, where the member state shares
them, the name and address it is registered to. The check runs only when
someone asks for it, and what it said is kept on the supplier with the date,
so a registered name that is not the supplier's is there to see.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Callable, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac, service

router = APIRouter(tags=["Vendor VAT"])

URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number"
# The member states VIES answers for (Greece as EL, Northern Ireland as XI).
COUNTRIES = ("AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT",
             "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI")
_WORDS = re.compile(r"\b(ltd|limited|llc|inc|gmbh|ag|sa|sas|sarl|srl|spa|bv|nv|oy|ab|as|plc|co|company|the)\b")


class Unavailable(Exception):
    """VIES could not answer (a member state's register is down, or too many requests)."""


def split(vat_number: str) -> tuple:
    """(country code, number) from a VAT number as people write it."""
    text = re.sub(r"[\s.\-/]", "", str(vat_number or "")).upper()
    if text.startswith("GR"):
        text = "EL" + text[2:]
    if len(text) < 4 or text[:2] not in COUNTRIES or not text[2:].isalnum():
        raise ValueError("Give an EU VAT number starting with its country code, such as DE123456789")
    return text[:2], text[2:]


def check(vat_number: str, post: Callable = requests.post) -> dict:
    country, number = split(vat_number)
    resp = post(URL, json={"countryCode": country, "vatNumber": number}, timeout=20)
    try:
        body = resp.json() or {}
    except ValueError:
        body = {}
    errors = body.get("errorWrappers") or []
    if errors or resp.status_code >= 500 or body.get("userError") not in (None, "VALID", "INVALID"):
        code = (errors[0].get("error") if errors else None) or body.get("userError") or resp.status_code
        raise Unavailable(f"VIES could not answer for {country} ({code}); try again later")
    if resp.status_code >= 400:
        raise ValueError(f"VIES refused the number ({resp.status_code})")
    shown = lambda v: None if not v or str(v).strip() in ("---", "") else " ".join(str(v).split())  # noqa: E731
    return {"vat_number": f"{country}{number}", "country": country, "valid": bool(body.get("valid")),
            "name": shown(body.get("name")), "address": shown(body.get("address")),
            "checked_at": datetime.utcnow().isoformat()}


def _core(name: Optional[str]) -> str:
    return " ".join(_WORDS.sub(" ", re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())).split())


def name_matches(registered: Optional[str], supplier: str) -> Optional[bool]:
    """Whether the registered name is the supplier's, ignoring company-form words. None
    when the member state does not share names."""
    if not registered:
        return None
    a, b = _core(registered), _core(supplier)
    return bool(a and b) and (a in b or b in a)


class VatIn(BaseModel):
    vat_number: str = Field(..., min_length=4, max_length=40)


@router.post("/vendors/{vendor_id}/vat")
def check_vendor(vendor_id: int, body: VatIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = get_user_tenants(user, db)
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids or [-1]), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    rbac.require_write(db, user, "vendors", "edit")
    try:
        result = check(body.vat_number)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    except Unavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except requests.RequestException:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "VIES could not be reached; try again later")
    result["name_matches"] = name_matches(result["name"], v.name)
    v.vat_number, v.vat_check = result["vat_number"], result
    service.write_audit(db, v.tenant_id, entity="vat", action="check", vendor_id=v.id, actor_id=user.id,
                        to_value="valid" if result["valid"] else "not valid", reason=result["vat_number"])
    db.commit()
    return result

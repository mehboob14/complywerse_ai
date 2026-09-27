"""Every supplier contract in one place, and the ones that need a decision first.

A contract needs a decision before it ends: renew it, renegotiate it or let it
go. When is worked out from its dates each time it is read: the earlier of its
renewal and expiry dates, brought forward by the notice the contract says must
be given. An auto-renewing contract with 90 days' notice therefore surfaces
while there is still time to say no, not on the day it rolls over.

The signed copy is kept in the evidence library. The AI can read the
commercial terms back out of it for someone to check; nothing it suggests is
saved until a person saves it.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import Evidence, GRCUser, TPRAAuditLog, TPRAContract, TPRAControlObligation, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac, service
from .bootstrap import get_tiering_config

router = APIRouter(tags=["Vendor contracts"])

TYPES = {
    "master": "Master agreement", "dpa": "Data processing agreement", "sla": "Service levels",
    "security_addendum": "Security addendum", "nda": "Non-disclosure", "order_form": "Order form",
    "purchase_order": "Purchase order", "sow": "Statement of work", "other": "Other",
}
STATUSES = ("draft", "active", "expired", "terminated")
RENEWAL_TYPES = ("auto", "manual", "evergreen")
BILLING = ("monthly", "quarterly", "annually")
PRICING_NUMBERS = ("unit_price", "included_units", "overage_price", "one_time_fees", "price_cap_pct")
TERM_FIELDS = ("reference", "record_link", "renewal_type", "notice_days", "annual_value", "currency",
               "billing", "pricing", "termination")
INBOX_DAYS = 90        # a contract ending within this is in the inbox
DECIDE_DAYS = 30       # this close to the last day to give notice, somebody must decide
FILE_TYPES = {".pdf", ".docx", ".txt", ".rtf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
MAX_FILE_BYTES = 25 * 1024 * 1024
_TEXT_LIMIT = 60_000   # the start of a long contract carries its commercial terms
_URL = re.compile(r"^https?://[^\s<>\"']+$", re.I)
_ORDER = {"lapsed": 0, "decide": 1, "ending": 2, "in_force": 3, "draft": 4, "ended": 5}


# ── when a contract needs somebody ───────────────────────────────────────────

def _day(value) -> Optional[date]:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def ends_on(c: TPRAContract) -> Optional[date]:
    """When the contract rolls over or stops: the earlier of its renewal and expiry dates."""
    dates = [d for d in (_day(c.renewal_date), _day(c.expiry_date)) if d]
    return min(dates) if dates else None


def act_by(c: TPRAContract) -> Optional[date]:
    """The last day to give notice: the end date less the notice the contract asks for."""
    end = ends_on(c)
    return end - timedelta(days=int(c.notice_days or 0)) if end else None


def state(c: TPRAContract, today: date, decide_days: int = DECIDE_DAYS) -> str:
    status_ = (c.status or "draft").lower()
    if status_ in ("expired", "terminated"):
        return "ended"
    if status_ != "active":
        return "draft"
    end = ends_on(c)
    if end is None:
        return "in_force"
    if end < today:
        return "lapsed"
    if act_by(c) <= today + timedelta(days=decide_days):
        return "decide"
    if end <= today + timedelta(days=INBOX_DAYS):
        return "ending"
    return "in_force"


def decide_days(db: Session, tenant_id: int) -> int:
    policy = get_tiering_config(db, tenant_id).get("reminder_policy") or {}
    return int(policy.get("contract_before_days") or DECIDE_DAYS)


def headline(c: TPRAContract, v: Vendor, when: str) -> str:
    """One line for a reminder or the attention queue."""
    end, due = ends_on(c), act_by(c)
    name = f"Contract '{c.title or TYPES.get(c.contract_type, 'contract')}' with {v.name}"
    if due and end and due < end:
        verb = "renews" if c.renewal_type == "auto" else "ends"
        return f"Notice on {name[0].lower()}{name[1:]} is {when}; it {verb} on {end:%d %b %Y}"
    return f"{name} is {when}"


# ── cleaning what people (and the AI) write ──────────────────────────────────

def _number(key: str, value, *, whole: bool = False, high: float = 1e12) -> float:
    try:
        number = int(value) if whole else float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key.replace('_', ' ').capitalize()} must be a number")
    if not 0 <= number <= high:
        raise ValueError(f"{key.replace('_', ' ').capitalize()} must be between 0 and {high:,.0f}")
    return number


def clean(raw: Dict[str, object]) -> Dict[str, object]:
    """Validate the contract fields a write gives. None or '' clears a field;
    a value that does not fit raises ValueError with a sentence to act on."""
    out: Dict[str, object] = {}
    for key, value in raw.items():
        if value is None or (isinstance(value, str) and not value.strip()):
            out[key] = None
            continue
        if key == "contract_type":
            if value not in TYPES:
                raise ValueError(f"Type must be one of: {', '.join(TYPES)}")
        elif key == "status":
            if value not in STATUSES:
                raise ValueError(f"Status must be one of: {', '.join(STATUSES)}")
        elif key == "renewal_type":
            if value not in RENEWAL_TYPES:
                raise ValueError("Renewal must be auto, manual or evergreen")
        elif key == "billing":
            if value not in BILLING:
                raise ValueError("Billing must be monthly, quarterly or annually")
        elif key == "notice_days":
            value = int(_number(key, value, whole=True, high=3650))
        elif key == "annual_value":
            value = round(_number(key, value), 2)
        elif key == "currency":
            value = str(value).strip().upper()
            if not re.fullmatch(r"[A-Z]{3}", value):
                raise ValueError("Currency must be a three-letter code such as USD")
        elif key == "reference":
            value = " ".join(str(value).split())[:120]
        elif key == "record_link":
            value = str(value).strip()
            if len(value) > 500 or not _URL.match(value):
                raise ValueError("The link must be a web address starting with http:// or https://")
        elif key == "termination":
            value = str(value).strip()[:2000]
        elif key == "pricing":
            if not isinstance(value, dict):
                raise ValueError("Pricing must be an object")
            unknown = set(value) - set(PRICING_NUMBERS) - {"uplift"}
            if unknown:
                raise ValueError(f"Unknown pricing field '{sorted(unknown)[0]}'")
            pricing = {k: _number(k, v, whole=k == "included_units")
                       for k, v in value.items() if k in PRICING_NUMBERS and v not in (None, "")}
            if pricing.get("price_cap_pct", 0) > 100:
                raise ValueError("Price cap must be a percentage between 0 and 100")
            uplift = value.get("uplift")
            if uplift is not None:
                pricing["uplift"] = uplift if isinstance(uplift, bool) else str(uplift).strip().lower() in ("true", "yes", "y", "1")
            value = pricing or None
        out[key] = value
    return out


def check_dates(c: TPRAContract) -> None:
    start = _day(c.effective_date)
    for label, when in (("renewal", _day(c.renewal_date)), ("expiry", _day(c.expiry_date))):
        if start and when and when < start:
            raise ValueError(f"The {label} date is before the contract starts")


def apply(c: TPRAContract, values: Dict[str, object]) -> Dict[str, list]:
    """Set the values, returning {field: [old, new]} for what changed."""
    changes: Dict[str, list] = {}
    for key, new in values.items():
        old = getattr(c, key)
        if _plain(old) != _plain(new):
            changes[key] = [_plain(old), _plain(new)]
            setattr(c, key, new)
    return changes


def _plain(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


# ── reading ──────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _contract(db: Session, contract_id: int, tids: List[int]) -> Tuple[TPRAContract, Vendor]:
    row = (db.query(TPRAContract, Vendor).join(Vendor, Vendor.id == TPRAContract.vendor_id)
           .filter(TPRAContract.id == contract_id, TPRAContract.tenant_id.in_(tids),
                   TPRAContract.deleted_at.is_(None), Vendor.deleted_at.is_(None)).first())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contract not found")
    return row


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def describe(c: TPRAContract, v: Vendor, today: date, decide: int) -> dict:
    end, due = ends_on(c), act_by(c)
    return {
        "id": c.id, "vendor": {"id": v.id, "name": v.name, "tier": v.tier, "owner_id": v.owner_id},
        "title": c.title, "contract_type": c.contract_type,
        "type_label": TYPES.get(c.contract_type or "", (c.contract_type or "other").replace("_", " ").capitalize()),
        "status": c.status or "draft", "state": state(c, today, decide),
        "effective_date": _plain(c.effective_date), "renewal_date": _plain(c.renewal_date),
        "expiry_date": _plain(c.expiry_date), "ends_on": _plain(end), "act_by": _plain(due),
        "days_left": (due - today).days if due else None,
        **{k: getattr(c, k) for k in TERM_FIELDS}, "terms": c.terms,
        "evidence_id": c.evidence_id, "assessment_id": c.assessment_id, "row_version": c.row_version,
    }


@router.get("/contracts")
def register(vendor_id: Optional[int] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Every contract; the inbox is the lapsed, decide and ending states at the top.
    ponytail: one payload filtered in the browser; page it if a tenant passes a few thousand."""
    tid = _tids(user, db)[0]
    today = datetime.utcnow().date()
    decide = decide_days(db, tid)
    q = (db.query(TPRAContract, Vendor).join(Vendor, Vendor.id == TPRAContract.vendor_id)
         .filter(TPRAContract.tenant_id == tid, TPRAContract.deleted_at.is_(None), Vendor.deleted_at.is_(None)))
    if vendor_id:
        q = q.filter(Vendor.id == vendor_id)
    items = [describe(c, v, today, decide) for c, v in q]
    items.sort(key=lambda r: (_ORDER[r["state"]], r["act_by"] or "9999", r["vendor"]["name"].lower()))
    counts = {k: 0 for k in _ORDER}
    value: Dict[str, float] = {}
    for r in items:
        counts[r["state"]] += 1
        if r["status"] == "active" and r["annual_value"]:
            value[r["currency"] or ""] = round(value.get(r["currency"] or "", 0) + float(r["annual_value"]), 2)
    return {"items": items, "counts": counts, "annual_value": value, "decide_days": decide,
            "inbox_days": INBOX_DAYS, "types": TYPES}


def _history(db: Session, c: TPRAContract, obligation_ids: List[int]) -> List[dict]:
    rows = (db.query(TPRAAuditLog).filter(
        TPRAAuditLog.tenant_id == c.tenant_id,
        ((TPRAAuditLog.entity == "contract") & (TPRAAuditLog.entity_id == c.id))
        | ((TPRAAuditLog.entity == "obligation") & (TPRAAuditLog.entity_id.in_(obligation_ids or [-1]))))
        .order_by(TPRAAuditLog.created_at.desc(), TPRAAuditLog.id.desc()).limit(100).all())
    names = _names(db, [r.actor_id for r in rows])
    return [{"id": r.id, "entity": r.entity, "action": r.action, "by": names.get(r.actor_id),
             "from_value": r.from_value, "to_value": r.to_value, "reason": r.reason,
             "changes": (r.extra or {}).get("changes"), "at": r.created_at} for r in rows]


@router.get("/contracts/{contract_id}")
def detail(contract_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    c, v = _contract(db, contract_id, _tids(user, db))
    obligations = (db.query(TPRAControlObligation).filter(
        TPRAControlObligation.contract_id == c.id, TPRAControlObligation.deleted_at.is_(None))
        .order_by(TPRAControlObligation.id).all())
    ev = db.get(Evidence, c.evidence_id) if c.evidence_id else None
    return {
        **describe(c, v, datetime.utcnow().date(), decide_days(db, c.tenant_id)),
        "obligations": [{"id": o.id, "obligation": o.obligation, "control_ref": o.control_ref,
                         "renewal_date": _plain(o.renewal_date), "status": o.status, "row_version": o.row_version}
                        for o in obligations],
        "file": {"evidence_id": ev.id, "name": ev.file_name or ev.name, "uploaded_at": ev.uploaded_at,
                 "read": bool((ev.ocr_content or "").strip())} if ev is not None and ev.tenant_id == c.tenant_id else None,
        "history": _history(db, c, [o.id for o in obligations]),
    }


# ── renewing ─────────────────────────────────────────────────────────────────

class RenewIn(BaseModel):
    renewal_date: Optional[date] = None
    expiry_date: Optional[date] = None
    annual_value: Optional[float] = None
    note: Optional[str] = Field(None, max_length=2000)


def _at(d: Optional[date]) -> Optional[datetime]:
    return datetime(d.year, d.month, d.day) if d else None


@router.post("/contracts/{contract_id}/renew")
def renew(contract_id: int, body: RenewIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """A new term: the contract's dates move on and it is in force again."""
    c, v = _contract(db, contract_id, _tids(user, db))
    rbac.require_write(db, user, "contracts", "edit")
    if not (body.renewal_date or body.expiry_date):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give the new renewal or end date")
    old_end = ends_on(c)
    values: Dict[str, object] = {"status": "active"}
    if body.renewal_date:
        values["renewal_date"] = _at(body.renewal_date)
    if body.expiry_date:
        values["expiry_date"] = _at(body.expiry_date)
    if body.annual_value is not None:
        values["annual_value"] = body.annual_value
    try:
        values = clean(values)
        changes = apply(c, values)
        check_dates(c)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    new_end = ends_on(c)
    if old_end and (new_end is None or new_end <= old_end):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"The new term must end after {old_end:%d %b %Y}")
    c.row_version = (c.row_version or 1) + 1
    service.write_audit(db, c.tenant_id, entity="contract", action="renew", vendor_id=v.id, entity_id=c.id,
                        actor_id=user.id, from_value=_plain(old_end), to_value=_plain(new_end),
                        reason=" ".join((body.note or "").split()) or None, extra={"changes": changes})
    db.commit()
    return describe(c, v, datetime.utcnow().date(), decide_days(db, c.tenant_id))


# ── the signed copy, and the AI reading its terms ────────────────────────────

@router.post("/contracts/{contract_id}/file")
async def attach_file(contract_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                      user: GRCUser = Depends(require_auth)):
    """Keep the signed copy in the evidence library; a new upload replaces the link."""
    from .api import _save_evidence_file

    c, v = _contract(db, contract_id, _tids(user, db))
    rbac.require_write(db, user, "contracts", "edit")
    if os.path.splitext(file.filename or "")[1].lower() not in FILE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Upload the contract as one of: {', '.join(sorted(t[1:] for t in FILE_TYPES))}")
    if len(await file.read(MAX_FILE_BYTES + 1)) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 25 MB")
    await file.seek(0)
    ev = await _save_evidence_file(db, c.tenant_id, f"{v.name}: {c.title or TYPES.get(c.contract_type, 'contract')} (signed)"[:255],
                                   "vendor_contract", file, user.id)
    ev.ocr_status = "pending"
    previous, c.evidence_id = c.evidence_id, ev.id
    c.row_version = (c.row_version or 1) + 1
    service.write_audit(db, c.tenant_id, entity="contract", action="attach_file", vendor_id=v.id, entity_id=c.id,
                        actor_id=user.id, from_value=previous, to_value=ev.id, reason=file.filename)
    db.commit()
    return {"evidence_id": ev.id, "name": ev.file_name}


_ASK = """You read supplier contracts and pull out their commercial terms.
Answer with one JSON object and nothing else. Use null for anything the contract does not state; never guess.

Fields:
- title: a short name for the agreement
- contract_type: one of {types}
- reference: the contract, order or purchase-order number
- effective_date, renewal_date, expiry_date: dates as YYYY-MM-DD
- renewal_type: "auto" if it renews unless someone gives notice, "manual" if it must be renewed, "evergreen" if it has no end date
- notice_days: the days of notice needed to cancel or not renew, as a number
- annual_value: the amount payable per year, as a plain number (turn monthly or quarterly amounts into a year)
- currency: the three-letter currency code
- billing: "monthly", "quarterly" or "annually"
- unit_price, included_units, overage_price, one_time_fees: plain numbers
- price_cap_pct: the cap on yearly price rises, as a percentage number
- uplift: true if the price rises automatically at renewal
- termination: one sentence on how either side can end the contract

The supplier is {vendor}. The contract:
"""


def _first_number(value):
    """'USD 12,000 per year' -> '12000'; the AI does not always answer with bare numbers."""
    if isinstance(value, str):
        found = re.search(r"\d[\d,]*(?:\.\d+)?", value)
        return found.group(0).replace(",", "") if found else value
    return value


def ai_terms(text: str, vendor_name: str, complete: Optional[Callable] = None) -> Tuple[dict, List[str]]:
    """The AI's reading of a contract, cleaned field by field. Returns
    (suggested values, fields it gave that did not fit)."""
    from ....services.assessment_evidence_ai import _parse, openai_complete

    reply = (complete or openai_complete)([
        {"role": "system", "content": _ASK.format(types=", ".join(TYPES), vendor=vendor_name[:200])},
        {"role": "user", "content": text[:_TEXT_LIMIT]},
    ])
    raw = _parse(reply)
    suggested: dict = {}
    skipped: List[str] = []
    pricing = {k: _first_number(raw.get(k)) if k != "uplift" else raw.get(k)
               for k in (*PRICING_NUMBERS, "uplift") if raw.get(k) not in (None, "")}
    fields = {k: _first_number(raw.get(k)) if k in ("notice_days", "annual_value") else raw.get(k)
              for k in ("contract_type", *TERM_FIELDS) if k != "pricing"}
    fields["pricing"] = pricing or None
    for key, value in fields.items():
        if value in (None, ""):
            continue
        try:
            suggested.update(clean({key: value}))
        except (ValueError, TypeError):
            skipped.append(key)
    if raw.get("title"):
        suggested["title"] = " ".join(str(raw["title"]).split())[:255]
    for key in ("effective_date", "renewal_date", "expiry_date"):
        try:
            if raw.get(key):
                suggested[key] = date.fromisoformat(str(raw[key])[:10]).isoformat()
        except ValueError:
            skipped.append(key)
    return {k: v for k, v in suggested.items() if v is not None}, skipped


@router.post("/contracts/{contract_id}/read-terms")
def read_terms(contract_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Suggestions for someone to check and save; nothing is written here."""
    from ....services.assessment_evidence_ai import AIUnavailable
    from ...evidence.routers.ocr import process_evidence_ocr

    c, v = _contract(db, contract_id, _tids(user, db))
    rbac.require_write(db, user, "contracts", "edit")
    ev = db.get(Evidence, c.evidence_id) if c.evidence_id else None
    if ev is None or ev.tenant_id != c.tenant_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Attach the signed contract first")
    if not (ev.ocr_content or "").strip():
        result = process_evidence_ocr(ev, db)
        if not (ev.ocr_content or "").strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"The contract's text could not be read: {result.message}")
    try:
        suggested, skipped = ai_terms(ev.ocr_content, v.name)
    except AIUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except Exception:  # noqa: BLE001 — a failed call must not look like an empty contract
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI could not read the contract. Try again.")
    return {"suggested": suggested, "skipped": skipped}

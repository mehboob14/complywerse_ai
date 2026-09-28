"""Onboarding requests, the procurement view of them, and bulk vendor import.

Requests are vendor records with an intake (tpra/intake.py): a requester fills it
in and submits it, the TPRM team picks it up (which starts the lifecycle with the
answers already applied and tiers the vendor from them) or turns it down, and the
lifecycle's approval decision closes it.

The requester can edit their own request until it is picked up; the TPRM team
can edit it any time. Nothing here changes how a vendor added directly behaves.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAAuditLog, TPRAStageInstance, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import customisation, intake, rbac, service
from .bootstrap import get_tiering_config
from .engine_tiering import compute_inherent_tier
from .stages import TPRA_STAGES

router = APIRouter(tags=["Vendor onboarding"])

_STAGE_LABEL = {s["key"]: s["label"] for s in TPRA_STAGES}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids),
                                Vendor.deleted_at.is_(None)).first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def _can(db: Session, user: GRCUser, resource: str, action: str) -> bool:
    try:
        rbac.require_write(db, user, resource, action)
        return True
    except HTTPException:
        return False


def _may_edit(db: Session, user: GRCUser, v: Vendor) -> bool:
    """The requester, while it is still theirs; the TPRM team, always."""
    if v.requested_by == user.id and (v.intake_status or "draft") in ("draft", "rejected"):
        return True
    return _can(db, user, "vendors", "edit")


def _custom(db: Session, tenant_id: int) -> dict:
    """The tenant's own questions, factors and evidence types (tpra/customisation.py)."""
    return get_tiering_config(db, tenant_id).get("customisation") or {}


def _preview(db: Session, v: Vendor) -> dict:
    cfg = get_tiering_config(db, v.tenant_id)
    scores, why = intake.factors(v.intake, cfg.get("customisation"))
    result = compute_inherent_tier(scores, cfg)
    result["reasons"] = why
    return result


# ── the questions and a live tier ────────────────────────────────────────────

@router.get("/intake/questions")
def questions(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The questions as this tenant asks them, and the factors a tier is made of."""
    custom = _custom(db, _tids(user, db)[0])
    return {**intake.catalogue(custom), "factors": customisation.factors(custom)}


@router.get("/intake/people")
def people(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Who can own or look after a supplier — for anyone raising a request, who
    may not be allowed to read the admin user list."""
    _tids(user, db)
    rows = (db.query(GRCUser).filter(GRCUser.is_active.is_(True))
            .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc()))
    return [{"id": u.id, "name": u.display_name or u.username or u.email} for u in rows]


class PreviewIn(BaseModel):
    answers: dict = Field(default_factory=dict)


@router.post("/intake/preview")
def preview(body: PreviewIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The tier these answers would give, without saving anything."""
    tids = _tids(user, db)
    cfg = get_tiering_config(db, tids[0])
    try:
        cleaned = intake.clean(body.answers, {}, cfg.get("customisation"))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    scores, why = intake.factors(cleaned, cfg.get("customisation"))
    result = compute_inherent_tier(scores, cfg)
    result["reasons"] = why
    return result


# ── requests ─────────────────────────────────────────────────────────────────

def _request_row(v: Vendor, names: dict, stages: dict, custom: Optional[dict] = None) -> dict:
    return {
        "id": v.id, "name": v.name, "website": v.website, "host": intake.host(v.website),
        "intake_status": v.intake_status, "vendor_status": v.status, "tier": v.tier,
        "tiered": v.inherent_risk_score is not None,
        "requested_by": {"id": v.requested_by, "name": names.get(v.requested_by)} if v.requested_by else None,
        "owner": {"id": v.owner_id, "name": names.get(v.owner_id)} if v.owner_id else None,
        "submitted_at": v.submitted_at, "created_at": v.created_at, "updated_at": v.updated_at,
        "stage": stages.get(v.id), "open_problems": len(intake.problems(v.intake, v, custom)),
    }


@router.get("/intake/requests")
def list_requests(
    intake_status: Optional[str] = Query(None, alias="status"),
    scope: Literal["all", "mine"] = "all",
    search: Optional[str] = None,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    q = db.query(Vendor).filter(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None),
                                Vendor.intake_status.isnot(None))
    if search:
        q = q.filter(Vendor.name.ilike(f"%{search}%"))
    rows = q.order_by(Vendor.updated_at.desc()).all()
    if scope == "mine":
        rows = [v for v in rows if intake.mine(v, user.id)]
    counts = {s: 0 for s in intake.STATUSES}
    for v in rows:
        counts[v.intake_status] = counts.get(v.intake_status, 0) + 1
    if intake_status:
        rows = [v for v in rows if v.intake_status == intake_status]
    names = _names(db, [x for v in rows for x in (v.requested_by, v.owner_id)])
    stages = {v.id: {"key": v.lifecycle_stage, "label": _STAGE_LABEL.get(v.lifecycle_stage or "")}
              for v in rows if v.intake_status in ("in_review", "approved")}
    custom = _custom(db, tids[0])
    return {"items": [_request_row(v, names, stages, custom) for v in rows], "counts": counts,
            "can_create": _can(db, user, "intake", "create"), "can_review": _can(db, user, "intake", "review")}


class NewRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    website: Optional[str] = None


@router.post("/intake/requests", status_code=status.HTTP_201_CREATED)
def create_request(body: NewRequest, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    rbac.require_write(db, user, "intake", "create")
    name = " ".join(body.name.split())
    existing = db.query(Vendor).filter(Vendor.tenant_id == tids[0], Vendor.deleted_at.is_(None),
                                       func.lower(Vendor.name) == name.lower()).first()
    if existing is None and intake.host(body.website):
        existing = next((v for v in db.query(Vendor).filter(Vendor.tenant_id == tids[0], Vendor.deleted_at.is_(None),
                                                            Vendor.website.isnot(None))
                         if intake.host(v.website) == intake.host(body.website)), None)
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"{existing.name} is already on record (ID {existing.id}); open it instead of requesting it again.")
    v = Vendor(tenant_id=tids[0], name=name, website=(body.website or "").strip() or None, tier="medium",
               status="requested", intake_status="draft", requested_by=user.id, owner_id=user.id,
               intake={"answers": {}, "justifications": {}})
    db.add(v)
    db.flush()
    service.write_audit(db, v.tenant_id, entity="request", action="create", vendor_id=v.id, actor_id=user.id,
                        to_value="draft")
    db.commit()
    return {"id": v.id}


# ── one request's intake ─────────────────────────────────────────────────────

def _payload(db: Session, user: GRCUser, v: Vendor) -> dict:
    names = _names(db, [v.requested_by, v.owner_id, *(v.stakeholder_ids or [])])
    return {
        "vendor": {
            "id": v.id, "name": v.name, "website": v.website, "owner_id": v.owner_id,
            "stakeholder_ids": v.stakeholder_ids or [], "notify_emails": v.notify_emails or "",
            "primary_contact_name": v.primary_contact_name, "primary_contact_email": v.primary_contact_email,
            "primary_contact_phone": v.primary_contact_phone, "contract_value": v.contract_value,
            "industry": v.industry, "status": v.status, "tier": v.tier, "lifecycle_stage": v.lifecycle_stage,
        },
        "people": {str(k): n for k, n in names.items()},
        "requested_by": v.requested_by, "submitted_at": v.submitted_at,
        "intake": v.intake or {"answers": {}, "justifications": {}},
        "intake_status": v.intake_status,
        "problems": intake.problems(v.intake, v, _custom(db, v.tenant_id)),
        "preview": _preview(db, v),
        "can_edit": _may_edit(db, user, v),
        "can_review": _can(db, user, "intake", "review"),
        "next": list(intake.next_statuses(v.intake_status)),
        "updated_at": v.updated_at,
    }


@router.get("/vendors/{vendor_id}/intake")
def read_intake(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return _payload(db, user, _vendor(db, vendor_id, _tids(user, db)))


class VendorPart(BaseModel):
    name: Optional[str] = None
    website: Optional[str] = None
    owner_id: Optional[int] = None
    stakeholder_ids: Optional[List[int]] = None
    notify_emails: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    contract_value: Optional[float] = None
    industry: Optional[str] = None


class IntakeIn(BaseModel):
    vendor: Optional[VendorPart] = None
    answers: dict = Field(default_factory=dict)
    justifications: dict = Field(default_factory=dict)


def _apply_vendor_part(db: Session, v: Vendor, part: VendorPart) -> None:
    data = part.model_dump(exclude_unset=True)
    if "name" in data:
        name = " ".join((data["name"] or "").split())
        if not name:
            raise ValueError("The supplier needs a name")
        data["name"] = name
    people = [x for x in [data.get("owner_id"), *(data.get("stakeholder_ids") or [])] if x]
    if people:
        known = {u.id for u in db.query(GRCUser.id).filter(GRCUser.id.in_(people))}
        if set(people) - known:
            raise ValueError("Owner and stakeholders must be platform users")
    if data.get("notify_emails"):
        emails = [e.strip() for e in data["notify_emails"].replace(";", ",").split(",") if e.strip()]
        bad = [e for e in emails if not _EMAIL.match(e)]
        if bad:
            raise ValueError(f"Not an email address: {', '.join(bad)}")
        data["notify_emails"] = ", ".join(dict.fromkeys(emails))
    if "stakeholder_ids" in data:
        data["stakeholder_ids"] = list(dict.fromkeys(data["stakeholder_ids"] or []))
    for key, value in data.items():
        setattr(v, key, value.strip() if isinstance(value, str) else value)


@router.put("/vendors/{vendor_id}/intake")
def save_intake(vendor_id: int, body: IntakeIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Save as you go: partial answers are fine until the request is submitted."""
    v = _vendor(db, vendor_id, _tids(user, db))
    if not _may_edit(db, user, v):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This request is with the review team now")
    custom = _custom(db, v.tenant_id)
    try:
        patch = intake.clean(body.answers, body.justifications, custom)
        if body.vendor is not None:
            _apply_vendor_part(db, v, body.vendor)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    v.intake = intake.merge(v.intake, patch)
    intake.apply_to_vendor(v, v.intake, custom)
    v.updated_at = datetime.utcnow()
    db.commit()
    return _payload(db, user, v)


def _move(db: Session, v: Vendor, user: GRCUser, to: str, reason: Optional[str] = None) -> None:
    if to not in intake.next_statuses(v.intake_status):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"A request that is {(v.intake_status or 'not a request').replace('_', ' ')} cannot be {to.replace('_', ' ')}")
    before = v.intake_status
    intake.set_status(v, to)
    service.write_audit(db, v.tenant_id, entity="request", action="status", vendor_id=v.id, actor_id=user.id,
                        from_value=before, to_value=to, reason=reason)


@router.post("/vendors/{vendor_id}/intake/submit")
def submit(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    if not _may_edit(db, user, v):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the requester or the review team can submit this")
    missing = intake.problems(v.intake, v, _custom(db, v.tenant_id))
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"message": "Some answers are missing", "problems": missing})
    _move(db, v, user, "submitted")
    v.submitted_at = datetime.utcnow()
    db.commit()
    return _payload(db, user, v)


@router.post("/vendors/{vendor_id}/intake/review")
def start_review(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Pick the request up: the lifecycle starts with the answers already in, and
    the vendor is tiered from them."""
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "intake", "review")
    _move(db, v, user, "in_review")
    assessment = service.ensure_active_assessment(db, v, actor_id=user.id)
    tier = service.run_tiering(db, v, assessment, actor_id=user.id) if intake.has_answers(v.intake) else None
    db.commit()
    payload = _payload(db, user, v)
    payload["assessment_id"] = assessment.id
    payload["tiering"] = tier
    return payload


class DecisionIn(BaseModel):
    reason: str = Field(..., min_length=10, max_length=2000)


@router.post("/vendors/{vendor_id}/intake/reject")
def reject(vendor_id: int, body: DecisionIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "intake", "review")
    _move(db, v, user, "rejected", reason=body.reason)
    db.commit()
    return _payload(db, user, v)


@router.post("/vendors/{vendor_id}/intake/return")
def return_to_requester(vendor_id: int, body: DecisionIn, db: Session = Depends(get_db),
                        user: GRCUser = Depends(require_auth)):
    """Send a submitted (or turned-down) request back to the requester to fix."""
    v = _vendor(db, vendor_id, _tids(user, db))
    if v.intake_status == "rejected":
        if not _may_edit(db, user, v):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the requester or the review team can reopen this")
    else:
        rbac.require_write(db, user, "intake", "review")
    _move(db, v, user, "draft", reason=body.reason)
    db.commit()
    return _payload(db, user, v)


# ── procurement's view: what is waiting, and what happened last ──────────────

def _describe(row: TPRAAuditLog) -> str:
    what = f"{row.entity} {row.action}".replace("_", " ")
    if row.to_value not in (None, ""):
        what += f" → {str(row.to_value).replace('_', ' ')}"
    return what


@router.get("/intake/procurement")
def procurement_status(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Suppliers procurement is waiting on: requested, or in onboarding review."""
    items = waiting_on_review(db, _tids(user, db))
    return {"items": items, "total": len(items)}


def waiting_on_review(db: Session, tids: List[int]) -> List[dict]:
    """The suppliers waiting on onboarding review, oldest first, with where each
    is and the last thing that happened to it (also the weekly digest's list)."""
    rows = (db.query(Vendor).filter(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None))
            .filter((Vendor.intake_status.in_(("submitted", "in_review"))) | (Vendor.status == "onboarding"))
            .order_by(Vendor.submitted_at.asc().nullslast(), Vendor.created_at.asc()).all())
    ids = [v.id for v in rows] or [-1]
    last = {}
    for r in (db.query(TPRAAuditLog).filter(TPRAAuditLog.vendor_id.in_(ids))
              .order_by(TPRAAuditLog.created_at.desc())):
        last.setdefault(r.vendor_id, r)
    since = {}
    for s in db.query(TPRAStageInstance).filter(TPRAStageInstance.vendor_id.in_(ids),
                                                TPRAStageInstance.status == "in_progress"):
        since[s.vendor_id] = s.started_at
    names = _names(db, [x for v in rows for x in (v.requested_by, v.owner_id)] + [r.actor_id for r in last.values()])
    today = datetime.utcnow()
    items = []
    for v in rows:
        waiting_from = v.submitted_at or v.created_at or today
        entry = last.get(v.id)
        items.append({
            "id": v.id, "name": v.name, "tier": v.tier, "intake_status": v.intake_status, "vendor_status": v.status,
            "requested_by": names.get(v.requested_by), "owner": names.get(v.owner_id),
            "submitted_at": v.submitted_at, "days_waiting": max(0, (today - waiting_from).days),
            "stage": {"key": v.lifecycle_stage, "label": _STAGE_LABEL.get(v.lifecycle_stage or "", "Request"),
                      "since": since.get(v.id)} if v.intake_status != "submitted" else
                     {"key": "request", "label": "Waiting for review", "since": v.submitted_at},
            "last_update": {"at": entry.created_at, "what": _describe(entry), "by": names.get(entry.actor_id)}
            if entry else None,
        })
    return items


# ── bulk import / mass update ────────────────────────────────────────────────

IMPORT_COLUMNS = [
    "name", "website", "vendor_type", "industry", "description", "owner_email", "primary_contact_name",
    "primary_contact_email", "primary_contact_phone", "contract_start_date", "contract_end_date",
    "contract_value", "data_access_level", "data_types", "locations", "status", "tier", "notes",
]
_ACCESS = ("none", "public", "internal", "confidential", "restricted")
_TIERS = ("critical", "high", "medium", "low")
_VENDOR_STATUSES = ("active", "onboarding", "under_review", "suspended", "offboarded", "inactive")
_MAX_ROWS = 5000
_MAX_BYTES = 10 * 1024 * 1024


@router.get("/vendors/import/template")
def import_template(user: GRCUser = Depends(require_auth)):
    return Response(",".join(IMPORT_COLUMNS) + "\r\n", media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="vendor-import-template.csv"'})


def _rows(name: str, content: bytes) -> List[dict]:
    if name.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        sheet = load_workbook(io.BytesIO(content), read_only=True, data_only=True).worksheets[0]
        values = list(sheet.iter_rows(values_only=True))
        if not values:
            return []
        header = [str(h or "").strip().lower() for h in values[0]]
        return [{header[i]: row[i] for i in range(min(len(header), len(row)))} for row in values[1:]
                if any(c not in (None, "") for c in row)]
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    reader.fieldnames = [(f or "").strip().lower() for f in (reader.fieldnames or [])]
    return [r for r in reader if any((c or "").strip() for c in r.values() if isinstance(c, str))]


def _date(value) -> Optional[datetime]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    return datetime.strptime(str(value).strip()[:10], "%Y-%m-%d")


def _plan_row(db: Session, tenant_id: int, row: dict, by_host: dict, by_name: dict, users: dict) -> dict:
    """What one row would do: create, update (with the fields that change), or why it can't."""
    text = {k: ("" if row.get(k) is None else str(row.get(k)).strip()) for k in IMPORT_COLUMNS}
    target = by_host.get(intake.host(text["website"])) if text["website"] else None
    target = target or (by_name.get(text["name"].lower()) if text["name"] else None)
    errors, changes = [], {}
    if target is None and not text["name"]:
        errors.append("name is required for a new vendor")
    try:
        if text["contract_value"]:
            changes["contract_value"] = float(text["contract_value"].replace(",", ""))
        for key in ("contract_start_date", "contract_end_date"):
            if text[key]:
                changes[key] = _date(row.get(key))
    except ValueError:
        errors.append("dates must be YYYY-MM-DD and the contract value a number")
    if text["data_access_level"]:
        if text["data_access_level"].lower() not in _ACCESS:
            errors.append(f"data_access_level must be one of {', '.join(_ACCESS)}")
        changes["data_access_level"] = text["data_access_level"].lower()
    if text["tier"]:
        if text["tier"].lower() not in _TIERS:
            errors.append(f"tier must be one of {', '.join(_TIERS)}")
        elif target is None or target.inherent_risk_score is None:
            changes["tier"] = text["tier"].lower()
    if text["status"]:
        if text["status"].lower() not in _VENDOR_STATUSES:
            errors.append(f"status must be one of {', '.join(_VENDOR_STATUSES)}")
        changes["status"] = text["status"].lower()
    if text["owner_email"]:
        owner = users.get(text["owner_email"].lower())
        if owner is None:
            errors.append(f"no platform user with email {text['owner_email']}")
        else:
            changes["owner_id"] = owner
    for key in ("name", "website", "vendor_type", "industry", "description", "primary_contact_name",
                "primary_contact_email", "primary_contact_phone", "notes"):
        if text[key]:
            changes[key] = text[key]
    for key, column in (("data_types", "data_types_accessed"), ("locations", "geographic_locations")):
        if text[key]:
            changes[column] = [x.strip() for x in re.split(r"[;|]", text[key]) if x.strip()]
    if target is not None:
        changes = {k: v for k, v in changes.items() if getattr(target, k) != v}
        if "website" in changes and intake.host(changes["website"]) == intake.host(target.website):
            del changes["website"]          # the same site, written differently
    return {"action": "error" if errors else ("update" if target is not None else "create"),
            "vendor_id": target.id if target is not None else None,
            "name": text["name"] or (target.name if target is not None else ""),
            "changes": sorted(changes), "errors": errors, "_values": changes, "_target": target}


@router.post("/vendors/import")
async def import_vendors(
    file: UploadFile = File(...), dry_run: bool = Query(True),
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    """Create or update vendors from a CSV or Excel sheet. A dry run shows what
    each row would do; applying is all or nothing, so a bad row changes nothing."""
    tids = _tids(user, db)
    rbac.require_write(db, user, "vendors", "create")
    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is over 10 MB")
    try:
        rows = _rows(file.filename or "", content)
    except Exception:  # noqa: BLE001 — any unreadable sheet gets the same answer
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the file; use the CSV template")
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file has no rows")
    if len(rows) > _MAX_ROWS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"At most {_MAX_ROWS} rows per file")
    unknown = sorted(set().union(*(r.keys() for r in rows)) - set(IMPORT_COLUMNS) - {""})
    tenant_id = tids[0]
    existing = db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None)).all()
    by_host = {intake.host(v.website): v for v in existing if intake.host(v.website)}
    by_name = {(v.name or "").lower(): v for v in existing}
    users = {(u.email or "").lower(): u.id for u in db.query(GRCUser).filter(GRCUser.email.isnot(None))}
    plan, seen = [], set()
    for number, row in enumerate(rows, start=2):
        item = _plan_row(db, tenant_id, row, by_host, by_name, users)
        key = item["vendor_id"] or (item["name"] or "").lower()
        if key in seen:
            item["errors"].append("this vendor appears twice in the file")
            item["action"] = "error"
        seen.add(key)
        item["row"] = number
        plan.append(item)
    summary = {a: sum(1 for p in plan if p["action"] == a) for a in ("create", "update", "error")}
    public = [{k: v for k, v in p.items() if not k.startswith("_")} for p in plan]
    if dry_run or summary["error"]:
        if not dry_run:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                {"message": "Fix the rows with errors first; nothing was imported", "rows": public})
        return {"dry_run": True, "summary": summary, "rows": public, "ignored_columns": unknown}
    for p in plan:
        values = p["_values"]
        if p["action"] == "create":
            v = Vendor(tenant_id=tenant_id, **{"status": "active", "tier": "medium", "data_access_level": "none", **values})
            db.add(v)
            db.flush()
        elif values:
            v = p["_target"]
            for key, value in values.items():
                setattr(v, key, value)
            v.updated_at = datetime.utcnow()
        else:
            continue
        service.write_audit(db, tenant_id, entity="vendor", action=f"import_{p['action']}", vendor_id=v.id,
                            actor_id=user.id, to_value=", ".join(p["changes"]) or None,
                            reason=f"row {p['row']} of {file.filename}")
    db.commit()
    return {"dry_run": False, "summary": summary, "rows": public, "ignored_columns": unknown}

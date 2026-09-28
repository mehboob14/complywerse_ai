"""Once a year, whoever looks after a supplier says whether anything has changed.

Three questions: is the owner still the right person, has anything about the
relationship changed, and are the supplier's contact details still right. It
takes a minute; what it catches — a new service, a new country, an owner who has
left — is what otherwise quietly makes the programme's records wrong.

When a check-in is due is worked out when read: a year (or the tenant's
reminder policy's `checkin_every_days`) after the last one, or after the vendor
was approved (added, for vendors added directly). A reported change goes to the
attention queue for the TPRM team; overdue check-ins remind the owner.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAApproval, TPRACheckin, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import intake, rbac, service
from .bootstrap import get_tiering_config
from .reminders import _INACTIVE_VENDOR

router = APIRouter(tags=["Vendor check-ins"])

CADENCE_DAYS = 365
DUE_SOON_DAYS = 30
RECENT_DAYS = 60
_OUT_OF_SCOPE = _INACTIVE_VENDOR + ("onboarding",)
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def cadence(db: Session, tenant_id: int) -> int:
    policy = get_tiering_config(db, tenant_id).get("reminder_policy") or {}
    return int(policy.get("checkin_every_days") or CADENCE_DAYS)


def in_scope(v: Vendor) -> bool:
    """Vendors in use: not a request still being decided, not retired."""
    return (v.status or "active").lower() not in _OUT_OF_SCOPE


def latest(db: Session, tenant_id: int) -> Dict[int, TPRACheckin]:
    out: Dict[int, TPRACheckin] = {}
    for c in (db.query(TPRACheckin).filter(TPRACheckin.tenant_id == tenant_id)
              .order_by(TPRACheckin.completed_at.desc())):
        out.setdefault(c.vendor_id, c)
    return out


def approved_on(db: Session, tenant_id: int) -> Dict[int, date]:
    out: Dict[int, date] = {}
    for a in (db.query(TPRAApproval).filter(TPRAApproval.tenant_id == tenant_id,
                                            TPRAApproval.decision.in_(("approve", "approve_with_conditions")))
              .order_by(TPRAApproval.created_at.asc())):
        if a.created_at:
            out.setdefault(a.vendor_id, a.created_at.date())
    return out


def due_date(v: Vendor, last: Optional[TPRACheckin], approved: Optional[date], every: int) -> date:
    base = last.completed_at.date() if last else (approved or (v.created_at or datetime.utcnow()).date())
    return base + timedelta(days=every)


def state_of(due: date, last: Optional[TPRACheckin], today: date) -> str:
    if due < today:
        return "overdue"
    if due <= today + timedelta(days=DUE_SOON_DAYS):
        return "due_soon"
    if last is not None and (today - last.completed_at.date()).days <= RECENT_DAYS:
        return "done"
    return "upcoming"


def schedule(db: Session, tenant_id: int, today: date, every: Optional[int] = None) -> List[dict]:
    """Every vendor in use with its check-in due date and state. Sweeps that
    already hold the reminder policy pass its interval in."""
    from .action_plans import requested_checkins  # here: action_plans reads vendors this module scopes

    every = every or cadence(db, tenant_id)
    lasts, approvals = latest(db, tenant_id), approved_on(db, tenant_id)
    asked = requested_checkins(db, tenant_id)
    out = []
    for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None)):
        if not in_scope(v):
            continue
        last = lasts.get(v.id)
        due = due_date(v, last, approvals.get(v.id), every)
        # A check-in planned for a date (action_plans.py) is due then, unless one was done since.
        since = last.completed_at.date() if last else None
        planned = [d for d in asked.get(v.id, []) if since is None or d > since]
        if planned:
            due = min(due, min(planned))
        out.append({"vendor": v, "last": last, "due": due, "state": state_of(due, last, today)})
    return out


def _team(db: Session, user: GRCUser) -> bool:
    try:
        rbac.require_write(db, user, "vendors", "edit")
        return True
    except HTTPException:
        return False


def _may_check_in(db: Session, user: GRCUser, v: Vendor) -> bool:
    return intake.mine(v, user.id) or _team(db, user)


def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def _row(c: TPRACheckin, names: dict) -> dict:
    return {"id": c.id, "completed_at": c.completed_at, "by": names.get(c.completed_by), "due_date": c.due_date,
            "on_time": c.due_date is None or c.completed_at.date() <= c.due_date,
            "still_owner": c.still_owner, "new_owner": names.get(c.new_owner_id), "changed": c.changed,
            "change_notes": c.change_notes, "contact_current": c.contact_current, "contact_update": c.contact_update}


@router.get("/checkins")
def board(scope: Literal["all", "mine"] = "all", search: Optional[str] = None,
          db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    today = datetime.utcnow().date()
    rows = schedule(db, tids[0], today)
    if scope == "mine":
        rows = [r for r in rows if intake.mine(r["vendor"], user.id)]
    if search:
        rows = [r for r in rows if search.lower() in (r["vendor"].name or "").lower()]
    names = _names(db, [x for r in rows for x in (r["vendor"].owner_id, r["last"].completed_by if r["last"] else None)])
    team = _team(db, user)
    order = {"overdue": 0, "due_soon": 1, "upcoming": 2, "done": 3}
    rows.sort(key=lambda r: (order[r["state"]], r["due"]))
    counts = {k: 0 for k in order}
    for r in rows:
        counts[r["state"]] += 1
    return {
        "items": [{
            "vendor_id": r["vendor"].id, "name": r["vendor"].name, "tier": r["vendor"].tier,
            "owner": {"id": r["vendor"].owner_id, "name": names.get(r["vendor"].owner_id)} if r["vendor"].owner_id else None,
            "last": {"at": r["last"].completed_at, "by": names.get(r["last"].completed_by), "changed": r["last"].changed}
            if r["last"] else None,
            "due_date": r["due"], "state": r["state"], "days": (r["due"] - today).days,
            "can_check_in": team or intake.mine(r["vendor"], user.id),
        } for r in rows],
        "counts": counts, "every_days": cadence(db, tids[0]),
    }


@router.get("/vendors/{vendor_id}/checkins")
def history(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    rows = (db.query(TPRACheckin).filter(TPRACheckin.vendor_id == v.id)
            .order_by(TPRACheckin.completed_at.desc()).all())
    names = _names(db, [x for c in rows for x in (c.completed_by, c.new_owner_id)] + [v.owner_id])
    today = datetime.utcnow().date()
    due = due_date(v, rows[0] if rows else None, approved_on(db, v.tenant_id).get(v.id), cadence(db, v.tenant_id))
    return {
        "vendor": {"id": v.id, "name": v.name, "owner_id": v.owner_id, "owner": names.get(v.owner_id),
                   "primary_contact_name": v.primary_contact_name, "primary_contact_email": v.primary_contact_email,
                   "primary_contact_phone": v.primary_contact_phone},
        "due_date": due, "state": state_of(due, rows[0] if rows else None, today) if in_scope(v) else "not_in_use",
        "can_check_in": _may_check_in(db, user, v),
        "items": [_row(c, names) for c in rows],
    }


class ContactIn(BaseModel):
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None


class CheckinIn(BaseModel):
    still_owner: bool
    new_owner_id: Optional[int] = None
    changed: bool
    change_notes: Optional[str] = Field(None, max_length=4000)
    contact_current: bool
    contact: Optional[ContactIn] = None


@router.post("/vendors/{vendor_id}/checkins", status_code=status.HTTP_201_CREATED)
def check_in(vendor_id: int, body: CheckinIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    if not _may_check_in(db, user, v):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the people looking after this supplier can check in")
    notes = " ".join((body.change_notes or "").split())
    if body.changed and len(notes) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say what has changed")
    if not body.still_owner:
        if not body.new_owner_id or body.new_owner_id == v.owner_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name the person who owns it now")
        if db.query(GRCUser.id).filter(GRCUser.id == body.new_owner_id, GRCUser.is_active.is_(True)).first() is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new owner must be an active platform user")
    update = {}
    if not body.contact_current:
        update = {k: " ".join(val.split()) for k, val in (body.contact.model_dump() if body.contact else {}).items()
                  if val and val.strip()}
        if not update:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give the corrected contact details")
        if update.get("primary_contact_email") and not _EMAIL.match(update["primary_contact_email"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The contact email is not an email address")
    last = latest(db, v.tenant_id).get(v.id)
    due = due_date(v, last, approved_on(db, v.tenant_id).get(v.id), cadence(db, v.tenant_id))
    row = TPRACheckin(tenant_id=v.tenant_id, vendor_id=v.id, due_date=due, completed_by=user.id,
                      completed_at=datetime.utcnow(), still_owner=body.still_owner,
                      new_owner_id=None if body.still_owner else body.new_owner_id,
                      changed=body.changed, change_notes=notes or None,
                      contact_current=body.contact_current, contact_update=update or None)
    db.add(row)
    db.flush()
    if not body.still_owner:
        service.write_audit(db, v.tenant_id, entity="vendor", action="owner_change", vendor_id=v.id,
                            actor_id=user.id, from_value=v.owner_id, to_value=body.new_owner_id,
                            reason="Reported at the yearly check-in")
        v.owner_id = body.new_owner_id
    for key, value in update.items():
        setattr(v, key, value)
    service.write_audit(db, v.tenant_id, entity="checkin", action="create", vendor_id=v.id, entity_id=row.id,
                        actor_id=user.id, to_value="changed" if body.changed else "no change",
                        reason=notes or None)
    v.updated_at = datetime.utcnow()
    db.commit()
    return _row(row, _names(db, [row.completed_by, row.new_owner_id]))

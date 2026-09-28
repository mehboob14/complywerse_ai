"""A supplier's action plan: things to do, or to have done, on a date.

Four kinds. A to-do ("Call them about the SOC 2 renewal") is for someone to do
and mark done: from its date it sits in their attention queue and they are
reminded, weekly while it stays open. The other three happen on their date
without anyone lifting a finger: a questionnaire is sent to the supplier's
contact, the yearly check-in falls due, or a reassessment opens. What happened,
or why it could not, is kept on the item, and one that could not happen goes to
the attention queue of whoever it was for.

Nobody chosen means the supplier's owner. Every change is on the supplier's
audit trail.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Callable, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import (
    GRCUser, TPRAActionItem, Vendor, VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac, service, versions

router = APIRouter(tags=["Vendor action plans"])

KINDS = {
    "todo": "To-do",
    "questionnaire": "Send a questionnaire",
    "checkin": "Ask for the yearly check-in",
    "reassessment": "Open a reassessment",
}
AUTOMATIC = ("questionnaire", "checkin", "reassessment")
QUESTIONNAIRE_DUE_DAYS = 14
QUESTIONNAIRE_EXPIRES_DAYS = 30


class ActionProblem(Exception):
    """Why a planned action could not happen, in words for the person it was for."""


def people_for(item: TPRAActionItem, vendor: Optional[Vendor]) -> List[int]:
    """Whoever the item is for: those chosen, or the supplier's owner."""
    chosen = [int(i) for i in item.assignee_ids or [] if i]
    return chosen or ([vendor.owner_id] if vendor is not None and vendor.owner_id else [])


def link_for(item: TPRAActionItem) -> str:
    return f"/vendor-risk/vendors/{item.vendor_id}?tab=actions"


# ── doing the automatic ones ─────────────────────────────────────────────────

def _queue_invite(db: Session, qr: VendorQuestionnaireResponse) -> None:
    from ..routers.questionnaires import _email_link  # here: that router imports this package

    _email_link(db, qr)


def _send_questionnaire(db: Session, item: TPRAActionItem, vendor: Vendor, now: datetime,
                        invite: Callable[[Session, VendorQuestionnaireResponse], None]) -> None:
    if not vendor.primary_contact_email:
        raise ActionProblem("the supplier has no contact email to send the questionnaire to")
    template = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.id == item.template_id,
        VendorQuestionnaireTemplate.tenant_id == item.tenant_id).first()
    if template is None:
        raise ActionProblem("the questionnaire chosen no longer exists")
    version = versions.publish(db, template, item.created_by)
    assessment = service.get_active_assessment(db, vendor)
    qr = VendorQuestionnaireResponse(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id if assessment else None,
        template_id=template.id, template_version_id=version.id if version else None,
        respondent_name=vendor.primary_contact_name, respondent_email=vendor.primary_contact_email,
        token=str(uuid.uuid4()), expires_at=now + timedelta(days=QUESTIONNAIRE_EXPIRES_DAYS),
        due_date=now + timedelta(days=QUESTIONNAIRE_DUE_DAYS), last_sent_at=now, status="pending",
    )
    db.add(qr)
    db.flush()
    invite(db, qr)
    item.result = f"'{template.name}' sent to {vendor.primary_contact_email}"
    item.result_link = (f"/vendor-risk/assessments/{qr.assessment_id}?tab=questionnaire" if qr.assessment_id
                        else f"/vendor-risk/vendors/{vendor.id}")


def fire_due(db: Session, tenant_id: int, today: Optional[date] = None,
             invite: Callable[[Session, VendorQuestionnaireResponse], None] = _queue_invite) -> Dict[str, int]:
    """Carry out every automatic action whose date has come. Missed days are
    caught up, and each item happens once: it is done or failed afterwards."""
    today = today or datetime.utcnow().date()
    now = datetime.utcnow()
    counts = {"done": 0, "failed": 0}
    for item in db.query(TPRAActionItem).filter(
            TPRAActionItem.tenant_id == tenant_id, TPRAActionItem.status == "scheduled",
            TPRAActionItem.kind.in_(AUTOMATIC), TPRAActionItem.due_on <= today).order_by(TPRAActionItem.due_on):
        vendor = db.get(Vendor, item.vendor_id)
        try:
            with db.begin_nested():
                if vendor is None or vendor.deleted_at is not None:
                    raise ActionProblem("the supplier has been removed")
                if item.kind == "questionnaire":
                    _send_questionnaire(db, item, vendor, now, invite)
                elif item.kind == "reassessment":
                    service.create_reassessment_version(db, vendor, actor_id=None, reason=f"Planned: {item.title}")
                    item.result = "A new assessment was opened"
                    item.result_link = f"/vendor-risk/vendors/{vendor.id}?tab=lifecycle"
                else:
                    item.result = "The yearly check-in is due now"
                    item.result_link = f"/vendor-risk/reviews?vendor={vendor.id}"
                item.status, item.done_at = "done", now
        except ActionProblem as exc:
            item.status, item.result, item.done_at = "failed", f"This could not happen: {exc}.", now
        except Exception as exc:  # noqa: BLE001 — one item must not stop the rest; it stays failed with why
            item.status, item.result, item.done_at = "failed", f"This could not happen: {type(exc).__name__}.", now
        counts[item.status] += 1
        service.write_audit(db, tenant_id, entity="action", action=item.status, vendor_id=item.vendor_id,
                            entity_id=item.id, to_value=item.kind, reason=item.result)
    db.commit()
    return counts


def requested_checkins(db: Session, tenant_id: int) -> Dict[int, List[date]]:
    """Dates a check-in was asked for, by supplier (checkins.schedule brings the
    due date forward to the first one after the last check-in)."""
    out: Dict[int, List[date]] = {}
    for item in db.query(TPRAActionItem).filter(
            TPRAActionItem.tenant_id == tenant_id, TPRAActionItem.kind == "checkin",
            TPRAActionItem.status.in_(("scheduled", "done"))):
        out.setdefault(item.vendor_id, []).append(item.due_on)
    return out


# ── REST ─────────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {int(i) for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def _row(item: TPRAActionItem, vendor: Optional[Vendor], names: Dict[int, str], today: date) -> dict:
    people = people_for(item, vendor)
    return {
        "id": item.id, "vendor": {"id": item.vendor_id, "name": vendor.name if vendor else None},
        "kind": item.kind, "kind_label": KINDS.get(item.kind, item.kind), "title": item.title, "note": item.note,
        "due_on": item.due_on.isoformat(), "status": item.status,
        "overdue_days": max(0, (today - item.due_on).days) if item.status == "scheduled" else 0,
        "assignee_ids": item.assignee_ids or [], "people": [{"id": p, "name": names.get(p)} for p in people],
        "template_id": item.template_id, "result": item.result, "result_link": item.result_link,
        "done_at": item.done_at, "done_by": names.get(item.done_by) if item.done_by else None,
        "created_by": names.get(item.created_by) if item.created_by else None, "created_at": item.created_at,
        "automatic": item.kind in AUTOMATIC,
    }


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    return v


@router.get("/vendors/{vendor_id}/actions")
def vendor_actions(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    items = (db.query(TPRAActionItem).filter(TPRAActionItem.vendor_id == v.id)
             .order_by(TPRAActionItem.due_on.desc(), TPRAActionItem.id.desc()).all())
    names = _names(db, [p for i in items for p in (*people_for(i, v), i.done_by, i.created_by)])
    today = datetime.utcnow().date()
    return {"items": [_row(i, v, names, today) for i in items], "kinds": KINDS}


@router.get("/actions")
def all_actions(scope: Literal["all", "mine"] = "all",
                state: Literal["open", "due", "failed", "done", "all"] = "open",
                db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Planned actions across suppliers. `open` is everything still to happen;
    `due` the open ones whose date has come."""
    tid = _tids(user, db)[0]
    today = datetime.utcnow().date()
    q = db.query(TPRAActionItem).filter(TPRAActionItem.tenant_id == tid)
    if state in ("open", "due"):
        q = q.filter(TPRAActionItem.status == "scheduled")
        if state == "due":
            q = q.filter(TPRAActionItem.due_on <= today)
    elif state != "all":
        q = q.filter(TPRAActionItem.status == state)
    items = q.order_by(TPRAActionItem.due_on.asc(), TPRAActionItem.id).limit(500).all()
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_([i.vendor_id for i in items] or [-1]))}
    if scope == "mine":
        items = [i for i in items if user.id in people_for(i, vendors.get(i.vendor_id))]
    names = _names(db, [p for i in items for p in (*people_for(i, vendors.get(i.vendor_id)), i.done_by, i.created_by)])
    counts = {
        "due": db.query(TPRAActionItem).filter(TPRAActionItem.tenant_id == tid, TPRAActionItem.status == "scheduled",
                                               TPRAActionItem.due_on <= today).count(),
        "failed": db.query(TPRAActionItem).filter(TPRAActionItem.tenant_id == tid, TPRAActionItem.status == "failed").count(),
    }
    return {"items": [_row(i, vendors.get(i.vendor_id), names, today) for i in items], "kinds": KINDS, "counts": counts}


class ActionIn(BaseModel):
    kind: Literal["todo", "questionnaire", "checkin", "reassessment"] = "todo"
    title: Optional[str] = Field(None, max_length=200)
    note: Optional[str] = Field(None, max_length=4000)
    due_on: date
    assignee_ids: List[int] = Field(default_factory=list, max_length=20)
    template_id: Optional[int] = None


class ActionUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    note: Optional[str] = Field(None, max_length=4000)
    due_on: Optional[date] = None
    assignee_ids: Optional[List[int]] = Field(None, max_length=20)
    template_id: Optional[int] = None
    status: Optional[Literal["scheduled", "done", "cancelled"]] = None


def _check_people(db: Session, ids: List[int]) -> List[int]:
    ids = list(dict.fromkeys(int(i) for i in ids if i))
    if ids and len({u.id for u in db.query(GRCUser.id).filter(GRCUser.id.in_(ids))}) != len(ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Everyone an action is for must be a platform user")
    return ids


def _template(db: Session, tenant_id: int, template_id: Optional[int]) -> VendorQuestionnaireTemplate:
    t = db.query(VendorQuestionnaireTemplate).filter(VendorQuestionnaireTemplate.id == template_id,
                                                     VendorQuestionnaireTemplate.tenant_id == tenant_id).first()
    if t is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose the questionnaire to send")
    return t


@router.post("/vendors/{vendor_id}/actions", status_code=status.HTTP_201_CREATED)
def plan(vendor_id: int, body: ActionIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "vendors", "edit")
    today = datetime.utcnow().date()
    if body.due_on < today:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick today or a later date")
    title = " ".join((body.title or "").split())
    template = _template(db, v.tenant_id, body.template_id) if body.kind == "questionnaire" else None
    if not title:
        if body.kind == "todo":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say what is to be done")
        title = f"Send '{template.name}'" if template is not None else KINDS[body.kind]
    item = TPRAActionItem(tenant_id=v.tenant_id, vendor_id=v.id, kind=body.kind, title=title[:200],
                          note=(body.note or "").strip() or None, due_on=body.due_on,
                          assignee_ids=_check_people(db, body.assignee_ids) or None,
                          template_id=template.id if template is not None else None, status="scheduled",
                          created_by=user.id)
    db.add(item)
    db.flush()
    service.write_audit(db, v.tenant_id, entity="action", action="create", vendor_id=v.id, entity_id=item.id,
                        actor_id=user.id, to_value=f"{KINDS[item.kind]} on {item.due_on:%d %b %Y}", reason=item.title)
    db.commit()
    names = _names(db, [*people_for(item, v), user.id])
    return _row(item, v, names, today)


@router.patch("/actions/{action_id}")
def change(action_id: int, body: ActionUpdate, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    item = db.query(TPRAActionItem).filter(TPRAActionItem.id == action_id, TPRAActionItem.tenant_id.in_(tids)).first()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action not found")
    rbac.require_write(db, user, "vendors", "edit")
    v = _vendor(db, item.vendor_id, tids)
    today = datetime.utcnow().date()
    data = body.model_dump(exclude_unset=True)
    moved = data.pop("status", None)
    if data and item.status != "scheduled" and moved != "scheduled":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only an action still to happen can be changed; plan it again first")
    before = f"{item.status} on {item.due_on:%d %b %Y}"
    if "title" in data:
        title = " ".join((data["title"] or "").split())
        if not title:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say what is to be done")
        item.title = title[:200]
    if "note" in data:
        item.note = (data["note"] or "").strip() or None
    if "assignee_ids" in data:
        item.assignee_ids = _check_people(db, data["assignee_ids"] or []) or None
    if "template_id" in data and item.kind == "questionnaire":
        item.template_id = _template(db, v.tenant_id, data["template_id"]).id
    if "due_on" in data:
        if data["due_on"] is None or data["due_on"] < today:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick today or a later date")
        item.due_on = data["due_on"]
    if moved == "scheduled":                           # planned again: a failed, done or cancelled one
        if item.due_on < today:
            item.due_on = today
        item.status, item.done_at, item.done_by, item.result, item.result_link = "scheduled", None, None, None, None
    elif moved in ("done", "cancelled"):
        if item.status != "scheduled":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"This action is already {item.status}")
        item.status, item.done_at, item.done_by = moved, datetime.utcnow(), user.id
        if moved == "done":
            item.result = item.result or "Done by hand"
    service.write_audit(db, v.tenant_id, entity="action", action=moved or "update", vendor_id=v.id, entity_id=item.id,
                        actor_id=user.id, from_value=before, to_value=f"{item.status} on {item.due_on:%d %b %Y}",
                        reason=item.title)
    db.commit()
    names = _names(db, [*people_for(item, v), item.done_by, item.created_by])
    return _row(item, v, names, today)

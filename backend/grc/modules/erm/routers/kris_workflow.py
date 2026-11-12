"""KRI/KPI reporting workflow — the manual reporting loop that sits on top of the
KRI engine: a per-user "My updates" data-entry queue, a submit → review → approve/
reject gate for reported values, and a CSV export of the report.

Deliberately a SEPARATE router (prefix /kri-workflow) so it composes with the KRI
engine (/erm/kris/*). A KRI value only "publishes" (updates the KRI's current value)
once a second person approves it; approval also moves the next due date on and
escalates amber / red (kris.publish_value, kris.escalate_value). A KPI without a
reviewer auto-publishes on submit (matching the measure behaviour).
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import GRCUser, Risk, RiskKRI, RiskKRIMeasurement, get_db
from ....routers.auth_router import get_user_tenants, require_auth, require_tenant_permission
from ....services import kri_feeds
from ....services.segregation import ensure_independent
from ..services.monitor_changes import notify
from .kris import escalate_value, is_kri, may_check, may_supply, named_checker, publish_value, tell_checkers

router = APIRouter(prefix="/kri-workflow", tags=["ERM - KRI Workflow"])
CAN_EDIT = [Depends(require_tenant_permission("erm:kris:edit", "erm:risks:edit"))]


def _status(value: Optional[float], green, amber, direction: str) -> str:
    if value is None or green is None or amber is None:
        return "unknown"
    if direction == "lower_is_better":
        return "green" if value <= green else "amber" if value <= amber else "red"
    return "green" if value >= green else "amber" if value >= amber else "red"


def _tenant_ids(user, db) -> List[int]:
    return get_user_tenants(user, db) or []


# ── My updates: the per-user data-entry queue ─────────────────────────────────
@router.get("/my-updates")
def my_updates(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The KPIs/KRIs THIS user must report on now — where they are the assigned
    data-provider (or owner, if no provider set) and the metric is manual, active,
    and due (no due date, or due on/before today)."""
    tids = _tenant_ids(current_user, db)
    if not tids:
        return {"items": [], "total": 0, "overdue": 0}
    kri_feeds.ensure_kri_columns(db)
    now = datetime.utcnow()
    uid = current_user.id
    rows = (db.query(RiskKRI)
            .filter(RiskKRI.tenant_id.in_(tids),
                    RiskKRI.is_active == True,  # noqa: E712
                    RiskKRI.metric_key.is_(None),  # manual only (live KRIs self-update)
                    or_(RiskKRI.data_provider_id == uid,
                        (RiskKRI.data_provider_id.is_(None)) & (RiskKRI.owner_id == uid)))
            .all())
    items, overdue = [], 0
    for k in rows:
        due = k.next_due_date
        is_overdue = bool(due and due <= now)
        if due is not None and not is_overdue:
            continue  # not due yet
        if is_overdue:
            overdue += 1
        items.append({
            "id": k.id, "name": k.name, "kind": k.kind or "kri", "unit": k.unit,
            "frequency": k.frequency, "category": k.category, "target": k.target,
            "current_value": k.current_value, "next_due_date": due.isoformat() if due else None,
            "overdue": is_overdue, "reporting_period": k.reporting_period,
            "needs_review": is_kri(k) or k.reviewer_id is not None,
        })
    return {"items": items, "total": len(items), "overdue": overdue}


# ── Submit a value (enters the review gate) ───────────────────────────────────
class SubmitBody(BaseModel):
    value: float
    period_label: Optional[str] = None
    notes: Optional[str] = None


def _get_kri(db: Session, kri_id: int, tids: List[int]) -> RiskKRI:
    k = db.query(RiskKRI).filter(RiskKRI.id == kri_id, RiskKRI.tenant_id.in_(tids)).first()
    if not k:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KRI not found")
    return k


@router.post("/kris/{kri_id}/submit")
def submit_value(kri_id: int, body: SubmitBody, db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth)):
    """Report an actual for the period. A KRI value, or one for a metric with a reviewer,
    enters as 'submitted' (pending, does NOT publish); a KPI without a reviewer
    auto-approves and publishes to the metric's current value."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    k = _get_kri(db, kri_id, tids)
    may_supply(k, current_user, db)
    now = datetime.utcnow()
    gated = is_kri(k) or k.reviewer_id is not None
    m = RiskKRIMeasurement(
        kri_id=k.id, value=body.value, notes=body.notes, period_label=body.period_label,
        target=k.target, measured_at=now, measured_by=current_user.id,
        status=_status(body.value, k.green_threshold, k.amber_threshold, k.threshold_direction),
        review_status="submitted" if gated else "approved",
    )
    if not gated:
        m.reviewed_by = current_user.id
        m.reviewed_at = now
        k.current_value = body.value
        k.last_measured_at = now
    db.add(m)
    db.commit()
    if gated:
        tell_checkers(db, k, m)
    db.refresh(m)
    return {"ok": True, "measurement_id": m.id, "review_status": m.review_status,
            "published": not gated}


# ── Reviewer queue + approve / reject ─────────────────────────────────────────
@router.get("/pending-reviews")
def pending_reviews(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Submitted values awaiting THIS user's check (kris.named_checker: the metric's reviewer, else its owner, when they
    hold the check permission and did not submit it; otherwise every holder but the submitter). The notice goes to the
    same people."""
    tids = _tenant_ids(current_user, db)
    if not tids:
        return {"items": [], "total": 0}
    kri_feeds.ensure_kri_columns(db)
    uid, holds = current_user.id, may_check(db)
    if not holds(uid):
        return {"items": [], "total": 0}
    rows = [(m, k) for m, k in (db.query(RiskKRIMeasurement, RiskKRI)
                                .join(RiskKRI, RiskKRIMeasurement.kri_id == RiskKRI.id)
                                .filter(RiskKRI.tenant_id.in_(tids), RiskKRIMeasurement.review_status == "submitted")
                                .order_by(RiskKRIMeasurement.measured_at.asc())
                                .all())
            if (named_checker(k, m.measured_by, holds) or uid) == uid and m.measured_by != uid]
    items = [{
        "measurement_id": m.id, "kri_id": k.id, "kri_name": k.name, "kind": k.kind or "kri",
        "value": m.value, "target": m.target, "unit": k.unit, "status": m.status,
        "period_label": m.period_label, "notes": m.notes, "data_source": k.data_source,
        "previous_value": k.current_value,   # the last published value, for the change it makes
        "measured_by": m.measured_by, "measured_at": m.measured_at.isoformat() if m.measured_at else None,
    } for m, k in rows]
    return {"items": items, "total": len(items)}


class ReviewBody(BaseModel):
    notes: Optional[str] = None


def _get_measurement(db: Session, mid: int, tids: List[int], user: GRCUser):
    row = (db.query(RiskKRIMeasurement, RiskKRI)
           .join(RiskKRI, RiskKRIMeasurement.kri_id == RiskKRI.id)
           .filter(RiskKRIMeasurement.id == mid, RiskKRI.tenant_id.in_(tids)).first())
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Measurement not found")
    if row[0].review_status != "submitted":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Only a submitted value can be reviewed; this one is {row[0].review_status or 'approved'}")
    ensure_independent(row[0].measured_by, user, "review this value")
    return row


def _claim(db: Session, m: RiskKRIMeasurement, outcome: str, user: GRCUser) -> None:
    """Record the decision only while the value still waits: two checkers at the same moment cannot both decide it, so
    a value is published and escalated once."""
    claimed = (db.query(RiskKRIMeasurement)
               .filter(RiskKRIMeasurement.id == m.id, RiskKRIMeasurement.review_status == "submitted")
               .update({"review_status": outcome, "reviewed_by": user.id, "reviewed_at": datetime.utcnow()},
                       synchronize_session="evaluate"))
    if not claimed:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Someone else has just decided this value.")


@router.post("/measurements/{measurement_id}/approve", dependencies=CAN_EDIT)
def approve_measurement(measurement_id: int, db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    """Approve a submitted value → it publishes to the metric's current value, a KRI's next value falls due one period
    on, and then, once: an amber / red KRI value is escalated, the appetite limits it measures are re-checked (the
    breach log) and the submitter is told."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    m, k = _get_measurement(db, measurement_id, tids, current_user)
    _claim(db, m, "approved", current_user)
    publish_value(k, m)
    db.commit()
    result = {"ok": True, "measurement_id": m.id, "review_status": "approved", "current_value": k.current_value,
              "next_due_date": k.next_due_date.isoformat() if k.next_due_date else None}
    escalate_value(db, k, m, current_user)
    from .appetite import recheck_kri_limits   # here: appetite imports kris, which this module imports
    recheck_kri_limits(db, k)
    notify(db, k.tenant_id, [m.measured_by], f"KRI value approved: {k.name}",
           f"{m.value}{k.unit or ''} for {k.name} was approved and published.", "/erm/kris", actor_id=current_user.id)
    return result


@router.post("/measurements/{measurement_id}/reject", dependencies=CAN_EDIT)
def reject_measurement(measurement_id: int, body: ReviewBody, db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth)):
    """Reject a submitted value → it does NOT publish; the sender is told and can resubmit."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    m, k = _get_measurement(db, measurement_id, tids, current_user)
    _claim(db, m, "rejected", current_user)
    if body.notes:
        m.notes = f"{(m.notes or '').strip()}\n[rejected] {body.notes}".strip()
    db.commit()
    notify(db, k.tenant_id, [m.measured_by], f"KRI value sent back: {k.name}",
           f"{m.value}{k.unit or ''} for {k.name} was sent back" + (f": {body.notes}" if body.notes else ".")
           + " Submit it again under Key Risk Indicators.", "/erm/kris?tab=due", actor_id=current_user.id)
    return {"ok": True, "measurement_id": m.id, "review_status": "rejected"}


# ── Export ────────────────────────────────────────────────────────────────────
@router.get("/export")
def export_report(kind: Optional[str] = None, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth)):
    """CSV export of the KPI/KRI register (board-pack friendly)."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    q = db.query(RiskKRI).filter(RiskKRI.tenant_id.in_(tids), RiskKRI.is_active == True)  # noqa: E712
    if kind in ("kri", "kpi"):
        q = q.filter((RiskKRI.kind == kind) | (RiskKRI.kind.is_(None) if kind == "kri" else False))
    rows = q.all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Type", "Name", "Category", "Current value", "Target", "Unit", "Status",
                "Green", "Amber", "Direction", "Frequency", "Live", "Next due"])
    for k in rows:
        val = k.current_value
        if k.metric_key:
            live = kri_feeds.current_value(db, tids, k.metric_key)
            if live is not None:
                val = live
        w.writerow([
            (k.kind or "kri").upper(), k.name, k.category or "", val if val is not None else "",
            k.target if k.target is not None else "", k.unit or "",
            _status(val, k.green_threshold, k.amber_threshold, k.threshold_direction),
            k.green_threshold if k.green_threshold is not None else "",
            k.amber_threshold if k.amber_threshold is not None else "",
            k.threshold_direction, k.frequency, "yes" if k.metric_key else "no",
            k.next_due_date.date().isoformat() if k.next_due_date else "",
        ])
    buf.seek(0)
    fname = f"{(kind or 'kpi-kri')}-report.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})

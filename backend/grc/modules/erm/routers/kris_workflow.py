"""KRI/KPI reporting workflow — the manual reporting loop that sits on top of the
KRI engine: a per-user "My updates" data-entry queue, a submit → review → approve/
reject gate for reported values, and a CSV export of the report.

Deliberately a SEPARATE router (prefix /kri-workflow) so it composes with the KRI
engine (/erm/kris/*) without editing it. Values only "publish" (update the KRI's
current value) once approved when the KRI has a reviewer; KRIs without a reviewer
auto-publish on submit (matching the existing measure behaviour). Self-contained
status logic so it never depends on the (actively-evolving) kris.py module.
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
from ....routers.auth_router import get_user_tenants, require_auth
from ....services import kri_feeds

router = APIRouter(prefix="/kri-workflow", tags=["ERM - KRI Workflow"])


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
            "needs_review": k.reviewer_id is not None,
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
    """Report an actual for the period. If the metric has a reviewer it enters as
    'submitted' (pending, does NOT publish); otherwise it auto-approves and
    publishes to the metric's current value."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    k = _get_kri(db, kri_id, tids)
    now = datetime.utcnow()
    gated = k.reviewer_id is not None
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
    db.refresh(m)
    return {"ok": True, "measurement_id": m.id, "review_status": m.review_status,
            "published": not gated}


# ── Reviewer queue + approve / reject ─────────────────────────────────────────
@router.get("/pending-reviews")
def pending_reviews(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Submitted values awaiting THIS user's review (they are the metric's reviewer
    or, failing that, its owner)."""
    tids = _tenant_ids(current_user, db)
    if not tids:
        return {"items": [], "total": 0}
    kri_feeds.ensure_kri_columns(db)
    uid = current_user.id
    rows = (db.query(RiskKRIMeasurement, RiskKRI)
            .join(RiskKRI, RiskKRIMeasurement.kri_id == RiskKRI.id)
            .filter(RiskKRI.tenant_id.in_(tids),
                    RiskKRIMeasurement.review_status == "submitted",
                    or_(RiskKRI.reviewer_id == uid,
                        (RiskKRI.reviewer_id.is_(None)) & (RiskKRI.owner_id == uid)))
            .all())
    items = [{
        "measurement_id": m.id, "kri_id": k.id, "kri_name": k.name, "kind": k.kind or "kri",
        "value": m.value, "target": m.target, "unit": k.unit, "status": m.status,
        "period_label": m.period_label, "notes": m.notes,
        "measured_by": m.measured_by, "measured_at": m.measured_at.isoformat() if m.measured_at else None,
    } for m, k in rows]
    return {"items": items, "total": len(items)}


class ReviewBody(BaseModel):
    notes: Optional[str] = None


def _get_measurement(db: Session, mid: int, tids: List[int]):
    row = (db.query(RiskKRIMeasurement, RiskKRI)
           .join(RiskKRI, RiskKRIMeasurement.kri_id == RiskKRI.id)
           .filter(RiskKRIMeasurement.id == mid, RiskKRI.tenant_id.in_(tids)).first())
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Measurement not found")
    return row


@router.post("/measurements/{measurement_id}/approve")
def approve_measurement(measurement_id: int, db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    """Approve a submitted value → it publishes to the metric's current value."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    m, k = _get_measurement(db, measurement_id, tids)
    now = datetime.utcnow()
    m.review_status = "approved"
    m.reviewed_by = current_user.id
    m.reviewed_at = now
    k.current_value = m.value
    k.last_measured_at = m.measured_at or now
    db.commit()
    return {"ok": True, "measurement_id": m.id, "review_status": "approved",
            "current_value": k.current_value}


@router.post("/measurements/{measurement_id}/reject")
def reject_measurement(measurement_id: int, body: ReviewBody, db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth)):
    """Reject a submitted value → it does NOT publish; sender can resubmit."""
    tids = _tenant_ids(current_user, db)
    kri_feeds.ensure_kri_columns(db)
    m, k = _get_measurement(db, measurement_id, tids)
    m.review_status = "rejected"
    m.reviewed_by = current_user.id
    m.reviewed_at = datetime.utcnow()
    if body.notes:
        m.notes = f"{(m.notes or '').strip()}\n[rejected] {body.notes}".strip()
    db.commit()
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

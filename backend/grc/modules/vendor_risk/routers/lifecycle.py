"""TPRA lifecycle, remediation, offboarding & reassessment endpoints.

All additive and vendor-scoped. The trackers (remediation actions, offboarding
checklist) are stored as JSON on the existing grc_vendors row, so there are no
new tables and nothing in the existing flow changes.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import Vendor, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants
from ..tpra import rbac
from ..lifecycle import (
    LIFECYCLE_STAGES, TIER_CADENCE_DAYS, DEFAULT_OFFBOARDING_CHECKLIST,
    is_valid_stage, next_stage, record_transition,
)
from .vendors import serialize_vendor, get_vendor_or_404

router = APIRouter(tags=["Vendor Lifecycle"])


@router.get("/lifecycle/stages")
def get_lifecycle_stages(current_user: GRCUser = Depends(require_auth)):
    """Canonical 8-stage TPRA lifecycle metadata (labels, order, actions)."""
    return {"stages": LIFECYCLE_STAGES}


# ── Stage transitions ─────────────────────────────────────────────────────

class AdvanceStageRequest(BaseModel):
    target_stage: Optional[str] = None  # omit → advance to the next stage
    note: Optional[str] = None


@router.post("/vendors/{vendor_id}/advance-stage")
def advance_stage(
    vendor_id: int,
    payload: AdvanceStageRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "lifecycle", "advance")

    current = vendor.lifecycle_stage or "intake"
    target = (payload.target_stage or "").strip() or next_stage(current)
    if not target:
        raise HTTPException(status_code=400, detail="Vendor is already at the final lifecycle stage (offboarding).")
    if not is_valid_stage(target):
        raise HTTPException(status_code=400, detail=f"Unknown lifecycle stage '{target}'.")

    record_transition(vendor, target, current_user.id, payload.note or "")

    # Entering monitoring: seed a reassessment cadence from the tier if unset.
    if target == "monitoring" and not vendor.reassessment_cadence_days:
        days = TIER_CADENCE_DAYS.get((vendor.tier or "medium").lower(), 730)
        vendor.reassessment_cadence_days = days
        vendor.next_reassessment_date = datetime.utcnow() + timedelta(days=days)

    # Entering offboarding: seed the standard checklist if empty.
    if target == "offboarding" and not (vendor.offboarding_checklist or []):
        vendor.offboarding_checklist = [
            {"item": i, "done": False, "at": None, "by": None} for i in DEFAULT_OFFBOARDING_CHECKLIST
        ]

    vendor.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


# ── Stage 5 — Remediation & treatment tracker ─────────────────────────────

class RemediationActionIn(BaseModel):
    title: str
    action: Optional[str] = None
    finding_ref: Optional[str] = None
    treatment_type: Optional[str] = "remediate"  # remediate | mitigate | transfer | accept
    severity: Optional[str] = "medium"
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = "open"  # open | in_progress | completed | accepted
    rationale: Optional[str] = None


class RemediationActionPatch(BaseModel):
    title: Optional[str] = None
    action: Optional[str] = None
    treatment_type: Optional[str] = None
    severity: Optional[str] = None
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    rationale: Optional[str] = None


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if isinstance(dt, datetime) else (dt or None)


@router.get("/vendors/{vendor_id}/remediation")
def list_remediation(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    return {"items": vendor.remediation_actions or []}


@router.post("/vendors/{vendor_id}/remediation", status_code=status.HTTP_201_CREATED)
def add_remediation(
    vendor_id: int,
    payload: RemediationActionIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "findings", "edit")
    actions = list(vendor.remediation_actions or [])
    item = {
        "id": uuid.uuid4().hex[:12],
        "title": payload.title,
        "action": payload.action or "",
        "finding_ref": payload.finding_ref or "",
        "treatment_type": payload.treatment_type or "remediate",
        "severity": payload.severity or "medium",
        "owner_id": payload.owner_id,
        "due_date": _iso(payload.due_date),
        "status": payload.status or "open",
        "rationale": payload.rationale or "",
        "accepted_by": None,
        "accepted_at": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    actions.append(item)
    vendor.remediation_actions = actions
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return item


@router.patch("/vendors/{vendor_id}/remediation/{action_id}")
def update_remediation(
    vendor_id: int,
    action_id: str,
    payload: RemediationActionPatch,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "findings", "edit")
    actions = list(vendor.remediation_actions or [])
    found = None
    for a in actions:
        if str(a.get("id")) == str(action_id):
            found = a
            break
    if not found:
        raise HTTPException(status_code=404, detail="Remediation action not found")

    patch = payload.model_dump(exclude_unset=True)
    if "due_date" in patch:
        patch["due_date"] = _iso(patch["due_date"])
    found.update(patch)
    # Stamp acceptance when a finding is formally accepted.
    if patch.get("status") == "accepted" and not found.get("accepted_at"):
        found["accepted_by"] = current_user.id
        found["accepted_at"] = datetime.utcnow().isoformat()
    vendor.remediation_actions = actions
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return found


@router.delete("/vendors/{vendor_id}/remediation/{action_id}")
def delete_remediation(
    vendor_id: int,
    action_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "findings", "delete")
    actions = [a for a in (vendor.remediation_actions or []) if str(a.get("id")) != str(action_id)]
    vendor.remediation_actions = actions
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Remediation action removed"}


# ── Stage 7 — Reassessment scheduling ─────────────────────────────────────

class ScheduleReassessmentIn(BaseModel):
    cadence_days: Optional[int] = None
    next_date: Optional[datetime] = None


@router.post("/vendors/{vendor_id}/schedule-reassessment")
def schedule_reassessment(
    vendor_id: int,
    payload: ScheduleReassessmentIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "vendors", "edit")
    cadence = payload.cadence_days or TIER_CADENCE_DAYS.get((vendor.tier or "medium").lower(), 730)
    vendor.reassessment_cadence_days = cadence
    vendor.next_reassessment_date = payload.next_date or (datetime.utcnow() + timedelta(days=cadence))
    vendor.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


# ── Stage 8 — Offboarding checklist ───────────────────────────────────────

class OffboardingUpdate(BaseModel):
    # Full replacement list of {item, done} — the UI sends the current state.
    items: list


@router.get("/vendors/{vendor_id}/offboarding")
def get_offboarding(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    checklist = vendor.offboarding_checklist or []
    if not checklist:
        # Surface the standard checklist without persisting until the user acts.
        checklist = [{"item": i, "done": False, "at": None, "by": None} for i in DEFAULT_OFFBOARDING_CHECKLIST]
    return {"items": checklist}


@router.patch("/vendors/{vendor_id}/offboarding")
def update_offboarding(
    vendor_id: int,
    payload: OffboardingUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "vendors", "edit")
    now = datetime.utcnow().isoformat()
    normalized = []
    for raw in (payload.items or []):
        if not isinstance(raw, dict):
            continue
        done = bool(raw.get("done"))
        normalized.append({
            "item": str(raw.get("item") or ""),
            "done": done,
            "at": (raw.get("at") or now) if done else None,
            "by": (raw.get("by") or current_user.id) if done else None,
        })
    vendor.offboarding_checklist = normalized
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return {"items": normalized}

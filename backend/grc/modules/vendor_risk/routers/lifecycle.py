"""Vendor-scoped lifecycle endpoints, kept for the URLs older clients call.

There is one lifecycle — the canonical eleven stages in `tpra/stages.py`, held as
`TPRAStageInstance` rows with exit criteria and gates. This module used to run a
second, eight-stage lifecycle of its own on a JSON column, which could put a
vendor in a stage the real engine had never heard of. The endpoints survive so
existing links keep answering; they now translate to the canonical stages and
delegate to the one engine.

`vendor.lifecycle_stage` is still written, mapped back from the canonical stage,
so anything reading that column keeps working.

Reassessment cadence and the offboarding checklist stay here: they are the only
store for those, and the canonical stage workspace reads them.
"""
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import Vendor, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants
from ..tpra import rbac
from ..lifecycle import (
    TIER_CADENCE_DAYS, DEFAULT_OFFBOARDING_CHECKLIST, record_transition,
)
from ..tpra import service as tpra_service
from ..tpra import stages as tpra_stages
from .vendors import serialize_vendor, get_vendor_or_404

# The eight stages this module used to own, against the canonical eleven. Kept so
# an old client's stage name still resolves to something real.
LEGACY_TO_CANONICAL = {
    "intake": "intake",
    "tiering": "tiering",
    "due_diligence": "questionnaire",
    "rating": "scoring",
    "remediation": "findings",
    "contracting": "contracting",
    "monitoring": "monitoring",
    "offboarding": "reassessment",
}
CANONICAL_TO_LEGACY = {
    "intake": "intake",
    "tiering": "tiering",
    "dd_planning": "due_diligence",
    "questionnaire": "due_diligence",
    "scoring": "rating",
    "findings": "remediation",
    "contracting": "contracting",
    "approval": "contracting",
    "onboarding": "monitoring",
    "monitoring": "monitoring",
    "reassessment": "offboarding",
}
router = APIRouter(tags=["Vendor Lifecycle"])


@router.get("/lifecycle/stages")
def get_lifecycle_stages(current_user: GRCUser = Depends(require_auth)):
    """The canonical eleven stages. `legacy_map` translates the eight names this
    endpoint used to return, for anything still sending them."""
    return {"stages": tpra_stages.stages_payload(), "legacy_map": LEGACY_TO_CANONICAL}


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

    # One engine decides this. It enforces each stage's exit criteria and stops
    # hard at the gates, which the stage-name arithmetic this endpoint used to do
    # could not.
    assessment = tpra_service.ensure_active_assessment(db, vendor, actor_id=current_user.id)
    asked = (payload.target_stage or "").strip().lower()
    if asked:
        wanted = LEGACY_TO_CANONICAL.get(asked, asked)
        if not tpra_stages.is_valid_stage(wanted):
            raise HTTPException(status_code=400, detail=f"Unknown lifecycle stage '{asked}'.")
        nxt = tpra_stages.next_stage(assessment.current_stage or "intake")
        if wanted != nxt:
            raise HTTPException(
                status_code=400,
                detail=(f"Stages advance one at a time: '{assessment.current_stage}' goes to "
                        f"'{nxt}', not '{wanted}'. Use the lifecycle endpoints under /tpra to "
                        "send back or skip a stage."),
            )

    result = tpra_service.advance_stage(
        db, vendor, assessment, actor_id=current_user.id, note=payload.note or "")
    if not result.get("advanced"):
        raise HTTPException(
            status_code=409,
            detail={"message": f"Cannot leave '{result.get('from')}' yet.",
                    "blockers": result.get("blockers") or []},
        )

    target = CANONICAL_TO_LEGACY.get(result.get("to") or "", vendor.lifecycle_stage or "intake")
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
    out = serialize_vendor(vendor)
    out["stage"] = {"from": result.get("from"), "to": result.get("to"),
                    "assessment_id": assessment.id, "legacy_stage": target}
    return out


# ── Remediation & treatment — moved to the governed store ─────────────────
# These wrote treatment tasks into a JSON column on the vendor, beside the
# `grc_tpra_remediations` rows the findings gate, the SLA clock and the audit log
# all read. Two stores meant a closed task in one and an open task in the other.
# The reads stay so old data is still visible; the writes point at the one store.

_MOVED = ("Remediation is tracked on the finding it answers. Use "
          "POST /vendor-risk/tpra/findings/{finding_id}/remediations, or "
          "PATCH /vendor-risk/tpra/remediations/{id}. Existing entries here stay readable.")


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
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_MOVED)


@router.patch("/vendors/{vendor_id}/remediation/{action_id}")
def update_remediation(
    vendor_id: int,
    action_id: str,
    payload: RemediationActionPatch,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_MOVED)


@router.delete("/vendors/{vendor_id}/remediation/{action_id}")
def delete_remediation(
    vendor_id: int,
    action_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_MOVED)


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

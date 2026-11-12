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

Offboarding closes the door. Starting it (here, or by setting the supplier's status
to offboarded anywhere) makes the supplier offboarded, stops every personal portal
link it has and expires its unanswered questionnaires; completing it, once every
step of the checklist is done, archives the supplier. Ending one engagement
touches none of this: General is the supplier itself and only offboarding ends it.
"""
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import Vendor, GRCUser, TPRAAuditLog, VendorQuestionnaireResponse, get_db
from ....routers.auth_router import require_auth, get_user_tenants
from ..tpra import rbac
from ..lifecycle import (
    DEFAULT_OFFBOARDING_CHECKLIST, record_transition,
)
from ..tpra import service as tpra_service
from ..tpra import stages as tpra_stages
from ..tpra.bootstrap import get_tiering_config
from ..tpra.contacts import revoke_all
from ..tpra.portal import WAITING_ON_VENDOR
from .vendors import archive_vendor, serialize_vendor, get_vendor_or_404
# The steps of an exit live in ../lifecycle.py (the engagements' own exits use them too); callers and tests also read
# CONTRACTS_CLOSED, FINAL_PAYMENTS and OFFBOARDING_CHECKLIST from here.
from ..lifecycle import CONTRACTS_CLOSED, FINAL_PAYMENTS, OFFBOARDING_CHECKLIST, exit_steps, stamp_steps  # noqa: F401
from ..tpra import engagements as tpra_engagements

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


def _tier_cadence(db: Session, vendor: Vendor) -> int:
    """Days between reviews for General's tier, from the tenant's Settings (not the old table in ../lifecycle.py)."""
    return tpra_stages.cadence_days_for(tpra_service.scope_row(db, vendor).tier,
                                        get_tiering_config(db, vendor.tenant_id).get("cadence_days"))


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

    # Entering monitoring: seed a reassessment cadence from the tier if unset
    # (General's own tier: the supplier's may be the worst of its engagements).
    if target == "monitoring" and not vendor.reassessment_cadence_days:
        days = _tier_cadence(db, vendor)
        vendor.reassessment_cadence_days = days
        vendor.next_reassessment_date = datetime.utcnow() + timedelta(days=days)

    # Entering offboarding: seed the standard checklist if empty.
    if target == "offboarding" and not (vendor.offboarding_checklist or []):
        vendor.offboarding_checklist = _checklist()

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
    # General's review: an engagement's is set on the engagement (PUT /engagements/{id}).
    cadence = payload.cadence_days or _tier_cadence(db, vendor)
    vendor.reassessment_cadence_days = cadence
    vendor.next_reassessment_date = payload.next_date or (datetime.utcnow() + timedelta(days=cadence))
    vendor.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


# ── Stage 8 — Offboarding checklist ───────────────────────────────────────

def _checklist(steps=None) -> list:
    return exit_steps(steps)


def close_supplier_side(db: Session, vendor: Vendor, by: Optional[int], reason: Optional[str]) -> dict:
    """Every way the supplier has in stops: its personal portal links, and the
    questionnaires still waiting on it, which expire now. Audited; the caller commits."""
    links = revoke_all(db, vendor.id, by, reason)
    now = datetime.utcnow()
    expired = []
    for qr in (db.query(VendorQuestionnaireResponse)
               .filter(VendorQuestionnaireResponse.vendor_id == vendor.id,
                       VendorQuestionnaireResponse.status.in_(WAITING_ON_VENDOR),
                       or_(VendorQuestionnaireResponse.expires_at.is_(None), VendorQuestionnaireResponse.expires_at > now))
               .order_by(VendorQuestionnaireResponse.id)):
        qr.expires_at = now
        expired.append(qr.id)
    if expired:
        tpra_service.write_audit(db, vendor.tenant_id, entity="questionnaire", action="expire", vendor_id=vendor.id,
                                 actor_id=by, to_value=len(expired), reason=reason, extra={"questionnaire_ids": expired})
    from ..tpra.supplier_requests import cancel_open       # late: that module imports the TPRA API
    cancelled = cancel_open(db, vendor, by, reason)
    return {"links_revoked": links, "questionnaires_expired": expired, "requests_cancelled": cancelled}


def start_offboarding(db: Session, vendor: Vendor, by: Optional[int], reason: Optional[str]) -> dict:
    """The supplier is offboarded and its side closed; the exit checklist is laid
    out, with every standard step. Again on a supplier already offboarded, it
    closes whatever was opened since. Audited; the caller commits."""
    before = vendor.status
    vendor.status = "offboarded"
    held = [i for i in vendor.offboarding_checklist or [] if isinstance(i, dict)]
    have = {i.get("item") for i in held}
    # A list already laid out is brought up to the steps it was missing before the newest one, not given that one.
    vendor.offboarding_checklist = held + [i for i in _checklist(OFFBOARDING_CHECKLIST[:-1] if held else None)
                                           if i["item"] not in have]
    closed = close_supplier_side(db, vendor, by, reason or "Offboarding")
    tpra_service.write_audit(db, vendor.tenant_id, entity="vendor", action="offboard", vendor_id=vendor.id,
                             entity_id=vendor.id, actor_id=by, from_value=before, to_value="offboarded",
                             reason=reason, extra=closed)
    return closed


def _last(db: Session, vendor: Vendor, action: str) -> Optional[TPRAAuditLog]:
    return (db.query(TPRAAuditLog)
            .filter(TPRAAuditLog.vendor_id == vendor.id, TPRAAuditLog.entity == "vendor", TPRAAuditLog.action == action)
            .order_by(TPRAAuditLog.id.desc()).first())


def _exit_meta(db: Session, vendor: Vendor) -> dict:
    """What the audit trail says about the supplier's exit while it is under way: why, when, by whom, how many
    portal links closed, and the latest note. The exit has no columns of its own: it is read from what was written."""
    start = _last(db, vendor, "offboard") if (vendor.status or "").lower() == "offboarded" else None
    note = _last(db, vendor, "offboarding_notes") if start is not None else None
    who = db.query(GRCUser).filter(GRCUser.id == start.actor_id).first() if start is not None and start.actor_id else None
    return {"reason": start.reason if start is not None else None,
            "started_at": start.created_at.isoformat() if start is not None and start.created_at else None,
            "started_by": (who.display_name or who.username or who.email) if who is not None else None,
            "links_revoked": (start.extra or {}).get("links_revoked") if start is not None else None,
            "notes": note.reason if note is not None else None}


def _offboarding(db: Session, vendor: Vendor, items: list) -> dict:
    """`items`, `started` and `archived_at` are the supplier's exit as ever; the rest tells its story and lists
    the exits of single engagements beside it (tpra/engagements.py)."""
    return {"items": items, "started": (vendor.status or "").lower() == "offboarded",
            "archived_at": vendor.deleted_at.isoformat() if vendor.deleted_at else None,
            **_exit_meta(db, vendor), "engagements": tpra_engagements.exits(db, vendor)}


class OffboardingUpdate(BaseModel):
    # Full replacement list of {item, done} — the UI sends the current state; notes alone leave the list as it is.
    items: Optional[list] = None
    notes: Optional[str] = Field(None, max_length=8000)


class OffboardIn(BaseModel):
    reason: Optional[str] = None


@router.get("/vendors/{vendor_id}/offboarding")
def get_offboarding(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    # Surface the standard checklist without persisting until the user acts.
    return _offboarding(db, vendor, vendor.offboarding_checklist or _checklist())


@router.post("/vendors/{vendor_id}/offboarding/start")
def begin_offboarding(
    vendor_id: int,
    payload: OffboardIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Offboard the supplier: its portal links stop working and its unanswered
    questionnaires expire. Its records stay."""
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "vendors", "edit")
    if vendor.deleted_at is not None:
        raise HTTPException(status_code=409, detail="This supplier is archived. Restore it first.")
    closed = start_offboarding(db, vendor, current_user.id, " ".join((payload.reason or "").split()) or None)
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return {**_offboarding(db, vendor, vendor.offboarding_checklist), **closed}


@router.post("/vendors/{vendor_id}/offboarding/complete")
def complete_offboarding(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Offboarding is done once every step is: the supplier is archived (restore
    brings it back)."""
    tenant_ids = get_user_tenants(current_user, db)
    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    rbac.require_write(db, current_user, "vendors", "delete")
    if (vendor.status or "").lower() != "offboarded":
        raise HTTPException(status_code=400, detail="Start offboarding first.")
    open_steps = [i.get("item") for i in vendor.offboarding_checklist or [] if isinstance(i, dict) and not i.get("done")]
    if open_steps:
        raise HTTPException(status_code=409, detail={"message": "Some offboarding steps are not done.",
                                                     "open": open_steps})
    archive_vendor(db, vendor, current_user.id, "Offboarding complete")
    tpra_service.close_register_risks(db, vendor, current_user.id,
                                      f"Closed by Third-Party Risk: offboarding of {vendor.name} was completed.")
    db.commit()
    return serialize_vendor(vendor)


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
    if payload.items is not None:
        vendor.offboarding_checklist = stamp_steps(payload.items, vendor.offboarding_checklist, current_user.id)
    if payload.notes is not None:
        if (vendor.status or "").lower() != "offboarded":
            raise HTTPException(status_code=400, detail="Start offboarding first.")
        text = payload.notes.strip()
        latest = _last(db, vendor, "offboarding_notes")
        if text != ((latest.reason if latest is not None else None) or ""):
            tpra_service.write_audit(db, vendor.tenant_id, entity="vendor", action="offboarding_notes", vendor_id=vendor.id,
                                     entity_id=vendor.id, actor_id=current_user.id, reason=text)
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return _offboarding(db, vendor, vendor.offboarding_checklist or _checklist())

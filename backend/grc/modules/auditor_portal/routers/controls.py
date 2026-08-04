"""Auditor portal — controls.

Returns every parsed framework control with its applicability decision,
implementation state, evidence counts, and any active exception. The
auditor uses this list as the spine of the review: from any control row
they can drill into evidence, mark applicability, or attach remarks.

Endpoints:
  GET  /{framework_id}/controls                       — list rollup
  GET  /{framework_id}/controls/{control_id}          — detail w/ full
                                                        requirement text
                                                        and evidence list
  POST /{framework_id}/controls/{control_id}/auto-approve
        — one-click "mark as in-scope and approved" for non-critical
          controls. Critical controls always require a manual review.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    get_db,
    AuditLog,
    ParsedFrameworkControl,
    ClauseApplicability,
    ControlImplementation,
    ImplementationEvidence,
    CertificationJourney,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context


router = APIRouter()


@router.get("/{framework_id}/controls")
def list_controls(
    framework_id: int,
    applicability: Optional[str] = Query(
        None, description="in_scope | out_of_scope | pending | untouched"
    ),
    implementation_status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List every control for the framework with auditor-relevant rollups."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    if not ctx.framework:
        return {"controls": [], "framework": {"id": framework_id, "name": ctx.framework_label}}

    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == ctx.framework.id
    ).order_by(
        ParsedFrameworkControl.section_number.asc().nullsfirst(),
        ParsedFrameworkControl.control_id.asc(),
    ).all()
    control_ids = [c.id for c in controls]

    applicability_rows = []
    if control_ids:
        applicability_rows = db.query(ClauseApplicability).filter(
            ClauseApplicability.tenant_id.in_(user_tenants),
            ClauseApplicability.control_id.in_(control_ids),
        ).all()
    applicability_map = {r.control_id: r for r in applicability_rows}

    # Implementation rows live per-journey; fold to "best status" so the
    # auditor sees a single state per control row.
    implementation_map: dict = {}
    evidence_count_map: dict = {}
    if ctx.journey_ids and control_ids:
        imp_rows = db.query(ControlImplementation).filter(
            ControlImplementation.journey_id.in_(ctx.journey_ids),
            ControlImplementation.parsed_control_id.in_(control_ids),
        ).all()
        for imp in imp_rows:
            implementation_map[imp.parsed_control_id] = imp

        if imp_rows:
            imp_ids = [i.id for i in imp_rows]
            ev_rows = db.query(
                ImplementationEvidence.implementation_id,
                ImplementationEvidence.review_status,
                func.count(ImplementationEvidence.id),
            ).filter(
                ImplementationEvidence.implementation_id.in_(imp_ids)
            ).group_by(
                ImplementationEvidence.implementation_id,
                ImplementationEvidence.review_status,
            ).all()
            for impl_id, status_val, count in ev_rows:
                bucket = evidence_count_map.setdefault(impl_id, {"total": 0, "pending": 0, "approved": 0, "rejected": 0})
                bucket["total"] += count
                key = (status_val or "pending").lower()
                bucket[key if key in bucket else "pending"] += count

    def serialize(control: ParsedFrameworkControl) -> dict:
        appl = applicability_map.get(control.id)
        impl = implementation_map.get(control.id)
        ev = evidence_count_map.get(impl.id, {"total": 0, "pending": 0, "approved": 0, "rejected": 0}) if impl else {"total": 0, "pending": 0, "approved": 0, "rejected": 0}

        if appl is None:
            applicability_state = "untouched"
        elif appl.status != "approved":
            applicability_state = "pending"
        elif appl.is_applicable:
            applicability_state = "in_scope"
        else:
            applicability_state = "out_of_scope"

        return {
            "id": control.id,
            "control_id": control.control_id,
            "original_reference": control.original_reference,
            "title": control.title,
            # Short description for in-row tooltips. The full requirement
            # text is only fetched on demand by the detail endpoint so
            # the list payload stays small.
            "description": (control.description or "")[:300] if control.description else None,
            "domain": control.domain,
            "category": control.category,
            "section_number": control.section_number,
            "parent_section": control.parent_section,
            "is_mandatory": control.is_mandatory,
            "priority": control.priority,
            "is_critical": control.is_critical,
            "applicability": {
                "state": applicability_state,
                "is_applicable": appl.is_applicable if appl else None,
                "status": appl.status if appl else None,
                "justification": appl.justification if appl else None,
                "review_comment": appl.review_comment if appl else None,
                "reviewed_at": appl.reviewed_at if appl else None,
                "applicability_id": appl.id if appl else None,
            },
            "implementation": {
                "id": impl.id if impl else None,
                "status": impl.status if impl else None,
                "implementation_notes": getattr(impl, "implementation_notes", None) if impl else None,
            },
            "evidence_counts": ev,
            # Surface whether the auto-approve action is allowed from
            # the row. Frontend uses this to enable/disable the button.
            "can_auto_approve": (appl is None) and (not control.is_critical),
        }

    rows = [serialize(c) for c in controls]

    if applicability:
        rows = [r for r in rows if r["applicability"]["state"] == applicability]
    if implementation_status:
        rows = [r for r in rows if r["implementation"]["status"] == implementation_status]

    return {
        "framework": {
            "id": framework_id,
            "name": ctx.framework_label,
            "version": ctx.framework_version,
            "short_code": ctx.framework_short_code,
        },
        "controls": rows,
        "total": len(rows),
    }


# ─── Detail endpoint ────────────────────────────────────────────────

@router.get("/{framework_id}/controls/{control_id}")
def get_control_detail(
    framework_id: int,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Per-control detail used by the ControlsTab row-click modal.

    Returns the full framework requirement text plus every piece of
    uploaded evidence linked to the control (via the journey's
    ControlImplementation rows). Each evidence row carries enough
    context for the modal to render filename, uploader, status,
    timestamps, and a download link.
    """
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    control = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.id == control_id,
    ).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    # Tenant guard — the control's framework must be reachable from the
    # caller's tenant context (either as the resolved framework or via
    # a journey on the same uploaded_framework_id).
    if ctx.framework is None or control.uploaded_framework_id != ctx.framework.id:
        # Still allow read if the user can see the control via the
        # framework_id path the journey resolves through — we already
        # validated tenant access at resolve_framework_context time.
        if not ctx.framework or control.uploaded_framework_id != ctx.framework.id:
            # Defensive: deny when the control belongs to a different
            # framework than the URL implies.
            raise HTTPException(status_code=404, detail="Control not found for this framework")

    appl = db.query(ClauseApplicability).filter(
        ClauseApplicability.tenant_id.in_(user_tenants),
        ClauseApplicability.control_id == control.id,
    ).first()

    # Pull every ControlImplementation row across this tenant's journeys
    # for this control, then collect their evidence.
    impl_rows = []
    if ctx.journey_ids:
        impl_rows = db.query(ControlImplementation).filter(
            ControlImplementation.journey_id.in_(ctx.journey_ids),
            ControlImplementation.parsed_control_id == control.id,
        ).all()

    evidence_rows = []
    if impl_rows:
        impl_ids = [i.id for i in impl_rows]
        ev_q = db.query(ImplementationEvidence).filter(
            ImplementationEvidence.implementation_id.in_(impl_ids),
        ).order_by(ImplementationEvidence.uploaded_at.desc().nullslast()).all()
        for ev in ev_q:
            uploader_name = None
            if getattr(ev, "uploader", None) is not None:
                uploader_name = getattr(ev.uploader, "full_name", None) or getattr(ev.uploader, "username", None)
            evidence_rows.append({
                "id": ev.id,
                "evidence_id": ev.evidence_id,
                "file_name": ev.file_name,
                "file_size": ev.file_size,
                "review_status": ev.review_status,
                "ai_confidence_score": getattr(ev, "ai_confidence_score", None),
                "uploaded_at": ev.uploaded_at,
                "uploader_name": uploader_name,
                "implementation_id": ev.implementation_id,
            })

    # Implementation rollup — surface the "best" status the auditor sees.
    impl_summary = None
    if impl_rows:
        primary = impl_rows[0]
        impl_summary = {
            "id": primary.id,
            "status": primary.status,
            "implementation_notes": getattr(primary, "implementation_notes", None),
            "is_applicable": getattr(primary, "is_applicable", None),
        }

    return {
        "id": control.id,
        "control_id": control.control_id,
        "original_reference": control.original_reference,
        "title": control.title,
        # Full requirement text — preferred field, then description.
        "full_text": control.full_text,
        "description": control.description,
        "domain": control.domain,
        "category": control.category,
        "section_number": control.section_number,
        "parent_section": control.parent_section,
        "is_mandatory": control.is_mandatory,
        "priority": control.priority,
        "is_critical": control.is_critical,
        "criticality_reason": control.criticality_reason,
        "evidence_requirements": control.evidence_requirements or [],
        "applicability": {
            "is_applicable": appl.is_applicable if appl else None,
            "status": appl.status if appl else None,
            "justification": appl.justification if appl else None,
            "review_comment": appl.review_comment if appl else None,
            "reviewed_at": appl.reviewed_at if appl else None,
            "applicability_id": appl.id if appl else None,
        },
        "implementation": impl_summary,
        "evidence": evidence_rows,
        "can_auto_approve": (appl is None) and (not control.is_critical),
    }


# ─── Auto-approve endpoint ──────────────────────────────────────────

@router.post("/{framework_id}/controls/{control_id}/auto-approve")
def auto_approve_control(
    framework_id: int,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """One-click "mark in-scope and approved" for non-critical controls.

    Use case: the auditor has dozens of routine controls that obviously
    apply and just need to be moved out of `untouched`. This endpoint
    creates the ClauseApplicability record with `is_applicable=True`,
    `status='approved'`, records the caller as both requester and
    reviewer (audit trail still captures their identity), and
    propagates `is_applicable=True` to every ControlImplementation row
    for the control across the tenant's journeys.

    Guard rails:
      * 400 if the control is `is_critical` — those always need a manual
        decision + a separate reviewer, by tenant policy.
      * 409 if an applicability record already exists. Caller should use
        the existing `/reviews` flow to act on it.
    """
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)
    if not ctx.framework:
        raise HTTPException(status_code=404, detail="Framework not found")

    control = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.id == control_id,
        ParsedFrameworkControl.uploaded_framework_id == ctx.framework.id,
    ).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found in this framework")

    if control.is_critical:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Critical controls cannot be auto-approved. Use the manual applicability flow.",
        )

    tenant_id = user_tenants[0] if user_tenants else None
    if tenant_id is None:
        raise HTTPException(status_code=403, detail="No tenant context")

    existing = db.query(ClauseApplicability).filter(
        ClauseApplicability.tenant_id == tenant_id,
        ClauseApplicability.control_id == control.id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "An applicability decision already exists for this control. "
                "Use the review action on the existing record."
            ),
        )

    now = datetime.utcnow()
    record = ClauseApplicability(
        tenant_id=tenant_id,
        uploaded_framework_id=ctx.framework.id,
        control_id=control.id,
        is_applicable=True,
        justification="Auto-approved by auditor from the auditor portal.",
        status="approved",
        requested_by=current_user.id,
        requested_at=now,
        reviewed_by=current_user.id,
        reviewed_at=now,
        review_comment="Auto-approved (in-scope) by auditor.",
    )
    db.add(record)
    db.flush()

    # Propagate `is_applicable=True` to the journey-bound implementation
    # rows so the rest of the platform sees the same answer as the
    # auditor portal.
    journey_ids = [
        j.id for j in db.query(CertificationJourney.id)
        .filter(CertificationJourney.tenant_id == tenant_id)
        .all()
    ]
    if journey_ids:
        db.query(ControlImplementation).filter(
            ControlImplementation.parsed_control_id == control.id,
            ControlImplementation.journey_id.in_(journey_ids),
        ).update({"is_applicable": True}, synchronize_session=False)

    audit = AuditLog(
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="applicability_auto_approved",
        resource_type="clause_applicability",
        resource_id=record.id,
        changes={
            "detail": (
                f"Auto-approved control {control.original_reference or control.control_id} "
                f"as in-scope via auditor portal."
            ),
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(record)

    return {
        "applicability_id": record.id,
        "control_id": control.id,
        "status": record.status,
        "is_applicable": record.is_applicable,
        "reviewed_at": record.reviewed_at,
    }

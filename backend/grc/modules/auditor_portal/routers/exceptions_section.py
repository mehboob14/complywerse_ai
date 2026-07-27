"""Auditor portal — exceptions.

Two flavours surfaced together:
  1. Controls marked Not Applicable via the ClauseApplicability workflow
     (these are the formal scope-exception records the auditor must
     review before signing off on a framework).
  2. Policy exceptions on governance documents linked to this framework
     (PolicyException rows where the parent doc carries this framework
     in its framework_ids JSON array).

Each row is returned with enough context for the auditor to render a
decision and (via the /reviews endpoint) approve or reject it.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    get_db,
    ClauseApplicability,
    ParsedFrameworkControl,
    GovernanceDocument,
    PolicyException,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context, parsed_control_ids_for_context


router = APIRouter()


@router.get("/{framework_id}/exceptions")
def list_exceptions(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)
    parsed_ids = parsed_control_ids_for_context(ctx, db)

    control_exceptions: list = []
    if parsed_ids:
        rows = db.query(ClauseApplicability).join(
            ParsedFrameworkControl,
            ParsedFrameworkControl.id == ClauseApplicability.control_id,
        ).filter(
            ClauseApplicability.tenant_id.in_(user_tenants),
            ClauseApplicability.control_id.in_(parsed_ids),
            ClauseApplicability.is_applicable == False,  # noqa: E712
        ).all()
        for r in rows:
            control_exceptions.append({
                "applicability_id": r.id,
                "control_id": r.control_id,
                "control_reference": r.control.control_id if r.control else None,
                "control_title": r.control.title if r.control else None,
                "is_applicable": r.is_applicable,
                "status": r.status,
                "justification": r.justification,
                "review_comment": r.review_comment,
                "requested_by": r.requested_by,
                "requested_at": r.requested_at,
                "reviewed_by": r.reviewed_by,
                "reviewed_at": r.reviewed_at,
            })

    # Policy exceptions on docs tagged with this framework.
    #
    # `GovernanceDocument.framework_ids` is a JSON array whose entries
    # may reference either the UploadedFramework.id or the published
    # Framework.id, depending on which surface the user picked when
    # uploading the document. Earlier code only checked `ctx.framework`
    # (UploadedFramework) — which made this list empty for SWIFT and
    # any other published-Framework-driven portal. We now accept either.
    policy_exceptions: list = []
    candidate_framework_ids: set = set()
    if ctx.framework is not None:
        candidate_framework_ids.add(ctx.framework.id)
    if ctx.published_framework is not None:
        candidate_framework_ids.add(ctx.published_framework.id)

    if candidate_framework_ids:
        docs = db.query(GovernanceDocument).filter(
            GovernanceDocument.tenant_id.in_(user_tenants),
            GovernanceDocument.framework_ids.isnot(None),
        ).all()
        doc_id_set = set()
        for d in docs:
            fids = d.framework_ids or []
            try:
                normalized = {int(v) for v in fids if v is not None}
            except (TypeError, ValueError):
                continue
            if candidate_framework_ids & normalized:
                doc_id_set.add(d.id)

        if doc_id_set:
            pol_rows = db.query(PolicyException).filter(
                PolicyException.tenant_id.in_(user_tenants),
                PolicyException.document_id.in_(doc_id_set),
            ).all()
            for p in pol_rows:
                policy_exceptions.append({
                    "id": p.id,
                    "title": p.title,
                    "description": p.description,
                    "justification": p.justification,
                    "risk_assessment": p.risk_assessment,
                    "status": p.status,
                    "priority": p.priority,
                    "document_id": p.document_id,
                    "requested_by": p.requested_by,
                    "requested_at": p.requested_at,
                    "approved_by": p.approved_by,
                    "approved_at": p.approved_at,
                    "rejected_by": p.rejected_by,
                    "rejected_at": p.rejected_at,
                    "rejection_reason": p.rejection_reason,
                    "effective_date": p.effective_date,
                    "expiry_date": p.expiry_date,
                    "is_expired": p.is_expired,
                })

    return {
        "control_exceptions": control_exceptions,
        "policy_exceptions": policy_exceptions,
        "total": len(control_exceptions) + len(policy_exceptions),
    }

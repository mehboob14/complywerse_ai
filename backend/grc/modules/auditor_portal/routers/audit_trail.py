"""Auditor portal — audit trail.

Surfaces tenant-scoped AuditLog entries relevant to a framework's
artifacts. Because AuditLog doesn't carry a framework_id column directly,
we filter by `resource_type` and limit to types known to be in this
framework's blast radius. The result is the chronological evidence chain
an auditor needs to validate every approval/review decision.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    get_db,
    AuditLog,
    ParsedFrameworkControl,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context, parsed_control_ids_for_context


router = APIRouter()


# Resource types the audit trail surfaces. Auditor-relevant only —
# we don't dump the entire AuditLog stream; that would be noisy.
_AUDIT_RESOURCE_TYPES = {
    "framework",
    "uploaded_framework",
    "parsed_framework_control",
    "clause_applicability",
    "control_implementation",
    "implementation_evidence",
    "evidence",
    "framework_assessment",
    "assessment_item",
    "assessment_evidence",
    "governance_document",
    "policy_exception",
    "exception",
    "risk",
    "vulnerability",
    "vendor_assessment",
}


@router.get("/{framework_id}/audit-trail")
def list_audit_trail(
    framework_id: int,
    limit: int = Query(200, ge=1, le=1000),
    resource_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)
    parsed_ids = parsed_control_ids_for_context(ctx, db)

    query = db.query(AuditLog).filter(
        AuditLog.tenant_id.in_(user_tenants),
    )

    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    else:
        query = query.filter(AuditLog.resource_type.in_(_AUDIT_RESOURCE_TYPES))

    rows = query.order_by(AuditLog.timestamp.desc()).limit(limit).all()

    # Best-effort narrowing — for resource types we can resolve to a
    # specific framework, drop unrelated rows.
    parsed_id_set = set(parsed_ids)
    framework_id_int = ctx.framework.id if ctx.framework else None
    journey_id_set = set(ctx.journey_ids)

    out: List[dict] = []
    for r in rows:
        rtype = r.resource_type
        keep = True
        if rtype in ("uploaded_framework", "framework") and framework_id_int is not None:
            keep = r.resource_id == framework_id_int
        elif rtype == "parsed_framework_control" and parsed_id_set:
            keep = r.resource_id in parsed_id_set
        elif rtype in ("control_implementation",) and journey_id_set:
            # If we know which implementation rows belong to this framework
            # we could narrow further; skipping for now to keep things
            # additive — audit log resource_id may or may not be set.
            pass
        if not keep:
            continue
        out.append({
            "id": r.id,
            "user_id": r.user_id,
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "changes": r.changes,
            "timestamp": r.timestamp,
        })

    return {"audit_trail": out, "total": len(out)}

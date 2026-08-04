"""Per-tenant Issue automation flags.

All triggers default to OFF — when the tenant hasn't opted in, the v2
auto-create hooks (KRI red, mitigation overdue, governance review fast-
forward, control evidence rejection) are no-ops. This guarantees v2 ships
with byte-identical behaviour to v1 until the tenant explicitly enables
each trigger.

Surfaced on the Issues > Automation admin tab.
"""
from typing import Dict, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ....models import IssueAutomationFlags, GRCUser, get_db
from ....routers.auth_router import (
    require_auth, get_user_primary_tenant,
    require_tenant_permission,
)

_require_view = require_tenant_permission("issue_management:issues:view")
_require_edit = require_tenant_permission("issue_management:issues:edit")

router = APIRouter(
    prefix="/automation-flags",
    tags=["Issue Management - Automation"],
    dependencies=[Depends(_require_view)],
)


_FIELDS = (
    "refresh_document_review",
    "kri_red_breach",
    "overdue_mitigation",
    "control_evidence_rejected",
    "all_enabled",
)


def _serialize(row: IssueAutomationFlags) -> Dict[str, Any]:
    return {
        "tenant_id": row.tenant_id,
        "refresh_document_review": bool(row.refresh_document_review),
        "kri_red_breach": bool(row.kri_red_breach),
        "overdue_mitigation": bool(row.overdue_mitigation),
        "control_evidence_rejected": bool(row.control_evidence_rejected),
        "all_enabled": bool(row.all_enabled),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _get_or_create(tenant_id: int, db: Session) -> IssueAutomationFlags:
    row = db.query(IssueAutomationFlags).filter(IssueAutomationFlags.tenant_id == tenant_id).first()
    if row is None:
        row = IssueAutomationFlags(tenant_id=tenant_id)
        db.add(row)
        db.flush()
    return row


@router.get("")
def get_flags(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    row = _get_or_create(tenant_id, db)
    db.commit()
    return _serialize(row)


@router.put("", dependencies=[Depends(_require_edit)])
def update_flags(
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    row = _get_or_create(tenant_id, db)
    for f in _FIELDS:
        if f in body:
            setattr(row, f, bool(body[f]))
    row.updated_by = current_user.id
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _serialize(row)


# ── Internal helper — used by hook sites to gate auto-create calls ──────
def is_enabled(tenant_id: int, flag: str, db: Session) -> bool:
    """Returns True iff the tenant has opted in to the given automation
    trigger (or has all_enabled=True). Safe default = False."""
    row = db.query(IssueAutomationFlags).filter(IssueAutomationFlags.tenant_id == tenant_id).first()
    if row is None:
        return False
    if row.all_enabled:
        return True
    return bool(getattr(row, flag, False))

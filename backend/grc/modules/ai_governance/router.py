"""Administration → AI Governance. Read-only: what AI is used for, and every call that was made.

Viewing needs ``admin:ai_governance:view``. The text of a prompt or an answer needs ``admin:ai_governance:payloads`` and
is shown by a POST (reading it is an audited action, and a GET must not write); it is the prompt as it was sent, after
the data-protection guard replaced names, hosts, addresses and secrets.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...models import AICallPayload, AIUsageEvent, Tenant
from ...rich_audit import write_rich_audit_log
from ...routers.admin_router import check_permission, get_current_tenant_user, get_tenant_db
from ...services.ai_gateway import ledger
from . import service

router = APIRouter(prefix="/admin/ai-governance", tags=["Administration - AI Governance"])

VIEW = "admin:ai_governance:view"
PAYLOADS = "admin:ai_governance:payloads"


def _allowed(permission: str):
    def checker(user=Depends(get_current_tenant_user), db: Session = Depends(get_tenant_db)):
        if not check_permission(user, db, permission):
            raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")
        return user
    return checker


@router.get("/overview")
def overview(days: int = Query(30, ge=1, le=365), user=Depends(_allowed(VIEW)), db: Session = Depends(get_tenant_db)):
    return service.overview(db, days)


@router.get("/inventory")
def inventory(days: int = Query(30, ge=1, le=365), user=Depends(_allowed(VIEW)), db: Session = Depends(get_tenant_db)):
    return service.inventory(db, days)


@router.get("/activity")
def activity(days: int = Query(30, ge=1, le=365), module: Optional[str] = None, use_case: Optional[str] = None,
             status: Optional[str] = Query(None, pattern="^(success|failed|blocked)$"), username: Optional[str] = None,
             q: Optional[str] = None, skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
             user=Depends(_allowed(VIEW)), db: Session = Depends(get_tenant_db)):
    return service.activity(db, days=days, module=module, use_case=use_case, status=status, user=username, q=q,
                            skip=skip, limit=limit)


@router.get("/activity/{event_id}")
def call_detail(event_id: int, user=Depends(_allowed(VIEW)), db: Session = Depends(get_tenant_db)):
    event = db.query(AIUsageEvent).filter(AIUsageEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Call not found")
    kept = db.query(AICallPayload).filter(AICallPayload.event_id == event_id, AICallPayload.expires_at >= datetime.utcnow()).first()
    out = service.serialize(event, detail=True)
    out["payload"] = {"kept": kept is not None, "expires_at": kept.expires_at.isoformat() + "Z" if kept else None,
                      "can_reveal": bool(kept) and check_permission(user, db, PAYLOADS)}
    out["trace"] = service.trace(db, event.operation_id) if event.operation_id else []
    return out


@router.post("/activity/{event_id}/reveal")
def reveal(event_id: int, user=Depends(_allowed(PAYLOADS)), db: Session = Depends(get_tenant_db)):
    shown = ledger.reveal(db, event_id)
    if shown is None:
        raise HTTPException(status_code=404, detail="The text of this call was not kept, or has expired")
    event = db.query(AIUsageEvent).filter(AIUsageEvent.id == event_id).first()
    tenant = db.query(Tenant).first()
    label = service.use_case_for(event).label if event and service.use_case_for(event) else (event.feature_key if event else "")
    write_rich_audit_log(
        db=db, tenant_id=tenant.id if tenant else 0, user_id=getattr(user, "id", None), action="reveal",
        resource_type="ai_call", resource_id=event_id, resource_name=label,
        summary=f"Opened the text of an AI call: {label} ({event.occurred_at:%Y-%m-%d %H:%M} UTC)" if event else "Opened the text of an AI call")
    db.commit()
    return shown

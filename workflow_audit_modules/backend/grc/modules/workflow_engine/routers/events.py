from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_primary_tenant, require_tenant_permission
from ..schemas import TriggerEventRequest
from ..services.runtime import get_runtime

router = APIRouter(prefix="/events", tags=["Workflow Engine Events"])


@router.post("/publish", status_code=status.HTTP_202_ACCEPTED)
def publish_platform_event(
    payload: TriggerEventRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:create")),
):
    tenant_id = payload.tenant_id or get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context not resolved")

    runtime = get_runtime()
    runtime.publish_event(
        event_name=payload.event_name,
        tenant_id=tenant_id,
        payload=payload.payload,
        correlation_id=payload.correlation_id,
    )

    return {
        "status": "queued",
        "event_name": payload.event_name,
        "tenant_id": tenant_id,
    }

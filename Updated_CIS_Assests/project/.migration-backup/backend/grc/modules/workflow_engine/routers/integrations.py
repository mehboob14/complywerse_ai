import hashlib
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ....models import (
    WorkflowDefinition,
    WorkflowEngineSchedule,
    WorkflowEngineWebhookEndpoint,
    GRCUser,
    get_db,
)
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants
from ....routers.auth_router import require_tenant_permission
from ..schemas import (
    TriggerEventRequest,
    WorkflowScheduleCreate,
    WorkflowScheduleResponse,
    WorkflowWebhookCreate,
    WorkflowWebhookResponse,
)
from ..services.runtime import get_runtime

router = APIRouter(prefix="/integrations", tags=["Workflow Engine Integrations"])


@router.post("/schedules", response_model=WorkflowScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    payload: WorkflowScheduleCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:create")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == payload.workflow_definition_id,
        WorkflowDefinition.tenant_id == tenant_id,
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    if payload.schedule_type == "interval":
        if not payload.interval_minutes:
            raise HTTPException(status_code=400, detail="interval_minutes required for interval schedule")
        next_run_at = datetime.utcnow() + timedelta(minutes=int(payload.interval_minutes))
    elif payload.schedule_type == "cron":
        if not payload.cron_expression:
            raise HTTPException(status_code=400, detail="cron_expression required for cron schedule")
        try:
            from croniter import croniter as _ci
            next_run_at = _ci(payload.cron_expression, datetime.utcnow()).get_next(datetime)
        except ImportError:
            next_run_at = datetime.utcnow() + timedelta(hours=1)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid cron expression: {e}")
    else:
        if not payload.run_at:
            raise HTTPException(status_code=400, detail="run_at required for once schedule")
        next_run_at = payload.run_at

    schedule = WorkflowEngineSchedule(
        tenant_id=tenant_id,
        workflow_definition_id=payload.workflow_definition_id,
        name=payload.name,
        schedule_type=payload.schedule_type,
        interval_minutes=payload.interval_minutes,
        cron_expression=getattr(payload, "cron_expression", None),
        run_at=payload.run_at,
        next_run_at=next_run_at,
        payload=payload.payload,
        is_active=payload.is_active,
        created_by_id=current_user.id,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    return WorkflowScheduleResponse(
        id=schedule.id,
        tenant_id=schedule.tenant_id,
        workflow_definition_id=schedule.workflow_definition_id,
        name=schedule.name,
        schedule_type=schedule.schedule_type,
        interval_minutes=schedule.interval_minutes,
        cron_expression=schedule.cron_expression,
        run_at=schedule.run_at,
        next_run_at=schedule.next_run_at,
        payload=schedule.payload or {},
        is_active=schedule.is_active,
        last_run_at=schedule.last_run_at,
        created_at=schedule.created_at,
        updated_at=schedule.updated_at,
    )


@router.get("/schedules", response_model=list[WorkflowScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    items = db.query(WorkflowEngineSchedule).filter(
        WorkflowEngineSchedule.tenant_id.in_(user_tenants)
    ).order_by(WorkflowEngineSchedule.next_run_at.asc()).all()

    return [
        WorkflowScheduleResponse(
            id=item.id,
            tenant_id=item.tenant_id,
            workflow_definition_id=item.workflow_definition_id,
            name=item.name,
            schedule_type=item.schedule_type,
            interval_minutes=item.interval_minutes,
            cron_expression=item.cron_expression,
            run_at=item.run_at,
            next_run_at=item.next_run_at,
            payload=item.payload or {},
            is_active=item.is_active,
            last_run_at=item.last_run_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


@router.post("/webhooks", response_model=WorkflowWebhookResponse, status_code=status.HTTP_201_CREATED)
def create_webhook(
    payload: WorkflowWebhookCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:create")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    token = hashlib.sha256(f"{tenant_id}:{payload.name}:{uuid.uuid4()}".encode("utf-8")).hexdigest()[:48]
    hook = WorkflowEngineWebhookEndpoint(
        tenant_id=tenant_id,
        name=payload.name,
        token=token,
        event_name=payload.event_name,
        callback_url=payload.callback_url,
        secret=payload.secret,
        is_active=payload.is_active,
        created_by_id=current_user.id,
    )
    db.add(hook)
    db.commit()
    db.refresh(hook)

    return WorkflowWebhookResponse(
        id=hook.id,
        tenant_id=hook.tenant_id,
        name=hook.name,
        token=hook.token,
        event_name=hook.event_name,
        callback_url=hook.callback_url,
        is_active=hook.is_active,
        created_at=hook.created_at,
        updated_at=hook.updated_at,
    )


@router.get("/webhooks", response_model=list[WorkflowWebhookResponse])
def list_webhooks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    hooks = db.query(WorkflowEngineWebhookEndpoint).filter(
        WorkflowEngineWebhookEndpoint.tenant_id.in_(user_tenants)
    ).order_by(WorkflowEngineWebhookEndpoint.created_at.desc()).all()

    return [
        WorkflowWebhookResponse(
            id=item.id,
            tenant_id=item.tenant_id,
            name=item.name,
            token=item.token,
            event_name=item.event_name,
            callback_url=item.callback_url,
            is_active=item.is_active,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in hooks
    ]


@router.post("/webhooks/{token}/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest_webhook_event(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    hook = db.query(WorkflowEngineWebhookEndpoint).filter(
        WorkflowEngineWebhookEndpoint.token == token,
        WorkflowEngineWebhookEndpoint.is_active == True,
    ).first()
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    payload = await request.json()
    runtime = get_runtime()
    runtime.publish_event(
        event_name=hook.event_name,
        tenant_id=hook.tenant_id,
        payload=payload if isinstance(payload, dict) else {"data": payload},
        correlation_id=f"webhook:{hook.id}:{int(datetime.utcnow().timestamp())}",
    )

    return {"status": "queued", "event_name": hook.event_name, "tenant_id": hook.tenant_id}


@router.post("/events/publish-external", status_code=status.HTTP_202_ACCEPTED)
def publish_external_event(
    payload: TriggerEventRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:create")),
):
    tenant_id = payload.tenant_id or get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context not resolved")

    runtime = get_runtime()
    runtime.publish_event(payload.event_name, tenant_id, payload.payload, payload.correlation_id)
    return {"status": "queued", "event_name": payload.event_name, "tenant_id": tenant_id}

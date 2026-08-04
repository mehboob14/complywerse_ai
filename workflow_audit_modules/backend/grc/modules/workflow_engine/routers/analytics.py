from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import WorkflowEngineStep, WorkflowInstance, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission

router = APIRouter(prefix="/analytics", tags=["Workflow Engine Analytics"])


@router.get("/overview")
def workflow_analytics_overview(
    lookback_days: int = 30,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:analytics:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    since = datetime.utcnow() - timedelta(days=max(1, lookback_days))

    base = db.query(WorkflowInstance).filter(
        WorkflowInstance.tenant_id.in_(user_tenants),
        WorkflowInstance.started_at >= since,
    )

    total_instances = base.count()
    completed = base.filter(WorkflowInstance.status == "completed").count()
    failed = base.filter(WorkflowInstance.status == "failed").count()
    waiting = base.filter(WorkflowInstance.status == "waiting").count()
    running = base.filter(WorkflowInstance.status == "running").count()

    avg_minutes = db.query(
        func.avg(
            func.extract('epoch', WorkflowInstance.completed_at - WorkflowInstance.started_at) / 60.0
        )
    ).filter(
        WorkflowInstance.tenant_id.in_(user_tenants),
        WorkflowInstance.completed_at.isnot(None),
        WorkflowInstance.started_at >= since,
    ).scalar()

    return {
        "total_instances": total_instances,
        "completed": completed,
        "failed": failed,
        "waiting": waiting,
        "running": running,
        "avg_completion_minutes": round(float(avg_minutes or 0), 2),
        "lookback_days": lookback_days,
    }


@router.get("/bottlenecks")
def workflow_bottleneck_analysis(
    lookback_days: int = 30,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:analytics:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    since = datetime.utcnow() - timedelta(days=max(1, lookback_days))

    rows = db.query(
        WorkflowEngineStep.node_key,
        func.count(WorkflowEngineStep.id).label("step_count"),
        func.avg(func.extract('epoch', WorkflowEngineStep.completed_at - WorkflowEngineStep.started_at) / 60.0).label("avg_minutes"),
    ).join(
        WorkflowInstance, WorkflowEngineStep.workflow_instance_id == WorkflowInstance.id
    ).filter(
        WorkflowInstance.tenant_id.in_(user_tenants),
        WorkflowEngineStep.completed_at.isnot(None),
        WorkflowEngineStep.started_at >= since,
    ).group_by(
        WorkflowEngineStep.node_key
    ).order_by(
        func.avg(func.extract('epoch', WorkflowEngineStep.completed_at - WorkflowEngineStep.started_at) / 60.0).desc()
    ).limit(20).all()

    return {
        "bottlenecks": [
            {
                "node_key": row.node_key,
                "step_count": int(row.step_count or 0),
                "avg_minutes": round(float(row.avg_minutes or 0), 2),
            }
            for row in rows
        ]
    }


@router.get("/live-status")
def workflow_live_status(
    overdue_minutes: int = 60,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:analytics:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    overdue_before = datetime.utcnow() - timedelta(minutes=max(1, overdue_minutes))

    active_instances = db.query(WorkflowInstance).filter(
        WorkflowInstance.tenant_id.in_(user_tenants),
        WorkflowInstance.status.in_(["running", "waiting"]),
    ).order_by(WorkflowInstance.started_at.asc()).limit(300).all()

    overdue_steps = db.query(WorkflowEngineStep).join(
        WorkflowInstance, WorkflowEngineStep.workflow_instance_id == WorkflowInstance.id
    ).filter(
        WorkflowInstance.tenant_id.in_(user_tenants),
        WorkflowEngineStep.status.in_(["running", "waiting_timer", "waiting_approval", "waiting_subworkflow"]),
        WorkflowEngineStep.started_at <= overdue_before,
    ).order_by(WorkflowEngineStep.started_at.asc()).limit(300).all()

    return {
        "active_instances": [
            {
                "instance_id": item.id,
                "workflow_definition_id": item.workflow_definition_id,
                "status": item.status,
                "current_node_key": item.current_node_key,
                "started_at": item.started_at,
            }
            for item in active_instances
        ],
        "overdue_steps": [
            {
                "step_id": step.id,
                "instance_id": step.workflow_instance_id,
                "node_key": step.node_key,
                "status": step.status,
                "started_at": step.started_at,
                "next_run_at": step.next_run_at,
            }
            for step in overdue_steps
        ],
        "overdue_minutes_threshold": overdue_minutes,
    }

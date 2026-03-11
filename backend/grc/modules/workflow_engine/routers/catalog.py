from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ....models import GRCUser, Role, TenantUser, UserRole, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from ....routers.auth_router import require_tenant_permission

from ..services.catalog import (
    ACTION_NODE_TYPES,
    APPROVAL_NODE_TYPES,
    CONDITION_NODE_TYPES,
    INTEGRATION_POINTS,
    PREBUILT_TEMPLATES,
    TIMER_NODE_TYPES,
    TRIGGER_NODE_TYPES,
)

router = APIRouter(prefix="/catalog", tags=["Workflow Engine Catalog"])


@router.get("/node-types")
def list_node_types(
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    return {
        "triggers": TRIGGER_NODE_TYPES,
        "actions": ACTION_NODE_TYPES,
        "conditions": CONDITION_NODE_TYPES,
        "approvals": APPROVAL_NODE_TYPES,
        "timers": TIMER_NODE_TYPES,
    }


@router.get("/templates/library")
def list_template_library(
    _: bool = Depends(require_tenant_permission("workflow_engine:templates:view")),
):
    return {"templates": PREBUILT_TEMPLATES}


@router.get("/integrations")
def list_cross_module_integration_points(
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:view")),
):
    return {"integration_points": INTEGRATION_POINTS}


@router.get("/actors/users")
def list_workflow_actor_users(
    search: str | None = Query(None, description="Search by name/email"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"users": []}

    query = db.query(GRCUser, TenantUser.tenant_id).join(
        TenantUser,
        TenantUser.user_id == GRCUser.id,
    ).filter(
        TenantUser.tenant_id.in_(user_tenants),
        GRCUser.is_active == True,
    )

    if search:
        like = f"%{search}%"
        query = query.filter(
            (GRCUser.display_name.ilike(like)) |
            (GRCUser.username.ilike(like)) |
            (GRCUser.email.ilike(like))
        )

    rows = query.order_by(GRCUser.display_name.asc()).limit(300).all()
    return {
        "users": [
            {
                "id": user.id,
                "tenant_id": tenant_id,
                "display_name": user.display_name,
                "username": user.username,
                "email": user.email,
            }
            for user, tenant_id in rows
        ]
    }


@router.get("/actors/roles")
def list_workflow_actor_roles(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"roles": []}

    rows = db.query(Role).filter(
        Role.tenant_id.in_(user_tenants),
    ).order_by(Role.name.asc()).all()

    results = []
    for role in rows:
        member_count = db.query(UserRole.id).filter(
            UserRole.tenant_id == role.tenant_id,
            UserRole.role_id == role.id,
        ).count()
        results.append(
            {
                "id": role.id,
                "tenant_id": role.tenant_id,
                "name": role.name,
                "description": role.description,
                "member_count": member_count,
            }
        )

    return {"roles": results}

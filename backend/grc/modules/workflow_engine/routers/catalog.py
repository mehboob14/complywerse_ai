from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional

from ....models import get_db
from ....routers.auth_router import require_tenant_permission
from ....routers.admin_router import get_tenant_db
from ....tenant_models import TenantUser, Role

from ..services.catalog import (
    ACTION_NODE_TYPES,
    APPROVAL_NODE_TYPES,
    CONDITION_NODE_TYPES,
    get_platform_functions_grouped_by_module,
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
    platform_functions = get_platform_functions_grouped_by_module()
    return {
        "triggers": TRIGGER_NODE_TYPES,
        "actions": ACTION_NODE_TYPES,
        "platform_functions": platform_functions,
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
def list_actor_users(
    search: Optional[str] = None,
    tenant_db: Session = Depends(get_tenant_db),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    """List tenant users available as workflow actors (approvers, assignees, recipients)."""
    from ....tenant_manager import IS_SQLITE
    tenant_schema = tenant_db.info.get('tenant_schema')

    if IS_SQLITE:
        query = tenant_db.query(TenantUser).filter(
            TenantUser.tenant_id == tenant_schema,
            TenantUser.is_active == True,
        )
    else:
        query = tenant_db.query(TenantUser).filter(TenantUser.is_active == True)

    if search:
        query = query.filter(
            TenantUser.username.ilike(f"%{search}%") | TenantUser.email.ilike(f"%{search}%")
        )
    users = query.order_by(TenantUser.username).limit(200).all()
    return {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "display_name": u.display_name or u.username,
            }
            for u in users
        ]
    }


@router.get("/actors/roles")
def list_actor_roles(
    tenant_db: Session = Depends(get_tenant_db),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    """List tenant roles available as workflow actors."""
    from ....tenant_manager import IS_SQLITE
    tenant_schema = tenant_db.info.get('tenant_schema')

    if IS_SQLITE:
        roles = tenant_db.query(Role).filter(
            Role.tenant_id == tenant_schema
        ).order_by(Role.name).all()
    else:
        roles = tenant_db.query(Role).order_by(Role.name).all()

    return {
        "roles": [
            {"id": r.id, "name": r.name, "description": getattr(r, "description", None)}
            for r in roles
        ]
    }

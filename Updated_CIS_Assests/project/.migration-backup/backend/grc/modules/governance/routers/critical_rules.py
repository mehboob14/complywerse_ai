"""Admin endpoints for FrameworkCriticalRule (Task #46 step 5).

Tenant admins can list/toggle the per-framework critical rules and configure the
default approver chain that newly drafted patch proposals inherit.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import (
    FrameworkCriticalRule,
    GRCUser,
    Permission,
    Role,
    RolePermission,
    UploadedFramework,
    UserRole,
    get_db,
)
from ....rich_audit import write_rich_audit_log
from ....routers.auth_router import (
    get_user_primary_tenant,
    get_user_tenants,
    require_auth,
)
from ..services.critical_rules import get_or_seed_rules


def _require_admin(db: Session, user: GRCUser, tenant_id: int) -> None:
    """Require admin-level role for critical-rule configuration."""
    admin_role = (
        db.query(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            UserRole.user_id == user.id,
            UserRole.tenant_id == tenant_id,
            Role.name.in_(["Admin", "admin", "Compliance Admin", "Super Admin", "ComplianceAdmin"]),
        )
        .first()
    )
    if admin_role:
        return
    perm_row = db.query(Permission).filter(Permission.name == "governance:critical_rules:manage").first()
    if perm_row:
        has_perm = (
            db.query(RolePermission)
            .join(UserRole, UserRole.role_id == RolePermission.role_id)
            .filter(
                UserRole.user_id == user.id,
                UserRole.tenant_id == tenant_id,
                RolePermission.permission_id == perm_row.id,
            )
            .first()
        )
        if has_perm:
            return
    raise HTTPException(
        status_code=403,
        detail="Admin permission required to manage critical rules",
    )


router = APIRouter(prefix="/critical-rules", tags=["Policy AI Critical Rules"])


class CriticalRuleOut(BaseModel):
    id: int
    tenant_id: int
    uploaded_framework_id: Optional[int]
    rule_type: str
    enabled: bool
    params: dict
    approver_chain: list

    class Config:
        from_attributes = True


class CriticalRuleUpdate(BaseModel):
    enabled: Optional[bool] = None
    params: Optional[dict] = None
    approver_chain: Optional[list] = None


@router.get("", response_model=List[CriticalRuleOut])
def list_rules(
    framework_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    if framework_id is not None:
        framework = (
            db.query(UploadedFramework)
            .filter(UploadedFramework.id == framework_id, UploadedFramework.tenant_id == tenant_id)
            .first()
        )
        if not framework:
            raise HTTPException(status_code=404, detail="Framework not found")
        rules = get_or_seed_rules(db, tenant_id, framework_id)
        db.commit()
        return rules
    return (
        db.query(FrameworkCriticalRule)
        .filter(FrameworkCriticalRule.tenant_id == tenant_id)
        .all()
    )


@router.put("/{rule_id}", response_model=CriticalRuleOut)
def update_rule(
    rule_id: int,
    body: CriticalRuleUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if tenant_id:
        _require_admin(db, current_user, tenant_id)
    rule = (
        db.query(FrameworkCriticalRule)
        .filter(
            FrameworkCriticalRule.id == rule_id,
            FrameworkCriticalRule.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    before = {
        "enabled": rule.enabled,
        "params": rule.params,
        "approver_chain": rule.approver_chain,
    }
    if body.enabled is not None:
        rule.enabled = body.enabled
    if body.params is not None:
        rule.params = body.params
    if body.approver_chain is not None:
        rule.approver_chain = body.approver_chain
    db.flush()
    write_rich_audit_log(
        db,
        tenant_id=rule.tenant_id,
        user_id=current_user.id,
        action="critical_rule.updated",
        resource_type="framework_critical_rule",
        resource_id=rule.id,
        resource_name=rule.rule_type,
        summary=f"Updated critical rule {rule.rule_type}",
        before=before,
        after={
            "enabled": rule.enabled,
            "params": rule.params,
            "approver_chain": rule.approver_chain,
        },
    )
    db.commit()
    db.refresh(rule)
    return rule

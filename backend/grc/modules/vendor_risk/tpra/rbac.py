"""Server-side RBAC for the TPRA module (Decision D: permission strings only).

Reads stay auth-only (consistent with the existing vendor-risk endpoints).
Mutations require a `vendor_risk:<resource>:<action>` permission, with the
existing `erm:risks:edit` accepted as a fallback so users who can already edit
ERM risks don't lose access. Administrator role and the tenant primary contact
bypass all checks (matches `require_tenant_permission`).
"""
from __future__ import annotations

from typing import Iterable, Set

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    GRCUser, Tenant, Role, Permission, RolePermission, UserRole,
)

# Accepted as a fallback for any TPRA write, so existing ERM-risk editors keep access.
_FALLBACK_WRITE = "erm:risks:edit"


def _is_admin_or_primary(db: Session, user: GRCUser) -> bool:
    tenant_row = db.query(Tenant).first()
    if (
        tenant_row
        and getattr(tenant_row, "primary_contact_email", None)
        and getattr(user, "email", None)
        and tenant_row.primary_contact_email.lower() == user.email.lower()
    ):
        return True
    role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        return False
    return bool(
        db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first()
    )


def user_has_any_permission(db: Session, user: GRCUser, names: Iterable[str]) -> bool:
    names = list(dict.fromkeys(names))  # dedupe, keep order
    if _is_admin_or_primary(db, user):
        return True
    role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        return False
    perm_ids = [
        p.id for p in db.query(Permission.id).filter(Permission.name.in_(names)).all()
    ]
    if not perm_ids:
        return False
    return bool(
        db.query(RolePermission)
        .filter(RolePermission.role_id.in_(role_ids), RolePermission.permission_id.in_(perm_ids))
        .first()
    )


def require_write(
    db: Session, user: GRCUser, resource: str, action: str = "edit",
    allow_fallback: bool = True,
) -> None:
    """Raise 403 unless the user may perform `action` on a TPRA `resource`.

    `allow_fallback=False` drops the broad `erm:risks:edit` acceptance so that
    high-sensitivity actions (approvals:approve, findings:accept_risk) require the
    dedicated `vendor_risk:*` permission and cannot be exercised via a generic
    enterprise-risk edit grant — preserving least-privilege / segregation of duties.
    """
    acceptable: Set[str] = {f"vendor_risk:{resource}:{action}"}
    if allow_fallback:
        acceptable.add(_FALLBACK_WRITE)
    if not user_has_any_permission(db, user, acceptable):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied — requires vendor_risk:{resource}:{action}",
        )

"""Server-side RBAC for the TPRA module (Decision D: permission strings only).

Reads stay auth-only (consistent with the existing vendor-risk endpoints).
Mutations require a `vendor_risk:<resource>:<action>` permission, with the
existing `erm:risks:edit` accepted as a fallback so users who can already edit
ERM risks don't lose access. Administrator role and the tenant primary contact
bypass all checks (the shared rule in `auth_router`).
"""
from __future__ import annotations

from typing import Iterable, Set

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ....models import GRCUser
from ....routers.auth_router import has_tenant_permission, is_tenant_admin

# Accepted as a fallback for any TPRA write, so existing ERM-risk editors keep access.
_FALLBACK_WRITE = "erm:risks:edit"


def _is_admin_or_primary(db: Session, user: GRCUser) -> bool:
    return is_tenant_admin(db, user)


def user_has_any_permission(db: Session, user: GRCUser, names: Iterable[str]) -> bool:
    return has_tenant_permission(db, user, *names)


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

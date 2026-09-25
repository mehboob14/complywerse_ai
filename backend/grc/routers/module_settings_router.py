"""A module's own settings: its status levels, SLA rules, extra fields and
dropdown lists.

One pair of endpoints serves every module that opts in (see
``services/module_settings.MODULES``), so a new module needs a defaults block and
nothing else here. Each module is gated on its own permissions — an asset admin
edits the asset form, not the audit one.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..models import GRCUser, get_db
from ..rich_audit import write_rich_audit_log
from ..routers.auth_router import get_user_primary_tenant, require_auth, require_tenant_permission
from ..services.module_settings import MODULES, get_settings, save_settings, spec

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/module-settings", tags=["Module Settings"])


def _check(module_key: str, action: str, request: Request, token: Optional[str],
           authorization: Optional[str], db: Session) -> Dict[str, Any]:
    """The module's own permission for this action, or 403/404."""
    try:
        module = spec(module_key)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    permission = (module.get("permissions") or {}).get(action)
    if not permission:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    require_tenant_permission(permission)(request=request, token=token, authorization=authorization, db=db)
    return module


def _tenant(current_user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User has no tenant assigned")
    return tenant_id


@router.get("")
def list_modules(current_user: GRCUser = Depends(require_auth)):
    """The modules whose settings can be edited here."""
    return {"modules": [{"key": key, "label": value["label"], "record": value["record"],
                         "sections": list(value.get("sections") or ())}
                        for key, value in MODULES.items()]}


@router.get("/{module_key}")
def read_settings(
    module_key: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _check(module_key, "view", request, token, authorization, db)
    return get_settings(db, _tenant(current_user, db), module_key)


@router.get("/{module_key}/people")
def list_people(
    module_key: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Who a "person" field can name: active users, for anyone who sees the form."""
    _check(module_key, "view", request, token, authorization, db)
    users = (db.query(GRCUser).filter(GRCUser.is_active.is_(True))
             .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc()).all())
    return [{"id": u.id, "display_name": u.display_name or u.username} for u in users]


@router.put("/{module_key}")
def write_settings(
    module_key: str,
    request: Request,
    patch: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Save whole sections: `statuses`, `sla`, `fields`, `lists`. Unknown keys are refused."""
    module = _check(module_key, "edit", request, token, authorization, db)
    tenant_id = _tenant(current_user, db)
    before = get_settings(db, tenant_id, module_key)
    try:
        saved = save_settings(db, tenant_id, module_key, patch, user_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        write_rich_audit_log(
            db, tenant_id=tenant_id, user_id=current_user.id, action="settings_updated",
            resource_type="module_settings", resource_id=None,
            before={k: before.get(k) for k in patch}, after={k: saved.get(k) for k in patch},
            summary=f"{module['label']} settings updated: {', '.join(sorted(patch))}",
            resource_name=module["label"],
        )
    except Exception:
        logger.exception("Could not audit the %s settings change", module_key)
    return saved

"""A module's own settings: its status levels, SLA days and extra fields.

One pair of endpoints serves every module that opts in (see
``services/module_settings.MODULES``), so a new module needs a defaults block and
nothing else here.
"""
import logging
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..models import GRCUser, get_db
from ..rich_audit import write_rich_audit_log
from ..routers.auth_router import (
    get_user_primary_tenant, require_auth, require_tenant_permission,
)
from ..services.module_settings import MODULES, get_settings, save_settings, spec

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/module-settings", tags=["Module Settings"])

# Every module served here is gated on these. A module that needs different
# permissions gets its own guard rather than quietly inheriting these.
_VIEW = "compliance:assessments:view"
_EDIT = "compliance:assessments:edit"


def _check_guard(module_key: str, action: str) -> Dict[str, Any]:
    module = spec(module_key)
    expected = {"view": _VIEW, "edit": _EDIT}[action]
    declared = (module.get("permissions") or {}).get(action)
    if declared != expected:
        # Fail loudly rather than serve a module under a permission it did not ask for.
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED,
                            detail=f"{module_key} settings need their own endpoint: it requires {declared}")
    return module


@router.get("")
def list_modules(_: bool = Depends(require_tenant_permission(_VIEW))):
    """The modules whose settings can be edited here."""
    return {"modules": [{"key": key, "label": value["label"], "record": value["record"]}
                        for key, value in MODULES.items()]}


@router.get("/{module_key}")
def read_settings(
    module_key: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission(_VIEW)),
):
    _check_guard(module_key, "view")
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User has no tenant assigned")
    return get_settings(db, tenant_id, module_key)


@router.put("/{module_key}")
def write_settings(
    module_key: str,
    patch: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission(_EDIT)),
):
    """Save whole sections: `statuses`, `sla`, `fields`. Unknown keys are refused."""
    _check_guard(module_key, "edit")
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User has no tenant assigned")
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
            summary=f"{spec(module_key)['label']} settings updated: {', '.join(sorted(patch))}",
            resource_name=spec(module_key)["label"],
        )
    except Exception:
        logger.exception("Could not audit the %s settings change", module_key)
    return saved

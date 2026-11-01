"""Saved views — native conversion of Frappe
`helpdesk/helpdesk/doctype/hd_view/hd_view.py`.

An HD View is a saved list / group_by / kanban view: its filters, columns,
order_by and rows are Frappe `Code` (JSON) fields, stored here as TEXT and
(de)serialized at the edge. CRUD with the controller's guards:

  * validate_default_view  -> one default view per (user, dt)
  * toggle_pinned_public_view (before_save) -> pinned/public mutually exclusive
  * is_standard protection -> standard views can't be edited/deleted by non-admins,
    and `is_standard` is stripped off rows a non-admin creates
    (Frappe gated this on developer_mode/in_migrate/in_install — none of which
    exist at tenant runtime, so the effective rule is "non-admin => not standard")

Tenant scope: HDView.tenant_id; rows resolved WITH the tenant filter (cross-tenant
id -> 404). Admin = Administrator role or tenant primary contact (mirrors
auth_router.require_tenant_permission). Mutations return {"ok": true}; reads never 4xx.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDView, Role, Tenant, UserRole, get_db
from ...routers.auth_router import require_auth
from .common import iso, require_edit, require_view, tenant_id

router = APIRouter()

# Columns the client may set; filters/columns/order_by/rows are JSON-as-text.
_WRITABLE = {
    "label", "icon", "user", "is_default", "is_customer_portal", "type", "dt",
    "route_name", "pinned", "public", "load_default_columns", "group_by_field",
}
_JSON_FIELDS = {"filters", "order_by", "columns", "rows"}


class ViewBody(BaseModel):
    label: Optional[str] = None
    icon: Optional[str] = None
    user: Optional[str] = None
    is_default: Optional[bool] = None
    is_customer_portal: Optional[bool] = None
    is_standard: Optional[bool] = None
    type: Optional[str] = None
    dt: Optional[str] = None
    route_name: Optional[str] = None
    pinned: Optional[bool] = None
    public: Optional[bool] = None
    load_default_columns: Optional[bool] = None
    group_by_field: Optional[str] = None
    filters: Optional[object] = None
    order_by: Optional[object] = None
    columns: Optional[object] = None
    rows: Optional[object] = None


def _is_admin(db: Session, user: GRCUser) -> bool:
    """Administrator role OR tenant primary contact — same test as
    require_tenant_permission's admin bypass."""
    t = db.query(Tenant).first()
    if t and t.primary_contact_email and user.email and t.primary_contact_email.lower() == user.email.lower():
        return True
    role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        return False
    return db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first() is not None


def _loads(txt):
    if txt is None:
        return None
    try:
        return json.loads(txt)
    except (TypeError, ValueError):
        return txt  # tolerate a non-JSON legacy value rather than 500 on read


def _dumps(val) -> Optional[str]:
    if val is None:
        return None
    return val if isinstance(val, str) else json.dumps(val)


def view_row(v: HDView) -> dict:
    return {
        "name": str(v.id),
        "label": v.label,
        "icon": v.icon,
        "user": v.user,
        "is_default": bool(v.is_default),
        "is_customer_portal": bool(v.is_customer_portal),
        "is_standard": bool(v.is_standard),
        "type": v.type,
        "dt": v.dt,
        "route_name": v.route_name,
        "pinned": bool(v.pinned),
        "public": bool(v.public),
        "load_default_columns": bool(v.load_default_columns),
        "group_by_field": v.group_by_field,
        "filters": _loads(v.filters),
        "order_by": _loads(v.order_by),
        "columns": _loads(v.columns),
        "rows": _loads(v.rows),
        "created": iso(v.created_at),
        "modified": iso(v.updated_at),
    }


def _get(db: Session, tid: int, name: str) -> Optional[HDView]:
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return db.query(HDView).filter(HDView.id == pk, HDView.tenant_id == tid).first()


def _validate_default(db: Session, tid: int, user: Optional[str], dt: Optional[str], exclude_id: Optional[int]) -> None:
    """Frappe validate_default_view: only one default per (user, dt)."""
    q = db.query(HDView).filter(
        HDView.tenant_id == tid,
        HDView.is_default.is_(True),
        HDView.user == user,
        HDView.dt == dt,
    )
    if exclude_id is not None:
        q = q.filter(HDView.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=400, detail=f"Only one default view is allowed per user for {dt}")


def _apply(v: HDView, data: dict) -> None:
    for k, val in data.items():
        if k in _JSON_FIELDS:
            setattr(v, k, _dumps(val))
        elif k in _WRITABLE:
            setattr(v, k, val)


def _resolve_pin_public(v: HDView, changed: set) -> None:
    """Frappe toggle_pinned_public_view: pinned & public are mutually exclusive;
    the field the caller just changed wins. On create (both "changed") pinned wins.
    # ponytail: collapses Frappe's two sequential has_value_changed checks to
    #   'the changed one wins, else pinned wins' — same observable result."""
    if v.pinned and v.public:
        if "public" in changed and "pinned" not in changed:
            v.pinned = False
        else:
            v.public = False


# ─── endpoints ─────────────────────────────────────────────────────────────
@router.get("/helpdesk/views")
def list_views(
    dt: Optional[str] = None,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_view),
):
    """Views visible to the caller: their own, plus public and standard ones.
    Optional `dt` filter. 200 + empty on none."""
    tid = tenant_id(db)
    q = db.query(HDView).filter(HDView.tenant_id == tid)
    if dt:
        q = q.filter(HDView.dt == dt)
    q = q.filter(
        (HDView.user == user.email) | HDView.user.is_(None) |
        HDView.public.is_(True) | HDView.is_standard.is_(True)
    )
    return {"views": [view_row(v) for v in q.order_by(HDView.label).all()]}


@router.post("/helpdesk/views")
def create_view(
    body: ViewBody,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_edit),
):
    data = body.model_dump(exclude_none=True)
    tid = tenant_id(db)
    v = HDView(tenant_id=tid)
    v.user = data.get("user") or user.email  # personal view defaults to the creator
    data.pop("user", None)
    # is_standard: non-admins can't mint standard views (Frappe strips it on new rows)
    v.is_standard = bool(data.get("is_standard")) and _is_admin(db, user)
    data.pop("is_standard", None)
    _apply(v, data)
    _resolve_pin_public(v, set(data) | {"pinned", "public"})
    if v.is_default:
        _validate_default(db, tid, v.user, v.dt, None)
    db.add(v)
    db.commit()
    return {"ok": True}


@router.put("/helpdesk/views/{name}")
def update_view(
    name: str,
    body: ViewBody,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_edit),
):
    tid = tenant_id(db)
    v = _get(db, tid, name)
    if not v:
        raise HTTPException(status_code=404, detail="not found")
    if v.is_standard and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Standard Views cannot be edited.")

    data = body.model_dump(exclude_unset=True)
    # Only admins may (re)set the is_standard flag.
    if "is_standard" in data and not _is_admin(db, user):
        data.pop("is_standard")
    changed = set(data) & {"pinned", "public"}
    if "is_standard" in data:
        v.is_standard = bool(data.pop("is_standard"))
    _apply(v, data)
    _resolve_pin_public(v, changed)
    if v.is_default:
        _validate_default(db, tid, v.user, v.dt, v.id)
    db.commit()
    return {"ok": True}


@router.delete("/helpdesk/views/{name}")
def delete_view(
    name: str,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_edit),
):
    v = _get(db, tenant_id(db), name)
    if not v:
        raise HTTPException(status_code=404, detail="not found")
    if v.is_standard and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Standard Views cannot be deleted.")
    db.delete(v)
    db.commit()
    return {"ok": True}

"""Service Catalogue admin CRUD — in-app management (flow #5a).

The catalogue (service categories, business/technical services, the M:N
dependency bridge between them, and request items) was previously maintained
ONLY by re-importing the owner's Excel workbook (`itsm_import.py`). This module
gives an admin the same four tables as ordinary CRUD, so small day-to-day edits
(rename a service, retire a request item, relink a dependency) don't require a
full bundle re-export.

ADDITIVE ONLY: this module does not touch the importer, the ticket engine, SLA,
approvals, or any existing router. It mounts its own router under
`/helpdesk/admin/catalogue`, registered in router.py exactly like the other
native sub-routers.

Idiom (mirrors masters.py / kb.py):
  * Business logic lives in plain functions `fn(db, tid, ...)` so tests call
    them directly without going through HTTP (kb.py's pattern); the
    `@router.*` handlers are thin wrappers that resolve `tid` and the actor.
  * Reads never 4xx on empty — an empty tenant gets an empty list.
  * Retiring a row is reversible (`enabled=False`); nothing here issues a hard
    DELETE except the dependency *link* removal, which drops one bridge row,
    not a catalogue entity.
  * `code` is the workbook's own identifier and stays unique per tenant
    (mirrors the importer's own upsert key, `uq_hd_*_code`); the API enforces
    that same uniqueness at create time with a 409 (the DB index would also
    reject it, but the explicit check gives a clean message instead of an
    IntegrityError).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import (
    HDBusinessService,
    HDCIType,
    HDRequestItem,
    HDServiceCategory,
    HDServiceDependency,
    HDTechnicalService,
    get_db,
)
from .common import iso, require_settings_manage, require_settings_view, tenant_id

router = APIRouter(prefix="/helpdesk/admin/catalogue", tags=["Help Desk Catalogue Admin (native)"])


# ═══════════════════════════════════════════════════════════════════════════
# shared helpers
# ═══════════════════════════════════════════════════════════════════════════
def _dup_code(db: Session, model, tid: int, code: str) -> bool:
    return (
        db.query(model.id)
        .filter(model.tenant_id == tid, model.code == code)
        .first()
        is not None
    )


def _require_category(db: Session, tid: int, category_id: Optional[int]) -> None:
    if category_id is None:
        return
    if not (
        db.query(HDServiceCategory.id)
        .filter(HDServiceCategory.tenant_id == tid, HDServiceCategory.id == category_id)
        .first()
    ):
        raise HTTPException(status_code=400, detail=f"category_id {category_id} does not exist")


def _require_business_service(db: Session, tid: int, business_service_id: Optional[int]) -> None:
    if business_service_id is None:
        return
    if not (
        db.query(HDBusinessService.id)
        .filter(HDBusinessService.tenant_id == tid, HDBusinessService.id == business_service_id)
        .first()
    ):
        raise HTTPException(
            status_code=400, detail=f"business_service_id {business_service_id} does not exist"
        )


def _require_ci_type(db: Session, tid: int, ci_type_id: Optional[int]) -> None:
    if ci_type_id is None:
        return
    if not (
        db.query(HDCIType.id)
        .filter(HDCIType.tenant_id == tid, HDCIType.id == ci_type_id)
        .first()
    ):
        raise HTTPException(
            status_code=400, detail=f"ci_type_id {ci_type_id} does not exist"
        )


# ═══════════════════════════════════════════════════════════════════════════
# service categories
# ═══════════════════════════════════════════════════════════════════════════
class CategoryCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None


def _category_row(c: HDServiceCategory) -> dict:
    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "description": c.description,
        "parent_id": c.parent_id,
        "parent": c.parent.name if c.parent else None,
        "icon": c.icon,
        "sort_order": c.sort_order,
        "enabled": bool(c.enabled),
        "created": iso(c.created_at),
        "modified": iso(c.updated_at),
    }


def _get_category(db: Session, tid: int, cid: int) -> HDServiceCategory:
    row = (
        db.query(HDServiceCategory)
        .filter(HDServiceCategory.id == cid, HDServiceCategory.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="category not found")
    return row


def list_categories(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDServiceCategory)
        .filter(HDServiceCategory.tenant_id == tid)
        .order_by(HDServiceCategory.sort_order.asc().nullslast(), HDServiceCategory.name.asc())
        .all()
    )
    return {"categories": [_category_row(c) for c in rows]}


def create_category(db: Session, tid: int, body: CategoryCreate) -> dict:
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDServiceCategory, tid, code):
        raise HTTPException(status_code=409, detail=f"category code '{code}' already exists")
    _require_category(db, tid, body.parent_id)
    row = HDServiceCategory(
        tenant_id=tid,
        code=code,
        name=body.name,
        description=body.description,
        parent_id=body.parent_id,
        icon=body.icon,
        sort_order=body.sort_order,
        enabled=True if body.enabled is None else body.enabled,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "category": _category_row(row)}


def update_category(db: Session, tid: int, cid: int, body: CategoryUpdate) -> dict:
    row = _get_category(db, tid, cid)
    data = body.model_dump(exclude_unset=True)
    if "parent_id" in data:
        _require_category(db, tid, data["parent_id"])
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "category": _category_row(row)}


def retire_category(db: Session, tid: int, cid: int) -> dict:
    row = _get_category(db, tid, cid)
    row.enabled = False
    db.commit()
    return {"ok": True}


@router.get("/categories")
def r_list_categories(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_categories(db, tenant_id(db))


@router.post("/categories")
def r_create_category(body: CategoryCreate, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    return create_category(db, tenant_id(db), body)


@router.patch("/categories/{cid}")
def r_update_category(cid: int, body: CategoryUpdate, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    return update_category(db, tenant_id(db), cid, body)


@router.post("/categories/{cid}/retire")
def r_retire_category(cid: int, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    return retire_category(db, tenant_id(db), cid)


# ═══════════════════════════════════════════════════════════════════════════
# business services
# ═══════════════════════════════════════════════════════════════════════════
class BusinessServiceCreate(BaseModel):
    code: str
    name: str
    category_id: Optional[int] = None
    description: Optional[str] = None
    criticality: Optional[str] = None
    service_owner_role: Optional[str] = None
    industry_tag: Optional[str] = None
    status: Optional[str] = None
    enabled: Optional[bool] = None


class BusinessServiceUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[int] = None
    description: Optional[str] = None
    criticality: Optional[str] = None
    service_owner_role: Optional[str] = None
    industry_tag: Optional[str] = None
    status: Optional[str] = None
    enabled: Optional[bool] = None


def _business_service_row(s: HDBusinessService) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "category_id": s.category_id,
        "category": s.category.name if s.category else None,
        "description": s.description,
        "criticality": s.criticality,
        "service_owner_role": s.service_owner_role,
        "industry_tag": s.industry_tag,
        "status": s.status,
        "enabled": bool(s.enabled),
        "created": iso(s.created_at),
        "modified": iso(s.updated_at),
    }


def _get_business_service(db: Session, tid: int, sid: int) -> HDBusinessService:
    row = (
        db.query(HDBusinessService)
        .filter(HDBusinessService.id == sid, HDBusinessService.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="business service not found")
    return row


def list_business_services(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDBusinessService)
        .filter(HDBusinessService.tenant_id == tid)
        .order_by(HDBusinessService.name.asc())
        .all()
    )
    return {"services": [_business_service_row(s) for s in rows]}


def create_business_service(db: Session, tid: int, body: BusinessServiceCreate) -> dict:
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDBusinessService, tid, code):
        raise HTTPException(status_code=409, detail=f"service code '{code}' already exists")
    _require_category(db, tid, body.category_id)
    row = HDBusinessService(
        tenant_id=tid,
        code=code,
        name=body.name,
        category_id=body.category_id,
        description=body.description,
        criticality=body.criticality,
        service_owner_role=body.service_owner_role,
        industry_tag=body.industry_tag,
        status=body.status or "active",
        enabled=True if body.enabled is None else body.enabled,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "service": _business_service_row(row)}


def update_business_service(db: Session, tid: int, sid: int, body: BusinessServiceUpdate) -> dict:
    row = _get_business_service(db, tid, sid)
    data = body.model_dump(exclude_unset=True)
    if "category_id" in data:
        _require_category(db, tid, data["category_id"])
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "service": _business_service_row(row)}


def retire_business_service(db: Session, tid: int, sid: int) -> dict:
    row = _get_business_service(db, tid, sid)
    row.enabled = False
    db.commit()
    return {"ok": True}


@router.get("/services")
def r_list_business_services(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_business_services(db, tenant_id(db))


@router.post("/services")
def r_create_business_service(body: BusinessServiceCreate, db: Session = Depends(get_db),
                              _: bool = Depends(require_settings_manage)):
    return create_business_service(db, tenant_id(db), body)


@router.patch("/services/{sid}")
def r_update_business_service(sid: int, body: BusinessServiceUpdate, db: Session = Depends(get_db),
                              _: bool = Depends(require_settings_manage)):
    return update_business_service(db, tenant_id(db), sid, body)


@router.post("/services/{sid}/retire")
def r_retire_business_service(sid: int, db: Session = Depends(get_db),
                              _: bool = Depends(require_settings_manage)):
    return retire_business_service(db, tenant_id(db), sid)


# ═══════════════════════════════════════════════════════════════════════════
# technical services
# ═══════════════════════════════════════════════════════════════════════════
class TechnicalServiceCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    owner_team_id: Optional[int] = None
    status: Optional[str] = None
    enabled: Optional[bool] = None


class TechnicalServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    owner_team_id: Optional[int] = None
    status: Optional[str] = None
    enabled: Optional[bool] = None


def _technical_service_row(t: HDTechnicalService) -> dict:
    return {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "description": t.description,
        "owner_team_id": t.owner_team_id,
        "status": t.status,
        "enabled": bool(t.enabled),
        "created": iso(t.created_at),
        "modified": iso(t.updated_at),
    }


def _get_technical_service(db: Session, tid: int, tyid: int) -> HDTechnicalService:
    row = (
        db.query(HDTechnicalService)
        .filter(HDTechnicalService.id == tyid, HDTechnicalService.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="technical service not found")
    return row


def list_technical_services(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDTechnicalService)
        .filter(HDTechnicalService.tenant_id == tid)
        .order_by(HDTechnicalService.name.asc())
        .all()
    )
    return {"technical": [_technical_service_row(t) for t in rows]}


def create_technical_service(db: Session, tid: int, body: TechnicalServiceCreate) -> dict:
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDTechnicalService, tid, code):
        raise HTTPException(status_code=409, detail=f"technical service code '{code}' already exists")
    row = HDTechnicalService(
        tenant_id=tid,
        code=code,
        name=body.name,
        description=body.description,
        owner_team_id=body.owner_team_id,
        status=body.status or "active",
        enabled=True if body.enabled is None else body.enabled,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "technical": _technical_service_row(row)}


def update_technical_service(db: Session, tid: int, tyid: int, body: TechnicalServiceUpdate) -> dict:
    row = _get_technical_service(db, tid, tyid)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "technical": _technical_service_row(row)}


def retire_technical_service(db: Session, tid: int, tyid: int) -> dict:
    row = _get_technical_service(db, tid, tyid)
    row.enabled = False
    db.commit()
    return {"ok": True}


@router.get("/technical")
def r_list_technical_services(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_technical_services(db, tenant_id(db))


@router.post("/technical")
def r_create_technical_service(body: TechnicalServiceCreate, db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_manage)):
    return create_technical_service(db, tenant_id(db), body)


@router.patch("/technical/{tyid}")
def r_update_technical_service(tyid: int, body: TechnicalServiceUpdate, db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_manage)):
    return update_technical_service(db, tenant_id(db), tyid, body)


@router.post("/technical/{tyid}/retire")
def r_retire_technical_service(tyid: int, db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_manage)):
    return retire_technical_service(db, tenant_id(db), tyid)


# ═══════════════════════════════════════════════════════════════════════════
# dependencies (M:N business service <-> technical service)
# ═══════════════════════════════════════════════════════════════════════════
class DependencyCreate(BaseModel):
    technical_service_id: int
    criticality: Optional[str] = None


def _dependency_row(d: HDServiceDependency) -> dict:
    return {
        "technical_service_id": d.technical_service_id,
        "technical_service": d.technical_service.name if d.technical_service else None,
        "technical_service_code": d.technical_service.code if d.technical_service else None,
        "criticality": d.criticality,
    }


def list_dependencies(db: Session, tid: int, sid: int) -> dict:
    # tenant-scope through the parent business service (dependency rows carry no tenant_id)
    _get_business_service(db, tid, sid)
    rows = (
        db.query(HDServiceDependency)
        .filter(HDServiceDependency.business_service_id == sid)
        .all()
    )
    return {"dependencies": [_dependency_row(d) for d in rows]}


def add_dependency(db: Session, tid: int, sid: int, body: DependencyCreate) -> dict:
    _get_business_service(db, tid, sid)
    tech = (
        db.query(HDTechnicalService)
        .filter(HDTechnicalService.id == body.technical_service_id, HDTechnicalService.tenant_id == tid)
        .first()
    )
    if not tech:
        raise HTTPException(
            status_code=400,
            detail=f"technical_service_id {body.technical_service_id} does not exist",
        )
    existing = (
        db.query(HDServiceDependency)
        .filter(
            HDServiceDependency.business_service_id == sid,
            HDServiceDependency.technical_service_id == tech.id,
        )
        .first()
    )
    if existing:
        # idempotent — a criticality change on re-add still applies
        if body.criticality is not None:
            existing.criticality = body.criticality
            db.commit()
        return {"ok": True, "dependency": _dependency_row(existing)}
    row = HDServiceDependency(
        business_service_id=sid,
        technical_service_id=tech.id,
        criticality=body.criticality,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "dependency": _dependency_row(row)}


def remove_dependency(db: Session, tid: int, sid: int, tech_id: int) -> dict:
    _get_business_service(db, tid, sid)
    row = (
        db.query(HDServiceDependency)
        .filter(
            HDServiceDependency.business_service_id == sid,
            HDServiceDependency.technical_service_id == tech_id,
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.get("/services/{sid}/dependencies")
def r_list_dependencies(sid: int, db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_dependencies(db, tenant_id(db), sid)


@router.post("/services/{sid}/dependencies")
def r_add_dependency(sid: int, body: DependencyCreate, db: Session = Depends(get_db),
                     _: bool = Depends(require_settings_manage)):
    return add_dependency(db, tenant_id(db), sid, body)


@router.delete("/services/{sid}/dependencies/{tech_id}")
def r_remove_dependency(sid: int, tech_id: int, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return remove_dependency(db, tenant_id(db), sid, tech_id)


# ═══════════════════════════════════════════════════════════════════════════
# request items
# ═══════════════════════════════════════════════════════════════════════════
class RequestItemCreate(BaseModel):
    code: str
    name: str
    business_service_id: Optional[int] = None
    category_id: Optional[int] = None
    ci_type_id: Optional[int] = None
    description: Optional[str] = None
    approval_required: Optional[bool] = None
    approver_role: Optional[str] = None
    fulfilment_team_id: Optional[int] = None
    sla_hours: Optional[float] = None
    cost: Optional[float] = None
    template_id: Optional[int] = None
    enabled: Optional[bool] = None


class RequestItemUpdate(BaseModel):
    name: Optional[str] = None
    business_service_id: Optional[int] = None
    category_id: Optional[int] = None
    ci_type_id: Optional[int] = None
    description: Optional[str] = None
    approval_required: Optional[bool] = None
    approver_role: Optional[str] = None
    fulfilment_team_id: Optional[int] = None
    sla_hours: Optional[float] = None
    cost: Optional[float] = None
    template_id: Optional[int] = None
    enabled: Optional[bool] = None


def _request_item_row(r: HDRequestItem) -> dict:
    return {
        "id": r.id,
        "code": r.code,
        "name": r.name,
        "business_service_id": r.business_service_id,
        "business_service": r.business_service.name if r.business_service else None,
        "category_id": r.category_id,
        "category": r.category.name if r.category else None,
        "ci_type_id": r.ci_type_id,
        "ci_type": r.ci_type.name if r.ci_type else None,
        "description": r.description,
        "approval_required": bool(r.approval_required),
        "approver_role": r.approver_role,
        "fulfilment_team_id": r.fulfilment_team_id,
        "sla_hours": r.sla_hours,
        "cost": r.cost,
        "template_id": r.template_id,
        "enabled": bool(r.enabled),
        "created": iso(r.created_at),
        "modified": iso(r.updated_at),
    }


def _get_request_item(db: Session, tid: int, rid: int) -> HDRequestItem:
    row = (
        db.query(HDRequestItem)
        .filter(HDRequestItem.id == rid, HDRequestItem.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="request item not found")
    return row


def list_request_items(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDRequestItem)
        .filter(HDRequestItem.tenant_id == tid)
        .order_by(HDRequestItem.name.asc())
        .all()
    )
    return {"requests": [_request_item_row(r) for r in rows]}


def create_request_item(db: Session, tid: int, body: RequestItemCreate) -> dict:
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDRequestItem, tid, code):
        raise HTTPException(status_code=409, detail=f"request item code '{code}' already exists")
    _require_business_service(db, tid, body.business_service_id)
    _require_category(db, tid, body.category_id)
    _require_ci_type(db, tid, body.ci_type_id)
    row = HDRequestItem(
        tenant_id=tid,
        code=code,
        name=body.name,
        business_service_id=body.business_service_id,
        category_id=body.category_id,
        ci_type_id=body.ci_type_id,
        description=body.description,
        approval_required=bool(body.approval_required),
        approver_role=body.approver_role,
        fulfilment_team_id=body.fulfilment_team_id,
        sla_hours=body.sla_hours,
        cost=body.cost,
        template_id=body.template_id,
        enabled=True if body.enabled is None else body.enabled,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "request": _request_item_row(row)}


def update_request_item(db: Session, tid: int, rid: int, body: RequestItemUpdate) -> dict:
    row = _get_request_item(db, tid, rid)
    data = body.model_dump(exclude_unset=True)
    if "business_service_id" in data:
        _require_business_service(db, tid, data["business_service_id"])
    if "category_id" in data:
        _require_category(db, tid, data["category_id"])
    if "ci_type_id" in data:
        _require_ci_type(db, tid, data["ci_type_id"])
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "request": _request_item_row(row)}


def retire_request_item(db: Session, tid: int, rid: int) -> dict:
    row = _get_request_item(db, tid, rid)
    row.enabled = False
    db.commit()
    return {"ok": True}


@router.get("/requests")
def r_list_request_items(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_request_items(db, tenant_id(db))


@router.post("/requests")
def r_create_request_item(body: RequestItemCreate, db: Session = Depends(get_db),
                          _: bool = Depends(require_settings_manage)):
    return create_request_item(db, tenant_id(db), body)


@router.patch("/requests/{rid}")
def r_update_request_item(rid: int, body: RequestItemUpdate, db: Session = Depends(get_db),
                          _: bool = Depends(require_settings_manage)):
    return update_request_item(db, tenant_id(db), rid, body)


@router.post("/requests/{rid}/retire")
def r_retire_request_item(rid: int, db: Session = Depends(get_db),
                          _: bool = Depends(require_settings_manage)):
    return retire_request_item(db, tenant_id(db), rid)

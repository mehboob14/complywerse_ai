"""CMDB admin CRUD — flow #5b.

In-app management of the configuration-management database: CI Types, CI
Attribute definitions, Configuration Items, Relationship Types and the CI
relationship graph (source -> target, typed edge) that the React Flow map
renders.

Tenant-scoped throughout (same convention as masters.py / kb.py): every query
filters on `tenant_id(db)`, a cross-tenant id looks exactly like a missing id
(404), and `code` uniqueness is per-tenant. Reads are gated
`require_settings_view`; writes are gated `require_settings_manage` (same
settings:* segregation-of-duties group documented in common.py — CMDB
structure is config, not a ticket-queue action).

MODEL NOTE — CI Type "retire": HDCIType (grc/models/_62_helpdesk_itsm_models.py)
has no `enabled`/`status` column, so there is no soft-retire to flip. Instead
this module exposes a hard `DELETE /types/{id}` guarded the same way a soft
retire would be: if any CI still references the type, the delete is refused
(409) rather than orphaning those CIs. That guard is the "don't orphan"
invariant the spec asks for; CIs themselves still soft-retire via
`status="retired"` (reversible), since HDConfigurationItem *does* carry
`status`.

Idempotent relationship add: HDCIRelationship has a unique
(source_ci_id, target_ci_id, rel_type_id) constraint, so POST /relationships
checks for an existing row with that exact triple first and returns it instead
of racing the DB constraint.
"""
from __future__ import annotations

import json
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import (
    get_db,
    HDBusinessService,
    HDCIAttribute,
    HDCIRelationship,
    HDCIRelationshipType,
    HDCIType,
    HDConfigurationItem,
    HDTicket,
)
from .common import iso, require_settings_manage, require_settings_view, tenant_id

# Tree edges the CMDB walks for impact/exposure roll-up: a domain CONTAINS its
# endpoints; software is INSTALLED on its host. "Child of X" is therefore the
# target of a REL-CONTAINS edge from X, or the source of a REL-INSTALLED edge to
# X — identical to the parent_of mapping list_cis builds.
_CONTAINMENT_REL_CODES = ("REL-CONTAINS", "REL-INSTALLED")

router = APIRouter(prefix="/helpdesk/admin/cmdb")

RETIRED = "retired"


# ═══════════════════════════════════════════════════════════════════════════
# shared helpers
# ═══════════════════════════════════════════════════════════════════════════
def _dup_code(db: Session, model, tid: int, code: str, exclude_id: Optional[int] = None) -> bool:
    q = db.query(model).filter(model.tenant_id == tid, model.code == code)
    if exclude_id is not None:
        q = q.filter(model.id != exclude_id)
    return q.first() is not None


def _get_or_404(db: Session, model, tid: int, obj_id: int):
    row = db.query(model).filter(model.id == obj_id, model.tenant_id == tid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _resolve_ci_type(db: Session, tid: int, ci_type_id: Optional[int]) -> Optional[HDCIType]:
    if ci_type_id is None:
        return None
    row = db.query(HDCIType).filter(HDCIType.id == ci_type_id, HDCIType.tenant_id == tid).first()
    if not row:
        raise HTTPException(status_code=400, detail="ci_type_id does not exist in this tenant")
    return row


def _resolve_business_service(db: Session, tid: int, business_service_id: Optional[int]):
    if business_service_id is None:
        return None
    row = (
        db.query(HDBusinessService)
        .filter(HDBusinessService.id == business_service_id, HDBusinessService.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail="business_service_id does not exist in this tenant")
    return row


def _get_ci_in_tenant(db: Session, tid: int, ci_id: int) -> HDConfigurationItem:
    row = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.id == ci_id, HDConfigurationItem.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail=f"CI {ci_id} does not exist in this tenant")
    return row


def _get_rel_type_in_tenant(db: Session, tid: int, rel_type_id: int) -> HDCIRelationshipType:
    row = (
        db.query(HDCIRelationshipType)
        .filter(HDCIRelationshipType.id == rel_type_id, HDCIRelationshipType.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail="rel_type_id does not exist in this tenant")
    return row


def _ci_type_row(t: HDCIType) -> dict:
    return {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "description": t.description,
        "icon": t.icon,
        "parent_id": t.parent_id,
        "parent": {"id": t.parent.id, "code": t.parent.code, "name": t.parent.name} if t.parent else None,
        "created": iso(t.created_at),
        "modified": iso(t.updated_at),
    }


def _attribute_row(a: HDCIAttribute) -> dict:
    return {
        "id": a.id,
        "ci_type_id": a.ci_type_id,
        "idx": a.idx,
        "name": a.name,
        "datatype": a.datatype,
        "required": bool(a.required),
        "options": a.options,
        "created": iso(a.created_at),
        "modified": iso(a.updated_at),
    }


def _ci_row(c: HDConfigurationItem) -> dict:
    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "ci_type_id": c.ci_type_id,
        "ci_type": c.ci_type.name if c.ci_type else None,
        "business_service_id": c.business_service_id,
        "business_service": c.business_service.name if c.business_service else None,
        "status": c.status,
        "criticality": c.criticality,
        "environment": c.environment,
        "owner": c.owner,
        "ava_asset_id": c.ava_asset_id,
        "attributes": c.attributes,
        "created": iso(c.created_at),
        "modified": iso(c.updated_at),
    }


def _rel_type_row(r: HDCIRelationshipType) -> dict:
    return {
        "id": r.id,
        "code": r.code,
        "name": r.name,
        "inverse_name": r.inverse_name,
        "created": iso(r.created_at),
        "modified": iso(r.updated_at),
    }


def _relationship_row(r: HDCIRelationship) -> dict:
    return {
        "id": r.id,
        "source_ci_id": r.source_ci_id,
        "source_ci": r.source_ci.code if r.source_ci else None,
        "target_ci_id": r.target_ci_id,
        "target_ci": r.target_ci.code if r.target_ci else None,
        "rel_type_id": r.rel_type_id,
        "rel_type": r.rel_type.name if r.rel_type else None,
        "created": iso(r.created_at),
    }


# ═══════════════════════════════════════════════════════════════════════════
# CI Types
# ═══════════════════════════════════════════════════════════════════════════
class CITypeCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    icon: Optional[str] = None


class CITypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None
    icon: Optional[str] = None


@router.get("/types")
def list_ci_types(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    rows = db.query(HDCIType).filter(HDCIType.tenant_id == tid).order_by(HDCIType.name.asc()).all()
    return {"ci_types": [_ci_type_row(t) for t in rows]}


@router.post("/types")
def create_ci_type(body: CITypeCreate, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDCIType, tid, code):
        raise HTTPException(status_code=409, detail=f"CI type with code '{code}' already exists")
    if body.parent_id is not None:
        _resolve_ci_type(db, tid, body.parent_id)
    row = HDCIType(
        tenant_id=tid,
        code=code,
        name=body.name,
        description=body.description,
        parent_id=body.parent_id,
        icon=body.icon,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@router.patch("/types/{type_id}")
def update_ci_type(type_id: int, body: CITypeUpdate, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_or_404(db, HDCIType, tid, type_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        new_code = (data["code"] or "").strip()
        if not new_code:
            raise HTTPException(status_code=400, detail="code is required")
        if _dup_code(db, HDCIType, tid, new_code, exclude_id=row.id):
            raise HTTPException(status_code=409, detail=f"CI type with code '{new_code}' already exists")
        data["code"] = new_code
    if "parent_id" in data and data["parent_id"] is not None:
        if data["parent_id"] == row.id:
            raise HTTPException(status_code=400, detail="a CI type cannot be its own parent")
        _resolve_ci_type(db, tid, data["parent_id"])
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/types/{type_id}")
def delete_ci_type(type_id: int, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_or_404(db, HDCIType, tid, type_id)
    in_use = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.ci_type_id == row.id, HDConfigurationItem.tenant_id == tid)
        .first()
    )
    if in_use:
        raise HTTPException(status_code=409, detail="CI type is in use by one or more CIs")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# CI Attributes (schema definitions per CI type)
# ═══════════════════════════════════════════════════════════════════════════
class AttributeCreate(BaseModel):
    name: str
    datatype: Optional[str] = "string"      # string|int|float|bool|date|enum
    required: Optional[bool] = None
    options: Optional[list] = None
    idx: Optional[int] = None


class AttributeUpdate(BaseModel):
    name: Optional[str] = None
    datatype: Optional[str] = None
    required: Optional[bool] = None
    options: Optional[list] = None
    idx: Optional[int] = None


def _get_attribute(db: Session, tid: int, attribute_id: int) -> HDCIAttribute:
    row = (
        db.query(HDCIAttribute)
        .join(HDCIType, HDCIAttribute.ci_type_id == HDCIType.id)
        .filter(HDCIAttribute.id == attribute_id, HDCIType.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.get("/types/{type_id}/attributes")
def list_ci_attributes(type_id: int, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    _get_or_404(db, HDCIType, tid, type_id)
    rows = (
        db.query(HDCIAttribute)
        .filter(HDCIAttribute.ci_type_id == type_id)
        .order_by(HDCIAttribute.idx.asc().nullslast(), HDCIAttribute.name.asc())
        .all()
    )
    return {"attributes": [_attribute_row(a) for a in rows]}


@router.post("/types/{type_id}/attributes")
def create_ci_attribute(type_id: int, body: AttributeCreate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    _get_or_404(db, HDCIType, tid, type_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if db.query(HDCIAttribute).filter(HDCIAttribute.ci_type_id == type_id,
                                       HDCIAttribute.name == name).first():
        raise HTTPException(status_code=409, detail=f"attribute '{name}' already exists for this type")
    row = HDCIAttribute(
        ci_type_id=type_id,
        name=name,
        datatype=body.datatype or "string",
        required=bool(body.required),
        options=body.options,
        idx=body.idx,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@router.patch("/attributes/{attribute_id}")
def update_ci_attribute(attribute_id: int, body: AttributeUpdate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_attribute(db, tid, attribute_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        new_name = (data["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name is required")
        if db.query(HDCIAttribute).filter(HDCIAttribute.ci_type_id == row.ci_type_id,
                                           HDCIAttribute.name == new_name,
                                           HDCIAttribute.id != row.id).first():
            raise HTTPException(status_code=409, detail=f"attribute '{new_name}' already exists for this type")
        data["name"] = new_name
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/attributes/{attribute_id}")
def delete_ci_attribute(attribute_id: int, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_attribute(db, tid, attribute_id)
    db.delete(row)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# Configuration Items (CIs)
# ═══════════════════════════════════════════════════════════════════════════
class CICreate(BaseModel):
    code: str
    name: str
    ci_type_id: Optional[int] = None
    business_service_id: Optional[int] = None
    status: Optional[str] = None
    criticality: Optional[str] = None
    environment: Optional[str] = None
    owner: Optional[str] = None
    ava_asset_id: Optional[int] = None
    attributes: Optional[dict] = None


class CIUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    ci_type_id: Optional[int] = None
    business_service_id: Optional[int] = None
    status: Optional[str] = None
    criticality: Optional[str] = None
    environment: Optional[str] = None
    owner: Optional[str] = None
    ava_asset_id: Optional[int] = None
    attributes: Optional[dict] = None


def _inventory_derived(c: HDConfigurationItem) -> dict:
    """Derived AVA-inventory fields for a CI row (CMDB inventory-sync surface).

    All read from the sync-owned ``attributes.ava`` mirror; a CI that is not
    managed by inventory sync (no ``ava`` key) reports nulls + managed=False."""
    attrs = c.attributes if isinstance(c.attributes, dict) else {}
    ava = attrs.get("ava") if isinstance(attrs.get("ava"), dict) else None
    if not ava:
        return {
            "source_category": None, "exposure": None, "credentialed": None,
            "pci": None, "internet_facing": None, "managed_by_inventory": False,
            "ci_kind": None, "security": None,
        }
    src = ava.get("source") if isinstance(ava.get("source"), dict) else {}
    net = ava.get("network") if isinstance(ava.get("network"), dict) else {}
    comp = ava.get("compliance") if isinstance(ava.get("compliance"), dict) else {}
    internet_facing = bool(net.get("internet_facing"))
    return {
        "source_category": src.get("category"),
        "exposure": ("external" if internet_facing else "internal"),
        "credentialed": bool(src.get("credentialed")),
        "pci": bool(comp.get("pci")),
        "internet_facing": internet_facing,
        "managed_by_inventory": True,
        "ci_kind": ava.get("kind"),
        # Read-only open-vuln/risk snapshot the sync mirrored (may be None).
        "security": ava.get("security") if isinstance(ava.get("security"), dict) else None,
    }


def ci_ticket_ref(c: HDConfigurationItem) -> dict:
    """The compact CI object a ticket carries (phase-2 §2). Reuses
    ``_inventory_derived`` so exposure/pci/internet_facing/ci_kind are byte-for-byte
    what ``GET /cis`` reports — no duplicated derivation."""
    d = _inventory_derived(c)
    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "ci_type": c.ci_type.name if c.ci_type else None,
        "ci_kind": d["ci_kind"],
        "exposure": d["exposure"],
        "pci": d["pci"],
        "internet_facing": d["internet_facing"],
        "managed_by_inventory": d["managed_by_inventory"],
        "ava_asset_id": c.ava_asset_id,
        "security": d["security"],
    }


def _children_map(db: Session, tid: int) -> dict:
    """parent_ci_id → set(child_ci_id) over the containment edges, tenant-scoped.
    Same edge semantics as ``list_cis`` (domain→endpoint via REL-CONTAINS,
    host→software via REL-INSTALLED)."""
    rel_ids = {
        r.code: r.id
        for r in db.query(HDCIRelationshipType)
        .filter(HDCIRelationshipType.tenant_id == tid,
                HDCIRelationshipType.code.in_(list(_CONTAINMENT_REL_CODES)))
        .all()
    }
    children: dict = {}
    if not rel_ids:
        return children
    contains_id = rel_ids.get("REL-CONTAINS")
    installed_id = rel_ids.get("REL-INSTALLED")
    edges = (
        db.query(HDCIRelationship)
        .join(HDConfigurationItem, HDCIRelationship.source_ci_id == HDConfigurationItem.id)
        .filter(HDConfigurationItem.tenant_id == tid,
                HDCIRelationship.rel_type_id.in_(list(rel_ids.values())))
        .all()
    )
    for e in edges:
        if e.rel_type_id == contains_id:        # domain(source) contains endpoint(target)
            children.setdefault(e.source_ci_id, set()).add(e.target_ci_id)
        elif e.rel_type_id == installed_id:     # software(source) installed on host(target)
            children.setdefault(e.target_ci_id, set()).add(e.source_ci_id)
    return children


def descendant_ci_ids(db: Session, tid: int, root_id: int) -> set:
    """`root_id` plus every CI contained under it (recursively, cycle-safe) via the
    REL-CONTAINS / REL-INSTALLED tree. Used by the CI→tickets impact view and the
    exposure roll-up."""
    children = _children_map(db, tid)
    seen = {root_id}
    stack = [root_id]
    while stack:
        cur = stack.pop()
        for ch in children.get(cur, ()):
            if ch not in seen:
                seen.add(ch)
                stack.append(ch)
    return seen


def ci_exposure_flags(db: Session, tid: int, ci_id: Optional[int]) -> Optional[dict]:
    """``internet_facing`` / ``pci`` aggregated over a CI AND all its descendants
    (so a domain CI inherits the exposure of any endpoint under it). None when
    ``ci_id`` is falsy or the CI is not in this tenant. Reuses ``_inventory_derived``
    so the flags match ``GET /cis`` exactly."""
    if not ci_id:
        return None
    root = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.id == ci_id, HDConfigurationItem.tenant_id == tid)
        .first()
    )
    if root is None:
        return None
    ids = descendant_ci_ids(db, tid, ci_id)
    cis = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.tenant_id == tid, HDConfigurationItem.id.in_(ids))
        .all()
    )
    internet = pci = False
    for c in cis:
        d = _inventory_derived(c)
        internet = internet or bool(d["internet_facing"])
        pci = pci or bool(d["pci"])
    return {"internet_facing": internet, "pci": pci}


@router.get("/cis")
def list_cis(ci_type_id: Optional[int] = Query(None), business_service_id: Optional[int] = Query(None),
             # Plain None defaults (not Query(...)) so the router function is also
             # safely callable directly in unit tests; FastAPI still serves these
             # as optional query params.
             #   source_category: easm|credential|uncredential|manual|none
             #   exposure: external|internal
             #   top_level: true → roots only (domains + internal hosts + manual +
             #     standalone); false → children only (endpoints, software), each
             #     carrying parent_ci_id; absent → all.
             source_category: Optional[str] = None,
             exposure: Optional[str] = None,
             top_level: Optional[bool] = None,
             db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    q = db.query(HDConfigurationItem).filter(HDConfigurationItem.tenant_id == tid)
    if ci_type_id is not None:
        q = q.filter(HDConfigurationItem.ci_type_id == ci_type_id)
    if business_service_id is not None:
        q = q.filter(HDConfigurationItem.business_service_id == business_service_id)
    rows = q.order_by(HDConfigurationItem.code.asc()).all()

    # Batched parent/child computation (one relationship query, no N+1). Tree
    # edges: domain —REL-CONTAINS→ endpoint; software —REL-INSTALLED→ host.
    rel_ids = {
        r.code: r.id
        for r in db.query(HDCIRelationshipType)
        .filter(HDCIRelationshipType.tenant_id == tid,
                HDCIRelationshipType.code.in_(["REL-CONTAINS", "REL-INSTALLED"]))
        .all()
    }
    parent_of: dict = {}
    child_count: dict = {}
    if rel_ids:
        edges = (
            db.query(HDCIRelationship)
            .join(HDConfigurationItem, HDCIRelationship.source_ci_id == HDConfigurationItem.id)
            .filter(HDConfigurationItem.tenant_id == tid,
                    HDCIRelationship.rel_type_id.in_(list(rel_ids.values())))
            .all()
        )
        contains_id = rel_ids.get("REL-CONTAINS")
        installed_id = rel_ids.get("REL-INSTALLED")
        for e in edges:
            if e.rel_type_id == contains_id:        # domain(source) contains endpoint(target)
                parent_of[e.target_ci_id] = e.source_ci_id
                child_count[e.source_ci_id] = child_count.get(e.source_ci_id, 0) + 1
            elif e.rel_type_id == installed_id:     # software(source) installed on host(target)
                parent_of[e.source_ci_id] = e.target_ci_id
                child_count[e.target_ci_id] = child_count.get(e.target_ci_id, 0) + 1

    out = []
    for c in rows:
        derived = _inventory_derived(c)
        if source_category is not None:
            # inventory CI → easm|credential|uncredential|manual; non-inventory → none
            effective = derived["source_category"] or "none"
            if effective != source_category:
                continue
        if exposure is not None and derived["exposure"] != exposure:
            continue
        if top_level is True and parent_of.get(c.id) is not None:
            continue   # only roots (no containing parent)
        if top_level is False and parent_of.get(c.id) is None:
            continue   # only children (have a containing parent)
        row = _ci_row(c)
        row.update(derived)
        row["parent_ci_id"] = parent_of.get(c.id)
        row["child_count"] = child_count.get(c.id, 0)
        out.append(row)
    return {"cis": out}


@router.post("/cis")
def create_ci(body: CICreate, db: Session = Depends(get_db),
              _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDConfigurationItem, tid, code):
        raise HTTPException(status_code=409, detail=f"CI with code '{code}' already exists")
    _resolve_ci_type(db, tid, body.ci_type_id)
    _resolve_business_service(db, tid, body.business_service_id)
    row = HDConfigurationItem(
        tenant_id=tid,
        code=code,
        name=body.name,
        ci_type_id=body.ci_type_id,
        business_service_id=body.business_service_id,
        status=body.status or "in_use",
        criticality=body.criticality,
        environment=body.environment,
        owner=body.owner,
        ava_asset_id=body.ava_asset_id,
        attributes=body.attributes,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


# ═══════════════════════════════════════════════════════════════════════════
# AI enrichment — "type the name, AI fills the rest"
# ═══════════════════════════════════════════════════════════════════════════
class CIEnrichBody(BaseModel):
    name: str
    ci_type_id: Optional[int] = None
    hint: Optional[str] = None  # optional free-text the user can add ("prod DB in eu-west")


_CRITICALITY = {"critical", "high", "medium", "low"}
_ENVIRONMENT = {"prod", "staging", "dev", "test", "dr"}


def _slug_code(name: str) -> str:
    base = "".join(ch if ch.isalnum() else "-" for ch in (name or "").upper()).strip("-")
    while "--" in base:
        base = base.replace("--", "-")
    return (base or "CI")[:40]


@router.post("/cis/ai-suggest")
def ai_suggest_ci(body: CIEnrichBody, db: Session = Depends(get_db),
                  _: bool = Depends(require_settings_manage)):
    """Given just a CI name (and optionally a chosen type), ask the LLM to fill in
    the rest of the record: the best CI type (when none is chosen), criticality,
    environment, owner role, a short description, a suggested code, and a value for
    every attribute the chosen type defines. Fail-open: when AI is not configured
    the caller still gets a usable skeleton (``ai_used: false``) so the form works.

    Anti-hallucination: the attribute value map is constrained to the chosen type's
    *defined* attribute names, enum attributes are clamped to their option list, and
    criticality/environment are clamped to the allowed vocab. Returns suggestions
    only — nothing is written; the user reviews and saves via POST /cis."""
    tid = tenant_id(db)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required for AI enrichment")

    types = db.query(HDCIType).filter(HDCIType.tenant_id == tid).order_by(HDCIType.name.asc()).all()
    type_menu = [{"id": t.id, "code": t.code, "name": t.name,
                  "description": t.description} for t in types]

    chosen: Optional[HDCIType] = None
    if body.ci_type_id is not None:
        chosen = _resolve_ci_type(db, tid, body.ci_type_id)
    attrs: List[HDCIAttribute] = []
    if chosen is not None:
        attrs = (db.query(HDCIAttribute)
                 .filter(HDCIAttribute.ci_type_id == chosen.id)
                 .order_by(HDCIAttribute.idx.asc()).all())
    attr_spec = [{"name": a.name, "datatype": a.datatype,
                  "required": bool(a.required), "options": a.options} for a in attrs]
    allowed_attr_names = {a.name for a in attrs}

    skeleton = {
        "ai_used": False,
        "ci_type_id": chosen.id if chosen else None,
        "ci_type": chosen.name if chosen else None,
        "suggested_code": _slug_code(name),
        "criticality": None,
        "environment": None,
        "owner": None,
        "description": None,
        "attributes": {},
    }

    try:
        from grc.services.openai_client import check_ai_available
        if not check_ai_available():
            skeleton["error"] = "AI is not configured on this environment"
            return skeleton
    except Exception as e:  # noqa: BLE001
        skeleton["error"] = f"AI unavailable: {e}"
        return skeleton

    sys_prompt = (
        "You enrich IT Configuration Item (CMDB) records for an ITSM system. "
        "Given a CI name you infer sensible, realistic metadata. "
        "Reply with STRICT JSON only — no prose, no markdown fences. "
        "Never invent attribute keys that are not asked for. When you are unsure of "
        "a value use null rather than guessing a specific fact (hostnames, IPs, serials)."
    )
    user_parts = [f'Configuration item name: "{name}".']
    if body.hint:
        user_parts.append(f"Extra context from the user: {body.hint}")
    if chosen is not None:
        user_parts.append(f'The CI type is already chosen: "{chosen.name}" (code {chosen.code}).'
                          + (f" Type description: {chosen.description}" if chosen.description else ""))
        if attr_spec:
            user_parts.append(
                "Provide a value for each of these attributes. If an attribute lists "
                "options, you MUST pick one of them. Use null when you cannot infer a "
                "concrete value. Attributes:\n" + json.dumps(attr_spec, ensure_ascii=False))
    else:
        user_parts.append("Choose the single best CI type for this item from this list and "
                          "return its numeric id as ci_type_id:\n"
                          + json.dumps(type_menu, ensure_ascii=False))
    user_parts.append(
        'Also return: "criticality" (one of critical|high|medium|low), '
        '"environment" (one of prod|staging|dev|test|dr), "owner" (a team/role name, '
        'not a person), "description" (one concise sentence), and "suggested_code" '
        "(SHORT-UPPERCASE-HYPHENATED, derived from the name).")
    schema = ('{"ci_type_id": <id or null>, "criticality": "...", "environment": "...", '
              '"owner": "...", "description": "...", "suggested_code": "...", '
              '"attributes": {"<attribute name>": <value or null>}}')
    user_parts.append("Return STRICT JSON exactly in this shape: " + schema)

    try:
        from grc.services.openai_client import get_openai_client
        client = get_openai_client()
        model = os.environ.get("COMPLYVERSE_AI_MODEL", "gpt-4o-mini")
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": sys_prompt},
                      {"role": "user", "content": "\n\n".join(user_parts)}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:  # noqa: BLE001
        skeleton["error"] = f"AI call failed: {e}"
        return skeleton

    # ---- sanitize the model output back onto the real schema --------------
    out = dict(skeleton)
    out["ai_used"] = True
    out.pop("error", None)

    # CI type: only accept a suggested type when none was pre-chosen, and only
    # if it is a real id in this tenant.
    if chosen is None:
        sugg_type_id = data.get("ci_type_id")
        if isinstance(sugg_type_id, int):
            match = next((t for t in types if t.id == sugg_type_id), None)
            if match:
                out["ci_type_id"] = match.id
                out["ci_type"] = match.name

    crit = str(data.get("criticality") or "").strip().lower()
    out["criticality"] = crit if crit in _CRITICALITY else None
    env = str(data.get("environment") or "").strip().lower()
    out["environment"] = env if env in _ENVIRONMENT else None
    owner = data.get("owner")
    out["owner"] = str(owner).strip() if owner else None
    desc = data.get("description")
    out["description"] = str(desc).strip() if desc else None
    code = str(data.get("suggested_code") or "").strip().upper()
    out["suggested_code"] = _slug_code(code) if code else _slug_code(name)

    # attributes: keep only defined keys; clamp enum attributes to their options.
    opt_by_name = {a.name: a.options for a in attrs if a.options}
    clean_attrs: dict = {}
    for k, v in (data.get("attributes") or {}).items():
        if allowed_attr_names and k not in allowed_attr_names:
            continue
        if v is None:
            clean_attrs[k] = None
            continue
        opts = opt_by_name.get(k)
        if opts and v not in opts:
            # tolerate case / whitespace drift against the option list
            match = next((o for o in opts if str(o).strip().lower() == str(v).strip().lower()), None)
            clean_attrs[k] = match  # None if the model picked an off-list value
        else:
            clean_attrs[k] = v
    out["attributes"] = clean_attrs
    return out


# Fields the inventory sync OWNS on a linked CI — a PATCH may not change them
# (the next sync would overwrite the edit anyway). business_service_id + other
# attribute keys stay user-editable.
_INVENTORY_OWNED_FIELDS = (
    "code", "name", "ci_type_id", "status", "criticality", "environment",
    "owner", "ava_asset_id",
)
_MANAGED_EDIT_MSG = "Managed by inventory sync — edit it in ComplyVerse inventory"


def _is_inventory_managed(row: HDConfigurationItem) -> bool:
    return isinstance(row.attributes, dict) and "ava" in (row.attributes or {})


@router.patch("/cis/{ci_id}")
def update_ci(ci_id: int, body: CIUpdate, db: Session = Depends(get_db),
              _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_or_404(db, HDConfigurationItem, tid, ci_id)
    data = body.model_dump(exclude_unset=True)
    managed = _is_inventory_managed(row)

    # Guard inventory-owned fields on a linked CI: a PATCH that tries to CHANGE
    # any of them is refused (identical values pass through as a no-op).
    if managed:
        for f in _INVENTORY_OWNED_FIELDS:
            if f in data and data[f] != getattr(row, f):
                raise HTTPException(status_code=409, detail=_MANAGED_EDIT_MSG)
        # The sync owns attributes['ava']; never let a client overwrite it.
        if "attributes" in data:
            new_attrs = dict(data["attributes"] or {})
            stored = row.attributes if isinstance(row.attributes, dict) else {}
            if "ava" in stored:
                new_attrs["ava"] = stored["ava"]
            else:
                new_attrs.pop("ava", None)
            data["attributes"] = new_attrs

    if "code" in data:
        new_code = (data["code"] or "").strip()
        if not new_code:
            raise HTTPException(status_code=400, detail="code is required")
        if _dup_code(db, HDConfigurationItem, tid, new_code, exclude_id=row.id):
            raise HTTPException(status_code=409, detail=f"CI with code '{new_code}' already exists")
        data["code"] = new_code
    if "ci_type_id" in data:
        _resolve_ci_type(db, tid, data["ci_type_id"])
    if "business_service_id" in data:
        _resolve_business_service(db, tid, data["business_service_id"])
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


@router.post("/cis/{ci_id}/retire")
def retire_ci(ci_id: int, db: Session = Depends(get_db),
              _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_or_404(db, HDConfigurationItem, tid, ci_id)
    # Inventory-managed CIs are retired/restored only by the sync — a manual
    # retire here would be silently undone on the next run.
    if _is_inventory_managed(row):
        raise HTTPException(status_code=409,
                            detail="Retire it in ComplyVerse inventory; the sync will retire the CI")
    row.status = RETIRED
    db.commit()
    return {"ok": True}


@router.get("/cis/{ci_id}/tickets")
def ci_tickets(ci_id: int, db: Session = Depends(get_db),
               _: bool = Depends(require_settings_view)):
    """Impact view (phase-2 §3): every ticket whose ``ci_id`` is this CI OR any CI
    contained under it (domain→endpoints, host→software; recursive, cycle-safe),
    newest first, with process/status/priority/subject."""
    tid = tenant_id(db)
    _get_or_404(db, HDConfigurationItem, tid, ci_id)
    ids = descendant_ci_ids(db, tid, ci_id)
    rows = (
        db.query(HDTicket)
        .filter(HDTicket.tenant_id == tid, HDTicket.ci_id.in_(ids))
        .order_by(HDTicket.created_at.desc(), HDTicket.id.desc())
        .all()
    )
    return {
        "tickets": [{
            "name": str(t.id),
            "subject": t.subject,
            "process": t.process or "incident",
            "status": t.status.label_agent if t.status else None,
            "priority": (t.priority.name or t.priority.level) if t.priority else None,
            "ci_id": t.ci_id,
            "created": iso(t.created_at),
            "modified": iso(t.updated_at),
        } for t in rows],
    }


# ═══════════════════════════════════════════════════════════════════════════
# Relationship Types
# ═══════════════════════════════════════════════════════════════════════════
class RelTypeCreate(BaseModel):
    code: str
    name: str
    inverse_name: Optional[str] = None


class RelTypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    inverse_name: Optional[str] = None


@router.get("/relationship-types")
def list_relationship_types(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDCIRelationshipType)
        .filter(HDCIRelationshipType.tenant_id == tid)
        .order_by(HDCIRelationshipType.name.asc())
        .all()
    )
    return {"relationship_types": [_rel_type_row(r) for r in rows]}


@router.post("/relationship-types")
def create_relationship_type(body: RelTypeCreate, db: Session = Depends(get_db),
                              _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if _dup_code(db, HDCIRelationshipType, tid, code):
        raise HTTPException(status_code=409, detail=f"relationship type with code '{code}' already exists")
    row = HDCIRelationshipType(tenant_id=tid, code=code, name=body.name, inverse_name=body.inverse_name)
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@router.patch("/relationship-types/{rel_type_id}")
def update_relationship_type(rel_type_id: int, body: RelTypeUpdate, db: Session = Depends(get_db),
                              _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_or_404(db, HDCIRelationshipType, tid, rel_type_id)
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        new_code = (data["code"] or "").strip()
        if not new_code:
            raise HTTPException(status_code=400, detail="code is required")
        if _dup_code(db, HDCIRelationshipType, tid, new_code, exclude_id=row.id):
            raise HTTPException(status_code=409, detail=f"relationship type with code '{new_code}' already exists")
        data["code"] = new_code
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# Relationships (edges)
# ═══════════════════════════════════════════════════════════════════════════
class RelationshipCreate(BaseModel):
    source_ci_id: int
    target_ci_id: int
    rel_type_id: int


def _get_relationship_in_tenant(db: Session, tid: int, relationship_id: int) -> HDCIRelationship:
    row = (
        db.query(HDCIRelationship)
        .join(HDConfigurationItem, HDCIRelationship.source_ci_id == HDConfigurationItem.id)
        .filter(HDCIRelationship.id == relationship_id, HDConfigurationItem.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.get("/relationships")
def list_relationships(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDCIRelationship)
        .join(HDConfigurationItem, HDCIRelationship.source_ci_id == HDConfigurationItem.id)
        .filter(HDConfigurationItem.tenant_id == tid)
        .order_by(HDCIRelationship.id.asc())
        .all()
    )
    return {"relationships": [_relationship_row(r) for r in rows]}


@router.post("/relationships")
def create_relationship(body: RelationshipCreate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    _get_ci_in_tenant(db, tid, body.source_ci_id)
    _get_ci_in_tenant(db, tid, body.target_ci_id)
    _get_rel_type_in_tenant(db, tid, body.rel_type_id)

    existing = (
        db.query(HDCIRelationship)
        .filter(
            HDCIRelationship.source_ci_id == body.source_ci_id,
            HDCIRelationship.target_ci_id == body.target_ci_id,
            HDCIRelationship.rel_type_id == body.rel_type_id,
        )
        .first()
    )
    if existing:
        return {"ok": True, "id": existing.id}

    row = HDCIRelationship(
        source_ci_id=body.source_ci_id,
        target_ci_id=body.target_ci_id,
        rel_type_id=body.rel_type_id,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@router.delete("/relationships/{relationship_id}")
def delete_relationship(relationship_id: int, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    row = _get_relationship_in_tenant(db, tid, relationship_id)
    db.delete(row)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# Graph (tenant-scoped nodes + edges, for the React Flow CMDB map)
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/graph")
def get_graph(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    cis = db.query(HDConfigurationItem).filter(HDConfigurationItem.tenant_id == tid).all()
    nodes = [{
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "ci_type_id": c.ci_type_id,
        "status": c.status,
    } for c in cis]

    rows = (
        db.query(HDCIRelationship)
        .join(HDConfigurationItem, HDCIRelationship.source_ci_id == HDConfigurationItem.id)
        .filter(HDConfigurationItem.tenant_id == tid)
        .all()
    )
    edges = [{
        "id": r.id,
        "source": r.source_ci_id,
        "target": r.target_ci_id,
        "rel_type_id": r.rel_type_id,
        "rel_name": r.rel_type.name if r.rel_type else None,
    } for r in rows]

    return {"nodes": nodes, "edges": edges}

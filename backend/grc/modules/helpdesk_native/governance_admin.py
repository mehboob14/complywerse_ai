"""Governance + org-mapping admin CRUD — flow #5c.

The last admin slice: the ITSM *rules* (priority matrix, SLA targets, change
types, change risk matrix, CAB model, state-machine transitions, incident
category tree) and the org mappings (departments, ROLE-* -> RBAC preset,
GRP-* -> ComplyVerse team) were previously maintained ONLY by re-importing the owner's
Excel workbook. This module exposes the same tables as ordinary tenant-scoped
CRUD so an admin manages them in-app.

ADDITIVE ONLY: it does not touch the importer, the ticket engine, SLA, or any
existing router. It mounts its own router under `/helpdesk/admin/governance`,
registered in router.py like the sibling catalogue_admin / cmdb_admin routers.

Idiom (mirrors catalogue_admin.py / cmdb_admin.py):
  * Business logic lives in plain functions `fn(db, tid, ...)` so tests call
    them directly (no HTTP); the `@router.*` handlers are thin wrappers that
    resolve `tid`.
  * Reads gated `require_settings_view`, writes `require_settings_manage`.
  * A cross-tenant id looks exactly like a missing id (404); a bad FK in a
    body (priority_id, status ids, team_id, parent_id) is a 400; a duplicate
    unique key is a 409.
  * Matrices and the CAB model are UPSERT-BY-NATURAL-KEY: PUT of an existing
    (impact,urgency) / (impact,likelihood) / item cell updates it in place, so
    re-saving a grid never produces a duplicate row.
  * Incident categories and departments are never deleted: `/retire` flips
    `enabled=False` (reversible, keeps historic tickets resolvable).
"""
from __future__ import annotations

import re
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import (
    HDCABConfig,
    HDChangeRiskMatrix,
    HDChangeType,
    HDDepartment,
    HDIncidentCategory,
    HDKPI,
    HDPriorityMatrix,
    HDRoleMap,
    HDSLATarget,
    HDStateTransition,
    HDSupportGroupMap,
    HDTicketPriority,
    HDTicketStatus,
    Team,
    get_db,
)
from .common import iso, require_settings_manage, require_settings_view, tenant_id

router = APIRouter(prefix="/helpdesk/admin/governance", tags=["Help Desk Governance Admin (native)"])

PROCESSES = ("incident", "problem", "change", "service_request")
CATEGORY_LEVELS = ("category", "subcategory", "item")


# ═══════════════════════════════════════════════════════════════════════════
# shared helpers
# ═══════════════════════════════════════════════════════════════════════════
def _get_or_404(db: Session, model, tid: int, obj_id: int, label: str):
    row = db.query(model).filter(model.id == obj_id, model.tenant_id == tid).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return row


def _req_text(value: Optional[str], field: str) -> str:
    v = (value or "").strip()
    if not v:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    return v


def _check_process(process: Optional[str]) -> str:
    p = (process or "").strip()
    if p not in PROCESSES:
        raise HTTPException(
            status_code=400, detail=f"process must be one of {', '.join(PROCESSES)}"
        )
    return p


def _check_minutes(value: Optional[int], field: str) -> None:
    if value is not None and value < 0:
        raise HTTPException(status_code=400, detail=f"{field} must be >= 0")


def _require_team(db: Session, tid: int, team_id: Optional[int], field: str = "team_id") -> None:
    if team_id is None:
        return
    if not (
        db.query(Team.id).filter(Team.id == team_id, Team.tenant_id == tid).first()
    ):
        raise HTTPException(status_code=400, detail=f"{field} {team_id} does not exist")


def _require_priority(db: Session, tid: int, priority_id: int) -> HDTicketPriority:
    row = (
        db.query(HDTicketPriority)
        .filter(HDTicketPriority.id == priority_id, HDTicketPriority.tenant_id == tid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail=f"priority_id {priority_id} does not exist")
    return row


def _require_status(db: Session, tid: int, status_id: int, field: str) -> None:
    if not (
        db.query(HDTicketStatus.id)
        .filter(HDTicketStatus.id == status_id, HDTicketStatus.tenant_id == tid)
        .first()
    ):
        raise HTTPException(status_code=400, detail=f"{field} {status_id} does not exist")


# ═══════════════════════════════════════════════════════════════════════════
# priority matrix  (impact x urgency -> priority)
# ═══════════════════════════════════════════════════════════════════════════
class PriorityMatrixPut(BaseModel):
    impact: str
    urgency: str
    priority_id: int


def _priority_cell_row(c: HDPriorityMatrix) -> dict:
    return {
        "id": c.id,
        "impact": c.impact,
        "urgency": c.urgency,
        "priority_id": c.priority_id,
        "priority": (c.priority.name or c.priority.level) if c.priority else None,
        "priority_code": c.priority.code if c.priority else None,
        "modified": iso(c.updated_at),
    }


def list_priority_matrix(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDPriorityMatrix)
        .filter(HDPriorityMatrix.tenant_id == tid)
        .order_by(HDPriorityMatrix.impact.asc(), HDPriorityMatrix.urgency.asc())
        .all()
    )
    return {"cells": [_priority_cell_row(c) for c in rows]}


def put_priority_cell(db: Session, tid: int, body: PriorityMatrixPut) -> dict:
    impact = _req_text(body.impact, "impact")
    urgency = _req_text(body.urgency, "urgency")
    _require_priority(db, tid, body.priority_id)
    row = (
        db.query(HDPriorityMatrix)
        .filter(
            HDPriorityMatrix.tenant_id == tid,
            HDPriorityMatrix.impact == impact,
            HDPriorityMatrix.urgency == urgency,
        )
        .first()
    )
    created = row is None
    if created:
        row = HDPriorityMatrix(tenant_id=tid, impact=impact, urgency=urgency,
                               priority_id=body.priority_id)
        db.add(row)
    else:
        row.priority_id = body.priority_id
    db.commit()
    return {"ok": True, "created": created, "cell": _priority_cell_row(row)}


def delete_priority_cell(db: Session, tid: int, cid: int) -> dict:
    row = _get_or_404(db, HDPriorityMatrix, tid, cid, "priority matrix cell")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/priority-matrix")
def r_list_priority_matrix(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_priority_matrix(db, tenant_id(db))


@router.put("/priority-matrix")
def r_put_priority_cell(body: PriorityMatrixPut, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return put_priority_cell(db, tenant_id(db), body)


@router.delete("/priority-matrix/{cid}")
def r_delete_priority_cell(cid: int, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    return delete_priority_cell(db, tenant_id(db), cid)


# ═══════════════════════════════════════════════════════════════════════════
# SLA targets
# ═══════════════════════════════════════════════════════════════════════════
class SLATargetCreate(BaseModel):
    process: str
    priority_label: str
    priority_code: Optional[str] = None
    service_window: Optional[str] = None
    response_minutes: Optional[int] = None
    resolution_minutes: Optional[int] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class SLATargetUpdate(BaseModel):
    process: Optional[str] = None
    priority_label: Optional[str] = None
    priority_code: Optional[str] = None
    service_window: Optional[str] = None
    response_minutes: Optional[int] = None
    resolution_minutes: Optional[int] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


def _sla_row(s: HDSLATarget) -> dict:
    return {
        "id": s.id,
        "process": s.process,
        "priority_label": s.priority_label,
        "priority_code": s.priority_code,
        "service_window": s.service_window,
        "response_minutes": s.response_minutes,
        "resolution_minutes": s.resolution_minutes,
        "notes": s.notes,
        "sort_order": s.sort_order,
        "created": iso(s.created_at),
        "modified": iso(s.updated_at),
    }


def _sla_dup(db: Session, tid: int, process: str, label: str, window: Optional[str],
             exclude_id: Optional[int] = None) -> bool:
    q = db.query(HDSLATarget.id).filter(
        HDSLATarget.tenant_id == tid,
        HDSLATarget.process == process,
        HDSLATarget.priority_label == label,
    )
    # SQL `= NULL` never matches, so a null window needs an explicit IS NULL.
    q = q.filter(HDSLATarget.service_window.is_(None) if window is None
                 else HDSLATarget.service_window == window)
    if exclude_id is not None:
        q = q.filter(HDSLATarget.id != exclude_id)
    return q.first() is not None


def list_sla_targets(db: Session, tid: int, process: Optional[str] = None) -> dict:
    q = db.query(HDSLATarget).filter(HDSLATarget.tenant_id == tid)
    if process:
        q = q.filter(HDSLATarget.process == process)
    rows = q.order_by(HDSLATarget.process.asc(), HDSLATarget.sort_order.asc().nullslast(),
                      HDSLATarget.priority_label.asc()).all()
    return {"targets": [_sla_row(s) for s in rows]}


def create_sla_target(db: Session, tid: int, body: SLATargetCreate) -> dict:
    process = _check_process(body.process)
    label = _req_text(body.priority_label, "priority_label")
    _check_minutes(body.response_minutes, "response_minutes")
    _check_minutes(body.resolution_minutes, "resolution_minutes")
    if _sla_dup(db, tid, process, label, body.service_window):
        raise HTTPException(
            status_code=409,
            detail=f"SLA target for {process}/{label}/{body.service_window or '-'} already exists",
        )
    row = HDSLATarget(
        tenant_id=tid, process=process, priority_label=label,
        priority_code=body.priority_code, service_window=body.service_window,
        response_minutes=body.response_minutes, resolution_minutes=body.resolution_minutes,
        notes=body.notes, sort_order=body.sort_order,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "target": _sla_row(row)}


def update_sla_target(db: Session, tid: int, sid: int, body: SLATargetUpdate) -> dict:
    row = _get_or_404(db, HDSLATarget, tid, sid, "SLA target")
    data = body.model_dump(exclude_unset=True)
    if "process" in data:
        data["process"] = _check_process(data["process"])
    if "priority_label" in data:
        data["priority_label"] = _req_text(data["priority_label"], "priority_label")
    if "response_minutes" in data:
        _check_minutes(data["response_minutes"], "response_minutes")
    if "resolution_minutes" in data:
        _check_minutes(data["resolution_minutes"], "resolution_minutes")
    process = data.get("process", row.process)
    label = data.get("priority_label", row.priority_label)
    window = data["service_window"] if "service_window" in data else row.service_window
    if _sla_dup(db, tid, process, label, window, exclude_id=row.id):
        raise HTTPException(
            status_code=409,
            detail=f"SLA target for {process}/{label}/{window or '-'} already exists",
        )
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "target": _sla_row(row)}


def delete_sla_target(db: Session, tid: int, sid: int) -> dict:
    row = _get_or_404(db, HDSLATarget, tid, sid, "SLA target")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/sla-targets")
def r_list_sla_targets(process: Optional[str] = Query(None), db: Session = Depends(get_db),
                       _: bool = Depends(require_settings_view)):
    return list_sla_targets(db, tenant_id(db), process)


@router.post("/sla-targets")
def r_create_sla_target(body: SLATargetCreate, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return create_sla_target(db, tenant_id(db), body)


@router.patch("/sla-targets/{sid}")
def r_update_sla_target(sid: int, body: SLATargetUpdate, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return update_sla_target(db, tenant_id(db), sid, body)


@router.delete("/sla-targets/{sid}")
def r_delete_sla_target(sid: int, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return delete_sla_target(db, tenant_id(db), sid)


# ═══════════════════════════════════════════════════════════════════════════
# change types
# ═══════════════════════════════════════════════════════════════════════════
class ChangeTypeCreate(BaseModel):
    code: str
    name: str
    requires_cab: Optional[bool] = None
    auto_approve: Optional[bool] = None
    description: Optional[str] = None


class ChangeTypeUpdate(BaseModel):
    name: Optional[str] = None
    requires_cab: Optional[bool] = None
    auto_approve: Optional[bool] = None
    description: Optional[str] = None


def _change_type_row(t: HDChangeType) -> dict:
    return {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "requires_cab": bool(t.requires_cab),
        "auto_approve": bool(t.auto_approve),
        "description": t.description,
        "created": iso(t.created_at),
        "modified": iso(t.updated_at),
    }


def list_change_types(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDChangeType)
        .filter(HDChangeType.tenant_id == tid)
        .order_by(HDChangeType.code.asc())
        .all()
    )
    return {"change_types": [_change_type_row(t) for t in rows]}


def create_change_type(db: Session, tid: int, body: ChangeTypeCreate) -> dict:
    code = _req_text(body.code, "code")
    name = _req_text(body.name, "name")
    if db.query(HDChangeType.id).filter(HDChangeType.tenant_id == tid,
                                        HDChangeType.code == code).first():
        raise HTTPException(status_code=409, detail=f"change type code '{code}' already exists")
    row = HDChangeType(
        tenant_id=tid, code=code, name=name,
        requires_cab=True if body.requires_cab is None else body.requires_cab,
        auto_approve=False if body.auto_approve is None else body.auto_approve,
        description=body.description,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "change_type": _change_type_row(row)}


def update_change_type(db: Session, tid: int, cid: int, body: ChangeTypeUpdate) -> dict:
    row = _get_or_404(db, HDChangeType, tid, cid, "change type")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = _req_text(data["name"], "name")
    for k, v in data.items():
        if k in ("requires_cab", "auto_approve") and v is None:
            continue  # booleans are non-nullable semantically; ignore explicit null
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "change_type": _change_type_row(row)}


@router.get("/change-types")
def r_list_change_types(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_change_types(db, tenant_id(db))


@router.post("/change-types")
def r_create_change_type(body: ChangeTypeCreate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    return create_change_type(db, tenant_id(db), body)


@router.patch("/change-types/{cid}")
def r_update_change_type(cid: int, body: ChangeTypeUpdate, db: Session = Depends(get_db),
                         _: bool = Depends(require_settings_manage)):
    return update_change_type(db, tenant_id(db), cid, body)


# ═══════════════════════════════════════════════════════════════════════════
# change risk matrix  (impact x likelihood -> risk level + CAB requirement)
# ═══════════════════════════════════════════════════════════════════════════
class RiskMatrixPut(BaseModel):
    impact: str
    likelihood: str
    risk_level: str
    cab_required: Optional[bool] = None


def _risk_row(c: HDChangeRiskMatrix) -> dict:
    return {
        "id": c.id,
        "impact": c.impact,
        "likelihood": c.likelihood,
        "risk_level": c.risk_level,
        "cab_required": bool(c.cab_required),
        "modified": iso(c.updated_at),
    }


def list_risk_matrix(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDChangeRiskMatrix)
        .filter(HDChangeRiskMatrix.tenant_id == tid)
        .order_by(HDChangeRiskMatrix.impact.asc(), HDChangeRiskMatrix.likelihood.asc())
        .all()
    )
    return {"cells": [_risk_row(c) for c in rows]}


def put_risk_cell(db: Session, tid: int, body: RiskMatrixPut) -> dict:
    impact = _req_text(body.impact, "impact")
    likelihood = _req_text(body.likelihood, "likelihood")
    risk_level = _req_text(body.risk_level, "risk_level")
    row = (
        db.query(HDChangeRiskMatrix)
        .filter(
            HDChangeRiskMatrix.tenant_id == tid,
            HDChangeRiskMatrix.impact == impact,
            HDChangeRiskMatrix.likelihood == likelihood,
        )
        .first()
    )
    created = row is None
    if created:
        row = HDChangeRiskMatrix(
            tenant_id=tid, impact=impact, likelihood=likelihood, risk_level=risk_level,
            cab_required=True if body.cab_required is None else body.cab_required,
        )
        db.add(row)
    else:
        row.risk_level = risk_level
        if body.cab_required is not None:
            row.cab_required = body.cab_required
    db.commit()
    return {"ok": True, "created": created, "cell": _risk_row(row)}


def delete_risk_cell(db: Session, tid: int, cid: int) -> dict:
    row = _get_or_404(db, HDChangeRiskMatrix, tid, cid, "risk matrix cell")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/risk-matrix")
def r_list_risk_matrix(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_risk_matrix(db, tenant_id(db))


@router.put("/risk-matrix")
def r_put_risk_cell(body: RiskMatrixPut, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    return put_risk_cell(db, tenant_id(db), body)


@router.delete("/risk-matrix/{cid}")
def r_delete_risk_cell(cid: int, db: Session = Depends(get_db),
                       _: bool = Depends(require_settings_manage)):
    return delete_risk_cell(db, tenant_id(db), cid)


# ═══════════════════════════════════════════════════════════════════════════
# CAB model (key/value config rows, upsert by item)
# ═══════════════════════════════════════════════════════════════════════════
class CABPut(BaseModel):
    item: str
    detail: Optional[str] = None
    sort_order: Optional[int] = None


def _cab_row(c: HDCABConfig) -> dict:
    return {
        "id": c.id,
        "item": c.item,
        "detail": c.detail,
        "sort_order": c.sort_order,
        "modified": iso(c.updated_at),
    }


def list_cab(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDCABConfig)
        .filter(HDCABConfig.tenant_id == tid)
        .order_by(HDCABConfig.sort_order.asc().nullslast(), HDCABConfig.item.asc())
        .all()
    )
    return {"items": [_cab_row(c) for c in rows]}


def put_cab(db: Session, tid: int, body: CABPut) -> dict:
    item = _req_text(body.item, "item")
    row = (
        db.query(HDCABConfig)
        .filter(HDCABConfig.tenant_id == tid, HDCABConfig.item == item)
        .first()
    )
    created = row is None
    if created:
        row = HDCABConfig(tenant_id=tid, item=item, detail=body.detail,
                          sort_order=body.sort_order)
        db.add(row)
    else:
        row.detail = body.detail
        if body.sort_order is not None:
            row.sort_order = body.sort_order
    db.commit()
    return {"ok": True, "created": created, "item": _cab_row(row)}


def delete_cab(db: Session, tid: int, cid: int) -> dict:
    row = _get_or_404(db, HDCABConfig, tid, cid, "CAB item")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/cab")
def r_list_cab(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_cab(db, tenant_id(db))


@router.put("/cab")
def r_put_cab(body: CABPut, db: Session = Depends(get_db),
              _: bool = Depends(require_settings_manage)):
    return put_cab(db, tenant_id(db), body)


@router.delete("/cab/{cid}")
def r_delete_cab(cid: int, db: Session = Depends(get_db),
                 _: bool = Depends(require_settings_manage)):
    return delete_cab(db, tenant_id(db), cid)


# ═══════════════════════════════════════════════════════════════════════════
# KPIs (sheet 29) — definition rows the Insights views report against
# ═══════════════════════════════════════════════════════════════════════════
class KPIPut(BaseModel):
    process: str
    kpi: str
    definition: Optional[str] = None
    target: Optional[str] = None
    frequency: Optional[str] = None
    sort_order: Optional[int] = None


def _kpi_row(k: HDKPI) -> dict:
    return {"id": k.id, "process": k.process, "kpi": k.kpi, "definition": k.definition,
            "target": k.target, "frequency": k.frequency, "sort_order": k.sort_order}


def list_kpis(db: Session, tid: int, process: Optional[str] = None) -> dict:
    q = db.query(HDKPI).filter(HDKPI.tenant_id == tid)
    if process:
        q = q.filter(HDKPI.process == process.strip().lower())
    rows = q.order_by(HDKPI.process, HDKPI.sort_order, HDKPI.id).all()
    return {"kpis": [_kpi_row(k) for k in rows]}


def put_kpi(db: Session, tid: int, body: KPIPut) -> dict:
    process = _req_text(body.process, "process").lower()
    kpi = _req_text(body.kpi, "kpi")
    row = (db.query(HDKPI)
           .filter(HDKPI.tenant_id == tid, HDKPI.process == process, HDKPI.kpi == kpi)
           .first())
    created = row is None
    if created:
        row = HDKPI(tenant_id=tid, process=process, kpi=kpi, definition=body.definition,
                    target=body.target, frequency=body.frequency, sort_order=body.sort_order)
        db.add(row)
    else:
        row.definition = body.definition
        row.target = body.target
        row.frequency = body.frequency
        if body.sort_order is not None:
            row.sort_order = body.sort_order
    db.commit()
    return {"ok": True, "created": created, "kpi": _kpi_row(row)}


def delete_kpi(db: Session, tid: int, kid: int) -> dict:
    row = _get_or_404(db, HDKPI, tid, kid, "KPI")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/kpis")
def r_list_kpis(process: Optional[str] = Query(None), db: Session = Depends(get_db),
                _: bool = Depends(require_settings_view)):
    return list_kpis(db, tenant_id(db), process)


@router.put("/kpis")
def r_put_kpi(body: KPIPut, db: Session = Depends(get_db),
              _: bool = Depends(require_settings_manage)):
    return put_kpi(db, tenant_id(db), body)


@router.delete("/kpis/{kid}")
def r_delete_kpi(kid: int, db: Session = Depends(get_db),
                 _: bool = Depends(require_settings_manage)):
    return delete_kpi(db, tenant_id(db), kid)


# ═══════════════════════════════════════════════════════════════════════════
# state transitions (the lifecycle state machine, as data)
# ═══════════════════════════════════════════════════════════════════════════
class TransitionCreate(BaseModel):
    process: str
    from_status_id: int
    to_status_id: int
    guard: Optional[str] = None
    required_role: Optional[str] = None


def _transition_row(t: HDStateTransition) -> dict:
    return {
        "id": t.id,
        "process": t.process,
        "from_status_id": t.from_status_id,
        "from_status": t.from_status.label_agent if t.from_status else None,
        "to_status_id": t.to_status_id,
        "to_status": t.to_status.label_agent if t.to_status else None,
        "guard": t.guard,
        "required_role": t.required_role,
        "modified": iso(t.updated_at),
    }


def list_transitions(db: Session, tid: int, process: Optional[str] = None) -> dict:
    q = db.query(HDStateTransition).filter(HDStateTransition.tenant_id == tid)
    if process:
        q = q.filter(HDStateTransition.process == process)
    rows = q.order_by(HDStateTransition.process.asc(), HDStateTransition.from_status_id.asc(),
                      HDStateTransition.to_status_id.asc()).all()
    return {"transitions": [_transition_row(t) for t in rows]}


def create_transition(db: Session, tid: int, body: TransitionCreate) -> dict:
    process = _check_process(body.process)
    _require_status(db, tid, body.from_status_id, "from_status_id")
    _require_status(db, tid, body.to_status_id, "to_status_id")
    if db.query(HDStateTransition.id).filter(
        HDStateTransition.tenant_id == tid,
        HDStateTransition.process == process,
        HDStateTransition.from_status_id == body.from_status_id,
        HDStateTransition.to_status_id == body.to_status_id,
    ).first():
        raise HTTPException(status_code=409, detail="that transition already exists")
    row = HDStateTransition(
        tenant_id=tid, process=process,
        from_status_id=body.from_status_id, to_status_id=body.to_status_id,
        guard=body.guard, required_role=body.required_role,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "transition": _transition_row(row)}


def delete_transition(db: Session, tid: int, trid: int) -> dict:
    row = _get_or_404(db, HDStateTransition, tid, trid, "transition")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/transitions")
def r_list_transitions(process: Optional[str] = Query(None), db: Session = Depends(get_db),
                       _: bool = Depends(require_settings_view)):
    return list_transitions(db, tenant_id(db), process)


@router.post("/transitions")
def r_create_transition(body: TransitionCreate, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return create_transition(db, tenant_id(db), body)


@router.delete("/transitions/{trid}")
def r_delete_transition(trid: int, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return delete_transition(db, tenant_id(db), trid)


# ═══════════════════════════════════════════════════════════════════════════
# incident categories (3-level tree: category -> subcategory -> item)
# ═══════════════════════════════════════════════════════════════════════════
class IncidentCategoryCreate(BaseModel):
    name: str
    level: str
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None


class IncidentCategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None


def _slug(text_: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text_.strip().lower()).strip("_")


def _category_node(c: HDIncidentCategory) -> dict:
    return {
        "id": c.id,
        "key": c.key,
        "name": c.name,
        "level": c.level,
        "parent_id": c.parent_id,
        "sort_order": c.sort_order,
        "enabled": bool(c.enabled),
        "modified": iso(c.updated_at),
    }


def list_incident_categories(db: Session, tid: int) -> dict:
    """Returns BOTH shapes: `categories` is the flat list (every node carries
    parent_id + level) and `tree` is the same nodes nested under `children`
    (roots = parent_id null). Retired nodes are included (enabled=false) so the
    admin can re-enable them."""
    rows = (
        db.query(HDIncidentCategory)
        .filter(HDIncidentCategory.tenant_id == tid)
        .order_by(HDIncidentCategory.sort_order.asc().nullslast(), HDIncidentCategory.name.asc())
        .all()
    )
    flat = [_category_node(c) for c in rows]
    by_id = {n["id"]: {**n, "children": []} for n in flat}
    roots: List[dict] = []
    for n in flat:
        node = by_id[n["id"]]
        parent = by_id.get(n["parent_id"]) if n["parent_id"] is not None else None
        (parent["children"] if parent else roots).append(node)
    return {"categories": flat, "tree": roots}


def create_incident_category(db: Session, tid: int, body: IncidentCategoryCreate) -> dict:
    name = _req_text(body.name, "name")
    level = (body.level or "").strip()
    if level not in CATEGORY_LEVELS:
        raise HTTPException(
            status_code=400, detail=f"level must be one of {', '.join(CATEGORY_LEVELS)}"
        )
    parent: Optional[HDIncidentCategory] = None
    if level == "category":
        if body.parent_id is not None:
            raise HTTPException(status_code=400, detail="a top-level category cannot have a parent")
    else:
        if body.parent_id is None:
            raise HTTPException(status_code=400, detail=f"a {level} requires parent_id")
        parent = (
            db.query(HDIncidentCategory)
            .filter(HDIncidentCategory.id == body.parent_id, HDIncidentCategory.tenant_id == tid)
            .first()
        )
        if not parent:
            raise HTTPException(status_code=400, detail=f"parent_id {body.parent_id} does not exist")
        if CATEGORY_LEVELS.index(parent.level) != CATEGORY_LEVELS.index(level) - 1:
            raise HTTPException(
                status_code=400,
                detail=f"a {level} must sit directly under a {CATEGORY_LEVELS[CATEGORY_LEVELS.index(level) - 1]}",
            )
    slug = _slug(name)
    if not slug:
        raise HTTPException(status_code=400, detail="name must contain letters or digits")
    key = f"{parent.key}/{slug}" if parent else slug
    if db.query(HDIncidentCategory.id).filter(HDIncidentCategory.tenant_id == tid,
                                              HDIncidentCategory.key == key).first():
        raise HTTPException(status_code=409, detail=f"incident category '{key}' already exists")
    row = HDIncidentCategory(
        tenant_id=tid, key=key, name=name, level=level,
        parent_id=parent.id if parent else None,
        sort_order=body.sort_order,
        enabled=True if body.enabled is None else body.enabled,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "category": _category_node(row)}


def update_incident_category(db: Session, tid: int, cid: int, body: IncidentCategoryUpdate) -> dict:
    row = _get_or_404(db, HDIncidentCategory, tid, cid, "incident category")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        # display label only — `key` is the stable natural key and is never rewritten
        data["name"] = _req_text(data["name"], "name")
    if "enabled" in data and data["enabled"] is None:
        del data["enabled"]
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "category": _category_node(row)}


def retire_incident_category(db: Session, tid: int, cid: int) -> dict:
    row = _get_or_404(db, HDIncidentCategory, tid, cid, "incident category")
    row.enabled = False
    db.commit()
    return {"ok": True}


@router.get("/incident-categories")
def r_list_incident_categories(db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_view)):
    return list_incident_categories(db, tenant_id(db))


@router.post("/incident-categories")
def r_create_incident_category(body: IncidentCategoryCreate, db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_manage)):
    return create_incident_category(db, tenant_id(db), body)


@router.patch("/incident-categories/{cid}")
def r_update_incident_category(cid: int, body: IncidentCategoryUpdate, db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_manage)):
    return update_incident_category(db, tenant_id(db), cid, body)


@router.post("/incident-categories/{cid}/retire")
def r_retire_incident_category(cid: int, db: Session = Depends(get_db),
                               _: bool = Depends(require_settings_manage)):
    return retire_incident_category(db, tenant_id(db), cid)


# ═══════════════════════════════════════════════════════════════════════════
# departments
# ═══════════════════════════════════════════════════════════════════════════
class DepartmentCreate(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    default_team_id: Optional[int] = None
    enabled: Optional[bool] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    default_team_id: Optional[int] = None
    enabled: Optional[bool] = None


def _department_row(d: HDDepartment) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "code": d.code,
        "description": d.description,
        "default_team_id": d.default_team_id,
        "default_team": d.default_team.name if d.default_team else None,
        "enabled": bool(d.enabled),
        "created": iso(d.created_at),
        "modified": iso(d.updated_at),
    }


def _department_dup(db: Session, tid: int, name: Optional[str], code: Optional[str],
                    exclude_id: Optional[int] = None) -> Optional[str]:
    if name is not None:
        q = db.query(HDDepartment.id).filter(HDDepartment.tenant_id == tid,
                                             HDDepartment.name == name)
        if exclude_id is not None:
            q = q.filter(HDDepartment.id != exclude_id)
        if q.first():
            return f"department name '{name}' already exists"
    if code:
        q = db.query(HDDepartment.id).filter(HDDepartment.tenant_id == tid,
                                             HDDepartment.code == code)
        if exclude_id is not None:
            q = q.filter(HDDepartment.id != exclude_id)
        if q.first():
            return f"department code '{code}' already exists"
    return None


def list_departments(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDDepartment)
        .filter(HDDepartment.tenant_id == tid)
        .order_by(HDDepartment.name.asc())
        .all()
    )
    return {"departments": [_department_row(d) for d in rows]}


def create_department(db: Session, tid: int, body: DepartmentCreate) -> dict:
    name = _req_text(body.name, "name")
    code = (body.code or "").strip() or None
    _require_team(db, tid, body.default_team_id, "default_team_id")
    msg = _department_dup(db, tid, name, code)
    if msg:
        raise HTTPException(status_code=409, detail=msg)
    row = HDDepartment(
        tenant_id=tid, name=name, code=code, description=body.description,
        default_team_id=body.default_team_id,
        enabled=True if body.enabled is None else body.enabled,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "department": _department_row(row)}


def update_department(db: Session, tid: int, did: int, body: DepartmentUpdate) -> dict:
    row = _get_or_404(db, HDDepartment, tid, did, "department")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = _req_text(data["name"], "name")
    if "code" in data:
        data["code"] = (data["code"] or "").strip() or None
    if "default_team_id" in data:
        _require_team(db, tid, data["default_team_id"], "default_team_id")
    if "enabled" in data and data["enabled"] is None:
        del data["enabled"]
    msg = _department_dup(db, tid, data.get("name"), data.get("code"), exclude_id=row.id)
    if msg:
        raise HTTPException(status_code=409, detail=msg)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "department": _department_row(row)}


def retire_department(db: Session, tid: int, did: int) -> dict:
    row = _get_or_404(db, HDDepartment, tid, did, "department")
    row.enabled = False
    db.commit()
    return {"ok": True}


@router.get("/departments")
def r_list_departments(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_departments(db, tenant_id(db))


@router.post("/departments")
def r_create_department(body: DepartmentCreate, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return create_department(db, tenant_id(db), body)


@router.patch("/departments/{did}")
def r_update_department(did: int, body: DepartmentUpdate, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return update_department(db, tenant_id(db), did, body)


@router.post("/departments/{did}/retire")
def r_retire_department(did: int, db: Session = Depends(get_db),
                        _: bool = Depends(require_settings_manage)):
    return retire_department(db, tenant_id(db), did)


# ═══════════════════════════════════════════════════════════════════════════
# role map  (ROLE-* -> ComplyVerse RBAC preset)
# ═══════════════════════════════════════════════════════════════════════════
class RoleMapUpdate(BaseModel):
    rbac_preset: Optional[str] = None
    description: Optional[str] = None


def _role_row(r: HDRoleMap) -> dict:
    return {
        "id": r.id,
        "code": r.code,
        "name": r.name,
        "rbac_preset": r.rbac_preset,
        "description": r.description,
        "modified": iso(r.updated_at),
    }


def list_roles(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDRoleMap).filter(HDRoleMap.tenant_id == tid).order_by(HDRoleMap.code.asc()).all()
    )
    return {"roles": [_role_row(r) for r in rows]}


def update_role(db: Session, tid: int, rid: int, body: RoleMapUpdate) -> dict:
    row = _get_or_404(db, HDRoleMap, tid, rid, "role")
    data = body.model_dump(exclude_unset=True)
    if "rbac_preset" in data:
        data["rbac_preset"] = (data["rbac_preset"] or "").strip() or None  # blank clears the mapping
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "role": _role_row(row)}


@router.get("/roles")
def r_list_roles(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_roles(db, tenant_id(db))


@router.patch("/roles/{rid}")
def r_update_role(rid: int, body: RoleMapUpdate, db: Session = Depends(get_db),
                  _: bool = Depends(require_settings_manage)):
    return update_role(db, tenant_id(db), rid, body)


# ═══════════════════════════════════════════════════════════════════════════
# support group map  (GRP-* -> ComplyVerse Administration team)
# ═══════════════════════════════════════════════════════════════════════════
class SupportGroupUpdate(BaseModel):
    team_id: Optional[int] = None


def _support_group_row(g: HDSupportGroupMap) -> dict:
    return {
        "id": g.id,
        "code": g.code,
        "name": g.name,
        "team_id": g.team_id,
        "team": g.team.name if g.team else None,
        "modified": iso(g.updated_at),
    }


def list_support_groups(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDSupportGroupMap)
        .filter(HDSupportGroupMap.tenant_id == tid)
        .order_by(HDSupportGroupMap.code.asc())
        .all()
    )
    return {"support_groups": [_support_group_row(g) for g in rows]}


def update_support_group(db: Session, tid: int, gid: int, body: SupportGroupUpdate) -> dict:
    row = _get_or_404(db, HDSupportGroupMap, tid, gid, "support group")
    data = body.model_dump(exclude_unset=True)
    if "team_id" in data:
        _require_team(db, tid, data["team_id"])  # null is allowed: un-maps the group
        row.team_id = data["team_id"]
    db.commit()
    return {"ok": True, "support_group": _support_group_row(row)}


@router.get("/support-groups")
def r_list_support_groups(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    return list_support_groups(db, tenant_id(db))


@router.patch("/support-groups/{gid}")
def r_update_support_group(gid: int, body: SupportGroupUpdate, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    return update_support_group(db, tenant_id(db), gid, body)

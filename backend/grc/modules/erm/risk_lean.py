"""The Risk Register's complete load: ``GET /erm/risks?lean=1``, and the record fields the two detail endpoints add.

``GET /erm/risks`` returns the newest 100 risks when nobody sends a limit, and a bare array without a total, so a list that draws,
filters and counts from it silently works on a slice. ``lean=1`` is the list for the register explorer (the same approach as the
Documents library, ``governance/library_lean.py``): the same risks for the same person, every row compact (no long text, no per-row
query), ``limit`` up to 10,000 in one request, the true ``total`` and ``truncated`` when the response holds fewer, and the names the
rows use. The old call and its default are untouched.

Lean row = the keys the register reads; the long text (description in full, root cause, consequences, recommendations, treatment plan,
custom and template fields) stays on the detail endpoints, which ``detail_extras`` completes. All counts of related rows are one
grouped query for the whole page, never one per risk.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from fastapi.responses import JSONResponse
from sqlalchemy import case, func
from sqlalchemy.orm import Session, aliased

from ...models import (BusinessUnit, GRCUser, Risk, RiskAssessmentRisk, RiskFrameworkRequirementLink, RiskMitigationAction, UploadedFramework)

# the most rows one lean request returns (a larger ``limit`` is clamped and the envelope echoes the clamped value)
LEAN_LIMIT = 10_000
PREVIEW_CHARS = 240
_OPEN_ACTION = ("open", "in_progress", "overdue")


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def chunks(seq: Sequence, size: int = 5000):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def empty(skip: int, limit: int) -> Dict[str, Any]:
    return {"items": [], "total": 0, "skip": skip, "limit": limit, "truncated": False, "lean": True, "frameworks": {}}


def _sla_of(db: Session, rows: Sequence[Any]) -> Dict[int, Dict[str, Any]]:
    """``{risk id: the SLA state}`` as ``risks._attach_sla`` says it (one settings read for each tenant)."""
    from ...services.module_settings import get_settings, sla_state
    settings = {tid: get_settings(db, tid, "risks") for tid in {r.tenant_id for r in rows}}
    out: Dict[int, Dict[str, Any]] = {}
    for r in rows:
        priority = r.priority or _band_priority(r.residual_score or r.inherent_score)
        out[r.id] = sla_state(settings[r.tenant_id], status=r.status, due_date=r.due_date, priority=priority, opened_at=r.created_at)
    return out


def _band_priority(score) -> Optional[str]:
    from ...models._11_enterprise_risk_management import risk_priority_for_score
    return risk_priority_for_score(score)


def list_lean(db: Session, query, total: int, skip: int, limit: int) -> JSONResponse:
    """The lean envelope for ``query`` (the full list's filtered query on ``Risk``), ``total`` its true count, newest first (equal
    times by id, so pages never repeat or skip a risk). A ``JSONResponse`` built here: the encoder of the standard library is far
    cheaper than FastAPI's for thousands of rows."""
    R, Owner, Biz, BU = Risk, aliased(GRCUser), aliased(GRCUser), aliased(BusinessUnit)
    columns = (
        R.id, R.tenant_id, R.title, func.substr(R.description, 1, PREVIEW_CHARS).label("preview"), R.category, R.risk_category, R.risk_sub_category,
        R.register_type, R.source_type, R.status, R.priority, R.closure_status, R.is_material,
        R.inherent_likelihood, R.inherent_impact, R.inherent_score, R.residual_likelihood, R.residual_impact, R.residual_score,
        R.owner_id, Owner.display_name.label("owner_name"), R.business_owner_id, Biz.display_name.label("business_owner_name"),
        R.business_unit_id, BU.name.label("business_unit_name"), R.due_date, R.review_date, R.created_at, R.updated_at,
        (func.coalesce(func.length(func.trim(R.treatment_plan)), 0) > 0).label("has_plan"),
    )
    rows = (query.with_entities(*columns)
            .outerjoin(Owner, Owner.id == R.owner_id).outerjoin(Biz, Biz.id == R.business_owner_id).outerjoin(BU, BU.id == R.business_unit_id)
            .order_by(R.created_at.desc(), R.id.desc()).offset(skip).limit(limit).all())
    ids = [r.id for r in rows]
    sla = _sla_of(db, rows) if rows else {}

    frameworks_of: Dict[int, List[int]] = {}
    names: Dict[str, Dict[str, str]] = {}
    actions: Dict[int, List[int]] = {}
    assessed: set = set()
    for chunk in chunks(ids):
        L = RiskFrameworkRequirementLink
        for rid, fid in db.query(L.risk_id, L.uploaded_framework_id).filter(L.risk_id.in_(chunk)).distinct().order_by(L.risk_id, L.uploaded_framework_id):
            frameworks_of.setdefault(rid, []).append(fid)
        A = RiskMitigationAction
        for rid, total_n, open_n in (db.query(A.risk_id, func.count(A.id), func.sum(case((A.status.in_(_OPEN_ACTION), 1), else_=0)))
                                     .filter(A.risk_id.in_(chunk)).group_by(A.risk_id)):
            actions[rid] = [int(total_n or 0), int(open_n or 0)]
        assessed.update(rid for (rid,) in db.query(RiskAssessmentRisk.risk_id).filter(RiskAssessmentRisk.risk_id.in_(chunk)).distinct())
    fw_ids = sorted({f for fs in frameworks_of.values() for f in fs})
    for chunk in chunks(fw_ids):
        for fid, name in db.query(UploadedFramework.id, UploadedFramework.name).filter(UploadedFramework.id.in_(chunk)):
            names[str(fid)] = {"name": name}

    items: List[Dict[str, Any]] = []
    for r in rows:
        s = sla.get(r.id) or {}
        items.append({
            "id": r.id, "tenant_id": r.tenant_id, "title": r.title, "description_preview": r.preview,
            "category": r.category, "risk_category": r.risk_category, "risk_sub_category": r.risk_sub_category,
            "register_type": r.register_type, "source_type": r.source_type, "status": r.status, "priority": r.priority,
            "effective_priority": r.priority or _band_priority(r.residual_score or r.inherent_score),
            "closure_status": r.closure_status, "is_material": bool(r.is_material),
            "inherent_likelihood": r.inherent_likelihood, "inherent_impact": r.inherent_impact, "inherent_score": r.inherent_score,
            "residual_likelihood": r.residual_likelihood, "residual_impact": r.residual_impact, "residual_score": r.residual_score,
            "owner_id": r.owner_id, "owner_name": r.owner_name, "business_owner_id": r.business_owner_id, "business_owner_name": r.business_owner_name,
            "business_unit_id": r.business_unit_id, "business_unit_name": r.business_unit_name,
            "due_date": _iso(r.due_date), "review_date": _iso(r.review_date), "has_plan": bool(r.has_plan),
            "sla": {"state": s.get("state"), "days_overdue": s.get("days_overdue"), "due_in_days": s.get("due_in_days"), "due_date": s.get("due_date")},
            "framework_ids": frameworks_of.get(r.id, []), "in_assessment": r.id in assessed,
            "actions_total": (actions.get(r.id) or [0, 0])[0], "actions_open": (actions.get(r.id) or [0, 0])[1],
            "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at),
        })
    return JSONResponse({"items": items, "total": total, "skip": skip, "limit": limit, "truncated": skip + len(items) < total, "lean": True,
                         "frameworks": names})


def detail_extras(db: Session, risk: Risk) -> Dict[str, Any]:
    """The record fields the two detail endpoints did not carry (the register's drawer and the risk page edit and read them): added
    keys only, so every old key keeps its value. Counts are the true totals of the related rows."""
    from .routers import risks as r_module          # _attach_* are the list's, so the detail and the list say the same thing
    r_module._attach_source_labels(db, [risk])
    r_module._attach_sla(db, [risk])
    business_owner = db.query(GRCUser.display_name).filter(GRCUser.id == risk.business_owner_id).scalar() if risk.business_owner_id else None
    unit = db.query(BusinessUnit.name).filter(BusinessUnit.id == risk.business_unit_id).scalar() if risk.business_unit_id else None
    A = RiskMitigationAction
    total_n, open_n = (db.query(func.count(A.id), func.sum(case((A.status.in_(_OPEN_ACTION), 1), else_=0)))
                       .filter(A.risk_id == risk.id).one())
    return {
        "priority": risk.priority, "effective_priority": risk.effective_priority, "sla": risk.sla,
        "root_cause": risk.root_cause, "consequences": risk.consequences, "recommendations": risk.recommendations,
        "business_owner_id": risk.business_owner_id, "business_owner_name": business_owner,
        "business_unit_id": risk.business_unit_id, "business_unit_name": unit,
        "affected_department_ids": risk.affected_department_ids or [],
        "custom_values": risk.custom_values, "template_fields": risk.template_fields,
        "risk_sub_category": risk.risk_sub_category, "register_type": risk.register_type, "risk_category": risk.risk_category,
        "source_type": risk.source_type, "source_reference": risk.source_reference, "source_label": risk.source_label,
        "closure_status": risk.closure_status, "closed_at": _iso(risk.closed_at), "closure_notes": risk.closure_notes,
        "is_material": bool(risk.is_material), "actions_total": int(total_n or 0), "actions_open": int(open_n or 0),
        "owner_name": risk.owner.display_name if risk.owner else None,
        "due_date": _iso(risk.due_date), "review_date": _iso(risk.review_date),
    }

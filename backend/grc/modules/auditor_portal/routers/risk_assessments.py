"""Auditor portal — framework risk assessments.

Returns every FrameworkRiskAssessment scoped to this framework (matched
by either `uploaded_framework_id` for new-style records or `framework_id`
for legacy ones), plus a per-assessment rollup of its question states.
The auditor uses this to confirm a tenant has actually walked through
the framework's methodology questionnaire before signing off.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    get_db,
    FrameworkRiskAssessment,
    FrameworkRiskQuestion,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context


router = APIRouter()


@router.get("/{framework_id}/risk-assessments")
def list_risk_assessments(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List framework risk assessments for this framework with progress."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    # An assessment can be tagged via uploaded_framework_id (new style)
    # OR framework_id (legacy / published-Framework records). We match
    # both — the published framework id is resolved through the context
    # when available so legacy seed-data assessments still appear.
    or_clauses = []
    if ctx.framework:
        or_clauses.append(FrameworkRiskAssessment.uploaded_framework_id == ctx.framework.id)
    if ctx.published_framework:
        or_clauses.append(FrameworkRiskAssessment.framework_id == ctx.published_framework.id)

    if not or_clauses:
        return {"assessments": [], "total": 0}

    assessments = db.query(FrameworkRiskAssessment).filter(
        FrameworkRiskAssessment.tenant_id.in_(user_tenants),
        or_(*or_clauses),
    ).order_by(FrameworkRiskAssessment.updated_at.desc().nullslast()).all()

    if not assessments:
        return {"assessments": [], "total": 0}

    # Rollup the question status counts in a single grouped query rather
    # than N+1 lookups across the assessment list.
    assessment_ids = [a.id for a in assessments]
    rows = db.query(
        FrameworkRiskQuestion.assessment_id,
        FrameworkRiskQuestion.status,
        func.count(FrameworkRiskQuestion.id),
    ).filter(
        FrameworkRiskQuestion.assessment_id.in_(assessment_ids),
    ).group_by(
        FrameworkRiskQuestion.assessment_id, FrameworkRiskQuestion.status,
    ).all()

    rollup: dict[int, dict[str, int]] = {}
    for assessment_id, status_val, count in rows:
        bucket = rollup.setdefault(assessment_id, {
            "total": 0, "not_started": 0, "in_progress": 0, "completed": 0, "blocked": 0,
        })
        bucket["total"] += count
        key = (status_val or "not_started").lower()
        if key in bucket:
            bucket[key] += count
        else:
            bucket["not_started"] += count

    out = []
    for a in assessments:
        counts = rollup.get(a.id, {"total": 0, "not_started": 0, "in_progress": 0, "completed": 0, "blocked": 0})
        completion_pct = (counts["completed"] / counts["total"] * 100) if counts["total"] else 0
        out.append({
            "id": a.id,
            "name": a.name,
            "description": a.description,
            "status": a.status,
            "framework_id": a.framework_id,
            "uploaded_framework_id": a.uploaded_framework_id,
            "created_by": a.created_by,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
            "questions": counts,
            "completion_pct": round(completion_pct, 1),
        })

    return {"assessments": out, "total": len(out)}

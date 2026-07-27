"""Severity Matrix + Classification Matrix admin endpoints.

  GET  /matrices/severity                              get the full 3×3 matrix (with defaults)
  PUT  /matrices/severity/{impact}/{urgency}           upsert a cell
  GET  /matrices/classification                        get all (type × severity) cells
  PUT  /matrices/classification/{type}/{severity}      upsert a cell
"""
from datetime import datetime
from typing import Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    IssueSeverityMatrix, IssueClassificationMatrix, GRCUser, get_db,
)
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant,
    require_tenant_permission,
)
from ..services.severity_resolver import DEFAULT_SEVERITY_MATRIX

_require_view = require_tenant_permission("issue_management:issues:view")
_require_edit = require_tenant_permission("issue_management:issues:edit")

router = APIRouter(
    prefix="/matrices",
    tags=["Issue Management - Matrices"],
    dependencies=[Depends(_require_view)],
)


VALID_IMPACTS = {"high", "medium", "low"}
VALID_URGENCIES = {"high", "medium", "low"}
VALID_SEVERITIES = {"critical", "high", "medium", "low", "informational"}
VALID_TYPES = {
    "incident", "audit_finding", "non_conformance",
    "vendor_breach", "process_gap", "capa", "other",
}


# ── Severity Matrix ─────────────────────────────────────────────────────
@router.get("/severity")
def get_severity_matrix(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")

    rows = db.query(IssueSeverityMatrix).filter(IssueSeverityMatrix.tenant_id == tenant_id).all()
    saved = {(r.impact, r.urgency): r for r in rows}

    cells: List[Dict[str, Any]] = []
    for impact in ("high", "medium", "low"):
        for urgency in ("high", "medium", "low"):
            if (impact, urgency) in saved:
                r = saved[(impact, urgency)]
                cells.append({
                    "impact": impact, "urgency": urgency,
                    "severity": r.computed_severity,
                    "sla_ack_hours": r.sla_ack_hours,
                    "sla_resolve_hours": r.sla_resolve_hours,
                    "is_default": False,
                })
            else:
                sev, ack, resolve = DEFAULT_SEVERITY_MATRIX[(impact, urgency)]
                cells.append({
                    "impact": impact, "urgency": urgency,
                    "severity": sev, "sla_ack_hours": ack, "sla_resolve_hours": resolve,
                    "is_default": True,
                })
    return {"tenant_id": tenant_id, "cells": cells}


@router.put("/severity/{impact}/{urgency}", dependencies=[Depends(_require_edit)])
def upsert_severity_cell(
    impact: str,
    urgency: str,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    impact = (impact or "").strip().lower()
    urgency = (urgency or "").strip().lower()
    if impact not in VALID_IMPACTS or urgency not in VALID_URGENCIES:
        raise HTTPException(status_code=400, detail="Invalid impact or urgency")

    severity = (body.get("severity") or "").strip().lower()
    if severity not in VALID_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"severity must be one of {sorted(VALID_SEVERITIES)}")
    ack_hours = int(body.get("sla_ack_hours") or 24)
    resolve_hours = int(body.get("sla_resolve_hours") or 168)

    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")

    row = db.query(IssueSeverityMatrix).filter(
        IssueSeverityMatrix.tenant_id == tenant_id,
        IssueSeverityMatrix.impact == impact,
        IssueSeverityMatrix.urgency == urgency,
    ).first()
    if row:
        row.computed_severity = severity
        row.sla_ack_hours = ack_hours
        row.sla_resolve_hours = resolve_hours
        row.updated_at = datetime.utcnow()
        row.updated_by = current_user.id
    else:
        row = IssueSeverityMatrix(
            tenant_id=tenant_id, impact=impact, urgency=urgency,
            computed_severity=severity,
            sla_ack_hours=ack_hours, sla_resolve_hours=resolve_hours,
            updated_by=current_user.id,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "impact": impact, "urgency": urgency,
        "severity": row.computed_severity,
        "sla_ack_hours": row.sla_ack_hours,
        "sla_resolve_hours": row.sla_resolve_hours,
    }


# ── Classification Matrix ───────────────────────────────────────────────
@router.get("/classification")
def get_classification_matrix(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    rows = db.query(IssueClassificationMatrix).filter(
        IssueClassificationMatrix.tenant_id == tenant_id,
    ).all()
    return {
        "tenant_id": tenant_id,
        "cells": [{
            "issue_type": r.issue_type,
            "severity": r.severity,
            "default_owner_team_id": r.default_owner_team_id,
            "default_owner_user_id": r.default_owner_user_id,
            "response_sla_hours": r.response_sla_hours,
            "escalation_sla_hours": r.escalation_sla_hours,
        } for r in rows],
    }


@router.put("/classification/{issue_type}/{severity}", dependencies=[Depends(_require_edit)])
def upsert_classification_cell(
    issue_type: str,
    severity: str,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    issue_type = (issue_type or "").strip().lower()
    severity = (severity or "").strip().lower()
    if issue_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"issue_type must be one of {sorted(VALID_TYPES)}")
    if severity not in VALID_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"severity must be one of {sorted(VALID_SEVERITIES)}")

    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")

    row = db.query(IssueClassificationMatrix).filter(
        IssueClassificationMatrix.tenant_id == tenant_id,
        IssueClassificationMatrix.issue_type == issue_type,
        IssueClassificationMatrix.severity == severity,
    ).first()
    if row:
        row.default_owner_team_id = body.get("default_owner_team_id")
        row.default_owner_user_id = body.get("default_owner_user_id")
        row.response_sla_hours = body.get("response_sla_hours")
        row.escalation_sla_hours = body.get("escalation_sla_hours")
        row.updated_at = datetime.utcnow()
        row.updated_by = current_user.id
    else:
        row = IssueClassificationMatrix(
            tenant_id=tenant_id, issue_type=issue_type, severity=severity,
            default_owner_team_id=body.get("default_owner_team_id"),
            default_owner_user_id=body.get("default_owner_user_id"),
            response_sla_hours=body.get("response_sla_hours"),
            escalation_sla_hours=body.get("escalation_sla_hours"),
            updated_by=current_user.id,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "issue_type": row.issue_type,
        "severity": row.severity,
        "default_owner_team_id": row.default_owner_team_id,
        "default_owner_user_id": row.default_owner_user_id,
        "response_sla_hours": row.response_sla_hours,
        "escalation_sla_hours": row.escalation_sla_hours,
    }

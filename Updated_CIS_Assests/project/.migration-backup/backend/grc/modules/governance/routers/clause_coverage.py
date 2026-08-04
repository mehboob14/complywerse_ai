"""Endpoints for the dedup pre-generation pass and manual clause-mapping
overrides (Task #46 steps 2-3).

- ``POST /governance/clause-coverage/scan/{document_id}`` — run the hybrid
  mapping service against every framework that has clauses in the tenant.
- ``GET  /governance/clause-coverage/{document_id}`` — return current rows.
- ``POST /governance/clause-coverage/{document_id}/decision`` — record manual
  user choice (skip_link | merge | gap_patch | sxs | regenerate) for a row.
- ``GET  /governance/clause-coverage/dedup-preflight/{document_id}`` — summary
  of which framework clauses are already covered, used by the AI-generation
  flow to skip duplicate work and surface choices to the user.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import (
    GovernanceDocument,
    GRCUser,
    PolicyClauseCoverage,
    UploadedFramework,
    get_db,
)
from ....rich_audit import write_rich_audit_log
from ....routers.auth_router import (
    get_user_primary_tenant,
    get_user_tenants,
    require_auth,
)
from ..services.clause_mapping import (
    coverage_report_for_tenant,
    map_document_to_framework,
)


router = APIRouter(prefix="/clause-coverage", tags=["Policy AI Clause Coverage"])


VALID_USER_CHOICES = {"skip_link", "merge", "gap_patch", "sxs", "regenerate"}


class CoverageOut(BaseModel):
    id: int
    parsed_control_id: int
    uploaded_framework_id: int
    coverage_status: str
    confidence: Optional[float]
    signals: dict
    matching_excerpt: Optional[str]
    source: str
    user_choice: Optional[str]
    is_locked: bool

    class Config:
        from_attributes = True


class DecisionBody(BaseModel):
    user_choice: str
    lock: bool = True


class ScanResponse(BaseModel):
    framework_count: int
    rows_written: int


@router.post("/scan/{document_id}", response_model=ScanResponse)
def scan_document(
    document_id: int,
    use_ai: bool = True,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    document = (
        db.query(GovernanceDocument)
        .filter(
            GovernanceDocument.id == document_id,
            GovernanceDocument.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    text = document.content or ""
    if not text:
        raise HTTPException(status_code=400, detail="Document has no text content to scan")
    frameworks = (
        db.query(UploadedFramework)
        .filter(UploadedFramework.tenant_id == document.tenant_id)
        .all()
    )
    rows_written = 0
    for fw in frameworks:
        rows = map_document_to_framework(db, document, fw, text, use_ai=use_ai)
        rows_written += len(rows)
    write_rich_audit_log(
        db,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="clause_coverage.scan",
        resource_type="governance_document",
        resource_id=document.id,
        resource_name=document.title,
        summary=f"Scanned against {len(frameworks)} framework(s); {rows_written} clause rows updated",
    )
    db.commit()
    return ScanResponse(framework_count=len(frameworks), rows_written=rows_written)


@router.post("/{document_id}/decision/{coverage_id}", response_model=CoverageOut)
def record_decision(
    document_id: int,
    coverage_id: int,
    body: DecisionBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    if body.user_choice not in VALID_USER_CHOICES:
        raise HTTPException(status_code=400, detail=f"Invalid user_choice; allowed: {sorted(VALID_USER_CHOICES)}")
    user_tenants = get_user_tenants(current_user, db)
    row = (
        db.query(PolicyClauseCoverage)
        .filter(
            PolicyClauseCoverage.id == coverage_id,
            PolicyClauseCoverage.document_id == document_id,
            PolicyClauseCoverage.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Coverage row not found")
    before = {
        "user_choice": row.user_choice,
        "is_locked": row.is_locked,
        "source": row.source,
    }
    row.user_choice = body.user_choice
    row.user_choice_by = current_user.id
    row.user_choice_at = datetime.utcnow()
    row.is_locked = body.lock
    row.source = "manual"
    row.updated_at = datetime.utcnow()
    db.add(row)
    write_rich_audit_log(
        db,
        tenant_id=row.tenant_id,
        user_id=current_user.id,
        action="clause_coverage.decision",
        resource_type="policy_clause_coverage",
        resource_id=row.id,
        summary=f"User chose '{body.user_choice}' for control {row.parsed_control_id}",
        before=before,
        after={
            "user_choice": row.user_choice,
            "is_locked": row.is_locked,
            "source": row.source,
        },
    )
    db.commit()
    db.refresh(row)
    return row


@router.get("/dedup-preflight/{document_id}", tags=["Policy AI Clause Coverage"])
def dedup_preflight(
    document_id: int,
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Pre-AI-generation summary used by the policy generator to decide which
    clauses to skip/merge. Returns counts + the per-clause covered list."""
    user_tenants = get_user_tenants(current_user, db)
    doc = (
        db.query(GovernanceDocument)
        .filter(
            GovernanceDocument.id == document_id,
            GovernanceDocument.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    rows = (
        db.query(PolicyClauseCoverage)
        .filter(
            PolicyClauseCoverage.document_id == document_id,
            PolicyClauseCoverage.uploaded_framework_id == framework_id,
        )
        .all()
    )
    counts = {"covered": 0, "partial": 0, "missing": 0}
    for r in rows:
        counts[r.coverage_status] = counts.get(r.coverage_status, 0) + 1
    return {
        "document_id": document_id,
        "framework_id": framework_id,
        "counts": counts,
        "rows": [
            {
                "id": r.id,
                "parsed_control_id": r.parsed_control_id,
                "coverage_status": r.coverage_status,
                "confidence": r.confidence,
                "user_choice": r.user_choice,
                "is_locked": r.is_locked,
                "source": r.source,
            }
            for r in rows
        ],
    }


@router.get("/tenant-report/{framework_id}")
def tenant_coverage_report(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    return coverage_report_for_tenant(db, tenant_id, framework_id)


# Catch-all dynamic route declared LAST so static paths above (``/scan/...``,
# ``/dedup-preflight/...``, ``/tenant-report/...``) are matched first.
@router.get("/{document_id}", response_model=List[CoverageOut])
def list_coverage(
    document_id: int,
    framework_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    q = db.query(PolicyClauseCoverage).filter(
        PolicyClauseCoverage.document_id == document_id,
        PolicyClauseCoverage.tenant_id.in_(user_tenants),
    )
    if framework_id is not None:
        q = q.filter(PolicyClauseCoverage.uploaded_framework_id == framework_id)
    return q.all()

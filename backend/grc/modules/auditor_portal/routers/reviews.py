"""Auditor portal — review/approve/reject/remarks across artifacts.

A single POST endpoint routes the auditor's decision to the appropriate
existing approval workflow on each artifact type. This deliberately
*reuses* the existing approval fields on each model rather than adding a
parallel "auditor_review" layer — the auditor's verdict is the same
verdict any reviewer would record, so it must land on the same column.

Supported artifact types:
- evidence              → ImplementationEvidence.review_status
- applicability         → ClauseApplicability.status
- policy_exception      → PolicyException.status (+ approved/rejected fields)
- exception             → Exception.status

Each call also writes an AuditLog row so the audit trail shows who did
what and when.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    get_db,
    AuditLog,
    ImplementationEvidence,
    ClauseApplicability,
    PolicyException,
    Exception as ComplianceException,
)
from ....routers.auth_router import require_auth, get_user_tenants


router = APIRouter()


ArtifactType = Literal["evidence", "applicability", "policy_exception", "exception"]
ReviewAction = Literal["approved", "rejected", "pending"]


class ReviewBody(BaseModel):
    artifact_type: ArtifactType
    artifact_id: int = Field(..., gt=0)
    action: ReviewAction
    remarks: Optional[str] = Field(None, max_length=4000)


def _write_audit(
    db: Session,
    user: GRCUser,
    tenant_id: int,
    artifact_type: str,
    artifact_id: int,
    action: str,
    remarks: Optional[str],
) -> None:
    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user.id,
        action=f"auditor_review.{action}",
        resource_type=artifact_type,
        resource_id=artifact_id,
        changes={"remarks": (remarks or "")[:1000]},
    )
    db.add(log)


@router.post("/reviews")
def submit_review(
    body: ReviewBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Apply an auditor decision to the artifact. Idempotent: re-posting
    the same action with new remarks updates the existing record (this
    is how an auditor amends remarks without resetting the workflow)."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access.")

    now = datetime.utcnow()

    if body.artifact_type == "evidence":
        row = db.query(ImplementationEvidence).join(
            ImplementationEvidence.implementation
        ).filter(ImplementationEvidence.id == body.artifact_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Evidence not found.")
        # Tenant guard via parent implementation's journey tenant
        tenant_id = getattr(row.implementation, "tenant_id", None) if row.implementation else None
        if tenant_id is None or tenant_id not in user_tenants:
            # Fall back: many ImplementationEvidence rows inherit tenant
            # from the parent journey; check via the chain explicitly.
            from ....models import ControlImplementation, CertificationJourney
            impl = db.query(ControlImplementation).filter(
                ControlImplementation.id == row.implementation_id
            ).first()
            journey = db.query(CertificationJourney).filter(
                CertificationJourney.id == (impl.journey_id if impl else 0),
                CertificationJourney.tenant_id.in_(user_tenants),
            ).first() if impl else None
            if not journey:
                raise HTTPException(status_code=403, detail="Access denied to this evidence.")
            tenant_id = journey.tenant_id

        row.review_status = body.action
        row.review_notes = body.remarks
        row.reviewed_by = current_user.id
        row.reviewed_at = now
        _write_audit(db, current_user, tenant_id, "implementation_evidence", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "evidence",
            "artifact_id": row.id,
            "status": row.review_status,
            "reviewed_at": row.reviewed_at,
            "reviewed_by": current_user.id,
            "remarks": row.review_notes,
        }

    if body.artifact_type == "applicability":
        row = db.query(ClauseApplicability).filter(
            ClauseApplicability.id == body.artifact_id,
            ClauseApplicability.tenant_id.in_(user_tenants),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Applicability record not found.")
        row.status = body.action
        row.review_comment = body.remarks
        row.reviewed_by = current_user.id
        row.reviewed_at = now
        _write_audit(db, current_user, row.tenant_id, "clause_applicability", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "applicability",
            "artifact_id": row.id,
            "status": row.status,
            "reviewed_at": row.reviewed_at,
            "reviewed_by": current_user.id,
            "remarks": row.review_comment,
        }

    if body.artifact_type == "policy_exception":
        row = db.query(PolicyException).filter(
            PolicyException.id == body.artifact_id,
            PolicyException.tenant_id.in_(user_tenants),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Policy exception not found.")
        row.status = body.action
        if body.action == "approved":
            row.approved_by = current_user.id
            row.approved_at = now
            row.rejected_by = None
            row.rejected_at = None
            row.rejection_reason = None
        elif body.action == "rejected":
            row.rejected_by = current_user.id
            row.rejected_at = now
            row.rejection_reason = body.remarks
        _write_audit(db, current_user, row.tenant_id, "policy_exception", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "policy_exception",
            "artifact_id": row.id,
            "status": row.status,
            "reviewed_at": now,
            "reviewed_by": current_user.id,
            "remarks": body.remarks,
        }

    if body.artifact_type == "exception":
        row = db.query(ComplianceException).filter(
            ComplianceException.id == body.artifact_id,
            ComplianceException.tenant_id.in_(user_tenants),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Exception not found.")
        row.status = body.action
        if body.action == "approved":
            row.approved_by = current_user.id
            row.approval_date = now
        _write_audit(db, current_user, row.tenant_id, "exception", row.id, body.action, body.remarks)
        db.commit()
        return {
            "artifact_type": "exception",
            "artifact_id": row.id,
            "status": row.status,
            "reviewed_at": now,
            "reviewed_by": current_user.id,
            "remarks": body.remarks,
        }

    raise HTTPException(status_code=400, detail=f"Unsupported artifact_type {body.artifact_type!r}.")

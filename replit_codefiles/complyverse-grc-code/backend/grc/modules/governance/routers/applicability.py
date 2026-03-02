from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import (
    ClauseApplicability, ParsedFrameworkControl, UploadedFramework,
    GRCUser, AuditLog, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/applicability", tags=["Applicability Management"])


class ApplicabilityRequest(BaseModel):
    control_id: int
    uploaded_framework_id: int
    is_applicable: bool
    justification: str


class ApplicabilityReviewRequest(BaseModel):
    status: str
    review_comment: Optional[str] = None


def serialize_applicability(record, db):
    requested_user = db.query(GRCUser).filter(GRCUser.id == record.requested_by).first()
    reviewed_user = db.query(GRCUser).filter(GRCUser.id == record.reviewed_by).first() if record.reviewed_by else None
    control = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == record.control_id).first()
    
    return {
        "id": record.id,
        "tenant_id": record.tenant_id,
        "uploaded_framework_id": record.uploaded_framework_id,
        "control_id": record.control_id,
        "control_reference": control.original_reference or control.control_id if control else None,
        "control_title": control.title if control else None,
        "is_applicable": record.is_applicable,
        "justification": record.justification,
        "status": record.status,
        "requested_by": record.requested_by,
        "requested_by_name": requested_user.display_name or requested_user.username if requested_user else None,
        "requested_at": record.requested_at.isoformat() if record.requested_at else None,
        "reviewed_by": record.reviewed_by,
        "reviewed_by_name": reviewed_user.display_name or reviewed_user.username if reviewed_user else None,
        "reviewed_at": record.reviewed_at.isoformat() if record.reviewed_at else None,
        "review_comment": record.review_comment,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


@router.get("/framework/{framework_id}")
def get_framework_applicability(
    framework_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(ClauseApplicability).filter(
        ClauseApplicability.uploaded_framework_id == framework_id,
        ClauseApplicability.tenant_id.in_(user_tenants)
    )
    
    if status_filter:
        query = query.filter(ClauseApplicability.status == status_filter)
    
    records = query.order_by(ClauseApplicability.created_at.desc()).all()
    
    return {
        "framework_id": framework_id,
        "total": len(records),
        "records": [serialize_applicability(r, db) for r in records]
    }


@router.post("/")
def set_clause_applicability(
    request: ApplicabilityRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == request.uploaded_framework_id,
        UploadedFramework.tenant_id.in_(user_tenants)
    ).first()
    if not framework:
        raise HTTPException(status_code=404, detail="Framework not found")
    
    control = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.id == request.control_id,
        ParsedFrameworkControl.uploaded_framework_id == request.uploaded_framework_id
    ).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found in this framework")
    
    if not request.is_applicable and not request.justification.strip():
        raise HTTPException(status_code=400, detail="Justification is required when marking a clause as Not Applicable")
    
    existing = db.query(ClauseApplicability).filter(
        ClauseApplicability.control_id == request.control_id,
        ClauseApplicability.tenant_id == framework.tenant_id
    ).first()
    
    if existing:
        existing.is_applicable = request.is_applicable
        existing.justification = request.justification
        existing.status = "pending"
        existing.requested_by = current_user.id
        existing.requested_at = datetime.utcnow()
        existing.reviewed_by = None
        existing.reviewed_at = None
        existing.review_comment = None
        existing.updated_at = datetime.utcnow()
        record = existing
    else:
        record = ClauseApplicability(
            tenant_id=framework.tenant_id,
            uploaded_framework_id=request.uploaded_framework_id,
            control_id=request.control_id,
            is_applicable=request.is_applicable,
            justification=request.justification,
            status="pending",
            requested_by=current_user.id,
            requested_at=datetime.utcnow()
        )
        db.add(record)
    
    db.flush()
    
    audit = AuditLog(
        tenant_id=framework.tenant_id,
        user_id=current_user.id,
        action="applicability_change",
        resource_type="clause_applicability",
        resource_id=record.id,
        changes={"detail": f"Marked control {control.original_reference or control.control_id} as {'Applicable' if request.is_applicable else 'Not Applicable'}: {request.justification[:200]}"}
    )
    db.add(audit)
    db.commit()
    db.refresh(record)
    
    return serialize_applicability(record, db)


@router.put("/{applicability_id}/review")
def review_applicability(
    applicability_id: int,
    request: ApplicabilityReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    record = db.query(ClauseApplicability).filter(
        ClauseApplicability.id == applicability_id,
        ClauseApplicability.tenant_id.in_(user_tenants)
    ).first()
    
    if not record:
        raise HTTPException(status_code=404, detail="Applicability record not found")
    
    if record.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending records can be reviewed")
    
    if request.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'rejected'")
    
    record.status = request.status
    record.reviewed_by = current_user.id
    record.reviewed_at = datetime.utcnow()
    record.review_comment = request.review_comment
    record.updated_at = datetime.utcnow()
    
    audit = AuditLog(
        tenant_id=record.tenant_id,
        user_id=current_user.id,
        action=f"applicability_{request.status}",
        resource_type="clause_applicability",
        resource_id=record.id,
        changes={"detail": f"{'Approved' if request.status == 'approved' else 'Rejected'} applicability decision. Comment: {request.review_comment or 'None'}"}
    )
    db.add(audit)
    db.commit()
    db.refresh(record)
    
    return serialize_applicability(record, db)


@router.get("/audit-log/{framework_id}")
def get_applicability_audit_log(
    framework_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    logs = db.query(AuditLog).filter(
        AuditLog.tenant_id.in_(user_tenants),
        AuditLog.resource_type == "clause_applicability",
        AuditLog.action.in_(["applicability_change", "applicability_approved", "applicability_rejected"])
    ).order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit).all()
    
    return [{
        "id": log.id,
        "action": log.action,
        "details": log.changes.get("detail", "") if log.changes else "",
        "user_id": log.user_id,
        "created_at": log.timestamp.isoformat() if log.timestamp else None
    } for log in logs]

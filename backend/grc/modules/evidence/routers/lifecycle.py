from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ....models import Evidence, EvidenceVersion, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants
from .evidence import serialize_evidence

router = APIRouter(prefix="/lifecycle", tags=["Evidence - Lifecycle"])


class ReviewRequest(BaseModel):
    action: str
    comments: Optional[str] = None


class RenewRequest(BaseModel):
    new_collection_date: datetime
    new_validity_period_days: Optional[int] = None


def get_evidence_for_user(evidence_id: int, user: GRCUser, db: Session) -> Evidence:
    user_tenants = get_user_tenants(user, db)
    evidence = db.query(Evidence).options(
        joinedload(Evidence.uploader)
    ).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    return evidence


@router.post("/{evidence_id}/submit")
def submit_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_for_user(evidence_id, current_user, db)
    
    if evidence.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Evidence must be in 'draft' status to submit. Current status: {evidence.status}"
        )
    
    evidence.status = "pending_review"
    evidence.submitted_by = current_user.id
    evidence.submitted_at = datetime.utcnow()
    
    db.commit()
    db.refresh(evidence)
    
    return serialize_evidence(evidence, include_counts=True, db=db)


@router.post("/{evidence_id}/review")
def review_evidence(
    evidence_id: int,
    review_request: ReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_for_user(evidence_id, current_user, db)
    
    if evidence.status != "pending_review":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Evidence must be in 'pending_review' status to review. Current status: {evidence.status}"
        )
    
    if review_request.action not in ["approve", "reject"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Action must be 'approve' or 'reject'"
        )
    
    evidence.reviewed_by = current_user.id
    evidence.reviewed_at = datetime.utcnow()
    
    if review_request.action == "approve":
        evidence.status = "approved"
        evidence.approved_by = current_user.id
        evidence.approved_at = datetime.utcnow()
    else:
        evidence.status = "draft"
        evidence.review_comments = review_request.comments
    
    db.commit()
    db.refresh(evidence)
    
    return serialize_evidence(evidence, include_counts=True, db=db)


@router.post("/{evidence_id}/expire")
def expire_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_for_user(evidence_id, current_user, db)
    
    evidence.status = "expired"
    evidence.is_stale = True
    
    db.commit()
    db.refresh(evidence)
    
    return serialize_evidence(evidence, include_counts=True, db=db)


@router.post("/{evidence_id}/renew")
def renew_evidence(
    evidence_id: int,
    renew_request: RenewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_for_user(evidence_id, current_user, db)
    
    validity_days = renew_request.new_validity_period_days or evidence.validity_period_days or 365
    
    evidence.status = "draft"
    evidence.collection_date = renew_request.new_collection_date
    evidence.validity_period_days = validity_days
    evidence.expiry_date = renew_request.new_collection_date + timedelta(days=validity_days)
    evidence.is_stale = False
    
    current_version = evidence.version or 1
    new_version = current_version + 1
    evidence.version = new_version
    
    version_record = EvidenceVersion(
        evidence_id=evidence.id,
        version_number=new_version,
        file_path=evidence.file_path,
        changes=f"Renewed evidence - updated collection date to {renew_request.new_collection_date.isoformat()}",
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(version_record)
    
    db.commit()
    db.refresh(evidence)
    
    return serialize_evidence(evidence, include_counts=True, db=db)


@router.get("/expiring-soon")
def get_expiring_evidence(
    days: int = Query(default=30, ge=1, le=365),
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0}
    
    now = datetime.utcnow()
    future_date = now + timedelta(days=days)
    
    query = db.query(Evidence).options(
        joinedload(Evidence.uploader)
    ).filter(
        Evidence.tenant_id.in_(user_tenants),
        Evidence.expiry_date.isnot(None),
        Evidence.expiry_date > now,
        Evidence.expiry_date <= future_date,
        Evidence.status != "expired"
    )
    
    if tenant_id:
        if tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this tenant's data"
            )
        query = query.filter(Evidence.tenant_id == tenant_id)
    
    evidence_list = query.order_by(Evidence.expiry_date.asc()).all()
    
    return {
        "items": [serialize_evidence(e, include_counts=True, db=db) for e in evidence_list],
        "total": len(evidence_list),
        "days_window": days
    }


@router.get("/stale")
def get_stale_evidence(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0}
    
    query = db.query(Evidence).options(
        joinedload(Evidence.uploader)
    ).filter(
        Evidence.tenant_id.in_(user_tenants),
        Evidence.is_stale == True
    )
    
    if tenant_id:
        if tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this tenant's data"
            )
        query = query.filter(Evidence.tenant_id == tenant_id)
    
    evidence_list = query.order_by(Evidence.expiry_date.asc()).all()
    
    return {
        "items": [serialize_evidence(e, include_counts=True, db=db) for e in evidence_list],
        "total": len(evidence_list)
    }


@router.post("/check-staleness")
def check_staleness(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"newly_marked_stale": 0, "already_stale": 0, "total_checked": 0}
    
    now = datetime.utcnow()
    
    query = db.query(Evidence).filter(
        Evidence.tenant_id.in_(user_tenants),
        Evidence.expiry_date.isnot(None)
    )
    
    if tenant_id:
        if tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this tenant's data"
            )
        query = query.filter(Evidence.tenant_id == tenant_id)
    
    evidence_list = query.all()
    
    newly_marked_stale = 0
    already_stale = 0
    total_checked = len(evidence_list)
    
    for evidence in evidence_list:
        if evidence.expiry_date and evidence.expiry_date < now:
            if not evidence.is_stale:
                evidence.is_stale = True
                newly_marked_stale += 1
            else:
                already_stale += 1
    
    db.commit()
    
    return {
        "newly_marked_stale": newly_marked_stale,
        "already_stale": already_stale,
        "total_checked": total_checked
    }

"""
Policy Attestation Router - Manages user acknowledgments and attestations for governance documents
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from datetime import datetime, timedelta
from typing import Optional, List
from pydantic import BaseModel

from ....models import (
    GRCUser, Tenant, GovernanceDocument, GovernanceDocumentVersion,
    PolicyAttestation, Evidence, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/attestations", tags=["Policy Attestations"])


class AttestationCreate(BaseModel):
    document_id: int
    document_version_id: Optional[int] = None
    user_ids: List[int]
    attestation_type: str = "acknowledgment"
    attestation_text: Optional[str] = None
    due_date: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_recurring: bool = False
    recurrence_months: Optional[int] = None


class AttestationComplete(BaseModel):
    user_comments: Optional[str] = None


class BulkLinkEvidenceRequest(BaseModel):
    attestation_ids: List[int]


class AttestationResponse(BaseModel):
    id: int
    document_id: int
    document_title: str
    document_version: Optional[str] = None
    user_id: int
    user_name: str
    user_email: str
    attestation_type: str
    status: str
    attestation_text: Optional[str] = None
    requested_at: datetime
    due_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    user_comments: Optional[str] = None
    is_overdue: bool = False
    days_until_due: Optional[int] = None

    class Config:
        from_attributes = True


@router.post("/request", status_code=status.HTTP_201_CREATED)
async def request_attestations(
    attestation_data: AttestationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Request attestations from one or more users for a governance document.
    Only document owners or admins can request attestations.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant access"
        )
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == attestation_data.document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.status not in ["published", "approved"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attestations can only be requested for published or approved documents"
        )
    
    created_attestations = []
    
    for user_id in attestation_data.user_ids:
        user = db.query(GRCUser).filter(
            GRCUser.id == user_id,
            GRCUser.tenant_id.in_(user_tenants)
        ).first()
        
        if not user:
            continue
        
        existing = db.query(PolicyAttestation).filter(
            PolicyAttestation.document_id == attestation_data.document_id,
            PolicyAttestation.user_id == user_id,
            PolicyAttestation.status == "pending"
        ).first()
        
        if existing:
            continue
        
        attestation = PolicyAttestation(
            tenant_id=document.tenant_id,
            document_id=attestation_data.document_id,
            document_version_id=attestation_data.document_version_id or document.versions[0].id if document.versions else None,
            user_id=user_id,
            attestation_type=attestation_data.attestation_type,
            attestation_text=attestation_data.attestation_text or f"I acknowledge that I have read, understood, and agree to comply with the {document.title}.",
            due_date=attestation_data.due_date or (datetime.utcnow() + timedelta(days=14)),
            expires_at=attestation_data.expires_at,
            is_recurring=attestation_data.is_recurring,
            recurrence_months=attestation_data.recurrence_months,
            requested_by=current_user.id,
            status="pending"
        )
        db.add(attestation)
        created_attestations.append(attestation)
    
    db.commit()
    
    return {
        "message": f"Attestation requests sent to {len(created_attestations)} users",
        "attestation_ids": [a.id for a in created_attestations]
    }


@router.get("/pending")
async def get_pending_attestations(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all pending attestations for the current user"""
    attestations = db.query(PolicyAttestation).filter(
        PolicyAttestation.user_id == current_user.id,
        PolicyAttestation.status == "pending"
    ).order_by(PolicyAttestation.due_date.asc()).all()
    
    result = []
    now = datetime.utcnow()
    
    for att in attestations:
        document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == att.document_id
        ).first()
        
        is_overdue = att.due_date and att.due_date < now
        days_until_due = None
        if att.due_date:
            days_until_due = (att.due_date - now).days
        
        result.append({
            "id": att.id,
            "document_id": att.document_id,
            "document_title": document.title if document else "Unknown",
            "document_type": document.doc_type if document else None,
            "attestation_type": att.attestation_type,
            "attestation_text": att.attestation_text,
            "status": att.status,
            "requested_at": att.requested_at,
            "due_date": att.due_date,
            "is_overdue": is_overdue,
            "days_until_due": days_until_due
        })
    
    return result


@router.post("/{attestation_id}/complete")
async def complete_attestation(
    attestation_id: int,
    completion_data: AttestationComplete,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Complete an attestation (user acknowledges the policy)"""
    user_tenants = get_user_tenants(current_user, db)
    
    attestation = db.query(PolicyAttestation).filter(
        PolicyAttestation.id == attestation_id,
        PolicyAttestation.user_id == current_user.id,
        PolicyAttestation.tenant_id.in_(user_tenants) if user_tenants else False
    ).first()
    
    if not attestation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attestation not found or not assigned to you"
        )
    
    if attestation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attestation is already {attestation.status}"
        )
    
    attestation.status = "completed"
    attestation.completed_at = datetime.utcnow()
    attestation.user_comments = completion_data.user_comments
    attestation.ip_address = request.client.host if request.client else None
    attestation.user_agent = request.headers.get("user-agent", "")[:500]
    
    if attestation.is_recurring and attestation.recurrence_months:
        next_due = datetime.utcnow() + timedelta(days=attestation.recurrence_months * 30)
        next_expiry = next_due + timedelta(days=14) if attestation.expires_at else None
        
        next_attestation = PolicyAttestation(
            tenant_id=attestation.tenant_id,
            document_id=attestation.document_id,
            document_version_id=attestation.document_version_id,
            user_id=attestation.user_id,
            attestation_type=attestation.attestation_type,
            attestation_text=attestation.attestation_text,
            due_date=next_due,
            expires_at=next_expiry,
            is_recurring=True,
            recurrence_months=attestation.recurrence_months,
            parent_attestation_id=attestation.id,
            requested_by=attestation.requested_by,
            status="pending"
        )
        db.add(next_attestation)
    
    db.commit()
    
    return {
        "message": "Attestation completed successfully",
        "attestation_id": attestation.id,
        "completed_at": attestation.completed_at
    }


@router.get("/document/{document_id}")
async def get_document_attestations(
    document_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all attestations for a specific document"""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant access")
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    query = db.query(PolicyAttestation).filter(
        PolicyAttestation.document_id == document_id,
        PolicyAttestation.tenant_id.in_(user_tenants)
    )
    
    if status_filter:
        query = query.filter(PolicyAttestation.status == status_filter)
    
    attestations = query.order_by(PolicyAttestation.requested_at.desc()).all()
    
    now = datetime.utcnow()
    result = []
    
    for att in attestations:
        user = db.query(GRCUser).filter(GRCUser.id == att.user_id).first()
        
        is_overdue = att.status == "pending" and att.due_date and att.due_date < now
        
        result.append({
            "id": att.id,
            "user_id": att.user_id,
            "user_name": user.name if user else "Unknown",
            "user_email": user.email if user else "Unknown",
            "attestation_type": att.attestation_type,
            "status": att.status,
            "requested_at": att.requested_at,
            "due_date": att.due_date,
            "completed_at": att.completed_at,
            "expires_at": att.expires_at,
            "user_comments": att.user_comments,
            "is_overdue": is_overdue,
            "is_recurring": att.is_recurring
        })
    
    pending_count = len([a for a in result if a["status"] == "pending"])
    completed_count = len([a for a in result if a["status"] == "completed"])
    overdue_count = len([a for a in result if a["is_overdue"]])
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "attestations": result,
        "summary": {
            "total": len(result),
            "pending": pending_count,
            "completed": completed_count,
            "overdue": overdue_count,
            "compliance_rate": round((completed_count / len(result) * 100), 1) if result else 0
        }
    }


@router.get("/history")
async def get_attestation_history(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get attestation history for the current user"""
    attestations = db.query(PolicyAttestation).filter(
        PolicyAttestation.user_id == current_user.id,
        PolicyAttestation.status.in_(["completed", "expired"])
    ).order_by(
        PolicyAttestation.completed_at.desc()
    ).offset(offset).limit(limit).all()
    
    result = []
    for att in attestations:
        document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == att.document_id
        ).first()
        
        result.append({
            "id": att.id,
            "document_id": att.document_id,
            "document_title": document.title if document else "Unknown",
            "attestation_type": att.attestation_type,
            "status": att.status,
            "completed_at": att.completed_at,
            "expires_at": att.expires_at
        })
    
    return result


@router.get("/stats")
async def get_attestation_statistics(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get attestation statistics for the tenant"""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"total": 0, "pending": 0, "completed": 0, "overdue": 0, "expiring_soon": 0, "completed_this_month": 0, "compliance_rate": 0, "by_type": []}
    
    now = datetime.utcnow()
    
    total = db.query(func.count(PolicyAttestation.id)).filter(
        PolicyAttestation.tenant_id.in_(user_tenants)
    ).scalar()
    
    pending = db.query(func.count(PolicyAttestation.id)).filter(
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "pending"
    ).scalar()
    
    completed = db.query(func.count(PolicyAttestation.id)).filter(
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "completed"
    ).scalar()
    
    overdue = db.query(func.count(PolicyAttestation.id)).filter(
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "pending",
        PolicyAttestation.due_date < now
    ).scalar()
    
    expiring_soon = db.query(func.count(PolicyAttestation.id)).filter(
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "completed",
        PolicyAttestation.expires_at.isnot(None),
        PolicyAttestation.expires_at < now + timedelta(days=30),
        PolicyAttestation.expires_at > now
    ).scalar()
    
    by_type = db.query(
        PolicyAttestation.attestation_type,
        func.count(PolicyAttestation.id).label("count")
    ).filter(
        PolicyAttestation.tenant_id.in_(user_tenants)
    ).group_by(PolicyAttestation.attestation_type).all()
    
    completed_this_month = db.query(func.count(PolicyAttestation.id)).filter(
        PolicyAttestation.tenant_id.in_(user_tenants),
        PolicyAttestation.status == "completed",
        PolicyAttestation.completed_at >= now.replace(day=1)
    ).scalar()
    
    return {
        "total": total,
        "pending": pending,
        "completed": completed,
        "overdue": overdue,
        "expiring_soon": expiring_soon,
        "completed_this_month": completed_this_month,
        "compliance_rate": round((completed / total * 100), 1) if total > 0 else 0,
        "by_type": [{"type": t[0], "count": t[1]} for t in by_type]
    }


@router.delete("/{attestation_id}")
async def revoke_attestation(
    attestation_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Revoke/cancel a pending attestation request"""
    user_tenants = get_user_tenants(current_user, db)
    
    attestation = db.query(PolicyAttestation).filter(
        PolicyAttestation.id == attestation_id,
        PolicyAttestation.tenant_id.in_(user_tenants) if user_tenants else False
    ).first()
    
    if not attestation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attestation not found"
        )
    
    if attestation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending attestations can be revoked"
        )
    
    attestation.status = "revoked"
    attestation.updated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Attestation revoked successfully"}


@router.post("/{attestation_id}/link-to-evidence", status_code=status.HTTP_201_CREATED)
async def link_attestation_to_evidence(
    attestation_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Link a completed attestation to the evidence repository.
    Only works for attestations with status "completed".
    Returns existing evidence if already linked (idempotent).
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant access"
        )
    
    attestation = db.query(PolicyAttestation).filter(
        PolicyAttestation.id == attestation_id
    ).first()
    
    if not attestation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attestation not found"
        )
    
    if attestation.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-tenant access denied. You do not have permission to link this attestation."
        )
    
    if attestation.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only completed attestations can be linked to evidence"
        )
    
    source_system_key = f"attestation:{attestation_id}"
    existing_evidence = db.query(Evidence).filter(
        Evidence.source_system == source_system_key
    ).first()
    
    if existing_evidence:
        return {
            "id": existing_evidence.id,
            "name": existing_evidence.name,
            "description": existing_evidence.description,
            "evidence_type": existing_evidence.evidence_type,
            "source_system": existing_evidence.source_system,
            "collection_date": existing_evidence.collection_date,
            "status": existing_evidence.status,
            "uploaded_at": existing_evidence.uploaded_at,
            "already_linked": True,
            "created_count": 0,
            "already_linked_count": 1
        }
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == attestation.document_id
    ).first()
    document_title = document.title if document else "Unknown Document"
    
    user = db.query(GRCUser).filter(GRCUser.id == attestation.user_id).first()
    user_name = user.display_name or user.username if user else "Unknown User"
    
    description = (
        f"Attestation completed by {user_name} on {attestation.completed_at.strftime('%Y-%m-%d %H:%M:%S') if attestation.completed_at else 'N/A'}. "
        f"Attestation type: {attestation.attestation_type}. "
        f"Source ID: {attestation_id}. "
        f"Source type: attestation."
    )
    if attestation.user_comments:
        description += f" User comments: {attestation.user_comments}"
    
    evidence = Evidence(
        tenant_id=attestation.tenant_id,
        name=f"Attestation - {document_title}",
        description=description,
        evidence_type="attestation",
        source_system=source_system_key,
        collection_date=attestation.completed_at,
        uploaded_by=current_user.id,
        uploaded_at=datetime.utcnow(),
        status="approved"
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    
    return {
        "id": evidence.id,
        "name": evidence.name,
        "description": evidence.description,
        "evidence_type": evidence.evidence_type,
        "source_system": evidence.source_system,
        "collection_date": evidence.collection_date,
        "status": evidence.status,
        "uploaded_at": evidence.uploaded_at,
        "already_linked": False,
        "created_count": 1,
        "already_linked_count": 0
    }


@router.post("/bulk-link-evidence", status_code=status.HTTP_201_CREATED)
async def bulk_link_attestations_to_evidence(
    request_data: BulkLinkEvidenceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Bulk link completed attestations to evidence repository.
    Tracks created, already linked, and error counts separately.
    Idempotent - skips attestations that are already linked to evidence.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant access"
        )
    
    created_count = 0
    already_linked_count = 0
    error_count = 0
    created_evidence_ids = []
    already_linked_evidence_ids = []
    errors = []
    
    for attestation_id in request_data.attestation_ids:
        attestation = db.query(PolicyAttestation).filter(
            PolicyAttestation.id == attestation_id
        ).first()
        
        if not attestation:
            error_count += 1
            errors.append({
                "attestation_id": attestation_id,
                "reason": "Attestation not found"
            })
            continue
        
        if attestation.tenant_id not in user_tenants:
            error_count += 1
            errors.append({
                "attestation_id": attestation_id,
                "reason": "Cross-tenant access denied"
            })
            continue
        
        if attestation.status != "completed":
            error_count += 1
            errors.append({
                "attestation_id": attestation_id,
                "reason": f"Attestation status is '{attestation.status}', expected 'completed'"
            })
            continue
        
        source_system_key = f"attestation:{attestation_id}"
        existing_evidence = db.query(Evidence).filter(
            Evidence.source_system == source_system_key
        ).first()
        
        if existing_evidence:
            already_linked_count += 1
            already_linked_evidence_ids.append(existing_evidence.id)
            continue
        
        document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == attestation.document_id
        ).first()
        document_title = document.title if document else "Unknown Document"
        
        user = db.query(GRCUser).filter(GRCUser.id == attestation.user_id).first()
        user_name = user.display_name or user.username if user else "Unknown User"
        
        description = (
            f"Attestation completed by {user_name} on {attestation.completed_at.strftime('%Y-%m-%d %H:%M:%S') if attestation.completed_at else 'N/A'}. "
            f"Attestation type: {attestation.attestation_type}. "
            f"Source ID: {attestation_id}. "
            f"Source type: attestation."
        )
        if attestation.user_comments:
            description += f" User comments: {attestation.user_comments}"
        
        evidence = Evidence(
            tenant_id=attestation.tenant_id,
            name=f"Attestation - {document_title}",
            description=description,
            evidence_type="attestation",
            source_system=source_system_key,
            collection_date=attestation.completed_at,
            uploaded_by=current_user.id,
            uploaded_at=datetime.utcnow(),
            status="approved"
        )
        db.add(evidence)
        created_count += 1
        db.flush()
        created_evidence_ids.append(evidence.id)
    
    db.commit()
    
    return {
        "message": f"Processed {len(request_data.attestation_ids)} attestations: {created_count} created, {already_linked_count} already linked, {error_count} errors",
        "created_count": created_count,
        "already_linked_count": already_linked_count,
        "error_count": error_count,
        "created_evidence_ids": created_evidence_ids,
        "already_linked_evidence_ids": already_linked_evidence_ids,
        "errors": errors
    }
